// Top-level route planner.
//
// Pipeline (per planning week):
//   due customers
//   -> routable / excluded / needsLocationReview split
//   -> rough geographic clustering (Haversine only)
//   -> candidate planned routes (one per cluster)
//   -> stop-order optimization (Mapbox if available, else nearest-neighbor)
//   -> per-leg drive time + miles via cache, Mapbox only on misses
//   -> economics + stop-level allocation
//   -> warnings/recommendations
//   -> over-time route splitting
//   -> underutilized route merging (when feasible AND profitable)
//   -> scoring
//
// The planner never commits assignments. It produces drafts the owner reviews.

import { clusterStopsByGeography } from "./clustering";
import {
  buildPlanningWindow,
  getPlanningStartDate,
  getWeekDateRange,
  parseIsoDate,
  toIsoDate,
} from "./dateUtils";
import { getDueCustomers, splitRoutableCustomers } from "./dateFilters";
import { haversineMiles, type LatLng } from "./geoUtils";
import {
  annotateStopsWithLegCosts,
  buildPlannedRouteFromBreakdown,
  calculateRouteDuration,
} from "./routeDuration";
import {
  calculateRouteEconomics,
  calculateStopLevelProfitability,
  deriveRouteWarningsAndRecommendations,
} from "./routeEconomics";
import { calculateRouteScore } from "./routeScoring";
import { computeStabilityContext } from "./routeStability";
import type { RoutingProvider } from "./routingProvider";
import type { TravelLegCacheService } from "./travelLegCache";
import type {
  Customer,
  ExcludedCustomer,
  FourWeekPlanResult,
  FourWeekSummary,
  NewCustomerAssignmentResult,
  PlannedRoute,
  PlanningWeek,
  PlanningWeekSummary,
  RoutePlannerSettings,
  RouteStop,
  WeeklyPlanResult,
} from "./types";

let routeIdCounter = 0;
function nextRouteId(weekNumber: number): string {
  routeIdCounter += 1;
  return `route_w${weekNumber}_${routeIdCounter}_${Date.now().toString(36)}`;
}

function customersToStops(customers: Customer[], settings: RoutePlannerSettings): RouteStop[] {
  return customers.map((c, i) => {
    const lat = (c.latitude ?? c.location?.latitude) as number;
    const lng = (c.longitude ?? c.location?.longitude) as number;
    const serviceMinutes =
      settings.allowCustomerServiceTimeOverride && c.estimatedServiceMinutes
        ? c.estimatedServiceMinutes
        : settings.defaultServiceMinutesPerStop;
    return {
      customerId: c.id,
      customerName: c.name,
      latitude: lat,
      longitude: lng,
      serviceMinutes,
      revenuePerVisit: c.revenuePerVisit,
      stopOrder: i + 1,
    };
  });
}

