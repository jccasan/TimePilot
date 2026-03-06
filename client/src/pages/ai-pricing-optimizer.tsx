import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  Sparkles,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  DollarSign,
  ChevronDown,
  ChevronRight,
  Target,
  ShieldAlert,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Loader2,
  Brain,
} from "lucide-react";

type Confidence = "high" | "medium" | "low";
type ChurnRisk = "low" | "moderate" | "high";

interface AIPropertyRecommendation {
  propertyId: string;
  contactId: string;
  contactName: string;
  propertyAddress: string;
  currentPriceCents: number;
  aiRecommendedPriceCents: number;
  calculatorRecommendedPriceCents: number;
  priceChangeCents: number;
  priceChangePct: number;
  currentMarginPct: number;
  projectedMarginPct: number;
  costPerVisitCents: number;
  confidence: Confidence;
  reasoning: string;
  monthlyRevenueImpactCents: number;
  annualRevenueImpactCents: number;
  frequency: string;
  dogCount: number;
  yardSizeAcres: number;
  churnRisk: ChurnRisk;
  churnRiskReason: string;
}

interface AIPricingAnalysis {
  generatedAt: string;
  portfolioSummary: {
    totalProperties: number;
    underpricedCount: number;
    overpricedCount: number;
    fairlyPricedCount: number;
    totalCurrentMonthlyRevenueCents: number;
    totalOptimizedMonthlyRevenueCents: number;
    potentialMonthlyGainCents: number;
    potentialAnnualGainCents: number;
    averageCurrentMarginPct: number;
    averageOptimizedMarginPct: number;
    marketPositioningSummary: string;
  };
  recommendations: AIPropertyRecommendation[];
  priorityActions: Array<{
    rank: number;
    propertyId: string;
    contactName: string;
    propertyAddress: string;
    action: string;
    revenueImpactCents: number;
    reason: string;
  }>;
  riskFlags: Array<{
    propertyId: string;
    contactName: string;
    propertyAddress: string;
    riskLevel: "moderate" | "high";
    reason: string;
    suggestedApproach: string;
  }>;
  overallInsight: string;
  aiPowered: boolean;
}

type FilterMode = "all" | "underpriced" | "overpriced" | "fair";

function formatDollars(cents: number): string {
  const abs = Math.abs(cents);
  const formatted = `$${(abs / 100).toFixed(2)}`;
  return cents < 0 ? `-${formatted}` : formatted;
}

function confidenceBadge(confidence: Confidence) {
  const styles: Record<Confidence, string> = {
    high: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    low: "bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
  };
  return (
    <Badge variant="outline" className={`text-xs ${styles[confidence]}`}>
      {confidence.charAt(0).toUpperCase() + confidence.slice(1)}
    </Badge>
  );
}

function churnBadge(risk: ChurnRisk) {
  if (risk === "low") return null;
  const styles: Record<string, string> = {
    moderate: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <Badge variant="outline" className={`text-xs ${styles[risk]}`}>
      {risk === "high" ? "High Risk" : "Moderate Risk"}
    </Badge>
  );
}

