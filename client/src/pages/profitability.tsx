import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Users,
  AlertTriangle,
  RefreshCw,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Minus,
  Sparkles,
  Route,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { ClientInfoPopover } from "@/components/client-info-popover";

interface CustomerPropertyProfitability {
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
  costBreakdown: {
    laborCostCents: number;
    travelCostCents: number;
    equipmentCostCents: number;
    overheadCostCents: number;
  };
}

interface CustomerProfitability {
  contactId: string;
  contactName: string;
  propertyCount: number;
  totalRevenuePerVisitCents: number;
  totalCostPerVisitCents: number;
  totalProfitPerVisitCents: number;
  profitMarginPct: number;
  status: "profitable" | "marginal" | "unprofitable";
  properties: CustomerPropertyProfitability[];
  monthlyRevenueCents: number;
  monthlyCostCents: number;
  monthlyProfitCents: number;
}

interface BulkRecommendation {
  contactId: string;
  contactName: string;
  propertyId: string;
  propertyAddress: string;
  currentPriceCents: number;
  recommendedPriceCents: number;
  currentMarginPct: number;
  projectedMarginPct: number;
  projectedProfitPerVisitCents: number;
}

interface RouteCustomer {
  contactId: string;
  firstName: string;
  lastName: string;
  revenueCents: number;
  costCents: number;
}

interface RouteProfitability {
  routeId: string;
  routeName: string;
  dayOfWeek: string;
  technicianId: string | null;
  totalStops: number;
  totalRevenueCents: number;
  totalCostCents: number;
  totalProfitCents: number;
  avgMarginPct: number;
  customers: RouteCustomer[];
}

type ViewMode = "customers" | "routes";
type SortField = "name" | "revenue" | "cost" | "profit" | "margin";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "profitable" | "marginal" | "unprofitable";

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDollarsShort(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}

