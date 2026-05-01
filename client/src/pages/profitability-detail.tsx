import { type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/use-currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ArrowLeft,
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Calculator,
  Edit2,
  MapPin,
  Dog,
  Ruler,
  Clock,
  Wrench,
  Truck,
  Building2,
  Target,
  ArrowRight,
  Info,
  CheckCircle2,
  XCircle,
  Zap,
  Route,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface CostBreakdown {
  laborCostCents: number;
  travelCostCents: number;
  equipmentCostCents: number;
  overheadCostCents: number;
}

interface CalcBreakdown {
  serviceMinutes: number;
  travelMinutes: number;
  adjustedTravelMinutes: number;
  densityMultiplier: number;
  laborCostCents: number;
  travelCostCents: number;
  adjustedTravelCostCents: number;
  equipmentCostCents: number;
  overheadPerVisitCents: number;
  disinfectantCostCents: number;
  deodorizerCostCents: number;
  bagCount: number;
  bagsCostCents: number;
}

interface CalcDerived {
  jobMinutes: number;
  profitAtRecommendedCents: number;
  profitPerHourAtRecommendedCents: number;
  clusterDiscountAppliedPct: number;
  marketAnchorClamped: boolean;
  isEstimated: boolean;
}

interface CalcInputsUsed {
  yardSizeAcres: number;
  dogCount: number;
  serviceFrequency: string;
  yardDifficulty: string;
  distanceFromNearestStopMiles: number;
  routeStopsPerMile?: number;
  currentPriceCents?: number;
  hasYardDeodorizing?: boolean;
  configSnapshot: Record<string, number | string | boolean | null>;
}

interface CalculatorResult {
  minimumPriceCents: number;
  recommendedPriceCents: number;
  premiumPriceCents: number;
  inputsUsed: CalcInputsUsed;
  breakdown: CalcBreakdown;
  derived: CalcDerived;
}

interface JobEconomicsInputsV2 {
  currentPricePerVisit: number;
  serviceMinutes: number;
  targetTravelMinutes: number;
  actualTravelMinutes: number;
  actualTravelMiles: number;
  hourlyWage: number;
  laborBurdenMultiplier: number;
  fullyLoadedLaborRate: number;
  vehicleCostPerMile: number;
  estimatedSuppliesPerVisit: number;
  monthlyOverhead: number;
  estimatedMonthlyVisits: number;
  targetMarginPercent: number;
}

interface JobPriceHealth {
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
}

interface CurrentRouteProfitability {
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
}

interface RouteDensityOpportunity {
  targetTravelMinutes: number;
  actualTravelMinutes: number;
  targetTravelMiles: number | null;
  excessTravelMinutes: number;
  excessTravelLaborCost: number;
  excessTravelVehicleCost: number;
  excessTravelCost: number;
  recommendedAction: string;
}

interface JobEconomicsV2 {
  inputs: JobEconomicsInputsV2;
  jobPriceHealth: JobPriceHealth;
  currentRouteProfitability: CurrentRouteProfitability;
  routeDensityOpportunity: RouteDensityOpportunity;
  warnings: string[];
}

interface PropertyProfitability {
  propertyId: string;
  propertyAddress: string;
  servicePlanId: string;
  frequency: string;
  dogCount: number;
  yardSizeAcres: number;
  yardDifficulty: string;
  revenuePerVisitCents: number;
  costPerVisitCents: number;
  profitPerVisitCents: number;
  profitMarginPct: number;
  profitPerHourCents: number;
  recommendedPriceCents: number;
  costBreakdown: CostBreakdown;
  calculatorResult?: CalculatorResult;
  jobEconomicsResult?: CalculatorResult;
  jobCostPerVisitCents?: number;
  jobProfitPerVisitCents?: number;
  jobProfitMarginPct?: number;
  jobProfitPerHourCents?: number;
  standardTravelMinutesUsed?: number;
  jobEconomicsV2?: JobEconomicsV2;
}

interface CustomerProfitabilityData {
  contactId: string;
  contactName: string;
  propertyCount: number;
  totalRevenuePerVisitCents: number;
  totalCostPerVisitCents: number;
  totalProfitPerVisitCents: number;
  profitMarginPct: number;
  status: "profitable" | "marginal" | "unprofitable";
  properties: PropertyProfitability[];
  monthlyRevenueCents: number;
  monthlyCostCents: number;
  monthlyProfitCents: number;
}

interface ProfitabilitySnapshot {
  id: string;
  snapshotDate: string;
  revenueCents: number;
  totalCostCents: number;
  profitCents: number;
  profitMarginPct: string;
  visitCount: number;
}

function formatPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

function getStatusBadgeVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "profitable":
      return "default";
    case "marginal":
      return "secondary";
    case "unprofitable":
      return "destructive";
    default:
      return "outline";
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "profitable":
      return "Profitable";
    case "marginal":
      return "Marginal";
    case "unprofitable":
      return "Unprofitable";
    default:
      return status;
  }
}

function getFrequencyLabel(freq: string): string {
  switch (freq) {
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Bi-Weekly";
    case "monthly":
      return "Monthly";
    case "onetime":
      return "One-Time";
    default:
      return freq;
  }
}

