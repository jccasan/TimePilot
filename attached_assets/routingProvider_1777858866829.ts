// RoutingProvider interface — the only place planning code talks to a routing
// engine. Mapbox calls live in MapboxRoutingProvider; tests/demos run on
// MockRoutingProvider. Cache use is the caller's responsibility.

import type { LatLng } from "./geoUtils.js";
import type { RouteStop, TravelMatrix } from "./types.js";

export interface RoutingProvider {
  readonly name: "mapbox" | "fallback";

  estimateDriveTime(origin: LatLng, destination: LatLng): Promise<number>; // minutes
  estimateDistance(origin: LatLng, destination: LatLng): Promise<number>; // miles
  getTravelMatrix(stops: { id: string; latitude: number; longitude: number }[]): Promise<TravelMatrix>;
  optimizeStopOrder(stops: RouteStop[], startLocation?: LatLng): Promise<RouteStop[]>;
}

export interface RoutingEstimate {
  durationMinutes: number;
  distanceMiles: number;
  estimatedFallback: boolean;
}
