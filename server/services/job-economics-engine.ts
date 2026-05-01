export interface JobEconomicsInputs {
  currentPricePerVisit: number;
  serviceMinutes: number;
  targetTravelMinutes: number;
  actualTravelMinutes: number;
  actualTravelMiles: number;
  hourlyWage: number;
  laborBurdenMultiplier: number;
  vehicleCostPerMile: number;
  estimatedSuppliesPerVisit: number;
  monthlyOverhead: number;
  estimatedMonthlyVisits: number;
  targetMarginPercent: number;
}

export interface JobEconomicsResult {
  inputs: JobEconomicsInputs & { fullyLoadedLaborRate: number };
  jobPriceHealth: {
    serviceLaborCost: number;
    targetTravelLaborCost: number;
    targetTravelVehicleCost: number;
    targetTravelCost: number;
    allocatedOverheadPerVisit: number;
    targetCostPerVisit: number;
    recommendedPrice: number;
    requiredPriceChange: number;
    projectedMargin: number;
    targetTravelMiles: number | null;
  };
  currentRouteProfitability: {
    serviceLaborCost: number;
    actualTravelLaborCost: number;
    actualTravelVehicleCost: number;
    actualTravelCost: number;
    allocatedOverheadPerVisit: number;
    actualCostPerVisit: number;
    actualProfitPerVisit: number | null;
    actualMargin: number | null;
    actualRevenuePerHour: number | null;
    actualProfitPerHour: number | null;
  };
  routeDensityOpportunity: {
    targetTravelMinutes: number;
    actualTravelMinutes: number;
    targetTravelMiles: number | null;
    excessTravelMinutes: number;
    excessTravelLaborCost: number;
    excessTravelVehicleCost: number;
    excessTravelCost: number;
    recommendedAction: string;
  };
  warnings: string[];
}