function getDifficultyLabel(diff: string): string {
  switch (diff) {
    case "flat":
      return "Flat";
    case "moderate":
      return "Moderate";
    case "difficult":
      return "Difficult";
    default:
      return diff;
  }
}

function fmtMin(min: number): string {
  return `${Math.round(min)} min`;
}

function fmtDollars(cents: number): string {
  return `$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function fmtMult(mult: number): string {
  return `×${mult.toFixed(3).replace(/\.?0+$/, "")}`;
}

function CalcRow({
  label,
  value,
  formula,
  indent,
}: {
  label: string;
  value: string;
  formula?: string;
  indent?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-2 py-0.5 ${indent ? "pl-4" : ""}`}>
      <span
        className="text-xs text-muted-foreground min-w-0 flex-1 truncate"
        title={formula || label}
      >
        {formula ? (
          <>
            <span className="text-foreground/70">{label}</span>
            <span className="ml-1 text-[10px] font-mono opacity-60">({formula})</span>
          </>
        ) : (
          <span className="text-foreground/70">{label}</span>
        )}
      </span>
      <span className="text-xs font-mono font-medium shrink-0">{value}</span>
    </div>
  );
}

function CalcSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {title}
      </p>
      {children}
    </div>
  );
}

function ShowCalculationPanel({ calc }: { calc: CalculatorResult }) {
  const { breakdown: bd, derived: dv, inputsUsed: inp } = calc;
  const cfg = inp.configSnapshot as Record<string, number>;

  const freqMultMap: Record<string, string> = {
    weekly: "weeklyMultiplier",
    biweekly: "biweeklyMultiplier",
    monthly: "monthlyMultiplier",
    onetime: "oneTimeMultiplier",
  };
  const diffMultMap: Record<string, string> = {
    flat: "difficultyFlat",
    moderate: "difficultyModerate",
    difficult: "difficultyDifficult",
  };

  const freqMultKey = freqMultMap[inp.serviceFrequency] || "weeklyMultiplier";
  const diffMultKey = diffMultMap[inp.yardDifficulty] || "difficultyFlat";
  const freqMult = typeof cfg[freqMultKey] === "number" ? cfg[freqMultKey] : 1;
  const diffMult = typeof cfg[diffMultKey] === "number" ? cfg[diffMultKey] : 1;

  const burdenedRateCents = (cfg.techHourlyWageCents || 0) * (cfg.burdenMultiplier || 1);
  const baseServiceMin = (inp.yardSizeAcres / 0.1) * (cfg.baseTimePerTenthAcreMinutes || 0);
  const extraDogMin = Math.max(inp.dogCount - 1, 0) * (cfg.extraDogMinutesAfterFirst || 0);

  const vehicleCostPerMile =
    cfg.vehicleCostPerMileCents > 0
      ? cfg.vehicleCostPerMileCents
      : cfg.vehicleMPG && cfg.vehicleMPG > 0
        ? (cfg.averageGasPriceCentsPerGallon || 0) / cfg.vehicleMPG
        : 65;

  const monthlyOverhead =
    (cfg.advertisingCents || 0) +
    (cfg.payrollProviderCents || 0) +
    (cfg.benefitsCents || 0) +
    (cfg.insuranceCents || 0) +
    (cfg.softwareCents || 0) +
    (cfg.otherOverheadCents || 0);

  const freqLabel =
    { weekly: "Weekly", biweekly: "Bi-Weekly", monthly: "Monthly", onetime: "One-Time" }[
      inp.serviceFrequency
    ] || inp.serviceFrequency;
  const diffLabel =
    { flat: "Flat", moderate: "Moderate", difficult: "Difficult" }[inp.yardDifficulty] ||
    inp.yardDifficulty;

  return (
    <div className="mt-3 rounded-md border border-dashed bg-muted/30 p-3 space-y-3 text-xs">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <Calculator className="h-3.5 w-3.5" />
        <span>Calculation Workbook</span>
        {dv.isEstimated && (
          <span className="ml-auto text-[10px] font-normal text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <Info className="h-3 w-3" />
            estimated distance
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <CalcSection title="1 · Service Time">
          <CalcRow
            label="Base time"
            formula={`${inp.yardSizeAcres.toFixed(3)} ac ÷ 0.1 × ${cfg.baseTimePerTenthAcreMinutes ?? "?"}min`}
            value={fmtMin(baseServiceMin)}
          />
          {inp.dogCount > 1 && (
            <CalcRow
              label="Extra dogs"
              formula={`(${inp.dogCount}−1) × ${cfg.extraDogMinutesAfterFirst ?? "?"}min`}
              value={`+${fmtMin(extraDogMin)}`}
              indent
            />
          )}
          {cfg.minimumServiceMinutesFloor > 0 && (
            <CalcRow label="Minimum floor" value={fmtMin(cfg.minimumServiceMinutesFloor)} indent />
          )}
          <CalcRow
            label={`${freqLabel} multiplier`}
            formula={fmtMult(freqMult)}
            value={fmtMin(bd.serviceMinutes / diffMult)}
            indent
          />
          <CalcRow
            label={`${diffLabel} multiplier`}
            formula={fmtMult(diffMult)}
            value={fmtMin(bd.serviceMinutes)}
            indent
          />
          <div className="border-t mt-1 pt-1">
            <CalcRow label="Service minutes" value={fmtMin(bd.serviceMinutes)} />
          </div>
        </CalcSection>

        <CalcSection title="2 · Travel Time">
          <CalcRow
            label="Drive time"
            formula={`${inp.distanceFromNearestStopMiles.toFixed(2)} mi ÷ ${cfg.driveSpeedAverageMph ?? "?"}mph`}
            value={fmtMin(bd.travelMinutes)}
          />
          {bd.densityMultiplier !== 1 && (
            <CalcRow
              label="Density factor"
              formula={fmtMult(bd.densityMultiplier)}
              value={fmtMin(bd.adjustedTravelMinutes)}
              indent
            />
          )}
          <div className="border-t mt-1 pt-1">
            <CalcRow
              label="Total job time"
              formula={`${fmtMin(bd.serviceMinutes)} + ${fmtMin(bd.adjustedTravelMinutes)}`}
              value={fmtMin(dv.jobMinutes)}
            />
          </div>
        </CalcSection>

        <CalcSection title="3 · Labor Cost">
          <CalcRow label="Hourly wage" value={fmtDollars(cfg.techHourlyWageCents || 0) + "/hr"} />
          <CalcRow
            label="Burden multiplier"
            formula={fmtMult(cfg.burdenMultiplier || 1)}
            value={fmtDollars(burdenedRateCents) + "/hr"}
            indent
          />
          <div className="border-t mt-1 pt-1">
            <CalcRow
              label="Yard labor"
              formula={`${fmtMin(bd.serviceMinutes)} ÷ 60 × ${fmtDollars(burdenedRateCents)}/hr`}
              value={fmtDollars(bd.laborCostCents)}
            />
          </div>
        </CalcSection>

        <CalcSection title="4 · Travel Cost">
          <CalcRow label="Vehicle cost/mile" value={fmtDollars(vehicleCostPerMile) + "/mi"} />
          <CalcRow
            label="Travel cost"
            formula={`${inp.distanceFromNearestStopMiles.toFixed(2)} mi × ${fmtDollars(vehicleCostPerMile)}/mi`}
            value={fmtDollars(bd.travelCostCents)}
            indent
          />
          {bd.densityMultiplier !== 1 && (
            <CalcRow
              label="Density adjusted"
              formula={fmtMult(bd.densityMultiplier)}
              value={fmtDollars(bd.adjustedTravelCostCents)}
              indent
            />
          )}
        </CalcSection>

        <CalcSection title="5 · Supplies">
          <CalcRow
            label="Disinfectant/Deodorizer"
            formula={
              inp.hasYardDeodorizing
                ? `$7.00/acre × ${inp.yardSizeAcres.toFixed(3)} ac`
                : "$0.01/stop"
            }
            value={fmtDollars(bd.disinfectantCostCents + bd.deodorizerCostCents)}
            indent
          />
          <CalcRow
            label="Bags"
            formula={`${bd.bagCount} bag${bd.bagCount !== 1 ? "s" : ""} × ${fmtDollars(cfg.bagsCents || 0)}/bag`}
            value={fmtDollars(bd.bagsCostCents)}
            indent
          />
          <div className="border-t mt-1 pt-1">
            <CalcRow label="Supplies total" value={fmtDollars(bd.equipmentCostCents)} />
          </div>
        </CalcSection>

        <CalcSection title="6 · Overhead / Visit">
          {monthlyOverhead > 0 && (
            <CalcRow label="Monthly overhead" value={fmtDollars(monthlyOverhead)} />
          )}
          <CalcRow label="Estimated monthly stops" value={`${cfg.estimatedMonthlyStops ?? "?"}`} />
          <div className="border-t mt-1 pt-1">
            <CalcRow
              label="Overhead/visit"
              formula={
                monthlyOverhead > 0
                  ? `${fmtDollars(monthlyOverhead)} ÷ ${cfg.estimatedMonthlyStops ?? "?"}`
                  : "override"
              }
              value={fmtDollars(bd.overheadPerVisitCents)}
            />
          </div>
        </CalcSection>
      </div>

      <div className="border-t pt-2 space-y-0.5">
        <CalcRow
          label="Total cost/visit"
          formula={`Labor + Travel + Supplies + Overhead`}
          value={fmtDollars(
            bd.laborCostCents +
              bd.adjustedTravelCostCents +
              bd.equipmentCostCents +
              bd.overheadPerVisitCents
          )}
        />
        {dv.clusterDiscountAppliedPct > 0 && (
          <CalcRow
            label={`Cluster discount`}
            formula={`−${dv.clusterDiscountAppliedPct}%`}
            value={`applied`}
          />
        )}
        {dv.marketAnchorClamped && (
          <CalcRow label="Market anchor" value="price clamped to local market range" />
        )}
        <CalcRow
          label="Recommended price"
          formula={`cost ÷ (1 − ${cfg.targetProfitMarginPct ?? "?"}% margin)`}
          value={fmtDollars(calc.recommendedPriceCents)}
        />
      </div>
    </div>
  );
}

type DiagnosticType = "strong-strong" | "strong-weak" | "weak-strong" | "weak-weak";

function getDiagnostic(jobMarginPct: number, routeMarginPct: number): DiagnosticType {
  const strongJob = jobMarginPct >= 15;
  const strongRoute = routeMarginPct >= 15;
  if (strongJob && strongRoute) return "strong-strong";
  if (strongJob && !strongRoute) return "strong-weak";
  if (!strongJob && strongRoute) return "weak-strong";
  return "weak-weak";
}

interface DiagnosticInfo {
  label: string;
  detail: string;
  color: string;
  icon: typeof CheckCircle2;
}

function getDiagnosticInfo(type: DiagnosticType): DiagnosticInfo {
  switch (type) {
    case "strong-strong":
      return {
        label: "Strong job, strong route",
        detail: "This stop is performing well both as a unit and operationally.",
        color: "text-green-600 dark:text-green-400",
        icon: CheckCircle2,
      };
    case "strong-weak":
      return {
        label: "Strong job, weak route placement",
        detail: "Good job economics — route density or sequencing is the issue, not pricing.",
        color: "text-amber-600 dark:text-amber-400",
        icon: AlertTriangle,
      };
    case "weak-strong":
      return {
        label: "Weak job, efficient route",
        detail: "Route is not the problem. Review pricing, scope, or labor model.",
        color: "text-orange-600 dark:text-orange-400",
        icon: AlertTriangle,
      };
    case "weak-weak":
      return {
        label: "Weak job, weak route",
        detail: "Both unit economics and route placement need attention.",
        color: "text-red-600 dark:text-red-400",
        icon: XCircle,
      };
  }
}

function EconCostItem({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p
        className={`text-[10px] ${highlight ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
      >
        {label}
      </p>
      <p className={`text-xs font-medium ${highlight ? "text-amber-700 dark:text-amber-300" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function JobEconomicsCards({
  v2,
  propertyId,
  formatCents,
}: {
  v2: JobEconomicsV2;
  propertyId: string;
  formatCents: (cents: number) => string;
}) {
  const fd = (dollars: number) => formatCents(Math.round(dollars * 100));
  const {
    jobPriceHealth: jph,
    currentRouteProfitability: crp,
    routeDensityOpportunity: rdo,
    warnings,
    inputs,
  } = v2;
  const hasMissingPrice = inputs.currentPricePerVisit <= 0;
  const targetMarginPct = inputs.targetMarginPercent * 100;
  const hasHighOverhead = warnings.some((w) => w.includes("High overhead"));

  return (
    <div className="space-y-3">
      {/* Card 1: Job Price Health */}
      <div
        className="rounded-md border p-3 space-y-3"
        data-testid={`card-job-price-health-${propertyId}`}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            Job Price Health
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Uses target travel assumptions for pricing.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>
            <p className="text-[10px] text-muted-foreground">Current Price</p>
            <p className="text-sm font-medium" data-testid={`text-current-price-${propertyId}`}>
              {hasMissingPrice ? (
                <span className="text-muted-foreground italic">Not set</span>
              ) : (
                fd(inputs.currentPricePerVisit)
              )}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Target Cost/Visit</p>
            <p className="text-sm font-medium">{fd(jph.targetCostPerVisit)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Recommended Price</p>
            <p
              className="text-sm font-medium text-green-600 dark:text-green-400"
              data-testid={`text-recommended-price-${propertyId}`}
            >
              {fd(jph.recommendedPrice)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Projected Margin</p>
            <p className="text-sm font-medium">{formatPct(jph.projectedMargin * 100)}</p>
          </div>
        </div>

        {!hasMissingPrice && (
          <div
            className={`text-xs flex items-center gap-1.5 ${jph.requiredPriceChange > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}
            data-testid={`text-job-profit-${propertyId}`}
          >
            {jph.requiredPriceChange > 0 ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Price adjustment recommended: +{fd(jph.requiredPriceChange)}
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                Price is at or above recommended
              </>
            )}
          </div>
        )}

        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
            Cost breakdown
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
            <EconCostItem label="Service labor" value={fd(jph.serviceLaborCost)} />
            <EconCostItem label="Travel labor" value={fd(jph.targetTravelLaborCost)} />
            <EconCostItem label="Vehicle cost" value={fd(jph.targetTravelVehicleCost)} />
            <EconCostItem label="Supplies" value={fd(inputs.estimatedSuppliesPerVisit)} />
            <EconCostItem
              label="Allocated overhead"
              value={fd(jph.allocatedOverheadPerVisit)}
              highlight={hasHighOverhead}
            />
          </div>
        </div>

        {hasHighOverhead && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            High overhead allocation. Check monthly visits and overhead assumptions.
          </p>
        )}
      </div>

      {/* Card 2: Current Route Profitability */}
      <div
        className="rounded-md border p-3 space-y-3"
        data-testid={`card-route-profitability-${propertyId}`}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Route className="h-3.5 w-3.5" />
            Current Route Profitability
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Uses actual route placement.</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div>
            <p className="text-[10px] text-muted-foreground">Current Price</p>
            <p className="text-sm font-medium" data-testid={`text-revenue-${propertyId}`}>
              {hasMissingPrice ? (
                <span className="text-muted-foreground italic">Not set</span>
              ) : (
                fd(inputs.currentPricePerVisit)
              )}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Actual Cost/Visit</p>
            <p className="text-sm font-medium" data-testid={`text-cost-${propertyId}`}>
              {fd(crp.actualCostPerVisit)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Actual Profit/Visit</p>
            <p
              className={`text-sm font-medium ${crp.actualProfitPerVisit === null ? "" : crp.actualProfitPerVisit < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
              data-testid={`text-profit-${propertyId}`}
            >
              {crp.actualProfitPerVisit === null ? (
                <span className="text-muted-foreground">N/A</span>
              ) : (
                fd(crp.actualProfitPerVisit)
              )}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Actual Margin</p>
            <p
              className={`text-sm font-medium ${crp.actualMargin === null ? "" : crp.actualMargin < 0 ? "text-red-600 dark:text-red-400" : crp.actualMargin < inputs.targetMarginPercent ? "text-amber-600 dark:text-amber-400" : ""}`}
              data-testid={`text-profit-hour-${propertyId}`}
            >
              {crp.actualMargin === null ? (
                <span className="text-muted-foreground">N/A</span>
              ) : (
                formatPct(crp.actualMargin * 100)
              )}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Revenue/Hour</p>
            <p className="text-sm font-medium">
              {crp.actualRevenuePerHour === null ? (
                <span className="text-muted-foreground">N/A</span>
              ) : (
                `${fd(crp.actualRevenuePerHour)}/hr`
              )}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Profit/Hour</p>
            <p
              className={`text-sm font-medium ${crp.actualProfitPerHour !== null && crp.actualProfitPerHour < 0 ? "text-red-600 dark:text-red-400" : ""}`}
            >
              {crp.actualProfitPerHour === null ? (
                <span className="text-muted-foreground">N/A</span>
              ) : (
                `${fd(crp.actualProfitPerHour)}/hr`
              )}
            </p>
          </div>
        </div>

        {crp.actualMargin !== null && crp.actualMargin < 0 && (
          <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Losing money in current route position.
          </div>
        )}
        {crp.actualMargin !== null &&
          crp.actualMargin >= 0 &&
          crp.actualMargin < inputs.targetMarginPercent && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Below target margin ({formatPct(targetMarginPct)}).
            </div>
          )}

        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
            Cost breakdown
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
            <EconCostItem label="Service labor" value={fd(crp.serviceLaborCost)} />
            <EconCostItem label="Travel labor" value={fd(crp.actualTravelLaborCost)} />
            <EconCostItem label="Vehicle cost" value={fd(crp.actualTravelVehicleCost)} />
            <EconCostItem label="Supplies" value={fd(inputs.estimatedSuppliesPerVisit)} />
            <EconCostItem label="Allocated overhead" value={fd(crp.allocatedOverheadPerVisit)} />
          </div>
        </div>
      </div>

      {/* Card 3: Route Density Opportunity */}
      <div
        className="rounded-md border p-3 space-y-3"
        data-testid={`card-route-density-${propertyId}`}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            Route Density Opportunity
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Shows whether the issue is pricing or route placement.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div>
            <p className="text-[10px] text-muted-foreground">Target Travel</p>
            <p className="font-medium">{Math.round(rdo.targetTravelMinutes)} min</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Actual Travel</p>
            <p className="font-medium">{Math.round(rdo.actualTravelMinutes)} min</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Excess Travel</p>
            <p
              className={`font-medium ${rdo.excessTravelMinutes > 5 ? "text-amber-600 dark:text-amber-400" : ""}`}
            >
              {Math.round(rdo.excessTravelMinutes)} min
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Excess Cost</p>
            <p
              className={`font-medium ${rdo.excessTravelCost > 0.005 ? "text-amber-600 dark:text-amber-400" : ""}`}
            >
              {fd(rdo.excessTravelCost)}
            </p>
          </div>
        </div>

        {inputs.actualTravelMiles > 0 && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-[10px] text-muted-foreground">Actual Miles</p>
              <p className="font-medium">{inputs.actualTravelMiles.toFixed(2)} mi</p>
            </div>
            {rdo.targetTravelMiles !== null && (
              <div>
                <p className="text-[10px] text-muted-foreground">Target Est. Miles</p>
                <p className="font-medium">{rdo.targetTravelMiles.toFixed(2)} mi</p>
              </div>
            )}
          </div>
        )}

        <div
          className={`flex items-start gap-2 p-2 rounded-md text-xs ${
            hasMissingPrice
              ? "bg-muted/50 text-muted-foreground"
              : rdo.excessTravelMinutes > 5 &&
                  crp.actualMargin !== null &&
                  crp.actualMargin < inputs.targetMarginPercent
                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400"
                : crp.actualMargin !== null && crp.actualMargin < inputs.targetMarginPercent
                  ? "bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400"
                  : "bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400"
          }`}
          data-testid={`text-density-action-${propertyId}`}
        >
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{rdo.recommendedAction}</span>
        </div>
      </div>
    </div>
  );
}

function LegacyEconomicsCards({
  prop,
  formatCents,
}: {
  prop: PropertyProfitability;
  formatCents: (cents: number) => string;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-md border p-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            Job Economics
            {prop.standardTravelMinutesUsed !== undefined && (
              <span className="normal-case font-normal">
                ({prop.standardTravelMinutesUsed} min target travel)
              </span>
            )}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[11px] text-muted-foreground">Revenue/Visit</p>
              <p className="text-sm font-medium">{formatCents(prop.revenuePerVisitCents)}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Cost/Visit</p>
              <p className="text-sm font-medium">
                {formatCents(prop.jobCostPerVisitCents ?? prop.costPerVisitCents)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Profit/Visit</p>
              <p
                className={`text-sm font-medium ${(prop.jobProfitPerVisitCents ?? prop.profitPerVisitCents) < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
              >
                {formatCents(prop.jobProfitPerVisitCents ?? prop.profitPerVisitCents)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Margin / Ideal $/hr</p>
              <p
                className={`text-sm font-medium ${(prop.jobProfitMarginPct ?? 0) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
              >
                {formatPct(prop.jobProfitMarginPct ?? 0)} ·{" "}
                {formatCents(prop.jobProfitPerHourCents ?? 0)}/hr
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-md border p-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Route className="h-3.5 w-3.5" />
            Current Route Impact
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[11px] text-muted-foreground">Revenue/Visit</p>
              <p className="text-sm font-medium">{formatCents(prop.revenuePerVisitCents)}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Cost/Visit</p>
              <p className="text-sm font-medium">{formatCents(prop.costPerVisitCents)}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Profit/Visit</p>
              <p
                className={`text-sm font-medium ${prop.profitPerVisitCents < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
              >
                {formatCents(prop.profitPerVisitCents)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Margin / Actual $/hr</p>
              <p
                className={`text-sm font-medium ${prop.profitPerHourCents < 0 ? "text-red-600 dark:text-red-400" : ""}`}
              >
                {formatPct(prop.profitMarginPct)} · {formatCents(prop.profitPerHourCents)}/hr
              </p>
            </div>
          </div>
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-2">Cost Breakdown (Current Route)</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="flex items-center gap-1.5">
            <DollarSign className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-[11px] text-muted-foreground">Labor</p>
              <p className="text-xs font-medium">
                {formatCents(prop.costBreakdown.laborCostCents)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-[11px] text-muted-foreground">Travel</p>
              <p className="text-xs font-medium">
                {formatCents(prop.costBreakdown.travelCostCents)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-[11px] text-muted-foreground">Supplies</p>
              <p className="text-xs font-medium">
                {formatCents(prop.costBreakdown.equipmentCostCents)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-[11px] text-muted-foreground">Overhead</p>
              <p className="text-xs font-medium">
                {formatCents(prop.costBreakdown.overheadCostCents)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PropertyCard({ prop, contactId }: { prop: PropertyProfitability; contactId: string }) {
  const { formatMoney } = useCurrency();
  const formatCents = (cents: number) => {
    const sign = cents < 0 ? "-" : "";
    return sign + formatMoney(Math.abs(cents) / 100);
  };
  const isUnprofitable = prop.profitMarginPct < 0;
  const isMarginal = prop.profitMarginPct >= 0 && prop.profitMarginPct <= 15;
  const priceDiff = prop.recommendedPriceCents - prop.revenuePerVisitCents;
  const projectedProfit = prop.recommendedPriceCents - prop.costPerVisitCents;
  const projectedMargin =
    prop.recommendedPriceCents > 0 ? (projectedProfit / prop.recommendedPriceCents) * 100 : 0;

  return (
    <Card data-testid={`card-property-${prop.propertyId}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 flex-wrap">
        <div className="space-y-1">
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
            <span data-testid={`text-property-address-${prop.propertyId}`}>
              {prop.propertyAddress}
            </span>
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {getFrequencyLabel(prop.frequency)}
            </span>
            <span className="flex items-center gap-1">
              <Dog className="h-3.5 w-3.5" />
              {prop.dogCount} {prop.dogCount === 1 ? "dog" : "dogs"}
            </span>
            <span className="flex items-center gap-1">
              <Ruler className="h-3.5 w-3.5" />
              {prop.yardSizeAcres.toFixed(2)} acres
            </span>
            <span className="flex items-center gap-1">
              <Target className="h-3.5 w-3.5" />
              {getDifficultyLabel(prop.yardDifficulty)}
            </span>
          </div>
        </div>
        <Badge
          variant={
            prop.profitMarginPct < 0
              ? "destructive"
              : prop.profitMarginPct <= 15
                ? "secondary"
                : "default"
          }
          data-testid={`badge-property-status-${prop.propertyId}`}
        >
          {formatPct(prop.profitMarginPct)} margin
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {prop.jobProfitMarginPct !== undefined &&
          (() => {
            const diagType = getDiagnostic(prop.jobProfitMarginPct, prop.profitMarginPct);
            const diag = getDiagnosticInfo(diagType);
            const DiagIcon = diag.icon;
            return (
              <div
                className={`flex items-start gap-2 p-2.5 rounded-md border text-sm ${
                  diagType === "strong-strong"
                    ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
                    : diagType === "strong-weak"
                      ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800"
                      : diagType === "weak-strong"
                        ? "bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800"
                        : "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                }`}
                data-testid={`diagnostic-${prop.propertyId}`}
              >
                <DiagIcon className={`h-4 w-4 shrink-0 mt-0.5 ${diag.color}`} />
                <div>
                  <p className={`font-semibold leading-tight ${diag.color}`}>{diag.label}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">{diag.detail}</p>
                </div>
              </div>
            );
          })()}

        {prop.jobEconomicsV2 ? (
          <JobEconomicsCards
            v2={prop.jobEconomicsV2}
            propertyId={prop.propertyId}
            formatCents={formatCents}
          />
        ) : (
          <LegacyEconomicsCards prop={prop} formatCents={formatCents} />
        )}

        {prop.calculatorResult && <ShowCalculationPanel calc={prop.calculatorResult} />}

        {(isUnprofitable || isMarginal) && (
          <div className="border-t pt-3 space-y-2">
            <div className="flex items-center gap-1.5 text-sm">
              <AlertTriangle
                className={`h-4 w-4 shrink-0 ${isUnprofitable ? "text-red-500" : "text-yellow-500"}`}
              />
              <span className="font-medium">
                {isUnprofitable ? "Unprofitable" : "Low margin"} — price adjustment recommended
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Current Price</p>
                <p className="font-medium">{formatCents(prop.revenuePerVisitCents)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Recommended</p>
                <p className="font-medium text-green-600 dark:text-green-400">
                  {formatCents(prop.recommendedPriceCents)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Price Change</p>
                <p
                  className={`font-medium ${priceDiff > 0 ? "text-green-600 dark:text-green-400" : ""}`}
                >
                  {priceDiff > 0 ? "+" : ""}
                  {formatCents(priceDiff)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Projected Margin</p>
                <p className="font-medium text-green-600 dark:text-green-400">
                  {formatPct(projectedMargin)}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap pt-1">
          <Button
            variant="outline"
            size="sm"
            asChild
            data-testid={`button-edit-plan-${prop.propertyId}`}
          >
            <Link href={`/contacts/${contactId}`}>
              <Edit2 className="h-3.5 w-3.5 mr-1" />
              Edit Job
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            asChild
            data-testid={`button-calculator-${prop.propertyId}`}
          >
            <Link href={`/pricing-calculator`}>
              <Calculator className="h-3.5 w-3.5 mr-1" />
              Price Calculator
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfitTrendChart({ contactId }: { contactId: string }) {
  const { data: snapshots, isLoading } = useQuery<ProfitabilitySnapshot[]>({
    queryKey: ["/api/profitability/history", contactId],
  });

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!snapshots || snapshots.length === 0) {
    return (
      <div
        className="flex items-center justify-center h-48 text-sm text-muted-foreground"
        data-testid="text-no-history"
      >
        No historical data yet. Run a recalculation to start tracking profitability trends.
      </div>
    );
  }

  const grouped = new Map<
    string,
    { revenue: number; cost: number; profit: number; margin: number; count: number }
  >();
  for (const s of snapshots) {
    const existing = grouped.get(s.snapshotDate);
    if (existing) {
      existing.revenue += s.revenueCents;
      existing.cost += s.totalCostCents;
      existing.profit += s.profitCents;
      existing.count++;
    } else {
      grouped.set(s.snapshotDate, {
        revenue: s.revenueCents,
        cost: s.totalCostCents,
        profit: s.profitCents,
        margin: parseFloat(s.profitMarginPct),
        count: 1,
      });
    }
  }

  const chartData = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({
      date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      revenue: vals.revenue / 100,
      cost: vals.cost / 100,
      profit: vals.profit / 100,
      margin: vals.revenue > 0 ? (vals.profit / vals.revenue) * 100 : 0,
    }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="date" className="text-xs" tick={{ fontSize: 11 }} />
        <YAxis className="text-xs" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
        <RechartsTooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
          }}
          labelStyle={{ color: "hsl(var(--foreground))" }}
          formatter={(value: number, name: string) => [
            name === "margin" ? `${value.toFixed(1)}%` : `$${value.toFixed(2)}`,
            name,
          ]}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="revenue"
          stroke="hsl(var(--chart-1))"
          name="Revenue"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="cost"
          stroke="hsl(var(--chart-2))"
          name="Cost"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="profit"
          stroke="hsl(var(--chart-3))"
          name="Profit"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function ProfitabilityDetail() {
  const { contactId } = useParams<{ contactId: string }>();
  const { toast } = useToast();
  const { formatMoney } = useCurrency();
  const formatCents = (cents: number) => {
    const sign = cents < 0 ? "-" : "";
    return sign + formatMoney(Math.abs(cents) / 100);
  };

  const { data: profitData, isLoading } = useQuery<CustomerProfitabilityData>({
    queryKey: ["/api/profitability/customer", contactId],
  });

  const recalcMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/profitability/recalculate");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profitability/customer", contactId] });
      queryClient.invalidateQueries({ queryKey: ["/api/profitability/history", contactId] });
      toast({ title: "Recalculated", description: "Profitability data has been refreshed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!profitData) {
    return (
      <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
        <Button asChild variant="ghost" data-testid="button-back-profitability">
          <Link href="/profitability">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to Profitability
          </Link>
        </Button>
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground" data-testid="text-no-data">
              No profitability data available for this customer. They may not have active jobs.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const unprofitableProps = profitData.properties.filter((p) => p.profitMarginPct < 15);

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Button asChild variant="ghost" data-testid="button-back-profitability">
          <Link href="/profitability">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to Profitability
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => recalcMutation.mutate()}
          disabled={recalcMutation.isPending}
          data-testid="button-recalculate"
        >
          <Calculator className="mr-1 h-4 w-4" />
          {recalcMutation.isPending ? "Recalculating..." : "Recalculate"}
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <div className="space-y-1">
            <CardTitle className="text-xl" data-testid="text-customer-name">
              {profitData.contactName}
            </CardTitle>
            <p className="text-sm text-muted-foreground" data-testid="text-property-count">
              {profitData.propertyCount}{" "}
              {profitData.propertyCount === 1 ? "property" : "properties"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant={getStatusBadgeVariant(profitData.status)}
              data-testid="badge-customer-status"
            >
              {getStatusLabel(profitData.status)}
            </Badge>
            <Badge variant="outline" data-testid="badge-customer-margin">
              {formatPct(profitData.profitMarginPct)} margin
            </Badge>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Monthly Revenue</p>
            </div>
            <p className="text-lg font-semibold" data-testid="text-monthly-revenue">
              {formatCents(profitData.monthlyRevenueCents)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Monthly Cost</p>
            </div>
            <p className="text-lg font-semibold" data-testid="text-monthly-cost">
              {formatCents(profitData.monthlyCostCents)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              {profitData.monthlyProfitCents >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
              <p className="text-xs text-muted-foreground">Monthly Profit</p>
            </div>
            <p
              className={`text-lg font-semibold ${profitData.monthlyProfitCents < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
              data-testid="text-monthly-profit"
            >
              {formatCents(profitData.monthlyProfitCents)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Profit Margin</p>
            </div>
            <p
              className={`text-lg font-semibold ${profitData.profitMarginPct < 0 ? "text-red-600 dark:text-red-400" : profitData.profitMarginPct <= 15 ? "text-yellow-600 dark:text-yellow-400" : "text-green-600 dark:text-green-400"}`}
              data-testid="text-profit-margin"
            >
              {formatPct(profitData.profitMarginPct)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold" data-testid="text-properties-heading">
          Per-Property Breakdown
        </h2>
        {profitData.properties.map((prop) => (
          <PropertyCard key={prop.propertyId} prop={prop} contactId={profitData.contactId} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg" data-testid="text-trend-heading">
            Profitability Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ProfitTrendChart contactId={contactId!} />
        </CardContent>
      </Card>

      {unprofitableProps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Price Adjustment Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {unprofitableProps.map((prop) => {
                const priceDiff = prop.recommendedPriceCents - prop.revenuePerVisitCents;
                const projectedProfit = prop.recommendedPriceCents - prop.costPerVisitCents;
                const projectedMargin =
                  prop.recommendedPriceCents > 0
                    ? (projectedProfit / prop.recommendedPriceCents) * 100
                    : 0;

                return (
                  <div
                    key={prop.propertyId}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border rounded-md"
                    data-testid={`recommendation-${prop.propertyId}`}
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{prop.propertyAddress}</p>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                        <span>Current: {formatCents(prop.revenuePerVisitCents)}/visit</span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                        <span className="text-green-600 dark:text-green-400 font-medium">
                          Recommended: {formatCents(prop.recommendedPriceCents)}/visit
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="shrink-0">
                              +{formatCents(priceDiff)} increase
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Projected margin: {formatPct(projectedMargin)}</p>
                            <p>Projected profit/visit: {formatCents(projectedProfit)}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        data-testid={`button-adjust-${prop.propertyId}`}
                      >
                        <Link href={`/contacts/${profitData.contactId}`}>
                          <Edit2 className="h-3.5 w-3.5 mr-1" />
                          Edit Pricing
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2 flex-wrap pb-4">
        <Button variant="outline" asChild data-testid="button-view-contact">
          <Link href={`/contacts/${profitData.contactId}`}>
            <ArrowRight className="h-4 w-4 mr-1" />
            View Customer Details
          </Link>
        </Button>
        <Button variant="outline" asChild data-testid="button-full-calculator">
          <Link href="/pricing-calculator">
            <Calculator className="h-4 w-4 mr-1" />
            Full Price Calculator
          </Link>
        </Button>
      </div>
    </div>
  );
}
