import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Calculator, RefreshCw, ArrowRight, TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import type { Property, ServicePlan } from "@shared/schema";

interface PriceCalculatorCardProps {
  property: Property;
  servicePlans?: ServicePlan[];
}

interface PriceBreakdown {
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

interface PriceDerived {
  jobMinutes: number;
  profitAtRecommendedCents: number;
  profitPerHourAtRecommendedCents: number;
  clusterDiscountAppliedPct: number;
  marketAnchorClamped: boolean;
  isEstimated: boolean;
}

interface PriceResult {
  minimumPriceCents: number;
  recommendedPriceCents: number;
  premiumPriceCents: number;
  breakdown: PriceBreakdown;
  derived: PriceDerived;
  profitWarning?: {
    message: string;
    lossPerVisitCents: number;
    profitPerVisitCents: number;
    profitPerHourCents: number;
  };
}

function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function yardSizeLabelToAcres(label: string | null | undefined): number {
  if (!label) return 0.1;
  const lower = label.toLowerCase();
  if (lower.includes("0.25_or_less")) return 0.15;
  if (lower.includes("0.26_0.5")) return 0.38;
  if (lower.includes("0.51_0.75")) return 0.63;
  if (lower.includes("0.75_1")) return 0.875;
  if (lower.includes("over_1")) return 1.5;
  if (lower.includes("small") || lower.includes("xs")) return 0.05;
  if (lower.includes("medium") || lower.includes("standard")) return 0.1;
  if (lower.includes("large") && !lower.includes("extra")) return 0.2;
  if (lower.includes("extra") || lower.includes("xl")) return 0.35;
  const numMatch = label.match(/[\d.]+/);
  if (numMatch) return parseFloat(numMatch[0]);
  return 0.1;
}

function sqftToAcres(sqft: number): number {
  return sqft / 43560;
}

function mapFrequency(freq: string | null | undefined): "weekly" | "biweekly" | "monthly" | "onetime" {
  if (!freq) return "weekly";
  if (freq === "1_per_week" || freq === "2_per_week" || freq === "weekly") return "weekly";
  if (freq === "biweekly") return "biweekly";
  if (freq === "monthly") return "monthly";
  if (freq === "onetime" || freq === "as_needed") return "onetime";
  return "weekly";
}

export function PriceCalculatorCard({ property, servicePlans }: PriceCalculatorCardProps) {
  const [result, setResult] = useState<PriceResult | null>(null);
  const [hasCalculated, setHasCalculated] = useState(false);

  const activePlan = servicePlans?.find((sp) => sp.isActive);
  const frequency = activePlan ? mapFrequency(activePlan.frequency) : "weekly";
  const currentPriceCents = activePlan ? Math.round(parseFloat(activePlan.pricePerVisit) * 100) : undefined;

  const yardSizeAcres = property.measuredYardSqft
    ? sqftToAcres(property.measuredYardSqft)
    : yardSizeLabelToAcres(property.yardSize);

  const calculateMutation = useMutation({
    mutationFn: async () => {
      const body = {
        yardSizeAcres,
        dogCount: property.numberOfDogs || 1,
        serviceFrequency: frequency,
        yardDifficulty: property.yardDifficulty || "flat",
        distanceFromNearestStopMiles: 1,
        currentPriceCents,
      };
      const res = await apiRequest("POST", "/api/pricing/calculate", body);
      return res.json() as Promise<PriceResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      setHasCalculated(true);
    },
  });

  const isLoss = result?.profitWarning && result.profitWarning.lossPerVisitCents > 0;

  return (
    <Card data-testid={`card-price-calculator-${property.id}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calculator className="h-4 w-4" /> Price Calculator
        </CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => calculateMutation.mutate()}
            disabled={calculateMutation.isPending}
            data-testid={`button-calculate-price-${property.id}`}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${calculateMutation.isPending ? "animate-spin" : ""}`} />
            {hasCalculated ? "Recalculate" : "Calculate"}
          </Button>
          <Button variant="ghost" size="sm" asChild data-testid={`link-full-calculator-${property.id}`}>
            <Link href="/pricing-calculator">
              Full Tool <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {calculateMutation.isPending && (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}

        {calculateMutation.isError && (
          <p className="text-sm text-destructive" data-testid={`text-calc-error-${property.id}`}>
            Failed to calculate pricing. Check your pricing config.
          </p>
        )}

        {result && !calculateMutation.isPending && (
          <>
            <div className="grid grid-cols-3 gap-2" data-testid={`grid-price-tiers-${property.id}`}>
              <div className="text-center p-2 rounded-md border" data-testid={`tier-minimum-${property.id}`}>
                <p className="text-xs text-muted-foreground">Minimum</p>
                <p className="text-lg font-bold text-destructive">{centsToDisplay(result.minimumPriceCents)}</p>
              </div>
              <div className="text-center p-2 rounded-md border border-primary/30 bg-primary/5" data-testid={`tier-recommended-${property.id}`}>
                <p className="text-xs text-muted-foreground">Recommended</p>
                <p className="text-lg font-bold">{centsToDisplay(result.recommendedPriceCents)}</p>
              </div>
              <div className="text-center p-2 rounded-md border" data-testid={`tier-premium-${property.id}`}>
                <p className="text-xs text-muted-foreground">Premium</p>
                <p className="text-lg font-bold text-green-600 dark:text-green-400">{centsToDisplay(result.premiumPriceCents)}</p>
              </div>
            </div>

            {currentPriceCents !== undefined && result.profitWarning && (
              <div
                className={`flex items-start gap-2 p-2 rounded-md text-sm ${
                  isLoss
                    ? "bg-destructive/10 text-destructive"
                    : "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                }`}
                data-testid={`alert-profit-warning-${property.id}`}
              >
                {isLoss ? (
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                ) : (
                  <TrendingUp className="h-4 w-4 mt-0.5 shrink-0" />
                )}
                <div>
                  <p className="font-medium" data-testid={`text-profit-message-${property.id}`}>{result.profitWarning.message}</p>
                  <p className="text-xs opacity-75">
                    Current: {centsToDisplay(currentPriceCents)} | Profit/hr: {centsToDisplay(result.profitWarning.profitPerHourCents)}
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {result.derived.clusterDiscountAppliedPct > 0 && (
                <Badge variant="secondary" data-testid={`badge-cluster-discount-${property.id}`}>
                  Cluster -{result.derived.clusterDiscountAppliedPct}%
                </Badge>
              )}
              {result.derived.marketAnchorClamped && (
                <Badge variant="secondary" data-testid={`badge-market-clamped-${property.id}`}>
                  Market Adjusted
                </Badge>
              )}
              {result.derived.isEstimated && (
                <Badge variant="outline" data-testid={`badge-estimated-${property.id}`}>
                  Estimated
                </Badge>
              )}
            </div>

            <div className="text-xs text-muted-foreground space-y-0.5" data-testid={`text-breakdown-${property.id}`}>
              <p>Service: {result.breakdown.serviceMinutes.toFixed(1)} min | Travel: {result.breakdown.adjustedTravelMinutes.toFixed(1)} min | Total: {result.derived.jobMinutes.toFixed(1)} min</p>
              <p>Labor: {centsToDisplay(result.breakdown.laborCostCents)} | Equipment: {centsToDisplay(result.breakdown.equipmentCostCents)} | Overhead: {centsToDisplay(result.breakdown.overheadPerVisitCents)}</p>
            </div>
          </>
        )}

        {!result && !calculateMutation.isPending && !calculateMutation.isError && (
          <p className="text-xs text-muted-foreground" data-testid={`text-calc-prompt-${property.id}`}>
            Click Calculate to see recommended pricing for this property based on yard size ({(yardSizeAcres).toFixed(2)} acres), {property.numberOfDogs || 1} dog(s), {property.yardDifficulty || "flat"} terrain.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