export function computeJobEconomics(raw: Partial<JobEconomicsInputs>): JobEconomicsResult {
  const warnings: string[] = [];

  const serviceMinutes = (() => {
    if (raw.serviceMinutes == null || raw.serviceMinutes <= 0) {
      warnings.push("Service minutes defaulted to 10.");
      return 10;
    }
    return raw.serviceMinutes;
  })();

  const hourlyWage = (() => {
    if (raw.hourlyWage == null || raw.hourlyWage <= 0) {
      warnings.push("Hourly wage defaulted to $15/hr.");
      return 15;
    }
    return raw.hourlyWage;
  })();

  const laborBurdenMultiplier = (() => {
    if (raw.laborBurdenMultiplier == null || raw.laborBurdenMultiplier <= 0) {
      warnings.push("Labor burden defaulted to 1.4x.");
      return 1.4;
    }
    return raw.laborBurdenMultiplier;
  })();

  const targetMarginPercent = raw.targetMarginPercent ?? 0.31;
  const targetTravelMinutes = raw.targetTravelMinutes ?? 3;
  const actualTravelMinutes = raw.actualTravelMinutes ?? 0;
  const actualTravelMiles = raw.actualTravelMiles ?? 0;
  const vehicleCostPerMile = raw.vehicleCostPerMile ?? 0.65;
  const estimatedSuppliesPerVisit = raw.estimatedSuppliesPerVisit ?? 0;
  const monthlyOverhead = raw.monthlyOverhead ?? 0;
  const estimatedMonthlyVisits = raw.estimatedMonthlyVisits ?? 0;

  const currentPricePerVisit = raw.currentPricePerVisit ?? 0;
  const hasMissingPrice = currentPricePerVisit <= 0;
  if (hasMissingPrice) {
    warnings.push("Current price is missing, so actual profit and margin cannot be calculated.");
  }

  const fullyLoadedLaborRate = hourlyWage * laborBurdenMultiplier;

  let allocatedOverheadPerVisit = 0;
  if (estimatedMonthlyVisits <= 0) {
    if (monthlyOverhead > 0) {
      warnings.push(
        "Monthly overhead exists but cannot be allocated without estimated monthly visits."
      );
    } else {
      warnings.push("Overhead allocation unavailable because estimated monthly visits is missing.");
    }
  } else {
    allocatedOverheadPerVisit = monthlyOverhead / estimatedMonthlyVisits;
  }

  const serviceLaborCost = (serviceMinutes / 60) * fullyLoadedLaborRate;

  const targetTravelLaborCost = (targetTravelMinutes / 60) * fullyLoadedLaborRate;

  let targetTravelMiles: number | null = null;
  let targetTravelVehicleCost = 0;
  if (actualTravelMinutes > 0) {
    targetTravelMiles = actualTravelMiles * (targetTravelMinutes / actualTravelMinutes);
    targetTravelVehicleCost = targetTravelMiles * vehicleCostPerMile;
  } else {
    warnings.push("Target travel mileage unavailable.");
  }

  const targetTravelCost = targetTravelLaborCost + targetTravelVehicleCost;
  const targetCostPerVisit =
    serviceLaborCost + targetTravelCost + estimatedSuppliesPerVisit + allocatedOverheadPerVisit;

  const margin = Math.max(0, Math.min(0.9999, targetMarginPercent));
  const rawRecommendedPrice = targetCostPerVisit / (1 - margin);
  const recommendedPrice = Math.ceil(rawRecommendedPrice);
  const requiredPriceChange = recommendedPrice - currentPricePerVisit;
  const projectedMargin =
    recommendedPrice > 0 ? (recommendedPrice - targetCostPerVisit) / recommendedPrice : 0;

  const variableCostsExOverhead = serviceLaborCost + targetTravelCost + estimatedSuppliesPerVisit;
  if (allocatedOverheadPerVisit > variableCostsExOverhead && allocatedOverheadPerVisit > 0) {
    warnings.push("High overhead allocation. Check monthly visits and overhead assumptions.");
  }

  const actualTravelLaborCost = (actualTravelMinutes / 60) * fullyLoadedLaborRate;
  const actualTravelVehicleCost = actualTravelMiles * vehicleCostPerMile;
  const actualTravelCost = actualTravelLaborCost + actualTravelVehicleCost;
  const actualCostPerVisit =
    serviceLaborCost + actualTravelCost + estimatedSuppliesPerVisit + allocatedOverheadPerVisit;

  let actualProfitPerVisit: number | null = null;
  let actualMargin: number | null = null;
  let actualRevenuePerHour: number | null = null;
  let actualProfitPerHour: number | null = null;

  if (!hasMissingPrice) {
    actualProfitPerVisit = currentPricePerVisit - actualCostPerVisit;
    actualMargin = actualProfitPerVisit / currentPricePerVisit;
    const actualJobMinutes = serviceMinutes + actualTravelMinutes;
    if (actualJobMinutes > 0) {
      actualRevenuePerHour = currentPricePerVisit / (actualJobMinutes / 60);
      actualProfitPerHour = actualProfitPerVisit / (actualJobMinutes / 60);
    }
  }

  const excessTravelMinutes = Math.max(actualTravelMinutes - targetTravelMinutes, 0);
  const excessTravelLaborCost = (excessTravelMinutes / 60) * fullyLoadedLaborRate;

  let excessTravelVehicleCost = 0;
  if (targetTravelMiles !== null) {
    const excessMiles = Math.max(actualTravelMiles - targetTravelMiles, 0);
    excessTravelVehicleCost = excessMiles * vehicleCostPerMile;
  }
  const excessTravelCost = excessTravelLaborCost + excessTravelVehicleCost;

  let recommendedAction: string;
  if (hasMissingPrice) {
    recommendedAction = "Set customer price first.";
  } else if (
    actualMargin !== null &&
    actualMargin < targetMarginPercent &&
    excessTravelMinutes > 5
  ) {
    recommendedAction = "Move this job to a denser route/day before raising the customer's price.";
  } else if (
    actualMargin !== null &&
    actualMargin < targetMarginPercent &&
    excessTravelMinutes <= 5
  ) {
    recommendedAction = "Raise price or reduce service cost.";
  } else {
    recommendedAction = "Keep price. Route position is acceptable.";
  }

  return {
    inputs: {
      currentPricePerVisit,
      serviceMinutes,
      targetTravelMinutes,
      actualTravelMinutes,
      actualTravelMiles,
      hourlyWage,
      laborBurdenMultiplier,
      fullyLoadedLaborRate,
      vehicleCostPerMile,
      estimatedSuppliesPerVisit,
      monthlyOverhead,
      estimatedMonthlyVisits,
      targetMarginPercent,
    },
    jobPriceHealth: {
      serviceLaborCost,
      targetTravelLaborCost,
      targetTravelVehicleCost,
      targetTravelCost,
      allocatedOverheadPerVisit,
      targetCostPerVisit,
      recommendedPrice,
      requiredPriceChange,
      projectedMargin,
      targetTravelMiles,
    },
    currentRouteProfitability: {
      serviceLaborCost,
      actualTravelLaborCost,
      actualTravelVehicleCost,
      actualTravelCost,
      allocatedOverheadPerVisit,
      actualCostPerVisit,
      actualProfitPerVisit,
      actualMargin,
      actualRevenuePerHour,
      actualProfitPerHour,
    },
    routeDensityOpportunity: {
      targetTravelMinutes,
      actualTravelMinutes,
      targetTravelMiles,
      excessTravelMinutes,
      excessTravelLaborCost,
      excessTravelVehicleCost,
      excessTravelCost,
      recommendedAction,
    },
    warnings,
  };
}
