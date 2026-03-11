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

export function optimizeRoute(stops: Stop[], startPoint?: StartPoint): { orderedIds: string[]; totalDistance: number } {
  if (stops.length <= 1) {
    return {
      orderedIds: stops.map(s => s.id),
      totalDistance: startPoint && stops.length === 1
        ? calculateTotalDistance(stops, startPoint)
        : 0,
    };
  }

  const nnOrder = nearestNeighbor(stops, startPoint);
  const optimized = twoOptImprove(nnOrder, startPoint);

  return {
    orderedIds: optimized.map(s => s.id),
    totalDistance: calculateTotalDistance(optimized, startPoint),
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
