/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HorsemanCRM } from "@horseman/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Building2,
  Users,
  Contact2,
  CalendarCheck,
  DollarSign,
  ChevronRight,
  BarChart3,
  ArrowRight,
  AlertTriangle,
  Bug,
  Webhook,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Map,
  BrainCircuit,
  MessageSquare,
  ShieldCheck,
  Clock,
  Route,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";
import { BarChart, Bar, Tooltip, ResponsiveContainer, XAxis } from "recharts";
import { TIER_CONFIG } from "@shared/schema";
import { adminFetchFn, adminRequest } from "@/lib/adminApi";
import { useToast } from "@/hooks/use-toast";

const tierColors: Record<string, string> = {
  tier_starter: "bg-teal-100 text-teal-800 dark:bg-teal-800 dark:text-teal-200",
  tier_1: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  tier_1_3: "bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-200",
  tier_3_5: "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-200",
  tier_6_10: "bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-200",
  tier_10_plus: "bg-orange-100 text-orange-800 dark:bg-orange-800 dark:text-orange-200",
};

interface ProviderCostSummary {
  today: number;
  thisMonth: number;
  estimatedMonthlyCostUsd: number;
  dailyTrend: { date: string; calls: number }[];
  breakdown?: { metric: string; today: number; thisMonth: number; costPerCall: number }[];
}

interface AllApiCosts {
  mapbox: ProviderCostSummary;
  openai: ProviderCostSummary;
  telnyx: ProviderCostSummary;
  routific: ProviderCostSummary;
}

interface RoutificTenantStat {
  companyId: number | null;
  companyName: string;
  totalCalls: number;
  successCalls: number;
  fallbackCalls: number;
  avgStopCount: number;
  lastCallAt: string | null;
}

interface TenantUsageRow {
  companyId: string | null;
  companyName: string;
  totalCalls: number;
  estimatedCostUsd: number;
  firstActivity: string | null;
  lastActivity: string | null;
  dailyTrend: { date: string; calls: number }[];
}

interface BreakdownResponse {
  rows: TenantUsageRow[];
  attributionStartDate: string | null;
}

const METRIC_LABELS: Record<string, string> = {
  geocode: "Geocode",
  autocomplete: "Autocomplete",
  directions: "Directions",
  matrix: "Matrix",
  rover_chat: "Rover Chat",
};

function HorsemanCRMWidget() {
  const { data, isLoading, isError } = useQuery<{ token: string }>({
    queryKey: ["/api/admin/horseman-token"],
    queryFn: adminFetchFn("/api/admin/horseman-token"),
    staleTime: 4 * 60 * 1000,
  });

  if (isLoading) {
    return <div className="h-24 bg-muted rounded animate-pulse" />;
  }

  if (isError || !data?.token) {
    return (
      <p className="text-xs text-muted-foreground italic">
        Horseman CRM unavailable — could not obtain SSO token.
      </p>
    );
  }

  return (
    <HorsemanCRM
      baseUrl=""
      ssoToken={data.token}
      className="min-h-[120px] rounded-md"
      data-testid="horseman-crm-embed"
    />
  );
}

function CostSparkline({ data }: { data: { date: string; calls: number }[] }) {
  const last30 = data.slice(-30);
  if (last30.every((d) => d.calls === 0)) {
    return <p className="text-xs text-muted-foreground italic">No activity in last 30 days</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={40}>
      <BarChart data={last30} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <Bar
          dataKey="calls"
          fill="currentColor"
          className="text-primary/60"
          radius={[2, 2, 0, 0]}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as { date: string; calls: number };
            return (
              <div className="bg-popover border rounded px-2 py-1 text-xs shadow-md">
                <p className="font-medium">{d.date}</p>
                <p>{d.calls.toLocaleString()} calls</p>
              </div>
            );
          }}
        />
        <XAxis dataKey="date" hide />
      </BarChart>
    </ResponsiveContainer>
  );
}

