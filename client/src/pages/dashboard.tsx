import { useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from "react";
import { toLocalDateString } from "@/lib/utils";
import { useCompanyTimezone } from "@/hooks/use-company-timezone";

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtInt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function ResizableCardBody({ storageKey, defaultHeight = 320, minHeight = 120, children }: { storageKey: string; defaultHeight?: number; minHeight?: number; children: ReactNode }) {
  const [height, setHeight] = useState(() => {
    const saved = localStorage.getItem(`dash-h-${storageKey}`);
    return saved ? Math.max(minHeight, parseInt(saved, 10)) : defaultHeight;
  });
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startH.current = height;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [height]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const newH = Math.max(minHeight, startH.current + (e.clientY - startY.current));
    setHeight(newH);
  }, [minHeight]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    const finalH = Math.max(minHeight, startH.current + (e.clientY - startY.current));
    setHeight(finalH);
    localStorage.setItem(`dash-h-${storageKey}`, String(finalH));
  }, [storageKey, minHeight]);

  return (
    <div className="flex flex-col">
      <div className="overflow-y-auto" style={{ height }} data-testid={`scrollable-${storageKey}`}>
        {children}
      </div>
      <div
        className="flex items-center justify-center h-5 cursor-row-resize hover:bg-muted/50 transition-colors border-t select-none rounded-b-lg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        data-testid={`resize-handle-${storageKey}`}
      >
        <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground/60" />
      </div>
    </div>
  );
}

import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { ResponsiveGridLayout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  DollarSign, CalendarCheck, AlertTriangle, UserCheck,
  Plus, Eye, Users, ClipboardList, TrendingUp,
  FileText, Clock,
  MessageSquare, Mail, Sliders, ChevronUp, ChevronDown,
  CheckCircle, XCircle, MapPin, BarChart3, Activity,
  StickyNote, Route, GripVertical, X, LayoutGrid,
  Inbox, ArrowRight, RotateCcw, Cloud, MapPinned,
  Sun, CloudRain, CloudSnow, CloudLightning, CloudDrizzle,
  Cloudy, Snowflake, Wind, GripHorizontal, Bell, Info, AlertOctagon,
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
  dashboardLayout?: any;
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
  serviceType: string;
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

type ChangeRequest = {
  id: string;
  contactId: string;
  contactName: string;
  requestType: string;
  currentValue: string | null;
  requestedValue: string | null;
  note: string | null;
  status: string;
  createdAt: string;
};

type PortalMessage = {
  id: string;
  contactId: string;
  contactName?: string;
  subject: string;
  body: string;
  channel: string;
  direction: string;
  createdAt: string;
};

type CleanupNotification = {
  id: string;
  title: string;
  message: string;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
};

type InboxItem = {
  kind: "change" | "message" | "cleanup";
  id: string;
  sortDate: number;
  data: ChangeRequest | PortalMessage | CleanupNotification;
};

type RevenueChartItem = {
  month: string;
  revenue: number;
};

type ActivityItem = {
  id: string;
  title: string;
  message: string;
  type: string;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
};

type UpcomingVisit = {
  id: string;
  scheduledDate: string;
  status: string;
  contactName: string;
  propertyAddress: string;
  servicePlanName: string;
};

type LayoutItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
};

type RecentCommMessage = {
  id: string;
  contactId: string | null;
  contactName: string;
  channel: string;
  direction: string;
  subject: string | null;
  body: string;
  createdAt: string;
};

type RecentCommsData = {
  sms: RecentCommMessage[];
  emails: RecentCommMessage[];
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  frequency_change: "Frequency Change",
  day_change: "Day Change",
  cancel: "Cancellation",
  pause: "Pause Service",
  same_day_service: "Same-Day Service",
  other: "Other Request",
};

const WIDGET_DEFS: {
  id: string;
  label: string;
  icon: typeof DollarSign;
  description: string;
  defaultW: number;
  defaultH: number;
  minW: number;
  minH: number;
  category: "stats" | "insights" | "tools";
}[] = [
  { id: "mrr", label: "Monthly Revenue (MRR)", icon: DollarSign, description: "Current monthly recurring revenue", defaultW: 4, defaultH: 2, minW: 3, minH: 2, category: "stats" },
  { id: "month_revenue", label: "Revenue This Month", icon: TrendingUp, description: "Total revenue collected this month", defaultW: 4, defaultH: 2, minW: 3, minH: 2, category: "stats" },
  { id: "requires_invoicing", label: "Requires Invoicing", icon: FileText, description: "Completed visits needing invoices", defaultW: 4, defaultH: 2, minW: 3, minH: 2, category: "stats" },
  { id: "overdue_invoices", label: "Overdue Invoices", icon: AlertTriangle, description: "Invoices past their due date", defaultW: 4, defaultH: 2, minW: 3, minH: 2, category: "stats" },
  { id: "todays_visits", label: "Today's Visits", icon: CalendarCheck, description: "Scheduled visits for today with progress", defaultW: 4, defaultH: 3, minW: 3, minH: 2, category: "stats" },
  { id: "active_clients", label: "Active Clients", icon: Users, description: "Total active client count", defaultW: 4, defaultH: 2, minW: 3, minH: 2, category: "stats" },
  { id: "service_plans", label: "Jobs", icon: ClipboardList, description: "Active service plan count", defaultW: 4, defaultH: 2, minW: 3, minH: 2, category: "stats" },
  { id: "team_size", label: "Team Size", icon: UserCheck, description: "Active team members", defaultW: 4, defaultH: 2, minW: 3, minH: 2, category: "stats" },
  { id: "texts_sent", label: "SMS Sent", icon: MessageSquare, description: "Text messages sent this month", defaultW: 4, defaultH: 2, minW: 3, minH: 2, category: "stats" },
  { id: "emails_sent", label: "Emails Sent", icon: Mail, description: "Emails sent this month", defaultW: 4, defaultH: 2, minW: 3, minH: 2, category: "stats" },
  { id: "quick_actions", label: "Quick Actions", icon: LayoutGrid, description: "Shortcut buttons to common tasks", defaultW: 4, defaultH: 3, minW: 3, minH: 2, category: "tools" },
  { id: "recent_activity", label: "Recent Activity", icon: Activity, description: "Latest notifications and events", defaultW: 6, defaultH: 4, minW: 4, minH: 3, category: "insights" },
  { id: "upcoming_visits", label: "Upcoming Visits", icon: CalendarCheck, description: "Visits scheduled for this week", defaultW: 6, defaultH: 4, minW: 4, minH: 3, category: "insights" },
  { id: "revenue_chart", label: "Revenue Chart", icon: BarChart3, description: "6-month revenue trend", defaultW: 6, defaultH: 4, minW: 4, minH: 3, category: "insights" },
  { id: "route_summary", label: "Route Summary", icon: Route, description: "Active routes overview", defaultW: 4, defaultH: 2, minW: 3, minH: 2, category: "insights" },
  { id: "quick_notes", label: "Quick Notes", icon: StickyNote, description: "Scratchpad for reminders (synced to account)", defaultW: 4, defaultH: 4, minW: 3, minH: 3, category: "tools" },
  { id: "current_plan", label: "Current Plan", icon: ClipboardList, description: "Your subscription details", defaultW: 4, defaultH: 2, minW: 3, minH: 2, category: "stats" },
  { id: "weather_forecast", label: "Weather Forecast", icon: Cloud, description: "5-day weather forecast for your area", defaultW: 6, defaultH: 3, minW: 4, minH: 3, category: "insights" },
  { id: "route_map_preview", label: "Route Map", icon: MapPinned, description: "Map preview of today's routes", defaultW: 6, defaultH: 5, minW: 4, minH: 4, category: "insights" },
];