function statusBadge(status: "profitable" | "marginal" | "unprofitable") {
  const variants: Record<string, { label: string; className: string }> = {
    profitable: { label: "Profitable", className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
    marginal: { label: "Marginal", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
    unprofitable: { label: "Unprofitable", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  };
  const v = variants[status];
  return (
    <Badge variant="outline" className={v.className} data-testid={`badge-status-${status}`}>
      {v.label}
    </Badge>
  );
}

function SortButton({ field, currentField, currentDir, onSort }: {
  field: SortField;
  currentField: SortField;
  currentDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const isActive = field === currentField;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1 -ml-2"
      onClick={() => onSort(field)}
      data-testid={`button-sort-${field}`}
    >
      {isActive ? (
        currentDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
      )}
    </Button>
  );
}

export default function Profitability() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("scoopilot_profit_view_mode");
    return (saved === "customers" || saved === "routes") ? saved : "customers";
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortField, setSortField] = useState<SortField>("profit");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());

  useEffect(() => {
    try { localStorage.setItem("scoopilot_profit_view_mode", viewMode); } catch {}
  }, [viewMode]);

  const { data: customers, isLoading } = useQuery<CustomerProfitability[]>({
    queryKey: ["/api/profitability/summary"],
  });

  const { data: routeData, isLoading: isRouteLoading } = useQuery<RouteProfitability[]>({
    queryKey: ["/api/profitability/route-summary"],
    enabled: viewMode === "routes",
  });

  const recalculateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/profitability/recalculate");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/profitability/summary"] });
      toast({ title: "Recalculation complete", description: `${data.snapshotsCreated} snapshots created.` });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const bulkRecommendationsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/profitability/bulk-recommendations");
      return res.json() as Promise<BulkRecommendation[]>;
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filtered = (customers ?? [])
    .filter(c => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (searchTerm && !c.contactName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.contactName.localeCompare(b.contactName); break;
        case "revenue": cmp = a.monthlyRevenueCents - b.monthlyRevenueCents; break;
        case "cost": cmp = a.monthlyCostCents - b.monthlyCostCents; break;
        case "profit": cmp = a.monthlyProfitCents - b.monthlyProfitCents; break;
        case "margin": cmp = a.profitMarginPct - b.profitMarginPct; break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

  const totalRevenue = (customers ?? []).reduce((s, c) => s + c.monthlyRevenueCents, 0);
  const totalCost = (customers ?? []).reduce((s, c) => s + c.monthlyCostCents, 0);
  const totalProfit = totalRevenue - totalCost;
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
  const unprofitableCount = (customers ?? []).filter(c => c.status === "unprofitable").length;

  const toggleRouteExpand = (routeId: string) => {
    setExpandedRoutes(prev => {
      const next = new Set(prev);
      if (next.has(routeId)) next.delete(routeId); else next.add(routeId);
      return next;
    });
  };

  const sortedRoutes = (routeData ?? []).slice().sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case "name": cmp = a.routeName.localeCompare(b.routeName); break;
      case "revenue": cmp = a.totalRevenueCents - b.totalRevenueCents; break;
      case "cost": cmp = a.totalCostCents - b.totalCostCents; break;
      case "profit": cmp = a.totalProfitCents - b.totalProfitCents; break;
      case "margin": cmp = a.avgMarginPct - b.avgMarginPct; break;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const recommendations = bulkRecommendationsMutation.data;

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
        <div>
          <h1 className="text-2xl font-bold">Customer Profitability</h1>
          <p className="text-muted-foreground">Loading profitability data...</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-profitability-heading">
            {viewMode === "customers" ? "Customer Profitability" : "Route Profitability"}
          </h1>
          <p className="text-muted-foreground">Analyze profit and loss across your {viewMode === "customers" ? "customer base" : "routes"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="customers" data-testid="tab-by-customer">
                <Users className="mr-1 h-4 w-4" />
                By Customer
              </TabsTrigger>
              <TabsTrigger value="routes" data-testid="tab-by-route">
                <Route className="mr-1 h-4 w-4" />
                By Route
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            onClick={() => recalculateMutation.mutate()}
            disabled={recalculateMutation.isPending}
            data-testid="button-recalculate"
          >
            <RefreshCw className={`mr-1 h-4 w-4 ${recalculateMutation.isPending ? "animate-spin" : ""}`} />
            {recalculateMutation.isPending ? "Recalculating..." : "Recalculate"}
          </Button>
          {viewMode === "customers" && (
            <Button
              variant="outline"
              onClick={() => bulkRecommendationsMutation.mutate()}
              disabled={bulkRecommendationsMutation.isPending}
              data-testid="button-bulk-recommendations"
            >
              <Sparkles className={`mr-1 h-4 w-4`} />
              {bulkRecommendationsMutation.isPending ? "Generating..." : "Price Recommendations"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card data-testid="card-kpi-total-revenue">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Total Revenue/mo</p>
                <p className="text-2xl font-bold" data-testid="text-kpi-total-revenue">{formatDollars(totalRevenue)}</p>
              </div>
              <div className="p-2 rounded-md bg-primary/10">
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-kpi-total-costs">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Total Costs/mo</p>
                <p className="text-2xl font-bold" data-testid="text-kpi-total-costs">{formatDollars(totalCost)}</p>
              </div>
              <div className="p-2 rounded-md bg-primary/10">
                <TrendingDown className="h-4 w-4 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-kpi-total-profit">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Total Profit/mo</p>
                <p className={`text-2xl font-bold ${totalProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-kpi-total-profit">
                  {formatDollars(totalProfit)}
                </p>
              </div>
              <div className="p-2 rounded-md bg-primary/10">
                {totalProfit >= 0 ? <TrendingUp className="h-4 w-4 text-primary" /> : <TrendingDown className="h-4 w-4 text-primary" />}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-kpi-avg-margin">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Average Margin</p>
                <p className={`text-2xl font-bold ${avgMargin >= 15 ? "text-green-600 dark:text-green-400" : avgMargin >= 0 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-kpi-avg-margin">
                  {avgMargin.toFixed(1)}%
                </p>
              </div>
              <div className="p-2 rounded-md bg-primary/10">
                <Minus className="h-4 w-4 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-kpi-unprofitable">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Unprofitable</p>
                <p className={`text-2xl font-bold ${unprofitableCount > 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid="text-kpi-unprofitable">
                  {unprofitableCount}
                </p>
                <p className="text-xs text-muted-foreground">{(customers ?? []).length} total customers</p>
              </div>
              <div className="p-2 rounded-md bg-primary/10">
                <AlertTriangle className="h-4 w-4 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {viewMode === "routes" && (
        <Card data-testid="card-route-profitability-table">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-4">
            <CardTitle className="text-base">Route Profitability</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isRouteLoading ? (
              <div className="p-6">
                <Skeleton className="h-64" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>
                        <div className="flex items-center gap-1">
                          Route
                          <SortButton field="name" currentField={sortField} currentDir={sortDir} onSort={handleSort} />
                        </div>
                      </TableHead>
                      <TableHead>Day</TableHead>
                      <TableHead className="text-center">Stops</TableHead>
                      <TableHead>
                        <div className="flex items-center gap-1">
                          Revenue
                          <SortButton field="revenue" currentField={sortField} currentDir={sortDir} onSort={handleSort} />
                        </div>
                      </TableHead>
                      <TableHead>
                        <div className="flex items-center gap-1">
                          Cost
                          <SortButton field="cost" currentField={sortField} currentDir={sortDir} onSort={handleSort} />
                        </div>
                      </TableHead>
                      <TableHead>
                        <div className="flex items-center gap-1">
                          Profit
                          <SortButton field="profit" currentField={sortField} currentDir={sortDir} onSort={handleSort} />
                        </div>
                      </TableHead>
                      <TableHead>
                        <div className="flex items-center gap-1">
                          Avg Margin
                          <SortButton field="margin" currentField={sortField} currentDir={sortDir} onSort={handleSort} />
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRoutes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                          No routes found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedRoutes.flatMap((route) => {
                        const isExpanded = expandedRoutes.has(route.routeId);
                        const marginColor = route.avgMarginPct >= 15
                          ? "text-green-600 dark:text-green-400"
                          : route.avgMarginPct >= 0
                            ? "text-yellow-600 dark:text-yellow-400"
                            : "text-red-600 dark:text-red-400";
                        const profitColor = route.totalProfitCents >= 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400";
                        const rowBg = route.avgMarginPct < 0
                          ? "bg-red-50/50 dark:bg-red-950/20"
                          : route.avgMarginPct <= 15
                            ? "bg-yellow-50/50 dark:bg-yellow-950/20"
                            : "";

                        const rows = [
                          <TableRow
                            key={route.routeId}
                            className={`cursor-pointer hover-elevate ${rowBg}`}
                            onClick={() => toggleRouteExpand(route.routeId)}
                            data-testid={`row-route-${route.routeId}`}
                          >
                            <TableCell className="w-8 pr-0">
                              {route.customers.length > 0 && (
                                isExpanded
                                  ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                  : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell className="font-medium" data-testid={`text-route-name-${route.routeId}`}>
                              {route.routeName}
                            </TableCell>
                            <TableCell className="capitalize text-muted-foreground" data-testid={`text-route-day-${route.routeId}`}>
                              {route.dayOfWeek}
                            </TableCell>
                            <TableCell className="text-center" data-testid={`text-route-stops-${route.routeId}`}>
                              {route.totalStops}
                            </TableCell>
                            <TableCell data-testid={`text-route-revenue-${route.routeId}`}>
                              {formatDollars(route.totalRevenueCents)}
                            </TableCell>
                            <TableCell data-testid={`text-route-cost-${route.routeId}`}>
                              {formatDollars(route.totalCostCents)}
                            </TableCell>
                            <TableCell data-testid={`text-route-profit-${route.routeId}`}>
                              <span className={profitColor}>{formatDollars(route.totalProfitCents)}</span>
                            </TableCell>
                            <TableCell data-testid={`text-route-margin-${route.routeId}`}>
                              <span className={marginColor}>{route.avgMarginPct.toFixed(1)}%</span>
                            </TableCell>
                          </TableRow>,
                        ];

                        if (isExpanded && route.customers.length > 0) {
                          const sortedCustomers = [...route.customers].sort((a, b) => {
                            const aProft = a.revenueCents - a.costCents;
                            const bProfit = b.revenueCents - b.costCents;
                            return aProft - bProfit;
                          });
                          for (const customer of sortedCustomers) {
                            const custProfit = customer.revenueCents - customer.costCents;
                            const custMargin = customer.revenueCents > 0
                              ? (custProfit / customer.revenueCents) * 100
                              : 0;
                            const custProfitColor = custProfit >= 0
                              ? "text-green-600 dark:text-green-400"
                              : "text-red-600 dark:text-red-400";
                            const custMarginColor = custMargin >= 15
                              ? "text-green-600 dark:text-green-400"
                              : custMargin >= 0
                                ? "text-yellow-600 dark:text-yellow-400"
                                : "text-red-600 dark:text-red-400";

                            rows.push(
                              <TableRow
                                key={`${route.routeId}-${customer.contactId}`}
                                className="cursor-pointer hover-elevate bg-muted/30"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/profitability/${customer.contactId}`);
                                }}
                                data-testid={`row-route-customer-${route.routeId}-${customer.contactId}`}
                              >
                                <TableCell></TableCell>
                                <TableCell className="pl-8 text-sm" data-testid={`text-route-customer-name-${customer.contactId}`}>
                                  <ClientInfoPopover contactId={customer.contactId}>
                                    <span>{customer.firstName} {customer.lastName}</span>
                                  </ClientInfoPopover>
                                </TableCell>
                                <TableCell></TableCell>
                                <TableCell></TableCell>
                                <TableCell className="text-sm" data-testid={`text-route-customer-revenue-${customer.contactId}`}>
                                  {formatDollars(customer.revenueCents)}
                                </TableCell>
                                <TableCell className="text-sm" data-testid={`text-route-customer-cost-${customer.contactId}`}>
                                  {formatDollars(customer.costCents)}
                                </TableCell>
                                <TableCell className="text-sm" data-testid={`text-route-customer-profit-${customer.contactId}`}>
                                  <span className={custProfitColor}>{formatDollars(custProfit)}</span>
                                </TableCell>
                                <TableCell className="text-sm" data-testid={`text-route-customer-margin-${customer.contactId}`}>
                                  <span className={custMarginColor}>{custMargin.toFixed(1)}%</span>
                                </TableCell>
                              </TableRow>
                            );
                          }
                        }

                        return rows;
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {viewMode === "customers" && (
      <Card data-testid="card-profitability-table">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-4">
          <CardTitle className="text-base">Customer Profitability</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search customers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-48"
                data-testid="input-search-customers"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-40" data-testid="select-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="profitable">Profitable</SelectItem>
                <SelectItem value="marginal">Marginal</SelectItem>
                <SelectItem value="unprofitable">Unprofitable</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Customer
                      <SortButton field="name" currentField={sortField} currentDir={sortDir} onSort={handleSort} />
                    </div>
                  </TableHead>
                  <TableHead className="text-center">Properties</TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Revenue/mo
                      <SortButton field="revenue" currentField={sortField} currentDir={sortDir} onSort={handleSort} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Cost/mo
                      <SortButton field="cost" currentField={sortField} currentDir={sortDir} onSort={handleSort} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Profit/mo
                      <SortButton field="profit" currentField={sortField} currentDir={sortDir} onSort={handleSort} />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      Margin
                      <SortButton field="margin" currentField={sortField} currentDir={sortDir} onSort={handleSort} />
                    </div>
                  </TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      {(customers ?? []).length === 0 ? "No active customers with jobs found." : "No customers match your filters."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((customer) => {
                    const rowBg = customer.status === "unprofitable"
                      ? "bg-red-50/50 dark:bg-red-950/20"
                      : customer.status === "marginal"
                        ? "bg-yellow-50/50 dark:bg-yellow-950/20"
                        : "";
                    return (
                      <TableRow
                        key={customer.contactId}
                        className={`cursor-pointer hover-elevate ${rowBg}`}
                        onClick={() => navigate(`/profitability/${customer.contactId}`)}
                        data-testid={`row-customer-${customer.contactId}`}
                      >
                        <TableCell className="font-medium" data-testid={`text-customer-name-${customer.contactId}`}>
                          <ClientInfoPopover contactId={customer.contactId}>
                            <span>{customer.contactName}</span>
                          </ClientInfoPopover>
                        </TableCell>
                        <TableCell className="text-center" data-testid={`text-property-count-${customer.contactId}`}>
                          {customer.propertyCount}
                        </TableCell>
                        <TableCell data-testid={`text-revenue-${customer.contactId}`}>
                          {formatDollars(customer.monthlyRevenueCents)}
                        </TableCell>
                        <TableCell data-testid={`text-cost-${customer.contactId}`}>
                          {formatDollars(customer.monthlyCostCents)}
                        </TableCell>
                        <TableCell data-testid={`text-profit-${customer.contactId}`}>
                          <span className={customer.monthlyProfitCents >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                            {formatDollars(customer.monthlyProfitCents)}
                          </span>
                        </TableCell>
                        <TableCell data-testid={`text-margin-${customer.contactId}`}>
                          <span className={customer.profitMarginPct >= 15 ? "text-green-600 dark:text-green-400" : customer.profitMarginPct >= 0 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}>
                            {customer.profitMarginPct.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell>
                          {statusBadge(customer.status)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      )}

      {viewMode === "customers" && recommendations && recommendations.length > 0 && (
        <Card data-testid="card-bulk-recommendations">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Price Adjustment Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Current Price</TableHead>
                    <TableHead>Recommended</TableHead>
                    <TableHead>Current Margin</TableHead>
                    <TableHead>Projected Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recommendations.map((rec, idx) => (
                    <TableRow key={`${rec.contactId}-${rec.propertyId}-${idx}`} data-testid={`row-recommendation-${idx}`}>
                      <TableCell className="font-medium" data-testid={`text-rec-customer-${idx}`}>
                        <ClientInfoPopover contactId={rec.contactId}>
                          <span>{rec.contactName}</span>
                        </ClientInfoPopover>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-48 truncate" data-testid={`text-rec-address-${idx}`}>{rec.propertyAddress}</TableCell>
                      <TableCell data-testid={`text-rec-current-${idx}`}>{formatDollars(rec.currentPriceCents)}</TableCell>
                      <TableCell data-testid={`text-rec-recommended-${idx}`}>
                        <span className="font-medium text-green-600 dark:text-green-400">{formatDollars(rec.recommendedPriceCents)}</span>
                      </TableCell>
                      <TableCell data-testid={`text-rec-current-margin-${idx}`}>
                        <span className={rec.currentMarginPct < 0 ? "text-red-600 dark:text-red-400" : "text-yellow-600 dark:text-yellow-400"}>
                          {rec.currentMarginPct.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell data-testid={`text-rec-projected-margin-${idx}`}>
                        <span className="text-green-600 dark:text-green-400">{rec.projectedMarginPct.toFixed(1)}%</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {viewMode === "customers" && recommendations && recommendations.length === 0 && (
        <Card data-testid="card-no-recommendations">
          <CardContent className="p-6 text-center text-muted-foreground">
            All customers are operating at healthy margins. No price adjustments needed.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
