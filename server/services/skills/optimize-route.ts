import crypto from "crypto";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { routes } from "@shared/schema";
import { optimizeRoute, calculateTotalDistance, getMapboxRouteMetrics } from "../route-optimizer";
import { geocodeAddress } from "../geocode";
import { getCompanyToday } from "../../utils/company-date";
import { getDemoCompanyId } from "../../utils/demo";
import { registerSkill, type SkillContext, type SkillResult } from "./index";

function computeStopHash(stopIds: string[]): string {
  const sorted = [...stopIds].sort().join(",");
  return crypto.createHash("sha256").update(sorted).digest("hex").substring(0, 64);
}

/** Internal helper – optimizes a single route by ID. */
async function optimizeSingleRoute(routeId: string, companyId: string): Promise<SkillResult> {

    const route = await storage.getRoute(routeId, companyId);
    if (!route) {
      return { success: false, message: `Route not found: ${routeId}`, error: "ROUTE_NOT_FOUND" };
    }
    if (route.isLocked) {
      return { success: false, message: "Route is locked. Unlock it before optimizing.", error: "LOCKED" };
    }

    const plans = await storage.getServicePlans(companyId, { isActive: true });
    const routePlans = plans.filter(sp => sp.routeId === route.id);

    if (routePlans.length <= 1) {
      return {
        success: false,
        message: "Not enough stops to optimize (need at least 2 active stops).",
        error: "INSUFFICIENT_STOPS",
        data: { stopCount: routePlans.length },
      };
    }
    if (routePlans.length > 60) {
      return {
        success: false,
        message: "Route exceeds the 60-stop maximum. Please split into smaller routes.",
        error: "TOO_MANY_STOPS",
        data: { stopCount: routePlans.length },
      };
    }

    const creditsRequired = routePlans.length <= 30 ? 1 : 2;
    const company = await storage.getCompany(companyId);
    const currentCredits = company?.routeCredits ?? 0;
    const demoUnlimitedCredits = !!company?.demoUnlimitedCredits;
    const isDemoCompanyForCredits = demoUnlimitedCredits && (await getDemoCompanyId()) === companyId;

    if (!isDemoCompanyForCredits && currentCredits < creditsRequired) {
      return {
        success: false,
        message: `Not enough route credits (need ${creditsRequired}, have ${currentCredits}).`,
        error: "INSUFFICIENT_CREDITS",
        data: { creditsRequired, creditsAvailable: currentCredits },
      };
    }

    const allProperties = await storage.getProperties(companyId);
    let propertyMap = new Map(allProperties.map(p => [p.id, p]));

    const needsGeocode = routePlans.filter(sp => {
      const prop = propertyMap.get(sp.propertyId);
      return prop && prop.streetAddress && (!prop.latitude || !prop.longitude);
    });
    for (const sp of needsGeocode) {
      const prop = propertyMap.get(sp.propertyId)!;
      const coords = await geocodeAddress(prop.streetAddress!, prop.city, prop.state, prop.zipCode);
      if (coords) {
        const updated = await storage.updateProperty(prop.id, companyId, {
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
        propertyMap.set(prop.id, updated);
      }
    }

    const stops = routePlans
      .map(sp => {
        const prop = propertyMap.get(sp.propertyId);
        if (!prop || !prop.latitude || !prop.longitude) return null;
        return {
          id: sp.id,
          latitude: parseFloat(String(prop.latitude)),
          longitude: parseFloat(String(prop.longitude)),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    const ungeocoded = routePlans.length - stops.length;
    if (stops.length < 2) {
      return {
        success: false,
        message: `${ungeocoded} of ${routePlans.length} stops could not be geocoded. Ensure addresses are complete.`,
        error: "GEOCODE_FAILURE",
        data: { stopCount: routePlans.length, geocodedCount: stops.length },
      };
    }

    let startPoint: { latitude: number; longitude: number } | undefined;
    if (company?.startLatitude && company?.startLongitude) {
      startPoint = {
        latitude: parseFloat(String(company.startLatitude)),
        longitude: parseFloat(String(company.startLongitude)),
      };
    }

    const originalMapbox = await getMapboxRouteMetrics(stops, startPoint);
    const originalDistance = originalMapbox?.distance ?? calculateTotalDistance(stops, startPoint);
    const originalMinutes = originalMapbox?.duration ?? (originalDistance / 25) * 60;

    const result = optimizeRoute(stops, startPoint);

    const stopsById = new Map(stops.map(s => [s.id, s]));
    const optimizedStops = result.orderedIds.map(id => stopsById.get(id)!);

    const originalOrderIds = stops.map(s => s.id);
    const stopsActuallyMoved = result.orderedIds.filter((id, i) => originalOrderIds[i] !== id).length;

    for (let i = 0; i < result.orderedIds.length; i++) {
      await storage.updateServicePlan(result.orderedIds[i], companyId, { stopOrder: i + 1 });
    }

    const plansWithoutCoords = routePlans.filter(sp => {
      const prop = propertyMap.get(sp.propertyId);
      return !prop || !prop.latitude || !prop.longitude;
    });
    for (const plan of plansWithoutCoords) {
      await storage.updateServicePlan(plan.id, companyId, { stopOrder: result.orderedIds.length + 1 });
    }

    if (!isDemoCompanyForCredits) {
      await storage.updateCompany(companyId, { routeCredits: currentCredits - creditsRequired });
    }

    const optimizedMapbox = await getMapboxRouteMetrics(optimizedStops, startPoint);
    const optimizedDistance = optimizedMapbox?.distance ?? result.totalDistance;
    const optimizedMinutes = optimizedMapbox?.duration ?? (result.totalDistance / 25) * 60;

    const milesSaved = Math.max(0, Math.round((originalDistance - optimizedDistance) * 10) / 10);
    const minutesSaved = Math.max(0, Math.round(originalMinutes - optimizedMinutes));

    try {
      const affectedPlanIds = routePlans.map(p => p.id);
      const tz = company?.timezone || "America/New_York";
      const today = getCompanyToday(tz);
      await storage.deleteFutureScheduledVisitsForPlans(affectedPlanIds, today);
      const { generateVisitsForPlans } = await import("../../jobs/auto-visits");
      const startDate = new Date(today + "T00:00:00Z");
      startDate.setUTCDate(startDate.getUTCDate() + 1);
      const endDate = new Date(today + "T00:00:00Z");
      endDate.setUTCDate(endDate.getUTCDate() + 182);
      await generateVisitsForPlans(
        companyId,
        affectedPlanIds,
        startDate.toISOString().split("T")[0],
        endDate.toISOString().split("T")[0]
      );
    } catch (genErr) {
      console.error("[optimize_route skill] Failed to regenerate visits:", genErr);
    }

    const stopHash = computeStopHash(routePlans.map(p => p.id));
    await db
      .update(routes)
      .set({ lastOptimizedAt: new Date(), optimizedStopHash: stopHash, updatedAt: new Date() })
      .where(and(eq(routes.id, route.id), eq(routes.companyId, companyId)));

    const stopsReordered = stopsActuallyMoved;

    const parts: string[] = [`Optimized route "${route.name}" — reordered ${stopsReordered} stop${stopsReordered !== 1 ? "s" : ""}`];
    if (milesSaved > 0) parts.push(`saving ${milesSaved} mile${milesSaved !== 1 ? "s" : ""}`);
    if (minutesSaved > 0) parts.push(`and about ${minutesSaved} minute${minutesSaved !== 1 ? "s" : ""} of drive time`);

    return {
      success: true,
      message: parts.join(", ") + ".",
      data: {
        routeId: route.id,
        routeName: route.name,
        stopsReordered,
        milesSaved,
        minutesSaved,
        totalDistance: Math.round(optimizedDistance * 10) / 10,
        originalDistance: Math.round(originalDistance * 10) / 10,
        stopCount: routePlans.length,
        geocodedCount: stops.length,
        hasStartPoint: !!startPoint,
        creditsUsed: isDemoCompanyForCredits ? 0 : creditsRequired,
        creditsRemaining: isDemoCompanyForCredits ? 999999 : currentCredits - creditsRequired,
        routingEngine: optimizedMapbox ? "mapbox" : "haversine",
        lastOptimizedAt: new Date().toISOString(),
        optimizedStopHash: stopHash,
        order: result.orderedIds,
      },
    };
}

registerSkill({
  name: "optimize_route",
  description: "Optimize the stop order for a route to minimize total drive distance. Pass routeId as a specific route UUID, or \"__all__\" to optimize every active route for the company.",
  parameterSchema: z.object({
    routeId: z.string().min(1, "routeId is required"),
  }),
  async execute(params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    const { routeId } = params as { routeId: string };
    const { companyId } = context;

    if (routeId === "__all__") {
      const allRoutes = await storage.getRoutes(companyId);
      if (allRoutes.length === 0) {
        return { success: false, message: "No routes found to optimize.", error: "NO_ROUTES" };
      }
      const results: SkillResult[] = [];
      for (const r of allRoutes) {
        results.push(await optimizeSingleRoute(r.id, companyId));
      }
      const succeeded = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);
      const summary = succeeded.length === results.length
        ? `Optimized all ${results.length} route${results.length !== 1 ? "s" : ""} successfully.`
        : `Optimized ${succeeded.length} of ${results.length} routes. ${failed.length} failed: ${failed.map(r => r.message).join("; ")}`;
      return {
        success: succeeded.length > 0,
        message: summary,
        data: { total: results.length, succeeded: succeeded.length, failed: failed.length },
      };
    }

    return optimizeSingleRoute(routeId, companyId);
  },
});
