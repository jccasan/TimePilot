/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrency } from "@/hooks/use-currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  Users,
  TrendingUp,
  CheckCircle,
  Sparkles,
  Loader2,
  AlertTriangle,
  Minus,
  LayoutDashboard,
  ArrowUp,
  ArrowDown,
  Printer,
  RefreshCw,
  Clock,
  ThumbsUp,
  ThumbsDown,
  CalendarDays,
  StopCircle,
  Play,
  Repeat2,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

type BusinessOverviewData = {
  kpis: {
    mrrCents: number;
    activeCustomers: number;
    avgProfitMarginPct: number;
    collectionRate: number;
    visitCompletionRate: number;
    profitableCount: number;
    marginalCount: number;
    unprofitableCount: number;
  };
  monthlyRevenue: { month: string; revenue: number }[];
  customerAcquisition: { month: string; newClients: number; total: number }[];
  profitabilityMix: { name: string; value: number; color: string }[];
  weeklyCompletion: { week: string; completed: number; total: number; completionRate: number }[];
};

type ScoreBreakdownItem = {
  category: string;
  score: number;
  max: number;
  assessment: string;
};

type WhatIsWorkingItem = {
  name: string;
  observation: string;
  evidenceLabel: string;
  whyItMatters: string;
  recommendation: string;
};

type WhatIsNotWorkingItem = {
  name: string;
  problem: string;
  evidenceLabel: string;
  businessImpact: string;
  likelyRootCause: string;
  recommendedCorrection: string;
};

type OwnerDecisionItem = {
  decision: string;
  whyItMatters: string;
  recommendedAnswer: string;
  riskIfIgnored: string;
};

type Assessment = {
  healthScore: number;
  verdict: string;
  businessStage?: string;
  primaryServiceModel?: string;
  rating?: string;
  confidenceLevel?: string;
  executiveSummary?: {
    topThingsWorking: string[];
    topProblems: string[];
    topActionsFirst: string[];
    biggestRisk: string;
    fastestWayToImprove: string;
  };
  scoreBreakdown?: ScoreBreakdownItem[];
  whatIsWorking?: WhatIsWorkingItem[];
  whatIsNotWorking?: WhatIsNotWorkingItem[];
  routeOpsAssessment?: string;
  financialAssessment?: string;
  pricingAssessment?: string;
  marketingAssessment?: string;
  ownerDecisions?: OwnerDecisionItem[];
  actionPlan?: {
    next30: string[];
    days31to60: string[];
    days61to90: string[];
  };
  stopStartContinue?: {
    stop: string[];
    start: string[];
    continue: string[];
  };
  missingData?: string[];
  finalSummary?: string;
  cfo: { rating: string; findings: string[] };
  coo: { rating: string; findings: string[] };
  recommendations: { priority: string; title: string; explanation: string }[];
  scoreDelta: number | null;
  cachedAt?: string;
  fromCache?: boolean;
};

