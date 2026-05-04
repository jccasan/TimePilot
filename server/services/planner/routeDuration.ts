// Route duration math + cached travel-leg lookup.
// Mapbox is only called for legs that aren't in the cache.

import { defaultExpiry, type TravelLegCacheService } from "./travelLegCache";
import type { RoutingProvider } from "./routingProvider";
import type {
  CompanyLocation,
  PlannedRoute,
  RoutePlannerSettings,
  RouteStop,
  RoutingProfile,
  TravelLegCacheRecord,
} from "./types";
import type { LatLng } from "./geoUtils";

export interface RouteTimeBreakdown {
  officeToFirstStopDriveMinutes: number;
  stopToStopDriveMinutes: number;
  totalServiceMinutes: number;
  routeBufferMinutes: number;
  perStopBufferTotal: number;
  optionalReturnToOfficeDriveMinutes: number;
  totalDriveMinutes: number;
  totalRouteMinutes: number;
  estimatedMiles: number;
  perLegDriveMinutes: number[]; // index 0 = office->stop1; subsequent = stop_i -> stop_{i+1}
  perLegMiles: number[];
  estimatedFallback: boolean;
}

async function lookupLeg(
  origin: LatLng,
  destination: LatLng,
  profile: RoutingProfile,
  routingProvider: RoutingProvider,
  cache: TravelLegCacheService
): Promise<{ minutes: number; miles: number; fallback: boolean }> {
  const cached = await cache.get(origin, destination, profile);
  if (cached) {
    return {
      minutes: cached.durationMinutes,
      miles: cached.distanceMiles,
      fallback: cached.estimatedFallback,
    };
  }
  const minutes = await routingProvider.estimateDriveTime(origin, destination);
  const miles = await routingProvider.estimateDistance(origin, destination);
  const fallback = routingProvider.name === "fallback";
  const fetchedAt = new Date();
  const record: TravelLegCacheRecord = {
    cacheKey: cache.buildCacheKey(origin, destination, profile, 5),
    originLatitude: origin.latitude,
    originLongitude: origin.longitude,
    destinationLatitude: destination.latitude,
    destinationLongitude: destination.longitude,
    durationMinutes: minutes,
    distanceMiles: miles,
    provider: fallback ? "fallback" : "mapbox",
    profile,
    fetchedAt: fetchedAt.toISOString(),
    expiresAt: defaultExpiry(profile, fetchedAt).toISOString(),
    estimatedFallback: fallback,
  };
  await cache.set(record);
  return { minutes, miles, fallback };
}

