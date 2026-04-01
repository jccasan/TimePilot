import { haversineDistance, optimizeRoute } from "./route-optimizer";

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
const MAX_STOPS_PER_ROUTE = 25;
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

function kMeansClustering(
  stops: WeeklyStop[],
  k: number,
  maxIter: number = 20
): WeeklyStop[][] {
  if (stops.length <= k) {
    return stops.map(s => [s]);
  }

  const indices = new Array(stops.length).fill(0);
  const step = Math.floor(stops.length / k);
  const sorted = [...stops].sort((a, b) => a.latitude - b.latitude || a.longitude - b.longitude);

  let centroids: { lat: number; lon: number }[] = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.min(i * step, sorted.length - 1);
    centroids.push({ lat: sorted[idx].latitude, lon: sorted[idx].longitude });
  }

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
  return clusters.filter(c => c.length > 0);
}

function computeDayMetrics(
  stops: WeeklyStop[],
  startPoint?: StartPoint
): { miles: number; minutes: number } {
  if (stops.length === 0) return { miles: 0, minutes: 0 };
  if (stops.length === 1) {
    if (startPoint) {
      const d = haversineDistance(startPoint.latitude, startPoint.longitude, stops[0].latitude, stops[0].longitude);
      return { miles: Math.round(d * 10) / 10, minutes: Math.round((d / 25) * 60) };
    }
    return { miles: 0, minutes: 0 };
  }

  const routeStops = stops.map(s => ({
    id: s.servicePlanId,
    latitude: s.latitude,
    longitude: s.longitude,
  }));

  const result = optimizeRoute(routeStops, startPoint);
  const miles = Math.round(result.totalDistance * 10) / 10;
  const minutes = Math.round((result.totalDistance / 25) * 60);
  return { miles, minutes };
}

function splitIntoSubRoutes(
  stops: WeeklyStop[],
  day: string,
  startPoint?: StartPoint
): ProposedRoute[] {
  if (stops.length === 0) return [];

  if (stops.length <= MAX_STOPS_PER_ROUTE) {
    const optimizedStops = optimizeStopOrder(stops, startPoint);
    const metrics = computeDayMetrics(optimizedStops, startPoint);
    return [{
      routeLabel: `${capitalize(day)} Route`,
      day,
      stops: optimizedStops,
      estimatedMiles: metrics.miles,
      estimatedMinutes: metrics.minutes,
      stopCount: optimizedStops.length,
    }];
  }

  const numRoutes = Math.ceil(stops.length / MAX_STOPS_PER_ROUTE);
  const clusters = kMeansClustering(stops, numRoutes);

  return clusters.map((cluster, idx) => {
    const label = clusters.length > 1
      ? `${capitalize(day)} Route ${String.fromCharCode(65 + idx)}`
      : `${capitalize(day)} Route`;
    const optimizedStops = optimizeStopOrder(cluster, startPoint);
    const metrics = computeDayMetrics(optimizedStops, startPoint);
    return {
      routeLabel: label,
      day,
      stops: optimizedStops,
      estimatedMiles: metrics.miles,
      estimatedMinutes: metrics.minutes,
      stopCount: optimizedStops.length,
    };
  });
}

