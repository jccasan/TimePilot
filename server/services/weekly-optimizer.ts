import {
  haversineDistance,
  optimizeRoute,
  buildChunkedDistMap,
  ROUTE_MATRIX_LIMIT,
} from "./route-optimizer";

type TimeDistMap = Map<string, Map<string, number>>;

async function fetchDistMapForStops(
  stops: { id: string; latitude: number; longitude: number }[],
  startPoint?: { latitude: number; longitude: number }
): Promise<TimeDistMap | undefined> {
  if (stops.length < 1 || stops.length > ROUTE_MATRIX_LIMIT) return undefined;
  return buildChunkedDistMap(stops, startPoint);
}

export interface WeeklyStop {
  id: string;
  servicePlanId: string;
  contactId: string;
  contactName: string;
  propertyId: string;
  address: string;
  latitude: number;
  longitude: number;
  currentDay: string;
  currentRouteId: string | null;
  currentStopOrder: number;
  zipCode: string | null;
}

export interface ProposedRoute {
  routeLabel: string;
  day: string;
  stops: WeeklyStop[];
  estimatedMiles: number;
  estimatedMinutes: number;
  stopCount: number;
}

export interface DayProposal {
  day: string;
  routes: ProposedRoute[];
  totalStops: number;
  totalMiles: number;
  totalMinutes: number;
}

export interface WeeklyOptimizationResult {
  current: {
    days: DayProposal[];
    totalMiles: number;
    totalMinutes: number;
    totalStops: number;
  };
  proposed: {
    days: DayProposal[];
    totalMiles: number;
    totalMinutes: number;
    totalStops: number;
  };
  improvementPct: number;
  milesSaved: number;
  minutesSaved: number;
  movedStops: { stopId: string; fromDay: string; toDay: string; contactName: string }[];
  creditsRequired: number;
}

interface StartPoint {
  latitude: number;
  longitude: number;
}

const WORK_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const ALL_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MAX_STOPS_PER_ROUTE = 50;
const MIN_STOPS_FOR_OWN_DAY = 3;

interface ZoneMapping {
  zipCode: string;
  dayOfWeek: string;
}

function centroid(stops: WeeklyStop[]): { lat: number; lon: number } {
  if (stops.length === 0) return { lat: 0, lon: 0 };
  const sumLat = stops.reduce((s, st) => s + st.latitude, 0);
  const sumLon = stops.reduce((s, st) => s + st.longitude, 0);
  return { lat: sumLat / stops.length, lon: sumLon / stops.length };
}

function assignToNearestCentroid(
  stop: WeeklyStop,
  centroids: { lat: number; lon: number }[]
): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < centroids.length; i++) {
    const d = haversineDistance(stop.latitude, stop.longitude, centroids[i].lat, centroids[i].lon);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function kmeansPlusPlusSeeds(stops: WeeklyStop[], k: number): { lat: number; lon: number }[] {
  const overall = centroid(stops);

  let maxDist = -1;
  let firstIdx = 0;
  for (let i = 0; i < stops.length; i++) {
    const d = haversineDistance(stops[i].latitude, stops[i].longitude, overall.lat, overall.lon);
    if (d > maxDist) {
      maxDist = d;
      firstIdx = i;
    }
  }

  const seeds: { lat: number; lon: number }[] = [
    { lat: stops[firstIdx].latitude, lon: stops[firstIdx].longitude },
  ];

  while (seeds.length < k) {
    let maxMinDist = -1;
    let nextIdx = 0;
    for (let i = 0; i < stops.length; i++) {
      let minDist = Infinity;
      for (const seed of seeds) {
        const d = haversineDistance(stops[i].latitude, stops[i].longitude, seed.lat, seed.lon);
        if (d < minDist) minDist = d;
      }
      if (minDist > maxMinDist) {
        maxMinDist = minDist;
        nextIdx = i;
      }
    }
    seeds.push({ lat: stops[nextIdx].latitude, lon: stops[nextIdx].longitude });
  }

  return seeds;
}

export function kMeansClustering(
  stops: WeeklyStop[],
  k: number,
  maxIter: number = 20
): WeeklyStop[][] {
  if (stops.length <= k) {
    return stops.map((s) => [s]);
  }

  const indices = new Array(stops.length).fill(0);

  let centroids: { lat: number; lon: number }[] = kmeansPlusPlusSeeds(stops, k);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < stops.length; i++) {
      const newCluster = assignToNearestCentroid(stops[i], centroids);
      if (newCluster !== indices[i]) {
        indices[i] = newCluster;
        changed = true;
      }
    }
    if (!changed) break;

    centroids = [];
    for (let c = 0; c < k; c++) {
      const clusterStops = stops.filter((_, idx) => indices[idx] === c);
      if (clusterStops.length === 0) {
        centroids.push({ lat: 0, lon: 0 });
      } else {
        centroids.push(centroid(clusterStops));
      }
    }
  }

  const clusters: WeeklyStop[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < stops.length; i++) {
    clusters[indices[i]].push(stops[i]);
  }
  return clusters.filter((c) => c.length > 0);
}

