interface Stop {
  id: string;
  latitude: number;
  longitude: number;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

function nearestNeighbor(stops: Stop[]): Stop[] {
  if (stops.length <= 1) return stops;

  const remaining = [...stops];
  const result: Stop[] = [];

  let current = remaining.shift()!;
  result.push(current);

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineDistance(
        current.latitude, current.longitude,
        remaining[i].latitude, remaining[i].longitude
      );
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    current = remaining.splice(nearestIdx, 1)[0];
    result.push(current);
  }

  return result;
}

function twoOptImprove(stops: Stop[]): Stop[] {
  if (stops.length <= 3) return stops;

  const order = [...stops];
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 2; j < order.length; j++) {
        const currentDist =
          haversineDistance(order[i].latitude, order[i].longitude, order[i + 1].latitude, order[i + 1].longitude) +
          (j + 1 < order.length
            ? haversineDistance(order[j].latitude, order[j].longitude, order[j + 1].latitude, order[j + 1].longitude)
            : 0);

        const newDist =
          haversineDistance(order[i].latitude, order[i].longitude, order[j].latitude, order[j].longitude) +
          (j + 1 < order.length
            ? haversineDistance(order[i + 1].latitude, order[i + 1].longitude, order[j + 1].latitude, order[j + 1].longitude)
            : 0);

        if (newDist < currentDist) {
          const reversed = order.slice(i + 1, j + 1).reverse();
          order.splice(i + 1, j - i, ...reversed);
          improved = true;
        }
      }
    }
  }

  return order;
}

export function calculateTotalDistance(stops: Stop[]): number {
  let total = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    total += haversineDistance(
      stops[i].latitude, stops[i].longitude,
      stops[i + 1].latitude, stops[i + 1].longitude
    );
  }
  return Math.round(total * 100) / 100;
}

export function optimizeRoute(stops: Stop[]): { orderedIds: string[]; totalDistance: number } {
  if (stops.length <= 1) {
    return {
      orderedIds: stops.map(s => s.id),
      totalDistance: 0,
    };
  }

  const nnOrder = nearestNeighbor(stops);
  const optimized = twoOptImprove(nnOrder);

  return {
    orderedIds: optimized.map(s => s.id),
    totalDistance: calculateTotalDistance(optimized),
  };
}
