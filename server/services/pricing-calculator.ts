import { type PricingConfig, DEFAULT_PRICING_CONFIG } from "@shared/schema";

export interface PriceCalculatorInputs {
  yardSizeAcres: number;
  dogCount: number;
  serviceFrequency: "weekly" | "biweekly" | "monthly" | "onetime";
  yardDifficulty: "flat" | "moderate" | "difficult";
  distanceFromNearestStopMiles: number;
  routeStopsPerMile?: number;
  currentPriceCents?: number;
}

export interface PriceBreakdown {
  serviceMinutes: number;
  travelMinutes: number;
  adjustedTravelMinutes: number;
  densityMultiplier: number;
  laborCostCents: number;
  travelCostCents: number;
  adjustedTravelCostCents: number;
  equipmentCostCents: number;
  overheadPerVisitCents: number;
}

export interface PriceDerived {
  jobMinutes: number;
  profitAtRecommendedCents: number;
  profitPerHourAtRecommendedCents: number;
  clusterDiscountAppliedPct: number;
  marketAnchorClamped: boolean;
  isEstimated: boolean;
}

export interface PriceCalculatorResult {
  minimumPriceCents: number;
  recommendedPriceCents: number;
  premiumPriceCents: number;
  inputsUsed: PriceCalculatorInputs & { configSnapshot: Partial<PricingConfig> };
  breakdown: PriceBreakdown;
  derived: PriceDerived;
  profitWarning?: {
    message: string;
    lossPerVisitCents: number;
    profitPerVisitCents: number;
    profitPerHourCents: number;
  };
}

export function getEffectivePricingConfig(tenantConfig: Partial<PricingConfig> | null | undefined): PricingConfig {
  return { ...DEFAULT_PRICING_CONFIG, ...(tenantConfig || {}) };
}

function getFrequencyMultiplier(config: PricingConfig, frequency: string): number {
  switch (frequency) {
    case "weekly": return config.weeklyMultiplier;
    case "biweekly": return config.biweeklyMultiplier;
    case "monthly": return config.monthlyMultiplier;
    case "onetime": return config.oneTimeMultiplier;
    default: return 1.0;
  }
}

function getDifficultyMultiplier(config: PricingConfig, difficulty: string): number {
  switch (difficulty) {
    case "flat": return config.difficultyFlat;
    case "moderate": return config.difficultyModerate;
    case "difficult": return config.difficultyDifficult;
    default: return 1.0;
  }
}

function getTargetMarginForMode(config: PricingConfig): number {
  return config.targetProfitMarginPct;
}

function roundToNearestDollar(cents: number): number {
  return Math.round(cents / 100) * 100;
}