async function buildRouteFromStops(
  stops: RouteStop[],
  settings: RoutePlannerSettings,
  routingProvider: RoutingProvider,
  cache: TravelLegCacheService,
  weekNumber: number,
  weekStartDate: string,
  weekEndDate: string
): Promise<PlannedRoute> {
  // 1. Optimize stop order (Mapbox optimization or nearest-neighbor fallback).
  const startLatLng: LatLng | undefined = settings.companyStartLocation
    ? {
        latitude: settings.companyStartLocation.latitude,
        longitude: settings.companyStartLocation.longitude,
      }
    : undefined;
  const ordered = await routingProvider.optimizeStopOrder(stops, startLatLng);

  // 2. Per-leg time/distance via cache (Mapbox on misses).
  const breakdown = await calculateRouteDuration(ordered, settings, routingProvider, cache);

  // 3. Stop-level cost allocation + advisory profitability.
  const annotated = annotateStopsWithLegCosts(ordered, breakdown, settings);
  const stopsWithProfit = calculateStopLevelProfitability(annotated, settings);

  // 4. Route economics.
  const economics = calculateRouteEconomics(
    {
      assignedStops: stopsWithProfit,
      totalServiceMinutes: breakdown.totalServiceMinutes,
      totalDriveMinutes: breakdown.totalDriveMinutes,
      totalRouteMinutes: breakdown.totalRouteMinutes,
      estimatedMiles: breakdown.estimatedMiles,
    },
    settings
  );

  const id = nextRouteId(weekNumber);
  const partial = buildPlannedRouteFromBreakdown(
    {
      id,
      routeName: `Week ${weekNumber} Route ${id.slice(-6)}`,
      planningWeekNumber: weekNumber,
      weekStartDate,
      weekEndDate,
      startLocation: settings.companyStartLocation,
      routeCostMode: settings.routeCostMode,
      assignedStops: stopsWithProfit,
      revenue: economics.revenue,
      serviceLaborCost: economics.serviceLaborCost,
      driveLaborCost: economics.driveLaborCost,
      fuelCost: economics.fuelCost,
      vehicleCost: economics.vehicleCost,
      grossProfit: economics.grossProfit,
      profitMargin: economics.profitMargin,
      revenuePerRouteHour: economics.revenuePerRouteHour,
      stopsPerMile: economics.stopsPerMile,
      revenuePerMile: economics.revenuePerMile,
      routeScore: 0,
      profitabilityScore: 0,
      feasibilityStatus: "feasible",
      warnings: [],
      recommendations: [],
      optimizationNotes: [],
      status: "draft",
    },
    breakdown
  );

  // 5. Warnings + feasibility status.
  const wr = deriveRouteWarningsAndRecommendations(partial, settings);
  partial.warnings = wr.warnings;
  partial.recommendations = wr.recommendations;
  partial.feasibilityStatus = computeFeasibility(partial, settings);
  return partial;
}

function computeFeasibility(
  route: PlannedRoute,
  settings: RoutePlannerSettings
): PlannedRoute["feasibilityStatus"] {
  const overHard =
    route.totalRouteMinutes >
    settings.hardMaxRouteMinutes +
      (settings.allowTimeOverride ? (settings.maxAllowedTimeOverrideMinutes ?? 0) : 0);
  if (overHard) return "infeasible";
  if (
    settings.useStopCountAsHardConstraint &&
    route.stopCount > settings.unusualStopCountThreshold
  ) {
    return "infeasible";
  }
  if (route.warnings.length > 0) return "feasible_with_warnings";
  return "feasible";
}

// Split routes that exceed hardMaxRouteMinutes into two halves by stop order.
async function splitOvertimeRoutes(
  routes: PlannedRoute[],
  settings: RoutePlannerSettings,
  routingProvider: RoutingProvider,
  cache: TravelLegCacheService
): Promise<PlannedRoute[]> {
  const out: PlannedRoute[] = [];
  for (const r of routes) {
    const overHard = r.totalRouteMinutes > settings.hardMaxRouteMinutes;
    if (!overHard || settings.allowTimeOverride) {
      out.push(r);
      continue;
    }
    if (r.assignedStops.length < 2) {
      out.push(r);
      continue;
    }
    const mid = Math.ceil(r.assignedStops.length / 2);
    const a = r.assignedStops.slice(0, mid).map((s, i) => ({ ...s, stopOrder: i + 1 }));
    const b = r.assignedStops.slice(mid).map((s, i) => ({ ...s, stopOrder: i + 1 }));
    const ra = await buildRouteFromStops(
      a,
      settings,
      routingProvider,
      cache,
      r.planningWeekNumber,
      r.weekStartDate,
      r.weekEndDate
    );
    const rb = await buildRouteFromStops(
      b,
      settings,
      routingProvider,
      cache,
      r.planningWeekNumber,
      r.weekStartDate,
      r.weekEndDate
    );
    ra.optimizationNotes = [...(ra.optimizationNotes ?? []), `split_from:${r.id}`];
    rb.optimizationNotes = [...(rb.optimizationNotes ?? []), `split_from:${r.id}`];
    out.push(ra, rb);
  }
  return out;
}

