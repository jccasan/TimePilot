import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";

interface LTVCalculatorProps {
  avgMonthlyRevenueCents?: number;
  netMarginPct?: number;
}

function fmtDollars(n: number): string {
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtMonths(n: number): string {
  if (!isFinite(n) || n > 9999) return "∞";
  return `${Math.round(n)} mo`;
}

const CHURN_ROWS = [1, 2, 3, 4, 5, 7, 10, 15];

interface CalcResult {
  lifespanMonths: number;
  lifespanCapped: boolean;
  grossLTV: number;
  netLTV: number;
  npvLTV: number;
  maxCAC: number;
  paybackMonths: number;
  acquisitionROI: number;
  negativeMargin: boolean;
}

function calcLTV(
  avgMonthlyRevenue: number,
  netMarginPct: number,
  monthlyChurnPct: number,
  annualDiscountRate: number,
  cac: number
): CalcResult {
  const negativeMargin = netMarginPct <= 0;

  const rawLifespan = monthlyChurnPct > 0 ? 1 / (monthlyChurnPct / 100) : Infinity;
  const lifespanCapped = rawLifespan > 240;
  const lifespanMonths = Math.min(rawLifespan, 240);

  const grossLTV = avgMonthlyRevenue * lifespanMonths;
  const netLTV = grossLTV * (netMarginPct / 100);

  const r = annualDiscountRate / 100 / 12;
  const n = lifespanMonths;
  const monthlyNetProfit = avgMonthlyRevenue * (netMarginPct / 100);
  let npvLTV: number;
  if (r === 0) {
    npvLTV = netLTV;
  } else {
    npvLTV = monthlyNetProfit * ((1 - Math.pow(1 + r, -n)) / r);
  }

  const maxCAC = netLTV / 3;

  const denominator = avgMonthlyRevenue * (netMarginPct / 100);
  const paybackMonths = denominator > 0 ? cac / denominator : Infinity;

  const acquisitionROI = cac > 0 ? ((netLTV - cac) / cac) * 100 : 0;

  return {
    lifespanMonths,
    lifespanCapped,
    grossLTV,
    netLTV,
    npvLTV,
    maxCAC,
    paybackMonths,
    acquisitionROI,
    negativeMargin,
  };
}

export default function LTVCalculator({
  avgMonthlyRevenueCents = 0,
  netMarginPct: initMargin = 30,
}: LTVCalculatorProps) {
  const defaultRevenue =
    avgMonthlyRevenueCents > 0 ? (avgMonthlyRevenueCents / 100).toFixed(2) : "120.00";

  const [avgMonthlyRevenue, setAvgMonthlyRevenue] = useState(defaultRevenue);
  const [netMarginPct, setNetMarginPct] = useState(String(Math.max(0, initMargin || 30)));
  const [monthlyChurnPct, setMonthlyChurnPct] = useState("3");
  const [annualDiscountRate, setAnnualDiscountRate] = useState("10");
  const [cac, setCac] = useState("150");

  const result = useMemo(() => {
    const rev = parseFloat(avgMonthlyRevenue) || 0;
    const margin = parseFloat(netMarginPct) || 0;
    const churn = parseFloat(monthlyChurnPct) || 0;
    const discount = parseFloat(annualDiscountRate) || 0;
    const cacVal = parseFloat(cac) || 0;
    return calcLTV(rev, margin, churn, discount, cacVal);
  }, [avgMonthlyRevenue, netMarginPct, monthlyChurnPct, annualDiscountRate, cac]);

  const currentChurnNum = parseFloat(monthlyChurnPct) || 3;
  const cacNum = parseFloat(cac) || 0;
  const revenueNum = parseFloat(avgMonthlyRevenue) || 0;
  const marginNum = parseFloat(netMarginPct) || 0;

  const sensitivityRows = useMemo(() => {
    return CHURN_ROWS.map((churnPct) => {
      const r = calcLTV(
        revenueNum,
        marginNum,
        churnPct,
        parseFloat(annualDiscountRate) || 10,
        cacNum
      );
      return { churnPct, ...r };
    });
  }, [revenueNum, marginNum, annualDiscountRate, cacNum]);

  const roiPositive = result.acquisitionROI >= 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Inputs */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Inputs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ltv-avg-revenue">Avg Monthly Revenue / Customer ($)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="ltv-avg-revenue"
                  type="number"
                  min="0"
                  step="0.01"
                  value={avgMonthlyRevenue}
                  onChange={(e) => setAvgMonthlyRevenue(e.target.value)}
                  className="pl-6"
                  data-testid="input-ltv-avg-revenue"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Pre-filled from your profitability data
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ltv-net-margin">Net Profit Margin (%)</Label>
              <div className="relative">
                <Input
                  id="ltv-net-margin"
                  type="number"
                  min="-100"
                  max="100"
                  step="0.1"
                  value={netMarginPct}
                  onChange={(e) => setNetMarginPct(e.target.value)}
                  className="pr-6"
                  data-testid="input-ltv-net-margin"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  %
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ltv-churn">Monthly Churn Rate (%)</Label>
              <div className="relative">
                <Input
                  id="ltv-churn"
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={monthlyChurnPct}
                  onChange={(e) => setMonthlyChurnPct(e.target.value)}
                  className="pr-6"
                  data-testid="input-ltv-churn"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  %
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ltv-discount">Annual Discount Rate (%)</Label>
              <div className="relative">
                <Input
                  id="ltv-discount"
                  type="number"
                  min="0"
                  max="50"
                  step="0.5"
                  value={annualDiscountRate}
                  onChange={(e) => setAnnualDiscountRate(e.target.value)}
                  className="pr-6"
                  data-testid="input-ltv-discount-rate"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  %
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ltv-cac">Customer Acquisition Cost ($)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="ltv-cac"
                  type="number"
                  min="0"
                  step="1"
                  value={cac}
                  onChange={(e) => setCac(e.target.value)}
                  className="pl-6"
                  data-testid="input-ltv-cac"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Marketing spend ÷ new customers acquired
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Outputs */}
        <div className="space-y-4">
          {result.negativeMargin && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Your current margin means each customer costs you money over their lifetime. Fix
                pricing before optimizing acquisition.
              </AlertDescription>
            </Alert>
          )}

          {result.lifespanCapped && (
            <Alert>
              <AlertDescription className="text-sm">
                Lifespan capped at 20 years for calculation purposes.
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Outputs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <OutputTile
                  label="Avg Lifespan"
                  value={fmtMonths(result.lifespanMonths)}
                  data-testid="text-ltv-lifespan"
                />
                <OutputTile
                  label="Gross LTV"
                  value={fmtDollars(result.grossLTV)}
                  data-testid="text-ltv-gross"
                />
                <OutputTile
                  label="Net LTV"
                  value={fmtDollars(result.netLTV)}
                  data-testid="text-ltv-net"
                />
                <OutputTile
                  label="NPV of LTV"
                  value={fmtDollars(result.npvLTV)}
                  data-testid="text-ltv-npv"
                />
                <OutputTile
                  label="Max CAC (3:1)"
                  value={fmtDollars(result.maxCAC)}
                  data-testid="text-ltv-max-cac"
                />
                <OutputTile
                  label="CAC Payback"
                  value={
                    !isFinite(result.paybackMonths) ? "∞" : `${result.paybackMonths.toFixed(1)} mo`
                  }
                  data-testid="text-ltv-payback"
                />
              </div>

              {cacNum > 0 && !result.negativeMargin && (
                <div className="mt-4 pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Acquisition ROI</span>
                    <div className="flex items-center gap-1.5">
                      {roiPositive ? (
                        <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
                      )}
                      <span
                        className={`text-lg font-bold ${roiPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                        data-testid="text-ltv-roi"
                      >
                        {result.acquisitionROI.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">(Net LTV − CAC) ÷ CAC</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Sensitivity Table */}
      {!result.negativeMargin && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Churn Sensitivity</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-churn-sensitivity">
              <thead>
                <tr className="text-left border-b">
                  <th className="pb-2 pr-4 font-medium text-muted-foreground">Churn %</th>
                  <th className="pb-2 pr-4 font-medium text-muted-foreground">Avg Lifespan</th>
                  <th className="pb-2 pr-4 font-medium text-muted-foreground">Net LTV</th>
                  <th className="pb-2 pr-4 font-medium text-muted-foreground">Max CAC (3:1)</th>
                  <th className="pb-2 font-medium text-muted-foreground">Payback Months</th>
                </tr>
              </thead>
              <tbody>
                {sensitivityRows.map((row) => {
                  const isCurrent = row.churnPct === Math.round(currentChurnNum);
                  const cacBelowMax = cacNum > 0 && cacNum <= row.maxCAC;
                  const cacAboveMax = cacNum > 0 && cacNum > row.maxCAC;
                  return (
                    <tr
                      key={row.churnPct}
                      className={`border-b last:border-0 ${isCurrent ? "bg-primary/5 font-semibold" : ""}`}
                      data-testid={`row-sensitivity-${row.churnPct}`}
                    >
                      <td className="py-2 pr-4">
                        {row.churnPct}%
                        {isCurrent && (
                          <Badge variant="outline" className="ml-2 text-xs py-0">
                            current
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-4">{fmtMonths(row.lifespanMonths)}</td>
                      <td className="py-2 pr-4">{fmtDollars(row.netLTV)}</td>
                      <td
                        className={`py-2 pr-4 ${cacBelowMax ? "text-green-600 dark:text-green-400" : cacAboveMax ? "text-red-600 dark:text-red-400" : ""}`}
                        data-testid={`text-max-cac-${row.churnPct}`}
                      >
                        {fmtDollars(row.maxCAC)}
                      </td>
                      <td className="py-2">
                        {!isFinite(row.paybackMonths) ? "∞" : `${row.paybackMonths.toFixed(1)} mo`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {cacNum > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Max CAC cells highlighted green when your entered CAC (${cacNum.toFixed(0)}) is
                below the threshold, red when above.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function OutputTile({
  label,
  value,
  "data-testid": testId,
}: {
  label: string;
  value: string;
  "data-testid"?: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}
