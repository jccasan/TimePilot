import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Info } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface BreakevenCalculatorProps {
  weeklyBasePriceCents?: number;
  fixedOverheadCents?: number;
  activeClients?: number;
  variableCostPerVisitCents?: number;
}

const CHART_CLIENT_POINTS = [10, 20, 30, 40, 50, 75, 100, 125, 150, 200];
const VISITS_PER_WEEK_DEFAULT = 1;
const WEEKS_PER_MONTH = 4.33;

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtAxisY(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
  return `$${n}`;
}

export default function BreakevenCalculator({
  weeklyBasePriceCents = 0,
  fixedOverheadCents = 0,
  activeClients = 0,
  variableCostPerVisitCents = 0,
}: BreakevenCalculatorProps) {
  const defaultPrice = weeklyBasePriceCents > 0 ? (weeklyBasePriceCents / 100).toFixed(2) : "25.00";
  const defaultOverhead =
    fixedOverheadCents > 0 ? (fixedOverheadCents / 100).toFixed(2) : "2000.00";
  const defaultVarCost =
    variableCostPerVisitCents > 0 ? (variableCostPerVisitCents / 100).toFixed(2) : "5.00";

  const [pricePerVisit, setPricePerVisit] = useState(defaultPrice);
  const [priceAdj, setPriceAdj] = useState("0");
  const [variableCostPerVisit, setVariableCostPerVisit] = useState(defaultVarCost);
  const [fixedOverhead, setFixedOverhead] = useState(defaultOverhead);
  const [visitsPerWeek, setVisitsPerWeek] = useState(String(VISITS_PER_WEEK_DEFAULT));
  const [currentMilesPerStop, setCurrentMilesPerStop] = useState("2.5");
  const [targetMilesPerStop, setTargetMilesPerStop] = useState("1.5");
  const [mileageCostPerMile, setMileageCostPerMile] = useState("0.20");
  const [revenueTarget, setRevenueTarget] = useState("10000");
  const [marginTarget, setMarginTarget] = useState("20");

  const calc = useMemo(() => {
    const price = parseFloat(pricePerVisit) || 0;
    const adj = parseFloat(priceAdj) || 0;
    const varCost = parseFloat(variableCostPerVisit) || 0;
    const overhead = parseFloat(fixedOverhead) || 0;
    const vpw = parseFloat(visitsPerWeek) || 1;
    const curMiles = parseFloat(currentMilesPerStop) || 2.5;
    const tgtMiles = parseFloat(targetMilesPerStop) || 1.5;
    const mileRate = parseFloat(mileageCostPerMile) || 0.2;
    const revTarget = parseFloat(revenueTarget) || 0;
    const mrgTarget = parseFloat(marginTarget) || 0;

    const effectivePrice = price + adj;
    const revenuePerClient = effectivePrice * vpw * WEEKS_PER_MONTH;
    const variableCostPerClient = varCost * vpw * WEEKS_PER_MONTH;
    const contributionMargin = revenuePerClient - variableCostPerClient;

    const mileageDiff = curMiles - tgtMiles;
    const mileageSavingPerVisit = mileageDiff * mileRate;
    const denseVarCost = Math.max(0, varCost - mileageSavingPerVisit);
    const denseVarCostPerClient = denseVarCost * vpw * WEEKS_PER_MONTH;
    const denseContribution = revenuePerClient - denseVarCostPerClient;

    const invalid = contributionMargin <= 0;

    const breakevenClients = invalid ? null : Math.ceil(overhead / contributionMargin);
    const breakevenRevenue = breakevenClients != null ? breakevenClients * revenuePerClient : null;
    const breakevenClientsDense =
      denseContribution <= 0 || invalid ? null : Math.ceil(overhead / denseContribution);
    const clientsForRevTarget =
      revenuePerClient > 0 ? Math.ceil(revTarget / revenuePerClient) : null;

    const marginDenom = revenuePerClient * (1 - mrgTarget / 100);
    const clientsForMarginTarget =
      !invalid && marginDenom > 0 ? Math.ceil(overhead / marginDenom) : null;

    const chartData = CHART_CLIENT_POINTS.map((n) => ({
      clients: n,
      revenue: Math.round(n * revenuePerClient),
      totalCost: Math.round(n * variableCostPerClient + overhead),
    }));

    return {
      effectivePrice,
      revenuePerClient,
      contributionMargin,
      breakevenClients,
      breakevenRevenue,
      breakevenClientsDense,
      clientsForRevTarget,
      clientsForMarginTarget,
      invalid,
      chartData,
    };
  }, [
    pricePerVisit,
    priceAdj,
    variableCostPerVisit,
    fixedOverhead,
    visitsPerWeek,
    currentMilesPerStop,
    targetMilesPerStop,
    mileageCostPerMile,
    revenueTarget,
    marginTarget,
  ]);

  const priceNum = parseFloat(pricePerVisit) || 0;
  const adjNum = parseFloat(priceAdj) || 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Inputs */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pricing Inputs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="be-price">Price / Visit ($)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="be-price"
                      type="number"
                      min="0"
                      step="0.50"
                      value={pricePerVisit}
                      onChange={(e) => setPricePerVisit(e.target.value)}
                      className="pl-6"
                      data-testid="input-be-price"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="be-visits">Visits / Week</Label>
                  <Input
                    id="be-visits"
                    type="number"
                    min="0.25"
                    step="0.25"
                    value={visitsPerWeek}
                    onChange={(e) => setVisitsPerWeek(e.target.value)}
                    data-testid="input-be-visits"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="be-price-adj">Price Adjustment (±$ / visit)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    ±$
                  </span>
                  <Input
                    id="be-price-adj"
                    type="number"
                    min="-10"
                    max="20"
                    step="0.50"
                    value={priceAdj}
                    onChange={(e) => setPriceAdj(e.target.value)}
                    className="pl-8"
                    data-testid="input-be-price-adj"
                  />
                </div>
                {adjNum !== 0 && (
                  <p className="text-xs text-muted-foreground">
                    Old price: {fmtCurrency(priceNum)} → New effective price:{" "}
                    {fmtCurrency(calc.effectivePrice)}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="be-var-cost">Variable Cost / Visit ($)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="be-var-cost"
                    type="number"
                    min="0"
                    step="0.25"
                    value={variableCostPerVisit}
                    onChange={(e) => setVariableCostPerVisit(e.target.value)}
                    className="pl-6"
                    data-testid="input-be-var-cost"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="be-overhead">Fixed Monthly Overhead ($)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="be-overhead"
                    type="number"
                    min="0"
                    step="50"
                    value={fixedOverhead}
                    onChange={(e) => setFixedOverhead(e.target.value)}
                    className="pl-6"
                    data-testid="input-be-overhead"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Route Density Adjustment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="be-cur-miles">Current Miles / Stop</Label>
                  <Input
                    id="be-cur-miles"
                    type="number"
                    min="0"
                    step="0.25"
                    value={currentMilesPerStop}
                    onChange={(e) => setCurrentMilesPerStop(e.target.value)}
                    data-testid="input-be-current-miles"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="be-tgt-miles">Target Miles / Stop</Label>
                  <Input
                    id="be-tgt-miles"
                    type="number"
                    min="0"
                    step="0.25"
                    value={targetMilesPerStop}
                    onChange={(e) => setTargetMilesPerStop(e.target.value)}
                    data-testid="input-be-target-miles"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="be-mile-rate">Mileage Cost ($/mile)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="be-mile-rate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={mileageCostPerMile}
                    onChange={(e) => setMileageCostPerMile(e.target.value)}
                    className="pl-6"
                    data-testid="input-be-mileage-rate"
                  />
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-md bg-primary/5 p-3 text-sm">
                <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span className="text-muted-foreground">Denser routes = lower breakeven</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Targets</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="be-rev-target">Monthly Revenue Target ($)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="be-rev-target"
                    type="number"
                    min="0"
                    step="500"
                    value={revenueTarget}
                    onChange={(e) => setRevenueTarget(e.target.value)}
                    className="pl-6"
                    data-testid="input-be-revenue-target"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="be-margin-target">Margin Target (%)</Label>
                <div className="relative">
                  <Input
                    id="be-margin-target"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={marginTarget}
                    onChange={(e) => setMarginTarget(e.target.value)}
                    className="pr-6"
                    data-testid="input-be-margin-target"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    %
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Outputs */}
        <div className="space-y-4">
          {calc.invalid ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Your current pricing doesn't cover variable costs — breakeven is unreachable at this
                price.
              </AlertDescription>
            </Alert>
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Key Numbers</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <KeyNumber
                    label="Breakeven Clients (current routes)"
                    value={calc.breakevenClients != null ? `${calc.breakevenClients} clients` : "—"}
                    sub={
                      calc.breakevenRevenue != null
                        ? `${fmtCurrency(calc.breakevenRevenue)}/mo revenue`
                        : undefined
                    }
                    data-testid="text-be-breakeven-current"
                    highlight={
                      activeClients > 0 &&
                      calc.breakevenClients != null &&
                      activeClients >= calc.breakevenClients
                        ? "green"
                        : "red"
                    }
                  />
                  <KeyNumber
                    label="Breakeven Clients (target route density)"
                    value={
                      calc.breakevenClientsDense != null
                        ? `${calc.breakevenClientsDense} clients`
                        : "—"
                    }
                    sub="Lower cost per stop from denser routes"
                    data-testid="text-be-breakeven-dense"
                  />
                  <KeyNumber
                    label={`Clients for ${fmtCurrency(parseFloat(revenueTarget) || 0)}/mo revenue target`}
                    value={
                      calc.clientsForRevTarget != null ? `${calc.clientsForRevTarget} clients` : "—"
                    }
                    data-testid="text-be-clients-revenue-target"
                  />
                  <KeyNumber
                    label={`Clients for ${parseFloat(marginTarget) || 0}% margin target`}
                    value={
                      calc.clientsForMarginTarget != null
                        ? `${calc.clientsForMarginTarget} clients`
                        : "—"
                    }
                    data-testid="text-be-clients-margin-target"
                  />
                </div>

                {activeClients > 0 && calc.breakevenClients != null && (
                  <div className="mt-4 pt-4 border-t">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Current clients</span>
                      <span className="font-semibold">{activeClients}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm mt-1">
                      <span className="text-muted-foreground">Gap to breakeven</span>
                      <span
                        className={`font-semibold ${activeClients >= calc.breakevenClients ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                        data-testid="text-be-gap"
                      >
                        {activeClients >= calc.breakevenClients
                          ? `+${activeClients - calc.breakevenClients} above`
                          : `${calc.breakevenClients - activeClients} to go`}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Chart */}
      {!calc.invalid && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Revenue vs. Total Cost by Client Count</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={calc.chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="clients"
                  tick={{ fontSize: 11 }}
                  label={{ value: "Clients", position: "insideBottom", offset: -2, fontSize: 11 }}
                  height={36}
                />
                <YAxis tickFormatter={fmtAxisY} tick={{ fontSize: 11 }} width={52} />
                <Tooltip
                  formatter={(v: number, name: string) => [fmtCurrency(v), name]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {activeClients > 0 && (
                  <ReferenceLine
                    x={activeClients}
                    stroke="hsl(var(--primary))"
                    strokeDasharray="4 2"
                    label={{ value: "You", position: "top", fontSize: 11 }}
                  />
                )}
                <Bar
                  dataKey="revenue"
                  name="Revenue"
                  fill="hsl(var(--chart-1))"
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="totalCost"
                  name="Total Cost"
                  fill="hsl(var(--chart-2))"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KeyNumber({
  label,
  value,
  sub,
  "data-testid": testId,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  "data-testid"?: string;
  highlight?: "green" | "red";
}) {
  const valueColor =
    highlight === "green"
      ? "text-green-600 dark:text-green-400"
      : highlight === "red"
        ? "text-red-600 dark:text-red-400"
        : "";
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold ${valueColor}`} data-testid={testId}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
