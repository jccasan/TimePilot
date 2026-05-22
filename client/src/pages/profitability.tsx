import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
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
  CheckCircle,
  Brain,
  Loader2,
  Zap,
  ExternalLink,
} from "lucide-react";
import { ClientInfoPopover } from "@/components/client-info-popover";
import type { Route as RouteRecord } from "@shared/schema";
import BreakevenCalculator from "@/components/calculators/BreakevenCalculator";
import BreakevenStatusIndicator from "@/components/calculators/BreakevenStatusIndicator";
type RouteWithOptStatus = RouteRecord & { isOptimizedCurrent?: boolean };

interface ProfitabilitySuggestion {
  type:
    | "route_day_move"
    | "yard_size_mismatch"
    | "price_increase"
    | "frequency_upgrade"
    | "add_nearby_customers"
    | "no_path_to_profitability";
  title: string;
  explanation: string;
  impactCents: number;
}

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

type ViewMode = "customers" | "routes" | "breakeven";
type SortField = "name" | "revenue" | "cost" | "profit" | "margin";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "profitable" | "marginal" | "unprofitable";

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function statusBadge(status: "profitable" | "marginal" | "unprofitable") {
  const variants: Record<string, { label: string; className: string }> = {
    profitable: {
      label: "Profitable",
      className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    },
    marginal: {
      label: "Marginal",
      className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    },
    unprofitable: {
      label: "Unprofitable",
      className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    },
  };
  const v = variants[status];
  return (
    <Badge variant="outline" className={v.className} data-testid={`badge-status-${status}`}>
      {v.label}
    </Badge>
  );
}

