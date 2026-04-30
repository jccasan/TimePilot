import { trackApiCall } from "./api-usage";

interface Stop {
  id: string;
  latitude: number;
  longitude: number;
}

interface StartPoint {
  latitude: number;
  longitude: number;
}

// Keyed by stop ID; "__start__" is the reserved key for the start point.
type TimeDistMap = Map<string, Map<string, number>>;

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Fetch the Mapbox Matrix API (driving profile) for up to 25 coordinates.
 * Returns an N×N table of travel times in minutes, or null on failure.
 * Capped at 25 coords per call; callers should not pass more.
 */
export async function fetchDriveTimeMatrix(
  coords: { latitude: number; longitude: number }[]
): Promise<number[][] | null> {
  const token = process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_SECRET_TOKEN;
  if (!token || coords.length < 2 || coords.length > 25) return null;

  const coordStr = coords.map(c => `${c.longitude},${c.latitude}`).join(";");
  const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coordStr}?access_token=${token}&annotations=duration`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`[route-optimizer] Mapbox Matrix API returned ${res.status}, falling back to haversine`);
      return null;
    }
    const data = await res.json();
    if (!data.durations) return null;
    trackApiCall("mapbox", "matrix");
    // Convert seconds to minutes
    return (data.durations as number[][]).map(row => row.map(v => v / 60));
  } catch {
    console.log("[route-optimizer] Mapbox Matrix API error, falling back to haversine");
    return null;
  }
}

/**
 * Build a TimeDistMap from a raw N×N duration matrix (in minutes).
 * `ids` must have the same length as the matrix dimension.
 */
function buildTimeDistMap(ids: string[], matrix: number[][]): TimeDistMap {
  const map: TimeDistMap = new Map();
  for (let i = 0; i < ids.length; i++) {
    const inner = new Map<string, number>();
    for (let j = 0; j < ids.length; j++) {
      if (i !== j) inner.set(ids[j], matrix[i][j]);
    }
    map.set(ids[i], inner);
  }
  return map;
}

/** Look up drive-time distance between two stops; falls back to haversine. */
function getDist(
  fromId: string, fromLat: number, fromLon: number,
  toId: string, toLat: number, toLon: number,
  distMap?: TimeDistMap
): number {
  if (distMap) {
    const t = distMap.get(fromId)?.get(toId);
    if (t !== undefined) return t;
  }
  return haversineDistance(fromLat, fromLon, toLat, toLon);
}

const START_ID = "__start__";

function pathDistance(stops: Stop[], startPoint?: StartPoint, distMap?: TimeDistMap): number {
  let total = 0;
  if (startPoint && stops.length > 0) {
    total += getDist(START_ID, startPoint.latitude, startPoint.longitude,
      stops[0].id, stops[0].latitude, stops[0].longitude, distMap);
  }
  for (let i = 0; i < stops.length - 1; i++) {
    total += getDist(
      stops[i].id, stops[i].latitude, stops[i].longitude,
      stops[i + 1].id, stops[i + 1].latitude, stops[i + 1].longitude,
      distMap
    );
  }
  return total;
}

function nearestNeighbor(stops: Stop[], startPoint?: StartPoint, distMap?: TimeDistMap): Stop[] {
  if (stops.length <= 1) return stops;

  const remaining = [...stops];
  const result: Stop[] = [];

  let currentId: string;
  let currentLat: number;
  let currentLon: number;

  if (startPoint) {
    currentId = START_ID;
    currentLat = startPoint.latitude;
    currentLon = startPoint.longitude;
  } else {
    const first = remaining.shift()!;
    result.push(first);
    currentId = first.id;
    currentLat = first.latitude;
    currentLon = first.longitude;
  }

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const dist = getDist(currentId, currentLat, currentLon,
        remaining[i].id, remaining[i].latitude, remaining[i].longitude, distMap);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    const nearest = remaining.splice(nearestIdx, 1)[0];
    result.push(nearest);
    currentId = nearest.id;
    currentLat = nearest.latitude;
    currentLon = nearest.longitude;
  }

  return result;
}

function twoOptImprove(stops: Stop[], startPoint?: StartPoint, distMap?: TimeDistMap): Stop[] {
  if (stops.length <= 3) return stops;

  const order = [...stops];
  let bestDist = pathDistance(order, startPoint, distMap);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const reversed = order.slice(i, j + 1).reverse();
        const candidate = [...order.slice(0, i), ...reversed, ...order.slice(j + 1)];
        const candidateDist = pathDistance(candidate, startPoint, distMap);

        if (candidateDist < bestDist) {
          order.splice(0, order.length, ...candidate);
          bestDist = candidateDist;
          improved = true;
        }
      }
    }
  }

  return order;
}

export function calculateTotalDistance(stops: Stop[], startPoint?: StartPoint): number {
  return Math.round(pathDistance(stops, startPoint) * 100) / 100;
}

function nearestNeighborFromFirst(stops: Stop[], forcedFirst: Stop, distMap?: TimeDistMap): Stop[] {
  const result: Stop[] = [forcedFirst];
  const remaining = stops.filter(s => s.id !== forcedFirst.id);
  let currentId = forcedFirst.id;
  let currentLat = forcedFirst.latitude;
  let currentLon = forcedFirst.longitude;

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dist = getDist(currentId, currentLat, currentLon,
        remaining[i].id, remaining[i].latitude, remaining[i].longitude, distMap);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    const nearest = remaining.splice(nearestIdx, 1)[0];
    result.push(nearest);
    currentId = nearest.id;
    currentLat = nearest.latitude;
    currentLon = nearest.longitude;
  }

  return result;
}

export function optimizeRoute(
  stops: Stop[],
  startPoint?: StartPoint,
  distMap?: TimeDistMap
): { orderedIds: string[]; totalDistance: number } {
  if (stops.length <= 1) {
    return {
      orderedIds: stops.map(s => s.id),
      totalDistance: startPoint && stops.length === 1
        ? calculateTotalDistance(stops, startPoint)
        : 0,
    };
  }

  let bestOrder: Stop[] = [];
  let bestDist = Infinity;

  if (startPoint) {
    // Anchor: pick the stop with the shortest drive time from start as the forced first.
    let bestFirstIdx = 0;
    let bestFirstDist = Infinity;
    for (let i = 0; i < stops.length; i++) {
      const d = getDist(START_ID, startPoint.latitude, startPoint.longitude,
        stops[i].id, stops[i].latitude, stops[i].longitude, distMap);
      if (d < bestFirstDist) {
        bestFirstDist = d;
        bestFirstIdx = i;
      }
    }
    const forcedFirst = stops[bestFirstIdx];
    const nnOrder = nearestNeighborFromFirst(stops, forcedFirst, distMap);
    bestOrder = twoOptImprove(nnOrder, startPoint, distMap);
    bestDist = pathDistance(bestOrder, startPoint, distMap);
  } else {
    // No start point: try multiple starting indices and pick the best result.
    const MAX_STARTS = Math.min(stops.length, 12);
    const stepSize = Math.max(1, Math.floor(stops.length / MAX_STARTS));
    const seenIdxMap: Record<number, boolean> = {};
    const candidateIndices: number[] = [];
    for (let i = 0; i < MAX_STARTS; i++) {
      const idx = (i * stepSize) % stops.length;
      if (!seenIdxMap[idx]) {
        seenIdxMap[idx] = true;
        candidateIndices.push(idx);
      }
    }

    for (const startIdx of candidateIndices) {
      const rotated = [...stops.slice(startIdx), ...stops.slice(0, startIdx)];
      const nnOrder = nearestNeighbor(rotated, undefined, distMap);
      const improved = twoOptImprove(nnOrder, undefined, distMap);
      const dist = pathDistance(improved, undefined, distMap);
      if (dist < bestDist) {
        bestDist = dist;
        bestOrder = improved;
      }
    }

    const nnDefault = nearestNeighbor(stops, undefined, distMap);
    const improvedDefault = twoOptImprove(nnDefault, undefined, distMap);
    const distDefault = pathDistance(improvedDefault, undefined, distMap);
    if (distDefault < bestDist) {
      bestDist = distDefault;
      bestOrder = improvedDefault;
    }
  }

  return {
    orderedIds: bestOrder.map(s => s.id),
    totalDistance: Math.round(bestDist * 100) / 100,
  };
}

/**
 * Async version: fetches the Mapbox Matrix API for real drive times (when ≤25 stops),
 * then runs the optimizer using those times. Falls back to haversine silently.
 */
export async function optimizeRouteAsync(
  stops: Stop[],
  startPoint?: StartPoint
): Promise<{ orderedIds: string[]; totalDistance: number }> {
  let distMap: TimeDistMap | undefined;

  const MATRIX_LIMIT = 25;
  // Build coords list: start point first (if any), then stops
  const totalCoords = stops.length + (startPoint ? 1 : 0);

  if (totalCoords <= MATRIX_LIMIT) {
    const coords: { latitude: number; longitude: number }[] = [];
    if (startPoint) coords.push(startPoint);
    for (const s of stops) coords.push({ latitude: s.latitude, longitude: s.longitude });

    const matrix = await fetchDriveTimeMatrix(coords);
    if (matrix) {
      const ids: string[] = [];
      if (startPoint) ids.push(START_ID);
      for (const s of stops) ids.push(s.id);
      distMap = buildTimeDistMap(ids, matrix);
    }
  }
  // If no matrix (too many stops or API failure), distMap stays undefined → haversine fallback

  return optimizeRoute(stops, startPoint, distMap);
}

export async function fetchMapboxDirections(coordinates: { longitude: number; latitude: number }[]): Promise<{ distance: number; duration: number } | null> {
  const token = process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_SECRET_TOKEN;
  if (!token || coordinates.length < 2) return null;

  const MAX_COORDS = 25;
  let totalDistance = 0;
  let totalDuration = 0;

  if (coordinates.length <= MAX_COORDS) {
    const coordStr = coordinates.map(c => `${c.longitude},${c.latitude}`).join(";");
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?overview=false&access_token=${token}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`[route-optimizer] Mapbox Directions API returned ${res.status}, falling back to haversine`);
        return null;
      }
      const data = await res.json();
      const route = data.routes?.[0];
      if (!route) return null;
      trackApiCall("mapbox", "directions");
      return { distance: route.distance / 1609.34, duration: route.duration / 60 };
    } catch (err) {
      console.log("[route-optimizer] Mapbox Directions API error, falling back to haversine");
      return null;
    }
  }

  for (let i = 0; i < coordinates.length - 1; i += MAX_COORDS - 1) {
    const end = Math.min(i + MAX_COORDS, coordinates.length);
    const chunk = coordinates.slice(i, end);
    if (chunk.length < 2) break;

    const coordStr = chunk.map(c => `${c.longitude},${c.latitude}`).join(";");
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?overview=false&access_token=${token}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`[route-optimizer] Mapbox Directions API returned ${res.status} for chunk, falling back to haversine`);
        return null;
      }
      const data = await res.json();
      const route = data.routes?.[0];
      if (!route) return null;
      trackApiCall("mapbox", "directions");
      totalDistance += route.distance;
      totalDuration += route.duration;
    } catch {
      return null;
    }
  }

  return {
    distance: totalDistance / 1609.34,
    duration: totalDuration / 60,
  };
}

export interface RouteLeg {
  fromId: string | null;
  toId: string;
  distance: number;
  duration: number;
}

export interface RouteMetricsDetail {
  totalDistance: number;
  totalDuration: number;
  legs: RouteLeg[];
}

export async function fetchMapboxDirectionsWithLegs(
  coordinates: { longitude: number; latitude: number }[],
  stopIds: (string | null)[]
): Promise<RouteMetricsDetail | null> {
  const token = process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_SECRET_TOKEN;
  if (!token || coordinates.length < 2) return null;

  const coordStr = coordinates.map(c => `${c.longitude},${c.latitude}`).join(";");
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?overview=false&steps=false&access_token=${token}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) return null;

    trackApiCall("mapbox", "directions");
    const legs: RouteLeg[] = [];
    if (route.legs && Array.isArray(route.legs)) {
      for (let i = 0; i < route.legs.length; i++) {
        legs.push({
          fromId: stopIds[i],
          toId: (stopIds[i + 1] ?? stopIds[i])!,
          distance: route.legs[i].distance / 1609.34,
          duration: route.legs[i].duration / 60,
        });
      }
    }

    return {
      totalDistance: route.distance / 1609.34,
      totalDuration: route.duration / 60,
      legs,
    };
  } catch {
    return null;
  }
}

export async function getRouteMetricsWithLegs(
  stops: Stop[],
  startPoint?: StartPoint
): Promise<RouteMetricsDetail | null> {
  const coords: { longitude: number; latitude: number }[] = [];
  const ids: (string | null)[] = [];

  if (startPoint) {
    coords.push({ longitude: startPoint.longitude, latitude: startPoint.latitude });
    ids.push(null);
  }

  for (const stop of stops) {
    coords.push({ longitude: stop.longitude, latitude: stop.latitude });
    ids.push(stop.id);
  }

  if (coords.length < 2) return null;

  if (coords.length <= 25) {
    return fetchMapboxDirectionsWithLegs(coords, ids);
  }

  const legs: RouteLeg[] = [];
  let totalDistance = 0;
  let totalDuration = 0;

  for (let i = 0; i < coords.length - 1; i += 24) {
    const end = Math.min(i + 25, coords.length);
    const chunk = coords.slice(i, end);
    const chunkIds = ids.slice(i, end);
    if (chunk.length < 2) break;

    const result = await fetchMapboxDirectionsWithLegs(chunk, chunkIds);
    if (!result) return null;

    legs.push(...result.legs);
    totalDistance += result.totalDistance;
    totalDuration += result.totalDuration;
  }

  return { totalDistance, totalDuration, legs };
}

export async function getMapboxRouteMetrics(
  stops: Stop[],
  startPoint?: StartPoint
): Promise<{ distance: number; duration: number } | null> {
  const coords: { longitude: number; latitude: number }[] = [];

  if (startPoint) {
    coords.push({ longitude: startPoint.longitude, latitude: startPoint.latitude });
  }

  for (const stop of stops) {
    coords.push({ longitude: stop.longitude, latitude: stop.latitude });
  }

  if (coords.length < 2) return null;

  return fetchMapboxDirections(coords);
}
