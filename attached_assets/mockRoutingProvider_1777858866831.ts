// MockRoutingProvider — Haversine + detour factor + average speed.
// Used for tests, fallback when Mapbox fails, and the no-token demo path.

import { approximateDriveMiles, approximateDriveMinutes, type LatLng } from "./geoUtils.js";
import type { RoutingProvider } from "./routingProvider.js";
import type { RouteStop, TravelMatrix } from "./types.js";

export class MockRoutingProvider implements RoutingProvider {
  readonly name = "fallback" as const;

  async estimateDriveTime(origin: LatLng, destination: LatLng): Promise<number> {
    return approximateDriveMinutes(origin, destination);
  }

  async estimateDistance(origin: LatLng, destination: LatLng): Promise<number> {
    return approximateDriveMiles(origin, destination);
  }

  async getTravelMatrix(
    stops: { id: string; latitude: number; longitude: number }[],
  ): Promise<TravelMatrix> {
    const n = stops.length;
    const durationsMinutes: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const distancesMiles: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const a = stops[i];
        const b = stops[j];
        durationsMinutes[i][j] = approximateDriveMinutes(a, b);
        distancesMiles[i][j] = approximateDriveMiles(a, b);
      }
    }

    return {
      durationsMinutes,
      distancesMiles,
      stopIds: stops.map((s) => s.id),
    };
  }

  // Nearest-neighbor heuristic from the start location (or first stop).
  async optimizeStopOrder(stops: RouteStop[], startLocation?: LatLng): Promise<RouteStop[]> {
    if (stops.length <= 1) {
      return stops.map((s, i) => ({ ...s, stopOrder: i + 1 }));
    }
    const remaining = stops.slice();
    const ordered: RouteStop[] = [];
    let current: LatLng = startLocation ?? remaining[0];

    while (remaining.length > 0) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = approximateDriveMiles(current, remaining[i]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      const next = remaining.splice(bestIdx, 1)[0];
      ordered.push(next);
      current = next;
    }

    return ordered.map((s, i) => ({ ...s, stopOrder: i + 1 }));
  }
}
