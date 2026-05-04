// Factory that returns the appropriate RoutingProvider based on environment.
// Uses MapboxRoutingProvider when MAPBOX_ACCESS_TOKEN is set, else MockRoutingProvider.
// Mirrors the same pattern used in server/services/route-optimizer.ts.

import { MapboxRoutingProvider } from "./mapboxRoutingProvider";
import { MockRoutingProvider } from "./mockRoutingProvider";
import type { RoutingProvider } from "./routingProvider";
import type { MapboxConfig } from "./types";

export function createRoutingProvider(): RoutingProvider {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (token) {
    const config: MapboxConfig = {
      accessToken: token,
      profile: "driving",
      cacheEnabled: true,
      coordinatePrecision: 5,
      maxMatrixSize: 25,
      requestTimeoutMs: 8000,
    };
    return new MapboxRoutingProvider(config);
  }
  return new MockRoutingProvider();
}
