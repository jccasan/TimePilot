import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DollarSign, CalendarCheck, AlertTriangle, UserCheck,
  Plus, Eye, Users, ClipboardList, TrendingUp,
  FileText, Clock,
  MessageSquare, Mail, Sliders, ChevronUp, ChevronDown,
  CheckCircle, XCircle, MapPin,
} from "lucide-react";
import { TIER_CONFIG } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import GuidedSetup from "@/components/guided-setup";

type OnboardingStatus = {
  isComplete: boolean;
  steps: { key: string; label: string; completed: boolean }[];
  firstContact: { id: string; firstName: string; lastName: string } | null;
  firstProperty: {
    id: string;
    streetAddress: string;
    city: string;
    state: string;
    yardSize: string;
    numberOfDogs: number;
    measuredYardSqft: number | null;
  } | null;
  firstServicePlan: { id: string; routeId: string | null } | null;
};

type CompanyStats = {
  mrr: number;
  todaysVisits: number;
  todaysVisitBreakdown: { completed: number; scheduled: number; inProgress: number };
  failedPayments: number;
  overdueInvoices: number;
  activeUsers: number;
  activeContacts: number;
  activeServicePlans: number;
  monthRevenue: number;
  smsCountThisMonth: number;
  emailCountThisMonth: number;
  subscriptionTier: string;
  tierName: string;
};

type CompanyData = {
  id: string;
  dashboardLayout?: string[] | null;
  [key: string]: unknown;
};

type PipelineVisit = {
  id: string;
  status: string;
  scheduledDate: string;
  contactName: string;
  contactId: string;
  propertyAddress: string;
  servicePlanName: string;
  amount: number;
  completedAt: string | null;
  startedAt: string | null;
};

type PipelineData = {
  activePlans: { count: number; monthlyValue: number };
  scheduledVisits: { count: number };
  requiresInvoicing: { count: number; totalDollars: number };
  awaitingPayment: { count: number; totalDollars: number };
  todaysVisits: PipelineVisit[];
  receivables: {
    total: number;
    overdueCount: number;
    overdueTotal: number;
    topClients: { contactId: string; contactName: string; total: number }[];
  };
  monthRevenue: number;
  upcomingThisWeek: { count: number; totalDollars: number };
};

const ALL_WIDGETS = [
  { id: "mrr", label: "Monthly Revenue (MRR)" },
  { id: "month_revenue", label: "Revenue This Month" },
  { id: "requires_invoicing", label: "Requires Invoicing" },
  { id: "overdue_invoices", label: "Overdue Invoices" },
  { id: "todays_visits", label: "Today's Visits" },
  { id: "active_clients", label: "Active Clients" },
  { id: "service_plans", label: "Service Plans" },
  { id: "team_size", label: "Team Size" },
  { id: "texts_sent", label: "SMS Sent" },
  { id: "emails_sent", label: "Emails Sent" },
  { id: "quick_actions", label: "Quick Actions" },
] as const;

const DEFAULT_ORDER = ALL_WIDGETS.map((w) => w.id);