function SortButton({
  field,
  currentField,
  currentDir,
  onSort,
}: {
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
        currentDir === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
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
    const urlTab = new URLSearchParams(window.location.search).get("tab");
    if (urlTab === "customers" || urlTab === "routes" || urlTab === "breakeven") return urlTab;
    const saved = localStorage.getItem("scoopilot_profit_view_mode");
    return saved === "customers" || saved === "routes" || saved === "breakeven"
      ? saved
      : "customers";
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortField, setSortField] = useState<SortField>("profit");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());
  const [aiSuggestionsMap, setAiSuggestionsMap] = useState<
    Map<string, ProfitabilitySuggestion[] | "error">
  >(new Map());
  const [isAnalysisRunning, setIsAnalysisRunning] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [currentlyAnalyzingId, setCurrentlyAnalyzingId] = useState<string | null>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem("scoopilot_profit_view_mode", viewMode);
    } catch {}
  }, [viewMode]);

  const { data: customers, isLoading } = useQuery<CustomerProfitability[]>({
    queryKey: ["/api/profitability/summary"],
  });

  type OverheadItem = { type: "fixed" | "variable"; monthlyCostCents: number };
  const { data: overheadData } = useQuery<{
    totalMonthlyOverheadCents: number;
    trailingMonthlyStops: number;
    items: OverheadItem[];
  }>({
    queryKey: ["/api/overhead-costs"],
  });

  const variableMonthlyTotalCents = (overheadData?.items ?? [])
    .filter((i) => i.type === "variable")
    .reduce((s, i) => s + i.monthlyCostCents, 0);
  const variableCostPerVisitCents =
    (overheadData?.trailingMonthlyStops ?? 0) > 0
      ? variableMonthlyTotalCents / overheadData!.trailingMonthlyStops
      : 0;
  const variableCostPerVisit = variableCostPerVisitCents / 100;

  const { data: pricingConfig } = useQuery<{
    pricingRules?: { basePrices?: { weekly?: number } };
  }>({
    queryKey: ["/api/pricing-config"],
  });

  const { data: routeData, isLoading: isRouteLoading } = useQuery<RouteProfitability[]>({
    queryKey: ["/api/profitability/route-summary"],
    enabled: viewMode === "routes",
  });

  const { data: routeRecords } = useQuery<RouteWithOptStatus[]>({
    queryKey: ["/api/routes"],
    enabled: viewMode === "routes",
  });

  const routeOptStateMap = new Map<string, boolean>(
    (routeRecords ?? []).map((r) => [
      r.id,
      r.isOptimizedCurrent ?? !!(r.lastOptimizedAt && r.optimizedStopHash),
    ])
  );

  const recalculateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/profitability/recalculate");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/profitability/summary"] });
      toast({
        title: "Recalculation complete",
        description: `${data.snapshotsCreated} snapshots created.`,
      });
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

  const runBulkAiAnalysis = async () => {
    const struggling = (customers ?? []).filter(
      (c) => c.status === "marginal" || c.status === "unprofitable"
    );
    if (struggling.length === 0) {
      toast({
        title: "No struggling customers",
        description: "All customers are profitable — nothing to analyze.",
      });
      return;
    }
    abortRef.current = false;
    setIsAnalysisRunning(true);
    setAnalysisProgress({ current: 0, total: struggling.length });
    setAiSuggestionsMap(new Map());
    setCurrentlyAnalyzingId(null);
    for (let i = 0; i < struggling.length; i++) {
      if (abortRef.current) break;
      const customer = struggling[i];
      setAnalysisProgress({ current: i + 1, total: struggling.length });
      setCurrentlyAnalyzingId(customer.contactId);
      try {
        const res = await fetch(`/api/profitability/customer/${customer.contactId}/suggestions`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setAiSuggestionsMap((prev) => {
          const next = new Map(prev);
          next.set(customer.contactId, (data.suggestions ?? []) as ProfitabilitySuggestion[]);
          return next;
        });
      } catch {
        setAiSuggestionsMap((prev) => {
          const next = new Map(prev);
          next.set(customer.contactId, "error");
          return next;
        });
      }
    }
    setCurrentlyAnalyzingId(null);
    setIsAnalysisRunning(false);
    setAnalysisProgress(null);
  };

  const stopBulkAiAnalysis = () => {
    abortRef.current = true;
    setCurrentlyAnalyzingId(null);
    setIsAnalysisRunning(false);
    setAnalysisProgress(null);
  };

  const filtered = (customers ?? [])
    .filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (searchTerm && !c.contactName.toLowerCase().includes(searchTerm.toLowerCase()))
        return false;
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.contactName.localeCompare(b.contactName);
          break;
        case "revenue":
          cmp = a.monthlyRevenueCents - b.monthlyRevenueCents;
          break;
        case "cost":
          cmp = a.monthlyCostCents - b.monthlyCostCents;
          break;
        case "profit":
          cmp = a.monthlyProfitCents - b.monthlyProfitCents;
          break;
        case "margin":
          cmp = a.profitMarginPct - b.profitMarginPct;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

  const totalRevenue = (customers ?? []).reduce((s, c) => s + c.monthlyRevenueCents, 0);
  const totalCost = (customers ?? []).reduce((s, c) => s + c.monthlyCostCents, 0);
  const totalProfit = totalRevenue - totalCost;
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
  const unprofitableCount = (customers ?? []).filter((c) => c.status === "unprofitable").length;

  const toggleRouteExpand = (routeId: string) => {
    setExpandedRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
  };

  const sortedRoutes = (routeData ?? []).slice().sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case "name":
        cmp = a.routeName.localeCompare(b.routeName);
        break;
      case "revenue":
        cmp = a.totalRevenueCents - b.totalRevenueCents;
        break;
      case "cost":
        cmp = a.totalCostCents - b.totalCostCents;
        break;
      case "profit":
        cmp = a.totalProfitCents - b.totalProfitCents;
        break;
      case "margin":
        cmp = a.avgMarginPct - b.avgMarginPct;
        break;
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
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
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
            {viewMode === "customers"
              ? "Customer Profitability"
              : viewMode === "routes"
                ? "Route Profitability"
                : "Breakeven Analysis"}
          </h1>
          <p className="text-muted-foreground">
            {viewMode === "customers"
              ? "Analyze profit and loss across your customer base"
              : viewMode === "routes"
                ? "Analyze profit and loss across your routes"
                : "See how many clients you need to cover your costs"}
          </p>
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
              <TabsTrigger value="breakeven" data-testid="tab-breakeven">
                <TrendingDown className="mr-1 h-4 w-4" />
                Breakeven
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            onClick={() => recalculateMutation.mutate()}
            disabled={recalculateMutation.isPending}
            data-testid="button-recalculate"
          >
            <RefreshCw
              className={`mr-1 h-4 w-4 ${recalculateMutation.isPending ? "animate-spin" : ""}`}
            />
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
          {viewMode === "customers" &&
            (isAnalysisRunning ? (
              <Button
                variant="outline"
                onClick={stopBulkAiAnalysis}
                data-testid="button-stop-ai-analysis"
              >
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                {analysisProgress
                  ? `Analyzing ${analysisProgress.current}/${analysisProgress.total}...`
                  : "Stopping..."}
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={runBulkAiAnalysis}
                disabled={isLoading}
                data-testid="button-run-ai-analysis"
              >
                <Brain className="mr-1 h-4 w-4" />
                Run AI Analysis
              </Button>
            ))}
        </div>
      </div>

      {/* Breakeven Status Indicator */}
      {overheadData?.totalMonthlyOverheadCents &&
      pricingConfig?.pricingRules?.basePrices?.weekly ? (
        <BreakevenStatusIndicator
          activeClients={(customers ?? []).length}
          avgPricePerVisit={pricingConfig.pricingRules.basePrices.weekly / 100}
          variableCostPerVisit={variableCostPerVisit}
          fixedMonthlyOverhead={overheadData.totalMonthlyOverheadCents / 100}
        />
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card data-testid="card-kpi-total-revenue">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Total Revenue/mo</p>
                <p className="text-2xl font-bold" data-testid="text-kpi-total-revenue">
                  {formatDollars(totalRevenue)}
                </p>
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
                <p className="text-2xl font-bold" data-testid="text-kpi-total-costs">
                  {formatDollars(totalCost)}
                </p>
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
                <p
                  className={`text-2xl font-bold ${totalProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                  data-testid="text-kpi-total-profit"
                >
                  {formatDollars(totalProfit)}
                </p>
              </div>
              <div className="p-2 rounded-md bg-primary/10">
                {totalProfit >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-primary" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-primary" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-kpi-avg-margin">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Average Margin</p>
                <p
                  className={`text-2xl font-bold ${avgMargin >= 15 ? "text-green-600 dark:text-green-400" : avgMargin >= 0 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`}
                  data-testid="text-kpi-avg-margin"
                >
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
                <p
                  className={`text-2xl font-bold ${unprofitableCount > 0 ? "text-red-600 dark:text-red-400" : ""}`}
                  data-testid="text-kpi-unprofitable"
                >
                  {unprofitableCount}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(customers ?? []).length} total customers
                </p>
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
                          <SortButton
                            field="name"
                            currentField={sortField}
                            currentDir={sortDir}
                            onSort={handleSort}
                          />
                        </div>
                      </TableHead>
                      <TableHead>Day</TableHead>
                      <TableHead className="text-center">Stops</TableHead>
                      <TableHead>
                        <div className="flex items-center gap-1">
                          Revenue
                          <SortButton
                            field="revenue"
                            currentField={sortField}
                            currentDir={sortDir}
                            onSort={handleSort}
                          />
                        </div>
                      </TableHead>
                      <TableHead>
                        <div className="flex items-center gap-1">
                          Cost
                          <SortButton
                            field="cost"
                            currentField={sortField}
                            currentDir={sortDir}
                            onSort={handleSort}
                          />
                        </div>
                      </TableHead>
                      <TableHead>
                        <div className="flex items-center gap-1">
                          Profit
                          <SortButton
                            field="profit"
                            currentField={sortField}
                            currentDir={sortDir}
                            onSort={handleSort}
                          />
                        </div>
                      </TableHead>
                      <TableHead>
                        <div className="flex items-center gap-1">
                          Avg Margin
                          <SortButton
                            field="margin"
                            currentField={sortField}
                            currentDir={sortDir}
                            onSort={handleSort}
                          />
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
                        const marginColor =
                          route.avgMarginPct >= 15
                            ? "text-green-600 dark:text-green-400"
                            : route.avgMarginPct >= 0
                              ? "text-yellow-600 dark:text-yellow-400"
                              : "text-red-600 dark:text-red-400";
                        const profitColor =
                          route.totalProfitCents >= 0
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400";
                        const rowBg =
                          route.avgMarginPct < 0
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
                              {route.customers.length > 0 &&
                                (isExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                ))}
                            </TableCell>
                            <TableCell
                              className="font-medium"
                              data-testid={`text-route-name-${route.routeId}`}
                            >
                              <div className="flex items-center gap-1.5">
                                {route.routeName}
                                {routeOptStateMap.get(route.routeId) && (
                                  <span
                                    title="Route is optimized"
                                    data-testid={`badge-profit-optimized-${route.routeId}`}
                                  >
                                    <CheckCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell
                              className="capitalize text-muted-foreground"
                              data-testid={`text-route-day-${route.routeId}`}
                            >
                              {route.dayOfWeek}
                            </TableCell>
                            <TableCell
                              className="text-center"
                              data-testid={`text-route-stops-${route.routeId}`}
                            >
                              {route.totalStops}
                            </TableCell>
                            <TableCell data-testid={`text-route-revenue-${route.routeId}`}>
                              {formatDollars(route.totalRevenueCents)}
                            </TableCell>
                            <TableCell data-testid={`text-route-cost-${route.routeId}`}>
                              {formatDollars(route.totalCostCents)}
                            </TableCell>
                            <TableCell data-testid={`text-route-profit-${route.routeId}`}>
                              <span className={profitColor}>
                                {formatDollars(route.totalProfitCents)}
                              </span>
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
                            const custMargin =
                              customer.revenueCents > 0
                                ? (custProfit / customer.revenueCents) * 100
                                : 0;
                            const custProfitColor =
                              custProfit >= 0
                                ? "text-green-600 dark:text-green-400"
                                : "text-red-600 dark:text-red-400";
                            const custMarginColor =
                              custMargin >= 15
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
                                <TableCell
                                  className="pl-8 text-sm"
                                  data-testid={`text-route-customer-name-${customer.contactId}`}
                                >
                                  <ClientInfoPopover contactId={customer.contactId}>
                                    <span>
                                      {customer.firstName} {customer.lastName}
                                    </span>
                                  </ClientInfoPopover>
                                </TableCell>
                                <TableCell></TableCell>
                                <TableCell></TableCell>
                                <TableCell
                                  className="text-sm"
                                  data-testid={`text-route-customer-revenue-${customer.contactId}`}
                                >
                                  {formatDollars(customer.revenueCents)}
                                </TableCell>
                                <TableCell
                                  className="text-sm"
                                  data-testid={`text-route-customer-cost-${customer.contactId}`}
                                >
                                  {formatDollars(customer.costCents)}
                                </TableCell>
                                <TableCell
                                  className="text-sm"
                                  data-testid={`text-route-customer-profit-${customer.contactId}`}
                                >
                                  <span className={custProfitColor}>
                                    {formatDollars(custProfit)}
                                  </span>
                                </TableCell>
                                <TableCell
                                  className="text-sm"
                                  data-testid={`text-route-customer-margin-${customer.contactId}`}
                                >
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
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
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
                        <SortButton
                          field="name"
                          currentField={sortField}
                          currentDir={sortDir}
                          onSort={handleSort}
                        />
                      </div>
                    </TableHead>
                    <TableHead className="text-center">Properties</TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        Revenue/mo
                        <SortButton
                          field="revenue"
                          currentField={sortField}
                          currentDir={sortDir}
                          onSort={handleSort}
                        />
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        Cost/mo
                        <SortButton
                          field="cost"
                          currentField={sortField}
                          currentDir={sortDir}
                          onSort={handleSort}
                        />
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        Profit/mo
                        <SortButton
                          field="profit"
                          currentField={sortField}
                          currentDir={sortDir}
                          onSort={handleSort}
                        />
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        Margin
                        <SortButton
                          field="margin"
                          currentField={sortField}
                          currentDir={sortDir}
                          onSort={handleSort}
                        />
                      </div>
                    </TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        {(customers ?? []).length === 0
                          ? "No active customers with jobs found."
                          : "No customers match your filters."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.flatMap((customer) => {
                      const rowBg =
                        customer.status === "unprofitable"
                          ? "bg-red-50/50 dark:bg-red-950/20"
                          : customer.status === "marginal"
                            ? "bg-yellow-50/50 dark:bg-yellow-950/20"
                            : "";
                      const aiResult = aiSuggestionsMap.get(customer.contactId);
                      const isAnalyzingThis = currentlyAnalyzingId === customer.contactId;
                      const rows = [
                        <TableRow
                          key={customer.contactId}
                          className={`cursor-pointer hover-elevate ${rowBg}`}
                          onClick={() => navigate(`/profitability/${customer.contactId}`)}
                          data-testid={`row-customer-${customer.contactId}`}
                        >
                          <TableCell
                            className="font-medium"
                            data-testid={`text-customer-name-${customer.contactId}`}
                          >
                            <ClientInfoPopover contactId={customer.contactId}>
                              <span>{customer.contactName}</span>
                            </ClientInfoPopover>
                          </TableCell>
                          <TableCell
                            className="text-center"
                            data-testid={`text-property-count-${customer.contactId}`}
                          >
                            {customer.propertyCount}
                          </TableCell>
                          <TableCell data-testid={`text-revenue-${customer.contactId}`}>
                            {formatDollars(customer.monthlyRevenueCents)}
                          </TableCell>
                          <TableCell data-testid={`text-cost-${customer.contactId}`}>
                            {formatDollars(customer.monthlyCostCents)}
                          </TableCell>
                          <TableCell data-testid={`text-profit-${customer.contactId}`}>
                            <span
                              className={
                                customer.monthlyProfitCents >= 0
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-red-600 dark:text-red-400"
                              }
                            >
                              {formatDollars(customer.monthlyProfitCents)}
                            </span>
                          </TableCell>
                          <TableCell data-testid={`text-margin-${customer.contactId}`}>
                            <span
                              className={
                                customer.profitMarginPct >= 15
                                  ? "text-green-600 dark:text-green-400"
                                  : customer.profitMarginPct >= 0
                                    ? "text-yellow-600 dark:text-yellow-400"
                                    : "text-red-600 dark:text-red-400"
                              }
                            >
                              {customer.profitMarginPct.toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell>{statusBadge(customer.status)}</TableCell>
                        </TableRow>,
                      ];
                      if (isAnalyzingThis) {
                        rows.push(
                          <TableRow
                            key={`${customer.contactId}-ai-loading`}
                            className={rowBg}
                            data-testid={`row-ai-loading-${customer.contactId}`}
                          >
                            <TableCell colSpan={7} className="py-2 pl-8">
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Analyzing with AI...
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      } else if (aiResult === "error") {
                        rows.push(
                          <TableRow
                            key={`${customer.contactId}-ai-error`}
                            className={rowBg}
                            data-testid={`row-ai-error-${customer.contactId}`}
                          >
                            <TableCell colSpan={7} className="py-2 pl-8">
                              <p className="text-xs text-muted-foreground italic">
                                AI analysis unavailable for this customer.
                              </p>
                            </TableCell>
                          </TableRow>
                        );
                      } else if (Array.isArray(aiResult)) {
                        const topSuggestions = aiResult.slice(0, 2);
                        if (topSuggestions.length === 0) {
                          rows.push(
                            <TableRow
                              key={`${customer.contactId}-ai-none`}
                              className={rowBg}
                              data-testid={`row-ai-none-${customer.contactId}`}
                            >
                              <TableCell colSpan={7} className="py-2 pl-8">
                                <p className="text-xs text-muted-foreground italic">
                                  No specific suggestions found for this customer.
                                </p>
                              </TableCell>
                            </TableRow>
                          );
                        } else {
                          rows.push(
                            <TableRow
                              key={`${customer.contactId}-ai-suggestions`}
                              className={rowBg}
                              data-testid={`row-ai-suggestions-${customer.contactId}`}
                            >
                              <TableCell colSpan={7} className="py-2 pl-8 pr-4">
                                <div className="flex flex-wrap gap-3">
                                  {topSuggestions.map((s, idx) => (
                                    <Link
                                      key={idx}
                                      href={`/contacts/${customer.contactId}`}
                                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                      data-testid={`link-ai-detail-${customer.contactId}-${idx}`}
                                    >
                                      <div
                                        className="flex items-start gap-2 rounded-md border border-border bg-background/60 hover:bg-muted/60 transition-colors px-3 py-2 max-w-sm cursor-pointer"
                                        data-testid={`card-ai-suggestion-${customer.contactId}-${idx}`}
                                      >
                                        <Zap className="h-3.5 w-3.5 mt-0.5 shrink-0 text-yellow-500" />
                                        <div className="space-y-0.5">
                                          <p
                                            className="text-xs font-semibold leading-tight"
                                            data-testid={`text-ai-suggestion-title-${customer.contactId}-${idx}`}
                                          >
                                            {s.title}
                                          </p>
                                          <p
                                            className="text-xs text-muted-foreground leading-snug"
                                            data-testid={`text-ai-suggestion-explanation-${customer.contactId}-${idx}`}
                                          >
                                            {s.explanation}
                                          </p>
                                          {s.impactCents > 0 && (
                                            <p
                                              className="text-xs text-green-600 dark:text-green-400 font-medium"
                                              data-testid={`text-ai-suggestion-impact-${customer.contactId}-${idx}`}
                                            >
                                              +{formatDollars(s.impactCents)}/mo potential
                                            </p>
                                          )}
                                          <div className="flex items-center gap-1 pt-0.5 text-xs text-muted-foreground">
                                            <ExternalLink className="h-2.5 w-2.5" />
                                            View contact
                                          </div>
                                        </div>
                                      </div>
                                    </Link>
                                  ))}
                                </div>
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
                    <TableRow
                      key={`${rec.contactId}-${rec.propertyId}-${idx}`}
                      data-testid={`row-recommendation-${idx}`}
                    >
                      <TableCell className="font-medium" data-testid={`text-rec-customer-${idx}`}>
                        <ClientInfoPopover contactId={rec.contactId}>
                          <span>{rec.contactName}</span>
                        </ClientInfoPopover>
                      </TableCell>
                      <TableCell
                        className="text-sm text-muted-foreground max-w-48 truncate"
                        data-testid={`text-rec-address-${idx}`}
                      >
                        {rec.propertyAddress}
                      </TableCell>
                      <TableCell data-testid={`text-rec-current-${idx}`}>
                        {formatDollars(rec.currentPriceCents)}
                      </TableCell>
                      <TableCell data-testid={`text-rec-recommended-${idx}`}>
                        <span className="font-medium text-green-600 dark:text-green-400">
                          {formatDollars(rec.recommendedPriceCents)}
                        </span>
                      </TableCell>
                      <TableCell data-testid={`text-rec-current-margin-${idx}`}>
                        <span
                          className={
                            rec.currentMarginPct < 0
                              ? "text-red-600 dark:text-red-400"
                              : "text-yellow-600 dark:text-yellow-400"
                          }
                        >
                          {rec.currentMarginPct.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell data-testid={`text-rec-projected-margin-${idx}`}>
                        <span className="text-green-600 dark:text-green-400">
                          {rec.projectedMarginPct.toFixed(1)}%
                        </span>
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

      {viewMode === "breakeven" && (
        <BreakevenCalculator
          weeklyBasePriceCents={pricingConfig?.pricingRules?.basePrices?.weekly}
          fixedOverheadCents={overheadData?.totalMonthlyOverheadCents}
          variableCostPerVisitCents={variableCostPerVisitCents}
          activeClients={(customers ?? []).length}
        />
      )}
    </div>
  );
}
