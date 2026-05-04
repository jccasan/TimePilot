// Rough geographic clustering. We deliberately use Haversine here — Mapbox is
// too expensive to call before we've narrowed the candidate set down.
//
// The strategy is greedy seed-and-expand: pick the customer farthest from the
// office, grow a cluster around it using a soft time budget (estimated using
// fallback drive minutes + service minutes), then repeat with the remaining
// customers until everything is grouped.

import type { Customer, RoutePlannerSettings } from "./types";
import { approximateDriveMinutes, haversineMiles, type LatLng } from "./geoUtils";

export interface CustomerCluster {
  customers: Customer[];
  centroid: LatLng;
}

interface InternalPoint {
  customer: Customer;
  point: LatLng;
  serviceMinutes: number;
  used: boolean;
}

export function clusterStopsByGeography(
  customers: Customer[],
  settings: RoutePlannerSettings
): CustomerCluster[] {
  if (customers.length === 0) return [];

  const office: LatLng | undefined = settings.companyStartLocation
    ? {
        latitude: settings.companyStartLocation.latitude,
        longitude: settings.companyStartLocation.longitude,
      }
    : undefined;

  const points: InternalPoint[] = customers.map((c) => ({
    customer: c,
    point: {
      latitude: (c.latitude ?? c.location?.latitude)!,
      longitude: (c.longitude ?? c.location?.longitude)!,
    },
    serviceMinutes:
      settings.allowCustomerServiceTimeOverride && c.estimatedServiceMinutes
        ? c.estimatedServiceMinutes
        : settings.defaultServiceMinutesPerStop,
    used: false,
  }));

  // Soft per-cluster ceiling — leave headroom for the office leg + buffers.
  // Final route construction will still enforce hardMaxRouteMinutes.
  const softTimeBudget = settings.targetMaxRouteMinutes - settings.routeBufferMinutes - 30;

  const clusters: CustomerCluster[] = [];

  // Greedy outward seeding: start with the point farthest from the office (or
  // from the global centroid if no office). This avoids a snake-shaped cluster.
  while (points.some((p) => !p.used)) {
    const seed = pickSeed(points, office);
    if (!seed) break;
    seed.used = true;

    const cluster: InternalPoint[] = [seed];
    let runningMinutes = seed.serviceMinutes;
    if (office) {
      runningMinutes += approximateDriveMinutes(office, seed.point);
    }

    // Expand: keep adding the nearest unused point to the cluster's last add
    // until the soft budget is exceeded.
    let current: LatLng = seed.point;
    while (true) {
      const cand = nearestUnused(points, current);
      if (!cand) break;
      const driveAdd = approximateDriveMinutes(current, cand.point);
      const projected =
        runningMinutes + driveAdd + cand.serviceMinutes + settings.perStopBufferMinutes;
      if (projected > softTimeBudget) break;
      cand.used = true;
      cluster.push(cand);
      runningMinutes = projected;
      current = cand.point;
    }

    clusters.push({
      customers: cluster.map((c) => c.customer),
      centroid: meanPoint(cluster.map((c) => c.point)),
    });
  }

  return clusters;
}

function pickSeed(points: InternalPoint[], office?: LatLng): InternalPoint | undefined {
  const remaining = points.filter((p) => !p.used);
  if (remaining.length === 0) return undefined;
  const reference = office ?? meanPoint(remaining.map((p) => p.point));
  let best = remaining[0];
  let bestDist = -Infinity;
  for (const p of remaining) {
    const d = haversineMiles(reference, p.point);
    if (d > bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function nearestUnused(points: InternalPoint[], from: LatLng): InternalPoint | undefined {
  let best: InternalPoint | undefined;
  let bestDist = Infinity;
  for (const p of points) {
    if (p.used) continue;
    const d = haversineMiles(from, p.point);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function meanPoint(points: LatLng[]): LatLng {
  if (points.length === 0) return { latitude: 0, longitude: 0 };
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.latitude;
    lng += p.longitude;
  }
  return { latitude: lat / points.length, longitude: lng / points.length };
}
