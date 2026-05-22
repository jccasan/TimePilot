import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowRight } from "lucide-react";

const WEEKS_PER_MONTH = 4.33;

interface GrowthScorecardProps {
  avgMonthlyRevenueCents?: number;
  netMarginPct?: number;
  monthlyChurnPct?: number;
  weeklyBasePriceCents?: number;
  fixedOverheadCents?: number;
  variableCostPerVisitCents?: number;
  activeClients?: number;
  cacAmount?: number;
  ownerYardsPerWeek?: number;
  techMonthlyCost?: number;
  hasPricingConfig?: boolean;
  hasOverheadData?: boolean;
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function GrowthScorecard({
  avgMonthlyRevenueCents,
  netMarginPct = 30,
  monthlyChurnPct = 3,
  weeklyBasePriceCents,
  fixedOverheadCents,
  variableCostPerVisitCents = 0,
  activeClients = 0,
  cacAmount = 150,
  ownerYardsPerWeek = 40,
  techMonthlyCost = 2800,
  hasPricingConfig = false,
  hasOverheadData = false,
}: GrowthScorecardProps) {
  // --- LTV:CAC ratio ---
  const avgMonthlyRevenue = avgMonthlyRevenueCents ? avgMonthlyRevenueCents / 100 : 0;
  const rawLifespan = monthlyChurnPct > 0 ? 1 / (monthlyChurnPct / 100) : 240;
  const lifespanMonths = Math.min(rawLifespan, 240);
  const netLTV = avgMonthlyRevenue * lifespanMonths * (netMarginPct / 100);
  const ltvCacRatio = cacAmount > 0 ? netLTV / cacAmount : 0;
  const ltvCacValid = avgMonthlyRevenueCents != null && netMarginPct > 0 && cacAmount > 0;

  // --- Breakeven gap ---
  const pricePerVisit = weeklyBasePriceCents ? weeklyBasePriceCents / 100 : 0;
  const variableCostPerVisit = variableCostPerVisitCents ? variableCostPerVisitCents / 100 : 0;
  const fixedOverhead = fixedOverheadCents ? fixedOverheadCents / 100 : 0;
  const revenuePerClient = pricePerVisit * 1 * WEEKS_PER_MONTH;
  const variableCostPerClient = variableCostPerVisit * 1 * WEEKS_PER_MONTH;
  const contributionMargin = revenuePerClient - variableCostPerClient;
  const breakevenClients =
    contributionMargin > 0 && fixedOverhead > 0
      ? Math.ceil(fixedOverhead / contributionMargin)
      : null;
  const breakevenValid = hasPricingConfig && hasOverheadData && breakevenClients != null;
  const gapClients =
    breakevenValid && breakevenClients != null ? activeClients - breakevenClients : null;
  const gapDollars = gapClients != null ? gapClients * revenuePerClient : null;

  // --- Step-off threshold ---
  const ownerFieldIncome = ownerYardsPerWeek * WEEKS_PER_MONTH * pricePerVisit;
  const stepOffThreshold =
    hasPricingConfig && pricePerVisit > 0
      ? Math.ceil((techMonthlyCost + ownerFieldIncome) / (pricePerVisit * WEEKS_PER_MONTH))
      : null;
  const stepOffProgress =
    stepOffThreshold && stepOffThreshold > 0
      ? Math.min((activeClients / stepOffThreshold) * 100, 100)
      : 0;
  const pastThreshold = stepOffThreshold != null && activeClients >= stepOffThreshold;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="growth-scorecard">
      {/* LTV:CAC Tile */}
      <ScorecardTile
        title="LTV:CAC Ratio"
        subtitle="Healthy is 3:1 or better"
        linkTo="/pricing?tab=ltv"
        linkLabel="LTV Calculator"
      >
        {!ltvCacValid ? (
          <SetupPrompt text="Set up Pricing to see this" linkTo="/pricing" />
        ) : (
          <div className="space-y-1">
            <p
              className={`text-3xl font-bold ${ltvCacRatio >= 3 ? "text-green-600 dark:text-green-400" : ltvCacRatio >= 2 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`}
              data-testid="text-scorecard-ltv-cac"
            >
              {ltvCacRatio.toFixed(1)}:1
            </p>
            <Badge
              variant="outline"
              className={
                ltvCacRatio >= 3
                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                  : ltvCacRatio >= 2
                    ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                    : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
              }
            >
              {ltvCacRatio >= 3 ? "Healthy" : ltvCacRatio >= 2 ? "Acceptable" : "Low"}
            </Badge>
          </div>
        )}
      </ScorecardTile>

      {/* Breakeven Gap Tile */}
      <ScorecardTile
        title="Breakeven Gap"
        subtitle="Clients above or below breakeven"
        linkTo="/profitability?tab=breakeven"
        linkLabel="Breakeven Calculator"
      >
        {!breakevenValid ? (
          <SetupPrompt text="Set up Overhead to see this" linkTo="/pricing?tab=costs" />
        ) : (
          <div className="space-y-1">
            <p
              className={`text-3xl font-bold ${gapClients != null && gapClients >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
              data-testid="text-scorecard-breakeven-gap"
            >
              {gapClients != null && gapClients >= 0 ? `+${gapClients}` : gapClients}
            </p>
            <p className="text-sm text-muted-foreground">
              {gapClients != null && gapClients >= 0 ? "clients above" : "clients to go"}
            </p>
            {gapDollars != null && (
              <p
                className={`text-sm font-medium ${gapDollars >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                data-testid="text-scorecard-breakeven-dollars"
              >
                {gapDollars >= 0
                  ? `+${fmtCurrency(gapDollars)}/mo surplus`
                  : `${fmtCurrency(gapDollars)}/mo gap`}
              </p>
            )}
          </div>
        )}
      </ScorecardTile>

      {/* Step-Off Threshold Tile */}
      <ScorecardTile
        title="Step-Off-The-Truck"
        subtitle="Clients needed before owner can stop scooping"
        linkTo="/growth-tools#hire"
        linkLabel="Hire Calculator"
      >
        {!hasPricingConfig ? (
          <SetupPrompt text="Set up Pricing to see this" linkTo="/pricing" />
        ) : stepOffThreshold == null ? (
          <SetupPrompt text="Set up Pricing to see this" linkTo="/pricing" />
        ) : (
          <div className="space-y-2">
            <div>
              <p
                className={`text-3xl font-bold ${pastThreshold ? "text-green-600 dark:text-green-400" : ""}`}
                data-testid="text-scorecard-step-off"
              >
                {activeClients} / {stepOffThreshold}
              </p>
              <p className="text-sm text-muted-foreground">
                {pastThreshold
                  ? "Past threshold"
                  : `${stepOffThreshold - activeClients} more needed`}
              </p>
            </div>
            <Progress
              value={stepOffProgress}
              className="h-2"
              data-testid="progress-scorecard-step-off"
            />
          </div>
        )}
      </ScorecardTile>
    </div>
  );
}

function ScorecardTile({
  title,
  subtitle,
  children,
  linkTo,
  linkLabel,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  linkTo: string;
  linkLabel: string;
}) {
  return (
    <Card data-testid={`tile-scorecard-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div>{children}</div>
        <Link
          href={linkTo}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          data-testid={`link-scorecard-${linkLabel.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {linkLabel}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}

function SetupPrompt({ text, linkTo }: { text: string; linkTo: string }) {
  return (
    <Link
      href={linkTo}
      className="text-sm text-muted-foreground hover:text-primary underline"
      data-testid="link-scorecard-setup"
    >
      {text}
    </Link>
  );
}
