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
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const RETRY_DELAYS_MS = [500, 1000, 2000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch the Mapbox Matrix API (driving profile) for up to 25 coordinates.
 * Returns an N×N table of travel times in minutes, or null on failure.
 * Capped at 25 coords per call; callers should not pass more.
 * Retries up to 3 times with exponential backoff on 429 responses.
 */
export async function fetchDriveTimeMatrix(
  coords: { latitude: number; longitude: number }[],
  companyId?: string | null
): Promise<number[][] | null> {
  const token = process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_SECRET_TOKEN;
  if (!token || coords.length < 2 || coords.length > 25) return null;

  const coordStr = coords.map((c) => `${c.longitude},${c.latitude}`).join(";");
  const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coordStr}?access_token=${token}&annotations=duration`;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        if (attempt < RETRY_DELAYS_MS.length) {
          console.log(
            `[route-optimizer] Mapbox Matrix API returned 429 (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1}), retrying in ${RETRY_DELAYS_MS[attempt]}ms`
          );
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        console.log(
          `[route-optimizer] Mapbox Matrix API returned 429 after ${RETRY_DELAYS_MS.length + 1} attempts, falling back to haversine`
        );
        return null;
      }
      if (!res.ok) {
        console.log(
          `[route-optimizer] Mapbox Matrix API returned ${res.status}, falling back to haversine`
        );
        return null;
      }
      const data = await res.json();
      if (!data.durations) return null;
      trackApiCall("mapbox", "matrix", 1, companyId);
      // Convert seconds to minutes
      return (data.durations as number[][]).map((row) => row.map((v) => v / 60));
    } catch {
      console.log("[route-optimizer] Mapbox Matrix API error, falling back to haversine");
      return null;
    }
  }

  return null;
}

/** Look up drive-time distance between two stops; falls back to haversine. */
function getDist(
  fromId: string,
  fromLat: number,
  fromLon: number,
  toId: string,
  toLat: number,
  toLon: number,
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
    total += getDist(
      START_ID,
      startPoint.latitude,
      startPoint.longitude,
      stops[0].id,
      stops[0].latitude,
      stops[0].longitude,
      distMap
    );
  }
  for (let i = 0; i < stops.length - 1; i++) {
    total += getDist(
      stops[i].id,
      stops[i].latitude,
      stops[i].longitude,
      stops[i + 1].id,
      stops[i + 1].latitude,
      stops[i + 1].longitude,
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
      const dist = getDist(
        currentId,
        currentLat,
        currentLon,
        remaining[i].id,
        remaining[i].latitude,
        remaining[i].longitude,
        distMap
      );
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
  const remaining = stops.filter((s) => s.id !== forcedFirst.id);
  let currentId = forcedFirst.id;
  let currentLat = forcedFirst.latitude;
  let currentLon = forcedFirst.longitude;

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dist = getDist(
        currentId,
        currentLat,
        currentLon,
        remaining[i].id,
        remaining[i].latitude,
        remaining[i].longitude,
        distMap
      );
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
      orderedIds: stops.map((s) => s.id),
      totalDistance:
        startPoint && stops.length === 1 ? calculateTotalDistance(stops, startPoint) : 0,
    };
  }

  let bestOrder: Stop[] = [];
  let bestDist = Infinity;

  if (startPoint) {
    // Anchor: pick the stop with the shortest drive time from start as the forced first.
    let bestFirstIdx = 0;
    let bestFirstDist = Infinity;
    for (let i = 0; i < stops.length; i++) {
      const d = getDist(
        START_ID,
        startPoint.latitude,
        startPoint.longitude,
        stops[i].id,
        stops[i].latitude,
        stops[i].longitude,
        distMap
      );
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
    orderedIds: bestOrder.map((s) => s.id),
    totalDistance: Math.round(bestDist * 100) / 100,
  };
}

/**
 * Build a TimeDistMap for up to ROUTE_MATRIX_LIMIT stops via Mapbox Matrix API.
 * The Mapbox Matrix API is capped at 25 coordinates per call, so for larger routes
 * we chunk: include the start point + up to 24 stops per chunk, merge the results.
 * - Start→stop and intra-chunk stop→stop edges: real driving time.
 * - Cross-chunk stop→stop edges: not populated (getDist falls back to haversine).
 * Returns { map: undefined, degraded: true } if the API is unavailable or any chunk fails
 * after retries. Returns { map: undefined, degraded: false } if no token is configured.
 */
export const ROUTE_MATRIX_LIMIT = 50;
const MAPBOX_MATRIX_CAP = 25; // Hard Mapbox API limit per call

export async function buildChunkedDistMap(
  stops: Stop[],
  startPoint?: StartPoint,
  companyId?: string | null
): Promise<{ map: TimeDistMap | undefined; degraded: boolean }> {
  if (stops.length < 1 || stops.length > ROUTE_MATRIX_LIMIT)
    return { map: undefined, degraded: false };
  const token = process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_SECRET_TOKEN;
  if (!token) return { map: undefined, degraded: false };

  const distMap: TimeDistMap = new Map();
  // Each chunk: start point (1 slot) + up to MAPBOX_MATRIX_CAP-1 stops
  const chunkSize = startPoint ? MAPBOX_MATRIX_CAP - 1 : MAPBOX_MATRIX_CAP;

  for (let i = 0; i < stops.length; i += chunkSize) {
    const chunk = stops.slice(i, i + chunkSize);
    const coords: { latitude: number; longitude: number }[] = [];
    const chunkIds: string[] = [];

    if (startPoint) {
      coords.push(startPoint);
      chunkIds.push(START_ID);
    }
    for (const s of chunk) {
      coords.push({ latitude: s.latitude, longitude: s.longitude });
      chunkIds.push(s.id);
    }
    if (coords.length < 2) break;

    const matrix = await fetchDriveTimeMatrix(coords, companyId);
    if (!matrix) return { map: undefined, degraded: true }; // Any chunk failure → full haversine fallback

    for (let ri = 0; ri < chunkIds.length; ri++) {
      if (!distMap.has(chunkIds[ri])) distMap.set(chunkIds[ri], new Map());
      for (let ci = 0; ci < chunkIds.length; ci++) {
        if (ri !== ci) distMap.get(chunkIds[ri])!.set(chunkIds[ci], matrix[ri][ci]);
      }
    }
  }

  return distMap.size > 0 ? { map: distMap, degraded: false } : { map: undefined, degraded: false };
}

/**
 * Async version: fetches the Mapbox Matrix API for real drive times (up to 50 stops),
 * then runs the optimizer using those times. Falls back to haversine when Mapbox
 * is unavailable after retries; sets degraded:true in that case.
 */
export async function optimizeRouteAsync(
  stops: Stop[],
  startPoint?: StartPoint,
  companyId?: string | null
): Promise<{ orderedIds: string[]; totalDistance: number; degraded: boolean }> {
  let distMap: TimeDistMap | undefined;
  let degraded = false;

  if (stops.length <= ROUTE_MATRIX_LIMIT) {
    const result = await buildChunkedDistMap(stops, startPoint, companyId);
    distMap = result.map;
    degraded = result.degraded;
  }

  return { ...optimizeRoute(stops, startPoint, distMap), degraded };
}

// ---------------------------------------------------------------------------
// Multi-start candidate optimization
// ---------------------------------------------------------------------------

/** Maximum number of candidate start locations evaluated per route optimization run. */
export const MAX_CANDIDATE_STARTS = 5;

/** Minimum haversine distance (miles) below which two candidates are considered duplicates. */
const CANDIDATE_DEDUP_MILES = 0.1;

/**
 * Removes near-duplicate candidate start points that are within
 * CANDIDATE_DEDUP_MILES of each other. Preserves order; keeps the first
 * occurrence of each unique location.
 */
export function deduplicateCandidates(candidates: StartPoint[]): StartPoint[] {
  const result: StartPoint[] = [];
  for (const c of candidates) {
    const isDup = result.some(
      (r) =>
        haversineDistance(c.latitude, c.longitude, r.latitude, r.longitude) < CANDIDATE_DEDUP_MILES
    );
    if (!isDup) result.push(c);
  }
  return result;
}

/**
 * If candidates exceed `max`, returns the `max` candidates closest to the
 * geographic centroid of the stops. Otherwise returns the input unchanged.
 */
export function selectCandidateStarts(
  candidates: StartPoint[],
  stops: Stop[],
  max: number = MAX_CANDIDATE_STARTS
): StartPoint[] {
  if (candidates.length <= max) return candidates;
  if (stops.length === 0) return candidates.slice(0, max);
  const cLat = stops.reduce((s, st) => s + st.latitude, 0) / stops.length;
  const cLon = stops.reduce((s, st) => s + st.longitude, 0) / stops.length;
  return [...candidates]
    .sort(
      (a, b) =>
        haversineDistance(a.latitude, a.longitude, cLat, cLon) -
        haversineDistance(b.latitude, b.longitude, cLat, cLon)
    )
    .slice(0, max);
}

/**
 * Creates a copy of `distMap` where all references to `candidateId` are
 * aliased to `__start__`. This lets the existing `optimizeRoute` (which
 * expects `__start__`) work transparently with a shared multi-candidate matrix.
 */
function aliasStartInDistMap(distMap: TimeDistMap, candidateId: string): TimeDistMap {
  if (candidateId === START_ID) return distMap;
  const aliased: TimeDistMap = new Map();
  for (const [from, toMap] of distMap) {
    const newToMap = new Map<string, number>();
    for (const [to, dist] of toMap) {
      newToMap.set(to === candidateId ? START_ID : to, dist);
    }
    aliased.set(from === candidateId ? START_ID : from, newToMap);
  }
  return aliased;
}

/**
 * Build a shared distance/time map that includes all stops PLUS all candidate
 * start points in the fewest possible Mapbox Matrix API calls.
 *
 * Candidate IDs in the returned map: `__start_0__`, `__start_1__`, …
 *
 * Candidates appear in every chunk so that candidate→stop and stop→candidate
 * drive-time edges are always populated from real data. Cross-chunk stop→stop
 * edges not covered by a chunk fall back to haversine inside `getDist`.
 */
export async function buildSharedDistMapMultiStart(
  stops: Stop[],
  candidateStarts: StartPoint[],
  companyId?: string | null
): Promise<{ map: TimeDistMap | undefined; degraded: boolean }> {
  if (candidateStarts.length === 0) {
    return buildChunkedDistMap(stops, undefined, companyId);
  }
  if (candidateStarts.length === 1) {
    return buildChunkedDistMap(stops, candidateStarts[0], companyId);
  }

  const token = process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_SECRET_TOKEN;
  if (!token) return { map: undefined, degraded: false };
  if (stops.length < 1 || stops.length > ROUTE_MATRIX_LIMIT) {
    return { map: undefined, degraded: false };
  }

  const candidateIds = candidateStarts.map((_, i) => `__start_${i}__`);
  const slotsForStops = MAPBOX_MATRIX_CAP - candidateStarts.length;

  if (slotsForStops < 2) {
    // Candidate list is too large to share a chunk — fall back to single-start.
    return buildChunkedDistMap(stops, candidateStarts[0], companyId);
  }

  const distMap: TimeDistMap = new Map();

  for (let i = 0; i < stops.length; i += slotsForStops) {
    const chunk = stops.slice(i, i + slotsForStops);
    const coords: { latitude: number; longitude: number }[] = [];
    const chunkIds: string[] = [];

    for (let ci = 0; ci < candidateStarts.length; ci++) {
      coords.push(candidateStarts[ci]);
      chunkIds.push(candidateIds[ci]);
    }
    for (const s of chunk) {
      coords.push({ latitude: s.latitude, longitude: s.longitude });
      chunkIds.push(s.id);
    }
    if (coords.length < 2) break;

    const matrix = await fetchDriveTimeMatrix(coords, companyId);
    if (!matrix) return { map: undefined, degraded: true };

    for (let ri = 0; ri < chunkIds.length; ri++) {
      if (!distMap.has(chunkIds[ri])) distMap.set(chunkIds[ri], new Map());
      for (let ci = 0; ci < chunkIds.length; ci++) {
        if (ri !== ci) distMap.get(chunkIds[ri])!.set(chunkIds[ci], matrix[ri][ci]);
      }
    }
  }

  return distMap.size > 0 ? { map: distMap, degraded: false } : { map: undefined, degraded: false };
}

/**
 * Evaluate each candidate start location using the shared distance map,
 * running the full nearest-neighbour + 2-opt sequence for each. Returns the
 * best (lowest total drive time) result including the winning start point.
 *
 * When `candidateStarts` is empty this falls back to the no-start-point
 * optimiser (multiple stop-index seeds).
 */
export function optimizeRouteMultiStart(
  stops: Stop[],
  candidateStarts: StartPoint[],
  distMap?: TimeDistMap
): { orderedIds: string[]; totalDistance: number; bestStart?: StartPoint } {
  if (candidateStarts.length === 0) {
    return optimizeRoute(stops, undefined, distMap);
  }
  if (candidateStarts.length === 1) {
    return { ...optimizeRoute(stops, candidateStarts[0], distMap), bestStart: candidateStarts[0] };
  }

  const candidateIds = candidateStarts.map((_, i) => `__start_${i}__`);
  let bestOrder: string[] = [];
  let bestDist = Infinity;
  let bestStartIdx = 0;

  for (let ci = 0; ci < candidateStarts.length; ci++) {
    const aliasedMap = distMap ? aliasStartInDistMap(distMap, candidateIds[ci]) : undefined;
    const result = optimizeRoute(stops, candidateStarts[ci], aliasedMap);
    if (result.totalDistance < bestDist) {
      bestDist = result.totalDistance;
      bestOrder = result.orderedIds;
      bestStartIdx = ci;
    }
  }

  return {
    orderedIds: bestOrder,
    totalDistance: Math.round(bestDist * 100) / 100,
    bestStart: candidateStarts[bestStartIdx],
  };
}

/**
 * Async multi-start optimizer: deduplicates and caps candidates, builds a
 * shared Mapbox matrix covering all stops + all candidates in the minimum
 * number of API calls, evaluates every candidate with nearest-neighbour +
 * 2-opt, and returns the best-scoring result.
 *
 * Falls back to the single-start async optimizer when only one candidate
 * remains after deduplication, and to the no-start-point optimizer when there
 * are none.
 */
export async function optimizeRouteAsyncMultiStart(
  stops: Stop[],
  candidateStarts: StartPoint[],
  companyId?: string | null
): Promise<{
  orderedIds: string[];
  totalDistance: number;
  degraded: boolean;
  bestStart?: StartPoint;
}> {
  const deduped = deduplicateCandidates(candidateStarts);
  const candidates = selectCandidateStarts(deduped, stops);

  if (candidates.length === 0) {
    return optimizeRouteAsync(stops, undefined, companyId);
  }
  if (candidates.length === 1) {
    const result = await optimizeRouteAsync(stops, candidates[0], companyId);
    return { ...result, bestStart: candidates[0] };
  }

  let distMap: TimeDistMap | undefined;
  let degraded = false;

  if (stops.length <= ROUTE_MATRIX_LIMIT) {
    const sharedResult = await buildSharedDistMapMultiStart(stops, candidates, companyId);
    distMap = sharedResult.map;
    degraded = sharedResult.degraded;
  }

  const result = optimizeRouteMultiStart(stops, candidates, distMap);
  return { ...result, degraded };
}

export async function fetchMapboxDirections(
  coordinates: { longitude: number; latitude: number }[],
  companyId?: string | null
): Promise<{ distance: number; duration: number } | null> {
  const token = process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_SECRET_TOKEN;
  if (!token || coordinates.length < 2) return null;

  const MAX_COORDS = 25;
  let totalDistance = 0;
  let totalDuration = 0;

  if (coordinates.length <= MAX_COORDS) {
    const coordStr = coordinates.map((c) => `${c.longitude},${c.latitude}`).join(";");
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?overview=false&access_token=${token}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(
          `[route-optimizer] Mapbox Directions API returned ${res.status}, falling back to haversine`
        );
        return null;
      }
      const data = await res.json();
      const route = data.routes?.[0];
      if (!route) return null;
      trackApiCall("mapbox", "directions", 1, companyId);
      return { distance: route.distance / 1609.34, duration: route.duration / 60 };
    } catch (_err) {
      console.log("[route-optimizer] Mapbox Directions API error, falling back to haversine");
      return null;
    }
  }

  for (let i = 0; i < coordinates.length - 1; i += MAX_COORDS - 1) {
    const end = Math.min(i + MAX_COORDS, coordinates.length);
    const chunk = coordinates.slice(i, end);
    if (chunk.length < 2) break;

    const coordStr = chunk.map((c) => `${c.longitude},${c.latitude}`).join(";");
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?overview=false&access_token=${token}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(
          `[route-optimizer] Mapbox Directions API returned ${res.status} for chunk, falling back to haversine`
        );
        return null;
      }
      const data = await res.json();
      const route = data.routes?.[0];
      if (!route) return null;
      trackApiCall("mapbox", "directions", 1, companyId);
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
  stopIds: (string | null)[],
  companyId?: string | null
): Promise<RouteMetricsDetail | null> {
  const token = process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_SECRET_TOKEN;
  if (!token || coordinates.length < 2) return null;

  const coordStr = coordinates.map((c) => `${c.longitude},${c.latitude}`).join(";");
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?overview=false&steps=false&access_token=${token}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) return null;

    trackApiCall("mapbox", "directions", 1, companyId);
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

/**
 * Cheapest-insertion heuristic: given an ordered sequence of stops on an already-
 * optimized route, returns the zero-based insertion index that minimises the extra
 * haversine distance added by the new stop.
 *
 * Edge cases:
 *  - 0 existing stops → return 0
 *  - 1 existing stop  → return 0 (either side adds the same distance; prepend)
 *  - Insertion before the first stop costs d(new, stops[0])
 *  - Insertion after the last stop costs d(stops[n-1], new)
 *  - Insertion between i and i+1 costs d(i, new) + d(new, i+1) − d(i, i+1)
 */
export function cheapestInsertionIndex(
  orderedStops: { latitude: number; longitude: number }[],
  newStop: { latitude: number; longitude: number }
): number {
  if (orderedStops.length === 0) return 0;

  let bestIdx = 0;
  let bestCost = Infinity;

  for (let i = 0; i <= orderedStops.length; i++) {
    let cost: number;
    if (i === 0) {
      cost = haversineDistance(
        newStop.latitude,
        newStop.longitude,
        orderedStops[0].latitude,
        orderedStops[0].longitude
      );
    } else if (i === orderedStops.length) {
      const last = orderedStops[orderedStops.length - 1];
      cost = haversineDistance(last.latitude, last.longitude, newStop.latitude, newStop.longitude);
    } else {
      const prev = orderedStops[i - 1];
      const next = orderedStops[i];
      cost =
        haversineDistance(prev.latitude, prev.longitude, newStop.latitude, newStop.longitude) +
        haversineDistance(newStop.latitude, newStop.longitude, next.latitude, next.longitude) -
        haversineDistance(prev.latitude, prev.longitude, next.latitude, next.longitude);
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestIdx = i;
    }
  }

  return bestIdx;
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