function PipelineBar({ data }: { data: PipelineData }) {
  const stages = [
    {
      label: "Active Plans",
      count: data.activePlans.count,
      value: `$${data.activePlans.monthlyValue.toFixed(0)}/mo`,
      href: "/contacts",
      color: "bg-green-600 dark:bg-green-700",
      textColor: "text-green-700 dark:text-green-400",
      bgColor: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800",
    },
    {
      label: "Scheduled This Week",
      count: data.scheduledVisits.count,
      value: `${data.scheduledVisits.count} visits`,
      href: "/scheduling",
      color: "bg-emerald-600 dark:bg-emerald-700",
      textColor: "text-emerald-700 dark:text-emerald-400",
      bgColor: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800",
    },
    {
      label: "Requires Invoicing",
      count: data.requiresInvoicing.count,
      value: data.requiresInvoicing.count > 0 ? `$${data.requiresInvoicing.totalDollars.toFixed(2)}` : "All clear",
      href: "/invoices",
      color: data.requiresInvoicing.count > 0 ? "bg-orange-500 dark:bg-orange-600" : "bg-green-600 dark:bg-green-700",
      textColor: data.requiresInvoicing.count > 0 ? "text-orange-700 dark:text-orange-400" : "text-green-700 dark:text-green-400",
      bgColor: data.requiresInvoicing.count > 0
        ? "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800"
        : "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800",
    },
    {
      label: "Awaiting Payment",
      count: data.awaitingPayment.count,
      value: data.awaitingPayment.count > 0 ? `$${data.awaitingPayment.totalDollars.toFixed(2)}` : "None",
      href: "/invoices",
      color: data.awaitingPayment.count > 0 ? "bg-amber-500 dark:bg-amber-600" : "bg-green-600 dark:bg-green-700",
      textColor: data.awaitingPayment.count > 0 ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400",
      bgColor: data.awaitingPayment.count > 0
        ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
        : "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800",
    },
  ];

  const total = stages.reduce((s, st) => s + Math.max(st.count, 1), 0);

  return (
    <div data-testid="pipeline-bar" className="space-y-2">
      <div className="flex rounded-lg overflow-hidden h-3 bg-muted">
        {stages.map((stage, i) => (
          <Link key={i} href={stage.href}>
            <div
              className={`h-full ${stage.color} transition-all hover:opacity-80 cursor-pointer`}
              style={{ width: `${Math.max((Math.max(stage.count, 1) / total) * 100, 10)}%` }}
              title={`${stage.label}: ${stage.count}`}
            />
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
        {stages.map((stage, i) => (
          <Link key={i} href={stage.href}>
            <div
              className={`p-3 rounded-lg border cursor-pointer hover:shadow-sm transition-shadow ${stage.bgColor}`}
              data-testid={`pipeline-stage-${i}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <div className={`w-2 h-2 rounded-full ${stage.color}`} />
                <span className="text-xs font-medium text-muted-foreground">{stage.label}</span>
              </div>
              <div className={`text-lg font-bold ${stage.textColor}`}>{stage.count}</div>
              <div className="text-xs text-muted-foreground">{stage.value}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

type OperationalGroup = "overdue" | "active" | "remaining" | "completed" | "skipped";

const groupOrder: OperationalGroup[] = ["overdue", "active", "remaining", "completed", "skipped"];

const groupLabels: Record<OperationalGroup, string> = {
  overdue: "Overdue",
  active: "Active",
  remaining: "Remaining",
  completed: "Completed",
  skipped: "Skipped",
};

const groupColors: Record<OperationalGroup, string> = {
  overdue: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  remaining: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  skipped: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

function deriveGroup(visit: PipelineVisit): OperationalGroup {
  if (visit.status === "completed") return "completed";
  if (visit.status === "skipped" || visit.status === "cancelled") return "skipped";
  if (visit.status === "in_progress") return "active";
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  if (visit.scheduledDate < today) return "overdue";
  if (visit.scheduledDate === today && now.getHours() >= 17) return "overdue";
  return "remaining";
}

function formatVisitTime(visit: PipelineVisit): string {
  if (visit.startedAt) {
    const d = new Date(visit.startedAt);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (visit.completedAt) {
    const d = new Date(visit.completedAt);
    return `Done ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  return "Scheduled";
}

function TodaysAppointments({ visits }: { visits: PipelineVisit[] }) {
  const { toast } = useToast();

  const markVisitMutation = useMutation({
    mutationFn: async ({ visitId, status }: { visitId: string; status: string }) => {
      const body: Record<string, unknown> = { status };
      if (status === "completed") body.completedAt = new Date().toISOString();
      await apiRequest("PATCH", `/api/visits/${visitId}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/uninvoiced-summary"] });
      toast({ title: "Visit updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const grouped = useMemo(() => {
    const groups = new Map<OperationalGroup, PipelineVisit[]>();
    for (const v of visits) {
      const group = deriveGroup(v);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(v);
    }
    const sorted = new Map<OperationalGroup, PipelineVisit[]>();
    for (const g of groupOrder) {
      if (groups.has(g)) sorted.set(g, groups.get(g)!);
    }
    return sorted;
  }, [visits]);

  if (visits.length === 0) {
    return (
      <Card data-testid="card-todays-appointments">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarCheck className="h-5 w-5" />
            Today's Appointments
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-muted-foreground" data-testid="text-no-appointments">
            <CalendarCheck className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p>No visits scheduled for today</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const completedCount = visits.filter(v => v.status === "completed").length;
  const progress = Math.round((completedCount / visits.length) * 100);

  return (
    <Card data-testid="card-todays-appointments">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarCheck className="h-5 w-5" />
            Today's Appointments
          </CardTitle>
          <Badge variant="secondary" className="text-xs" data-testid="badge-visit-progress">
            {completedCount}/{visits.length} done
          </Badge>
        </div>
        <Progress value={progress} className="h-2 mt-2" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from(grouped.entries()).map(([group, groupVisits]) => (
          <div key={group} data-testid={`group-${group}`}>
            <div className="flex items-center gap-2 mb-1.5">
              <Badge variant="secondary" className={`text-[10px] ${groupColors[group]}`}>
                {groupLabels[group]}
              </Badge>
              <span className="text-xs text-muted-foreground">({groupVisits.length})</span>
            </div>
            <div className="space-y-1">
              {groupVisits.map((visit) => (
                <div
                  key={visit.id}
                  className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                  data-testid={`visit-row-${visit.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Link href={`/contacts/${visit.contactId}`}>
                        <span className="text-sm font-medium hover:underline cursor-pointer" data-testid={`text-visit-contact-${visit.id}`}>
                          {visit.contactName}
                        </span>
                      </Link>
                      <span className="text-xs text-muted-foreground" data-testid={`text-visit-time-${visit.id}`}>
                        {formatVisitTime(visit)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{visit.propertyAddress || visit.servicePlanName}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-medium tabular-nums" data-testid={`text-visit-amount-${visit.id}`}>
                      ${visit.amount.toFixed(2)}
                    </span>
                    {(visit.status === "scheduled" || visit.status === "in_progress") && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
                          onClick={() => markVisitMutation.mutate({ visitId: visit.id, status: "completed" })}
                          disabled={markVisitMutation.isPending}
                          title="Mark complete"
                          data-testid={`button-complete-visit-${visit.id}`}
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                          onClick={() => markVisitMutation.mutate({ visitId: visit.id, status: "skipped" })}
                          disabled={markVisitMutation.isPending}
                          title="Skip"
                          data-testid={`button-skip-visit-${visit.id}`}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function BusinessPerformance({ data }: { data: PipelineData }) {
  return (
    <div className="space-y-4" data-testid="section-business-performance">
      <Card data-testid="card-receivables">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Receivables
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="text-2xl font-bold" data-testid="text-total-receivables">
              ${data.receivables.total.toFixed(2)}
            </div>
            {data.receivables.overdueCount > 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5" data-testid="text-overdue-receivables">
                ${data.receivables.overdueTotal.toFixed(2)} overdue ({data.receivables.overdueCount} invoice{data.receivables.overdueCount !== 1 ? "s" : ""})
              </p>
            )}
          </div>
          {data.receivables.topClients.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t">
              <p className="text-xs text-muted-foreground font-medium">Top Balances</p>
              {data.receivables.topClients.map((client) => (
                <Link key={client.contactId} href={`/contacts/${client.contactId}`}>
                  <div
                    className="flex items-center justify-between gap-2 text-sm py-1 hover:bg-muted/50 rounded px-1 cursor-pointer"
                    data-testid={`receivable-client-${client.contactId}`}
                  >
                    <span className="truncate">{client.contactName}</span>
                    <span className="font-medium tabular-nums shrink-0">${client.total.toFixed(2)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-month-revenue">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Revenue This Month
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-month-revenue-sidebar">
            ${data.monthRevenue.toFixed(2)}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-upcoming-week">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <CalendarCheck className="h-4 w-4" />
            Upcoming This Week
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-upcoming-count">
            {data.upcomingThisWeek.count}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            ${data.upcomingThisWeek.totalDollars.toFixed(2)} in scheduled work
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [editLayout, setEditLayout] = useState<string[]>([]);
  const [editEnabled, setEditEnabled] = useState<Set<string>>(new Set());

  const { data: stats, isLoading } = useQuery<CompanyStats>({
    queryKey: ["/api/company/stats"],
  });

  const { data: onboarding } = useQuery<OnboardingStatus>({
    queryKey: ["/api/onboarding/status"],
  });

  const { data: company } = useQuery<CompanyData>({
    queryKey: ["/api/company"],
  });

  const { data: pipeline, isLoading: pipelineLoading, isError: pipelineError } = useQuery<PipelineData>({
    queryKey: ["/api/company/pipeline"],
  });

  const saveMutation = useMutation({
    mutationFn: async (layout: string[]) => {
      await apiRequest("PATCH", "/api/company", { dashboardLayout: layout });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: "Dashboard layout saved" });
      setCustomizeOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save layout", description: err.message, variant: "destructive" });
    },
  });

  const openCustomize = useCallback(() => {
    const savedLayout = company?.dashboardLayout;
    if (savedLayout && savedLayout.length > 0) {
      const enabledSet = new Set(savedLayout);
      const disabledIds = DEFAULT_ORDER.filter((id) => !enabledSet.has(id));
      setEditLayout([...savedLayout, ...disabledIds]);
      setEditEnabled(enabledSet);
    } else {
      setEditLayout([...DEFAULT_ORDER]);
      setEditEnabled(new Set(DEFAULT_ORDER));
    }
    setCustomizeOpen(true);
  }, [company]);

  const toggleWidget = useCallback((id: string) => {
    setEditEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const moveWidget = useCallback((index: number, direction: "up" | "down") => {
    setEditLayout((prev) => {
      const next = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    const enabledInOrder = editLayout.filter((id) => editEnabled.has(id));
    saveMutation.mutate(enabledInOrder);
  }, [editLayout, editEnabled, saveMutation]);

  const tierKey = stats?.subscriptionTier as keyof typeof TIER_CONFIG | undefined;
  const tierInfo = tierKey ? TIER_CONFIG[tierKey] : null;

  const visitProgress = stats && stats.todaysVisits > 0
    ? Math.round((stats.todaysVisitBreakdown.completed / stats.todaysVisits) * 100)
    : 0;

  const savedLayout = company?.dashboardLayout;
  const activeWidgets: string[] = savedLayout && savedLayout.length > 0
    ? savedLayout
    : DEFAULT_ORDER;

  const widgetRenderers: Record<string, () => JSX.Element> = {
    mrr: () => (
      <Card key="mrr" data-testid="widget-mrr">
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Monthly Revenue (MRR)</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <div className="text-2xl font-bold" data-testid="text-mrr">
              ${stats?.mrr?.toFixed(2) ?? "0.00"}
            </div>
          )}
        </CardContent>
      </Card>
    ),
    month_revenue: () => (
      <Card key="month_revenue" data-testid="widget-month-revenue">
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Revenue This Month</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <div className="text-2xl font-bold" data-testid="text-month-revenue">
              ${(stats?.monthRevenue ?? 0).toFixed(2)}
            </div>
          )}
        </CardContent>
      </Card>
    ),
    requires_invoicing: () => (
      <Link href="/invoices" key="requires_invoicing">
        <Card className="cursor-pointer hover:shadow-md transition-shadow" data-testid="widget-requires-invoicing">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Requires Invoicing</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {pipelineLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : !pipeline ? (
              <Skeleton className="h-8 w-24" />
            ) : pipeline.requiresInvoicing.count === 0 ? (
              <div data-testid="text-requires-invoicing">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">0</div>
                <p className="text-xs text-muted-foreground mt-1">All caught up</p>
              </div>
            ) : (
              <div data-testid="text-requires-invoicing">
                <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                  {pipeline.requiresInvoicing.count}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  ${pipeline.requiresInvoicing.totalDollars.toFixed(2)} uninvoiced
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </Link>
    ),
    overdue_invoices: () => (
      <Card key="overdue_invoices" data-testid="widget-overdue-invoices">
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Overdue Invoices</CardTitle>
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <div data-testid="text-overdue-invoices">
              <div className="text-2xl font-bold">{stats?.overdueInvoices ?? 0}</div>
              {(stats?.failedPayments ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {stats?.failedPayments} failed payment{stats?.failedPayments === 1 ? "" : "s"}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    ),
    todays_visits: () => (
      <Card key="todays_visits" data-testid="widget-todays-visits">
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Today's Visits</CardTitle>
          <CalendarCheck className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <div data-testid="text-todays-visits">
              <div className="text-2xl font-bold">{stats?.todaysVisits ?? 0}</div>
              {stats && stats.todaysVisits > 0 && (
                <div className="mt-2 space-y-1">
                  <Progress value={visitProgress} className="h-2" />
                  <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                    <span>{stats.todaysVisitBreakdown.completed} done</span>
                    <span>/</span>
                    <span>{stats.todaysVisitBreakdown.inProgress} active</span>
                    <span>/</span>
                    <span>{stats.todaysVisitBreakdown.scheduled} pending</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    ),
    active_clients: () => (
      <Card key="active_clients" data-testid="widget-active-clients">
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Active Clients</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <div className="text-2xl font-bold" data-testid="text-active-contacts">
              {stats?.activeContacts ?? 0}
            </div>
          )}
        </CardContent>
      </Card>
    ),
    service_plans: () => (
      <Card key="service_plans" data-testid="widget-service-plans">
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Service Plans</CardTitle>
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <div className="text-2xl font-bold" data-testid="text-active-plans">
              {stats?.activeServicePlans ?? 0}
            </div>
          )}
        </CardContent>
      </Card>
    ),
    team_size: () => (
      <Card key="team_size" data-testid="widget-team-size">
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Team Size</CardTitle>
          <UserCheck className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <div data-testid="text-active-users">
              <div className="text-2xl font-bold">{stats?.activeUsers ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                of {tierInfo?.maxUsers ?? 1} allowed
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    ),
    texts_sent: () => (
      <Card key="texts_sent" data-testid="widget-texts-sent">
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">SMS Sent</CardTitle>
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <div data-testid="text-sms-count">
              <div className="text-2xl font-bold">{stats?.smsCountThisMonth ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">this month</p>
            </div>
          )}
        </CardContent>
      </Card>
    ),
    emails_sent: () => (
      <Card key="emails_sent" data-testid="widget-emails-sent">
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Emails Sent</CardTitle>
          <Mail className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <div data-testid="text-email-count">
              <div className="text-2xl font-bold">{stats?.emailCountThisMonth ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">this month</p>
            </div>
          )}
        </CardContent>
      </Card>
    ),
    quick_actions: () => (
      <Card key="quick_actions" className="md:col-span-2" data-testid="widget-quick-actions">
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
          <CardDescription>Common tasks</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" data-testid="button-quick-add-contact">
            <Link href="/contacts">
              <Plus className="mr-1 h-4 w-4" />
              Add Contact
            </Link>
          </Button>
          <Button asChild variant="outline" data-testid="button-quick-scheduling">
            <Link href="/scheduling">
              <CalendarCheck className="mr-1 h-4 w-4" />
              Scheduling
            </Link>
          </Button>
          <Button asChild variant="outline" data-testid="button-quick-view-routes">
            <Link href="/routes">
              <Eye className="mr-1 h-4 w-4" />
              Routes
            </Link>
          </Button>
          <Button asChild variant="outline" data-testid="button-quick-invoices">
            <Link href="/invoices">
              <FileText className="mr-1 h-4 w-4" />
              Invoices
            </Link>
          </Button>
          <Button asChild variant="outline" data-testid="button-quick-tech-mobile">
            <Link href="/m/today">
              <Clock className="mr-1 h-4 w-4" />
              Field View
            </Link>
          </Button>
        </CardContent>
      </Card>
    ),
  };

  const statWidgetIds = ["mrr", "month_revenue", "requires_invoicing", "overdue_invoices", "todays_visits", "active_clients", "service_plans", "team_size", "texts_sent", "emails_sent"];
  const fullWidgetIds = ["quick_actions"];

  const activeStatWidgets = activeWidgets.filter((id) => statWidgetIds.includes(id));
  const activeFullWidgets = activeWidgets.filter((id) => fullWidgetIds.includes(id));

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-welcome">
            Welcome back, {user?.firstName || "there"}
          </h1>
          <p className="text-muted-foreground">Here is your business overview</p>
        </div>
        <Button
          variant="outline"
          onClick={openCustomize}
          data-testid="button-customize-dashboard"
        >
          <Sliders className="mr-1 h-4 w-4" />
          Customize
        </Button>
      </div>

      {onboarding && !onboarding.isComplete && (
        <GuidedSetup onboarding={onboarding} />
      )}

      {pipelineLoading ? (
        <div className="space-y-2" data-testid="loading-pipeline">
          <Skeleton className="h-3 w-full rounded-lg" />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
          </div>
        </div>
      ) : pipelineError ? (
        <Card className="border-destructive/50" data-testid="pipeline-error">
          <CardContent className="p-4 text-center text-sm text-muted-foreground">
            Unable to load pipeline data. Please refresh to try again.
          </CardContent>
        </Card>
      ) : pipeline ? (
        <PipelineBar data={pipeline} />
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {pipeline && (
            <TodaysAppointments visits={pipeline.todaysVisits} />
          )}

          {activeStatWidgets.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="widgets-grid">
              {activeStatWidgets.map((id) => widgetRenderers[id]?.())}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Current Plan</CardTitle>
                <CardDescription>Your subscription details</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : (
                  <div className="space-y-3" data-testid="text-plan-info">
                    <div className="flex items-center gap-2">
                      <p className="text-xl font-semibold">{tierInfo?.name ?? stats?.tierName ?? "Unknown"}</p>
                      <Badge variant="secondary">Active</Badge>
                    </div>
                    <p className="text-muted-foreground">
                      ${tierInfo?.price?.toFixed(2) ?? "0.00"}/mo -- Up to {tierInfo?.maxUsers ?? 1} user{(tierInfo?.maxUsers ?? 1) > 1 ? "s" : ""}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
            {activeFullWidgets.map((id) => widgetRenderers[id]?.())}
          </div>
        </div>

        <div className="space-y-4">
          {pipelineLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-40" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ) : pipeline ? (
            <BusinessPerformance data={pipeline} />
          ) : null}
        </div>
      </div>

      <Dialog open={customizeOpen} onOpenChange={setCustomizeOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-customize-dashboard">
          <DialogHeader>
            <DialogTitle>Customize Dashboard</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 max-h-[60vh] overflow-y-auto">
            {editLayout.map((widgetId, index) => {
              const widget = ALL_WIDGETS.find((w) => w.id === widgetId);
              if (!widget) return null;
              return (
                <div
                  key={widgetId}
                  className="flex items-center justify-between gap-2 rounded-md p-2"
                  data-testid={`customize-widget-${widgetId}`}
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={editEnabled.has(widgetId)}
                      onCheckedChange={() => toggleWidget(widgetId)}
                      data-testid={`checkbox-widget-${widgetId}`}
                    />
                    <span className="text-sm">{widget.label}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={index === 0}
                      onClick={() => moveWidget(index, "up")}
                      data-testid={`button-move-up-${widgetId}`}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={index === editLayout.length - 1}
                      onClick={() => moveWidget(index, "down")}
                      data-testid={`button-move-down-${widgetId}`}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCustomizeOpen(false)}
              data-testid="button-cancel-customize"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              data-testid="button-save-layout"
            >
              {saveMutation.isPending ? "Saving..." : "Save Layout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
