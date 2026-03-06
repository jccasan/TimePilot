import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { MapPin, Eye, Layers, ChevronRight, ChevronDown, DollarSign, TrendingUp, AlertTriangle, Map as MapIcon } from "lucide-react";
import ProfitabilityMap, { type MapRoute } from "@/components/profitability-map";

type ViewMode = "stops" | "zones";
type DayFilter = "all" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

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

export default function RouteProfitMaps() {
  const [viewMode, setViewMode] = useState<ViewMode>("stops");
  const [dayFilter, setDayFilter] = useState<DayFilter>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "profitable" | "marginal" | "unprofitable">("all");
  const [visibleRouteIds, setVisibleRouteIds] = useState<Set<string>>(new Set());
  const [focusRouteId, setFocusRouteId] = useState<string | null>(null);
  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const { data: routeMapData, isLoading } = useQuery<MapRoute[]>({
    queryKey: ["/api/profitability/route-map"],
  });

  const routes = routeMapData ?? [];

  useEffect(() => {
    if (routes.length > 0 && visibleRouteIds.size === 0) {
      setVisibleRouteIds(new Set(routes.map((r) => r.routeId)));
    }
  }, [routes]);

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

  return (
    <div className="h-full flex flex-col" data-testid="page-route-profit-maps">
      <div className="flex items-center justify-between gap-2 p-3 border-b bg-background shrink-0">
        <div className="flex items-center gap-2">
          <MapIcon className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold" data-testid="text-page-title">Route Profit Maps</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative">
          {routes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 p-8" data-testid="empty-map-state">
              <MapIcon className="h-12 w-12 opacity-30" />
              <p className="text-lg font-medium">No route data available</p>
              <p className="text-sm">Create routes and assign service plans with geocoded properties to see profitability on the map.</p>
            </div>
          ) : (
            <ProfitabilityMap
              routes={routes}
              visibleRouteIds={effectiveVisibleIds}
              viewMode={viewMode}
              focusRouteId={focusRouteId}
              onStopClick={(stop) => setExpandedRouteId(routes.find(r => r.stops.some(s => s.propertyId === stop.propertyId))?.routeId ?? null)}
            />
          )}

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
        </div>

        {sidebarOpen && (
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
      </div>
    </div>
  );
}