function optimizeStopOrder(stops: WeeklyStop[], startPoint?: StartPoint): WeeklyStop[] {
  if (stops.length <= 1) return stops;

  const routeStops = stops.map(s => ({
    id: s.servicePlanId,
    latitude: s.latitude,
    longitude: s.longitude,
  }));

  const result = optimizeRoute(routeStops, startPoint);
  const orderMap = new Map(result.orderedIds.map((id, idx) => [id, idx]));
  return [...stops].sort((a, b) => (orderMap.get(a.servicePlanId) ?? 0) - (orderMap.get(b.servicePlanId) ?? 0));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function analyzeWeeklySchedule(
  stops: WeeklyStop[],
  startPoint?: StartPoint,
  options: {
    respectZones?: boolean;
    zones?: ZoneMapping[];
    includeSaturday?: boolean;
  } = {}
): WeeklyOptimizationResult {
  const { respectZones = false, zones = [], includeSaturday = false } = options;
  const activeDays = includeSaturday ? ALL_DAYS : WORK_DAYS;

  const currentByDay = new Map<string, WeeklyStop[]>();
  for (const day of activeDays) {
    currentByDay.set(day, []);
  }
  for (const stop of stops) {
    const day = stop.currentDay && activeDays.includes(stop.currentDay) ? stop.currentDay : "monday";
    currentByDay.get(day)!.push(stop);
  }

  const currentDays: DayProposal[] = [];
  let currentTotalMiles = 0;
  let currentTotalMinutes = 0;

  for (const day of activeDays) {
    const dayStops = currentByDay.get(day) || [];
    const routes = splitIntoSubRoutes(dayStops, day, startPoint);
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

  let proposedByDay: Map<string, WeeklyStop[]>;

  if (respectZones && zones.length > 0) {
    proposedByDay = assignByZones(stops, zones, activeDays);
  } else {
    proposedByDay = assignByGeoClustering(stops, activeDays, startPoint);
  }

  const proposedDays: DayProposal[] = [];
  let proposedTotalMiles = 0;
  let proposedTotalMinutes = 0;

  for (const day of activeDays) {
    const dayStops = proposedByDay.get(day) || [];
    const routes = splitIntoSubRoutes(dayStops, day, startPoint);
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

  const movedStops: { stopId: string; fromDay: string; toDay: string; contactName: string }[] = [];
  for (const day of activeDays) {
    const dayStops = proposedByDay.get(day) || [];
    for (const stop of dayStops) {
      const origDay = stop.currentDay && activeDays.includes(stop.currentDay) ? stop.currentDay : "monday";
      if (origDay !== day) {
        movedStops.push({
          stopId: stop.servicePlanId,
          fromDay: origDay,
          toDay: day,
          contactName: stop.contactName,
        });
      }
    }
  }

  const totalRoutes = proposedDays.reduce((s, d) => s + d.routes.length, 0);

  const milesSaved = Math.round((currentTotalMiles - proposedTotalMiles) * 10) / 10;
  const minutesSaved = Math.round(currentTotalMinutes - proposedTotalMinutes);
  const improvementPct = currentTotalMiles > 0
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
    const dayCounts = activeDays.map(d => ({ day: d, count: result.get(d)!.length }));
    for (const stop of unassigned) {
      dayCounts.sort((a, b) => a.count - b.count);
      const targetDay = dayCounts[0].day;
      result.get(targetDay)!.push(stop);
      dayCounts[0].count++;
    }
  }

  return result;
}

function assignByGeoClustering(
  stops: WeeklyStop[],
  activeDays: string[],
  startPoint?: StartPoint
): Map<string, WeeklyStop[]> {
  const result = new Map<string, WeeklyStop[]>();
  for (const day of activeDays) {
    result.set(day, []);
  }

  if (stops.length === 0) return result;

  const numDays = Math.min(activeDays.length, Math.max(1, Math.ceil(stops.length / MIN_STOPS_FOR_OWN_DAY)));
  const usedDays = activeDays.slice(0, numDays);

  const clusters = kMeansClustering(stops, numDays);

  if (startPoint) {
    const clusterCentroids = clusters.map(c => centroid(c));
    const sortedIndices = clusterCentroids
      .map((c, i) => ({ idx: i, dist: haversineDistance(startPoint.latitude, startPoint.longitude, c.lat, c.lon) }))
      .sort((a, b) => a.dist - b.dist)
      .map(x => x.idx);

    for (let i = 0; i < sortedIndices.length; i++) {
      const dayIdx = i % usedDays.length;
      const cluster = clusters[sortedIndices[i]];
      result.get(usedDays[dayIdx])!.push(...cluster);
    }
  } else {
    for (let i = 0; i < clusters.length; i++) {
      const dayIdx = i % usedDays.length;
      result.get(usedDays[dayIdx])!.push(...clusters[i]);
    }
  }

  return result;
}
