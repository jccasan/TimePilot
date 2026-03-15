import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Loader2,
  SlidersHorizontal,
  BarChart3,
  Users,
  Plus,
  Trash2,
  Play,
  MapPin,
  Star,
} from "lucide-react";

interface SimulatedProperty {
  propertyId: string;
  propertyAddress: string;
  contactId: string;
  contactName: string;
  zipCode: string;
  frequency: string;
  dogCount: number;
  yardSizeAcres: number;
  currentPriceCents: number;
  simulatedPriceCents: number;
  changeCents: number;
  changePct: number;
  currentMarginPct: number;
  projectedMarginPct: number;
  currentCostPerVisitCents: number;
  simulatedCostPerVisitCents: number;
}

interface SimulationResult {
  properties: SimulatedProperty[];
  summary: {
    totalCurrentMonthlyRevenueCents: number;
    totalSimulatedMonthlyRevenueCents: number;
    monthlyRevenueDeltaCents: number;
    averageCurrentMarginPct: number;
    averageSimulatedMarginPct: number;
    propertiesNeedingIncrease: number;
    propertiesNeedingDecrease: number;
    propertiesUnchanged: number;
  };
}

interface ElasticityPoint {
  priceChangePct: number;
  estimatedChurnPct: number;
  retainedCustomers: number;
  totalCustomers: number;
  currentMonthlyRevenueCents: number;
  adjustedMonthlyRevenueCents: number;
  netRevenueDeltaCents: number;
  avgNewPriceCents: number;
}

interface ElasticityResult {
  propertyId: string | null;
  propertyLabel: string;
  points: ElasticityPoint[];
  sweetSpotIndex: number;
}

interface CompetitorEntry {
  id: string;
  companyId: string;
  zipCode: string;
  competitorName: string;
  frequency: string;
  priceCents: number;
  dogCountRange: string;
  yardSizeCategory: string;
  source: string;
  notes: string | null;
  createdAt: string;
}

interface CompetitorAnalysisEntry {
  zipCode: string;
  yourAvgPriceCents: number;
  yourPropertyCount: number;
  marketAvgPriceCents: number;
  competitorCount: number;
  competitors: Array<{
    name: string;
    priceCents: number;
    frequency: string;
    dogCountRange: string;
    yardSizeCategory: string;
  }>;
  positionPct: number;
  position: "below_market" | "at_market" | "above_market";
}

interface CompetitorAnalysisResult {
  zipCodes: CompetitorAnalysisEntry[];
  overallPosition: "below_market" | "at_market" | "above_market";
  overallYourAvgCents: number;
  overallMarketAvgCents: number;
}

function formatDollars(cents: number): string {
  const abs = Math.abs(cents);
  const formatted = `$${(abs / 100).toFixed(2)}`;
  return cents < 0 ? `-${formatted}` : formatted;
}

