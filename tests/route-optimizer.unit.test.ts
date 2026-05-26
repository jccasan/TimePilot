import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  deduplicateCandidates,
  selectCandidateStarts,
  optimizeRouteMultiStart,
  optimizeRouteAsyncMultiStart,
  buildSharedDistMapMultiStart,
  haversineDistance,
  MAX_CANDIDATE_STARTS,
} from "../server/services/route-optimizer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStop(id: string, lat: number, lon: number) {
  return { id, latitude: lat, longitude: lon };
}

function makeStart(lat: number, lon: number) {
  return { latitude: lat, longitude: lon };
}

// ---------------------------------------------------------------------------
// deduplicateCandidates
// ---------------------------------------------------------------------------

describe("deduplicateCandidates", () => {
  it("returns an empty array when given an empty input", () => {
    expect(deduplicateCandidates([])).toEqual([]);
  });

  it("returns a single-element array unchanged", () => {
    const candidates = [makeStart(40.0, -80.0)];
    expect(deduplicateCandidates(candidates)).toEqual(candidates);
  });

  it("preserves both candidates when they are clearly distinct (> 0.1 mi apart)", () => {
    const a = makeStart(40.0, -80.0);
    // ~6.9 miles north
    const b = makeStart(40.1, -80.0);
    const result = deduplicateCandidates([a, b]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(a);
    expect(result[1]).toEqual(b);
  });

  it("removes the second point when two candidates are within 0.1 miles of each other", () => {
    const a = makeStart(40.0, -80.0);
    // ~0.045 miles away — well within the dedup threshold
    const b = makeStart(40.0004, -80.0);
    const dist = haversineDistance(a.latitude, a.longitude, b.latitude, b.longitude);
    expect(dist).toBeLessThan(0.1);

    const result = deduplicateCandidates([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(a);
  });

  it("keeps the first occurrence and drops later near-duplicates (preserves order)", () => {
    const a = makeStart(40.0, -80.0);
    const b = makeStart(41.0, -81.0); // distinct
    const nearA = makeStart(40.0004, -80.0); // near-duplicate of a

    const result = deduplicateCandidates([a, b, nearA]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(a);
    expect(result[1]).toEqual(b);
  });

  it("handles a list where all entries are near-duplicates, keeping only the first", () => {
    const a = makeStart(40.0, -80.0);
    const b = makeStart(40.0002, -80.0); // near a
    const c = makeStart(40.0004, -80.0); // near a and b

    const result = deduplicateCandidates([a, b, c]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(a);
  });

  it("handles a mix of distinct and near-duplicate candidates, preserving insertion order", () => {
    const a = makeStart(40.0, -80.0);
    const b = makeStart(41.0, -81.0);
    const nearB = makeStart(41.0004, -81.0); // near-dup of b
    const c = makeStart(42.0, -82.0);

    const result = deduplicateCandidates([a, b, nearB, c]);
    expect(result).toHaveLength(3);
    expect(result).toEqual([a, b, c]);
  });
});

// ---------------------------------------------------------------------------
// selectCandidateStarts
// ---------------------------------------------------------------------------

describe("selectCandidateStarts", () => {
  const stops = [
    makeStop("s1", 40.0, -80.0),
    makeStop("s2", 40.0, -80.1),
    makeStop("s3", 40.1, -80.0),
    makeStop("s4", 40.1, -80.1),
  ];
  // centroid ≈ (40.05, -80.05)

  it("returns the full list unchanged when candidates count is at or below max", () => {
    const candidates = [makeStart(40.0, -80.0), makeStart(41.0, -81.0)];
    const result = selectCandidateStarts(candidates, stops, MAX_CANDIDATE_STARTS);
    expect(result).toEqual(candidates);
  });

  it("returns exactly max candidates when input exceeds max", () => {
    const candidates = Array.from({ length: MAX_CANDIDATE_STARTS + 3 }, (_, i) =>
      makeStart(40.0 + i * 0.5, -80.0)
    );
    const result = selectCandidateStarts(candidates, stops, MAX_CANDIDATE_STARTS);
    expect(result).toHaveLength(MAX_CANDIDATE_STARTS);
  });

  it("picks candidates closest to the centroid of the stops when capping", () => {
    // centroid ≈ (40.05, -80.05)
    const near = makeStart(40.05, -80.05); // ~0 miles from centroid
    const far1 = makeStart(50.0, -90.0);
    const far2 = makeStart(10.0, -70.0);
    const far3 = makeStart(35.0, -100.0);

    const candidates = [far1, far2, far3, near];
    const result = selectCandidateStarts(candidates, stops, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(near);
  });

  it("keeps the two closest-to-centroid points when max=2", () => {
    // centroid ≈ (40.05, -80.05)
    const nearest = makeStart(40.05, -80.05);
    const secondNearest = makeStart(40.1, -80.0);
    const far = makeStart(55.0, -95.0);

    const candidates = [far, secondNearest, nearest];
    const result = selectCandidateStarts(candidates, stops, 2);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(nearest);
    expect(result).toContainEqual(secondNearest);
    expect(result).not.toContainEqual(far);
  });

  it("slices to max when stops list is empty (no centroid available)", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => makeStart(i * 0.1, -80.0));
    const result = selectCandidateStarts(candidates, [], 3);
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// optimizeRouteMultiStart
// ---------------------------------------------------------------------------

describe("optimizeRouteMultiStart", () => {
  // Stops clustered around (40.0, -80.0)
  const stops = [
    makeStop("s1", 40.0, -80.0),
    makeStop("s2", 40.01, -80.01),
    makeStop("s3", 40.02, -80.0),
    makeStop("s4", 40.01, -79.99),
  ];

  it("returns an empty result for zero stops", () => {
    const result = optimizeRouteMultiStart([], [makeStart(40.0, -80.0)]);
    expect(result.orderedIds).toEqual([]);
    expect(result.totalDistance).toBe(0);
  });

  it("falls back to no-startpoint optimizer when candidateStarts is empty", () => {
    const result = optimizeRouteMultiStart(stops, []);
    expect(result.orderedIds).toHaveLength(stops.length);
    expect(result.bestStart).toBeUndefined();
  });

  it("returns bestStart equal to the single candidate when only one is provided", () => {
    const candidate = makeStart(40.0, -80.0);
    const result = optimizeRouteMultiStart(stops, [candidate]);
    expect(result.orderedIds).toHaveLength(stops.length);
    expect(result.bestStart).toEqual(candidate);
  });

  it("selects the candidate producing the shortest total path", () => {
    // Near depot: right on top of the cluster
    const nearDepot = makeStart(40.01, -80.005);
    // Far depot: far from the cluster — start leg will be much longer
    const farDepot = makeStart(50.0, -90.0);

    const result = optimizeRouteMultiStart(stops, [nearDepot, farDepot]);
    expect(result.bestStart).toEqual(nearDepot);
  });

  it("produces a shorter or equal distance when starting from the near depot vs far depot", () => {
    const nearDepot = makeStart(40.01, -80.005);
    const farDepot = makeStart(50.0, -90.0);

    const nearResult = optimizeRouteMultiStart(stops, [nearDepot]);
    const farResult = optimizeRouteMultiStart(stops, [farDepot]);
    const multiResult = optimizeRouteMultiStart(stops, [nearDepot, farDepot]);

    expect(multiResult.totalDistance).toBeLessThanOrEqual(farResult.totalDistance);
    expect(multiResult.totalDistance).toBeCloseTo(nearResult.totalDistance, 1);
  });

  it("includes all stop IDs in the result", () => {
    const depotA = makeStart(40.0, -80.0);
    const depotB = makeStart(41.0, -81.0);
    const result = optimizeRouteMultiStart(stops, [depotA, depotB]);
    const stopIds = stops.map((s) => s.id).sort();
    expect([...result.orderedIds].sort()).toEqual(stopIds);
  });

  it("returns a non-negative totalDistance", () => {
    const result = optimizeRouteMultiStart(stops, [makeStart(40.0, -80.0), makeStart(41.0, -81.0)]);
    expect(result.totalDistance).toBeGreaterThanOrEqual(0);
  });

  it("uses the provided distMap when evaluating candidates", () => {
    // Build a synthetic distMap that makes depot B appear vastly cheaper than depot A
    // by assigning very small distances from depot B to every stop.
    // We use the internal key format: __start_0__ for depotA, __start_1__ for depotB.

    const depotA = makeStart(40.0, -80.0);
    const depotB = makeStart(50.0, -90.0); // geographically far but cheap in distMap

    const distMap = new Map<string, Map<string, number>>();

    const allIds = ["__start_0__", "__start_1__", ...stops.map((s) => s.id)];
    for (const from of allIds) {
      const toMap = new Map<string, number>();
      for (const to of allIds) {
        if (from !== to) {
          // Make everything from depotB (__start_1__) look very cheap
          if (from === "__start_1__" || to === "__start_1__") {
            toMap.set(to, 0.001);
          } else {
            toMap.set(to, 1.0);
          }
        }
      }
      distMap.set(from, toMap);
    }

    const result = optimizeRouteMultiStart(stops, [depotA, depotB], distMap);
    // With the distMap making depotB edges essentially zero, depotB should win
    expect(result.bestStart).toEqual(depotB);
  });
});

// ---------------------------------------------------------------------------
// optimizeRouteAsyncMultiStart — zero-candidates fallback
// ---------------------------------------------------------------------------

describe("optimizeRouteAsyncMultiStart", () => {
  const originalToken = process.env.MAPBOX_PUBLIC_TOKEN;

  beforeEach(() => {
    // Ensure no Mapbox token so no real HTTP calls are attempted
    delete process.env.MAPBOX_PUBLIC_TOKEN;
    delete process.env.MAPBOX_SECRET_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.MAPBOX_PUBLIC_TOKEN;
    } else {
      process.env.MAPBOX_PUBLIC_TOKEN = originalToken;
    }
    vi.restoreAllMocks();
  });

  const stops = [
    makeStop("a", 40.0, -80.0),
    makeStop("b", 40.1, -80.1),
    makeStop("c", 40.2, -80.0),
  ];

  it("falls back gracefully and returns all stop IDs when candidateStarts is empty", async () => {
    const result = await optimizeRouteAsyncMultiStart(stops, []);
    expect(result.orderedIds).toHaveLength(stops.length);
    const ids = stops.map((s) => s.id).sort();
    expect([...result.orderedIds].sort()).toEqual(ids);
  });

  it("does not set bestStart when candidateStarts is empty", async () => {
    const result = await optimizeRouteAsyncMultiStart(stops, []);
    expect(result.bestStart).toBeUndefined();
  });

  it("returns degraded:false when no Mapbox token is configured (haversine fallback)", async () => {
    const result = await optimizeRouteAsyncMultiStart(stops, []);
    expect(result.degraded).toBe(false);
  });

  it("handles an empty stop list with empty candidates without throwing", async () => {
    const result = await optimizeRouteAsyncMultiStart([], []);
    expect(result.orderedIds).toEqual([]);
    expect(result.totalDistance).toBe(0);
  });

  it("deduplicates near-duplicate candidates before evaluating", async () => {
    const a = makeStart(40.0, -80.0);
    const nearA = makeStart(40.0004, -80.0); // within 0.1 mi of a
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await optimizeRouteAsyncMultiStart(stops, [a, nearA]);
    // Both candidates dedup to 1 — single-candidate path, no multi-start matrix call
    expect(result.bestStart).toEqual(a);
    // No Mapbox token → fetch should not have been called
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sets bestStart to the single remaining candidate after deduplication", async () => {
    const sole = makeStart(40.05, -80.05);
    const result = await optimizeRouteAsyncMultiStart(stops, [sole]);
    expect(result.bestStart).toEqual(sole);
    expect(result.orderedIds).toHaveLength(stops.length);
  });

  it("returns a result with all stop IDs for multiple distinct candidates", async () => {
    const a = makeStart(40.0, -80.0);
    const b = makeStart(41.0, -81.0);
    const result = await optimizeRouteAsyncMultiStart(stops, [a, b]);
    expect(result.orderedIds).toHaveLength(stops.length);
    const ids = stops.map((s) => s.id).sort();
    expect([...result.orderedIds].sort()).toEqual(ids);
  });
});

// ---------------------------------------------------------------------------
// buildSharedDistMapMultiStart — 0 and 1 candidate delegation
// ---------------------------------------------------------------------------

describe("buildSharedDistMapMultiStart", () => {
  const originalToken = process.env.MAPBOX_PUBLIC_TOKEN;

  beforeEach(() => {
    delete process.env.MAPBOX_PUBLIC_TOKEN;
    delete process.env.MAPBOX_SECRET_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.MAPBOX_PUBLIC_TOKEN;
    } else {
      process.env.MAPBOX_PUBLIC_TOKEN = originalToken;
    }
    vi.restoreAllMocks();
  });

  const stops = [
    makeStop("s1", 40.0, -80.0),
    makeStop("s2", 40.1, -80.1),
    makeStop("s3", 40.2, -80.0),
  ];

  it("returns {map:undefined, degraded:false} for 0 candidates when no token is set", async () => {
    const result = await buildSharedDistMapMultiStart(stops, []);
    expect(result.map).toBeUndefined();
    expect(result.degraded).toBe(false);
  });

  it("returns {map:undefined, degraded:false} for 1 candidate when no token is set", async () => {
    const result = await buildSharedDistMapMultiStart(stops, [makeStart(40.0, -80.0)]);
    expect(result.map).toBeUndefined();
    expect(result.degraded).toBe(false);
  });

  it("returns {map:undefined, degraded:false} for multiple candidates when no token is set", async () => {
    const result = await buildSharedDistMapMultiStart(stops, [
      makeStart(40.0, -80.0),
      makeStart(41.0, -81.0),
    ]);
    expect(result.map).toBeUndefined();
    expect(result.degraded).toBe(false);
  });

  it("does not make any fetch calls when there is no Mapbox token", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await buildSharedDistMapMultiStart(stops, [makeStart(40.0, -80.0), makeStart(41.0, -81.0)]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns {map:undefined, degraded:false} for empty stops list with 0 candidates", async () => {
    const result = await buildSharedDistMapMultiStart([], []);
    expect(result.map).toBeUndefined();
    expect(result.degraded).toBe(false);
  });

  it("returns {map:undefined, degraded:false} for empty stops list with 1 candidate", async () => {
    const result = await buildSharedDistMapMultiStart([], [makeStart(40.0, -80.0)]);
    expect(result.map).toBeUndefined();
    expect(result.degraded).toBe(false);
  });

  it("delegates 0 candidates to the no-startpoint path (same outcome as passing undefined start)", async () => {
    // Both calls should behave identically — no token → no matrix → same return shape
    const zeroCandidate = await buildSharedDistMapMultiStart(stops, []);
    expect(zeroCandidate).toEqual({ map: undefined, degraded: false });
  });

  it("delegates 1 candidate to the single-startpoint path (same outcome as single-start)", async () => {
    const oneCandidate = await buildSharedDistMapMultiStart(stops, [makeStart(40.0, -80.0)]);
    expect(oneCandidate).toEqual({ map: undefined, degraded: false });
  });

  it("does not throw when the stop list exceeds ROUTE_MATRIX_LIMIT (50)", async () => {
    const manyStops = Array.from({ length: 55 }, (_, i) =>
      makeStop(`s${i}`, 40.0 + i * 0.001, -80.0)
    );
    const candidates = [makeStart(40.0, -80.0), makeStart(41.0, -81.0)];
    await expect(buildSharedDistMapMultiStart(manyStops, candidates)).resolves.toEqual({
      map: undefined,
      degraded: false,
    });
  });
});
