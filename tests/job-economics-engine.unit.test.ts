import { describe, it, expect } from "vitest";
import { computeJobEconomics } from "../server/services/job-economics-engine";

const BASE = {
  serviceMinutes: 10,
  targetTravelMinutes: 3,
  actualTravelMinutes: 12,
  actualTravelMiles: 1,
  hourlyWage: 15,
  laborBurdenMultiplier: 1.4,
  vehicleCostPerMile: 0.65,
  estimatedSuppliesPerVisit: 0.13,
  monthlyOverhead: 2411,
  estimatedMonthlyVisits: 100,
  targetMarginPercent: 0.31,
};

describe("computeJobEconomics", () => {
  describe("TEST 1: Missing current price", () => {
    const result = computeJobEconomics({ ...BASE, currentPricePerVisit: 0 });

    it("actual margin is null (N/A)", () => {
      expect(result.currentRouteProfitability.actualMargin).toBeNull();
    });

    it("actual profit is null (N/A)", () => {
      expect(result.currentRouteProfitability.actualProfitPerVisit).toBeNull();
    });

    it("actual revenue per hour is null (N/A)", () => {
      expect(result.currentRouteProfitability.actualRevenuePerHour).toBeNull();
    });

    it("actual profit per hour is null (N/A)", () => {
      expect(result.currentRouteProfitability.actualProfitPerHour).toBeNull();
    });

    it("includes current price warning", () => {
      expect(result.warnings.some((w) => w.includes("Current price is missing"))).toBe(true);
    });

    it("recommended price is still calculated from target cost", () => {
      expect(result.jobPriceHealth.recommendedPrice).toBeGreaterThan(0);
    });

    it("density recommended action says set price first", () => {
      expect(result.routeDensityOpportunity.recommendedAction).toBe("Set customer price first.");
    });
  });

  describe("TEST 2: Valid current price", () => {
    const result = computeJobEconomics({ ...BASE, currentPricePerVisit: 41 });

    it("actual margin is valid (not null)", () => {
      expect(result.currentRouteProfitability.actualMargin).not.toBeNull();
    });

    it("actual profit is valid (not null)", () => {
      expect(result.currentRouteProfitability.actualProfitPerVisit).not.toBeNull();
    });

    it("actual cost includes service labor + actual travel labor + vehicle cost + supplies + overhead", () => {
      const crp = result.currentRouteProfitability;
      const expected =
        crp.serviceLaborCost +
        crp.actualTravelLaborCost +
        crp.actualTravelVehicleCost +
        result.inputs.estimatedSuppliesPerVisit +
        crp.allocatedOverheadPerVisit;
      expect(crp.actualCostPerVisit).toBeCloseTo(expected, 6);
    });

    it("service labor uses service minutes only", () => {
      const flr = 15 * 1.4;
      expect(result.currentRouteProfitability.serviceLaborCost).toBeCloseTo((10 / 60) * flr, 4);
    });

    it("actual travel labor uses actual travel minutes", () => {
      const flr = 15 * 1.4;
      expect(result.currentRouteProfitability.actualTravelLaborCost).toBeCloseTo(
        (12 / 60) * flr,
        4
      );
    });

    it("actual vehicle cost uses actual miles", () => {
      expect(result.currentRouteProfitability.actualTravelVehicleCost).toBeCloseTo(1 * 0.65, 4);
    });

    it("does not show fake 0% margin", () => {
      expect(result.currentRouteProfitability.actualMargin).not.toBe(0);
    });
  });

  describe("TEST 3: High overhead (100 visits)", () => {
    const result = computeJobEconomics({
      ...BASE,
      currentPricePerVisit: 41,
      estimatedMonthlyVisits: 100,
    });

    it("overhead per visit is ~24.11", () => {
      expect(result.jobPriceHealth.allocatedOverheadPerVisit).toBeCloseTo(24.11, 1);
    });

    it("high overhead warning shown", () => {
      expect(result.warnings.some((w) => w.includes("High overhead"))).toBe(true);
    });
  });

  describe("TEST 4: Scaled overhead (600 visits)", () => {
    const result = computeJobEconomics({
      ...BASE,
      currentPricePerVisit: 41,
      estimatedMonthlyVisits: 600,
    });

    it("overhead per visit is ~4.02", () => {
      expect(result.jobPriceHealth.allocatedOverheadPerVisit).toBeCloseTo(4.02, 1);
    });

    it("recommended price is much lower than high-overhead case", () => {
      const highOverheadResult = computeJobEconomics({
        ...BASE,
        currentPricePerVisit: 41,
        estimatedMonthlyVisits: 100,
      });
      expect(result.jobPriceHealth.recommendedPrice).toBeLessThan(
        highOverheadResult.jobPriceHealth.recommendedPrice
      );
    });
  });

  describe("TEST 5: Route density problem (excess travel > 5 min)", () => {
    const result = computeJobEconomics({
      ...BASE,
      currentPricePerVisit: 35,
      targetTravelMinutes: 3,
      actualTravelMinutes: 15,
    });

    it("excess travel minutes is 12", () => {
      expect(result.routeDensityOpportunity.excessTravelMinutes).toBe(12);
    });

    it("recommends moving to denser route before raising price", () => {
      expect(result.routeDensityOpportunity.recommendedAction).toContain(
        "Move this job to a denser route"
      );
    });
  });

  describe("TEST 6: Underpriced (low margin but low excess travel)", () => {
    const result = computeJobEconomics({
      ...BASE,
      currentPricePerVisit: 25,
      targetTravelMinutes: 3,
      actualTravelMinutes: 4,
    });

    it("excess travel minutes is 1 (below threshold)", () => {
      expect(result.routeDensityOpportunity.excessTravelMinutes).toBe(1);
    });

    it("recommends raising price or reducing service cost", () => {
      expect(result.routeDensityOpportunity.recommendedAction).toBe(
        "Raise price or reduce service cost."
      );
    });
  });

  describe("Formula correctness", () => {
    it("fullyLoadedLaborRate = hourlyWage * laborBurdenMultiplier", () => {
      const result = computeJobEconomics({ ...BASE, currentPricePerVisit: 41 });
      expect(result.inputs.fullyLoadedLaborRate).toBeCloseTo(15 * 1.4, 6);
    });

    it("recommendedPrice uses target cost / (1 - margin), rounded up to $1", () => {
      const result = computeJobEconomics({ ...BASE, currentPricePerVisit: 41 });
      const rawRec = result.jobPriceHealth.targetCostPerVisit / (1 - 0.31);
      expect(result.jobPriceHealth.recommendedPrice).toBe(Math.ceil(rawRec));
    });

    it("projectedMargin = (recommendedPrice - targetCost) / recommendedPrice", () => {
      const result = computeJobEconomics({ ...BASE, currentPricePerVisit: 41 });
      const { recommendedPrice, targetCostPerVisit, projectedMargin } = result.jobPriceHealth;
      expect(projectedMargin).toBeCloseTo(
        (recommendedPrice - targetCostPerVisit) / recommendedPrice,
        6
      );
    });

    it("targetTravelMiles is proportional to actual when actualTravelMinutes > 0", () => {
      const result = computeJobEconomics({ ...BASE, currentPricePerVisit: 41 });
      const expected = 1 * (3 / 12);
      expect(result.jobPriceHealth.targetTravelMiles).toBeCloseTo(expected, 6);
    });

    it("excessTravelCost = excessTravelLaborCost + excessTravelVehicleCost", () => {
      const result = computeJobEconomics({
        ...BASE,
        currentPricePerVisit: 35,
        actualTravelMinutes: 15,
      });
      const rdo = result.routeDensityOpportunity;
      expect(rdo.excessTravelCost).toBeCloseTo(
        rdo.excessTravelLaborCost + rdo.excessTravelVehicleCost,
        6
      );
    });

    it("overhead allocation = 0 when estimatedMonthlyVisits is 0 and includes warning", () => {
      const result = computeJobEconomics({
        ...BASE,
        currentPricePerVisit: 41,
        estimatedMonthlyVisits: 0,
      });
      expect(result.jobPriceHealth.allocatedOverheadPerVisit).toBe(0);
      expect(result.warnings.some((w) => w.includes("monthly visits"))).toBe(true);
    });
  });
});
