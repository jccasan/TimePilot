// Route + stop-level profitability math.
// Stop-level numbers are advisory — never auto-removes a due customer.

import type { PlannedRoute, RoutePlannerSettings, RouteStop } from "./types";

export interface RouteEconomics {
  revenue: number;
  serviceLaborCost: number;
  driveLaborCost: number;
  fuelCost: number;
  vehicleCost?: number;
  totalCost: number;
  grossProfit: number;
  profitMargin: number;
  revenuePerRouteHour: number;
  revenuePerMile?: number;
  stopsPerMile?: number;
}

export function calculateFuelCost(estimatedMiles: number, settings: RoutePlannerSettings): number {
  const mpg = Math.max(1, settings.vehicleMilesPerGallon);
  return estimatedMiles * (settings.averageGasPricePerGallon / mpg);
}

export function calculateRouteEconomics(
  route: Pick<
    PlannedRoute,
    | "assignedStops"
    | "totalServiceMinutes"
    | "totalDriveMinutes"
    | "totalRouteMinutes"
    | "estimatedMiles"
  >,
  settings: RoutePlannerSettings
): RouteEconomics {
  const revenue = route.assignedStops.reduce((s, x) => s + x.revenuePerVisit, 0);
  const laborPerHour = settings.laborCostPerHour;

  const serviceLaborCost = (route.totalServiceMinutes / 60) * laborPerHour;
  const driveLaborCostRaw = (route.totalDriveMinutes / 60) * laborPerHour;
  const driveLaborCost = settings.includeDriveLaborInProfitability ? driveLaborCostRaw : 0;

  let fuelCost = 0;
  let vehicleCost: number | undefined;
  if (settings.useFuelOnlyCost || settings.vehicleCostPerMile === undefined) {
    fuelCost = settings.includeFuelCostInProfitability
      ? calculateFuelCost(route.estimatedMiles, settings)
      : 0;
  } else {
    vehicleCost = settings.includeFuelCostInProfitability
      ? route.estimatedMiles * settings.vehicleCostPerMile
      : 0;
  }

  const totalCost = serviceLaborCost + driveLaborCost + fuelCost + (vehicleCost ?? 0);
  const grossProfit = revenue - totalCost;
  const profitMargin = revenue > 0 ? grossProfit / revenue : 0;
  const revenuePerRouteHour =
    route.totalRouteMinutes > 0 ? revenue / (route.totalRouteMinutes / 60) : 0;
  const revenuePerMile = route.estimatedMiles > 0 ? revenue / route.estimatedMiles : undefined;
  const stopsPerMile =
    route.estimatedMiles > 0 ? route.assignedStops.length / route.estimatedMiles : undefined;

  return {
    revenue,
    serviceLaborCost,
    driveLaborCost,
    fuelCost,
    vehicleCost,
    totalCost,
    grossProfit,
    profitMargin,
    revenuePerRouteHour,
    revenuePerMile,
    stopsPerMile,
  };
}

export function calculateStopLevelProfitability(
  stops: RouteStop[],
  settings: RoutePlannerSettings
): RouteStop[] {
  const laborPerMin = settings.laborCostPerHour / 60;

  return stops.map((s) => {
    const driveCost = s.allocatedDriveCost ?? 0;
    const fuel = s.allocatedFuelCost ?? 0;
    const serviceCost = s.serviceMinutes * laborPerMin;
    const profit = s.revenuePerVisit - serviceCost - driveCost - fuel;
    const margin = s.revenuePerVisit > 0 ? profit / s.revenuePerVisit : 0;
    const warnings: string[] = [];
    if (margin < settings.minimumRouteProfitMargin) {
      warnings.push("low_stop_margin");
    }
    if ((s.allocatedDriveMinutes ?? 0) > 25) {
      warnings.push("high_drive_time_to_stop");
    }
    return {
      ...s,
      allocatedFuelCost: fuel || s.allocatedFuelCost,
      allocatedDriveCost: driveCost || s.allocatedDriveCost,
      estimatedStopProfit: profit,
      estimatedStopProfitMargin: margin,
      warnings: [...(s.warnings ?? []), ...warnings],
    };
  });
}

export function deriveRouteWarningsAndRecommendations(
  route: PlannedRoute,
  settings: RoutePlannerSettings
): { warnings: string[]; recommendations: string[] } {
  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (route.totalRouteMinutes > settings.hardMaxRouteMinutes) {
    if (settings.allowTimeOverride) {
      const cap = settings.hardMaxRouteMinutes + (settings.maxAllowedTimeOverrideMinutes ?? 0);
      if (route.totalRouteMinutes > cap) {
        warnings.push("route_exceeds_time_override_cap");
      } else {
        warnings.push("route_exceeds_hard_max_with_override");
      }
    } else {
      warnings.push("route_exceeds_hard_max");
    }
  } else if (route.totalRouteMinutes > settings.targetMaxRouteMinutes) {
    warnings.push("route_exceeds_target_max");
  }

  if (route.totalRouteMinutes < settings.minimumViableRouteMinutes) {
    warnings.push("route_underutilized");
    recommendations.push("merge_with_nearby_route");
  } else if (route.totalRouteMinutes < settings.targetMinRouteMinutes) {
    warnings.push("route_below_target_min");
    recommendations.push("consider_merging_with_nearby_route");
  }

  if (route.stopCount > settings.unusualStopCountThreshold) {
    warnings.push("unusually_high_stop_count");
  } else if (route.stopCount > settings.warnAtStopCount) {
    warnings.push("high_stop_count");
  }

  if (route.profitMargin < settings.minimumRouteProfitMargin) {
    warnings.push("low_route_margin");
    recommendations.push("raise_price_or_add_zone_surcharge");
  } else if (route.profitMargin < settings.targetRouteProfitMargin) {
    recommendations.push("review_route_for_profitability_improvements");
  }

  if (route.grossProfit < settings.minimumRouteGrossProfit) {
    warnings.push("route_below_minimum_gross_profit");
    recommendations.push("merge_or_reprice_route");
  }

  if (
    settings.minimumRevenuePerRouteHour !== undefined &&
    route.revenuePerRouteHour < settings.minimumRevenuePerRouteHour
  ) {
    warnings.push("low_revenue_per_hour");
  }

  // Drive labor share
  const driveShare = route.revenue > 0 ? route.driveLaborCost / route.revenue : 0;
  if (driveShare > 0.25) {
    warnings.push("drive_labor_consumes_too_much_revenue");
    recommendations.push("target_nearby_customers_before_expanding_area");
  }

  for (const s of route.assignedStops) {
    if (s.warnings?.includes("low_stop_margin")) {
      recommendations.push(`review_underpriced_customer:${s.customerId}`);
    }
    if (s.warnings?.includes("high_drive_time_to_stop")) {
      recommendations.push(`isolated_low_profit_stop:${s.customerId}`);
    }
  }

  return { warnings, recommendations: dedupe(recommendations) };
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