function marginColor(pct: number): string {
  if (pct >= 15) return "text-green-600 dark:text-green-400";
  if (pct >= 0) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function positionBadge(position: string) {
  const map: Record<string, { label: string; className: string }> = {
    below_market: { label: "Below Market", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    at_market: { label: "At Market", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    above_market: { label: "Above Market", className: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  };
  const info = map[position] || map.at_market;
  return <Badge variant="outline" className={`text-xs ${info.className}`}>{info.label}</Badge>;
}

export default function AIPricingOptimizer() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("simulator");

  const [targetMarginPct, setTargetMarginPct] = useState(30);
  const [overheadAdjustmentPct, setOverheadAdjustmentPct] = useState(0);
  const [laborRateAdjustmentPct, setLaborRateAdjustmentPct] = useState(0);
  const [travelCostFactor, setTravelCostFactor] = useState(1.0);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);

  const [elasticityPropertyId, setElasticityPropertyId] = useState<string>("");
  const [elasticityResult, setElasticityResult] = useState<ElasticityResult | null>(null);

  const [compZipFilter, setCompZipFilter] = useState<string>("all");
  const [compAnalysisResult, setCompAnalysisResult] = useState<CompetitorAnalysisResult | null>(null);
  const [addCompDialogOpen, setAddCompDialogOpen] = useState(false);
  const [newCompName, setNewCompName] = useState("");
  const [newCompPrice, setNewCompPrice] = useState("");
  const [newCompZip, setNewCompZip] = useState("");
  const [newCompFrequency, setNewCompFrequency] = useState("weekly");
  const [newCompYardSize, setNewCompYardSize] = useState("medium");
  const [newCompDogRange, setNewCompDogRange] = useState("1-2");

  const { data: zipCodes } = useQuery<string[]>({
    queryKey: ["/api/pricing-simulator/zip-codes"],
  });

  const { data: competitors, isLoading: competitorsLoading } = useQuery<CompetitorEntry[]>({
    queryKey: ["/api/competitor-pricing"],
  });

  const simulateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pricing-simulator/simulate", {
        targetMarginPct,
        overheadAdjustmentPct,
        laborRateAdjustmentPct,
        travelCostFactor,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setSimulationResult(data);
      toast({ title: "Simulation complete", description: `Analyzed ${data.properties.length} properties.` });
    },
    onError: () => {
      toast({ title: "Simulation failed", variant: "destructive" });
    },
  });

  const elasticityMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pricing-simulator/elasticity", {
        propertyId: elasticityPropertyId && elasticityPropertyId !== "all" ? elasticityPropertyId : undefined,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setElasticityResult(data);
    },
    onError: () => {
      toast({ title: "Elasticity analysis failed", variant: "destructive" });
    },
  });

  const competitorAnalysisMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pricing-simulator/competitor-analysis", {
        zipCode: compZipFilter !== "all" ? compZipFilter : undefined,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setCompAnalysisResult(data);
    },
    onError: () => {
      toast({ title: "Competitor analysis failed", variant: "destructive" });
    },
  });

  const addCompetitorMutation = useMutation({
    mutationFn: async () => {
      const priceCents = Math.round(parseFloat(newCompPrice) * 100);
      if (isNaN(priceCents) || priceCents <= 0) throw new Error("Invalid price");
      const res = await apiRequest("POST", "/api/competitor-pricing", {
        zipCode: newCompZip,
        competitorName: newCompName,
        frequency: newCompFrequency,
        priceCents,
        dogCountRange: newCompDogRange,
        yardSizeCategory: newCompYardSize,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitor-pricing"] });
      setAddCompDialogOpen(false);
      setNewCompName("");
      setNewCompPrice("");
      setNewCompZip("");
      setNewCompFrequency("weekly");
      setNewCompYardSize("medium");
      setNewCompDogRange("1-2");
      toast({ title: "Competitor added" });
    },
    onError: () => {
      toast({ title: "Failed to add competitor", variant: "destructive" });
    },
  });

  const deleteCompetitorMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/competitor-pricing/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitor-pricing"] });
      toast({ title: "Competitor removed" });
    },
  });

  const allProperties = simulationResult?.properties ?? [];

  return (
    <div className="p-4 sm:p-6 space-y-6 h-full overflow-y-auto" data-testid="page-ai-pricing-optimizer">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <SlidersHorizontal className="h-6 w-6 text-primary" />
          Pricing Simulator
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Adjust variables, simulate pricing scenarios, analyze price elasticity, and compare against competitors.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3" data-testid="tabs-simulator">
          <TabsTrigger value="simulator" data-testid="tab-simulator" className="gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Simulator
          </TabsTrigger>
          <TabsTrigger value="elasticity" data-testid="tab-elasticity" className="gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" />
            Price Elasticity
          </TabsTrigger>
          <TabsTrigger value="competitor" data-testid="tab-competitor" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Competitor Analysis
          </TabsTrigger>
        </TabsList>

        {/* ========== TAB 1: PRICING SIMULATOR ========== */}
        <TabsContent value="simulator" className="space-y-4 mt-4">
          <Card data-testid="card-simulator-controls">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Simulation Variables</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-sm">Target Profit Margin</Label>
                    <span className="text-sm font-medium" data-testid="text-slider-margin">{targetMarginPct}%</span>
                  </div>
                  <Slider
                    value={[targetMarginPct]}
                    onValueChange={([v]) => setTargetMarginPct(v)}
                    min={5}
                    max={60}
                    step={1}
                    data-testid="slider-target-margin"
                  />
                  <p className="text-xs text-muted-foreground">Min price margin target for each property</p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-sm">Overhead Adjustment</Label>
                    <span className="text-sm font-medium" data-testid="text-slider-overhead">{overheadAdjustmentPct > 0 ? "+" : ""}{overheadAdjustmentPct}%</span>
                  </div>
                  <Slider
                    value={[overheadAdjustmentPct]}
                    onValueChange={([v]) => setOverheadAdjustmentPct(v)}
                    min={-20}
                    max={50}
                    step={1}
                    data-testid="slider-overhead"
                  />
                  <p className="text-xs text-muted-foreground">Simulate changes in monthly overhead costs</p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-sm">Labor Rate Adjustment</Label>
                    <span className="text-sm font-medium" data-testid="text-slider-labor">{laborRateAdjustmentPct > 0 ? "+" : ""}{laborRateAdjustmentPct}%</span>
                  </div>
                  <Slider
                    value={[laborRateAdjustmentPct]}
                    onValueChange={([v]) => setLaborRateAdjustmentPct(v)}
                    min={-20}
                    max={30}
                    step={1}
                    data-testid="slider-labor"
                  />
                  <p className="text-xs text-muted-foreground">Simulate wage increases or efficiency gains</p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-sm">Travel Cost Factor</Label>
                    <span className="text-sm font-medium" data-testid="text-slider-travel">{travelCostFactor.toFixed(1)}x</span>
                  </div>
                  <Slider
                    value={[travelCostFactor * 10]}
                    onValueChange={([v]) => setTravelCostFactor(v / 10)}
                    min={5}
                    max={20}
                    step={1}
                    data-testid="slider-travel"
                  />
                  <p className="text-xs text-muted-foreground">Multiply travel costs (gas, wear, etc.)</p>
                </div>
              </div>

              <Button
                onClick={() => simulateMutation.mutate()}
                disabled={simulateMutation.isPending}
                className="gap-2"
                data-testid="button-run-simulation"
              >
                {simulateMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Running...</>
                ) : (
                  <><Play className="h-4 w-4" /> Run Simulation</>
                )}
              </Button>
            </CardContent>
          </Card>

          {simulationResult && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card data-testid="card-sim-kpi-revenue">
                  <CardContent className="p-4">
                    <p className="text-xs font-medium text-muted-foreground">Monthly Revenue Change</p>
                    <p className={`text-2xl font-bold mt-1 ${simulationResult.summary.monthlyRevenueDeltaCents >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-sim-revenue-delta">
                      {simulationResult.summary.monthlyRevenueDeltaCents >= 0 ? "+" : ""}{formatDollars(simulationResult.summary.monthlyRevenueDeltaCents)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">per month</p>
                  </CardContent>
                </Card>

                <Card data-testid="card-sim-kpi-margin">
                  <CardContent className="p-4">
                    <p className="text-xs font-medium text-muted-foreground">Avg Margin Change</p>
                    <p className="text-2xl font-bold mt-1" data-testid="text-sim-margin-change">
                      {simulationResult.summary.averageCurrentMarginPct.toFixed(1)}% <ArrowUpRight className="inline h-4 w-4" /> {simulationResult.summary.averageSimulatedMarginPct.toFixed(1)}%
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">current to simulated</p>
                  </CardContent>
                </Card>

                <Card data-testid="card-sim-kpi-increase">
                  <CardContent className="p-4">
                    <p className="text-xs font-medium text-muted-foreground">Need Price Increase</p>
                    <p className="text-2xl font-bold mt-1" data-testid="text-sim-increases">{simulationResult.summary.propertiesNeedingIncrease}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">properties</p>
                  </CardContent>
                </Card>

                <Card data-testid="card-sim-kpi-decrease">
                  <CardContent className="p-4">
                    <p className="text-xs font-medium text-muted-foreground">Could Decrease</p>
                    <p className="text-2xl font-bold mt-1" data-testid="text-sim-decreases">{simulationResult.summary.propertiesNeedingDecrease}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">properties</p>
                  </CardContent>
                </Card>
              </div>

              <Card data-testid="card-sim-results">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Simulation Results ({allProperties.length} properties)</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Customer</TableHead>
                          <TableHead className="text-right">Current</TableHead>
                          <TableHead className="text-right">Simulated</TableHead>
                          <TableHead className="text-right">Change</TableHead>
                          <TableHead className="text-right">Current Margin</TableHead>
                          <TableHead className="text-right">Projected Margin</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {allProperties.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                              No properties to simulate. Add customers with active jobs first.
                            </TableCell>
                          </TableRow>
                        ) : (
                          allProperties.map((p) => {
                            const changeColor = p.changeCents > 50
                              ? "text-green-600 dark:text-green-400"
                              : p.changeCents < -50
                                ? "text-red-600 dark:text-red-400"
                                : "text-muted-foreground";
                            return (
                              <TableRow key={p.propertyId} data-testid={`row-sim-${p.propertyId}`}>
                                <TableCell>
                                  <div>
                                    <span className="font-medium text-sm" data-testid={`text-sim-customer-${p.propertyId}`}>{p.contactName}</span>
                                    <p className="text-xs text-muted-foreground truncate max-w-52">{p.propertyAddress}</p>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-medium" data-testid={`text-sim-current-${p.propertyId}`}>
                                  {formatDollars(p.currentPriceCents)}
                                </TableCell>
                                <TableCell className="text-right font-medium" data-testid={`text-sim-simulated-${p.propertyId}`}>
                                  {formatDollars(p.simulatedPriceCents)}
                                </TableCell>
                                <TableCell className="text-right">
                                  <span className={`flex items-center justify-end gap-0.5 text-sm ${changeColor}`} data-testid={`text-sim-change-${p.propertyId}`}>
                                    {p.changeCents > 50 && <ArrowUpRight className="h-3.5 w-3.5" />}
                                    {p.changeCents < -50 && <ArrowDownRight className="h-3.5 w-3.5" />}
                                    {Math.abs(p.changeCents) <= 50 && <Minus className="h-3.5 w-3.5" />}
                                    {formatDollars(p.changeCents)} ({p.changePct > 0 ? "+" : ""}{p.changePct.toFixed(1)}%)
                                  </span>
                                </TableCell>
                                <TableCell className={`text-right ${marginColor(p.currentMarginPct)}`} data-testid={`text-sim-cur-margin-${p.propertyId}`}>
                                  {p.currentMarginPct.toFixed(1)}%
                                </TableCell>
                                <TableCell className={`text-right ${marginColor(p.projectedMarginPct)}`} data-testid={`text-sim-proj-margin-${p.propertyId}`}>
                                  {p.projectedMarginPct.toFixed(1)}%
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
            </>
          )}

          {!simulationResult && !simulateMutation.isPending && (
            <Card>
              <CardContent className="py-12 text-center">
                <SlidersHorizontal className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Adjust the sliders above and click "Run Simulation" to see how pricing changes affect your portfolio.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ========== TAB 2: PRICE ELASTICITY ========== */}
        <TabsContent value="elasticity" className="space-y-4 mt-4">
          <Card data-testid="card-elasticity-controls">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Price Elasticity Simulation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                See how different price changes affect customer retention and net revenue. The model estimates churn based on price sensitivity curves.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Select value={elasticityPropertyId} onValueChange={setElasticityPropertyId}>
                  <SelectTrigger className="w-64" data-testid="select-elasticity-property">
                    <SelectValue placeholder="All Properties" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Properties</SelectItem>
                    {simulationResult?.properties.map((p) => (
                      <SelectItem key={p.propertyId} value={p.propertyId}>
                        {p.contactName} - {p.propertyAddress.split(",")[0]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => elasticityMutation.mutate()}
                  disabled={elasticityMutation.isPending}
                  className="gap-2"
                  data-testid="button-run-elasticity"
                >
                  {elasticityMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing...</>
                  ) : (
                    <><BarChart3 className="h-4 w-4" /> Run Elasticity Analysis</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {elasticityResult && (
            <>
              <Card data-testid="card-elasticity-label">
                <CardContent className="p-4">
                  <p className="text-sm font-medium">{elasticityResult.propertyLabel}</p>
                  <p className="text-xs text-muted-foreground">{elasticityResult.points[0]?.totalCustomers ?? 0} properties analyzed</p>
                </CardContent>
              </Card>

              <Card data-testid="card-elasticity-results">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Price Points Analysis</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Price Change</TableHead>
                          <TableHead className="text-right">Avg Price</TableHead>
                          <TableHead className="text-right">Est. Churn</TableHead>
                          <TableHead className="text-right">Retained</TableHead>
                          <TableHead className="text-right">Monthly Revenue</TableHead>
                          <TableHead className="text-right">Net Change</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {elasticityResult.points.map((pt, idx) => {
                          const isSweetSpot = idx === elasticityResult.sweetSpotIndex;
                          const isBaseline = pt.priceChangePct === 0;
                          return (
                            <TableRow
                              key={pt.priceChangePct}
                              className={isSweetSpot ? "bg-green-50/50 dark:bg-green-950/20" : ""}
                              data-testid={`row-elasticity-${pt.priceChangePct}`}
                            >
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <span className={`font-medium ${pt.priceChangePct > 0 ? "text-green-600 dark:text-green-400" : pt.priceChangePct < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                                    {pt.priceChangePct > 0 ? "+" : ""}{pt.priceChangePct}%
                                  </span>
                                  {isSweetSpot && <Badge variant="outline" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"><Star className="h-3 w-3 mr-0.5 inline" />Best</Badge>}
                                  {isBaseline && <Badge variant="outline" className="text-xs">Current</Badge>}
                                </div>
                              </TableCell>
                              <TableCell className="text-right" data-testid={`text-el-avg-price-${pt.priceChangePct}`}>
                                {formatDollars(pt.avgNewPriceCents)}
                              </TableCell>
                              <TableCell className="text-right" data-testid={`text-el-churn-${pt.priceChangePct}`}>
                                <span className={pt.estimatedChurnPct > 5 ? "text-red-600 dark:text-red-400" : ""}>
                                  {pt.estimatedChurnPct.toFixed(1)}%
                                </span>
                              </TableCell>
                              <TableCell className="text-right" data-testid={`text-el-retained-${pt.priceChangePct}`}>
                                {pt.retainedCustomers} / {pt.totalCustomers}
                              </TableCell>
                              <TableCell className="text-right font-medium" data-testid={`text-el-revenue-${pt.priceChangePct}`}>
                                {formatDollars(pt.adjustedMonthlyRevenueCents)}
                              </TableCell>
                              <TableCell className="text-right">
                                <span className={`font-medium ${pt.netRevenueDeltaCents > 0 ? "text-green-600 dark:text-green-400" : pt.netRevenueDeltaCents < 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid={`text-el-delta-${pt.priceChangePct}`}>
                                  {pt.netRevenueDeltaCents > 0 ? "+" : ""}{formatDollars(pt.netRevenueDeltaCents)}
                                </span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {!elasticityResult && !elasticityMutation.isPending && (
            <Card>
              <CardContent className="py-12 text-center">
                <BarChart3 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Select a property (or all) and click "Run Elasticity Analysis" to see how price changes affect retention and revenue.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ========== TAB 3: COMPETITOR ANALYSIS ========== */}
        <TabsContent value="competitor" className="space-y-4 mt-4">
          <Card data-testid="card-competitor-entry">
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Competitor Pricing Data</CardTitle>
              <Dialog open={addCompDialogOpen} onOpenChange={setAddCompDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5" data-testid="button-add-competitor">
                    <Plus className="h-3.5 w-3.5" /> Add Competitor
                  </Button>
                </DialogTrigger>
                <DialogContent data-testid="dialog-add-competitor">
                  <DialogHeader>
                    <DialogTitle>Add Competitor Pricing</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3 mt-2">
                    <div className="space-y-1">
                      <Label className="text-sm">Competitor Name</Label>
                      <Input
                        value={newCompName}
                        onChange={(e) => setNewCompName(e.target.value)}
                        placeholder="e.g. Paws & Scoop"
                        data-testid="input-comp-name"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-sm">Price Per Visit</Label>
                        <Input
                          value={newCompPrice}
                          onChange={(e) => setNewCompPrice(e.target.value)}
                          placeholder="25.00"
                          type="number"
                          step="0.01"
                          data-testid="input-comp-price"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-sm">Zip Code</Label>
                        <Input
                          value={newCompZip}
                          onChange={(e) => setNewCompZip(e.target.value)}
                          placeholder="23456"
                          data-testid="input-comp-zip"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-sm">Frequency</Label>
                        <Select value={newCompFrequency} onValueChange={setNewCompFrequency}>
                          <SelectTrigger data-testid="select-comp-frequency">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="weekly">Weekly</SelectItem>
                            <SelectItem value="biweekly">Biweekly</SelectItem>
                            <SelectItem value="monthly">Monthly</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-sm">Yard Size</Label>
                        <Select value={newCompYardSize} onValueChange={setNewCompYardSize}>
                          <SelectTrigger data-testid="select-comp-yard">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="small">Small</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="large">Large</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-sm">Dogs</Label>
                        <Select value={newCompDogRange} onValueChange={setNewCompDogRange}>
                          <SelectTrigger data-testid="select-comp-dogs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1-2">1-2</SelectItem>
                            <SelectItem value="3-5">3-5</SelectItem>
                            <SelectItem value="6+">6+</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button
                      onClick={() => addCompetitorMutation.mutate()}
                      disabled={addCompetitorMutation.isPending || !newCompName || !newCompPrice || !newCompZip}
                      className="w-full"
                      data-testid="button-save-competitor"
                    >
                      {addCompetitorMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Save Competitor
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {competitors && competitors.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Competitor</TableHead>
                        <TableHead>Zip Code</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead>Frequency</TableHead>
                        <TableHead>Yard / Dogs</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {competitors.map((c) => (
                        <TableRow key={c.id} data-testid={`row-competitor-${c.id}`}>
                          <TableCell className="font-medium" data-testid={`text-comp-name-${c.id}`}>{c.competitorName}</TableCell>
                          <TableCell data-testid={`text-comp-zip-${c.id}`}>
                            <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-muted-foreground" />{c.zipCode}</span>
                          </TableCell>
                          <TableCell className="text-right font-medium" data-testid={`text-comp-price-${c.id}`}>{formatDollars(c.priceCents)}</TableCell>
                          <TableCell className="capitalize">{c.frequency}</TableCell>
                          <TableCell>{c.yardSizeCategory} / {c.dogCountRange} dogs</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => deleteCompetitorMutation.mutate(c.id)}
                              data-testid={`button-delete-comp-${c.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No competitor pricing data yet. Click "Add Competitor" to enter local competitor rates.
                </p>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-competitor-analysis">
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0 flex-wrap gap-2">
              <CardTitle className="text-base">Market Comparison</CardTitle>
              <div className="flex gap-2">
                <Select value={compZipFilter} onValueChange={setCompZipFilter}>
                  <SelectTrigger className="w-40" data-testid="select-comp-zip-filter">
                    <SelectValue placeholder="All Zip Codes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Zip Codes</SelectItem>
                    {(zipCodes ?? []).map((z) => (
                      <SelectItem key={z} value={z}>{z}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => competitorAnalysisMutation.mutate()}
                  disabled={competitorAnalysisMutation.isPending || (competitors?.length ?? 0) === 0}
                  className="gap-1.5"
                  data-testid="button-run-comp-analysis"
                >
                  {competitorAnalysisMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <BarChart3 className="h-4 w-4" />
                  )}
                  Analyze
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {compAnalysisResult ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Overall Position:</span>
                      {positionBadge(compAnalysisResult.overallPosition)}
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Your avg: </span>
                      <span className="font-medium" data-testid="text-overall-your-avg">{formatDollars(compAnalysisResult.overallYourAvgCents)}</span>
                      <span className="text-muted-foreground"> / wk</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Market avg: </span>
                      <span className="font-medium" data-testid="text-overall-market-avg">{formatDollars(compAnalysisResult.overallMarketAvgCents)}</span>
                      <span className="text-muted-foreground"> / wk</span>
                    </div>
                  </div>

                  {compAnalysisResult.zipCodes.length > 0 && (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Zip Code</TableHead>
                            <TableHead className="text-right">Your Avg (wk)</TableHead>
                            <TableHead className="text-right">Market Avg (wk)</TableHead>
                            <TableHead className="text-right">Your Properties</TableHead>
                            <TableHead className="text-right">Competitors</TableHead>
                            <TableHead>Position</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {compAnalysisResult.zipCodes.map((z) => (
                            <TableRow key={z.zipCode} data-testid={`row-comp-zip-${z.zipCode}`}>
                              <TableCell className="font-medium" data-testid={`text-comp-analysis-zip-${z.zipCode}`}>
                                <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-muted-foreground" />{z.zipCode}</span>
                              </TableCell>
                              <TableCell className="text-right font-medium" data-testid={`text-comp-your-avg-${z.zipCode}`}>
                                {z.yourAvgPriceCents > 0 ? formatDollars(z.yourAvgPriceCents) : "--"}
                              </TableCell>
                              <TableCell className="text-right" data-testid={`text-comp-market-avg-${z.zipCode}`}>
                                {z.marketAvgPriceCents > 0 ? formatDollars(z.marketAvgPriceCents) : "--"}
                              </TableCell>
                              <TableCell className="text-right">{z.yourPropertyCount}</TableCell>
                              <TableCell className="text-right">{z.competitorCount}</TableCell>
                              <TableCell>{positionBadge(z.position)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">
                    {(competitors?.length ?? 0) === 0
                      ? "Add competitor pricing data above, then run the analysis to see how your pricing compares to the local market."
                      : "Click \"Analyze\" to compare your pricing against competitors in your service areas."}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
