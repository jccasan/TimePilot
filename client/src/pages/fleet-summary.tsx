import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrency } from "@/hooks/use-currency";
import { Truck, ChevronLeft, DollarSign, Fuel, Wrench, AlertTriangle } from "lucide-react";

type VehicleSummary = {
  vehicle: {
    id: string;
    make: string;
    model: string;
    year: number;
    licensePlate: string | null;
    status: string;
  } | null;
  fuelCost: number;
  maintCost: number;
  repairCost: number;
  totalCost: number;
  totalMiles: number;
  costPerMile: number | null;
  avgMpg: number | null;
  downtimeDays: number;
  fuelPct: number;
  maintPct: number;
  repairPct: number;
};

type FleetSummary = {
  vehicles: VehicleSummary[];
  totalFuelCost: number;
  totalMaintCost: number;
  totalRepairCost: number;
  totalCost: number;
  totalMiles: number;
  totalDowntime: number;
  fleetAvgMpg: number | null;
  costPerMile: number | null;
  fuelPct: number;
  maintPct: number;
  repairPct: number;
};

function CostBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export default function FleetSummaryPage() {
  const { formatMoney } = useCurrency();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [applied, setApplied] = useState<{ start: string; end: string } | null>(null);

  const params = new URLSearchParams();
  if (applied?.start) params.set("startDate", applied.start);
  if (applied?.end) params.set("endDate", applied.end);
  const queryStr = params.toString() ? `?${params.toString()}` : "";

  const { data, isLoading } = useQuery<FleetSummary>({
    queryKey: [`/api/vehicles/fleet-summary${queryStr}`, applied],
  });

  function applyPreset(days: number) {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().split("T")[0];
    const s = fmt(start);
    const e = fmt(end);
    setStartDate(s);
    setEndDate(e);
    setApplied({ start: s, end: e });
  }

  function applyFilter() {
    setApplied({ start: startDate, end: endDate });
  }

  function clearFilter() {
    setStartDate("");
    setEndDate("");
    setApplied(null);
  }

  return (
    <div className="p-6 space-y-6" data-testid="fleet-summary-page">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild data-testid="button-back-to-fleet">
          <Link href="/fleet">
            <ChevronLeft className="h-5 w-5" />
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Fleet Cost Summary</h1>
      </div>

      {/* Date filter */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex flex-wrap gap-2" data-testid="date-presets">
            {[
              { label: "30 days", days: 30 },
              { label: "90 days", days: 90 },
              { label: "180 days", days: 180 },
              { label: "365 days", days: 365 },
            ].map(({ label, days }) => (
              <Button
                key={days}
                size="sm"
                variant="outline"
                onClick={() => applyPreset(days)}
                data-testid={`preset-${days}`}
              >
                {label}
              </Button>
            ))}
            {applied && (
              <Button
                onClick={clearFilter}
                size="sm"
                variant="ghost"
                data-testid="button-clear-filter"
              >
                Clear
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <Label className="text-xs mb-1">Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-40"
                data-testid="input-start-date"
              />
            </div>
            <div>
              <Label className="text-xs mb-1">End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-40"
                data-testid="input-end-date"
              />
            </div>
            <Button onClick={applyFilter} size="sm" data-testid="button-apply-filter">
              Apply
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : !data ? null : (
        <>
          {/* Fleet totals */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="fleet-totals">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-green-600" />
                  <span className="text-xs text-muted-foreground">Total Cost</span>
                </div>
                <p className="text-2xl font-bold" data-testid="total-cost">
                  {formatMoney(data.totalCost)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <Truck className="h-4 w-4 text-blue-500" />
                  <span className="text-xs text-muted-foreground">Total Miles</span>
                </div>
                <p className="text-2xl font-bold" data-testid="total-miles">
                  {data.totalMiles.toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-amber-500" />
                  <span className="text-xs text-muted-foreground">Cost/Mile</span>
                </div>
                <p className="text-2xl font-bold" data-testid="cost-per-mile">
                  {data.costPerMile !== null ? `$${data.costPerMile.toFixed(2)}` : "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <Fuel className="h-4 w-4 text-blue-400" />
                  <span className="text-xs text-muted-foreground">Fleet Avg MPG</span>
                </div>
                <p className="text-2xl font-bold" data-testid="fleet-mpg">
                  {data.fleetAvgMpg !== null ? `${data.fleetAvgMpg} mpg` : "—"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Cost breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Cost Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3" data-testid="cost-breakdown">
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Fuel className="h-3.5 w-3.5 text-blue-400" />
                    <span>Fuel</span>
                  </div>
                  <span className="font-medium">
                    {formatMoney(data.totalFuelCost)} ({Math.round(data.fuelPct)}%)
                  </span>
                </div>
                <CostBar pct={data.fuelPct} color="bg-blue-400" />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-3.5 w-3.5 text-amber-500" />
                    <span>Maintenance</span>
                  </div>
                  <span className="font-medium">
                    {formatMoney(data.totalMaintCost)} ({Math.round(data.maintPct)}%)
                  </span>
                </div>
                <CostBar pct={data.maintPct} color="bg-amber-400" />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                    <span>Repairs</span>
                  </div>
                  <span className="font-medium">
                    {formatMoney(data.totalRepairCost)} ({Math.round(data.repairPct)}%)
                  </span>
                </div>
                <CostBar pct={data.repairPct} color="bg-red-400" />
              </div>
            </CardContent>
          </Card>

          {/* Per-vehicle breakdown */}
          {data.vehicles.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Per-Vehicle Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3" data-testid="per-vehicle-breakdown">
                  {data.vehicles.map((vs, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg border"
                      data-testid={`vehicle-summary-row-${vs.vehicle?.id ?? i}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Truck className="h-4 w-4 text-green-600" />
                          <span className="font-medium text-sm">
                            {vs.vehicle
                              ? `${vs.vehicle.year} ${vs.vehicle.make} ${vs.vehicle.model}`
                              : "Unknown"}
                            {vs.vehicle?.licensePlate && (
                              <span className="text-muted-foreground ml-2">
                                ({vs.vehicle.licensePlate})
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="font-semibold text-sm">{formatMoney(vs.totalCost)}</span>
                          {vs.costPerMile !== null && (
                            <span className="text-xs text-muted-foreground ml-2">
                              ${vs.costPerMile.toFixed(2)}/mi
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                        <span>Fuel: {formatMoney(vs.fuelCost)}</span>
                        <span>Maint: {formatMoney(vs.maintCost)}</span>
                        <span>Repair: {formatMoney(vs.repairCost)}</span>
                      </div>
                      {vs.avgMpg !== null && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Avg MPG: {vs.avgMpg} &middot; {vs.totalMiles.toLocaleString()} miles
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {data.totalDowntime > 0 && (
            <Card className="border-amber-200 dark:border-amber-900">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium">
                    {data.totalDowntime} downtime days recorded across fleet
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