// Merge nearby underutilized routes when the merge stays under hardMax and
// gross profit improves (or holds).
async function mergeUnderutilizedRoutes(
  routes: PlannedRoute[],
  settings: RoutePlannerSettings,
  routingProvider: RoutingProvider,
  cache: TravelLegCacheService
): Promise<PlannedRoute[]> {
  const merged: PlannedRoute[] = [];
  const consumed = new Set<string>();
  // Sort small routes first so they get a chance to merge into bigger nearby ones.
  const sorted = [...routes].sort((a, b) => a.totalRouteMinutes - b.totalRouteMinutes);

  for (const small of sorted) {
    if (consumed.has(small.id)) continue;
    // A route is underutilized if it falls short on time OR below the minimum stop count.
    const belowTimeTarget = small.totalRouteMinutes < settings.targetMinRouteMinutes;
    const belowStopFloor =
      settings.minStopsPerRoute !== undefined && small.stopCount < settings.minStopsPerRoute;
    if (!belowTimeTarget && !belowStopFloor) {
      merged.push(small);
      continue;
    }
    // Find the nearest other route by centroid.
    const smallCentroid = centroidOfStops(small.assignedStops);
    let bestPartner: PlannedRoute | undefined;
    let bestDist = Infinity;
    for (const other of sorted) {
      if (other.id === small.id || consumed.has(other.id)) continue;
      const otherCentroid = centroidOfStops(other.assignedStops);
      const d = haversineMiles(smallCentroid, otherCentroid);
      if (d < bestDist) {
        bestDist = d;
        bestPartner = other;
      }
    }
    if (!bestPartner) {
      merged.push(small);
      continue;
    }
    const candidateStops = [...bestPartner.assignedStops, ...small.assignedStops].map((s, i) => ({
      ...s,
      stopOrder: i + 1,
    }));
    const trial = await buildRouteFromStops(
      candidateStops,
      settings,
      routingProvider,
      cache,
      small.planningWeekNumber,
      small.weekStartDate,
      small.weekEndDate
    );
    const overHard = trial.totalRouteMinutes > settings.hardMaxRouteMinutes;
    const profitable = trial.grossProfit >= small.grossProfit + bestPartner.grossProfit - 1; // small slack
    if (!overHard && profitable) {
      trial.optimizationNotes = [
        ...(trial.optimizationNotes ?? []),
        `merged_from:${small.id}+${bestPartner.id}`,
      ];
      merged.push(trial);
      consumed.add(small.id);
      consumed.add(bestPartner.id);
    } else {
      merged.push(small);
    }
  }
  // Add anything that wasn't consumed.
  for (const r of sorted) {
    if (!consumed.has(r.id) && !merged.includes(r)) merged.push(r);
  }
  // De-duplicate by id (defensive).
  const seen = new Set<string>();
  return merged.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

function centroidOfStops(stops: RouteStop[]): LatLng {
  if (stops.length === 0) return { latitude: 0, longitude: 0 };
  let lat = 0;
  let lng = 0;
  for (const s of stops) {
    lat += s.latitude;
    lng += s.longitude;
  }
  return { latitude: lat / stops.length, longitude: lng / stops.length };
}

function summarizeWeek(
  routes: PlannedRoute[],
  excludedCount: number,
  needsReviewCount: number
): PlanningWeekSummary {
  const stopCount = routes.reduce((s, r) => s + r.stopCount, 0);
  const totalRouteMinutes = routes.reduce((s, r) => s + r.totalRouteMinutes, 0);
  const totalRevenue = routes.reduce((s, r) => s + r.revenue, 0);
  const totalGrossProfit = routes.reduce((s, r) => s + r.grossProfit, 0);
  const avgMargin =
    routes.length > 0 ? routes.reduce((s, r) => s + r.profitMargin, 0) / routes.length : 0;
  return {
    routeCount: routes.length,
    stopCount,
    totalRouteMinutes,
    totalRevenue,
    totalGrossProfit,
    averageProfitMargin: avgMargin,
    excludedCount,
    needsReviewCount,
  };
}

export async function planWeeklyRoutes(
  customers: Customer[],
  settings: RoutePlannerSettings,
  weekStartDate: Date,
  weekEndDate: Date,
  routingProvider: RoutingProvider,
  cache: TravelLegCacheService,
  weekNumber = 1
): Promise<WeeklyPlanResult> {
  const warnings: string[] = [];

  const due = getDueCustomers(customers, weekStartDate, weekEndDate);
  const split = splitRoutableCustomers(due);

  // 1. Cluster.
  const clusters = clusterStopsByGeography(split.routableCustomers, settings);

  // 2. Build planned routes.
  let routes: PlannedRoute[] = [];
  for (const cluster of clusters) {
    const stops = customersToStops(cluster.customers, settings);
    if (stops.length === 0) continue;
    const r = await buildRouteFromStops(
      stops,
      settings,
      routingProvider,
      cache,
      weekNumber,
      toIsoDate(weekStartDate),
      toIsoDate(weekEndDate)
    );
    routes.push(r);
  }

  // 3. Split overtime, then merge underutilized.
  routes = await splitOvertimeRoutes(routes, settings, routingProvider, cache);
  routes = await mergeUnderutilizedRoutes(routes, settings, routingProvider, cache);

  // 4. Stability + scoring.
  const stability = computeStabilityContext(customers, routes);
  const expectedMinRoutes = Math.max(
    1,
    Math.ceil(
      split.routableCustomers.reduce(
        (acc, c) =>
          acc +
          (settings.allowCustomerServiceTimeOverride && c.estimatedServiceMinutes
            ? c.estimatedServiceMinutes
            : settings.defaultServiceMinutesPerStop),
        0
      ) / settings.targetMaxRouteMinutes
    )
  );
  for (const r of routes) {
    const score = calculateRouteScore(r, settings, {
      totalRoutesPlanned: routes.length,
      expectedMinRoutes,
      movedCustomerIds: stability.movedCustomerIds,
    });
    r.routeScore = score.routeScore;
    r.profitabilityScore = score.profitabilityScore;
    r.optimizationNotes = [...(r.optimizationNotes ?? []), ...score.notes];
  }

  if (stability.lockedViolated > 0) {
    warnings.push(
      `${stability.lockedViolated} routeLock customers were moved. Review before approval.`
    );
  }
  if (split.needsLocationReview.length > 0) {
    warnings.push(
      `${split.needsLocationReview.length} customers need location review and were excluded.`
    );
  }
  if (routes.some((r) => r.estimatedFallback)) {
    warnings.push(
      "MAPBOX_ACCESS_TOKEN not used or Mapbox failed for some legs — fallback estimates were used."
    );
  }

  const summary = summarizeWeek(
    routes,
    split.excludedCustomers.length,
    split.needsLocationReview.length
  );

  return {
    weekNumber,
    weekStartDate: toIsoDate(weekStartDate),
    weekEndDate: toIsoDate(weekEndDate),
    plannedRoutes: routes,
    summary,
    excludedCustomers: split.excludedCustomers,
    needsLocationReview: split.needsLocationReview,
    warnings,
  };
}

export async function planFourWeekRoutes(
  customers: Customer[],
  settings: RoutePlannerSettings,
  todayDate: Date,
  routingProvider: RoutingProvider,
  cache: TravelLegCacheService
): Promise<FourWeekPlanResult> {
  const startDate = getPlanningStartDate(todayDate, settings);
  const window = buildPlanningWindow(startDate, settings.planningWeeks);

  const allWarnings: string[] = [];
  const excludedSeen = new Map<string, ExcludedCustomer>();
  const reviewSeen = new Map<string, ExcludedCustomer>();

  const filledWeeks: PlanningWeek[] = [];
  for (let i = 0; i < window.weeks.length; i++) {
    const w = window.weeks[i];
    const { start, end } = getWeekDateRange(parseIsoDate(window.startDate), i);
    const weekly = await planWeeklyRoutes(
      customers,
      settings,
      start,
      end,
      routingProvider,
      cache,
      i + 1
    );

    for (const ex of weekly.excludedCustomers) excludedSeen.set(ex.customerId, ex);
    for (const nr of weekly.needsLocationReview) reviewSeen.set(nr.customerId, nr);
    allWarnings.push(...weekly.warnings.map((m) => `Week ${i + 1}: ${m}`));

    const due = getDueCustomers(customers, start, end);
    const split = splitRoutableCustomers(due);

    filledWeeks.push({
      ...w,
      dueCustomers: due,
      routableCustomers: split.routableCustomers,
      excludedCustomers: weekly.excludedCustomers,
      plannedRoutes: weekly.plannedRoutes,
      summary: weekly.summary,
    });
  }

  const fourWeekSummary: FourWeekSummary = {
    totalRoutes: filledWeeks.reduce((s, w) => s + w.plannedRoutes.length, 0),
    totalStops: filledWeeks.reduce(
      (s, w) => s + w.plannedRoutes.reduce((a, r) => a + r.stopCount, 0),
      0
    ),
    totalRouteMinutes: filledWeeks.reduce(
      (s, w) => s + w.plannedRoutes.reduce((a, r) => a + r.totalRouteMinutes, 0),
      0
    ),
    totalRevenue: filledWeeks.reduce(
      (s, w) => s + w.plannedRoutes.reduce((a, r) => a + r.revenue, 0),
      0
    ),
    totalGrossProfit: filledWeeks.reduce(
      (s, w) => s + w.plannedRoutes.reduce((a, r) => a + r.grossProfit, 0),
      0
    ),
    averageProfitMargin: averageMargin(filledWeeks),
    weeksPlanned: filledWeeks.length,
  };

  return {
    planningWindow: { ...window, weeks: filledWeeks },
    fourWeekSummary,
    needsLocationReview: Array.from(reviewSeen.values()),
    excludedCustomers: Array.from(excludedSeen.values()),
    warnings: allWarnings,
  };
}

function averageMargin(weeks: PlanningWeek[]): number {
  let total = 0;
  let count = 0;
  for (const w of weeks) {
    for (const r of w.plannedRoutes) {
      total += r.profitMargin;
      count += 1;
    }
  }
  return count > 0 ? total / count : 0;
}

// New customer assignment — never rebuilds existing routes from scratch.
export async function assignNewCustomerToBestRoute(
  newCustomer: Customer,
  existingRoutes: PlannedRoute[],
  settings: RoutePlannerSettings,
  routingProvider: RoutingProvider,
  cache: TravelLegCacheService
): Promise<NewCustomerAssignmentResult> {
  const warnings: string[] = [];
  const lat = newCustomer.latitude ?? newCustomer.location?.latitude;
  const lng = newCustomer.longitude ?? newCustomer.location?.longitude;

  if (
    lat === undefined ||
    lng === undefined ||
    newCustomer.location?.needsLocationReview ||
    newCustomer.location?.coordinateSource === "missing" ||
    newCustomer.location?.coordinateSource === "failed"
  ) {
    return {
      addedDriveMinutes: 0,
      addedMiles: 0,
      addedLaborCost: 0,
      addedFuelCost: 0,
      addedRevenue: 0,
      profitImpact: 0,
      warnings: ["new_customer_missing_or_unconfirmed_coordinates"],
      needsManualRouteAssignment: true,
      candidateRoutesReviewed: 0,
    };
  }
  const newPoint: LatLng = { latitude: lat, longitude: lng };

  // Step 1: nearest-neighbor across all existing stops to surface candidate routes.
  const candidates = new Map<
    string,
    { route: PlannedRoute; nearestStopId: string; nearestDist: number }
  >();
  for (const route of existingRoutes) {
    let best = Infinity;
    let bestStopId = "";
    for (const s of route.assignedStops) {
      const d = haversineMiles(newPoint, s);
      if (d < best) {
        best = d;
        bestStopId = s.customerId;
      }
    }
    if (Number.isFinite(best)) {
      candidates.set(route.id, { route, nearestStopId: bestStopId, nearestDist: best });
    }
  }

  // Keep only the top 5 nearest candidates to bound work + Mapbox cost.
  const topCandidates = Array.from(candidates.values())
    .sort((a, b) => a.nearestDist - b.nearestDist)
    .slice(0, 5);

  if (topCandidates.length === 0) {
    return {
      addedDriveMinutes: 0,
      addedMiles: 0,
      addedLaborCost: 0,
      addedFuelCost: 0,
      addedRevenue: newCustomer.revenuePerVisit,
      profitImpact: 0,
      warnings: ["no_existing_routes_to_consider"],
      needsManualRouteAssignment: true,
      candidateRoutesReviewed: 0,
    };
  }

  const newServiceMinutes =
    settings.allowCustomerServiceTimeOverride && newCustomer.estimatedServiceMinutes
      ? newCustomer.estimatedServiceMinutes
      : settings.defaultServiceMinutesPerStop;

  // Step 2: for each candidate route, find best insertion position and rebuild.
  let bestPick:
    | (NewCustomerAssignmentResult & { _routeId: string; _trial: PlannedRoute })
    | undefined;
  let nearestNeighborCustomerId: string | undefined;

  for (const cand of topCandidates) {
    let bestForRoute:
      | { trial: PlannedRoute; insertionIndex: number; addedTime: number; addedMiles: number }
      | undefined;

    for (let idx = 0; idx <= cand.route.assignedStops.length; idx++) {
      const trialStops: RouteStop[] = [
        ...cand.route.assignedStops.slice(0, idx),
        {
          customerId: newCustomer.id,
          customerName: newCustomer.name,
          latitude: lat,
          longitude: lng,
          serviceMinutes: newServiceMinutes,
          revenuePerVisit: newCustomer.revenuePerVisit,
          stopOrder: idx + 1,
        },
        ...cand.route.assignedStops.slice(idx),
      ].map((s, i) => ({ ...s, stopOrder: i + 1 }));

      const trial = await buildRouteFromStops(
        trialStops,
        settings,
        routingProvider,
        cache,
        cand.route.planningWeekNumber,
        cand.route.weekStartDate,
        cand.route.weekEndDate
      );

      const addedTime = trial.totalRouteMinutes - cand.route.totalRouteMinutes;
      const addedMiles = trial.estimatedMiles - cand.route.estimatedMiles;
      if (trial.totalRouteMinutes > settings.hardMaxRouteMinutes && !settings.allowTimeOverride) {
        continue;
      }
      if (!bestForRoute || addedTime < bestForRoute.addedTime) {
        bestForRoute = { trial, insertionIndex: idx, addedTime, addedMiles };
      }
    }
    if (!bestForRoute) continue;

    const addedLaborCost = (bestForRoute.addedTime / 60) * settings.laborCostPerHour;
    const addedFuelCost =
      bestForRoute.addedMiles *
      (settings.averageGasPricePerGallon / Math.max(1, settings.vehicleMilesPerGallon));
    const addedRevenue = newCustomer.revenuePerVisit;
    const profitImpact = addedRevenue - addedLaborCost - addedFuelCost;

    const candidateResult: NewCustomerAssignmentResult & {
      _routeId: string;
      _trial: PlannedRoute;
    } = {
      assignedRouteId: cand.route.id,
      insertionIndex: bestForRoute.insertionIndex,
      nearestNeighborCustomerId: cand.nearestStopId,
      addedDriveMinutes: bestForRoute.trial.totalDriveMinutes - cand.route.totalDriveMinutes,
      addedMiles: bestForRoute.addedMiles,
      addedLaborCost,
      addedFuelCost,
      addedRevenue,
      profitImpact,
      warnings: [],
      needsManualRouteAssignment: false,
      candidateRoutesReviewed: topCandidates.length,
      _routeId: cand.route.id,
      _trial: bestForRoute.trial,
    };

    nearestNeighborCustomerId = cand.nearestStopId;

    // Pick the insertion with the highest profit impact (ties break on time added).
    if (
      !bestPick ||
      candidateResult.profitImpact > bestPick.profitImpact ||
      (candidateResult.profitImpact === bestPick.profitImpact &&
        candidateResult.addedDriveMinutes < bestPick.addedDriveMinutes)
    ) {
      bestPick = candidateResult;
    }
  }

  if (!bestPick) {
    return {
      nearestNeighborCustomerId,
      addedDriveMinutes: 0,
      addedMiles: 0,
      addedLaborCost: 0,
      addedFuelCost: 0,
      addedRevenue: newCustomer.revenuePerVisit,
      profitImpact: -newCustomer.revenuePerVisit,
      warnings: [...warnings, "no_feasible_insertion_found"],
      needsManualRouteAssignment: true,
      candidateRoutesReviewed: topCandidates.length,
    };
  }

  // Exclude internal fields before returning.
  const { _routeId: _r, _trial: _t, ...result } = bestPick;
  void _r;
  void _t;
  return { ...result, warnings };
}
