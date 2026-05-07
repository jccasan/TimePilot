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
 *
 * A lightweight in-memory circuit-breaker prevents repeated network calls
 * during a Routific outage:
 *   CLOSED  → normal operation
 *   OPEN    → skip all calls; return null immediately
 *   HALF-OPEN → allow one probe request through after the cooldown expires
 */

import { haversineDistance } from "./route-optimizer";
import { trackRoutificCall } from "./api-usage";

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

export interface RoutificOptions {
  /**
   * Maximum total route duration in whole hours, measured from a fixed shift start of 08:00.
   * When provided, Routific's shift window is set to 08:00 – (08:00 + maxDurationHours).
   * If stops cannot all be served within the window, Routific returns unserved stops and the
   * caller falls back to the internal nearest-neighbour + 2-opt algorithm.
   * When absent the shift window is not constrained — matching the previous unconstrained behavior.
   */
  maxDurationHours?: number;
}

// ---------------------------------------------------------------------------
// Circuit-breaker
// ---------------------------------------------------------------------------

const CB_FAILURE_THRESHOLD = parseInt(process.env.ROUTIFIC_CB_THRESHOLD ?? "3", 10);
const CB_COOLDOWN_MS = parseInt(process.env.ROUTIFIC_CB_COOLDOWN_MS ?? "60000", 10);

type CBState = "closed" | "open" | "half-open";

let _cbState: CBState = "closed";
let _cbConsecutiveFailures = 0;
let _cbOpenedAt = 0;

/** Exported for testing only — resets the circuit breaker to its initial closed state. */
export function resetCircuitBreaker(): void {
  _cbState = "closed";
  _cbConsecutiveFailures = 0;
  _cbOpenedAt = 0;
}

/** Exported for testing only — returns the current circuit breaker state. */
export function getCircuitBreakerState(): CBState {
  return _cbState;
}

/**
 * Returns true when the circuit breaker is open and no request should go
 * through. Transitions OPEN → HALF-OPEN once the cooldown expires.
 */
function cbShouldSkip(): boolean {
  if (_cbState === "closed") return false;

  if (_cbState === "open") {
    if (Date.now() - _cbOpenedAt >= CB_COOLDOWN_MS) {
      _cbState = "half-open";
      console.log("[routific] Circuit breaker entering HALF-OPEN — allowing one probe request");
      return false;
    }
    return true;
  }

  // half-open: let the probe through
  return false;
}

function cbRecordSuccess(): void {
  if (_cbState !== "closed") {
    console.log("[routific] Circuit breaker CLOSED — Routific recovered");
  }
  _cbState = "closed";
  _cbConsecutiveFailures = 0;
}