type AssessmentHistoryEntry = {
  id: string;
  companyId: string;
  score: number;
  verdict: string;
  createdAt: string;
};

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  colorClass,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: typeof DollarSign;
  colorClass?: string;
}) {
  return (
    <Card data-testid={`card-kpi-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <p
              className={`text-2xl font-bold ${colorClass ?? ""}`}
              data-testid={`text-kpi-${title.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {value}
            </p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="p-2 rounded-md bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartTooltipContent({ active, payload, label, prefix }: any) {
  const { formatMoney } = useCurrency();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-background p-2 shadow-md text-xs">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1">
            <span
              className="h-2 w-2 rounded-full inline-block"
              style={{ backgroundColor: entry.color }}
            />
            {entry.name}
          </span>
          <span className="font-medium">
            {prefix === "$" ? formatMoney(entry.value) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function ratingColor(rating: string) {
  if (rating === "Healthy")
    return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
  if (rating === "Caution")
    return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
  return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
}

function priorityColor(priority: string) {
  if (priority === "High") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
  if (priority === "Medium")
    return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
  return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
}

function HealthScoreRing({ score }: { score: number }) {
  const color = score >= 70 ? "#22c55e" : score >= 45 ? "#eab308" : "#ef4444";
  const circumference = 2 * Math.PI * 40;
  const dash = (score / 100) * circumference;
  return (
    <div
      className="relative inline-flex items-center justify-center"
      data-testid="health-score-ring"
    >
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-muted/20"
        />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="absolute text-center">
        <span className="text-2xl font-bold" style={{ color }} data-testid="text-health-score">
          {score}
        </span>
        <span className="block text-[10px] text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

export default function BusinessOverview() {
  const { formatMoney } = useCurrency();
  const fmtAxis = (n: number): string => {
    if (n >= 1000)
      return (
        formatMoney(n / 1000)
          .replace(/\.(\d)0$/, ".$1")
          .replace(/\.00$/, ".0") + "k"
      );
    return formatMoney(Math.round(n)).replace(/\.\d+$/, "");
  };
  const [assessmentKey, setAssessmentKey] = useState(0);
  const [hasRequestedAssessment, setHasRequestedAssessment] = useState(false);
  const [forceRefresh, setForceRefresh] = useState(false);

  const { data, isLoading } = useQuery<BusinessOverviewData>({
    queryKey: ["/api/business-overview"],
  });

  const {
    data: assessment,
    isLoading: isAssessmentLoading,
    isError: isAssessmentError,
  } = useQuery<Assessment>({
    queryKey: ["/api/business-overview/assessment", assessmentKey],
    queryFn: async () => {
      const url = forceRefresh
        ? "/api/business-overview/assessment?force=true"
        : "/api/business-overview/assessment";
      const res = await apiRequest("GET", url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load assessment");
      }
      const result = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/business-overview/assessment-history"] });
      return result;
    },
    enabled: hasRequestedAssessment,
    staleTime: Infinity,
    retry: false,
  });

  const { data: assessmentHistory } = useQuery<AssessmentHistoryEntry[]>({
    queryKey: ["/api/business-overview/assessment-history"],
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
        <div>
          <h1 className="text-2xl font-bold">Business Overview</h1>
          <p className="text-muted-foreground">Loading business data...</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { kpis, monthlyRevenue, customerAcquisition, profitabilityMix, weeklyCompletion } = data;
  const mrrDisplay =
    kpis.mrrCents >= 100000
      ? formatMoney(kpis.mrrCents / 100 / 1000)
          .replace(/\.(\d)0$/, ".$1")
          .replace(/\.00$/, ".0") + "k"
      : formatMoney(Math.round(kpis.mrrCents / 100)).replace(/\.\d+$/, "");

  const marginColor =
    kpis.avgProfitMarginPct >= 20
      ? "text-green-600 dark:text-green-400"
      : kpis.avgProfitMarginPct >= 10
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-red-600 dark:text-red-400";

  const completionColor =
    kpis.visitCompletionRate >= 90
      ? "text-green-600 dark:text-green-400"
      : kpis.visitCompletionRate >= 70
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-red-600 dark:text-red-400";

  const collectionColor =
    kpis.collectionRate >= 90
      ? "text-green-600 dark:text-green-400"
      : kpis.collectionRate >= 75
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-red-600 dark:text-red-400";

  function handlePrint() {
    window.print();
  }

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-auto h-full business-overview-print-area">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1
            className="text-2xl font-bold flex items-center gap-2"
            data-testid="text-business-overview-heading"
          >
            <LayoutDashboard className="h-6 w-6 text-primary" />
            Business Overview
          </h1>
          <p className="text-muted-foreground">
            Key metrics and AI-powered health assessment for your business
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrint}
          className="print:hidden"
          data-testid="button-print-report"
        >
          <Printer className="mr-1.5 h-4 w-4" />
          Print Report
        </Button>
      </div>
      <div
        className="print-report-meta text-xs text-muted-foreground pb-2 border-b"
        style={{ display: "none" }}
      >
        <span>ScooPilot — Business Overview Report</span>
        <span className="ml-4">
          Generated:{" "}
          {new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </span>
      </div>

      {/* KPI Scorecard */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          title="Monthly Recurring Revenue"
          value={mrrDisplay}
          subtitle="Active service plans"
          icon={DollarSign}
        />
        <KpiCard title="Active Customers" value={String(kpis.activeCustomers)} icon={Users} />
        <KpiCard
          title="Avg Profit Margin"
          value={`${kpis.avgProfitMarginPct.toFixed(1)}%`}
          subtitle={`${kpis.profitableCount} profitable`}
          icon={TrendingUp}
          colorClass={marginColor}
        />
        <KpiCard
          title="Invoice Collection Rate"
          value={`${kpis.collectionRate}%`}
          icon={DollarSign}
          colorClass={collectionColor}
        />
        <KpiCard
          title="Visit Completion Rate"
          value={`${kpis.visitCompletionRate}%`}
          subtitle="Last 30 days"
          icon={CheckCircle}
          colorClass={completionColor}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 12-Month Revenue */}
        <Card data-testid="card-chart-monthly-revenue">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">12-Month Revenue</CardTitle>
            <CardDescription>Monthly earned revenue over the past year</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={monthlyRevenue}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => fmtAxis(v)} tick={{ fontSize: 11 }} width={48} />
                <Tooltip content={<ChartTooltipContent prefix="$" />} />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="hsl(var(--chart-1))"
                  fill="url(#colorRev)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Customer Growth */}
        <Card data-testid="card-chart-customer-growth">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Customer Growth</CardTitle>
            <CardDescription>New and total customers over 12 months</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={customerAcquisition}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={36} />
                <Tooltip content={<ChartTooltipContent />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Total Customers"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="newClients"
                  name="New This Month"
                  stroke="hsl(var(--chart-2))"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Profitability Mix */}
        <Card data-testid="card-chart-profitability-mix">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Profitability Mix</CardTitle>
            <CardDescription>Customer distribution by profitability status</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-6">
            <ResponsiveContainer width="50%" height={200}>
              <PieChart>
                <Pie
                  data={profitabilityMix}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {profitabilityMix.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(val: number) => [`${val} customers`, ""]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 text-sm">
              {profitabilityMix.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2"
                  data-testid={`legend-${entry.name.toLowerCase()}`}
                >
                  <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: entry.color }} />
                  <span className="text-muted-foreground">{entry.name}</span>
                  <span className="font-semibold ml-auto">{entry.value}</span>
                </div>
              ))}
              <div className="pt-1 text-xs text-muted-foreground border-t">
                {kpis.profitableCount + kpis.marginalCount + kpis.unprofitableCount} total tracked
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Weekly Visit Completion */}
        <Card data-testid="card-chart-visit-completion">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Weekly Visit Completion</CardTitle>
            <CardDescription>Completion rate over last 8 weeks</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weeklyCompletion}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 11 }}
                  width={40}
                />
                <Tooltip
                  formatter={(val: number) => [`${val}%`, "Completion Rate"]}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0]?.payload;
                    return (
                      <div className="rounded-md border bg-background p-2 shadow-md text-xs">
                        <p className="font-medium mb-1">{label}</p>
                        <p>
                          {d?.completed} / {d?.total} visits — <strong>{d?.completionRate}%</strong>
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="completionRate"
                  name="Completion Rate"
                  fill="hsl(var(--chart-3))"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* AI Assessment Panel */}
      <Card data-testid="card-ai-assessment">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                AI Business Assessment
              </CardTitle>
              <CardDescription>
                CFO + COO dual-perspective health check powered by AI
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              {hasRequestedAssessment && assessment && !isAssessmentLoading && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setForceRefresh(true);
                    setAssessmentKey((k) => k + 1);
                  }}
                  disabled={isAssessmentLoading}
                  data-testid="button-force-rerun-assessment"
                  title="Force a fresh assessment, bypassing the cache"
                >
                  <RefreshCw className="mr-1 h-4 w-4" /> Re-run
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setForceRefresh(false);
                  if (!hasRequestedAssessment) {
                    setHasRequestedAssessment(true);
                  } else {
                    setAssessmentKey((k) => k + 1);
                  }
                }}
                disabled={isAssessmentLoading}
                data-testid="button-run-assessment"
              >
                {isAssessmentLoading ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Analyzing...
                  </>
                ) : hasRequestedAssessment && assessment ? (
                  <>
                    <Sparkles className="mr-1 h-4 w-4" /> Run Assessment
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1 h-4 w-4" /> Run AI Assessment
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!hasRequestedAssessment && (
            <div
              className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground gap-3"
              data-testid="assessment-idle"
            >
              <Sparkles className="h-8 w-8 text-primary/40" />
              <p className="text-sm max-w-sm">
                Click <strong>Run AI Assessment</strong> to get a detailed health score, CFO and COO
                findings, and prioritized recommendations for your business.
              </p>
            </div>
          )}

          {isAssessmentLoading && (
            <div className="space-y-4 py-4" data-testid="assessment-loading">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <Skeleton className="h-32" />
                <Skeleton className="h-32" />
              </div>
            </div>
          )}

          {isAssessmentError && !isAssessmentLoading && (
            <div
              className="flex items-center gap-2 text-destructive text-sm py-4"
              data-testid="assessment-error"
            >
              <AlertTriangle className="h-4 w-4" />
              Failed to load assessment. The AI service may be temporarily unavailable.
            </div>
          )}

          {assessment && !isAssessmentLoading && (
            <div className="space-y-6" data-testid="assessment-results">
              {/* Generated / Cached label */}
              {assessment.cachedAt && (
                <div
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  data-testid="text-cached-label"
                >
                  <Clock className="h-3.5 w-3.5" />
                  {assessment.fromCache ? "Cached result" : "Generated"} —{" "}
                  {new Date(assessment.cachedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}{" "}
                  at{" "}
                  {new Date(assessment.cachedAt).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {assessment.fromCache && (
                    <>
                      . Use <strong className="ml-1">Re-run</strong> to generate a fresh assessment.
                    </>
                  )}
                </div>
              )}

              {/* Health Score + Verdict */}
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex flex-col items-center gap-2">
                  <HealthScoreRing score={assessment.healthScore} />
                  {assessment.scoreDelta !== null && assessment.scoreDelta !== undefined && (
                    <div
                      className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                        assessment.scoreDelta > 0
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : assessment.scoreDelta < 0
                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            : "bg-muted text-muted-foreground"
                      }`}
                      data-testid="text-score-delta"
                    >
                      {assessment.scoreDelta > 0 ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : assessment.scoreDelta < 0 ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : (
                        <Minus className="h-3 w-3" />
                      )}
                      {assessment.scoreDelta > 0 ? "+" : ""}
                      {assessment.scoreDelta} pts from last month
                    </div>
                  )}
                  {assessment.rating && (
                    <Badge
                      variant="outline"
                      className={ratingColor(
                        assessment.rating === "Excellent" || assessment.rating === "Strong"
                          ? "Healthy"
                          : assessment.rating === "Good but uneven" ||
                              assessment.rating === "Viable but fragile"
                            ? "Caution"
                            : "Critical"
                      )}
                    >
                      {assessment.rating}
                    </Badge>
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-3">
                  {assessment.businessStage && (
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>
                        <strong>Stage:</strong> {assessment.businessStage}
                      </span>
                      {assessment.primaryServiceModel && (
                        <span>
                          <strong>Model:</strong> {assessment.primaryServiceModel}
                        </span>
                      )}
                      {assessment.confidenceLevel && (
                        <span>
                          <strong>Confidence:</strong> {assessment.confidenceLevel}
                        </span>
                      )}
                    </div>
                  )}
                  <p
                    className="text-sm text-muted-foreground leading-relaxed"
                    data-testid="text-verdict"
                  >
                    {assessment.verdict}
                  </p>
                  {assessmentHistory && assessmentHistory.length > 1 && (
                    <div data-testid="chart-score-history">
                      <p className="text-xs text-muted-foreground mb-1 font-medium">
                        Score History
                      </p>
                      <ResponsiveContainer width="100%" height={60}>
                        <LineChart
                          data={[...assessmentHistory].reverse().map((h) => ({
                            date: new Date(h.createdAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            }),
                            score: h.score,
                          }))}
                        >
                          <YAxis domain={[0, 100]} hide />
                          <Tooltip
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null;
                              return (
                                <div className="rounded-md border bg-background p-1.5 shadow-md text-xs">
                                  <p className="font-medium">{label}</p>
                                  <p>
                                    Score: <span className="font-bold">{payload[0].value}</span>
                                  </p>
                                </div>
                              );
                            }}
                          />
                          <Line
                            type="monotone"
                            dataKey="score"
                            stroke="#6366f1"
                            strokeWidth={2}
                            dot={{ r: 3, fill: "#6366f1" }}
                            activeDot={{ r: 4 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>

              {/* Score Breakdown Table */}
              {assessment.scoreBreakdown && assessment.scoreBreakdown.length > 0 && (
                <div data-testid="panel-score-breakdown">
                  <h3 className="text-sm font-semibold mb-2">Score Breakdown</h3>
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="text-left px-3 py-2 font-medium">Category</th>
                          <th className="text-right px-3 py-2 font-medium w-16">Score</th>
                          <th className="text-left px-3 py-2 font-medium hidden md:table-cell">
                            Assessment
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {assessment.scoreBreakdown.map((item, i) => (
                          <tr key={i} className="border-t" data-testid={`score-row-${i}`}>
                            <td className="px-3 py-2 font-medium text-foreground">
                              {item.category}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <span
                                className={`font-bold ${item.score / item.max >= 0.7 ? "text-green-600 dark:text-green-400" : item.score / item.max >= 0.5 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`}
                              >
                                {item.score}
                              </span>
                              <span className="text-muted-foreground">/{item.max}</span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">
                              {item.assessment}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* CFO + COO Panels */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {assessment.cfo && (
                  <div className="rounded-lg border p-4 space-y-2" data-testid="panel-cfo">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">CFO Perspective</h3>
                      <Badge variant="outline" className={ratingColor(assessment.cfo.rating)}>
                        {assessment.cfo.rating}
                      </Badge>
                    </div>
                    <ul className="space-y-1.5">
                      {assessment.cfo.findings.map((f, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-xs text-muted-foreground"
                          data-testid={`cfo-finding-${i}`}
                        >
                          <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary/60 flex-shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {assessment.coo && (
                  <div className="rounded-lg border p-4 space-y-2" data-testid="panel-coo">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">COO Perspective</h3>
                      <Badge variant="outline" className={ratingColor(assessment.coo.rating)}>
                        {assessment.coo.rating}
                      </Badge>
                    </div>
                    <ul className="space-y-1.5">
                      {assessment.coo.findings.map((f, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-xs text-muted-foreground"
                          data-testid={`coo-finding-${i}`}
                        >
                          <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary/60 flex-shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* What Is Working / What Is Not Working */}
              {assessment.whatIsWorking?.length || assessment.whatIsNotWorking?.length ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {assessment.whatIsWorking && assessment.whatIsWorking.length > 0 && (
                    <div className="space-y-2" data-testid="panel-what-working">
                      <h3 className="text-sm font-semibold flex items-center gap-1.5">
                        <ThumbsUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                        What Is Working
                      </h3>
                      <div className="space-y-2">
                        {assessment.whatIsWorking.map((item, i) => (
                          <div
                            key={i}
                            className="rounded-lg border p-3 space-y-1"
                            data-testid={`working-item-${i}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-semibold">{item.name}</p>
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 flex-shrink-0"
                              >
                                {item.evidenceLabel}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{item.observation}</p>
                            {item.whyItMatters && (
                              <p className="text-xs text-muted-foreground">
                                <strong>Why:</strong> {item.whyItMatters}
                              </p>
                            )}
                            <p className="text-xs text-green-600 dark:text-green-400 font-medium">
                              → {item.recommendation}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {assessment.whatIsNotWorking && assessment.whatIsNotWorking.length > 0 && (
                    <div className="space-y-2" data-testid="panel-what-not-working">
                      <h3 className="text-sm font-semibold flex items-center gap-1.5">
                        <ThumbsDown className="h-4 w-4 text-red-600 dark:text-red-400" />
                        What Is Not Working
                      </h3>
                      <div className="space-y-2">
                        {assessment.whatIsNotWorking.map((item, i) => (
                          <div
                            key={i}
                            className="rounded-lg border p-3 space-y-1"
                            data-testid={`not-working-item-${i}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-semibold">{item.name}</p>
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 flex-shrink-0"
                              >
                                {item.evidenceLabel}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{item.problem}</p>
                            {item.businessImpact && (
                              <p className="text-xs text-muted-foreground">
                                <strong>Impact:</strong> {item.businessImpact}
                              </p>
                            )}
                            <p className="text-xs text-primary font-medium">
                              → {item.recommendedCorrection}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {/* 30/60/90 Action Plan */}
              {assessment.actionPlan && (
                <div data-testid="panel-action-plan">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    30 / 60 / 90 Day Action Plan
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      {
                        label: "Next 30 Days",
                        items: assessment.actionPlan.next30,
                        color: "border-green-200 dark:border-green-800",
                      },
                      {
                        label: "Days 31–60",
                        items: assessment.actionPlan.days31to60,
                        color: "border-yellow-200 dark:border-yellow-800",
                      },
                      {
                        label: "Days 61–90",
                        items: assessment.actionPlan.days61to90,
                        color: "border-blue-200 dark:border-blue-800",
                      },
                    ].map((phase, pi) => (
                      <div
                        key={pi}
                        className={`rounded-lg border-2 ${phase.color} p-3 space-y-2`}
                        data-testid={`action-plan-phase-${pi}`}
                      >
                        <p className="text-xs font-semibold">{phase.label}</p>
                        <ul className="space-y-1.5">
                          {phase.items?.map((item, ii) => (
                            <li
                              key={ii}
                              className="flex items-start gap-1.5 text-xs text-muted-foreground"
                            >
                              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary/60 flex-shrink-0" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Stop / Start / Continue */}
              {assessment.stopStartContinue && (
                <div data-testid="panel-stop-start-continue">
                  <h3 className="text-sm font-semibold mb-3">Stop / Start / Continue</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      {
                        label: "Stop",
                        items: assessment.stopStartContinue.stop,
                        icon: StopCircle,
                        color: "text-red-600 dark:text-red-400",
                      },
                      {
                        label: "Start",
                        items: assessment.stopStartContinue.start,
                        icon: Play,
                        color: "text-green-600 dark:text-green-400",
                      },
                      {
                        label: "Continue",
                        items: assessment.stopStartContinue.continue,
                        icon: Repeat2,
                        color: "text-blue-600 dark:text-blue-400",
                      },
                    ].map((section, si) => (
                      <div
                        key={si}
                        className="rounded-lg border p-3 space-y-2"
                        data-testid={`ssc-${section.label.toLowerCase()}`}
                      >
                        <p
                          className={`text-xs font-semibold flex items-center gap-1.5 ${section.color}`}
                        >
                          <section.icon className="h-3.5 w-3.5" />
                          {section.label}
                        </p>
                        <ul className="space-y-1.5">
                          {section.items?.map((item, ii) => (
                            <li
                              key={ii}
                              className="text-xs text-muted-foreground flex items-start gap-1.5"
                            >
                              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-muted-foreground/40 flex-shrink-0" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {assessment.recommendations?.length > 0 && (
                <div className="space-y-2" data-testid="panel-recommendations">
                  <h3 className="text-sm font-semibold">Prioritized Recommendations</h3>
                  <div className="space-y-2">
                    {assessment.recommendations.map((rec, i) => (
                      <div
                        key={i}
                        className="rounded-lg border p-3 flex items-start gap-3"
                        data-testid={`recommendation-${i}`}
                      >
                        <Badge
                          variant="outline"
                          className={`${priorityColor(rec.priority)} text-[10px] mt-0.5 flex-shrink-0`}
                        >
                          {rec.priority}
                        </Badge>
                        <div>
                          <p className="text-sm font-medium">{rec.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{rec.explanation}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Final Owner Summary */}
              {assessment.finalSummary && (
                <div
                  className="rounded-lg bg-muted/50 border p-4"
                  data-testid="panel-final-summary"
                >
                  <h3 className="text-sm font-semibold mb-2">Final Owner Summary</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {assessment.finalSummary}
                  </p>
                </div>
              )}

              {/* Missing Data */}
              {assessment.missingData && assessment.missingData.length > 0 && (
                <div
                  className="rounded-lg border border-dashed p-3"
                  data-testid="panel-missing-data"
                >
                  <h3 className="text-xs font-semibold text-muted-foreground mb-1.5">
                    Data That Would Improve This Assessment
                  </h3>
                  <ul className="space-y-1">
                    {assessment.missingData.map((item, i) => (
                      <li
                        key={i}
                        className="text-xs text-muted-foreground flex items-start gap-1.5"
                      >
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-muted-foreground/40 flex-shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