export default function AIPricingOptimizer() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [expandedPropertyId, setExpandedPropertyId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  const { data: analysis, isLoading } = useQuery<AIPricingAnalysis>({
    queryKey: ["/api/ai-pricing/latest"],
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai-pricing/analyze");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-pricing/latest"] });
      toast({ title: "Analysis complete", description: "AI pricing recommendations have been generated." });
    },
    onError: () => {
      toast({ title: "Analysis failed", description: "Could not generate pricing analysis. Please try again.", variant: "destructive" });
    },
  });

  const filteredRecs = (analysis?.recommendations ?? []).filter((r) => {
    if (filterMode === "underpriced") return r.priceChangeCents > 0;
    if (filterMode === "overpriced") return r.priceChangeCents < 0;
    if (filterMode === "fair") return r.priceChangeCents === 0;
    return true;
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4" data-testid="loading-ai-pricing">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const summary = analysis?.portfolioSummary;

  return (
    <div className="p-4 sm:p-6 space-y-6 overflow-auto max-h-[calc(100vh-4rem)]" data-testid="page-ai-pricing-optimizer">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Brain className="h-6 w-6 text-primary" />
            AI Pricing Optimizer
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {analysis?.aiPowered
              ? "AI-powered analysis of your pricing portfolio with intelligent recommendations."
              : "Rule-based analysis of your pricing portfolio. Connect OpenAI for AI-enhanced insights."}
          </p>
        </div>
        <Button
          onClick={() => analyzeMutation.mutate()}
          disabled={analyzeMutation.isPending}
          className="gap-2"
          data-testid="button-run-analysis"
        >
          {analyzeMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Run Analysis
            </>
          )}
        </Button>
      </div>

      {analysis?.aiPowered && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="text-ai-badge">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>AI-enhanced analysis</span>
          <span>|</span>
          <span>Generated {new Date(analysis.generatedAt).toLocaleString()}</span>
        </div>
      )}

      {analysis?.overallInsight && (
        <Card data-testid="card-overall-insight">
          <CardContent className="p-4">
            <p className="text-sm leading-relaxed" data-testid="text-overall-insight">{analysis.overallInsight}</p>
          </CardContent>
        </Card>
      )}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card data-testid="card-kpi-potential-gain">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Potential Annual Gain</p>
                <p className={`text-2xl font-bold ${summary.potentialAnnualGainCents > 0 ? "text-green-600 dark:text-green-400" : ""}`} data-testid="text-kpi-annual-gain">
                  {formatDollars(summary.potentialAnnualGainCents)}
                </p>
                <p className="text-xs text-muted-foreground">{formatDollars(summary.potentialMonthlyGainCents)}/mo</p>
              </div>
              <div className="p-2 rounded-md bg-primary/10">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-kpi-underpriced">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Underpriced</p>
                <p className="text-2xl font-bold" data-testid="text-kpi-underpriced">
                  {summary.underpricedCount}
                </p>
                <p className="text-xs text-muted-foreground">of {summary.totalProperties} properties</p>
              </div>
              <div className="p-2 rounded-md bg-yellow-100 dark:bg-yellow-900/30">
                <ArrowUpRight className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-kpi-margin-current">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Current Avg Margin</p>
                <p className="text-2xl font-bold" data-testid="text-kpi-current-margin">
                  {summary.averageCurrentMarginPct.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">across portfolio</p>
              </div>
              <div className="p-2 rounded-md bg-primary/10">
                <Target className="h-4 w-4 text-primary" />
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-kpi-margin-optimized">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Optimized Avg Margin</p>
                <p className={`text-2xl font-bold ${summary.averageOptimizedMarginPct > summary.averageCurrentMarginPct ? "text-green-600 dark:text-green-400" : ""}`} data-testid="text-kpi-optimized-margin">
                  {summary.averageOptimizedMarginPct.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">after optimization</p>
              </div>
              <div className="p-2 rounded-md bg-green-100 dark:bg-green-900/30">
                <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {(analysis?.priorityActions?.length ?? 0) > 0 && (
        <Card data-testid="card-priority-actions">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Top Priority Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {analysis!.priorityActions.map((action) => (
              <div
                key={`${action.propertyId}-${action.rank}`}
                className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30"
                data-testid={`card-priority-action-${action.rank}`}
              >
                <div className="flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">
                  {action.rank}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm" data-testid={`text-priority-customer-${action.rank}`}>{action.contactName}</span>
                    <span className="text-xs text-muted-foreground truncate">{action.propertyAddress}</span>
                  </div>
                  <p className="text-sm mt-0.5" data-testid={`text-priority-action-${action.rank}`}>{action.action}</p>
                  <p className="text-xs text-muted-foreground mt-1">{action.reason}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-green-600 dark:text-green-400" data-testid={`text-priority-impact-${action.rank}`}>
                    +{formatDollars(action.revenueImpactCents)}
                  </p>
                  <p className="text-xs text-muted-foreground">per year</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(analysis?.riskFlags?.length ?? 0) > 0 && (
        <Card data-testid="card-risk-flags">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              Churn Risk Flags
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {analysis!.riskFlags.map((flag, idx) => (
              <div
                key={`${flag.propertyId}-${idx}`}
                className={`p-3 rounded-lg border ${flag.riskLevel === "high" ? "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20" : "border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-950/20"}`}
                data-testid={`card-risk-flag-${idx}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className={`h-4 w-4 ${flag.riskLevel === "high" ? "text-red-500" : "text-yellow-500"}`} />
                  <span className="font-medium text-sm">{flag.contactName}</span>
                  <span className="text-xs text-muted-foreground">{flag.propertyAddress}</span>
                  {flag.riskLevel === "high" ? (
                    <Badge variant="outline" className="text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">High Risk</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">Moderate Risk</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{flag.reason}</p>
                <p className="text-xs mt-1 italic text-muted-foreground">{flag.suggestedApproach}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-recommendations-table">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-4">
          <CardTitle className="text-base">Property Recommendations</CardTitle>
          <Select value={filterMode} onValueChange={(v) => setFilterMode(v as FilterMode)}>
            <SelectTrigger className="w-44" data-testid="select-filter-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Properties</SelectItem>
              <SelectItem value="underpriced">Underpriced Only</SelectItem>
              <SelectItem value="overpriced">Overpriced Only</SelectItem>
              <SelectItem value="fair">Fairly Priced</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Current Price</TableHead>
                  <TableHead>AI Recommended</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Current Margin</TableHead>
                  <TableHead>Projected Margin</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Risk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      {(analysis?.recommendations?.length ?? 0) === 0
                        ? "No properties to analyze. Add customers with active service plans to get recommendations."
                        : "No properties match this filter."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRecs.map((rec) => {
                    const isExpanded = expandedPropertyId === rec.propertyId;
                    const changeColor = rec.priceChangeCents > 0
                      ? "text-green-600 dark:text-green-400"
                      : rec.priceChangeCents < 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-muted-foreground";
                    const ChangeIcon = rec.priceChangeCents > 0 ? ArrowUpRight : rec.priceChangeCents < 0 ? ArrowDownRight : Minus;

                    return (
                      <TableRow
                        key={rec.propertyId}
                        className="cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => setExpandedPropertyId(isExpanded ? null : rec.propertyId)}
                        data-testid={`row-recommendation-${rec.propertyId}`}
                      >
                        <TableCell className="w-8 pr-0">
                          {isExpanded
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell>
                          <div>
                            <span className="font-medium text-sm" data-testid={`text-rec-customer-${rec.propertyId}`}>{rec.contactName}</span>
                            <p className="text-xs text-muted-foreground truncate max-w-48" data-testid={`text-rec-address-${rec.propertyId}`}>{rec.propertyAddress}</p>
                          </div>
                        </TableCell>
                        <TableCell data-testid={`text-rec-current-price-${rec.propertyId}`}>
                          {formatDollars(rec.currentPriceCents)}
                        </TableCell>
                        <TableCell data-testid={`text-rec-ai-price-${rec.propertyId}`}>
                          <span className="font-medium">{formatDollars(rec.aiRecommendedPriceCents)}</span>
                        </TableCell>
                        <TableCell>
                          <span className={`flex items-center gap-0.5 text-sm ${changeColor}`} data-testid={`text-rec-change-${rec.propertyId}`}>
                            <ChangeIcon className="h-3.5 w-3.5" />
                            {rec.priceChangeCents !== 0 ? `${Math.abs(rec.priceChangePct).toFixed(0)}%` : "--"}
                          </span>
                        </TableCell>
                        <TableCell data-testid={`text-rec-current-margin-${rec.propertyId}`}>
                          <span className={rec.currentMarginPct >= 15 ? "text-green-600 dark:text-green-400" : rec.currentMarginPct >= 0 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}>
                            {rec.currentMarginPct.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell data-testid={`text-rec-projected-margin-${rec.propertyId}`}>
                          <span className={rec.projectedMarginPct >= 15 ? "text-green-600 dark:text-green-400" : rec.projectedMarginPct >= 0 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}>
                            {rec.projectedMarginPct.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell>{confidenceBadge(rec.confidence)}</TableCell>
                        <TableCell>{churnBadge(rec.churnRisk)}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {filteredRecs.map((rec) => {
            if (expandedPropertyId !== rec.propertyId) return null;
            const monthlyGain = rec.monthlyRevenueImpactCents;
            return (
              <div
                key={`detail-${rec.propertyId}`}
                className="border-t bg-muted/20 p-4 space-y-4"
                data-testid={`detail-panel-${rec.propertyId}`}
              >
                <div>
                  <h4 className="text-sm font-semibold mb-1">AI Reasoning</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed" data-testid={`text-detail-reasoning-${rec.propertyId}`}>
                    {rec.reasoning}
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">Current Price</p>
                    <p className="text-sm font-medium" data-testid={`text-detail-current-${rec.propertyId}`}>{formatDollars(rec.currentPriceCents)}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">AI Recommended</p>
                    <p className="text-sm font-medium text-primary" data-testid={`text-detail-ai-rec-${rec.propertyId}`}>{formatDollars(rec.aiRecommendedPriceCents)}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">Calculator Recommended</p>
                    <p className="text-sm font-medium" data-testid={`text-detail-calc-rec-${rec.propertyId}`}>{formatDollars(rec.calculatorRecommendedPriceCents)}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">Cost/Visit</p>
                    <p className="text-sm font-medium" data-testid={`text-detail-cost-${rec.propertyId}`}>{formatDollars(rec.costPerVisitCents)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">Monthly Impact</p>
                    <p className={`text-sm font-medium ${monthlyGain > 0 ? "text-green-600 dark:text-green-400" : monthlyGain < 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid={`text-detail-monthly-${rec.propertyId}`}>
                      {monthlyGain > 0 ? "+" : ""}{formatDollars(monthlyGain)}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">Annual Impact</p>
                    <p className={`text-sm font-medium ${rec.annualRevenueImpactCents > 0 ? "text-green-600 dark:text-green-400" : rec.annualRevenueImpactCents < 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid={`text-detail-annual-${rec.propertyId}`}>
                      {rec.annualRevenueImpactCents > 0 ? "+" : ""}{formatDollars(rec.annualRevenueImpactCents)}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">Frequency</p>
                    <p className="text-sm font-medium capitalize">{rec.frequency}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">Property</p>
                    <p className="text-sm font-medium">{rec.dogCount} dog{rec.dogCount !== 1 ? "s" : ""}, {(rec.yardSizeAcres * 43560).toFixed(0)} sqft</p>
                  </div>
                </div>

                {rec.churnRisk !== "low" && (
                  <div className={`p-3 rounded-lg border ${rec.churnRisk === "high" ? "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20" : "border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-950/20"}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <AlertTriangle className={`h-3.5 w-3.5 ${rec.churnRisk === "high" ? "text-red-500" : "text-yellow-500"}`} />
                      <span className="text-xs font-medium">Churn Risk: {rec.churnRisk}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{rec.churnRiskReason}</p>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/profitability/${rec.contactId}`);
                    }}
                    data-testid={`button-view-profitability-${rec.propertyId}`}
                  >
                    View Profitability
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/contacts/${rec.contactId}`);
                    }}
                    data-testid={`button-edit-plan-${rec.propertyId}`}
                  >
                    Edit Service Plan
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