function TenantBreakdownSheet({
  provider,
  title,
  unit,
  open,
  onClose,
}: {
  provider: string;
  title: string;
  unit: string;
  open: boolean;
  onClose: () => void;
}) {
  const [expandedTenant, setExpandedTenant] = useState<string | null>(null);

  const { data: breakdown, isLoading } = useQuery<BreakdownResponse>({
    queryKey: ["/api/admin/api-costs", provider, "breakdown"],
    queryFn: adminFetchFn(`/api/admin/api-costs/${provider}/breakdown`),
    enabled: open,
    staleTime: 60000,
  });

  const rows = breakdown?.rows;
  const attributionStartDate = breakdown?.attributionStartDate ?? null;
  const showAttributionNote = !!attributionStartDate;

  const totalCalls = rows?.reduce((s, r) => s + r.totalCalls, 0) ?? 0;
  const totalCost = rows?.reduce((s, r) => s + r.estimatedCostUsd, 0) ?? 0;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto"
        data-testid={`sheet-breakdown-${provider}`}
      >
        <SheetHeader className="mb-4">
          <SheetTitle>{title} — Per-Tenant Breakdown</SheetTitle>
          <SheetDescription>
            This month's usage attributed by tenant, sorted by volume.
          </SheetDescription>
        </SheetHeader>

        {showAttributionNote && (
          <div className="flex items-start gap-2 mb-4 p-3 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              {title} attribution available from <strong>{attributionStartDate}</strong> onward.
              Earlier usage shows as "Unattributed" — historical backfill is not feasible.
            </span>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 bg-muted rounded animate-pulse" />
            ))}
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <p className="text-sm">No usage data for this month yet.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3 px-1">
              <p className="text-xs text-muted-foreground">
                {rows.length} tenant{rows.length !== 1 ? "s" : ""} active this month
              </p>
              <p className="text-xs font-medium">
                Total: {totalCalls.toLocaleString()} {unit} · est. ${totalCost.toFixed(2)}
              </p>
            </div>

            <div className="space-y-2">
              {rows.map((row, idx) => {
                const key = row.companyId ?? `__null_${idx}`;
                const isExpanded = expandedTenant === key;
                const costStr =
                  row.estimatedCostUsd < 0.01 && row.estimatedCostUsd > 0
                    ? "<$0.01"
                    : `$${row.estimatedCostUsd.toFixed(2)}`;
                const isUnattributed = row.companyId === null;

                return (
                  <div
                    key={key}
                    className="border rounded-lg overflow-hidden"
                    data-testid={`breakdown-row-${idx}`}
                  >
                    <button
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                      onClick={() => setExpandedTenant(isExpanded ? null : key)}
                      data-testid={`breakdown-toggle-${idx}`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium truncate">{row.companyName}</p>
                            {isUnattributed && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                                pre-deploy
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {row.firstActivity && row.lastActivity
                              ? `${row.firstActivity} – ${row.lastActivity}`
                              : "—"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right">
                          <p className="text-sm font-semibold tabular-nums">
                            {row.totalCalls.toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground">{unit}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                            {costStr}
                          </p>
                          <p className="text-xs text-muted-foreground">est.</p>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t px-4 py-3 bg-muted/20">
                        <p className="text-xs font-medium text-muted-foreground mb-2">
                          Day-by-day usage this month
                        </p>
                        {row.dailyTrend.every((d) => d.calls === 0) ? (
                          <p className="text-xs text-muted-foreground italic">
                            No daily data available
                          </p>
                        ) : (
                          <>
                            <ResponsiveContainer width="100%" height={60}>
                              <BarChart
                                data={
                                  row.dailyTrend.filter((d) => d.calls > 0).length > 0
                                    ? row.dailyTrend
                                    : []
                                }
                                margin={{ top: 2, right: 0, left: 0, bottom: 0 }}
                              >
                                <Bar
                                  dataKey="calls"
                                  fill="currentColor"
                                  className="text-primary/60"
                                  radius={[2, 2, 0, 0]}
                                />
                                <Tooltip
                                  content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null;
                                    const d = payload[0].payload as {
                                      date: string;
                                      calls: number;
                                    };
                                    return (
                                      <div className="bg-popover border rounded px-2 py-1 text-xs shadow-md">
                                        <p className="font-medium">{d.date}</p>
                                        <p>
                                          {d.calls.toLocaleString()} {unit}
                                        </p>
                                      </div>
                                    );
                                  }}
                                />
                                <XAxis dataKey="date" hide />
                              </BarChart>
                            </ResponsiveContainer>
                            <div className="mt-2 max-h-40 overflow-y-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-muted-foreground border-b">
                                    <th className="text-left py-1">Date</th>
                                    <th className="text-right py-1">{unit}</th>
                                    {provider !== "mapbox" && (
                                      <th className="text-right py-1">Est. cost</th>
                                    )}
                                  </tr>
                                </thead>
                                <tbody>
                                  {row.dailyTrend
                                    .filter((d) => d.calls > 0)
                                    .reverse()
                                    .map((d) => {
                                      const dayCost =
                                        provider === "telnyx"
                                          ? d.calls * 0.005
                                          : provider === "openai"
                                            ? d.calls * 0.0001
                                            : null;
                                      return (
                                        <tr key={d.date} className="border-b border-muted">
                                          <td className="py-1">{d.date}</td>
                                          <td className="text-right py-1 tabular-nums">
                                            {d.calls.toLocaleString()}
                                          </td>
                                          {dayCost !== null && (
                                            <td className="text-right py-1 tabular-nums text-amber-600 dark:text-amber-400">
                                              ${dayCost.toFixed(3)}
                                            </td>
                                          )}
                                        </tr>
                                      );
                                    })}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ApiCostCard({
  title,
  provider: _provider,
  icon: Icon,
  iconColor,
  summary,
  unit,
  isLoading,
  testId,
  onClick,
}: {
  title: string;
  provider?: string;
  icon: React.ElementType;
  iconColor: string;
  summary: ProviderCostSummary | undefined;
  unit: string;
  isLoading: boolean;
  testId: string;
  onClick?: () => void;
}) {
  const cost = summary?.estimatedMonthlyCostUsd ?? 0;
  const costStr = cost < 0.01 && cost > 0 ? "<$0.01" : `$${cost.toFixed(2)}`;

  return (
    <Card
      data-testid={testId}
      className={onClick ? "hover-elevate cursor-pointer transition-shadow" : ""}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    >
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex items-center gap-2 mb-3">
          <div className={`p-1.5 rounded-md ${iconColor}`}>
            <Icon className="h-4 w-4" />
          </div>
          <p className="font-medium text-sm flex-1">{title}</p>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <div className="h-4 bg-muted rounded animate-pulse w-2/3" />
            <div className="h-4 bg-muted rounded animate-pulse w-1/2" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div>
                <p className="text-xs text-muted-foreground">Today</p>
                <p className="text-sm font-semibold" data-testid={`${testId}-today`}>
                  {(summary?.today ?? 0).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">{unit}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">This month</p>
                <p className="text-sm font-semibold" data-testid={`${testId}-month`}>
                  {(summary?.thisMonth ?? 0).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">{unit}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Est. cost</p>
                <p
                  className="text-sm font-semibold text-amber-600 dark:text-amber-400"
                  data-testid={`${testId}-cost`}
                >
                  {costStr}
                </p>
                <p className="text-xs text-muted-foreground">this month</p>
              </div>
            </div>

            {summary?.breakdown && summary.breakdown.length > 0 && (
              <div className="mb-3 space-y-1">
                {summary.breakdown.map((b) => (
                  <div key={b.metric} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {METRIC_LABELS[b.metric] ?? b.metric}
                    </span>
                    <span className="font-medium tabular-nums">
                      {b.thisMonth.toLocaleString()}{" "}
                      <span className="text-muted-foreground font-normal">
                        (${(b.thisMonth * b.costPerCall).toFixed(2)})
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div>
              <p className="text-xs text-muted-foreground mb-1">Last 30 days</p>
              {summary?.dailyTrend ? (
                <CostSparkline data={summary.dailyTrend} />
              ) : (
                <p className="text-xs text-muted-foreground italic">No data</p>
              )}
            </div>

            <p className="text-xs text-muted-foreground mt-2 italic">
              Estimates based on public pricing, before free-tier credits.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [drillDown, setDrillDown] = useState<{
    provider: string;
    title: string;
    unit: string;
  } | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery<{
    totalCompanies: number;
    totalUsers: number;
    totalContacts: number;
    totalVisits: number;
    mrr: number;
  }>({
    queryKey: ["/api/admin/stats"],
    queryFn: adminFetchFn("/api/admin/stats"),
  });

  const { data: companies } = useQuery<any[]>({
    queryKey: ["/api/admin/companies"],
    queryFn: adminFetchFn("/api/admin/companies"),
  });

  const { data: inactiveUsers } = useQuery<Record<string, any[]>>({
    queryKey: ["/api/admin/inactive-users"],
    queryFn: adminFetchFn("/api/admin/inactive-users"),
  });

  const { data: errorStats } = useQuery<{ openCount: number; latestTimestamp: string | null }>({
    queryKey: ["/api/admin/error-reports/stats"],
    queryFn: adminFetchFn("/api/admin/error-reports/stats"),
    refetchInterval: 60000,
  });

  const { data: webhookStatus } = useQuery<{
    configured: boolean;
    agentId?: string;
    registeredUrl?: string | null;
    expectedUrl?: string | null;
    inSync?: boolean;
    fetchError?: string | null;
    reason?: string;
  }>({
    queryKey: ["/api/admin/retell/webhook-status"],
    queryFn: adminFetchFn("/api/admin/retell/webhook-status"),
    refetchInterval: 120000,
  });

  const { data: apiCosts, isLoading: costsLoading } = useQuery<AllApiCosts>({
    queryKey: ["/api/admin/api-costs"],
    queryFn: adminFetchFn("/api/admin/api-costs"),
    refetchInterval: 300000,
  });

  const { data: routificTenantStats, isLoading: routificTenantLoading } = useQuery<
    RoutificTenantStat[]
  >({
    queryKey: ["/api/admin/routific-tenant-stats"],
    queryFn: adminFetchFn("/api/admin/routific-tenant-stats"),
    refetchInterval: 300000,
  });

  const { data: healthChecks, isLoading: healthLoading } = useQuery<
    {
      checkName: string;
      status: string;
      severity: string;
      message: string;
      lastRunAt: string;
    }[]
  >({
    queryKey: ["/api/admin/system-health"],
    queryFn: adminFetchFn("/api/admin/system-health"),
    refetchInterval: 300000,
  });

  const syncWebhookMutation = useMutation({
    mutationFn: async () => {
      const res = await adminRequest("POST", "/api/admin/retell/sync-webhook");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Webhook synced",
        description: "The Retell webhook URL has been updated successfully.",
      });
      qc.invalidateQueries({ queryKey: ["/api/admin/retell/webhook-status"] });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const recentTenants = (companies || [])
    .sort(
      (a: any, b: any) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    )
    .slice(0, 5);

  const statCards = [
    { label: "Total Tenants", value: stats?.totalCompanies ?? 0, icon: Building2 },
    { label: "Total Users", value: stats?.totalUsers ?? 0, icon: Users },
    { label: "Total Contacts", value: stats?.totalContacts ?? 0, icon: Contact2 },
    { label: "Total Visits", value: stats?.totalVisits ?? 0, icon: CalendarCheck },
    { label: "Platform MRR", value: `$${(stats?.mrr ?? 0).toFixed(2)}`, icon: DollarSign },
  ];

  const costCardDefs = [
    {
      provider: "mapbox",
      title: "Mapbox",
      icon: Map,
      iconColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
      summary: apiCosts?.mapbox,
      unit: "calls",
      testId: "card-api-cost-mapbox",
    },
    {
      provider: "openai",
      title: "OpenAI (Rover AI)",
      icon: BrainCircuit,
      iconColor: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
      summary: apiCosts?.openai,
      unit: "calls",
      testId: "card-api-cost-openai",
    },
    {
      provider: "telnyx",
      title: "Telnyx SMS",
      icon: MessageSquare,
      iconColor: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
      summary: apiCosts?.telnyx,
      unit: "segments",
      testId: "card-api-cost-telnyx",
    },
  ];

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto" data-testid="admin-dashboard">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-admin-title">
          Platform Overview
        </h1>
        <p className="text-muted-foreground text-sm mt-1">ScooPilot administration at a glance</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <s.icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <p
                className="text-xl font-bold"
                data-testid={`text-stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}
              >
                {statsLoading ? "..." : s.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Link href="/admin/errors">
        <Card
          className={`hover-elevate cursor-pointer ${(errorStats?.openCount ?? 0) > 0 ? "border-red-300 dark:border-red-800 bg-red-50/30 dark:bg-red-950/10" : ""}`}
          data-testid="card-system-errors"
        >
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-lg ${(errorStats?.openCount ?? 0) > 0 ? "bg-red-100 dark:bg-red-900/40" : "bg-muted"}`}
                >
                  <Bug
                    className={`h-5 w-5 ${(errorStats?.openCount ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
                  />
                </div>
                <div>
                  <p className="font-medium text-sm">System Errors</p>
                  <p className="text-sm text-muted-foreground">
                    {errorStats == null
                      ? "Loading..."
                      : errorStats.openCount === 0
                        ? "No open errors"
                        : `${errorStats.openCount} open error${errorStats.openCount !== 1 ? "s" : ""}`}
                  </p>
                  {errorStats?.latestTimestamp && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Latest:{" "}
                      {new Date(errorStats.latestTimestamp).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(errorStats?.openCount ?? 0) > 0 && (
                  <Badge
                    className="bg-red-500 text-white hover:bg-red-600"
                    data-testid="badge-open-errors"
                  >
                    {errorStats!.openCount}
                  </Badge>
                )}
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>

      {webhookStatus && webhookStatus.configured && (
        <Card
          className={`${webhookStatus.inSync === false ? "border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-950/10" : ""}`}
          data-testid="card-retell-webhook-status"
        >
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3">
                <div
                  className={`p-2 rounded-lg ${webhookStatus.inSync ? "bg-green-100 dark:bg-green-900/40" : "bg-amber-100 dark:bg-amber-900/40"}`}
                >
                  <Webhook
                    className={`h-5 w-5 ${webhookStatus.inSync ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">Retell Webhook</p>
                    {webhookStatus.inSync !== undefined &&
                      (webhookStatus.inSync ? (
                        <CheckCircle2
                          className="h-4 w-4 text-green-600 dark:text-green-400"
                          data-testid="icon-webhook-in-sync"
                        />
                      ) : (
                        <XCircle
                          className="h-4 w-4 text-amber-600 dark:text-amber-400"
                          data-testid="icon-webhook-out-of-sync"
                        />
                      ))}
                    <span
                      className="text-xs text-muted-foreground"
                      data-testid="text-retell-platform-only"
                    >
                      Platform agent only — tenant agents are managed per-company.
                    </span>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {webhookStatus.fetchError ? (
                      <p
                        className="text-xs text-amber-700 dark:text-amber-400"
                        data-testid="text-webhook-fetch-error"
                      >
                        Could not reach Retell API: {webhookStatus.fetchError}
                      </p>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">Registered:</span>{" "}
                          <span data-testid="text-registered-url">
                            {webhookStatus.registeredUrl || "—"}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">Expected:</span>{" "}
                          <span data-testid="text-expected-url">
                            {webhookStatus.expectedUrl || "—"}
                          </span>
                        </p>
                        {webhookStatus.inSync === false && (
                          <p
                            className="text-xs text-amber-700 dark:text-amber-400 font-medium mt-1"
                            data-testid="text-webhook-mismatch"
                          >
                            URL mismatch — re-sync to update the Retell agent
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
              {webhookStatus.configured && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncWebhookMutation.mutate()}
                  disabled={syncWebhookMutation.isPending}
                  data-testid="button-sync-retell-webhook"
                  className="shrink-0"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 mr-1.5 ${syncWebhookMutation.isPending ? "animate-spin" : ""}`}
                  />
                  {syncWebhookMutation.isPending ? "Syncing…" : "Sync Webhook"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Link href="/admin/tenants">
          <Card className="hover-elevate cursor-pointer h-full" data-testid="card-quick-tenants">
            <CardContent className="pt-5 pb-4 px-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Manage Tenants</p>
                  <p className="text-sm text-muted-foreground">
                    View, create, and manage tenant accounts
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/analytics">
          <Card className="hover-elevate cursor-pointer h-full" data-testid="card-quick-analytics">
            <CardContent className="pt-5 pb-4 px-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <BarChart3 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Platform Analytics</p>
                  <p className="text-sm text-muted-foreground">
                    Revenue metrics, churn, and growth trends
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>

      <div data-testid="section-api-costs">
        <div className="mb-3">
          <h2 className="text-lg font-semibold">API Cost Monitor</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Platform-wide usage and estimated spend — click a card to see per-tenant detail
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {costCardDefs.map((def) => (
            <ApiCostCard
              key={def.provider}
              provider={def.provider}
              title={def.title}
              icon={def.icon}
              iconColor={def.iconColor}
              summary={def.summary}
              unit={def.unit}
              isLoading={costsLoading}
              testId={def.testId}
              onClick={() =>
                setDrillDown({ provider: def.provider, title: def.title, unit: def.unit })
              }
            />
          ))}
          <ApiCostCard
            title="Routific"
            icon={Route}
            iconColor="bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400"
            summary={apiCosts?.routific}
            unit="calls"
            isLoading={costsLoading}
            testId="card-api-cost-routific"
          />
        </div>

        <div className="mt-4" data-testid="section-routific-tenant-usage">
          <h3 className="text-sm font-semibold mb-2">Routific — Tenant Breakdown (last 30 days)</h3>
          {routificTenantLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : !routificTenantStats || routificTenantStats.length === 0 ? (
            <Card>
              <CardContent className="py-4 text-center text-muted-foreground">
                <TrendingDown className="h-5 w-5 mx-auto mb-1 opacity-40" />
                <p className="text-sm">No Routific calls recorded in the last 30 days</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-routific-tenants">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="px-4 py-2 font-medium text-muted-foreground">Tenant</th>
                        <th className="px-4 py-2 font-medium text-muted-foreground text-right">
                          Total
                        </th>
                        <th className="px-4 py-2 font-medium text-muted-foreground text-right">
                          Success
                        </th>
                        <th className="px-4 py-2 font-medium text-muted-foreground text-right">
                          Fallback
                        </th>
                        <th className="px-4 py-2 font-medium text-muted-foreground text-right">
                          Avg stops
                        </th>
                        <th className="px-4 py-2 font-medium text-muted-foreground text-right">
                          Est. cost
                        </th>
                        <th className="px-4 py-2 font-medium text-muted-foreground">Last call</th>
                      </tr>
                    </thead>
                    <tbody>
                      {routificTenantStats.map((stat, i) => (
                        <tr
                          key={stat.companyId ?? i}
                          className="border-b last:border-0 hover:bg-muted/40 transition-colors"
                          data-testid={`row-routific-tenant-${stat.companyId ?? i}`}
                        >
                          <td className="px-4 py-2 font-medium">{stat.companyName}</td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {stat.totalCalls.toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-green-700 dark:text-green-400">
                            {stat.successCalls.toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">
                            {stat.fallbackCalls.toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{stat.avgStopCount}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">
                            ${(stat.totalCalls * 0.25).toFixed(2)}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground text-xs">
                            {stat.lastCallAt ? new Date(stat.lastCallAt).toLocaleDateString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {drillDown && (
        <TenantBreakdownSheet
          provider={drillDown.provider}
          title={drillDown.title}
          unit={drillDown.unit}
          open={true}
          onClose={() => setDrillDown(null)}
        />
      )}

      <div data-testid="section-system-health">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">System Health</h2>
          {healthChecks &&
            healthChecks.length > 0 &&
            (() => {
              const issues = healthChecks.filter((c) => c.status !== "pass");
              return issues.length === 0 ? (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                  All OK
                </Badge>
              ) : (
                <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                  {issues.length} issue{issues.length !== 1 ? "s" : ""}
                </Badge>
              );
            })()}
        </div>
        {healthLoading ? (
          <div className="grid md:grid-cols-2 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 bg-muted rounded animate-pulse" />
            ))}
          </div>
        ) : !healthChecks || healthChecks.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground">
              <Clock className="h-6 w-6 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No health check results yet — runs 30 seconds after startup</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-2">
            {[...healthChecks]
              .sort((a, b) => {
                const st = { fail: 0, warn: 1, pass: 2 };
                const sSt =
                  (st[a.status as keyof typeof st] ?? 9) - (st[b.status as keyof typeof st] ?? 9);
                if (sSt !== 0) return sSt;
                const sev = { critical: 0, high: 1, medium: 2, low: 3 };
                const sSev =
                  (sev[a.severity as keyof typeof sev] ?? 9) -
                  (sev[b.severity as keyof typeof sev] ?? 9);
                if (sSev !== 0) return sSev;
                return a.checkName.localeCompare(b.checkName);
              })
              .map((check) => {
                const statusConfig = {
                  pass: {
                    icon: CheckCircle2,
                    color: "text-green-600 dark:text-green-400",
                    bg: "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800",
                  },
                  warn: {
                    icon: AlertTriangle,
                    color: "text-amber-600 dark:text-amber-400",
                    bg: "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800",
                  },
                  fail: {
                    icon: XCircle,
                    color: "text-red-600 dark:text-red-400",
                    bg: "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800",
                  },
                }[check.status] ?? { icon: AlertTriangle, color: "text-muted-foreground", bg: "" };
                const severityColors: Record<string, string> = {
                  critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
                  high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
                  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
                  low: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
                };
                const StatusIcon = statusConfig.icon;
                const ago = Math.round((Date.now() - new Date(check.lastRunAt).getTime()) / 60000);
                const agoStr = ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
                return (
                  <div
                    key={check.checkName}
                    className={`flex items-start gap-3 p-3 rounded-lg border ${statusConfig.bg}`}
                    data-testid={`health-check-${check.checkName}`}
                  >
                    <StatusIcon className={`h-4 w-4 mt-0.5 shrink-0 ${statusConfig.color}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-medium">{check.checkName}</span>
                        <Badge
                          className={`text-[10px] py-0 px-1.5 ${
                            check.status === "pass"
                              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                              : check.status === "warn"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                                : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                          }`}
                        >
                          {check.status.toUpperCase()}
                        </Badge>
                        <Badge
                          className={`text-[10px] py-0 px-1.5 ${severityColors[check.severity] ?? ""}`}
                        >
                          {check.severity}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                        {check.message}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                      {agoStr}
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {inactiveUsers && Object.values(inactiveUsers).some((arr) => arr.length > 0) && (
        <Card
          className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20"
          data-testid="card-inactive-users-alert"
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Inactive Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                {
                  key: "3d",
                  label: "3+ days",
                  color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
                },
                {
                  key: "5d",
                  label: "5+ days",
                  color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
                },
                {
                  key: "7d",
                  label: "7+ days",
                  color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
                },
                {
                  key: "14d",
                  label: "14+ days",
                  color: "bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-200",
                },
              ].map((tier) => {
                const count = inactiveUsers[tier.key]?.length || 0;
                return (
                  <div
                    key={tier.key}
                    className="flex items-center justify-between p-3 rounded-lg border bg-background"
                    data-testid={`stat-inactive-${tier.key}`}
                  >
                    <div>
                      <p className="text-xs text-muted-foreground">No login</p>
                      <p className="text-sm font-medium">{tier.label}</p>
                    </div>
                    <Badge className={tier.color}>{count}</Badge>
                  </div>
                );
              })}
            </div>
            {(() => {
              const worst = inactiveUsers["14d"] || [];
              if (worst.length === 0) return null;
              return (
                <div className="mt-3 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    14+ day inactive users:
                  </p>
                  {worst.slice(0, 5).map((u: any) => (
                    <Link key={u.userId} href={`/admin/companies/${u.companyId}`}>
                      <div
                        className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-muted cursor-pointer"
                        data-testid={`row-inactive-${u.userId}`}
                      >
                        <span className="truncate">
                          {u.firstName} {u.lastName} ({u.email})
                        </span>
                        <span className="text-muted-foreground shrink-0 ml-2">
                          {u.companyName} -{" "}
                          {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}
                        </span>
                      </div>
                    </Link>
                  ))}
                  {worst.length > 5 && (
                    <p className="text-xs text-muted-foreground">+{worst.length - 5} more</p>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      <div data-testid="section-horseman-crm">
        <h2 className="text-lg font-semibold mb-3">Horseman CRM</h2>
        <Card>
          <CardContent className="pt-4 pb-4 px-4">
            <HorsemanCRMWidget />
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Recent Tenants</h2>
          <Link
            href="/admin/tenants"
            className="text-sm text-primary hover:underline"
            data-testid="link-view-all-tenants"
          >
            View all
          </Link>
        </div>
        {recentTenants.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Building2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No tenants yet</p>
              <Link
                href="/admin/tenants"
                className="text-sm text-primary hover:underline mt-1 inline-block"
                data-testid="link-add-first-tenant"
              >
                Add your first tenant
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentTenants.map((c: any) => {
              const tierConfig = TIER_CONFIG[c.subscriptionTier as keyof typeof TIER_CONFIG];
              return (
                <Link key={c.id} href={`/admin/companies/${c.id}`}>
                  <Card
                    className="hover-elevate cursor-pointer"
                    data-testid={`card-recent-${c.id}`}
                  >
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium truncate">{c.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {c.email || c.id}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <Badge className={tierColors[c.subscriptionTier] || ""}>
                            {tierConfig?.name || c.subscriptionTier}
                          </Badge>
                          <Badge variant="outline">{c.subscriptionStatus}</Badge>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
