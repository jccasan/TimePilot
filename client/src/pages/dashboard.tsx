import { useState, useCallback } from "react";
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
  FileText, Clock, CheckCircle2, Circle, ArrowRight,
  MessageSquare, Mail, Sliders, ChevronUp, ChevronDown,
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
  [key: string]: any;
};

const ALL_WIDGETS = [
  { id: "mrr", label: "MRR" },
  { id: "month_revenue", label: "Month Revenue" },
  { id: "overdue_invoices", label: "Overdue Invoices" },
  { id: "todays_visits", label: "Today's Visits" },
  { id: "active_clients", label: "Active Clients" },
  { id: "service_plans", label: "Service Plans" },
  { id: "team_size", label: "Team Size" },
  { id: "texts_sent", label: "Texts Sent" },
  { id: "emails_sent", label: "Emails Sent" },
  { id: "quick_actions", label: "Quick Actions" },
] as const;

const DEFAULT_ORDER = ALL_WIDGETS.map((w) => w.id);

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
          <CardTitle className="text-sm font-medium">MRR</CardTitle>
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
          <CardTitle className="text-sm font-medium">Month Revenue</CardTitle>
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
          <CardTitle className="text-sm font-medium">Texts Sent</CardTitle>
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
              Tech View
            </Link>
          </Button>
        </CardContent>
      </Card>
    ),
  };

  const statWidgetIds = ["mrr", "month_revenue", "overdue_invoices", "todays_visits", "active_clients", "service_plans", "team_size", "texts_sent", "emails_sent"];
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

      {activeStatWidgets.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="widgets-grid">
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
