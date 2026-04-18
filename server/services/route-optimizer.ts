interface Stop {
  id: string;
  latitude: number;
  longitude: number;
}

interface StartPoint {
  latitude: number;
  longitude: number;
}

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

function pathDistance(stops: Stop[], startPoint?: StartPoint): number {
  let total = 0;
  if (startPoint && stops.length > 0) {
    total += haversineDistance(startPoint.latitude, startPoint.longitude, stops[0].latitude, stops[0].longitude);
  }
  for (let i = 0; i < stops.length - 1; i++) {
    total += haversineDistance(stops[i].latitude, stops[i].longitude, stops[i + 1].latitude, stops[i + 1].longitude);
  }
  return total;
}

function nearestNeighbor(stops: Stop[], startPoint?: StartPoint): Stop[] {
  if (stops.length <= 1) return stops;

  const remaining = [...stops];
  const result: Stop[] = [];

  let currentLat: number;
  let currentLon: number;

  if (startPoint) {
    currentLat = startPoint.latitude;
    currentLon = startPoint.longitude;
  } else {
    const first = remaining.shift()!;
    result.push(first);
    currentLat = first.latitude;
    currentLon = first.longitude;
  }

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineDistance(currentLat, currentLon, remaining[i].latitude, remaining[i].longitude);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    const nearest = remaining.splice(nearestIdx, 1)[0];
    result.push(nearest);
    currentLat = nearest.latitude;
    currentLon = nearest.longitude;
  }

  return result;
}

function twoOptImprove(stops: Stop[], startPoint?: StartPoint): Stop[] {
  if (stops.length <= 3) return stops;

  const order = [...stops];
  let bestDist = pathDistance(order, startPoint);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const reversed = order.slice(i, j + 1).reverse();
        const candidate = [...order.slice(0, i), ...reversed, ...order.slice(j + 1)];
        const candidateDist = pathDistance(candidate, startPoint);

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

function nearestNeighborFromFirst(stops: Stop[], forcedFirst: Stop, startPoint?: StartPoint): Stop[] {
  const result: Stop[] = [forcedFirst];
  const remaining = stops.filter(s => s.id !== forcedFirst.id);
  let currentLat = forcedFirst.latitude;
  let currentLon = forcedFirst.longitude;

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineDistance(currentLat, currentLon, remaining[i].latitude, remaining[i].longitude);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    const nearest = remaining.splice(nearestIdx, 1)[0];
    result.push(nearest);
    currentLat = nearest.latitude;
    currentLon = nearest.longitude;
  }

  return result;
}

export function optimizeRoute(stops: Stop[], startPoint?: StartPoint): { orderedIds: string[]; totalDistance: number } {
  if (stops.length <= 1) {
    return {
      orderedIds: stops.map(s => s.id),
      totalDistance: startPoint && stops.length === 1
        ? calculateTotalDistance(stops, startPoint)
        : 0,
    };
  }

  const MAX_STARTS = Math.min(stops.length, 12);
  let bestOrder: Stop[] = [];
  let bestDist = Infinity;

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
    let nnOrder: Stop[];
    if (startPoint) {
      nnOrder = nearestNeighborFromFirst(stops, stops[startIdx], startPoint);
    } else {
      const rotated = [...stops.slice(startIdx), ...stops.slice(0, startIdx)];
      nnOrder = nearestNeighbor(rotated);
    }
    const improved = twoOptImprove(nnOrder, startPoint);
    const dist = pathDistance(improved, startPoint);
    if (dist < bestDist) {
      bestDist = dist;
      bestOrder = improved;
    }
  }

  const nnDefault = nearestNeighbor(stops, startPoint);
  const improvedDefault = twoOptImprove(nnDefault, startPoint);
  const distDefault = pathDistance(improvedDefault, startPoint);
  if (distDefault < bestDist) {
    bestDist = distDefault;
    bestOrder = improvedDefault;
  }

  return {
    orderedIds: bestOrder.map(s => s.id),
    totalDistance: Math.round(bestDist * 100) / 100,
  };
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

    const legs: RouteLeg[] = [];
    if (route.legs && Array.isArray(route.legs)) {
      for (let i = 0; i < route.legs.length; i++) {
        legs.push({
          fromId: stopIds[i],
          toId: stopIds[i + 1] || stopIds[i],
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
