/**
 * Routific VRP integration.
 *
 * Wraps the `routific` npm client and exposes a single async function
 * `routificOptimize` that accepts our internal stop/start-point shapes and
 * returns an ordered list of stop IDs plus estimated distance and duration.
 *
 * Falls back gracefully: if the token is missing, the API call fails, or the
 * solution is unusable the function returns `null` so callers can fall back to
 * the internal nearest-neighbour + 2-opt algorithm.
 */

import Routific from "routific";
import { haversineDistance } from "./route-optimizer";

export interface RoutificStop {
  id: string;
  latitude: number;
  longitude: number;
  /** Service duration in minutes at this stop. Defaults to 5 min if omitted. */
  durationMinutes?: number;
}

export interface RoutificStartPoint {
  latitude: number;
  longitude: number;
}

export interface RoutificResult {
  orderedIds: string[];
  /** Estimated total driving distance in miles (haversine approximation from ordered route). */
  totalDistance: number;
  /** Estimated total driving duration in minutes as returned by Routific. */
  totalDuration: number;
}

let _client: InstanceType<typeof Routific.Client> | null = null;

function getClient(): InstanceType<typeof Routific.Client> | null {
  const token = process.env.ROUTIFIC_API_TOKEN;
  if (!token) return null;
  if (!_client) {
    _client = new Routific.Client({ token, pollDelay: 1500 });
  }
  return _client;
}

/**
 * Extract an ordered list of visit IDs from a Routific VRP solution.
 * The solution looks like:
 *   { routes: { vehicleId: { visits: [ { location_id: "..." }, ... ] } }, ... }
 */
function extractOrderedIds(
  solution: Record<string, unknown>,
  stopIds: Set<string>
): string[] | null {
  const routes = solution?.routes as
    | Record<string, { visits?: Array<{ location_id?: string }> }>
    | undefined;
  if (!routes) return null;

  const ordered: string[] = [];
  for (const vehicle of Object.values(routes)) {
    for (const visit of vehicle.visits ?? []) {
      if (visit.location_id && stopIds.has(visit.location_id)) {
        ordered.push(visit.location_id);
      }
    }
  }

  // Every input stop must appear in the output
  if (ordered.length !== stopIds.size) return null;
  return ordered;
}

/** Approximate total driving distance (miles) for an ordered stop sequence. */
function approximateDistance(
  orderedStops: RoutificStop[],
  startPoint?: RoutificStartPoint
): number {
  let total = 0;
  const all: { latitude: number; longitude: number }[] = startPoint
    ? [startPoint, ...orderedStops]
    : [...orderedStops];
  for (let i = 0; i < all.length - 1; i++) {
    total += haversineDistance(
      all[i].latitude,
      all[i].longitude,
      all[i + 1].latitude,
      all[i + 1].longitude
    );
  }
  return Math.round(total * 100) / 100;
}

/**
 * Call Routific VRP to optimise stop order.
 * Returns `null` on any failure so callers fall back to the internal algorithm.
 */
export async function routificOptimize(
  stops: RoutificStop[],
  startPoint?: RoutificStartPoint
): Promise<RoutificResult | null> {
  if (stops.length <= 1) return null;

  const client = getClient();
  if (!client) {
    console.log("[routific] ROUTIFIC_API_TOKEN not set — skipping Routific");
    return null;
  }

  try {
    const vrp = new Routific.Vrp();

    for (const stop of stops) {
      vrp.addVisit(stop.id, {
        location: {
          name: stop.id,
          lat: stop.latitude,
          lng: stop.longitude,
        },
        duration: stop.durationMinutes ?? 5,
      });
    }

    const depotLat = startPoint?.latitude ?? stops[0].latitude;
    const depotLng = startPoint?.longitude ?? stops[0].longitude;

    vrp.addVehicle("vehicle_1", {
      start_location: {
        id: "depot",
        lat: depotLat,
        lng: depotLng,
      },
    });

    vrp.addOption("traffic", "slow");

    const { solution } = (await client.route(vrp)) as {
      jobId: string;
      solution: Record<string, unknown>;
    };

    const stopIds = new Set(stops.map((s) => s.id));
    const orderedIds = extractOrderedIds(solution, stopIds);
    if (!orderedIds) {
      console.log("[routific] Unexpected solution shape — falling back");
      return null;
    }

    const stopMap = new Map(stops.map((s) => [s.id, s]));
    const orderedStops = orderedIds.map((id) => stopMap.get(id)!);
    const totalDistance = approximateDistance(orderedStops, startPoint);

    // Routific returns estimated finish times per visit; derive total duration
    // from the last visit's arrival vs depot departure. If unavailable, fall
    // back to a simple speed estimate (25 mph average).
    let totalDuration = (totalDistance / 25) * 60;
    try {
      const routes = solution.routes as Record<
        string,
        { visits?: Array<{ arrival_time?: string }> }
      >;
      const vehicleVisits = Object.values(routes)[0]?.visits ?? [];
      const lastVisit = vehicleVisits[vehicleVisits.length - 1];
      if (lastVisit?.arrival_time) {
        const [h, m] = lastVisit.arrival_time.split(":").map(Number);
        // Routific defaults start at 8:00; total duration = last arrival − 8:00
        totalDuration = (h - 8) * 60 + m;
      }
    } catch {
      // keep speed estimate
    }

    console.log(`[routific] Optimized ${stops.length} stops — ${totalDistance} mi estimated`);
    return { orderedIds, totalDistance, totalDuration };
  } catch (err) {
    console.log("[routific] API error — falling back to internal algorithm:", err);
    return null;
  }
}