async function computeDayMetrics(
  stops: WeeklyStop[],
  startPoint?: StartPoint
): Promise<{ miles: number; minutes: number }> {
  if (stops.length === 0) return { miles: 0, minutes: 0 };
  if (stops.length === 1) {
    if (startPoint) {
      const d = haversineDistance(
        startPoint.latitude,
        startPoint.longitude,
        stops[0].latitude,
        stops[0].longitude
      );
      return { miles: Math.round(d * 10) / 10, minutes: Math.round((d / 25) * 60) };
    }
    return { miles: 0, minutes: 0 };
  }

  const routeStops = stops.map((s) => ({
    id: s.servicePlanId,
    latitude: s.latitude,
    longitude: s.longitude,
  }));

  const distMap = await fetchDistMapForStops(routeStops, startPoint);
  const result = optimizeRoute(routeStops, startPoint, distMap);
  const miles = Math.round(result.totalDistance * 10) / 10;
  const minutes = Math.round((result.totalDistance / 25) * 60);
  return { miles, minutes };
}

async function splitIntoSubRoutes(
  stops: WeeklyStop[],
  day: string,
  startPoint?: StartPoint,
  maxStops: number = MAX_STOPS_PER_ROUTE,
  minRoutes: number = 1
): Promise<ProposedRoute[]> {
  if (stops.length === 0) return [];

  const numByMax = Math.ceil(stops.length / maxStops);
  const numRoutes = Math.max(minRoutes, numByMax);

  if (numRoutes <= 1) {
    const optimizedStops = await optimizeStopOrder(stops, startPoint);
    const metrics = await computeDayMetrics(optimizedStops, startPoint);
    return [
      {
        routeLabel: `${capitalize(day)} Route`,
        day,
        stops: optimizedStops,
        estimatedMiles: metrics.miles,
        estimatedMinutes: metrics.minutes,
        stopCount: optimizedStops.length,
      },
    ];
  }

  const clusters = kMeansClustering(stops, numRoutes);

  return Promise.all(
    clusters.map(async (cluster, idx) => {
      const label =
        clusters.length > 1
          ? `${capitalize(day)} Route ${String.fromCharCode(65 + idx)}`
          : `${capitalize(day)} Route`;
      const optimizedStops = await optimizeStopOrder(cluster, startPoint);
      const metrics = await computeDayMetrics(optimizedStops, startPoint);
      return {
        routeLabel: label,
        day,
        stops: optimizedStops,
        estimatedMiles: metrics.miles,
        estimatedMinutes: metrics.minutes,
        stopCount: optimizedStops.length,
      };
    })
  );
}

