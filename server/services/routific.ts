/**
 * Routific VRP integration.
 *
 * Calls the Routific REST API directly (vrp-long async endpoint) using fetch,
 * bypassing the `routific` npm package which has a broken uuid/v4 transitive
 * dependency that crashes the server in the tsx/Node.js 20 environment.
 *
 * Falls back gracefully: if the token is missing, the API call fails, or the
 * solution is unusable the function returns `null` so callers can fall back to
 * the internal nearest-neighbour + 2-opt algorithm.
 */

import { haversineDistance } from "./route-optimizer";

const ROUTIFIC_API_BASE = "https://api.routific.com";
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 30; // 60 seconds max

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

/** Submit a VRP-long job to Routific and return the job ID. */
async function submitJob(
  token: string,
  body: Record<string, unknown>
): Promise<string> {
  const res = await fetch(`${ROUTIFIC_API_BASE}/v1/vrp-long`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Routific submit ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { job_id?: string };
  if (!data.job_id) throw new Error("Routific submit: no job_id in response");
  return data.job_id;
}

/** Poll until the job reaches a terminal state, then return the output. */
async function pollJob(
  token: string,
  jobId: string
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${ROUTIFIC_API_BASE}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Routific poll ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      status?: string;
      output?: Record<string, unknown>;
    };

    if (data.status === "finished") {
      return data.output ?? {};
    }
    if (data.status === "error") {
      throw new Error(`Routific job ${jobId} failed with status=error`);
    }
    // status === "pending" or "processing" — keep polling
  }
  throw new Error(`Routific job ${jobId} timed out after ${MAX_POLL_ATTEMPTS} polls`);
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

  const token = process.env.ROUTIFIC_API_TOKEN;
  if (!token) {
    console.warn("[routific] ROUTIFIC_API_TOKEN not set — skipping Routific, using fallback");
    return null;
  }

  console.log(`[routific] Submitting VRP: ${stops.length} stops, startPoint=${!!startPoint}`);

  try {
    const depotLat = startPoint?.latitude ?? stops[0].latitude;
    const depotLng = startPoint?.longitude ?? stops[0].longitude;

    const visits: Record<string, unknown> = {};
    for (const stop of stops) {
      visits[stop.id] = {
        location: { name: stop.id, lat: stop.latitude, lng: stop.longitude },
        start: "8:00",
        end: "17:00",
        duration: stop.durationMinutes ?? 5,
      };
    }

    const fleet: Record<string, unknown> = {
      vehicle_1: {
        start_location: { id: "depot", lat: depotLat, lng: depotLng },
        end_location: { id: "depot", lat: depotLat, lng: depotLng },
      },
    };

    const jobId = await submitJob(token, {
      visits,
      fleet,
      options: { traffic: "slow" },
    });

    console.log(`[routific] Job ${jobId} submitted, polling…`);

    const solution = await pollJob(token, jobId);

    console.log(
      `[routific] Job ${jobId} finished. Solution keys: ${Object.keys(solution).join(", ")}`
    );

    if (solution.num_unserved) {
      console.warn(
        `[routific] ${solution.num_unserved} stop(s) unserved — falling back to internal algorithm`
      );
      return null;
    }

    const stopIds = new Set(stops.map((s) => s.id));
    const orderedIds = extractOrderedIds(solution, stopIds);
    if (!orderedIds) {
      console.warn(
        `[routific] extractOrderedIds returned null (expected ${stopIds.size} stops). Routes: ${JSON.stringify(solution?.routes ?? {}).substring(0, 300)}`
      );
      return null;
    }

    const stopMap = new Map(stops.map((s) => [s.id, s]));
    const orderedStops = orderedIds.map((id) => stopMap.get(id)!);
    const totalDistance = approximateDistance(orderedStops, startPoint);

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
        totalDuration = (h - 8) * 60 + m;
      }
    } catch {
      // keep speed estimate
    }

    console.log(
      `[routific] SUCCESS — ${stops.length} stops optimized, ${totalDistance} mi estimated`
    );
    return { orderedIds, totalDistance, totalDuration };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[routific] API error (falling back): ${message}`);
    return null;
  }
}
