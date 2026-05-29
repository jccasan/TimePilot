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

  const company = await storage.getCompany(companyId);

  const plans = await storage.getServicePlans(companyId, { isActive: true });
  let routePlans = plans.filter((sp) => sp.routeId === route.id);

  // Fallback: the UI can assign stops to a route via visit.routeId rather than
  // servicePlan.routeId (e.g. one-time route overrides or demo data). Mirror that
  // dual-lookup so the optimizer sees the same stops the UI shows.
  // Use a ±30-day window so both past visits and upcoming (future-dated) visits
  // are included — the user may be viewing any date on the route calendar.
  if (routePlans.length <= 1) {
    const tz = company?.timezone ?? "America/New_York";
    const today = getCompanyToday(tz);
    const d = new Date(today + "T12:00:00Z");
    const windowStart = new Date(d);
    windowStart.setUTCDate(d.getUTCDate() - 30);
    const windowEnd = new Date(d);
    windowEnd.setUTCDate(d.getUTCDate() + 30);
    const toYMD = (dt: Date) => dt.toISOString().split("T")[0];
    const windowVisits = await storage.getVisitsForDateRange(
      companyId,
      toYMD(windowStart),
      toYMD(windowEnd)
    );
    const visitPlanIds = new Set(
      windowVisits
        .filter((v) => v.routeId === route.id && v.servicePlanId && v.status !== "cancelled")
        .map((v) => v.servicePlanId as string)
    );
    if (visitPlanIds.size > routePlans.length) {
      routePlans = plans.filter((sp) => visitPlanIds.has(sp.id));
    }
  }

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

  // Sort by saved stopOrder so the "before" baseline reflects the actual user-visible
  // route order, not the arbitrary DB fetch order.  Nulls sort last (unordered stops).
  routePlans.sort((a, b) => {
    const ao = a.stopOrder ?? Infinity;
    const bo = b.stopOrder ?? Infinity;
    return ao - bo;
  });

  // --- Mid-day re-optimization: lock completed/skipped stops ---
  // Fetch today's visits for this route and identify which stops are already done.
  // Locked stops are frozen at the top of the stop order in their current sequence;
  // only the remaining eligible stops are passed through the optimizer.
  const routeTz = company?.timezone ?? "America/New_York";
  const routeToday = getCompanyToday(routeTz);
  const todayVisits = await storage.getVisitsForDateRange(companyId, routeToday, routeToday);
  const todayRouteVisits = todayVisits.filter((v) => v.routeId === route.id && v.servicePlanId);
  const lockedPlanIds = new Set(
    todayRouteVisits
      .filter((v) => v.status === "completed" || v.status === "skipped")
      .map((v) => v.servicePlanId as string)
  );

  const lockedPlans = routePlans.filter((sp) => lockedPlanIds.has(sp.id));
  const eligiblePlans = routePlans.filter((sp) => !lockedPlanIds.has(sp.id));
  const hasMidDayLocks = lockedPlans.length > 0;

  // No-op guard: all stops are already completed/skipped today.
  if (hasMidDayLocks && eligiblePlans.length === 0) {
    return {
      success: true,
      message: `All stops on route "${route.name}" are already completed — nothing left to optimize.`,
      data: {
        routeId: route.id,
        routeName: route.name,
        stopsReordered: 0,
        milesSaved: 0,
        minutesSaved: 0,
        stopCount: routePlans.length,
        lockedCount: lockedPlans.length,
        allComplete: true,
      },
    };
  }

  // Only geocode-check and optimize the eligible (non-completed) stops.
  const plansToOptimize = hasMidDayLocks ? eligiblePlans : routePlans;

  const stops = plansToOptimize
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

  const ungeocoded = plansToOptimize.length - stops.length;
  if (stops.length < 2) {
    // Mid-day case: all eligible stops are geocoded but there is only 0 or 1 left —
    // no reordering is possible. Write orders for locked stops and the single eligible
    // stop (if present), then return success instead of a geocode failure.
    if (hasMidDayLocks && ungeocoded === 0) {
      for (let i = 0; i < lockedPlans.length; i++) {
        await storage.updateServicePlan(lockedPlans[i].id, companyId, { stopOrder: i + 1 });
      }
      if (stops.length === 1) {
        await storage.updateServicePlan(stops[0].id, companyId, {
          stopOrder: lockedPlans.length + 1,
        });
      }
      return {
        success: true,
        message:
          stops.length === 0
            ? `All stops on route "${route.name}" are already completed — nothing left to optimize.`
            : `Route "${route.name}" has only one remaining stop — nothing left to re-optimize (${lockedPlans.length} completed stop${lockedPlans.length !== 1 ? "s" : ""} preserved).`,
        data: {
          routeId: route.id,
          routeName: route.name,
          stopsReordered: 0,
          milesSaved: 0,
          minutesSaved: 0,
          stopCount: routePlans.length,
          lockedCount: lockedPlans.length,
          order: [...lockedPlans.map((sp) => sp.id), ...stops.map((s) => s.id)],
        },
      };
    }

    // Otherwise (non-mid-day, or geocoding truly failed): report the failure.
    const geocodedIds = new Set(stops.map((s) => s.id));
    const allContacts = await storage.getContacts(companyId);
    const contactMap = new Map(allContacts.map((c) => [c.id, c]));
    const failedStops = plansToOptimize
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
      message: `${ungeocoded} of ${plansToOptimize.length} eligible stops could not be geocoded. Ensure addresses are complete.`,
      error: "GEOCODE_FAILURE",
      data: { stopCount: plansToOptimize.length, geocodedCount: stops.length, failedStops },
    };
  }

  // --- Determine start point(s) for the optimizer ---
  //
  // Mid-day mode: use only the last completed/skipped stop's coordinates as the
  // forced start point. This ensures the remaining stops are ordered from where the
  // technician actually is, not from the depot. Fall through to the normal multi-
  // candidate logic only if no locked stop has valid coordinates.
  //
  // Normal mode: collect all valid depot/tech/company candidates (multi-start).
  const candidateStarts: { latitude: number; longitude: number }[] = [];

  if (hasMidDayLocks) {
    // Build a lookup from servicePlanId → today's visit status for locked stops.
    // Skipped stops are excluded: the technician never physically visited them,
    // so their location is not a meaningful "current position" anchor.
    const lockedVisitStatus = new Map(
      todayRouteVisits
        .filter((v) => lockedPlanIds.has(v.servicePlanId as string))
        .map((v) => [v.servicePlanId as string, v.status])
    );

    // Walk locked plans in reverse stopOrder (most recent first) and find the
    // last stop whose visit is specifically "completed" and has valid coordinates.
    for (let i = lockedPlans.length - 1; i >= 0; i--) {
      if (lockedVisitStatus.get(lockedPlans[i].id) !== "completed") continue;
      const prop = propertyMap.get(lockedPlans[i].propertyId);
      if (prop?.latitude && prop?.longitude) {
        // Single forced start — do NOT add depot/company candidates alongside it.
        candidateStarts.push({
          latitude: parseFloat(String(prop.latitude)),
          longitude: parseFloat(String(prop.longitude)),
        });
        break;
      }
    }
    // If no completed stop had valid coordinates, fall through to normal candidates below.
  }

  if (candidateStarts.length === 0) {
    // Normal / fallback path: collect depot, technician, and company start candidates.
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

  // Locked stops keep their positions (1..lockedPlans.length); eligible stops follow.
  const lockedOffset = lockedPlans.length;
  if (hasMidDayLocks) {
    for (let i = 0; i < lockedPlans.length; i++) {
      await storage.updateServicePlan(lockedPlans[i].id, companyId, { stopOrder: i + 1 });
    }
  }
  for (let i = 0; i < orderedIds.length; i++) {
    await storage.updateServicePlan(orderedIds[i], companyId, { stopOrder: lockedOffset + i + 1 });
  }

  // Plans without coordinates go after all optimized stops.
  const plansWithoutCoords = plansToOptimize.filter((sp) => {
    const prop = propertyMap.get(sp.propertyId);
    return !prop || !prop.latitude || !prop.longitude;
  });
  for (const plan of plansWithoutCoords) {
    await storage.updateServicePlan(plan.id, companyId, {
      stopOrder: lockedOffset + orderedIds.length + 1,
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

  const fullOrderIds = [...lockedPlans.map((sp) => sp.id), ...orderedIds];

  let message: string;
  if (stopsReordered === 0 && milesSaved === 0 && minutesSaved === 0) {
    if (hasMidDayLocks) {
      message = `Route "${route.name}" was already optimal for remaining stops — ${lockedPlans.length} completed stop${lockedPlans.length !== 1 ? "s" : ""} preserved in place.`;
    } else {
      message = `Route "${route.name}" was already optimal — no changes made.`;
    }
  } else {
    const parts: string[] = [
      `Optimized route "${route.name}" — reordered ${stopsReordered} stop${stopsReordered !== 1 ? "s" : ""}`,
    ];
    if (hasMidDayLocks) {
      parts[0] += ` (${lockedPlans.length} completed stop${lockedPlans.length !== 1 ? "s" : ""} preserved)`;
    }
    if (milesSaved > 0) parts.push(`saving ${milesSaved} mile${milesSaved !== 1 ? "s" : ""}`);
    if (minutesSaved > 0)
      parts.push(`and about ${minutesSaved} minute${minutesSaved !== 1 ? "s" : ""} of drive time`);
    message = parts.join(", ") + ".";
  }

  return {
    success: true,
    message,
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
      lockedCount: lockedPlans.length,
      hasStartPoint: !!startPoint,
      routingEngine,
      lastOptimizedAt: new Date().toISOString(),
      optimizedStopHash: stopHash,
      order: fullOrderIds,
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
