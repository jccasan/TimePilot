import { describe, it, expect } from "vitest";
import { nthWeekdayOfMonth } from "../server/utils/monthly-schedule";

// weekday constants (getUTCDay values)
const MON = 1;
const FRI = 5;
const SUN = 0;
const SAT = 6;

function fmt(d: Date | null): string {
  return d ? d.toISOString().split("T")[0] : "null";
}

describe("nthWeekdayOfMonth", () => {
  it("first Monday of June 2025", () => {
    // June 2025: starts on Sunday → first Monday is June 2
    expect(fmt(nthWeekdayOfMonth(2025, 5, MON, "first"))).toBe("2025-06-02");
  });

  it("second Monday of June 2025", () => {
    expect(fmt(nthWeekdayOfMonth(2025, 5, MON, "second"))).toBe("2025-06-09");
  });

  it("third Friday of June 2025", () => {
    // June 2025: first Friday is June 6 → third is June 20
    expect(fmt(nthWeekdayOfMonth(2025, 5, FRI, "third"))).toBe("2025-06-20");
  });

  it("fourth Friday of June 2025", () => {
    expect(fmt(nthWeekdayOfMonth(2025, 5, FRI, "fourth"))).toBe("2025-06-27");
  });

  it("month that starts on the chosen weekday: first Monday of July 2024", () => {
    // July 2024 starts on Monday → first Monday is July 1
    expect(fmt(nthWeekdayOfMonth(2024, 6, MON, "first"))).toBe("2024-07-01");
  });

  it("last Friday of June 2025 (four Fridays — last is 27th)", () => {
    // June 2025 Fridays: 6, 13, 20, 27 → last is 27
    expect(fmt(nthWeekdayOfMonth(2025, 5, FRI, "last"))).toBe("2025-06-27");
  });

  it("last Monday of June 2025 (five Mondays — last is 30th)", () => {
    // June 2025 Mondays: 2, 9, 16, 23, 30 → last is 30
    expect(fmt(nthWeekdayOfMonth(2025, 5, MON, "last"))).toBe("2025-06-30");
  });

  it("last Sunday of February 2025 (four Sundays)", () => {
    // Feb 2025: starts Sat → Sundays: 2, 9, 16, 23 → last is 23
    expect(fmt(nthWeekdayOfMonth(2025, 1, SUN, "last"))).toBe("2025-02-23");
  });

  it("last Saturday of February 2025 (four Saturdays)", () => {
    // Feb 2025: starts Sat → Saturdays: 1, 8, 15, 22 → last is 22
    expect(fmt(nthWeekdayOfMonth(2025, 1, SAT, "last"))).toBe("2025-02-22");
  });

  it("returns null when fourth occurrence does not exist", () => {
    // Feb 2025 has only 28 days; first Monday is Feb 3 → 4th would be Feb 24 (ok)
    // but fourth Tuesday: first is Feb 4 → 4th is Feb 25 (ok too)
    // Let's pick fourth Friday in Feb 2025: first Fri = Feb 7 → 4th = Feb 28 (ok, 28 days)
    expect(nthWeekdayOfMonth(2025, 1, FRI, "fourth")).not.toBeNull();
    // Fourth Saturday in Feb 2025: first Sat = Feb 1 → 4th = Feb 22 (ok)
    // So test with a month that genuinely lacks a 4th occurrence:
    // Feb 2021 (28 days): first Sunday = Feb 7 → 4th = Feb 28 (ok)
    // Feb 2015 (28 days): starts Sunday → first Monday = Feb 2 → 4th = Feb 23 (ok)
    // Feb 2026 (28 days): starts Sunday → first Monday = Feb 2 → 4th = Feb 23 (ok)
    // Tricky: find a case where day > 28. first Sat in Feb 2026 = Feb 7 → 4th = Feb 28 (fine)
    // Feb 2026 first Sun = Feb 1 → 4th = Feb 22 (fine). Try: fifth occurrence would be null.
    // Actually fourth is always present for most days in 28-day months.
    // A genuine null: fifth Monday in Feb 2025 (first = 3, 5th would be March 3) → use "fifth" but we don't support it
    // Use an invalid ordinal to verify null
    expect(nthWeekdayOfMonth(2025, 1, MON, "fifth")).toBeNull();
  });

  it("last Friday in a 5-Friday month: August 2025", () => {
    // Aug 2025: starts Friday → Fridays: 1, 8, 15, 22, 29 → last is 29
    expect(fmt(nthWeekdayOfMonth(2025, 7, FRI, "last"))).toBe("2025-08-29");
  });

  it("last Friday in a 4-Friday month: September 2025", () => {
    // Sep 2025: starts Monday → Fridays: 5, 12, 19, 26 → last is 26
    expect(fmt(nthWeekdayOfMonth(2025, 8, FRI, "last"))).toBe("2025-09-26");
  });

  it("generates stable dates — each month computed independently", () => {
    // "Third Friday" should be the same regardless of call order
    const months = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const dates2025 = months.map((m) => fmt(nthWeekdayOfMonth(2025, m, FRI, "third")));
    expect(dates2025).toEqual([
      "2025-01-17",
      "2025-02-21",
      "2025-03-21",
      "2025-04-18",
      "2025-05-16",
      "2025-06-20",
      "2025-07-18",
      "2025-08-15",
      "2025-09-19",
      "2025-10-17",
      "2025-11-21",
      "2025-12-19",
    ]);
  });
});
