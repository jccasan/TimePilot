import { describe, it, expect } from "vitest";
import { analyzeWeeklySchedule } from "../server/services/weekly-optimizer";
import type { WeeklyStop } from "../server/services/weekly-optimizer";

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
    makeStop(
      `stop-${i}`,
      baseLat + (i % 10) * 0.01,
      baseLng + Math.floor(i / 10) * 0.01
    )
  );
}

function activeDayCount(days: { totalStops: number }[]): number {
  return days.filter((d) => d.totalStops > 0).length;
}

describe("capacity-first route scheduling", () => {
  it("uses exactly ceil(N / maxStopsPerDay) days for a clean divisor", async () => {
    const stops = makeGrid(10);
    const result = await analyzeWeeklySchedule(stops, undefined, { maxStopsPerDay: 5 });
    const active = activeDayCount(result.proposed.days);
    expect(active).toBeLessThanOrEqual(2);
    expect(result.proposed.totalStops).toBe(10);
  });

  it("packs stops into fewer days than available when capacity allows", async () => {
    const stops = makeGrid(6);
    const result = await analyzeWeeklySchedule(stops, undefined, { maxStopsPerDay: 3 });
    const active = activeDayCount(result.proposed.days);
    expect(active).toBeLessThanOrEqual(2);
    expect(result.proposed.totalStops).toBe(6);
  });

  it("does not exceed required route-days for a non-divisor stop count", async () => {
    const stops = makeGrid(11);
    const result = await analyzeWeeklySchedule(stops, undefined, { maxStopsPerDay: 5 });
    const requiredRouteDays = Math.ceil(11 / 5);
    const active = activeDayCount(result.proposed.days);
    expect(active).toBeLessThanOrEqual(requiredRouteDays);
    expect(result.proposed.totalStops).toBe(11);
  });

  it("never spreads all stops across all 5 days when only 2 days are needed", async () => {
    const stops = makeGrid(8);
    const result = await analyzeWeeklySchedule(stops, undefined, { maxStopsPerDay: 5 });
    const active = activeDayCount(result.proposed.days);
    expect(active).toBeLessThan(5);
    expect(result.proposed.totalStops).toBe(8);
  });

  it("preserves all stops in proposed output regardless of clustering", async () => {
    const stops = makeGrid(20);
    const result = await analyzeWeeklySchedule(stops, undefined, { maxStopsPerDay: 7 });
    expect(result.proposed.totalStops).toBe(20);
  });
});