export function calculatePrice(
  inputs: PriceCalculatorInputs,
  tenantConfig: Partial<PricingConfig> | null | undefined,
  overrideMonthlyOverheadCents?: number
): PriceCalculatorResult {
  const config = getEffectivePricingConfig(tenantConfig);
  const SMALL_EPSILON = 0.01;

  const serviceMinutesBase = (inputs.yardSizeAcres / 0.1) * config.baseTimePerTenthAcreMinutes;
  const extraDogMinutes = Math.max(inputs.dogCount - 1, 0) * config.extraDogMinutesAfterFirst;
  let serviceMinutes = Math.max(config.minimumServiceMinutesFloor, serviceMinutesBase + extraDogMinutes);
  serviceMinutes *= getFrequencyMultiplier(config, inputs.serviceFrequency);
  serviceMinutes *= getDifficultyMultiplier(config, inputs.yardDifficulty);

  const travelMinutes = (inputs.distanceFromNearestStopMiles / config.driveSpeedAverageMph) * 60;

  let densityMultiplier = 1.0;
  const isEstimated = !inputs.routeStopsPerMile;
  if (inputs.routeStopsPerMile && inputs.routeStopsPerMile > 0) {
    const baselineStopsPerMile = config.estimatedMonthlyStops > 0 ? config.estimatedMonthlyStops / 30 : 3;
    densityMultiplier = baselineStopsPerMile / Math.max(inputs.routeStopsPerMile, SMALL_EPSILON);
    densityMultiplier = Math.max(0.6, Math.min(1.8, densityMultiplier));
  }

  const adjustedTravelMinutes = travelMinutes * densityMultiplier;

  let travelCostCents: number;
  if (config.vehicleCostPerMileCents > 0) {
    travelCostCents = inputs.distanceFromNearestStopMiles * config.vehicleCostPerMileCents;
  } else if (config.vehicleMPG && config.vehicleMPG > 0) {
    const fuelCostPerMileCents = config.averageGasPriceCentsPerGallon / config.vehicleMPG;
    travelCostCents = inputs.distanceFromNearestStopMiles * fuelCostPerMileCents;
  } else {
    travelCostCents = inputs.distanceFromNearestStopMiles * 65;
  }
  const adjustedTravelCostCents = travelCostCents * densityMultiplier;

  const fullyBurdenedRateCentsPerHour = config.techHourlyWageCents * config.burdenMultiplier;
  const jobMinutes = serviceMinutes + adjustedTravelMinutes;
  const laborCostCents = (jobMinutes / 60) * fullyBurdenedRateCentsPerHour;

  const equipmentCostCents = config.disinfectantCents + config.deodorizerCents + config.bagsCents;

  const monthlyOverheadCents = overrideMonthlyOverheadCents !== undefined
    ? overrideMonthlyOverheadCents
    : (config.advertisingCents +
       config.payrollProviderCents +
       config.benefitsCents +
       config.insuranceCents +
       config.softwareCents +
       config.otherOverheadCents);
  const estimatedMonthlyStops = Math.max(config.estimatedMonthlyStops, 1);
  const overheadPerVisitCents = monthlyOverheadCents / estimatedMonthlyStops;

  const totalCostPerVisitCents = laborCostCents + adjustedTravelCostCents + equipmentCostCents + overheadPerVisitCents;

  const targetMargin = getTargetMarginForMode(config) / 100;
  const minimumPriceCents = totalCostPerVisitCents;
  let recommendedPriceCents = minimumPriceCents / (1 - targetMargin);
  let premiumPriceCents = minimumPriceCents / (1 - config.premiumMarginPct / 100);

  let clusterDiscountAppliedPct = 0;
  if (inputs.distanceFromNearestStopMiles <= 0.02) {
    clusterDiscountAppliedPct = config.clusterDiscountPct2;
  } else if (inputs.distanceFromNearestStopMiles <= 0.05) {
    clusterDiscountAppliedPct = config.clusterDiscountPct;
  }

  if (clusterDiscountAppliedPct > 0) {
    const discountFactor = 1 - clusterDiscountAppliedPct / 100;
    recommendedPriceCents *= discountFactor;
    premiumPriceCents *= discountFactor;
  }

  let marketAnchorClamped = false;
  if (
    config.localMarketAverageWeeklyPriceCents &&
    config.localMarketAverageWeeklyPriceCents > 0 &&
    inputs.serviceFrequency === "weekly"
  ) {
    const marketAvg = config.localMarketAverageWeeklyPriceCents;
    const tolerance = config.marketAnchorTolerancePct / 100;
    const lowerBound = marketAvg * (1 - tolerance);
    const upperBound = marketAvg * (1 + tolerance);

    if (recommendedPriceCents < lowerBound) {
      recommendedPriceCents = lowerBound;
      marketAnchorClamped = true;
    } else if (recommendedPriceCents > upperBound) {
      recommendedPriceCents = upperBound;
      marketAnchorClamped = true;
    }
  }

  const roundedMinimum = roundToNearestDollar(minimumPriceCents);
  const roundedRecommended = roundToNearestDollar(recommendedPriceCents);
  const roundedPremium = roundToNearestDollar(premiumPriceCents);

  const profitAtRecommended = roundedRecommended - roundedMinimum;
  const profitPerHourAtRecommended = jobMinutes > 0 ? (profitAtRecommended / jobMinutes) * 60 : 0;

  const breakdown: PriceBreakdown = {
    serviceMinutes: Math.round(serviceMinutes * 100) / 100,
    travelMinutes: Math.round(travelMinutes * 100) / 100,
    adjustedTravelMinutes: Math.round(adjustedTravelMinutes * 100) / 100,
    densityMultiplier: Math.round(densityMultiplier * 1000) / 1000,
    laborCostCents: Math.round(laborCostCents),
    travelCostCents: Math.round(travelCostCents),
    adjustedTravelCostCents: Math.round(adjustedTravelCostCents),
    equipmentCostCents: Math.round(equipmentCostCents),
    overheadPerVisitCents: Math.round(overheadPerVisitCents),
  };

  const derived: PriceDerived = {
    jobMinutes: Math.round(jobMinutes * 100) / 100,
    profitAtRecommendedCents: profitAtRecommended,
    profitPerHourAtRecommendedCents: Math.round(profitPerHourAtRecommended),
    clusterDiscountAppliedPct,
    marketAnchorClamped,
    isEstimated,
  };

  const result: PriceCalculatorResult = {
    minimumPriceCents: roundedMinimum,
    recommendedPriceCents: roundedRecommended,
    premiumPriceCents: roundedPremium,
    inputsUsed: { ...inputs, configSnapshot: config },
    breakdown,
    derived,
  };

  if (inputs.currentPriceCents !== undefined && inputs.currentPriceCents !== null) {
    const profitPerVisit = inputs.currentPriceCents - roundedMinimum;
    const profitPerHour = jobMinutes > 0 ? (profitPerVisit / jobMinutes) * 60 : 0;

    if (inputs.currentPriceCents < roundedMinimum) {
      const loss = roundedMinimum - inputs.currentPriceCents;
      result.profitWarning = {
        message: `Likely losing $${(loss / 100).toFixed(2)} per visit`,
        lossPerVisitCents: loss,
        profitPerVisitCents: profitPerVisit,
        profitPerHourCents: Math.round(profitPerHour),
      };
    } else {
      result.profitWarning = {
        message: `Profit: $${(profitPerVisit / 100).toFixed(2)} per visit`,
        lossPerVisitCents: 0,
        profitPerVisitCents: profitPerVisit,
        profitPerHourCents: Math.round(profitPerHour),
      };
    }
  }

  return result;
}

export function sqftToAcres(sqft: number): number {
  return sqft / 43560;
}

export function yardSizeLabelToAcres(label: string | null | undefined): number {
  if (!label) return 0.1;
  const lower = label.toLowerCase();
  if (lower.includes("small") || lower.includes("xs")) return 0.05;
  if (lower.includes("medium") || lower.includes("standard")) return 0.1;
  if (lower.includes("large") && !lower.includes("extra")) return 0.2;
  if (lower.includes("extra") || lower.includes("xl")) return 0.35;
  const numMatch = label.match(/[\d.]+/);
  if (numMatch) return parseFloat(numMatch[0]);
  return 0.1;
}
