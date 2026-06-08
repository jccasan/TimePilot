import { describe, it, expect } from "vitest";
import { calculateProratedAmount, monthlyRateForPlan } from "../server/services/proration";

// These cover the math behind beginning-of-month prepay billing:
//  - mid-month signup proration (charge remaining days of the start month)
//  - same-day (1st) signup → full month, and the proratedThrough marker that
//    prevents the 1st-of-month full charge from double-billing.

describe("prepay proration — mid-month signup", () => {
  it("prorates the remaining days of a 31-day month (signup on the 15th)", () => {
    const r = calculateProratedAmount("2026-03-15", 50);
    // 31 - 15 + 1 = 17 remaining days; 17/31 * 50 = 27.42
    expect(r.amount).toBeCloseTo(27.42, 2);
    expect(r.proratedThrough).toBe("2026-03-31");
    expect(r.regularBillingStartDate).toBe("2026-04-01");
  });

  it("prorates correctly in February (signup on the 15th, 28-day month)", () => {
    const r = calculateProratedAmount("2026-02-15", 50);
    // 28 - 15 + 1 = 14 remaining days; 14/28 * 50 = 25.00
    expect(r.amount).toBeCloseTo(25.0, 2);
    expect(r.proratedThrough).toBe("2026-02-28");
    expect(r.regularBillingStartDate).toBe("2026-03-01");
  });
});

describe("prepay proration — signup on the 1st", () => {
  it("charges a full month and marks proratedThrough to the month end", () => {
    const r = calculateProratedAmount("2026-03-01", 50);
    expect(r.amount).toBeCloseTo(50, 2);
    // proratedThrough covering the whole month is what makes the 1st-of-month
    // full-charge run skip this plan (no double billing on same-day signup).
    expect(r.proratedThrough).toBe("2026-03-31");
    expect(r.regularBillingStartDate).toBe("2026-04-01");
  });
});

describe("monthlyRateForPlan — per-visit to monthly conversion", () => {
  it("converts each frequency to a monthly rate", () => {
    expect(monthlyRateForPlan("25", "weekly")).toBe(100); // 25 * 4
    expect(monthlyRateForPlan("50", "biweekly")).toBe(100); // 50 * 2
    expect(monthlyRateForPlan("50", "monthly")).toBe(50);
  });
});
