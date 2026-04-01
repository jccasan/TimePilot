import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { MapPin, Eye, Layers, ChevronRight, ChevronDown, DollarSign, TrendingUp, AlertTriangle, Map as MapIcon, Sparkles, X, ArrowRight, Fuel, Clock, Route, Loader2, ArrowLeftRight } from "lucide-react";
import ProfitabilityMap, { type MapRoute, type MapStop } from "@/components/profitability-map";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ViewMode = "stops" | "zones";
type DayFilter = "all" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
type CompareView = "current" | "optimized";

type RouteFuel = {
  routeLabel: string;
  fuelCostCents: number;
  miles: number;
};

type FuelDayData = {
  day: string;
  fuelCostCents: number;
  routes: RouteFuel[];
};

type FuelCostData = {
  centsPerMile: number;
  source: string;
  gasPriceCentsPerGallon: number;
  vehicleMPG: number | null;
  currentTotalCents: number;
  proposedTotalCents: number;
  savedCents: number;
  currentPerDay: FuelDayData[];
  proposedPerDay: FuelDayData[];
};

type OptProposedRoute = {
  routeLabel: string;
  day: string;
  stops: { servicePlanId: string; contactName: string; address: string; latitude: number; longitude: number }[];
  estimatedMiles: number;
  estimatedMinutes: number;
  stopCount: number;
};

type OptDayProposal = {
  day: string;
  routes: OptProposedRoute[];
  totalStops: number;
  totalMiles: number;
  totalMinutes: number;
};

type OptResult = {
  current: { days: OptDayProposal[]; totalMiles: number; totalMinutes: number; totalStops: number };
  proposed: { days: OptDayProposal[]; totalMiles: number; totalMinutes: number; totalStops: number };
  improvementPct: number;
  milesSaved: number;
  minutesSaved: number;
  movedStops: { stopId: string; fromDay: string; toDay: string; contactName: string }[];
  creditsRequired: number;
  fuelCost: FuelCostData;
};

const ROUTE_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

function formatDollars(cents: number): string {
  const abs = Math.abs(cents);
  const formatted = `$${(abs / 100).toFixed(2)}`;
  return cents < 0 ? `-${formatted}` : formatted;
}

