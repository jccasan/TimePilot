import { describe, it, expect } from "vitest";
import { calculatePrice } from "../server/services/pricing-calculator";
import { computeJobEconomics } from "../server/services/job-economics-engine";
import { calculateRouteEconomics } from "../server/services/planner/routeEconomics";
import type { RoutePlannerSettings } from "../server/services/planner/types";
import { DEFAULT_PRICING_CONFIG } from "@shared/schema";

const FIXED_INPUTS = {
  yardSizeAcres: 0.1,
  dogCount: 1,
  serviceFrequency: "weekly" as const,
  yardDifficulty: "flat" as const,
  distanceFromNearestStopMiles: 0.5,
};

const STANDARD_TRAVEL_MINS = 3;

describe("Cost coherence across engines", () => {
  it("pricing-calculator includes travel labor in totalCostPerVisitCentsUnrounded", () => {
    const result = calculatePrice(FIXED_INPUTS, DEFAULT_PRICING_CONFIG);
    const { breakdown } = result;

    const expectedTotal =
      breakdown.laborCostCents +
      breakdown.travelLaborCostCents +
      breakdown.adjustedTravelCostCents +
      breakdown.equipmentCostCents +
      breakdown.overheadPerVisitCents;

    expect(Math.abs(result.totalCostPerVisitCentsUnrounded - expectedTotal)).toBeLessThan(5);
  });

  it("minimumPriceCents is the dollar-rounded version of totalCostPerVisitCentsUnrounded", () => {
    const result = calculatePrice(FIXED_INPUTS, DEFAULT_PRICING_CONFIG);
    const rounded = Math.round(result.totalCostPerVisitCentsUnrounded / 100) * 100;
    expect(result.minimumPriceCents).toBe(rounded);
  });

  it("travelLaborCostCents is (adjustedTravelMinutes / 60) * fullyBurdenedRate", () => {
    const result = calculatePrice(FIXED_INPUTS, DEFAULT_PRICING_CONFIG);
    const { breakdown } = result;
    const fullyBurdenedRate =
      DEFAULT_PRICING_CONFIG.techHourlyWageCents * DEFAULT_PRICING_CONFIG.burdenMultiplier;
    const expected = (breakdown.adjustedTravelMinutes / 60) * fullyBurdenedRate;
    expect(breakdown.travelLaborCostCents).toBeCloseTo(expected, 0);
  });

  it("service labor cost in pricing-calculator agrees with job-economics-engine to within rounding", () => {
    const pricingResult = calculatePrice(
      { ...FIXED_INPUTS, overrideAdjustedTravelMinutes: STANDARD_TRAVEL_MINS },
      DEFAULT_PRICING_CONFIG
    );

    const engineResult = computeJobEconomics({
      currentPricePerVisit: pricingResult.totalCostPerVisitCentsUnrounded / 100,
      serviceMinutes: pricingResult.breakdown.serviceMinutes,
      targetTravelMinutes: STANDARD_TRAVEL_MINS,
      actualTravelMinutes: STANDARD_TRAVEL_MINS,
      actualTravelMiles: (STANDARD_TRAVEL_MINS / 60) * DEFAULT_PRICING_CONFIG.driveSpeedAverageMph,
      hourlyWage: DEFAULT_PRICING_CONFIG.techHourlyWageCents / 100,
      laborBurdenMultiplier: DEFAULT_PRICING_CONFIG.burdenMultiplier,
      vehicleCostPerMile: DEFAULT_PRICING_CONFIG.vehicleCostPerMileCents / 100,
      estimatedSuppliesPerVisit: pricingResult.breakdown.equipmentCostCents / 100,
      monthlyOverhead: 0,
      estimatedMonthlyVisits: DEFAULT_PRICING_CONFIG.estimatedMonthlyStops,
      targetMarginPercent: DEFAULT_PRICING_CONFIG.targetProfitMarginPct / 100,
    });

    const pricingServiceLaborDollars = pricingResult.breakdown.laborCostCents / 100;
    const engineServiceLaborDollars = engineResult.jobPriceHealth.serviceLaborCost;

    expect(Math.abs(pricingServiceLaborDollars - engineServiceLaborDollars)).toBeLessThan(0.02);
  });

  it("travel labor cost in pricing-calculator matches job-economics-engine travel labor", () => {
    const pricingResult = calculatePrice(
      { ...FIXED_INPUTS, overrideAdjustedTravelMinutes: STANDARD_TRAVEL_MINS },
      DEFAULT_PRICING_CONFIG
    );

    const engineResult = computeJobEconomics({
      currentPricePerVisit: pricingResult.totalCostPerVisitCentsUnrounded / 100,
      serviceMinutes: pricingResult.breakdown.serviceMinutes,
      targetTravelMinutes: STANDARD_TRAVEL_MINS,
      actualTravelMinutes: STANDARD_TRAVEL_MINS,
      actualTravelMiles: (STANDARD_TRAVEL_MINS / 60) * DEFAULT_PRICING_CONFIG.driveSpeedAverageMph,
      hourlyWage: DEFAULT_PRICING_CONFIG.techHourlyWageCents / 100,
      laborBurdenMultiplier: DEFAULT_PRICING_CONFIG.burdenMultiplier,
      vehicleCostPerMile: DEFAULT_PRICING_CONFIG.vehicleCostPerMileCents / 100,
      estimatedSuppliesPerVisit: pricingResult.breakdown.equipmentCostCents / 100,
      monthlyOverhead: 0,
      estimatedMonthlyVisits: DEFAULT_PRICING_CONFIG.estimatedMonthlyStops,
      targetMarginPercent: DEFAULT_PRICING_CONFIG.targetProfitMarginPct / 100,
    });

    const pricingTravelLaborDollars = pricingResult.breakdown.travelLaborCostCents / 100;
    const engineTravelLaborDollars = engineResult.jobPriceHealth.targetTravelLaborCost;

    expect(Math.abs(pricingTravelLaborDollars - engineTravelLaborDollars)).toBeLessThan(0.02);
  });

  it("vehicle cost in pricing-calculator matches job-economics-engine vehicle cost", () => {
    const pricingResult = calculatePrice(
      { ...FIXED_INPUTS, overrideAdjustedTravelMinutes: STANDARD_TRAVEL_MINS },
      DEFAULT_PRICING_CONFIG
    );

    const travelMiles = (STANDARD_TRAVEL_MINS / 60) * DEFAULT_PRICING_CONFIG.driveSpeedAverageMph;

    const engineResult = computeJobEconomics({
      currentPricePerVisit: pricingResult.totalCostPerVisitCentsUnrounded / 100,
      serviceMinutes: pricingResult.breakdown.serviceMinutes,
      targetTravelMinutes: STANDARD_TRAVEL_MINS,
      actualTravelMinutes: STANDARD_TRAVEL_MINS,
      actualTravelMiles: travelMiles,
      hourlyWage: DEFAULT_PRICING_CONFIG.techHourlyWageCents / 100,
      laborBurdenMultiplier: DEFAULT_PRICING_CONFIG.burdenMultiplier,
      vehicleCostPerMile: DEFAULT_PRICING_CONFIG.vehicleCostPerMileCents / 100,
      estimatedSuppliesPerVisit: pricingResult.breakdown.equipmentCostCents / 100,
      monthlyOverhead: 0,
      estimatedMonthlyVisits: DEFAULT_PRICING_CONFIG.estimatedMonthlyStops,
      targetMarginPercent: DEFAULT_PRICING_CONFIG.targetProfitMarginPct / 100,
    });

    const pricingVehicleDollars = pricingResult.breakdown.adjustedTravelCostCents / 100;
    const engineVehicleDollars = engineResult.jobPriceHealth.targetTravelVehicleCost;

    expect(Math.abs(pricingVehicleDollars - engineVehicleDollars)).toBeLessThan(0.02);
  });

  it("density multiplier uses baselineStopsPerMile config field (not estimatedMonthlyStops/30)", () => {
    const routeStopsPerMile = 2.0;

    const resultWithDefault = calculatePrice(
      { ...FIXED_INPUTS, routeStopsPerMile },
      DEFAULT_PRICING_CONFIG
    );

    const resultWithCustomBaseline = calculatePrice(
      { ...FIXED_INPUTS, routeStopsPerMile },
      { ...DEFAULT_PRICING_CONFIG, baselineStopsPerMile: 6.0 }
    );

    const multiplierDefault = resultWithDefault.breakdown.densityMultiplier;
    const multiplierCustom = resultWithCustomBaseline.breakdown.densityMultiplier;

    expect(multiplierDefault).toBeCloseTo(
      DEFAULT_PRICING_CONFIG.baselineStopsPerMile / routeStopsPerMile,
      3
    );
    expect(multiplierCustom).toBeCloseTo(Math.min(1.8, 6.0 / routeStopsPerMile), 3);
    expect(multiplierCustom).toBeGreaterThan(multiplierDefault);
  });

  it("calculateRouteEconomics service labor agrees with pricing-calculator to within rounding", () => {
    const pricingResult = calculatePrice(
      { ...FIXED_INPUTS, overrideAdjustedTravelMinutes: STANDARD_TRAVEL_MINS },
      DEFAULT_PRICING_CONFIG
    );

    const travelMiles = (STANDARD_TRAVEL_MINS / 60) * DEFAULT_PRICING_CONFIG.driveSpeedAverageMph;
    const fullyBurdenedDollars =
      (DEFAULT_PRICING_CONFIG.techHourlyWageCents / 100) * DEFAULT_PRICING_CONFIG.burdenMultiplier;

    const minimalSettings: Pick<
      RoutePlannerSettings,
      | "laborCostPerHour"
      | "averageGasPricePerGallon"
      | "vehicleMilesPerGallon"
      | "useFuelOnlyCost"
      | "vehicleCostPerMile"
      | "includeDriveLaborInProfitability"
      | "includeFuelCostInProfitability"
      | "minimumRouteProfitMargin"
    > = {
      laborCostPerHour: fullyBurdenedDollars,
      averageGasPricePerGallon: DEFAULT_PRICING_CONFIG.averageGasPriceCentsPerGallon / 100,
      vehicleMilesPerGallon: DEFAULT_PRICING_CONFIG.vehicleMPG ?? 20,
      useFuelOnlyCost: false,
      vehicleCostPerMile: DEFAULT_PRICING_CONFIG.vehicleCostPerMileCents / 100,
      includeDriveLaborInProfitability: true,
      includeFuelCostInProfitability: true,
      minimumRouteProfitMargin: 0.1,
    };

    const routeResult = calculateRouteEconomics(
      {
        assignedStops: [
          {
            customerId: "test",
            revenuePerVisit: pricingResult.recommendedPriceCents / 100,
            serviceMinutes: pricingResult.breakdown.serviceMinutes,
          } as Parameters<typeof calculateRouteEconomics>[0]["assignedStops"][0],
        ],
        totalServiceMinutes: pricingResult.breakdown.serviceMinutes,
        totalDriveMinutes: STANDARD_TRAVEL_MINS,
        totalRouteMinutes: pricingResult.breakdown.serviceMinutes + STANDARD_TRAVEL_MINS,
        estimatedMiles: travelMiles,
      },
      minimalSettings as RoutePlannerSettings
    );

    const pricingServiceLaborDollars = pricingResult.breakdown.laborCostCents / 100;
    const pricingTravelLaborDollars = pricingResult.breakdown.travelLaborCostCents / 100;
    const pricingVehicleDollars = pricingResult.breakdown.adjustedTravelCostCents / 100;

    expect(Math.abs(routeResult.serviceLaborCost - pricingServiceLaborDollars)).toBeLessThan(0.02);
    expect(Math.abs(routeResult.driveLaborCost - pricingTravelLaborDollars)).toBeLessThan(0.02);
    expect(Math.abs((routeResult.vehicleCost ?? 0) - pricingVehicleDollars)).toBeLessThan(0.02);
  });

  it("profitability costBreakdown components reconcile to totalCostPerVisitCentsUnrounded within rounding", () => {
    const result = calculatePrice(FIXED_INPUTS, DEFAULT_PRICING_CONFIG);
    const { breakdown } = result;

    const breakdownSum =
      breakdown.laborCostCents +
      breakdown.travelLaborCostCents +
      breakdown.adjustedTravelCostCents +
      breakdown.equipmentCostCents +
      breakdown.overheadPerVisitCents;

    expect(Math.abs(breakdownSum - result.totalCostPerVisitCentsUnrounded)).toBeLessThan(5);
  });
});
