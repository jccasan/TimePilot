// MapboxRoutingProvider — wraps Directions, Matrix, and Optimization APIs.
// Falls back gracefully to the MockRoutingProvider on any failure so the
// planner never crashes because of network or quota issues.

import type { LatLng } from "./geoUtils.js";
import { MockRoutingProvider } from "./mockRoutingProvider.js";
import type { RoutingProvider } from "./routingProvider.js";
import type { MapboxConfig, RouteStop, TravelMatrix } from "./types.js";

const METERS_TO_MILES = 0.000621371;
const SECONDS_TO_MINUTES = 1 / 60;

export class MapboxRoutingProvider implements RoutingProvider {
  readonly name = "mapbox" as const;

  private fallback = new MockRoutingProvider();

  constructor(private config: MapboxConfig) {
    if (!config.accessToken) {
      throw new Error("MapboxRoutingProvider requires accessToken.");
    }
  }

  private get profile(): string {
    return `mapbox/${this.config.profile}`;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timeoutMs = this.config.requestTimeoutMs ?? 8000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Node 18+ has global fetch.
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Mapbox HTTP ${res.status}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async estimateDriveTime(origin: LatLng, destination: LatLng): Promise<number> {
    try {
      const coord = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
      const url =
        `https://api.mapbox.com/directions/v5/${this.profile}/${coord}` +
        `?access_token=${encodeURIComponent(this.config.accessToken)}` +
        `&overview=false`;
      const data = (await this.fetchJson(url)) as {
        routes?: { duration: number; distance: number }[];
      };
      const route = data.routes?.[0];
      if (!route) throw new Error("Mapbox returned no route");
      return route.duration * SECONDS_TO_MINUTES;
    } catch {
      return this.fallback.estimateDriveTime(origin, destination);
    }
  }

  async estimateDistance(origin: LatLng, destination: LatLng): Promise<number> {
    try {
      const coord = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
      const url =
        `https://api.mapbox.com/directions/v5/${this.profile}/${coord}` +
        `?access_token=${encodeURIComponent(this.config.accessToken)}` +
        `&overview=false`;
      const data = (await this.fetchJson(url)) as {
        routes?: { duration: number; distance: number }[];
      };
      const route = data.routes?.[0];
      if (!route) throw new Error("Mapbox returned no route");
      return route.distance * METERS_TO_MILES;
    } catch {
      return this.fallback.estimateDistance(origin, destination);
    }
  }

  async getTravelMatrix(
    stops: { id: string; latitude: number; longitude: number }[],
  ): Promise<TravelMatrix> {
    const max = this.config.maxMatrixSize ?? 25; // Mapbox Matrix API caps depend on plan.
    if (stops.length === 0) {
      return { durationsMinutes: [], distancesMiles: [], stopIds: [] };
    }
    if (stops.length > max) {
      // Conservative fallback: mock matrix instead of paginating, which gets
      // expensive and slow. Cache + iterative directions calls via the planner
      // are the recommended path for large groups.
      return this.fallback.getTravelMatrix(stops);
    }
    try {
      const coords = stops
        .map((s) => `${s.longitude},${s.latitude}`)
        .join(";");
      const url =
        `https://api.mapbox.com/directions-matrix/v1/${this.profile}/${coords}` +
        `?annotations=duration,distance` +
        `&access_token=${encodeURIComponent(this.config.accessToken)}`;
      const data = (await this.fetchJson(url)) as {
        durations?: (number | null)[][];
        distances?: (number | null)[][];
      };
      if (!data.durations || !data.distances) {
        throw new Error("Mapbox matrix returned no data");
      }
      const n = stops.length;
      const durationsMinutes: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
      const distancesMiles: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const dur = data.durations[i]?.[j];
          const dist = data.distances[i]?.[j];
          durationsMinutes[i][j] = (dur ?? 0) * SECONDS_TO_MINUTES;
          distancesMiles[i][j] = (dist ?? 0) * METERS_TO_MILES;
        }
      }
      return { durationsMinutes, distancesMiles, stopIds: stops.map((s) => s.id) };
    } catch {
      return this.fallback.getTravelMatrix(stops);
    }
  }

  // Mapbox Optimization v1 supports up to 12 coordinates including start/end.
  async optimizeStopOrder(stops: RouteStop[], startLocation?: LatLng): Promise<RouteStop[]> {
    if (stops.length <= 1) {
      return stops.map((s, i) => ({ ...s, stopOrder: i + 1 }));
    }
    const max = 12;
    const all = startLocation ? [startLocation, ...stops] : stops;
    if (all.length > max) {
      return this.fallback.optimizeStopOrder(stops, startLocation);
    }
    try {
      const coords = all
        .map((s) => `${s.longitude},${s.latitude}`)
        .join(";");
      const url =
        `https://api.mapbox.com/optimized-trips/v1/${this.profile}/${coords}` +
        `?roundtrip=false&source=first&destination=last` +
        `&access_token=${encodeURIComponent(this.config.accessToken)}`;
      const data = (await this.fetchJson(url)) as {
        waypoints?: { waypoint_index: number; trips_index: number }[];
      };
      if (!data.waypoints) throw new Error("Mapbox optimization returned no waypoints");

      const stopIndexOffset = startLocation ? 1 : 0;
      const ordered: { stop: RouteStop; trip: number }[] = [];
      for (let i = 0; i < data.waypoints.length; i++) {
        if (i < stopIndexOffset) continue;
        const orig = stops[i - stopIndexOffset];
        ordered.push({ stop: orig, trip: data.waypoints[i].waypoint_index });
      }
      ordered.sort((a, b) => a.trip - b.trip);
      return ordered.map((o, i) => ({ ...o.stop, stopOrder: i + 1 }));
    } catch {
      return this.fallback.optimizeStopOrder(stops, startLocation);
    }
  }
}