function cbRecordFailure(): void {
  _cbConsecutiveFailures++;

  if (_cbState === "half-open" || _cbConsecutiveFailures >= CB_FAILURE_THRESHOLD) {
    _cbState = "open";
    _cbOpenedAt = Date.now();
    console.warn(
      `[routific] Circuit breaker OPENED after ${_cbConsecutiveFailures} consecutive failure(s). ` +
        `Will probe again in ${CB_COOLDOWN_MS / 1000}s.`
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract an ordered list of visit IDs from a Routific VRP solution.
 * The actual Routific VRP-Long output shape is:
 *   { solution: { vehicleId: [ { location_id: "..." }, ... ] }, num_unserved: 0, ... }
 * Each vehicle's value is a direct array of visit objects — NOT { visits: [...] }.
 */
function extractOrderedIds(
  solution: Record<string, unknown>,
  stopIds: Set<string>
): string[] | null {
  const solutionMap = solution?.solution as
    | Record<string, Array<{ location_id?: string }>>
    | undefined;
  if (!solutionMap) return null;

  const ordered: string[] = [];
  for (const vehicleVisits of Object.values(solutionMap)) {
    for (const visit of vehicleVisits) {
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
async function submitJob(token: string, body: Record<string, unknown>): Promise<string> {
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
async function pollJob(token: string, jobId: string): Promise<Record<string, unknown>> {
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

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Call Routific VRP to optimise stop order.
 * Returns `null` on any failure so callers fall back to the internal algorithm.
 * The circuit breaker short-circuits when the API is consistently unavailable.
 */
export async function routificOptimize(
  stops: RoutificStop[],
  startPoint?: RoutificStartPoint,
  optionsOrCompanyId?: RoutificOptions | number | null,
  companyId?: number | null
): Promise<RoutificResult | null> {
  // Support legacy call signature: routificOptimize(stops, startPoint, companyId)
  let options: RoutificOptions | undefined;
  let resolvedCompanyId: number | null = companyId ?? null;
  if (typeof optionsOrCompanyId === "number" || optionsOrCompanyId === null) {
    resolvedCompanyId = optionsOrCompanyId ?? null;
  } else {
    options = optionsOrCompanyId;
  }
  if (stops.length <= 1) return null;

  const token = process.env.ROUTIFIC_API_TOKEN;
  if (!token) {
    console.warn("[routific] ROUTIFIC_API_TOKEN not set — skipping Routific, using fallback");
    return null;
  }

  // Circuit-breaker guard — skip the network call entirely when open
  if (cbShouldSkip()) {
    console.warn("[routific] Circuit breaker OPEN — skipping Routific call, using fallback");
    return null;
  }

  // Build shift window only when a duration cap is explicitly requested.
  // When maxDurationHours is absent we leave the window unconstrained (original behavior).
  let shiftStart: string | undefined;
  let shiftEnd: string | undefined;
  if (options?.maxDurationHours != null && options.maxDurationHours > 0) {
    const startTotalMin = 8 * 60; // fixed shift start: 08:00
    const endTotalMin = startTotalMin + options.maxDurationHours * 60;
    const endH = Math.floor(endTotalMin / 60);
    const endM = endTotalMin % 60;
    shiftStart = "08:00";
    shiftEnd = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
  }

  console.log(
    `[routific] Submitting VRP: ${stops.length} stops, startPoint=${!!startPoint}` +
      (shiftEnd ? `, shift=${shiftStart}-${shiftEnd}` : ", shift=unconstrained")
  );

  try {
    const depotLat = startPoint?.latitude ?? stops[0].latitude;
    const depotLng = startPoint?.longitude ?? stops[0].longitude;

    const visits: Record<string, unknown> = {};
    for (const stop of stops) {
      const visit: Record<string, unknown> = {
        location: { name: stop.id, lat: stop.latitude, lng: stop.longitude },
        duration: stop.durationMinutes ?? 5,
      };
      if (shiftStart) visit.start = shiftStart;
      if (shiftEnd) visit.end = shiftEnd;
      visits[stop.id] = visit;
    }

    const vehicle: Record<string, unknown> = {
      start_location: { id: "depot", lat: depotLat, lng: depotLng },
      end_location: { id: "depot", lat: depotLat, lng: depotLng },
    };
    if (shiftStart) vehicle.shift_start = shiftStart;
    if (shiftEnd) vehicle.shift_end = shiftEnd;

    const fleet: Record<string, unknown> = {
      vehicle_1: vehicle,
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
      cbRecordFailure();
      return null;
    }

    const stopIds = new Set(stops.map((s) => s.id));
    const orderedIds = extractOrderedIds(solution, stopIds);
    if (!orderedIds) {
      console.warn(
        `[routific] extractOrderedIds returned null (expected ${stopIds.size} stops). Solution: ${JSON.stringify(solution?.solution ?? {}).substring(0, 300)}`
      );
      cbRecordFailure();
      return null;
    }

    const stopMap = new Map(stops.map((s) => [s.id, s]));
    const orderedStops = orderedIds.map((id) => stopMap.get(id)!);
    const totalDistance = approximateDistance(orderedStops, startPoint);

    let totalDuration = (totalDistance / 25) * 60;
    try {
      const solutionMap = solution.solution as Record<string, Array<{ arrival_time?: string }>>;
      const vehicleVisits = Object.values(solutionMap)[0] ?? [];
      const lastVisit = vehicleVisits[vehicleVisits.length - 1];
      if (lastVisit?.arrival_time) {
        const [h, m] = lastVisit.arrival_time.split(":").map(Number);
        totalDuration = (h - 8) * 60 + m;
      }
    } catch {
      // keep speed estimate
    }

    cbRecordSuccess();
    console.log(
      `[routific] SUCCESS — ${stops.length} stops optimized, ${totalDistance} mi estimated`
    );
    trackRoutificCall(resolvedCompanyId, stops.length, true);
    return { orderedIds, totalDistance, totalDuration };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[routific] API error (falling back): ${message}`);
    cbRecordFailure();
    trackRoutificCall(resolvedCompanyId, stops.length, false);
    return null;
  }
}
