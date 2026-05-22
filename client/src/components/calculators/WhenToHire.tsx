import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Users } from "lucide-react";

interface WhenToHireProps {
  weeklyBasePriceCents?: number;
  fixedOverheadCents?: number;
  activeClients?: number;
}

const WEEKS_PER_MONTH = 4.33;

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export default function WhenToHire({
  weeklyBasePriceCents = 0,
  fixedOverheadCents = 0,
  activeClients = 0,
}: WhenToHireProps) {
  const defaultRevPerVisit = weeklyBasePriceCents > 0 ? (weeklyBasePriceCents / 100).toFixed(2) : "25.00";
  const defaultOverhead = fixedOverheadCents > 0 ? (fixedOverheadCents / 100).toFixed(2) : "2000.00";

  const [avgRevenuePerVisit, setAvgRevenuePerVisit] = useState(defaultRevPerVisit);
  const [ownerYardsPerWeek, setOwnerYardsPerWeek] = useState("40");
  const [currentClients, setCurrentClients] = useState(activeClients > 0 ? String(activeClients) : "30");
  const [fixedOverhead, setFixedOverhead] = useState(defaultOverhead);

  const [hourlyWage, setHourlyWage] = useState("18");
  const [burdenRate, setBurdenRate] = useState("20");
  const [techHoursPerDay, setTechHoursPerDay] = useState("6");
  const [techDaysPerWeek, setTechDaysPerWeek] = useState("5");
  const [vehicleCost, setVehicleCost] = useState("400");
  const [techYardsPerWeek, setTechYardsPerWeek] = useState("60");

  const result = useMemo(() => {
    const rev = parseFloat(avgRevenuePerVisit) || 0;
    const ownerYards = parseFloat(ownerYardsPerWeek) || 0;
    const clients = parseFloat(currentClients) || 0;
    const overhead = parseFloat(fixedOverhead) || 0;
    const wage = parseFloat(hourlyWage) || 0;
    const burden = parseFloat(burdenRate) || 0;
    const hoursPerDay = parseFloat(techHoursPerDay) || 0;
    const daysPerWeek = parseFloat(techDaysPerWeek) || 0;
    const vehicle = parseFloat(vehicleCost) || 0;
    const techYards = parseFloat(techYardsPerWeek) || 0;

    const burdenedWage = wage * (1 + burden / 100);
    const techMonthlyCost = burdenedWage * hoursPerDay * daysPerWeek * WEEKS_PER_MONTH + vehicle;

    const ownerMonthlyFieldIncome = ownerYards * WEEKS_PER_MONTH * rev;
    const stepOffThreshold = rev * WEEKS_PER_MONTH > 0
      ? Math.ceil((techMonthlyCost + ownerMonthlyFieldIncome) / (rev * WEEKS_PER_MONTH))
      : null;

    const soloIncome = clients * rev * WEEKS_PER_MONTH - overhead;
    const withTechOwnerScoop =
      (clients + techYards * WEEKS_PER_MONTH) * rev - techMonthlyCost - overhead;
    const withTechOwnerManage =
      techYards * WEEKS_PER_MONTH * rev - techMonthlyCost - overhead;

    const ownerCapacity = ownerYards > 0 ? (clients / ownerYards) * 100 : 0;

    return {
      techMonthlyCost,
      stepOffThreshold,
      soloIncome,
      withTechOwnerScoop,
      withTechOwnerManage,
      ownerCapacity,
    };
  }, [
    avgRevenuePerVisit,
    ownerYardsPerWeek,
    currentClients,
    fixedOverhead,
    hourlyWage,
    burdenRate,
    techHoursPerDay,
    techDaysPerWeek,
    vehicleCost,
    techYardsPerWeek,
  ]);

  const clientsNum = parseFloat(currentClients) || 0;
  const threshold = result.stepOffThreshold;

  const capacityStatus =
    result.ownerCapacity < 60
      ? { label: "Room to grow", color: "text-green-600 dark:text-green-400", badge: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" }
      : result.ownerCapacity < 80
        ? { label: "Getting full", color: "text-yellow-600 dark:text-yellow-400", badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" }
        : { label: "Near capacity", color: "text-red-600 dark:text-red-400", badge: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" };

  const thresholdProgress = threshold && threshold > 0 ? Math.min((clientsNum / threshold) * 100, 100) : 0;
  const pastThreshold = threshold != null && clientsNum >= threshold;

  return (
    <div className="space-y-6">
      {/* Step-off threshold hero */}
      {threshold != null && (
        <Card className={`border-2 ${pastThreshold ? "border-green-500 dark:border-green-600" : "border-primary/30"}`}>
          <CardContent className="pt-5 pb-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Step-Off-The-Truck Threshold</p>
                <p className="text-4xl font-bold mt-1" data-testid="text-hire-threshold">{threshold} clients</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {pastThreshold
                    ? "You have enough clients to hire your first tech and stop scooping."
                    : `${threshold - clientsNum} more clients until you can step off the truck.`}
                </p>
              </div>
              <div className="text-right sm:text-left sm:min-w-[180px]">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>{clientsNum} clients</span>
                  <span>{threshold} target</span>
                </div>
                <Progress
                  value={thresholdProgress}
                  className="h-3"
                  data-testid="progress-hire-threshold"
                />
                <p className={`text-xs mt-1 font-medium ${pastThreshold ? "text-green-600 dark:text-green-400" : ""}`}>
                  {thresholdProgress.toFixed(0)}% of threshold
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Inputs */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Business Inputs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="hire-rev">Avg Revenue / Visit ($)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <Input
                      id="hire-rev"
                      type="number"
                      min="0"
                      step="0.50"
                      value={avgRevenuePerVisit}
                      onChange={(e) => setAvgRevenuePerVisit(e.target.value)}
                      className="pl-6"
                      data-testid="input-hire-rev-per-visit"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hire-clients">Current Clients</Label>
                  <Input
                    id="hire-clients"
                    type="number"
                    min="0"
                    step="1"
                    value={currentClients}
                    onChange={(e) => setCurrentClients(e.target.value)}
                    data-testid="input-hire-current-clients"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="hire-owner-yards">Owner Yards / Week</Label>
                  <Input
                    id="hire-owner-yards"
                    type="number"
                    min="0"
                    step="5"
                    value={ownerYardsPerWeek}
                    onChange={(e) => setOwnerYardsPerWeek(e.target.value)}
                    data-testid="input-hire-owner-yards"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hire-overhead">Fixed Overhead ($)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <Input
                      id="hire-overhead"
                      type="number"
                      min="0"
                      step="100"
                      value={fixedOverhead}
                      onChange={(e) => setFixedOverhead(e.target.value)}
                      className="pl-6"
                      data-testid="input-hire-overhead"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Technician Cost Inputs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="hire-wage">Hourly Wage ($)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <Input
                      id="hire-wage"
                      type="number"
                      min="0"
                      step="0.50"
                      value={hourlyWage}
                      onChange={(e) => setHourlyWage(e.target.value)}
                      className="pl-6"
                      data-testid="input-hire-wage"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hire-burden">Burden Rate (%)</Label>
                  <div className="relative">
                    <Input
                      id="hire-burden"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={burdenRate}
                      onChange={(e) => setBurdenRate(e.target.value)}
                      className="pr-6"
                      data-testid="input-hire-burden"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="hire-hours">Hours / Day</Label>
                  <Input
                    id="hire-hours"
                    type="number"
                    min="0"
                    step="0.5"
                    value={techHoursPerDay}
                    onChange={(e) => setTechHoursPerDay(e.target.value)}
                    data-testid="input-hire-hours"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hire-days">Days / Week</Label>
                  <Input
                    id="hire-days"
                    type="number"
                    min="0"
                    max="7"
                    step="1"
                    value={techDaysPerWeek}
                    onChange={(e) => setTechDaysPerWeek(e.target.value)}
                    data-testid="input-hire-days"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="hire-vehicle">Vehicle Cost ($/mo)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <Input
                      id="hire-vehicle"
                      type="number"
                      min="0"
                      step="50"
                      value={vehicleCost}
                      onChange={(e) => setVehicleCost(e.target.value)}
                      className="pl-6"
                      data-testid="input-hire-vehicle"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hire-tech-yards">Tech Yards / Week</Label>
                  <Input
                    id="hire-tech-yards"
                    type="number"
                    min="0"
                    step="5"
                    value={techYardsPerWeek}
                    onChange={(e) => setTechYardsPerWeek(e.target.value)}
                    data-testid="input-hire-tech-yards"
                  />
                </div>
              </div>
              <div className="pt-2 border-t">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Est. tech monthly cost</span>
                  <span className="font-semibold" data-testid="text-hire-tech-cost">{fmtCurrency(result.techMonthlyCost)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Capacity utilization */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Owner Capacity Utilization</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm">
                      {clientsNum} clients / {parseFloat(ownerYardsPerWeek) || 0} capacity
                    </span>
                    <Badge
                      variant="outline"
                      className={capacityStatus.badge}
                      data-testid="badge-capacity-status"
                    >
                      {capacityStatus.label}
                    </Badge>
                  </div>
                  <Progress
                    value={Math.min(result.ownerCapacity, 100)}
                    className="h-2"
                    data-testid="progress-capacity"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {result.ownerCapacity.toFixed(0)}% utilized
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Scenario Columns */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Owner Income Scenarios</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              <ScenarioColumn
                title="Solo"
                subtitle="Owner does all the work"
                income={result.soloIncome}
                data-testid="text-hire-solo-income"
              />
              <ScenarioColumn
                title="With Tech"
                subtitle="Owner still scoops"
                income={result.withTechOwnerScoop}
                data-testid="text-hire-with-tech-scoop"
              />
              <ScenarioColumn
                title="Owner Manages"
                subtitle="Tech does field work"
                income={result.withTechOwnerManage}
                highlight
                data-testid="text-hire-manager-income"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Net income shown after overhead. "Owner Manages" is the target state once past threshold.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ScenarioColumn({
  title,
  subtitle,
  income,
  highlight,
  "data-testid": testId,
}: {
  title: string;
  subtitle: string;
  income: number;
  highlight?: boolean;
  "data-testid"?: string;
}) {
  const positive = income >= 0;
  return (
    <div
      className={`rounded-lg border p-3 text-center space-y-1 ${highlight ? "border-primary/40 bg-primary/5" : ""}`}
    >
      <p className={`text-xs font-semibold ${highlight ? "text-primary" : "text-muted-foreground"}`}>{title}</p>
      <p className="text-[11px] text-muted-foreground leading-tight">{subtitle}</p>
      <p
        className={`text-lg font-bold mt-2 ${positive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
        data-testid={testId}
      >
        {fmtCurrency(income)}
      </p>
      <p className="text-[10px] text-muted-foreground">/month</p>
    </div>
  );
}
