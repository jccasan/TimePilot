import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";

const WEEKS_PER_MONTH = 4.33;

interface BreakevenStatusIndicatorProps {
  activeClients: number;
  avgPricePerVisit: number;
  variableCostPerVisit: number;
  fixedMonthlyOverhead: number;
  visitsPerWeek?: number;
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function BreakevenStatusIndicator({
  activeClients,
  avgPricePerVisit,
  variableCostPerVisit,
  fixedMonthlyOverhead,
  visitsPerWeek = 1,
}: BreakevenStatusIndicatorProps) {
  if (!avgPricePerVisit || !fixedMonthlyOverhead) return null;

  const revenuePerClient = avgPricePerVisit * visitsPerWeek * WEEKS_PER_MONTH;
  const variableCostPerClient = variableCostPerVisit * visitsPerWeek * WEEKS_PER_MONTH;
  const contributionMargin = revenuePerClient - variableCostPerClient;

  if (contributionMargin <= 0) return null;

  const breakevenClients = Math.ceil(fixedMonthlyOverhead / contributionMargin);
  const breakevenRevenue = breakevenClients * revenuePerClient;

  const gapClients = activeClients - breakevenClients;
  const gapDollars = gapClients * revenuePerClient;
  const gapPct = breakevenRevenue > 0 ? (gapDollars / breakevenRevenue) * 100 : 0;

  const isAbove = gapClients >= 0;
  const isNear = !isAbove || Math.abs(gapPct) <= 10;

  const badgeClass = isAbove
    ? isNear
      ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
      : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";

  const badgeLabel = isAbove ? (isNear ? "Near Breakeven" : "Above Breakeven") : "Below Breakeven";

  return (
    <Card data-testid="card-breakeven-status">
      <CardContent className="py-3 px-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={badgeClass} data-testid="badge-breakeven-status">
              {badgeLabel}
            </Badge>
            <p className="text-sm font-semibold" data-testid="text-breakeven-headline">
              You are{" "}
              <strong>
                {Math.abs(gapClients)} {Math.abs(gapClients) === 1 ? "client" : "clients"}
              </strong>{" "}
              {isAbove ? "above" : "below"} breakeven
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span
              className={isAbove ? "text-green-600 dark:text-green-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}
              data-testid="text-breakeven-dollars"
            >
              {isAbove ? "+" : ""}{fmtCurrency(gapDollars)}/mo
            </span>
            <span
              className="text-muted-foreground"
              data-testid="text-breakeven-pct"
            >
              {isAbove ? "+" : ""}{gapPct.toFixed(1)}%
            </span>
            <Link
              href="/profitability?tab=breakeven"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              data-testid="link-breakeven-details"
            >
              Details
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
