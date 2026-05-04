// Route scoring. Profitability dominates; the other axes are tiebreakers.
// Each sub-score is normalized to 0..1 so weights remain comparable.

import type { PlannedRoute, RoutePlannerSettings } from "./types";

export interface RouteScoreBreakdown {
  routeScore: number;
  profitabilityScore: number;
  driveEfficiencyScore: number;
  densityScore: number;
  stabilityScore: number;
  fewestRoutesScore: number;
  warningPenalty: number;
  notes: string[];
}

export interface ScoringContext {
  totalRoutesPlanned: number; // total routes in the week — used for fewest-routes pressure
  expectedMinRoutes: number; // soft target
  movedCustomerIds?: Set<string>; // for stability penalty
}

export function scoreProfitability(route: PlannedRoute, settings: RoutePlannerSettings): number {
  // Combine margin and revenue per hour into one normalized score. Margin is
  // capped at the target threshold (anything beyond is "good enough").
  const marginScore = clamp01(
    route.profitMargin / Math.max(0.01, settings.targetRouteProfitMargin)
  );
  const target = settings.targetRevenuePerRouteHour ?? 100;
  const revPerHourScore = clamp01(route.revenuePerRouteHour / Math.max(1, target));
  return clamp01(0.6 * marginScore + 0.4 * revPerHourScore);
}

export function scoreDriveEfficiency(route: PlannedRoute): number {
  // Lower drive minutes per stop is better. 5 min/stop is excellent, 30+ is bad.
  const dps = route.driveMinutesPerStop;
  if (dps <= 0) return 1;
  const score = 1 - (dps - 5) / 25; // 5 -> 1.0, 30 -> 0.0
  return clamp01(score);
}

export function scoreDensity(route: PlannedRoute): number {
  // Stops per mile — more is denser. 1 stop/mile is excellent.
  if (!route.stopsPerMile) return 0.5;
  return clamp01(route.stopsPerMile / 1);
}

export function scoreStability(route: PlannedRoute, context: ScoringContext): number {
  if (!context.movedCustomerIds || context.movedCustomerIds.size === 0) return 1;
  const moved = route.assignedStops.filter((s) =>
    context.movedCustomerIds!.has(s.customerId)
  ).length;
  if (route.assignedStops.length === 0) return 1;
  return clamp01(1 - moved / route.assignedStops.length);
}

export function scoreFewestRoutes(context: ScoringContext): number {
  if (context.totalRoutesPlanned <= 0) return 1;
  // Reward when actual route count is at or below the expected minimum.
  if (context.totalRoutesPlanned <= context.expectedMinRoutes) return 1;
  // Soft decay when we have extra routes.
  return clamp01(context.expectedMinRoutes / context.totalRoutesPlanned);
}

export function calculateRouteScore(
  route: PlannedRoute,
  settings: RoutePlannerSettings,
  context: ScoringContext
): RouteScoreBreakdown {
  const profitabilityScore = scoreProfitability(route, settings);
  const driveEfficiencyScore = scoreDriveEfficiency(route);
  const densityScore = scoreDensity(route);
  const stabilityScore = scoreStability(route, context);
  const fewestRoutesScore = scoreFewestRoutes(context);

  // Warnings reduce the score. Hard-cap warnings hit harder than soft warnings.
  const hardWarnings = route.warnings.filter(
    (w) =>
      w === "route_exceeds_hard_max" ||
      w === "route_exceeds_time_override_cap" ||
      w === "low_route_margin" ||
      w === "route_below_minimum_gross_profit"
  ).length;
  const softWarnings = route.warnings.length - hardWarnings;
  const warningPenalty = Math.min(0.4, hardWarnings * 0.1 + softWarnings * 0.02);

  const raw =
    profitabilityScore * settings.profitabilityWeight +
    driveEfficiencyScore * settings.driveEfficiencyWeight +
    densityScore * settings.densityWeight +
    stabilityScore * settings.routeStabilityWeight +
    fewestRoutesScore * settings.fewestRoutesWeight;
  const routeScore = Math.max(0, raw - warningPenalty);

  const notes = [
    `profit:${profitabilityScore.toFixed(2)}`,
    `drive:${driveEfficiencyScore.toFixed(2)}`,
    `density:${densityScore.toFixed(2)}`,
    `stability:${stabilityScore.toFixed(2)}`,
    `fewest:${fewestRoutesScore.toFixed(2)}`,
    `penalty:${warningPenalty.toFixed(2)}`,
  ];

  return {
    routeScore,
    profitabilityScore,
    driveEfficiencyScore,
    densityScore,
    stabilityScore,
    fewestRoutesScore,
    warningPenalty,
    notes,
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