async function optimizeStopOrder(
  stops: WeeklyStop[],
  startPoint?: StartPoint
): Promise<WeeklyStop[]> {
  if (stops.length <= 1) return stops;

  const routeStops = stops.map((s) => ({
    id: s.servicePlanId,
    latitude: s.latitude,
    longitude: s.longitude,
  }));

  const distMap = await fetchDistMapForStops(routeStops, startPoint);
  const result = optimizeRoute(routeStops, startPoint, distMap);
  const orderMap = new Map(result.orderedIds.map((id, idx) => [id, idx]));
  return [...stops].sort(
    (a, b) => (orderMap.get(a.servicePlanId) ?? 0) - (orderMap.get(b.servicePlanId) ?? 0)
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function analyzeWeeklySchedule(
  stops: WeeklyStop[],
  startPoint?: StartPoint,
  options: {
    respectZones?: boolean;
    zones?: ZoneMapping[];
    includeSaturday?: boolean;
    maxStopsPerDay?: number;
    numTechs?: number;
  } = {}
): Promise<WeeklyOptimizationResult> {
  const {
    respectZones = false,
    zones = [],
    includeSaturday = false,
    maxStopsPerDay,
    numTechs,
  } = options;
  const activeDays = includeSaturday ? ALL_DAYS : WORK_DAYS;
  const minRoutesPerDay = numTechs && numTechs > 1 ? numTechs : 1;

  const currentByDay = new Map<string, WeeklyStop[]>();
  for (const day of activeDays) {
    currentByDay.set(day, []);
  }
  for (const stop of stops) {
    const day =
      stop.currentDay && activeDays.includes(stop.currentDay) ? stop.currentDay : "monday";
    currentByDay.get(day)!.push(stop);
  }

  const currentDays: DayProposal[] = [];
  let currentTotalMiles = 0;
  let currentTotalMinutes = 0;

  for (const day of activeDays) {
    const dayStops = currentByDay.get(day) || [];
    const routes = await splitIntoSubRoutes(
      dayStops,
      day,
      startPoint,
      maxStopsPerDay,
      minRoutesPerDay
    );
    const totalMiles = routes.reduce((s, r) => s + r.estimatedMiles, 0);
    const totalMinutes = routes.reduce((s, r) => s + r.estimatedMinutes, 0);
    currentDays.push({
      day,
      routes,
      totalStops: dayStops.length,
      totalMiles: Math.round(totalMiles * 10) / 10,
      totalMinutes: Math.round(totalMinutes),
    });
    currentTotalMiles += totalMiles;
    currentTotalMinutes += totalMinutes;
  }

  const proposedDays: DayProposal[] = [];
  let proposedTotalMiles = 0;
  let proposedTotalMinutes = 0;
  const proposedStopDayMap = new Map<string, string>();

  if (respectZones && zones.length > 0) {
    const proposedByDay = assignByZones(stops, zones, activeDays);
    for (const day of activeDays) {
      const dayStops = proposedByDay.get(day) || [];
      for (const stop of dayStops) proposedStopDayMap.set(stop.servicePlanId, day);
      const routes = await splitIntoSubRoutes(
        dayStops,
        day,
        startPoint,
        maxStopsPerDay,
        minRoutesPerDay
      );
      const totalMiles = routes.reduce((s, r) => s + r.estimatedMiles, 0);
      const totalMinutes = routes.reduce((s, r) => s + r.estimatedMinutes, 0);
      proposedDays.push({
        day,
        routes,
        totalStops: dayStops.length,
        totalMiles: Math.round(totalMiles * 10) / 10,
        totalMinutes: Math.round(totalMinutes),
      });
      proposedTotalMiles += totalMiles;
      proposedTotalMinutes += totalMinutes;
    }
  } else {
    const clustersByDay = assignByGeoClustering(stops, activeDays, startPoint, maxStopsPerDay);
    for (const day of activeDays) {
      const dayClusters = clustersByDay.get(day) || [];
      const dayStops = dayClusters.flat();
      for (const stop of dayStops) proposedStopDayMap.set(stop.servicePlanId, day);

      // Distribute the day-level route budget across clusters proportionally by
      // stop count.  Each cluster always gets at least 1 route; remaining slots
      // (needed to meet the tech-count minimum) are given to the largest clusters.
      const dayTarget = Math.max(minRoutesPerDay, dayClusters.length);
      const clusterMin = dayClusters.map(() => 1);
      let remaining = dayTarget - dayClusters.length;
      if (remaining > 0 && dayClusters.length > 0) {
        // Round-robin, largest clusters first, until all slots are distributed.
        const sorted = dayClusters
          .map((c, i) => ({ i, len: c.length }))
          .sort((a, b) => b.len - a.len);
        let si = 0;
        while (remaining > 0) {
          clusterMin[sorted[si % sorted.length].i]++;
          remaining--;
          si++;
        }
      }

      const routes: ProposedRoute[] = [];
      for (let ci = 0; ci < dayClusters.length; ci++) {
        const subRoutes = await splitIntoSubRoutes(
          dayClusters[ci],
          day,
          startPoint,
          maxStopsPerDay,
          clusterMin[ci]
        );
        routes.push(...subRoutes);
      }

      if (routes.length > 1) {
        routes.forEach((r, idx) => {
          r.routeLabel = `${capitalize(day)} Route ${String.fromCharCode(65 + idx)}`;
        });
      }

      const totalMiles = routes.reduce((s, r) => s + r.estimatedMiles, 0);
      const totalMinutes = routes.reduce((s, r) => s + r.estimatedMinutes, 0);
      proposedDays.push({
        day,
        routes,
        totalStops: dayStops.length,
        totalMiles: Math.round(totalMiles * 10) / 10,
        totalMinutes: Math.round(totalMinutes),
      });
      proposedTotalMiles += totalMiles;
      proposedTotalMinutes += totalMinutes;
    }
  }

  const movedStops: { stopId: string; fromDay: string; toDay: string; contactName: string }[] = [];
  for (const stop of stops) {
    const origDay =
      stop.currentDay && activeDays.includes(stop.currentDay) ? stop.currentDay : "monday";
    const newDay = proposedStopDayMap.get(stop.servicePlanId) ?? origDay;
    if (origDay !== newDay) {
      movedStops.push({
        stopId: stop.servicePlanId,
        fromDay: origDay,
        toDay: newDay,
        contactName: stop.contactName,
      });
    }
  }

  const totalRoutes = proposedDays.reduce((s, d) => s + d.routes.length, 0);

  const milesSaved = Math.round((currentTotalMiles - proposedTotalMiles) * 10) / 10;
  const minutesSaved = Math.round(currentTotalMinutes - proposedTotalMinutes);
  const improvementPct =
    currentTotalMiles > 0
      ? Math.round(((currentTotalMiles - proposedTotalMiles) / currentTotalMiles) * 1000) / 10
      : 0;

  return {
    current: {
      days: currentDays,
      totalMiles: Math.round(currentTotalMiles * 10) / 10,
      totalMinutes: Math.round(currentTotalMinutes),
      totalStops: stops.length,
    },
    proposed: {
      days: proposedDays,
      totalMiles: Math.round(proposedTotalMiles * 10) / 10,
      totalMinutes: Math.round(proposedTotalMinutes),
      totalStops: stops.length,
    },
    improvementPct: Math.max(0, improvementPct),
    milesSaved: Math.max(0, milesSaved),
    minutesSaved: Math.max(0, minutesSaved),
    movedStops,
    creditsRequired: totalRoutes,
  };
}

function assignByZones(
  stops: WeeklyStop[],
  zones: ZoneMapping[],
  activeDays: string[]
): Map<string, WeeklyStop[]> {
  const result = new Map<string, WeeklyStop[]>();
  for (const day of activeDays) {
    result.set(day, []);
  }

  const zoneMap = new Map<string, string>();
  for (const z of zones) {
    if (activeDays.includes(z.dayOfWeek)) {
      zoneMap.set(z.zipCode, z.dayOfWeek);
    }
  }

  const unassigned: WeeklyStop[] = [];
  for (const stop of stops) {
    const zonedDay = stop.zipCode ? zoneMap.get(stop.zipCode) : null;
    if (zonedDay && activeDays.includes(zonedDay)) {
      result.get(zonedDay)!.push(stop);
    } else {
      unassigned.push(stop);
    }
  }

  if (unassigned.length > 0) {
    const dayCounts = activeDays.map((d) => ({ day: d, count: result.get(d)!.length }));
    for (const stop of unassigned) {
      dayCounts.sort((a, b) => a.count - b.count);
      const targetDay = dayCounts[0].day;
      result.get(targetDay)!.push(stop);
      dayCounts[0].count++;
    }
  }

  return result;
}

function totalIntraClusterDistance(clusters: WeeklyStop[][]): number {
  let total = 0;
  for (const cluster of clusters) {
    if (cluster.length === 0) continue;
    const c = centroid(cluster);
    for (const stop of cluster) {
      total += haversineDistance(stop.latitude, stop.longitude, c.lat, c.lon);
    }
  }
  return total;
}

function findOptimalK(stops: WeeklyStop[], maxK: number): number {
  if (stops.length <= 1) return 1;
  if (maxK <= 1) return 1;

  const effectiveMax = Math.min(maxK, stops.length);

  const d1 = totalIntraClusterDistance(kMeansClustering(stops, 1));
  if (d1 === 0) return 1;

  const GAIN_THRESHOLD = 0.1;

  let prevDist = d1;
  let optK = 1;

  for (let k = 2; k <= effectiveMax; k++) {
    const clusters = kMeansClustering(stops, k);
    const dist = totalIntraClusterDistance(clusters);
    const gain = (prevDist - dist) / d1;
    if (gain < GAIN_THRESHOLD) break;
    optK = k;
    prevDist = dist;
  }

  return optK;
}

/**
 * Merge any cluster smaller than minSize into its nearest neighbor (by
 * centroid-to-centroid distance). Runs repeatedly until no undersized cluster
 * remains or only one cluster is left.
 */
function mergeSmallClusters(clusters: WeeklyStop[][], minSize: number): WeeklyStop[][] {
  if (clusters.length <= 1) return clusters;

  let result = [...clusters];
  let changed = true;

  while (changed && result.length > 1) {
    changed = false;
    const smallIdx = result.findIndex((c) => c.length < minSize);
    if (smallIdx === -1) break;

    const smallCentroid = centroid(result[smallIdx]);
    let nearestIdx = -1;
    let nearestDist = Infinity;

    for (let i = 0; i < result.length; i++) {
      if (i === smallIdx) continue;
      const c = centroid(result[i]);
      const d = haversineDistance(smallCentroid.lat, smallCentroid.lon, c.lat, c.lon);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }

    if (nearestIdx === -1) break;
    result[nearestIdx] = [...result[nearestIdx], ...result[smallIdx]];
    result.splice(smallIdx, 1);
    changed = true;
  }

  return result;
}

function assignByGeoClustering(
  stops: WeeklyStop[],
  activeDays: string[],
  startPoint?: StartPoint,
  maxStopsPerDay?: number
): Map<string, WeeklyStop[][]> {
  const result = new Map<string, WeeklyStop[][]>();
  for (const day of activeDays) {
    result.set(day, []);
  }

  if (stops.length === 0) return result;

  const stopsPerRoute = maxStopsPerDay && maxStopsPerDay > 0 ? maxStopsPerDay : MAX_STOPS_PER_ROUTE;
  const techsPerDay = Math.ceil(stops.length / stopsPerRoute / activeDays.length) || 1;
  const maxK = activeDays.length * Math.max(1, techsPerDay);

  const optK = findOptimalK(stops, maxK);
  let clusters = kMeansClustering(stops, optK);

  // Absorb clusters that are too small to stand alone as a day's route.
  // Threshold scales with route size: ~1/3 of the average stops-per-day,
  // floored at MIN_STOPS_FOR_OWN_DAY so tiny companies aren't over-merged.
  const avgStopsPerDay = stops.length / activeDays.length;
  const minClusterSize = Math.max(MIN_STOPS_FOR_OWN_DAY, Math.floor(avgStopsPerDay * 0.33));
  clusters = mergeSmallClusters(clusters, minClusterSize);

  const orderedClusters = startPoint
    ? [...clusters].sort((a, b) => {
        const ca = centroid(a);
        const cb = centroid(b);
        return (
          haversineDistance(startPoint.latitude, startPoint.longitude, ca.lat, ca.lon) -
          haversineDistance(startPoint.latitude, startPoint.longitude, cb.lat, cb.lon)
        );
      })
    : clusters;

  const usedDayCount = Math.min(orderedClusters.length, activeDays.length);
  const usedDays = activeDays.slice(0, usedDayCount);

  for (let i = 0; i < orderedClusters.length; i++) {
    const dayIdx = i % usedDays.length;
    result.get(usedDays[dayIdx])!.push(orderedClusters[i]);
  }

  return result;
}

export interface NewStopInput {
  planId: string;
  propertyId: string;
  dayOfWeek: string;
  lat: number | null;
  lng: number | null;
}

export interface ExistingRouteInfo {
  id: string;
  name: string;
  dayOfWeek: string;
  stopCount: number;
  stopCoords: { lat: number; lng: number }[];
}

export interface RouteAssignment {
  planId: string;
  routeId: string;
  routeName: string;
  day: string;
  isNewRoute: boolean;
}

export interface AssignStopsResult {
  assignments: RouteAssignment[];
  newRoutes: { id: string; name: string; day: string }[];
}

const MAX_STOPS_PER_ROUTE_ASSIGN = 50;

export async function assignNewStopsToRoutes(
  newStops: NewStopInput[],
  existingRoutes: ExistingRouteInfo[],
  createRouteFn: (name: string, day: string) => Promise<{ id: string; name: string }>,
  maxStops: number = MAX_STOPS_PER_ROUTE_ASSIGN
): Promise<AssignStopsResult> {
  const routeMap = new Map<string, ExistingRouteInfo & { mutable: true }>(
    existingRoutes.map((r) => [r.id, { ...r, mutable: true as const }])
  );
  const newRoutes: { id: string; name: string; day: string }[] = [];
  const assignments: RouteAssignment[] = [];

  const stopsByDay = new Map<string, NewStopInput[]>();
  for (const stop of newStops) {
    if (!stopsByDay.has(stop.dayOfWeek)) stopsByDay.set(stop.dayOfWeek, []);
    stopsByDay.get(stop.dayOfWeek)!.push(stop);
  }

  for (const [day, dayStops] of stopsByDay) {
    const dayRoutes = [...routeMap.values()].filter((r) => r.dayOfWeek === day);
    const dayNewRouteCount = { count: 0 };

    for (const stop of dayStops) {
      let bestRouteId: string | null = null;

      if (stop.lat !== null && stop.lng !== null) {
        let bestDist = Infinity;
        for (const route of dayRoutes) {
          if (route.stopCount >= maxStops) continue;
          if (route.stopCoords.length === 0) {
            if (bestDist === Infinity) bestRouteId = route.id;
            continue;
          }
          const centLat = route.stopCoords.reduce((s, c) => s + c.lat, 0) / route.stopCoords.length;
          const centLng = route.stopCoords.reduce((s, c) => s + c.lng, 0) / route.stopCoords.length;
          const dist = haversineDistance(stop.lat, stop.lng, centLat, centLng);
          if (dist < bestDist) {
            bestDist = dist;
            bestRouteId = route.id;
          }
        }
      } else {
        const leastFull = dayRoutes
          .filter((r) => r.stopCount < maxStops)
          .sort((a, b) => a.stopCount - b.stopCount)[0];
        if (leastFull) bestRouteId = leastFull.id;
      }

      if (!bestRouteId) {
        const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);
        const existingTotal = dayRoutes.length;
        const suffix =
          existingTotal > 0 || dayNewRouteCount.count > 0
            ? ` ${String.fromCharCode(65 + dayNewRouteCount.count)}`
            : "";
        const newName = `${dayLabel} Route${suffix}`;
        const created = await createRouteFn(newName, day);
        dayNewRouteCount.count++;
        const newRouteInfo: ExistingRouteInfo & { mutable: true } = {
          id: created.id,
          name: created.name,
          dayOfWeek: day,
          stopCount: 0,
          stopCoords: [],
          mutable: true,
        };
        routeMap.set(created.id, newRouteInfo);
        dayRoutes.push(newRouteInfo);
        newRoutes.push({ id: created.id, name: created.name, day });
        bestRouteId = created.id;
      }

      const chosenRoute = routeMap.get(bestRouteId)!;
      chosenRoute.stopCount++;
      if (stop.lat !== null && stop.lng !== null) {
        chosenRoute.stopCoords.push({ lat: stop.lat, lng: stop.lng });
      }

      assignments.push({
        planId: stop.planId,
        routeId: bestRouteId,
        routeName: chosenRoute.name,
        day,
        isNewRoute: newRoutes.some((r) => r.id === bestRouteId),
      });
    }
  }

  return { assignments, newRoutes };
}