const DEFAULT_WIDGET_IDS = [
  "mrr", "month_revenue", "requires_invoicing",
  "overdue_invoices", "todays_visits", "active_clients",
  "service_plans", "team_size", "texts_sent",
  "quick_actions", "emails_sent", "current_plan",
];

function generateDefaultLayout(widgetIds: string[]): LayoutItem[] {
  const items: LayoutItem[] = [];
  let x = 0;
  let y = 0;
  for (const id of widgetIds) {
    const def = WIDGET_DEFS.find(w => w.id === id);
    if (!def) continue;
    if (x + def.defaultW > 12) {
      x = 0;
      y += 2;
    }
    items.push({
      i: id,
      x,
      y,
      w: def.defaultW,
      h: def.defaultH,
      minW: def.minW,
      minH: def.minH,
    });
    x += def.defaultW;
    if (x >= 12) {
      x = 0;
      y += def.defaultH;
    }
  }
  return items;
}

function migrateLayout(raw: any): LayoutItem[] | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return [];
    if (typeof raw[0] === "string") {
      return generateDefaultLayout(raw as string[]);
    }
    if (typeof raw[0] === "object" && "i" in raw[0]) {
      return raw as LayoutItem[];
    }
  }
  return null;
}

function ClientRequestsCard() {
  const { toast } = useToast();

  const { data: changeRequests = [], isLoading: crLoading } = useQuery<ChangeRequest[]>({
    queryKey: ["/api/service-change-requests", "pending"],
    queryFn: async () => {
      const res = await fetch("/api/service-change-requests?status=pending", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const { data: portalMessages = [], isLoading: msgLoading } = useQuery<PortalMessage[]>({
    queryKey: ["/api/messages", "inbound", "unread"],
    queryFn: async () => {
      const res = await fetch("/api/messages?direction=inbound&unread=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const { data: cleanupRequests = [], isLoading: cleanupLoading } = useQuery<CleanupNotification[]>({
    queryKey: ["/api/notifications", "cleanup-requests"],
    queryFn: async () => {
      const res = await fetch("/api/notifications?unread=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      const all: CleanupNotification[] = await res.json();
      return all.filter((n) => n.title.includes("One-Time Cleanup Request"));
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, adminNote }: { id: string; adminNote?: string }) => {
      await apiRequest("POST", `/api/service-change-requests/${id}/approve`, { adminNote });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-change-requests"] });
      toast({ title: "Approved", description: "Service change request approved." });
    },
  });

  const denyMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      await apiRequest("POST", `/api/service-change-requests/${id}/deny`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-change-requests"] });
      toast({ title: "Denied", description: "Service change request denied." });
    },
  });

  const dismissMessageMutation = useMutation({
    mutationFn: async (messageId: string) => {
      await apiRequest("PATCH", `/api/messages/${messageId}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      toast({ title: "Dismissed", description: "Message dismissed." });
    },
  });

  const acceptCleanupMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/recent-activity"] });
      toast({ title: "Accepted", description: "Cleanup request accepted. Schedule the visit from your routes page." });
    },
  });

  const dismissCleanupMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/recent-activity"] });
      toast({ title: "Dismissed", description: "Cleanup request dismissed." });
    },
  });

  const inboxItems = useMemo<InboxItem[]>(() => {
    const items: InboxItem[] = [];
    for (const cr of changeRequests) {
      items.push({ kind: "change", id: `cr-${cr.id}`, sortDate: new Date(cr.createdAt).getTime(), data: cr });
    }
    for (const msg of portalMessages.slice(0, 10)) {
      items.push({ kind: "message", id: `msg-${msg.id}`, sortDate: new Date(msg.createdAt).getTime(), data: msg });
    }
    for (const cu of cleanupRequests) {
      items.push({ kind: "cleanup", id: `cu-${cu.id}`, sortDate: new Date(cu.createdAt).getTime(), data: cu });
    }
    items.sort((a, b) => b.sortDate - a.sortDate);
    return items;
  }, [changeRequests, portalMessages, cleanupRequests]);

  const isLoading = crLoading || msgLoading || cleanupLoading;

  if (isLoading) {
    return (
      <Card data-testid="widget-client-requests" id="client-requests">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Inbox className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Client Requests</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (inboxItems.length === 0) {
    return (
      <Card data-testid="widget-client-requests" id="client-requests">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Inbox className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Client Requests</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-requests">
            No pending requests. You're all caught up.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="widget-client-requests" id="client-requests">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Inbox className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Client Requests</CardTitle>
            <Badge variant="secondary" data-testid="badge-request-count">{inboxItems.length}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {inboxItems.map((item) => {
            if (item.kind === "change") {
              const req = item.data as ChangeRequest;
              return (
                <div key={item.id} className="border rounded-lg p-3 space-y-2" data-testid={`request-change-${req.id}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sliders className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{REQUEST_TYPE_LABELS[req.requestType] || req.requestType}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(req.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-sm">
                    <Link href={`/contacts/${req.contactId}`}>
                      <span className="font-medium text-primary hover:underline cursor-pointer">{req.contactName}</span>
                    </Link>
                    {req.currentValue && req.requestedValue && (
                      <span className="text-muted-foreground ml-1">
                        {req.currentValue} <ArrowRight className="h-3 w-3 inline" /> {req.requestedValue}
                      </span>
                    )}
                  </div>
                  {req.note && (
                    <p className="text-xs text-muted-foreground italic">"{req.note}"</p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => approveMutation.mutate({ id: req.id })}
                      disabled={approveMutation.isPending}
                      data-testid={`button-approve-${req.id}`}
                    >
                      <CheckCircle className="h-3.5 w-3.5 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => denyMutation.mutate({ id: req.id })}
                      disabled={denyMutation.isPending}
                      data-testid={`button-deny-${req.id}`}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" />
                      Deny
                    </Button>
                  </div>
                </div>
              );
            }

            if (item.kind === "cleanup") {
              const cu = item.data as CleanupNotification;
              return (
                <div key={item.id} className="border rounded-lg p-3 space-y-2" data-testid={`request-cleanup-${cu.id}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CalendarCheck className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">One-Time Cleanup</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(cu.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm">{cu.message}</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => acceptCleanupMutation.mutate(cu.id)}
                      disabled={acceptCleanupMutation.isPending}
                      data-testid={`button-accept-cleanup-${cu.id}`}
                    >
                      <CheckCircle className="h-3.5 w-3.5 mr-1" />
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => dismissCleanupMutation.mutate(cu.id)}
                      disabled={dismissCleanupMutation.isPending}
                      data-testid={`button-dismiss-cleanup-${cu.id}`}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" />
                      Dismiss
                    </Button>
                  </div>
                </div>
              );
            }

            const msg = item.data as PortalMessage;
            return (
              <div key={item.id} className="border rounded-lg p-3 space-y-2" data-testid={`request-message-${msg.id}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Portal Message</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(msg.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="text-sm">
                  {msg.contactId ? (
                    <Link href={`/contacts/${msg.contactId}`}>
                      <span className="font-medium text-primary hover:underline cursor-pointer">
                        {msg.contactName || "Client"}
                      </span>
                    </Link>
                  ) : (
                    <span className="font-medium">{msg.contactName || "Client"}</span>
                  )}
                  {msg.subject && <span className="text-muted-foreground ml-1">-- {msg.subject}</span>}
                </div>
                {msg.body && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{msg.body}</p>
                )}
                <div className="flex gap-2">
                  <Link href="/communications">
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`button-reply-${msg.id}`}
                      onClick={() => dismissMessageMutation.mutate(msg.id)}
                    >
                      <Mail className="h-3.5 w-3.5 mr-1" />
                      View & Reply
                    </Button>
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => dismissMessageMutation.mutate(msg.id)}
                    disabled={dismissMessageMutation.isPending}
                    data-testid={`button-dismiss-message-${msg.id}`}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

type SystemMsg = {
  id: string;
  companyId: string;
  type: string;
  severity: "info" | "warning" | "error";
  title: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
};

function SystemMessagesCard() {
  const { toast } = useToast();
  const { data: messages = [], isLoading, isError } = useQuery<SystemMsg[]>({
    queryKey: ["/api/system-messages"],
  });

  const markedIds = useRef<Set<string>>(new Set());

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/system-messages/${id}/read`);
    },
  });

  useEffect(() => {
    if (messages.length > 0) {
      const unread = messages.filter(m => !m.readAt && !markedIds.current.has(m.id));
      unread.forEach(m => {
        markedIds.current.add(m.id);
        markReadMutation.mutate(m.id);
      });
    }
  }, [messages]);

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/system-messages/${id}/dismiss`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-messages"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to dismiss message.", variant: "destructive" });
    },
  });

  const dismissAllMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/system-messages/dismiss-all");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-messages"] });
      toast({ title: "All cleared", description: "System messages dismissed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to dismiss messages.", variant: "destructive" });
    },
  });

  if (isLoading) return null;
  if (isError) return null;
  if (messages.length === 0) return null;

  const severityIcon = (severity: string) => {
    switch (severity) {
      case "error": return <AlertOctagon className="h-4 w-4 text-destructive shrink-0" />;
      case "warning": return <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />;
      default: return <Info className="h-4 w-4 text-blue-500 shrink-0" />;
    }
  };

  const severityBadge = (severity: string) => {
    switch (severity) {
      case "error": return <Badge variant="destructive" className="text-[10px]">Error</Badge>;
      case "warning": return <Badge className="text-[10px] bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100">Warning</Badge>;
      default: return <Badge variant="secondary" className="text-[10px]">Info</Badge>;
    }
  };

  const unreadCount = messages.filter(m => !m.readAt).length;

  return (
    <Card data-testid="widget-system-messages" id="system-messages">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">System Messages</CardTitle>
            {unreadCount > 0 && (
              <Badge variant="destructive" className="text-xs" data-testid="badge-system-unread">{unreadCount}</Badge>
            )}
          </div>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => dismissAllMutation.mutate()}
              disabled={dismissAllMutation.isPending}
              data-testid="button-dismiss-all-system"
            >
              Clear All
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`border rounded-lg p-3 space-y-1 ${!msg.readAt ? "bg-muted/30" : ""}`}
              data-testid={`system-msg-${msg.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  {severityIcon(msg.severity)}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{msg.title}</span>
                      {severityBadge(msg.severity)}
                    </div>
                    {msg.body && <p className="text-xs text-muted-foreground mt-0.5">{msg.body}</p>}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {new Date(msg.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 shrink-0"
                  onClick={() => dismissMutation.mutate(msg.id)}
                  disabled={dismissMutation.isPending}
                  data-testid={`button-dismiss-${msg.id}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function CommMessageRow({ msg }: { msg: RecentCommMessage }) {
  const content = msg.channel === "email" && msg.subject ? msg.subject : msg.body;
  const truncated = content.length > 80 ? content.substring(0, 80) + "..." : content;

  const row = (
    <div
      className={`flex items-start gap-3 py-2.5 px-1 rounded-md transition-colors ${msg.contactId ? "hover:bg-muted/50 cursor-pointer" : ""}`}
      data-testid={`comm-message-${msg.id}`}
    >
      <div className={`mt-0.5 rounded-full p-1.5 ${msg.direction === "inbound" ? "bg-blue-100 dark:bg-blue-900/30" : "bg-green-100 dark:bg-green-900/30"}`}>
        {msg.channel === "sms" ? (
          <MessageSquare className={`h-3.5 w-3.5 ${msg.direction === "inbound" ? "text-blue-600 dark:text-blue-400" : "text-green-600 dark:text-green-400"}`} />
        ) : (
          <Mail className={`h-3.5 w-3.5 ${msg.direction === "inbound" ? "text-blue-600 dark:text-blue-400" : "text-green-600 dark:text-green-400"}`} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate" data-testid={`text-comm-contact-${msg.id}`}>
            {msg.contactName || (msg.direction === "inbound" ? "Unknown" : "System")}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${msg.direction === "inbound" ? "border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-300" : "border-green-200 text-green-700 dark:border-green-800 dark:text-green-300"}`}
              data-testid={`badge-direction-${msg.id}`}
            >
              {msg.direction === "inbound" ? "In" : "Out"}
            </Badge>
            <span className="text-xs text-muted-foreground whitespace-nowrap" data-testid={`text-comm-time-${msg.id}`}>
              {formatRelativeTime(msg.createdAt)}
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate" data-testid={`text-comm-preview-${msg.id}`}>
          {truncated}
        </p>
      </div>
    </div>
  );

  if (msg.contactId) {
    return (
      <Link href={`/communications?contactId=${msg.contactId}`} key={msg.id}>
        {row}
      </Link>
    );
  }
  return <div key={msg.id}>{row}</div>;
}

function RecentCommunications() {
  const { data, isLoading, isError } = useQuery<RecentCommsData>({
    queryKey: ["/api/company/recent-communications"],
  });

  if (isError) {
    return (
      <Card data-testid="recent-comms-error">
        <CardContent className="p-4 text-center text-sm text-muted-foreground">
          Unable to load recent communications. Please refresh to try again.
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="loading-recent-comms">
        {[0, 1].map(i => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[0, 1, 2].map(j => (
                  <div key={j} className="flex gap-3">
                    <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const smsList = data?.sms ?? [];
  const emailList = data?.emails ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="recent-communications">
      <Card data-testid="card-recent-sms">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Recent SMS</CardTitle>
            </div>
            <Button asChild variant="ghost" size="sm" className="text-xs h-7" data-testid="link-view-all-sms">
              <Link href="/communications">View all</Link>
            </Button>
          </div>
        </CardHeader>
        <ResizableCardBody storageKey="recent-sms" defaultHeight={280} minHeight={100}>
          <div className="px-6">
            {smsList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground" data-testid="empty-recent-sms">
                <MessageSquare className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">No recent text messages</p>
              </div>
            ) : (
              <div className="divide-y">
                {smsList.map(msg => <CommMessageRow key={msg.id} msg={msg} />)}
              </div>
            )}
          </div>
        </ResizableCardBody>
      </Card>

      <Card data-testid="card-recent-emails">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Recent Emails</CardTitle>
            </div>
            <Button asChild variant="ghost" size="sm" className="text-xs h-7" data-testid="link-view-all-emails">
              <Link href="/communications">View all</Link>
            </Button>
          </div>
        </CardHeader>
        <ResizableCardBody storageKey="recent-emails" defaultHeight={280} minHeight={100}>
          <div className="px-6">
            {emailList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground" data-testid="empty-recent-emails">
                <Mail className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">No recent emails</p>
              </div>
            ) : (
              <div className="divide-y">
                {emailList.map(msg => <CommMessageRow key={msg.id} msg={msg} />)}
              </div>
            )}
          </div>
        </ResizableCardBody>
      </Card>
    </div>
  );
}

function PipelineBar({ data }: { data: PipelineData }) {
  const stages = [
    {
      label: "Active Plans",
      count: data.activePlans.count,
      value: `$${fmtInt(data.activePlans.monthlyValue)}/mo`,
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
      value: data.requiresInvoicing.count > 0 ? `$${fmt(data.requiresInvoicing.totalDollars)}` : "All clear",
      href: "/invoices?tab=uninvoiced",
      color: data.requiresInvoicing.count > 0 ? "bg-orange-500 dark:bg-orange-600" : "bg-green-600 dark:bg-green-700",
      textColor: data.requiresInvoicing.count > 0 ? "text-orange-700 dark:text-orange-400" : "text-green-700 dark:text-green-400",
      bgColor: data.requiresInvoicing.count > 0
        ? "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800"
        : "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800",
    },
    {
      label: "Awaiting Payment",
      count: data.awaitingPayment.count,
      value: data.awaitingPayment.count > 0 ? `$${fmt(data.awaitingPayment.totalDollars)}` : "None",
      href: "/invoices?tab=awaiting",
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

function deriveGroup(visit: PipelineVisit, timezone?: string): OperationalGroup {
  if (visit.status === "completed") return "completed";
  if (visit.status === "skipped" || visit.status === "cancelled") return "skipped";
  if (visit.status === "in_progress") return "active";
  const now = new Date();
  const today = toLocalDateString(now, timezone);
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
  const companyTimezone = useCompanyTimezone();
  const { toast } = useToast();

  const markVisitMutation = useMutation({
    mutationFn: async ({ visitId, status }: { visitId: string; status: string }) => {
      const now = new Date().toISOString();
      const body: Record<string, unknown> = { status };
      if (status === "completed") {
        body.completedAt = now;
        body.startedAt = now;
      }
      await apiRequest("PATCH", `/api/visits/${visitId}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/uninvoiced-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/upcoming-visits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/recent-activity"] });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey.includes("uninvoiced-visits") });
      toast({ title: "Visit updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const grouped = useMemo(() => {
    const groups = new Map<OperationalGroup, PipelineVisit[]>();
    for (const v of visits) {
      const group = deriveGroup(v, companyTimezone);
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
      <ResizableCardBody storageKey="todays-appts" defaultHeight={360} minHeight={140}>
        <div className="px-6 pb-4 space-y-3">
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
                        <span className="truncate">{visit.propertyAddress}</span>
                        <span className="shrink-0">&middot;</span>
                        <span className="shrink-0">{visit.serviceType}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-medium tabular-nums" data-testid={`text-visit-amount-${visit.id}`}>
                        ${fmt(visit.amount)}
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
        </div>
      </ResizableCardBody>
    </Card>
  );
}

function BusinessPerformance({ data }: { data: PipelineData }) {
  return (
    <div className="space-y-3" data-testid="section-business-performance">
      <Card data-testid="card-receivables">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Receivables
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div>
            <div className="text-2xl font-bold" data-testid="text-total-receivables">
              ${fmt(data.receivables.total)}
            </div>
            {data.receivables.overdueCount > 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5" data-testid="text-overdue-receivables">
                ${fmt(data.receivables.overdueTotal)} overdue ({data.receivables.overdueCount} invoice{data.receivables.overdueCount !== 1 ? "s" : ""})
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
                    <span className="font-medium tabular-nums shrink-0">${fmt(client.total)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-month-revenue">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Revenue This Month
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-month-revenue-sidebar">
            ${fmt(data.monthRevenue)}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-upcoming-week">
        <CardHeader className="pb-1">
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
            ${fmt(data.upcomingThisWeek.totalDollars)} in scheduled work
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function RevenueChartWidget() {
  const { data: chartData, isLoading } = useQuery<RevenueChartItem[]>({
    queryKey: ["/api/company/revenue-chart"],
  });

  if (isLoading) {
    return <Skeleton className="h-full w-full" />;
  }

  const maxRevenue = Math.max(...(chartData || []).map(d => d.revenue), 1);

  return (
    <div className="h-full flex flex-col" data-testid="widget-revenue-chart-content">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Revenue Trend (6 months)</span>
      </div>
      <div className="flex-1 flex items-end gap-1.5 min-h-0 pb-1">
        {(chartData || []).map((item, idx) => {
          const height = maxRevenue > 0 ? Math.max((item.revenue / maxRevenue) * 100, 4) : 4;
          return (
            <div key={idx} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <span className="text-[10px] tabular-nums text-muted-foreground truncate w-full text-center">
                ${item.revenue >= 1000 ? `${(item.revenue / 1000).toFixed(1)}k` : fmtInt(item.revenue)}
              </span>
              <div
                className="w-full rounded-t bg-primary/80 hover:bg-primary transition-colors min-h-[4px]"
                style={{ height: `${height}%` }}
                title={`${item.month}: $${fmt(item.revenue)}`}
                data-testid={`bar-revenue-${idx}`}
              />
              <span className="text-[10px] text-muted-foreground">{item.month}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecentActivityWidget() {
  const { data: activities, isLoading } = useQuery<ActivityItem[]>({
    queryKey: ["/api/company/recent-activity"],
  });

  if (isLoading) {
    return <Skeleton className="h-full w-full" />;
  }

  if (!activities || activities.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground" data-testid="widget-recent-activity-empty">
        <Activity className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden" data-testid="widget-recent-activity-content">
      <div className="flex items-center gap-2 mb-2">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Recent Activity</span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
        {activities.map((item) => (
          <div key={item.id} className="flex gap-2 py-1.5 border-b last:border-0" data-testid={`activity-item-${item.id}`}>
            <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{item.title}</p>
              <p className="text-[11px] text-muted-foreground truncate">{item.message}</p>
              <p className="text-[10px] text-muted-foreground">
                {new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UpcomingVisitsWidget() {
  const { data: visits, isLoading } = useQuery<UpcomingVisit[]>({
    queryKey: ["/api/company/upcoming-visits"],
  });

  if (isLoading) {
    return <Skeleton className="h-full w-full" />;
  }

  if (!visits || visits.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground" data-testid="widget-upcoming-visits-empty">
        <CalendarCheck className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">No upcoming visits this week</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden" data-testid="widget-upcoming-visits-content">
      <div className="flex items-center gap-2 mb-2">
        <CalendarCheck className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Upcoming Visits</span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        {visits.map((visit) => (
          <div key={visit.id} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded bg-muted/30" data-testid={`upcoming-visit-${visit.id}`}>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{visit.contactName}</p>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <MapPin className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{visit.propertyAddress}</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs font-medium">
                {new Date(visit.scheduledDate + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RouteSummaryWidget() {
  const { data: pipeline } = useQuery<PipelineData>({
    queryKey: ["/api/company/pipeline"],
  });
  const { data: stats } = useQuery<CompanyStats>({
    queryKey: ["/api/company/stats"],
  });

  return (
    <div className="h-full flex flex-col" data-testid="widget-route-summary-content">
      <div className="flex items-center gap-2 mb-2">
        <Route className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Route Summary</span>
      </div>
      <div className="flex-1 flex flex-col justify-center space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Active Plans</span>
          <span className="text-sm font-bold">{pipeline?.activePlans.count ?? 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">This Week</span>
          <span className="text-sm font-bold">{pipeline?.scheduledVisits.count ?? 0} visits</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Team Members</span>
          <span className="text-sm font-bold">{stats?.activeUsers ?? 0}</span>
        </div>
        <Link href="/routes">
          <Button size="sm" variant="outline" className="w-full mt-1" data-testid="button-view-routes-widget">
            <Eye className="h-3.5 w-3.5 mr-1" />
            View Routes
          </Button>
        </Link>
      </div>
    </div>
  );
}

function QuickNotesWidget() {
  const { data: company } = useQuery<CompanyData>({
    queryKey: ["/api/company"],
  });
  const [notes, setNotes] = useState("");
  const [initialized, setInitialized] = useState(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (company && !initialized) {
      setNotes((company as any).dashboardNotes || "");
      setInitialized(true);
    }
  }, [company, initialized]);

  const notesMutation = useMutation({
    mutationFn: async (value: string) => {
      await apiRequest("PATCH", "/api/company", { dashboardNotes: value });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save notes", description: err.message, variant: "destructive" });
    },
  });

  const handleChange = useCallback((value: string) => {
    setNotes(value);
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      notesMutation.mutate(value);
    }, 1000);
  }, [notesMutation]);

  return (
    <div className="h-full flex flex-col" data-testid="widget-quick-notes-content">
      <div className="flex items-center gap-2 mb-2">
        <StickyNote className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Quick Notes</span>
        {notesMutation.isPending && (
          <span className="text-[10px] text-muted-foreground">Saving...</span>
        )}
      </div>
      <Textarea
        className="flex-1 resize-none text-sm min-h-0"
        placeholder="Jot down reminders, to-dos, or notes..."
        value={notes}
        onChange={(e) => handleChange(e.target.value)}
        data-testid="textarea-quick-notes"
      />
    </div>
  );
}

type WeatherDay = {
  date: string;
  tempMax: number | null;
  tempMin: number | null;
  precipProbability: number | null;
  weatherCode: number | null;
};

function getWeatherIcon(code: number | null) {
  if (code === null) return Cloud;
  if (code === 0) return Sun;
  if (code <= 3) return Cloudy;
  if (code <= 49) return Cloud;
  if (code <= 59) return CloudDrizzle;
  if (code <= 69) return CloudRain;
  if (code <= 79) return CloudSnow;
  if (code <= 82) return CloudRain;
  if (code <= 86) return Snowflake;
  if (code <= 99) return CloudLightning;
  return Cloud;
}

function getWeatherLabel(code: number | null) {
  if (code === null) return "Unknown";
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly Cloudy";
  if (code <= 49) return "Foggy";
  if (code <= 59) return "Drizzle";
  if (code <= 69) return "Rain";
  if (code <= 79) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow Showers";
  if (code <= 99) return "Thunderstorm";
  return "Unknown";
}

function WeatherForecastWidget() {
  const { data, isLoading } = useQuery<{ available: boolean; days?: WeatherDay[]; reason?: string }>({
    queryKey: ["/api/company/weather"],
  });

  if (isLoading) {
    return (
      <div className="h-full flex flex-col" data-testid="widget-weather-loading">
        <div className="flex items-center gap-2 mb-3">
          <Cloud className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Weather Forecast</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    );
  }

  if (!data?.available || !data.days?.length) {
    return (
      <div className="h-full flex flex-col" data-testid="widget-weather-unavailable">
        <div className="flex items-center gap-2 mb-3">
          <Cloud className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Weather Forecast</span>
        </div>
        <p className="text-xs text-muted-foreground">{data?.reason || "Set your company address in Settings to see weather."}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="widget-weather-content">
      <div className="flex items-center gap-2 mb-3">
        <Cloud className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Weather Forecast</span>
      </div>
      <div className="flex-1 flex gap-1 overflow-x-auto">
        {data.days.map((day) => {
          const Icon = getWeatherIcon(day.weatherCode);
          const dayName = new Date(day.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
          return (
            <div key={day.date} className="flex-1 min-w-[60px] flex flex-col items-center gap-1 p-2 rounded-lg bg-muted/30" data-testid={`weather-day-${day.date}`}>
              <span className="text-[10px] font-medium text-muted-foreground uppercase">{dayName}</span>
              <Icon className="h-5 w-5 text-primary" />
              <span className="text-[10px] text-muted-foreground">{getWeatherLabel(day.weatherCode)}</span>
              <div className="text-xs font-medium">
                {day.tempMax !== null ? `${Math.round(day.tempMax)}` : "--"}°
              </div>
              <div className="text-[10px] text-muted-foreground">
                {day.tempMin !== null ? `${Math.round(day.tempMin)}°` : ""}
              </div>
              {day.precipProbability !== null && day.precipProbability > 0 && (
                <div className="flex items-center gap-0.5">
                  <CloudRain className="h-2.5 w-2.5 text-blue-500" />
                  <span className="text-[9px] text-blue-600">{day.precipProbability}%</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type RouteMapData = {
  routes: {
    id: string;
    name: string;
    color: string;
    stopCount: number;
    coordinates: { lat: number; lng: number; address: string }[];
  }[];
  startLat: number | null;
  startLng: number | null;
};

function RouteMapPreviewWidget() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const { data: mapData, isLoading } = useQuery<RouteMapData>({
    queryKey: ["/api/company/route-map-data"],
  });
  const { data: tokenData } = useQuery<{ token: string }>({
    queryKey: ["/api/mapbox-token"],
  });

  useEffect(() => {
    if (!mapContainerRef.current || !tokenData?.token || !mapData || mapRef.current) return;

    const loadMap = async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      await import("mapbox-gl/dist/mapbox-gl.css");
      mapboxgl.accessToken = tokenData.token;

      const centerLat = mapData.startLat || 37.7749;
      const centerLng = mapData.startLng || -77.4194;

      const map = new mapboxgl.Map({
        container: mapContainerRef.current!,
        style: "mapbox://styles/mapbox/light-v11",
        center: [centerLng, centerLat],
        zoom: 10,
        interactive: false,
      });

      mapRef.current = map;

      map.on("load", () => {
        const bounds = new mapboxgl.LngLatBounds();
        let hasCoords = false;

        mapData.routes.forEach((route) => {
          route.coordinates.forEach((coord, idx) => {
            hasCoords = true;
            bounds.extend([coord.lng, coord.lat]);
            const marker = document.createElement("div");
            marker.style.width = "12px";
            marker.style.height = "12px";
            marker.style.borderRadius = "50%";
            marker.style.backgroundColor = route.color;
            marker.style.border = "2px solid white";
            marker.style.boxShadow = "0 1px 3px rgba(0,0,0,0.3)";
            new mapboxgl.Marker({ element: marker })
              .setLngLat([coord.lng, coord.lat])
              .addTo(map);
          });

          if (route.coordinates.length >= 2) {
            map.addSource(`route-${route.id}`, {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: route.coordinates.map(c => [c.lng, c.lat]),
                },
              },
            });
            map.addLayer({
              id: `route-line-${route.id}`,
              type: "line",
              source: `route-${route.id}`,
              layout: { "line-join": "round", "line-cap": "round" },
              paint: { "line-color": route.color, "line-width": 2, "line-opacity": 0.7 },
            });
          }
        });

        if (hasCoords) {
          map.fitBounds(bounds, { padding: 30, maxZoom: 13 });
        }
      });
    };

    loadMap();

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [mapData, tokenData]);

  if (isLoading) {
    return (
      <div className="h-full flex flex-col" data-testid="widget-route-map-loading">
        <div className="flex items-center gap-2 mb-2">
          <MapPinned className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Today's Routes</span>
        </div>
        <Skeleton className="flex-1 min-h-[120px]" />
      </div>
    );
  }

  const totalStops = mapData?.routes.reduce((sum, r) => sum + r.stopCount, 0) || 0;

  return (
    <div className="h-full flex flex-col" data-testid="widget-route-map-content">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <MapPinned className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Today's Routes</span>
        </div>
        <span className="text-xs text-muted-foreground">{mapData?.routes.length || 0} routes, {totalStops} stops</span>
      </div>
      {(!mapData?.routes.length || !tokenData?.token) ? (
        <div className="flex-1 flex items-center justify-center bg-muted/30 rounded-lg">
          <p className="text-xs text-muted-foreground text-center px-4">
            {!tokenData?.token ? "Mapbox token not configured" : "No routes scheduled for today"}
          </p>
        </div>
      ) : (
        <div className="flex-1 relative rounded-lg overflow-hidden border">
          <div ref={mapContainerRef} className="absolute inset-0" />
          <div className="absolute bottom-2 left-2 flex flex-wrap gap-1 z-10">
            {mapData.routes.map(r => (
              <div key={r.id} className="flex items-center gap-1 bg-background/90 backdrop-blur-sm rounded px-1.5 py-0.5 text-[10px] shadow-sm">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                <span>{r.name} ({r.stopCount})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GridWidgetsSection({
  gridLayouts,
  isMobile,
  handleLayoutChange,
  handleDragStart,
  handleResizeStart,
  handleRemoveWidget,
  renderWidget,
  currentLayout,
}: {
  gridLayouts: any;
  isMobile: boolean;
  handleLayoutChange: any;
  handleDragStart: any;
  handleResizeStart: any;
  handleRemoveWidget: (id: string) => void;
  renderWidget: (id: string) => any;
  currentLayout: any[];
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div data-testid="widgets-grid" ref={gridRef}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <LayoutGrid className="h-5 w-5" />
          Dashboard Widgets
        </h2>
        <span className="text-xs text-muted-foreground">
          {isMobile ? "Scroll to view widgets" : "Drag to reorder, resize from corners"}
        </span>
      </div>
      {width > 0 && (
        <ResponsiveGridLayout
          className="layout"
          layouts={gridLayouts}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
          cols={{ lg: 12, md: 12, sm: 6, xs: 1 }}
          rowHeight={60}
          width={width}
          isDraggable={!isMobile}
          isResizable={!isMobile}
          draggableHandle=".widget-drag-handle"
          onLayoutChange={handleLayoutChange}
          onDragStart={handleDragStart}
          onResizeStart={handleResizeStart}
          compactType="vertical"
          margin={[16, 16]}
        >
          {currentLayout.map(item => (
            <div key={item.i} className="relative group" data-testid={`grid-widget-${item.i}`}>
              {!isMobile && (
                <div className="widget-drag-handle absolute top-1 left-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing p-1 rounded bg-background/80 backdrop-blur-sm border shadow-sm">
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              )}
              {!isMobile && (
                <button
                  className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded bg-background/80 backdrop-blur-sm border shadow-sm hover:bg-destructive/10"
                  onClick={() => handleRemoveWidget(item.i)}
                  title="Remove widget"
                  data-testid={`button-remove-grid-widget-${item.i}`}
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
              {renderWidget(item.i)}
            </div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}

function WidgetLibraryDrawer({
  open,
  onClose,
  activeWidgetIds,
  onAddWidget,
  onRemoveWidget,
  onResetLayout,
}: {
  open: boolean;
  onClose: () => void;
  activeWidgetIds: string[];
  onAddWidget: (id: string) => void;
  onRemoveWidget: (id: string) => void;
  onResetLayout: () => void;
}) {
  const categories = [
    { key: "stats", label: "Stats" },
    { key: "insights", label: "Insights" },
    { key: "tools", label: "Tools" },
  ] as const;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-[340px] sm:w-[380px]" data-testid="drawer-widget-library">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5" />
            Widget Library
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-6 overflow-y-auto max-h-[calc(100vh-160px)] pr-1">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => { onResetLayout(); onClose(); }}
            data-testid="button-reset-layout"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset to Default Layout
          </Button>
          <div className="border-t pt-4" />
          {categories.map(cat => {
            const widgets = WIDGET_DEFS.filter(w => w.category === cat.key);
            return (
              <div key={cat.key}>
                <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 tracking-wider">{cat.label}</h3>
                <div className="space-y-2">
                  {widgets.map(widget => {
                    const isActive = activeWidgetIds.includes(widget.id);
                    const Icon = widget.icon;
                    return (
                      <div
                        key={widget.id}
                        className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                        data-testid={`library-widget-${widget.id}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="p-1.5 rounded-md bg-muted">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{widget.label}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{widget.description}</p>
                          </div>
                        </div>
                        {isActive ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0 text-xs"
                            onClick={() => onRemoveWidget(widget.id)}
                            data-testid={`button-remove-widget-${widget.id}`}
                          >
                            <X className="h-3 w-3 mr-1" />
                            Remove
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="default"
                            className="shrink-0 text-xs"
                            onClick={() => onAddWidget(widget.id)}
                            data-testid={`button-add-widget-${widget.id}`}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Add
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

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

  const savedLayout = useMemo(() => {
    if (!company) return null;
    return migrateLayout(company.dashboardLayout);
  }, [company]);

  const [localLayout, setLocalLayout] = useState<LayoutItem[] | null>(null);
  const initializedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userInteractedRef = useRef(false);

  useEffect(() => {
    if (savedLayout && !initializedRef.current) {
      setLocalLayout(savedLayout);
      initializedRef.current = true;
    } else if (savedLayout && initializedRef.current && !userInteractedRef.current) {
      setLocalLayout(savedLayout);
    }
  }, [savedLayout]);

  const currentLayout = useMemo<LayoutItem[]>(() => {
    if (localLayout !== null) {
      return localLayout.length > 0 ? localLayout : [];
    }
    if (savedLayout !== null) {
      return savedLayout.length > 0 ? savedLayout : [];
    }
    return generateDefaultLayout(DEFAULT_WIDGET_IDS);
  }, [localLayout, savedLayout]);

  const activeWidgetIds = useMemo(() => currentLayout.map(l => l.i), [currentLayout]);

  const saveMutation = useMutation({
    mutationFn: async (layout: LayoutItem[]) => {
      await apiRequest("PATCH", "/api/company", { dashboardLayout: layout });
    },
    onSuccess: () => {
      userInteractedRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save layout", description: err.message, variant: "destructive" });
    },
  });

  const debouncedSave = useCallback((layout: LayoutItem[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveMutation.mutate(layout);
    }, 800);
  }, [saveMutation]);

  const handleLayoutChange = useCallback((_current: any[], allLayouts: { [key: string]: any[] }) => {
    if (!userInteractedRef.current) return;
    const lgLayout = allLayouts.lg;
    if (!lgLayout || lgLayout.length === 0) return;
    const cleaned: LayoutItem[] = lgLayout.map((item: any) => ({
      i: item.i,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      minW: WIDGET_DEFS.find(w => w.id === item.i)?.minW,
      minH: WIDGET_DEFS.find(w => w.id === item.i)?.minH,
    }));
    setLocalLayout(cleaned);
    debouncedSave(cleaned);
  }, [debouncedSave]);

  const handleDragStart = useCallback(() => {
    userInteractedRef.current = true;
  }, []);

  const handleResizeStart = useCallback(() => {
    userInteractedRef.current = true;
  }, []);

  const handleAddWidget = useCallback((id: string) => {
    if (activeWidgetIds.includes(id)) return;
    const def = WIDGET_DEFS.find(w => w.id === id);
    if (!def) return;
    const maxY = currentLayout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
    const newItem: LayoutItem = {
      i: id,
      x: 0,
      y: maxY,
      w: def.defaultW,
      h: def.defaultH,
      minW: def.minW,
      minH: def.minH,
    };
    const newLayout = [...currentLayout, newItem];
    setLocalLayout(newLayout);
    userInteractedRef.current = true;
    saveMutation.mutate(newLayout);
    toast({ title: `${def.label} added to dashboard` });
  }, [currentLayout, activeWidgetIds, saveMutation, toast]);

  const handleRemoveWidget = useCallback((id: string) => {
    const newLayout = currentLayout.filter(item => item.i !== id);
    setLocalLayout(newLayout.length > 0 ? newLayout : []);
    userInteractedRef.current = true;
    saveMutation.mutate(newLayout);
    const def = WIDGET_DEFS.find(w => w.id === id);
    toast({ title: `${def?.label || "Widget"} removed from dashboard` });
  }, [currentLayout, saveMutation, toast]);

  const handleResetLayout = useCallback(() => {
    const defaultLayout = generateDefaultLayout(DEFAULT_WIDGET_IDS);
    setLocalLayout(defaultLayout);
    userInteractedRef.current = true;
    saveMutation.mutate(defaultLayout);
    toast({ title: "Dashboard reset to default layout" });
  }, [saveMutation, toast]);

  const tierKey = stats?.subscriptionTier as keyof typeof TIER_CONFIG | undefined;
  const tierInfo = tierKey ? TIER_CONFIG[tierKey] : null;

  const visitProgress = stats && stats.todaysVisits > 0
    ? Math.round((stats.todaysVisitBreakdown.completed / stats.todaysVisits) * 100)
    : 0;

  const renderWidget = (widgetId: string) => {
    switch (widgetId) {
      case "mrr":
        return (
          <Card className="h-full" data-testid="widget-mrr">
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Monthly Revenue (MRR)</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-mrr">
                  ${fmt(stats?.mrr ?? 0)}
                </div>
              )}
            </CardContent>
          </Card>
        );
      case "month_revenue":
        return (
          <Card className="h-full" data-testid="widget-month-revenue">
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Revenue This Month</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-month-revenue">
                  ${fmt(stats?.monthRevenue ?? 0)}
                </div>
              )}
            </CardContent>
          </Card>
        );
      case "requires_invoicing":
        return (
          <Link href="/invoices?tab=uninvoiced">
            <Card className="h-full cursor-pointer hover:shadow-md transition-shadow" data-testid="widget-requires-invoicing">
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
                      ${fmt(pipeline.requiresInvoicing.totalDollars)} uninvoiced
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        );
      case "overdue_invoices":
        return (
          <Card className="h-full" data-testid="widget-overdue-invoices">
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
        );
      case "todays_visits":
        return (
          <Card className="h-full" data-testid="widget-todays-visits">
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
        );
      case "active_clients":
        return (
          <Card className="h-full" data-testid="widget-active-clients">
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
        );
      case "service_plans":
        return (
          <Card className="h-full" data-testid="widget-service-plans">
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Jobs</CardTitle>
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
        );
      case "team_size":
        return (
          <Card className="h-full" data-testid="widget-team-size">
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
        );
      case "texts_sent":
        return (
          <Card className="h-full" data-testid="widget-texts-sent">
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
        );
      case "emails_sent":
        return (
          <Card className="h-full" data-testid="widget-emails-sent">
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
        );
      case "quick_actions":
        return (
          <Card className="h-full" data-testid="widget-quick-actions">
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
        );
      case "recent_activity":
        return (
          <Card className="h-full" data-testid="widget-recent-activity">
            <CardContent className="p-4 h-full">
              <RecentActivityWidget />
            </CardContent>
          </Card>
        );
      case "upcoming_visits":
        return (
          <Card className="h-full" data-testid="widget-upcoming-visits">
            <CardContent className="p-4 h-full">
              <UpcomingVisitsWidget />
            </CardContent>
          </Card>
        );
      case "revenue_chart":
        return (
          <Card className="h-full" data-testid="widget-revenue-chart">
            <CardContent className="p-4 h-full">
              <RevenueChartWidget />
            </CardContent>
          </Card>
        );
      case "route_summary":
        return (
          <Card className="h-full" data-testid="widget-route-summary">
            <CardContent className="p-4 h-full">
              <RouteSummaryWidget />
            </CardContent>
          </Card>
        );
      case "quick_notes":
        return (
          <Card className="h-full" data-testid="widget-quick-notes">
            <CardContent className="p-4 h-full">
              <QuickNotesWidget />
            </CardContent>
          </Card>
        );
      case "weather_forecast":
        return (
          <Card className="h-full" data-testid="widget-weather-forecast">
            <CardContent className="p-4 h-full">
              <WeatherForecastWidget />
            </CardContent>
          </Card>
        );
      case "route_map_preview":
        return (
          <Card className="h-full" data-testid="widget-route-map-preview">
            <CardContent className="p-4 h-full">
              <RouteMapPreviewWidget />
            </CardContent>
          </Card>
        );
      case "current_plan":
        return (
          <Card className="h-full" data-testid="widget-current-plan">
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Current Plan</CardTitle>
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-full" />
              ) : (
                <div data-testid="text-plan-info">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold">{tierInfo?.name ?? stats?.tierName ?? "Unknown"}</span>
                    <Badge variant="secondary" className="text-[10px]">Active</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    ${fmt(tierInfo?.price ?? 0)}/mo -- Up to {tierInfo?.maxUsers ?? 1} user{(tierInfo?.maxUsers ?? 1) > 1 ? "s" : ""}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        );
      default:
        return null;
    }
  };

  const gridLayouts = useMemo(() => {
    const lgLayout = currentLayout.map(item => ({
      ...item,
      minW: WIDGET_DEFS.find(w => w.id === item.i)?.minW ?? 3,
      minH: WIDGET_DEFS.find(w => w.id === item.i)?.minH ?? 2,
    }));

    const smLayout = currentLayout.map((item, idx) => ({
      ...item,
      x: 0,
      y: idx * 2,
      w: 6,
      minW: 6,
    }));

    const xsLayout = currentLayout.map((item, idx) => ({
      ...item,
      x: 0,
      y: idx * 2,
      w: 1,
      minW: 1,
    }));

    return { lg: lgLayout, md: lgLayout, sm: smLayout, xs: xsLayout };
  }, [currentLayout]);

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-welcome">
            Welcome back, {user?.firstName || "there"}
          </h1>
          <p className="text-muted-foreground">Here is your business overview</p>
        </div>
        <Button
          variant="outline"
          onClick={() => setDrawerOpen(true)}
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

      <ClientRequestsCard />

      <SystemMessagesCard />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          {pipeline && (
            <TodaysAppointments visits={pipeline.todaysVisits} />
          )}
        </div>

        <div>
          {pipelineLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-40" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ) : pipeline ? (
            <BusinessPerformance data={pipeline} />
          ) : null}
        </div>
      </div>

      <RecentCommunications />

      <GridWidgetsSection
        gridLayouts={gridLayouts}
        isMobile={isMobile}
        handleLayoutChange={handleLayoutChange}
        handleDragStart={handleDragStart}
        handleResizeStart={handleResizeStart}
        handleRemoveWidget={handleRemoveWidget}
        renderWidget={renderWidget}
        currentLayout={currentLayout}
      />

      <WidgetLibraryDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeWidgetIds={activeWidgetIds}
        onAddWidget={handleAddWidget}
        onRemoveWidget={handleRemoveWidget}
        onResetLayout={handleResetLayout}
      />
    </div>
  );
}