export async function calculateRouteDuration(
  stops: RouteStop[],
  settings: RoutePlannerSettings,
  routingProvider: RoutingProvider,
  cache: TravelLegCacheService
): Promise<RouteTimeBreakdown> {
  const profile: RoutingProfile = settings.mapboxConfig?.profile ?? "driving";
  const office: CompanyLocation | undefined = settings.companyStartLocation;

  const perLegDriveMinutes: number[] = [];
  const perLegMiles: number[] = [];
  let stopToStopDriveMinutes = 0;
  let officeToFirstStopDriveMinutes = 0;
  let optionalReturnToOfficeDriveMinutes = 0;
  let estimatedMiles = 0;
  let anyFallback = false;

  if (office && settings.includeOfficeToFirstStop && stops.length > 0) {
    const first = stops[0];
    const leg = await lookupLeg(
      { latitude: office.latitude, longitude: office.longitude },
      { latitude: first.latitude, longitude: first.longitude },
      profile,
      routingProvider,
      cache
    );
    officeToFirstStopDriveMinutes = leg.minutes;
    estimatedMiles += leg.miles;
    anyFallback = anyFallback || leg.fallback;
    perLegDriveMinutes.push(leg.minutes);
    perLegMiles.push(leg.miles);
  } else {
    perLegDriveMinutes.push(0);
    perLegMiles.push(0);
  }

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const leg = await lookupLeg(
      { latitude: a.latitude, longitude: a.longitude },
      { latitude: b.latitude, longitude: b.longitude },
      profile,
      routingProvider,
      cache
    );
    stopToStopDriveMinutes += leg.minutes;
    estimatedMiles += leg.miles;
    anyFallback = anyFallback || leg.fallback;
    perLegDriveMinutes.push(leg.minutes);
    perLegMiles.push(leg.miles);
  }

  if (office && settings.includeReturnToOffice && stops.length > 0) {
    const last = stops[stops.length - 1];
    const leg = await lookupLeg(
      { latitude: last.latitude, longitude: last.longitude },
      { latitude: office.latitude, longitude: office.longitude },
      profile,
      routingProvider,
      cache
    );
    optionalReturnToOfficeDriveMinutes = leg.minutes;
    estimatedMiles += leg.miles;
    anyFallback = anyFallback || leg.fallback;
    perLegDriveMinutes.push(leg.minutes);
    perLegMiles.push(leg.miles);
  }

  const totalServiceMinutes = stops.reduce((s, x) => s + x.serviceMinutes, 0);
  const routeBufferMinutes = settings.routeBufferMinutes;
  const perStopBufferTotal = settings.perStopBufferMinutes * stops.length;
  const totalDriveMinutes =
    officeToFirstStopDriveMinutes + stopToStopDriveMinutes + optionalReturnToOfficeDriveMinutes;
  const totalRouteMinutes =
    totalDriveMinutes + totalServiceMinutes + routeBufferMinutes + perStopBufferTotal;

  return {
    officeToFirstStopDriveMinutes,
    stopToStopDriveMinutes,
    totalServiceMinutes,
    routeBufferMinutes,
    perStopBufferTotal,
    optionalReturnToOfficeDriveMinutes,
    totalDriveMinutes,
    totalRouteMinutes,
    estimatedMiles,
    perLegDriveMinutes,
    perLegMiles,
    estimatedFallback: anyFallback,
  };
}

// Allocate drive minutes/miles to individual stops for stop-level profitability
// reporting. Each stop gets the leg that arrived at it.
export function annotateStopsWithLegCosts(
  stops: RouteStop[],
  breakdown: RouteTimeBreakdown,
  settings: RoutePlannerSettings
): RouteStop[] {
  const fuelPerMile =
    settings.averageGasPricePerGallon / Math.max(1, settings.vehicleMilesPerGallon);
  const laborPerMin = settings.laborCostPerHour / 60;

  return stops.map((stop, idx) => {
    // perLegDriveMinutes[0] = office->stop1; perLegDriveMinutes[idx+1] = arrival at stop idx+1.
    // For the first stop, the office leg counts toward it.
    const legDriveMinutes = breakdown.perLegDriveMinutes[idx] ?? 0;
    const legMiles = breakdown.perLegMiles[idx] ?? 0;
    return {
      ...stop,
      allocatedDriveMinutes: legDriveMinutes,
      allocatedDriveCost: legDriveMinutes * laborPerMin,
      allocatedFuelCost: legMiles * fuelPerMile,
    };
  });
}

export function buildPlannedRouteFromBreakdown(
  base: Omit<
    PlannedRoute,
    | "stopCount"
    | "totalServiceMinutes"
    | "totalDriveMinutes"
    | "totalBufferMinutes"
    | "totalRouteMinutes"
    | "estimatedMiles"
    | "estimatedFallback"
    | "driveMinutesPerStop"
  >,
  breakdown: RouteTimeBreakdown
): PlannedRoute {
  const stopCount = base.assignedStops.length;
  const totalBufferMinutes = breakdown.routeBufferMinutes + breakdown.perStopBufferTotal;
  return {
    ...base,
    stopCount,
    totalServiceMinutes: breakdown.totalServiceMinutes,
    totalDriveMinutes: breakdown.totalDriveMinutes,
    totalBufferMinutes,
    totalRouteMinutes: breakdown.totalRouteMinutes,
    estimatedMiles: breakdown.estimatedMiles,
    estimatedFallback: breakdown.estimatedFallback,
    driveMinutesPerStop: stopCount > 0 ? breakdown.totalDriveMinutes / stopCount : 0,
  };
}
