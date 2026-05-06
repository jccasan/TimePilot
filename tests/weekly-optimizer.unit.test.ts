import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../server/services/routific", () => ({
  routificOptimize: vi.fn().mockResolvedValue(null),
}));

import { analyzeWeeklySchedule, mergeSmallClusters } from "../server/services/weekly-optimizer";
import type { WeeklyStop } from "../server/services/weekly-optimizer";
import * as routificModule from "../server/services/routific";

function makeStop(id: string, lat: number, lng: number, day = "monday"): WeeklyStop {
  return {
    id,
    servicePlanId: id,
    contactId: `contact-${id}`,
    contactName: `Contact ${id}`,
    propertyId: `prop-${id}`,
    address: `${id} Main St`,
    latitude: lat,
    longitude: lng,
    currentDay: day,
    currentRouteId: null,
    currentStopOrder: 0,
    zipCode: null,
  };
}

function makeGrid(count: number, baseLat = 40.0, baseLng = -80.0): WeeklyStop[] {
  return Array.from({ length: count }, (_, i) =>
    makeStop(`stop-${i}`, baseLat + (i % 10) * 0.01, baseLng + Math.floor(i / 10) * 0.01)
  );
}

function makeCluster(
  prefix: string,
  count: number,
  centerLat: number,
  centerLng: number
): WeeklyStop[] {
  return Array.from({ length: count }, (_, i) =>
    makeStop(`${prefix}-${i}`, centerLat + i * 0.001, centerLng + i * 0.001)
  );
}

function activeDayCount(days: { totalStops: number }[]): number {
  return days.filter((d) => d.totalStops > 0).length;
}

describe("capacity-first route scheduling", () => {
  it("uses exactly ceil(N / maxStopsPerDay) days for a clean divisor", async () => {
    // 10 stops, max 5/day → requiredRouteDays = 2 → exactly 2 active days
    const stops = makeGrid(10);
    const result = await analyzeWeeklySchedule(stops, undefined, { maxStopsPerDay: 5 });
    const active = activeDayCount(result.proposed.days);
    expect(active).toBe(2);
    expect(result.proposed.totalStops).toBe(10);
  });

  it("packs stops into fewer days than available when capacity allows", async () => {
    // 6 stops, max 3/day → requiredRouteDays = 2 → exactly 2 active days (not 5)
    const stops = makeGrid(6);
    const result = await analyzeWeeklySchedule(stops, undefined, { maxStopsPerDay: 3 });
    const active = activeDayCount(result.proposed.days);
    expect(active).toBe(2);
    expect(result.proposed.totalStops).toBe(6);
  });

  it("does not exceed required route-days for a non-divisor stop count", async () => {
    // 11 stops, max 5/day → requiredRouteDays = 3 → exactly 3 active days
    const stops = makeGrid(11);
    const result = await analyzeWeeklySchedule(stops, undefined, { maxStopsPerDay: 5 });
    const requiredRouteDays = Math.ceil(11 / 5);
    const active = activeDayCount(result.proposed.days);
    expect(active).toBe(requiredRouteDays);
    expect(result.proposed.totalStops).toBe(11);
  });

  it("never spreads all stops across all 5 days when only 2 days are needed", async () => {
    // 8 stops, max 5/day → requiredRouteDays = 2 → exactly 2 active days, not 5
    const stops = makeGrid(8);
    const result = await analyzeWeeklySchedule(stops, undefined, { maxStopsPerDay: 5 });
    const active = activeDayCount(result.proposed.days);
    expect(active).toBe(2);
    expect(result.proposed.totalStops).toBe(8);
  });

  it("preserves all stops in proposed output regardless of clustering", async () => {
    const stops = makeGrid(20);
    const result = await analyzeWeeklySchedule(stops, undefined, { maxStopsPerDay: 7 });
    expect(result.proposed.totalStops).toBe(20);
  });
});