function statusBadge(status: "profitable" | "marginal" | "unprofitable") {
  const variants: Record<string, string> = {
    profitable: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    marginal: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    unprofitable: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <Badge variant="outline" className={`text-xs ${variants[status]}`} data-testid={`badge-status-${status}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function buildOptimizedMapRoutes(optResult: OptResult, view: "current" | "proposed"): MapRoute[] {
  const schedule = view === "current" ? optResult.current : optResult.proposed;
  const fuelPerDay = view === "current" ? optResult.fuelCost.currentPerDay : optResult.fuelCost.proposedPerDay;
  const fuelByDay = new Map(fuelPerDay.map(d => [d.day, d]));

  const mapRoutes: MapRoute[] = [];
  let colorIdx = 0;

  for (const dayPlan of schedule.days) {
    const dayFuelData = fuelByDay.get(dayPlan.day);
    for (let rIdx = 0; rIdx < dayPlan.routes.length; rIdx++) {
      const route = dayPlan.routes[rIdx];
      if (route.stops.length === 0) continue;

      const routeFuelCents = dayFuelData?.routes?.[rIdx]?.fuelCostCents || 0;

      const stops: MapStop[] = route.stops.map((s, idx) => ({
        propertyId: s.servicePlanId,
        contactId: s.servicePlanId,
        contactName: s.contactName,
        propertyAddress: s.address,
        latitude: s.latitude,
        longitude: s.longitude,
        frequency: "weekly",
        dogCount: 1,
        yardSize: "medium",
        revenuePerVisitCents: 0,
        costPerVisitCents: 0,
        profitPerVisitCents: 0,
        profitMarginPct: 50,
        status: "profitable" as const,
        stopOrder: idx + 1,
      }));

      mapRoutes.push({
        routeId: `opt-${dayPlan.day}-${route.routeLabel}`,
        routeName: route.routeLabel,
        dayOfWeek: dayPlan.day,
        color: ROUTE_COLORS[colorIdx % ROUTE_COLORS.length],
        totalStops: route.stopCount,
        totalRevenueCents: 0,
        totalCostCents: routeFuelCents,
        totalProfitCents: 0,
        avgMarginPct: 0,
        status: "profitable",
        stops,
      });
      colorIdx++;
    }
  }
  return mapRoutes;
}

export default function RouteProfitMaps() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<ViewMode>("stops");
  const [dayFilter, setDayFilter] = useState<DayFilter>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "profitable" | "marginal" | "unprofitable">("all");
  const [visibleRouteIds, setVisibleRouteIds] = useState<Set<string>>(new Set());
  const [focusRouteId, setFocusRouteId] = useState<string | null>(null);
  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [optResult, setOptResult] = useState<OptResult | null>(null);
  const [compareView, setCompareView] = useState<CompareView>("current");

  const isComparing = optResult !== null;

  const { data: routeMapData, isLoading } = useQuery<MapRoute[]>({
    queryKey: ["/api/profitability/route-map"],
  });

  const routes = routeMapData ?? [];

  const optimizeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/routes/optimize-weekly", {
        respectZones: false,
        includeSaturday: false,
      });
      return res.json() as Promise<OptResult>;
    },
    onSuccess: (data) => {
      setOptResult(data);
      setCompareView("current");
      setSidebarOpen(true);
    },
    onError: (err: Error) => {
      toast({ title: "Optimization failed", description: err.message, variant: "destructive" });
    },
  });

  const exitComparison = () => {
    setOptResult(null);
    setCompareView("current");
  };

  useEffect(() => {
    if (routes.length > 0 && visibleRouteIds.size === 0) {
      setVisibleRouteIds(new Set(routes.map((r) => r.routeId)));
    }
  }, [routes]);

  const optimizedMapRoutes = useMemo(() => {
    if (!optResult) return [];
    return buildOptimizedMapRoutes(optResult, compareView === "current" ? "current" : "proposed");
  }, [optResult, compareView]);

  const optimizedVisibleIds = useMemo(() => {
    return new Set(optimizedMapRoutes.map(r => r.routeId));
  }, [optimizedMapRoutes]);

  const filteredRoutes = useMemo(() => {
    return routes.filter((r) => {
      if (dayFilter !== "all" && r.dayOfWeek !== dayFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      return true;
    });
  }, [routes, dayFilter, statusFilter]);

  const effectiveVisibleIds = useMemo(() => {
    const filtered = new Set(filteredRoutes.map((r) => r.routeId));
    return new Set([...visibleRouteIds].filter((id) => filtered.has(id)));
  }, [filteredRoutes, visibleRouteIds]);

  const toggleRoute = (routeId: string) => {
    setVisibleRouteIds((prev) => {
      const next = new Set(prev);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
  };

  const toggleAll = () => {
    const allIds = filteredRoutes.map((r) => r.routeId);
    const allVisible = allIds.every((id) => visibleRouteIds.has(id));
    if (allVisible) {
      setVisibleRouteIds((prev) => {
        const next = new Set(prev);
        allIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setVisibleRouteIds((prev) => {
        const next = new Set(prev);
        allIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const totalStopsVisible = filteredRoutes
    .filter((r) => effectiveVisibleIds.has(r.routeId))
    .reduce((sum, r) => sum + r.totalStops, 0);

  const totalProfitVisible = filteredRoutes
    .filter((r) => effectiveVisibleIds.has(r.routeId))
    .reduce((sum, r) => sum + r.totalProfitCents, 0);

  const totalRevenueVisible = filteredRoutes
    .filter((r) => effectiveVisibleIds.has(r.routeId))
    .reduce((sum, r) => sum + r.totalRevenueCents, 0);

  const avgMarginVisible = totalRevenueVisible > 0
    ? Math.round((totalProfitVisible / totalRevenueVisible) * 10000) / 100
    : 0;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center" data-testid="loading-route-profit-maps">
        <Skeleton className="w-full h-full" />
      </div>
    );
  }

  const displayRoutes = isComparing ? optimizedMapRoutes : routes;
  const displayVisibleIds = isComparing ? optimizedVisibleIds : effectiveVisibleIds;

  return (
    <div className="h-full flex flex-col" data-testid="page-route-profit-maps">
      <div className="flex items-center justify-between gap-2 p-3 border-b bg-background shrink-0">
        <div className="flex items-center gap-2">
          <MapIcon className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold" data-testid="text-page-title">Route Profit Maps</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!isComparing && (
            <>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                <span data-testid="text-total-stops">{totalStopsVisible} stops</span>
              </div>
              <div className="text-xs text-muted-foreground" data-testid="text-visible-routes">
                {effectiveVisibleIds.size}/{filteredRoutes.length} routes
              </div>
              <div className={`text-xs font-medium ${avgMarginVisible >= 15 ? "text-green-600 dark:text-green-400" : avgMarginVisible >= 0 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-avg-margin">
                Avg margin: {avgMarginVisible.toFixed(1)}%
              </div>

              <Select value={dayFilter} onValueChange={(v) => setDayFilter(v as DayFilter)}>
                <SelectTrigger className="h-8 w-32 text-xs" data-testid="select-day-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Days</SelectItem>
                  <SelectItem value="monday">Monday</SelectItem>
                  <SelectItem value="tuesday">Tuesday</SelectItem>
                  <SelectItem value="wednesday">Wednesday</SelectItem>
                  <SelectItem value="thursday">Thursday</SelectItem>
                  <SelectItem value="friday">Friday</SelectItem>
                  <SelectItem value="saturday">Saturday</SelectItem>
                  <SelectItem value="sunday">Sunday</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="profitable">Profitable</SelectItem>
                  <SelectItem value="marginal">Marginal</SelectItem>
                  <SelectItem value="unprofitable">Unprofitable</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex items-center border rounded-md overflow-hidden">
                <Button
                  variant={viewMode === "stops" ? "default" : "ghost"}
                  size="sm"
                  className="h-8 rounded-none text-xs gap-1"
                  onClick={() => setViewMode("stops")}
                  data-testid="button-view-stops"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Stops
                </Button>
                <Button
                  variant={viewMode === "zones" ? "default" : "ghost"}
                  size="sm"
                  className="h-8 rounded-none text-xs gap-1"
                  onClick={() => setViewMode("zones")}
                  data-testid="button-view-zones"
                >
                  <Layers className="h-3.5 w-3.5" />
                  Zones
                </Button>
              </div>
            </>
          )}

          {isComparing && (
            <div className="flex items-center border rounded-md overflow-hidden">
              <Button
                variant={compareView === "current" ? "default" : "ghost"}
                size="sm"
                className="h-8 rounded-none text-xs gap-1"
                onClick={() => setCompareView("current")}
                data-testid="button-compare-current"
              >
                Current
              </Button>
              <Button
                variant={compareView === "optimized" ? "default" : "ghost"}
                size="sm"
                className="h-8 rounded-none text-xs gap-1"
                onClick={() => setCompareView("optimized")}
                data-testid="button-compare-optimized"
              >
                Optimized
              </Button>
            </div>
          )}

          <Button
            variant={isComparing ? "outline" : "default"}
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => isComparing ? exitComparison() : optimizeMutation.mutate()}
            disabled={optimizeMutation.isPending || routes.length === 0}
            data-testid="button-optimize-week"
          >
            {optimizeMutation.isPending ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing...</>
            ) : isComparing ? (
              <><X className="h-3.5 w-3.5" /> Exit Comparison</>
            ) : (
              <><Sparkles className="h-3.5 w-3.5" /> Optimize Week</>
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            data-testid="button-toggle-sidebar"
          >
            {sidebarOpen ? "Hide Panel" : "Show Panel"}
          </Button>
        </div>
      </div>

      {isComparing && optResult && (
        <div className="bg-primary/5 border-b px-4 py-2.5 flex items-center gap-6 shrink-0" data-testid="comparison-savings-banner">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-primary" data-testid="text-improvement-pct">
              {optResult.improvementPct}% improvement
            </span>
          </div>
          <Separator orientation="vertical" className="h-5" />
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5" data-testid="text-miles-saved">
              <Route className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">{optResult.milesSaved} mi saved</span>
            </div>
            <div className="flex items-center gap-1.5" data-testid="text-fuel-saved">
              <Fuel className="h-3.5 w-3.5 text-muted-foreground" />
              <span className={`font-medium ${optResult.fuelCost.savedCents >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {optResult.fuelCost.savedCents >= 0
                  ? `${formatDollars(optResult.fuelCost.savedCents)} fuel saved`
                  : `${formatDollars(Math.abs(optResult.fuelCost.savedCents))} fuel increase`}
              </span>
            </div>
            <div className="flex items-center gap-1.5" data-testid="text-time-saved">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">{optResult.minutesSaved} min saved</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground" data-testid="text-fuel-rate">
              <span>
                {optResult.fuelCost.source === "gas_mpg"
                  ? `$${(optResult.fuelCost.gasPriceCentsPerGallon / 100).toFixed(2)}/gal, ${optResult.fuelCost.vehicleMPG} MPG`
                  : `${formatDollars(optResult.fuelCost.centsPerMile)}/mi`}
              </span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowLeftRight className="h-3.5 w-3.5" />
            <span>
              Viewing: <span className="font-medium text-foreground">{compareView === "current" ? "Current" : "Optimized"}</span>
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative">
          {displayRoutes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 p-8" data-testid="empty-map-state">
              <MapIcon className="h-12 w-12 opacity-30" />
              <p className="text-lg font-medium">
                {isComparing ? "No mappable stops in this view" : "No route data available"}
              </p>
              <p className="text-sm">
                {isComparing
                  ? "The optimizer result has no geocoded stops to display."
                  : "Create routes and assign jobs with geocoded properties to see profitability on the map."}
              </p>
            </div>
          ) : (
            <ProfitabilityMap
              routes={displayRoutes}
              visibleRouteIds={displayVisibleIds}
              viewMode={isComparing ? "stops" : viewMode}
              focusRouteId={focusRouteId}
              useRouteColors={isComparing}
              onStopClick={(stop) => {
                if (!isComparing) {
                  setExpandedRouteId(routes.find(r => r.stops.some(s => s.propertyId === stop.propertyId))?.routeId ?? null);
                }
              }}
            />
          )}

          {!isComparing && (
            <div className="absolute bottom-4 left-4 bg-background/90 rounded-lg border shadow-sm p-3 text-xs space-y-1.5 z-20" data-testid="map-legend">
              <p className="font-medium text-foreground">Legend</p>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-green-500 inline-block shrink-0"></span>
                <span>Profitable (&gt;15% margin)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-yellow-500 inline-block shrink-0"></span>
                <span>Marginal (0-15% margin)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500 inline-block shrink-0"></span>
                <span>Unprofitable (&lt;0% margin)</span>
              </div>
              {viewMode === "zones" && (
                <div className="pt-1 border-t mt-1">
                  <p className="text-muted-foreground">Heat zones show profit density by area</p>
                </div>
              )}
            </div>
          )}

          {isComparing && (
            <div className="absolute bottom-4 left-4 bg-background/90 rounded-lg border shadow-sm p-3 text-xs space-y-1.5 z-20" data-testid="map-compare-legend">
              <p className="font-medium text-foreground">
                {compareView === "current" ? "Current Routes" : "Optimized Routes"}
              </p>
              <p className="text-muted-foreground">
                {compareView === "current"
                  ? `${optResult!.current.totalMiles} mi total, ${formatDollars(optResult!.fuelCost.currentTotalCents)} fuel`
                  : `${optResult!.proposed.totalMiles} mi total, ${formatDollars(optResult!.fuelCost.proposedTotalCents)} fuel`}
              </p>
              <p className="text-muted-foreground">Color = route grouping, not profitability</p>
            </div>
          )}
        </div>

        {sidebarOpen && !isComparing && (
          <div className="w-80 border-l bg-background overflow-y-auto shrink-0" data-testid="route-sidebar-panel">
            <div className="p-3 border-b sticky top-0 bg-background z-10">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold">Routes ({filteredRoutes.length})</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={toggleAll}
                  data-testid="button-toggle-all-routes"
                >
                  {filteredRoutes.every((r) => visibleRouteIds.has(r.routeId)) ? "Hide All" : "Show All"}
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-muted/50 rounded p-1.5">
                  <p className="text-[10px] text-muted-foreground">Stops</p>
                  <p className="text-sm font-semibold" data-testid="text-sidebar-total-stops">{totalStopsVisible}</p>
                </div>
                <div className="bg-muted/50 rounded p-1.5">
                  <p className="text-[10px] text-muted-foreground">Profit</p>
                  <p className={`text-sm font-semibold ${totalProfitVisible >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-sidebar-total-profit">{formatDollars(totalProfitVisible)}</p>
                </div>
                <div className="bg-muted/50 rounded p-1.5">
                  <p className="text-[10px] text-muted-foreground">Margin</p>
                  <p className={`text-sm font-semibold ${avgMarginVisible >= 15 ? "text-green-600 dark:text-green-400" : avgMarginVisible >= 0 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-sidebar-avg-margin">{avgMarginVisible.toFixed(1)}%</p>
                </div>
              </div>
            </div>

            <div className="divide-y">
              {filteredRoutes.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground" data-testid="text-no-routes">
                  No routes match your filters.
                </div>
              )}
              {filteredRoutes.map((route) => {
                const isVisible = visibleRouteIds.has(route.routeId);
                const isExpanded = expandedRouteId === route.routeId;
                return (
                  <div key={route.routeId} className={`${!isVisible ? "opacity-50" : ""}`} data-testid={`route-panel-${route.routeId}`}>
                    <div className="flex items-center gap-2 p-2.5 hover:bg-muted/50 transition-colors">
                      <Checkbox
                        checked={isVisible}
                        onCheckedChange={() => toggleRoute(route.routeId)}
                        data-testid={`checkbox-route-${route.routeId}`}
                      />
                      <button
                        className="flex-1 flex items-center gap-2 text-left min-w-0"
                        onClick={() => {
                          setExpandedRouteId(isExpanded ? null : route.routeId);
                          setFocusRouteId(route.routeId);
                        }}
                        data-testid={`button-expand-route-${route.routeId}`}
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: route.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium truncate" data-testid={`text-route-name-${route.routeId}`}>{route.routeName}</span>
                            {statusBadge(route.status)}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {route.dayOfWeek.charAt(0).toUpperCase() + route.dayOfWeek.slice(1)} | {route.totalStops} stops | {formatDollars(route.totalProfitCents)} profit
                          </div>
                        </div>
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="bg-muted/30 border-t">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Revenue/visit:</span>
                            <span className="font-medium" data-testid={`text-route-revenue-${route.routeId}`}>{formatDollars(route.totalRevenueCents)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Cost/visit:</span>
                            <span className="font-medium" data-testid={`text-route-cost-${route.routeId}`}>{formatDollars(route.totalCostCents)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Profit/visit:</span>
                            <span className={`font-medium ${route.totalProfitCents >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid={`text-route-profit-${route.routeId}`}>{formatDollars(route.totalProfitCents)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Margin:</span>
                            <span className={`font-medium ${route.avgMarginPct >= 15 ? "text-green-600 dark:text-green-400" : route.avgMarginPct >= 0 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`} data-testid={`text-route-margin-${route.routeId}`}>{route.avgMarginPct.toFixed(1)}%</span>
                          </div>
                        </div>
                        <div className="px-3 pb-2">
                          <p className="text-[11px] font-medium text-muted-foreground mb-1">Stops</p>
                          <div className="space-y-1">
                            {route.stops.map((stop) => (
                              <div
                                key={stop.propertyId}
                                className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-background/60 transition-colors"
                                data-testid={`stop-row-${stop.propertyId}`}
                              >
                                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                  <span
                                    className="w-2 h-2 rounded-full shrink-0"
                                    style={{ backgroundColor: stop.status === "profitable" ? "#22c55e" : stop.status === "marginal" ? "#eab308" : "#ef4444" }}
                                  />
                                  <span className="truncate" data-testid={`text-stop-name-${stop.propertyId}`}>{stop.contactName}</span>
                                </div>
                                <span className={`shrink-0 ml-2 font-medium ${stop.profitPerVisitCents >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid={`text-stop-profit-${stop.propertyId}`}>
                                  {formatDollars(stop.profitPerVisitCents)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {sidebarOpen && isComparing && optResult && (
          <ComparisonSidebar optResult={optResult} compareView={compareView} />
        )}
      </div>
    </div>
  );
}

function ComparisonSidebar({ optResult, compareView }: { optResult: OptResult; compareView: CompareView }) {
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const currentSchedule = optResult.current;
  const proposedSchedule = optResult.proposed;
  const fuel = optResult.fuelCost;

  const currentFuelByDay = new Map(fuel.currentPerDay.map(d => [d.day, d]));
  const proposedFuelByDay = new Map(fuel.proposedPerDay.map(d => [d.day, d]));

  return (
    <div className="w-80 border-l bg-background overflow-y-auto shrink-0" data-testid="comparison-sidebar-panel">
      <div className="p-3 border-b sticky top-0 bg-background z-10">
        <h2 className="text-sm font-semibold mb-2">Before vs After</h2>

        <div className="grid grid-cols-2 gap-2 text-center mb-2">
          <div className="bg-muted/50 rounded p-2">
            <p className="text-[10px] text-muted-foreground mb-0.5">Current Miles</p>
            <p className="text-sm font-semibold" data-testid="text-compare-current-miles">{currentSchedule.totalMiles}</p>
          </div>
          <div className="bg-primary/10 rounded p-2">
            <p className="text-[10px] text-muted-foreground mb-0.5">Optimized Miles</p>
            <p className="text-sm font-semibold text-primary" data-testid="text-compare-proposed-miles">{proposedSchedule.totalMiles}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-center mb-2">
          <div className="bg-muted/50 rounded p-2">
            <p className="text-[10px] text-muted-foreground mb-0.5">Current Fuel</p>
            <p className="text-sm font-semibold" data-testid="text-compare-current-fuel">{formatDollars(fuel.currentTotalCents)}</p>
          </div>
          <div className="bg-primary/10 rounded p-2">
            <p className="text-[10px] text-muted-foreground mb-0.5">Optimized Fuel</p>
            <p className="text-sm font-semibold text-primary" data-testid="text-compare-proposed-fuel">{formatDollars(fuel.proposedTotalCents)}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="bg-muted/50 rounded p-2">
            <p className="text-[10px] text-muted-foreground mb-0.5">Current Time</p>
            <p className="text-sm font-semibold" data-testid="text-compare-current-time">{currentSchedule.totalMinutes} min</p>
          </div>
          <div className="bg-primary/10 rounded p-2">
            <p className="text-[10px] text-muted-foreground mb-0.5">Optimized Time</p>
            <p className="text-sm font-semibold text-primary" data-testid="text-compare-proposed-time">{proposedSchedule.totalMinutes} min</p>
          </div>
        </div>

        <div className="mt-2 bg-green-50 dark:bg-green-900/20 rounded p-2 text-center" data-testid="savings-summary-box">
          <p className="text-[10px] text-muted-foreground mb-0.5">Weekly Savings</p>
          <p className={`text-lg font-bold ${fuel.savedCents >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {fuel.savedCents >= 0 ? formatDollars(fuel.savedCents) : `-${formatDollars(Math.abs(fuel.savedCents))}`}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {optResult.milesSaved} mi, {optResult.minutesSaved} min saved
          </p>
        </div>
      </div>

      <div className="divide-y">
        <div className="p-3 border-b">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Day-by-Day Comparison</p>
        </div>

        {currentSchedule.days
          .filter(d => d.totalStops > 0 || (proposedSchedule.days.find(pd => pd.day === d.day)?.totalStops || 0) > 0)
          .map(currentDay => {
            const proposedDay = proposedSchedule.days.find(d => d.day === currentDay.day);
            const isExpanded = expandedDay === currentDay.day;
            const curFuelDay = currentFuelByDay.get(currentDay.day);
            const propFuelDay = proposedFuelByDay.get(currentDay.day);
            const curFuel = curFuelDay?.fuelCostCents || 0;
            const propFuel = propFuelDay?.fuelCostCents || 0;
            const fuelDelta = curFuel - propFuel;
            const milesDelta = currentDay.totalMiles - (proposedDay?.totalMiles || 0);

            return (
              <div key={currentDay.day} data-testid={`compare-day-${currentDay.day}`}>
                <button
                  className="w-full flex items-center gap-2 p-2.5 hover:bg-muted/50 transition-colors text-left"
                  onClick={() => setExpandedDay(isExpanded ? null : currentDay.day)}
                  data-testid={`button-compare-day-${currentDay.day}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium capitalize">{currentDay.day}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-muted-foreground">{currentDay.totalStops} stops</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">{proposedDay?.totalStops || 0} stops</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {fuelDelta > 0 ? (
                      <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        -{formatDollars(fuelDelta)}
                      </Badge>
                    ) : fuelDelta < 0 ? (
                      <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        +{formatDollars(Math.abs(fuelDelta))}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">--</Badge>
                    )}
                  </div>
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </button>

                {isExpanded && (
                  <div className="bg-muted/30 border-t p-3 space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-[10px] font-medium text-muted-foreground mb-1">Current</p>
                        <div className="space-y-0.5">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Miles:</span>
                            <span className="font-medium">{currentDay.totalMiles}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Time:</span>
                            <span className="font-medium">{currentDay.totalMinutes} min</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Fuel:</span>
                            <span className="font-medium">{formatDollars(curFuel)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Routes:</span>
                            <span className="font-medium">{currentDay.routes.length}</span>
                          </div>
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium text-primary mb-1">Optimized</p>
                        <div className="space-y-0.5">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Miles:</span>
                            <span className="font-medium text-primary">{proposedDay?.totalMiles || 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Time:</span>
                            <span className="font-medium text-primary">{proposedDay?.totalMinutes || 0} min</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Fuel:</span>
                            <span className="font-medium text-primary">{formatDollars(propFuel)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Routes:</span>
                            <span className="font-medium text-primary">{proposedDay?.routes.length || 0}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {milesDelta > 0 && (
                      <div className="bg-green-50 dark:bg-green-900/20 rounded p-1.5 text-center text-[11px] text-green-700 dark:text-green-400">
                        Saves {Math.round(milesDelta * 10) / 10} mi / {formatDollars(fuelDelta)} fuel
                      </div>
                    )}

                    <Separator />

                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Per-Route Breakdown</p>
                      <div className="space-y-2">
                        {currentDay.routes.map((curRoute, rIdx) => {
                          const curRouteFuel = curFuelDay?.routes?.[rIdx];
                          return (
                            <div key={`cur-${rIdx}`} className="border rounded p-2 text-xs" data-testid={`route-compare-current-${currentDay.day}-${rIdx}`}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-medium">{curRoute.routeLabel}</span>
                                <Badge variant="secondary" className="text-[9px]">Current</Badge>
                              </div>
                              <div className="grid grid-cols-3 gap-1 text-[11px]">
                                <div>
                                  <span className="text-muted-foreground">{curRoute.stopCount} stops</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">{curRoute.estimatedMiles} mi</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">{formatDollars(curRouteFuel?.fuelCostCents || 0)} fuel</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {proposedDay?.routes.map((propRoute, rIdx) => {
                          const propRouteFuel = propFuelDay?.routes?.[rIdx];
                          return (
                            <div key={`prop-${rIdx}`} className="border border-primary/30 rounded p-2 text-xs bg-primary/5" data-testid={`route-compare-proposed-${currentDay.day}-${rIdx}`}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-medium text-primary">{propRoute.routeLabel}</span>
                                <Badge variant="default" className="text-[9px]">Optimized</Badge>
                              </div>
                              <div className="grid grid-cols-3 gap-1 text-[11px]">
                                <div>
                                  <span className="text-muted-foreground">{propRoute.stopCount} stops</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">{propRoute.estimatedMiles} mi</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">{formatDollars(propRouteFuel?.fuelCostCents || 0)} fuel</span>
                                </div>
                              </div>
                              <div className="mt-1.5 space-y-0.5">
                                {propRoute.stops.map((stop, sIdx) => (
                                  <div key={stop.servicePlanId} className="flex items-center gap-1.5 text-[11px] py-0.5">
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 w-4 h-4 flex items-center justify-center shrink-0">
                                      {sIdx + 1}
                                    </Badge>
                                    <span className="truncate">{stop.contactName}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

        {optResult.movedStops.length > 0 && (
          <>
            <div className="p-3 border-b">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Moved Stops ({optResult.movedStops.length})
              </p>
            </div>
            {optResult.movedStops.slice(0, 20).map((move, idx) => (
              <div key={idx} className="flex items-center gap-2 px-3 py-2 text-xs" data-testid={`compare-move-${idx}`}>
                <span className="truncate flex-1 font-medium">{move.contactName}</span>
                <Badge variant="secondary" className="text-[10px] capitalize shrink-0">{move.fromDay}</Badge>
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <Badge variant="default" className="text-[10px] capitalize shrink-0">{move.toDay}</Badge>
              </div>
            ))}
            {optResult.movedStops.length > 20 && (
              <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                +{optResult.movedStops.length - 20} more
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
