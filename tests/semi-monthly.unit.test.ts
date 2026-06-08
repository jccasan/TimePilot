import { describe, it, expect } from "vitest";
import {
  frequencyVisitsPerMonth,
  computeSemiMonthlyVisitDates,
} from "../shared/frequency-utils";

describe("frequencyVisitsPerMonth — semi_monthly", () => {
  it("returns 2 visits/month for semi_monthly", () => {
    expect(frequencyVisitsPerMonth("semi_monthly")).toBe(2);
  });

  it("MRR for a $50/visit semi_monthly plan is $100/month", () => {
    const pricePerVisit = 50;
    const mrr = pricePerVisit * frequencyVisitsPerMonth("semi_monthly");
    expect(mrr).toBe(100);
  });

  it("keeps existing frequencies unchanged", () => {
    expect(frequencyVisitsPerMonth("weekly")).toBe(4.33);
    expect(frequencyVisitsPerMonth("biweekly")).toBe(2.17);
    expect(frequencyVisitsPerMonth("monthly")).toBe(1);
    expect(frequencyVisitsPerMonth("onetime")).toBe(1);
  });
});

describe("computeSemiMonthlyVisitDates", () => {
  const d = (s: string) => new Date(s + "T00:00:00Z");

  it("places visits on day1 and day2 in March (1 and 15)", () => {
    expect(computeSemiMonthlyVisitDates(d("2026-03-01"), d("2026-03-31"), 1, 15)).toEqual([
      "2026-03-01",
      "2026-03-15",
    ]);
  });

  it("places visits on Feb 1 and Feb 15 without crashing", () => {
    expect(computeSemiMonthlyVisitDates(d("2026-02-01"), d("2026-02-28"), 1, 15)).toEqual([
      "2026-02-01",
      "2026-02-15",
    ]);
  });

  it("clamps day2=31 to the last day of February (Feb 28)", () => {
    expect(computeSemiMonthlyVisitDates(d("2026-02-01"), d("2026-02-28"), 1, 31)).toEqual([
      "2026-02-01",
      "2026-02-28",
    ]);
  });

  it("uses the real 31st in March when day2=31", () => {
    expect(computeSemiMonthlyVisitDates(d("2026-03-01"), d("2026-03-31"), 1, 31)).toEqual([
      "2026-03-01",
      "2026-03-31",
    ]);
  });

  it("spans multiple months across a range", () => {
    expect(computeSemiMonthlyVisitDates(d("2026-01-01"), d("2026-02-28"), 1, 15)).toEqual([
      "2026-01-01",
      "2026-01-15",
      "2026-02-01",
      "2026-02-15",
    ]);
  });

  it("excludes dates outside the effective range", () => {
    // Range starts after the 1st, so only the 15th of January is included.
    expect(computeSemiMonthlyVisitDates(d("2026-01-10"), d("2026-01-31"), 1, 15)).toEqual([
      "2026-01-15",
    ]);
  });

  it("does not emit duplicate dates when both days clamp to the same day", () => {
    // day1=28, day2=31 in February both clamp to the 28th -> single visit.
    expect(computeSemiMonthlyVisitDates(d("2026-02-01"), d("2026-02-28"), 28, 31)).toEqual([
      "2026-02-28",
    ]);
  });
});