describe("under-minimum cluster enforcement", () => {
  it("merges a geographically isolated small cluster below minStopsPerDay into the nearest cluster with capacity", async () => {
    // 20 stops tightly grouped in one area + 3 stops far away (isolated small cluster).
    // With minStopsPerDay=5, the 3-stop isolated cluster should be merged into a neighbour.
    const mainGroup = makeCluster("main", 20, 40.0, -80.0);
    const isolated = makeCluster("iso", 3, 41.5, -75.0); // ~200 km away
    const stops = [...mainGroup, ...isolated];

    const result = await analyzeWeeklySchedule(stops, undefined, {
      maxStopsPerDay: 15,
      minStopsPerDay: 5,
    });

    // No day should have fewer than minStopsPerDay stops
    const activeDays = result.proposed.days.filter((d) => d.totalStops > 0);
    for (const day of activeDays) {
      expect(day.totalStops).toBeGreaterThanOrEqual(5);
    }
    // All stops must be preserved
    expect(result.proposed.totalStops).toBe(23);
  });

  it("never loses stops when all clusters are at or near capacity", async () => {
    // 30 stops filling 3 clusters of exactly 10, max 10/day, min 8/day.
    // All clusters are at capacity so the enforcement pass has nowhere to redistribute
    // without going over — stops must still be preserved (no silent drops).
    const stops = makeGrid(30);
    const result = await analyzeWeeklySchedule(stops, undefined, {
      maxStopsPerDay: 10,
      minStopsPerDay: 8,
    });
    expect(result.proposed.totalStops).toBe(30);
  });

  it("mergeSmallClusters absorbs a sub-minimum cluster into nearest neighbour", () => {
    // Direct unit test for the exported mergeSmallClusters function.
    // Three clusters: large (10), medium (8), tiny (2). minSize=5.
    // Tiny cluster should be absorbed into one of the larger ones.
    const large = makeCluster("lg", 10, 40.0, -80.0);
    const medium = makeCluster("md", 8, 40.1, -80.1);
    const tiny = makeCluster("sm", 2, 40.05, -80.05); // close to both

    const merged = mergeSmallClusters([large, medium, tiny], 5);

    // Tiny cluster (size 2) is below minSize=5, so only 2 clusters should remain
    expect(merged.length).toBe(2);
    // Total stop count must be preserved
    const totalStops = merged.reduce((sum, c) => sum + c.length, 0);
    expect(totalStops).toBe(20);
    // Every remaining cluster should be at or above minSize
    for (const cluster of merged) {
      expect(cluster.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("mergeSmallClusters does not drop any stops when all clusters are small", () => {
    // Edge case: every cluster is below minSize — they should all merge into one
    const a = makeCluster("a", 2, 40.0, -80.0);
    const b = makeCluster("b", 3, 40.1, -80.0);
    const c = makeCluster("c", 2, 40.2, -80.0);

    const merged = mergeSmallClusters([a, b, c], 5);

    const totalStops = merged.reduce((sum, cl) => sum + cl.length, 0);
    expect(totalStops).toBe(7);
  });
});

describe("optimizeStopOrder fallback behavior", () => {
  const mockedRoutificOptimize = routificModule.routificOptimize as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockedRoutificOptimize.mockResolvedValue(null);
  });

  it("preserves all stops when routificOptimize returns null (fallback active)", async () => {
    mockedRoutificOptimize.mockResolvedValue(null);
    const stops = makeGrid(6);
    const result = await analyzeWeeklySchedule(stops, undefined, { maxStopsPerDay: 6 });
    expect(result.proposed.totalStops).toBe(6);
  });

  it("produces a valid schedule with correct stop count when routificOptimize returns null", async () => {
    mockedRoutificOptimize.mockResolvedValue(null);
    const stops = makeGrid(8);
    const result = await analyzeWeeklySchedule(stops, undefined, { maxStopsPerDay: 4 });
    // 8 stops / 4 per day = 2 days required
    const active = result.proposed.days.filter((d) => d.totalStops > 0);
    expect(active.length).toBe(2);
    expect(result.proposed.totalStops).toBe(8);
  });

  it("calls routificOptimize for each group of stops being optimized", async () => {
    mockedRoutificOptimize.mockResolvedValue(null);
    const stops = makeGrid(4);
    await analyzeWeeklySchedule(stops, undefined, { maxStopsPerDay: 4 });
    // routificOptimize should have been invoked at least once (one day group)
    expect(mockedRoutificOptimize).toHaveBeenCalled();
  });

  it("uses orderedIds from routificOptimize result when it returns successfully", async () => {
    const stops = makeGrid(3);
    const ids = stops.map((s) => s.servicePlanId);
    const reversedIds = [...ids].reverse();

    mockedRoutificOptimize.mockResolvedValue({
      orderedIds: reversedIds,
      totalDistance: 5.0,
      totalDuration: 20,
    });

    const result = await analyzeWeeklySchedule(stops, undefined, { maxStopsPerDay: 3 });

    // Find the one active day and verify stop IDs are in the Routific-returned order
    const activeDay = result.proposed.days.find((d) => d.totalStops > 0);
    expect(activeDay).toBeDefined();
    const resultIds = activeDay!.routes
      .flatMap((r) => r.stops)
      .map((s: WeeklyStop) => s.servicePlanId);
    expect(resultIds).toEqual(reversedIds);
  });

  it("does not lose any stops across multiple day groups when routificOptimize always returns null", async () => {
    mockedRoutificOptimize.mockResolvedValue(null);
    const stops = makeGrid(10);
    const result = await analyzeWeeklySchedule(stops, undefined, { maxStopsPerDay: 5 });
    // 10 stops split across 2 days (5 per day); all must be present in output
    expect(result.proposed.totalStops).toBe(10);
  });
});
