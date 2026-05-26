import crypto from "crypto";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { routes } from "@shared/schema";
import {
  optimizeRouteAsyncMultiStart,
  deduplicateCandidates,
  calculateTotalDistance,
  getMapboxRouteMetrics,
} from "../route-optimizer";
import { routificOptimize } from "../routific";
import { geocodeAddress } from "../geocode";
import { getCompanyToday } from "../../utils/company-date";
import { registerSkill, type SkillContext, type SkillResult } from "./index";
import { getUserById } from "../app-auth";

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
    return {
      success: false,
      message: "Route is locked. Unlock it before optimizing.",
      error: "LOCKED",
    };
  }

  const plans = await storage.getServicePlans(companyId, { isActive: true });
  const routePlans = plans.filter((sp) => sp.routeId === route.id);

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

  const company = await storage.getCompany(companyId);

  const allProperties = await storage.getProperties(companyId);
  let propertyMap = new Map(allProperties.map((p) => [p.id, p]));

  const needsGeocode = routePlans.filter((sp) => {
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
    .map((sp) => {
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
    const geocodedIds = new Set(stops.map((s) => s.id));
    const allContacts = await storage.getContacts(companyId);
    const contactMap = new Map(allContacts.map((c) => [c.id, c]));
    const failedStops = routePlans
      .filter((sp) => !geocodedIds.has(sp.id))
      .map((sp) => {
        const prop = propertyMap.get(sp.propertyId);
        const contact = contactMap.get(sp.contactId);
        const name = contact ? `${contact.firstName} ${contact.lastName}`.trim() : "Unknown";
        const address = prop
          ? [prop.streetAddress, prop.city, prop.state, prop.zipCode].filter(Boolean).join(", ")
          : "No address";
        return {
          servicePlanId: sp.id,
          contactId: sp.contactId,
          propertyId: sp.propertyId,
          name,
          address,
        };
      });
    return {
      success: false,
      message: `${ungeocoded} of ${routePlans.length} stops could not be geocoded. Ensure addresses are complete.`,
      error: "GEOCODE_FAILURE",
      data: { stopCount: routePlans.length, geocodedCount: stops.length, failedStops },
    };
  }

  // Collect ALL valid candidate start locations (multi-start optimization):
  // 1. Route's assigned depot
  // 2. Assigned technician's default depot
  // 3. Company's primary depot
  // 4. Legacy company start coordinates
  // Near-duplicate candidates are deduplicated inside optimizeRouteAsyncMultiStart.
  const candidateStarts: { latitude: number; longitude: number }[] = [];

  if (route.depotId) {
    const depot = await storage.getDepotById(route.depotId, companyId);
    if (depot) {
      candidateStarts.push({
        latitude: parseFloat(String(depot.latitude)),
        longitude: parseFloat(String(depot.longitude)),
      });
    }
  }
  if (route.technicianId) {
    const techUser = await getUserById(route.technicianId);
    if (techUser?.defaultDepotId) {
      const techDepot = await storage.getDepotById(techUser.defaultDepotId, companyId);
      if (techDepot) {
        candidateStarts.push({
          latitude: parseFloat(String(techDepot.latitude)),
          longitude: parseFloat(String(techDepot.longitude)),
        });
      }
    }
    // 5. Technician's saved home address
    if (techUser?.homeLatitude != null && techUser?.homeLongitude != null) {
      candidateStarts.push({
        latitude: techUser.homeLatitude,
        longitude: techUser.homeLongitude,
      });
    }
  }
  const primaryDepot = await storage.getPrimaryDepot(companyId);
  if (primaryDepot) {
    candidateStarts.push({
      latitude: parseFloat(String(primaryDepot.latitude)),
      longitude: parseFloat(String(primaryDepot.longitude)),
    });
  }
  if (company?.startLatitude && company?.startLongitude) {
    candidateStarts.push({
      latitude: parseFloat(String(company.startLatitude)),
      longitude: parseFloat(String(company.startLongitude)),
    });
  }

  // The winning start point is determined by the multi-start optimizer.
  // Fall back to the first candidate (or undefined) for metrics and Routific.
  const dedupedCandidates = deduplicateCandidates(candidateStarts);
  const startPoint = dedupedCandidates[0];

  const originalMapbox = await getMapboxRouteMetrics(stops, startPoint);
  const originalDistance = originalMapbox?.distance ?? calculateTotalDistance(stops, startPoint);
  const originalMinutes = originalMapbox?.duration ?? (originalDistance / 25) * 60;

  const internalResult = await optimizeRouteAsyncMultiStart(stops, dedupedCandidates, companyId);
  // Use the winning start point for subsequent Routific call and metrics.
  const bestStart = internalResult.bestStart ?? startPoint;

  let orderedIds: string[];
  let isDegraded = false;
  let routingEngine: string;
  let routificResult: Awaited<ReturnType<typeof routificOptimize>> = null;

  if (!internalResult.degraded) {
    orderedIds = internalResult.orderedIds;
    routingEngine = "internal";
  } else {
    const routificOptions =
      company?.maxRouteDurationHours != null && company.maxRouteDurationHours > 0
        ? { maxDurationHours: company.maxRouteDurationHours }
        : undefined;
    routificResult = await routificOptimize(stops, bestStart, routificOptions);
    if (routificResult) {
      orderedIds = routificResult.orderedIds;
      routingEngine = "routific";
    } else {
      orderedIds = internalResult.orderedIds;
      isDegraded = true;
      routingEngine = "haversine";
    }
  }

  const stopsById = new Map(stops.map((s) => [s.id, s]));
  const optimizedStops = orderedIds.map((id) => stopsById.get(id)!);

  const originalOrderIds = stops.map((s) => s.id);
  const stopsActuallyMoved = orderedIds.filter((id, i) => originalOrderIds[i] !== id).length;

  for (let i = 0; i < orderedIds.length; i++) {
    await storage.updateServicePlan(orderedIds[i], companyId, { stopOrder: i + 1 });
  }

  const plansWithoutCoords = routePlans.filter((sp) => {
    const prop = propertyMap.get(sp.propertyId);
    return !prop || !prop.latitude || !prop.longitude;
  });
  for (const plan of plansWithoutCoords) {
    await storage.updateServicePlan(plan.id, companyId, {
      stopOrder: orderedIds.length + 1,
    });
  }

  const optimizedMapbox = await getMapboxRouteMetrics(optimizedStops, startPoint);
  const optimizedDistance =
    optimizedMapbox?.distance ??
    routificResult?.totalDistance ??
    calculateTotalDistance(optimizedStops, startPoint);
  const optimizedMinutes =
    optimizedMapbox?.duration ?? routificResult?.totalDuration ?? (optimizedDistance / 25) * 60;

  const milesSaved = Math.max(0, Math.round((originalDistance - optimizedDistance) * 10) / 10);
  const minutesSaved = Math.max(0, Math.round(originalMinutes - optimizedMinutes));

  try {
    const affectedPlanIds = routePlans.map((p) => p.id);
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

  const stopHash = computeStopHash(routePlans.map((p) => p.id));
  await db
    .update(routes)
    .set({ lastOptimizedAt: new Date(), optimizedStopHash: stopHash, updatedAt: new Date() })
    .where(and(eq(routes.id, route.id), eq(routes.companyId, companyId)));

  const stopsReordered = stopsActuallyMoved;

  const parts: string[] = [
    `Optimized route "${route.name}" — reordered ${stopsReordered} stop${stopsReordered !== 1 ? "s" : ""}`,
  ];
  if (milesSaved > 0) parts.push(`saving ${milesSaved} mile${milesSaved !== 1 ? "s" : ""}`);
  if (minutesSaved > 0)
    parts.push(`and about ${minutesSaved} minute${minutesSaved !== 1 ? "s" : ""} of drive time`);

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
      routingEngine,
      lastOptimizedAt: new Date().toISOString(),
      optimizedStopHash: stopHash,
      order: orderedIds,
      degraded: isDegraded,
      degradedReason: isDegraded
        ? "Optimization used estimated distances — live drive times were temporarily unavailable."
        : undefined,
    },
  };
}

registerSkill({
  name: "optimize_route",
  description:
    'Optimize the stop order for a route to minimize total drive distance. Pass routeId as a specific route UUID, or "__all__" to optimize every active route for the company.',
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

      const succeeded = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);
      const summary =
        succeeded.length === results.length
          ? `Optimized all ${results.length} route${results.length !== 1 ? "s" : ""} successfully.`
          : `Optimized ${succeeded.length} of ${results.length} routes. ${failed.length} failed: ${failed.map((r) => r.message).join("; ")}`;
      return {
        success: succeeded.length > 0,
        message: summary,
        data: {
          total: results.length,
          succeeded: succeeded.length,
          failed: failed.length,
        },
      };
    }

    return optimizeSingleRoute(routeId, companyId);
  },
});
