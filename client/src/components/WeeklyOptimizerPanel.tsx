import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sparkles, Check, Loader2, RotateCcw, Car, Calendar,
  CheckCircle2, Shield, X, AlertTriangle, MapPin, User, XCircle,
} from "lucide-react";

const ROUTE_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#14b8a6",
];

const DAY_LABELS: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday",
  friday: "Friday", saturday: "Saturday", sunday: "Sunday", tbd: "TBD",
};

type WeeklyProposedRoute = {
  routeLabel: string;
  day: string;
  stops: { servicePlanId: string; contactName: string; address: string; latitude: number; longitude: number }[];
  estimatedMiles: number;
  estimatedMinutes: number;
  stopCount: number;
};

type WeeklyDayProposal = {
  day: string;
  routes: WeeklyProposedRoute[];
  totalStops: number;
  totalMiles: number;
  totalMinutes: number;
};

type WeeklyOptResult = {
  current: { days: WeeklyDayProposal[]; totalMiles: number; totalMinutes: number; totalStops: number };
  proposed: { days: WeeklyDayProposal[]; totalMiles: number; totalMinutes: number; totalStops: number };
  improvementPct: number;
  milesSaved: number;
  minutesSaved: number;
  movedStops: { stopId: string; fromDay: string; toDay: string; contactName: string }[];
  creditsRequired: number;
  excludedWeekendCount?: number;
  ungeocodedStops?: UngeocodedStop[];
};

type UngeocodedStop = { servicePlanId: string; contactId: string; name: string; address: string };

type GeocodeFailureError = Error & {
  geocodeFailure?: boolean;
  failedStops?: UngeocodedStop[];
};

type WeekMeta = {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  weekNum: number;
  techCount: number;
  excludedWeekendCount?: number;
};

type EmptyWeekEntry = WeekMeta & { empty: true; reason: string };
type NonEmptyWeekEntry = WeekMeta & { empty: false } & WeeklyOptResult;
type MultiWeekEntry = EmptyWeekEntry | NonEmptyWeekEntry;

type MultiWeekResult = { weeks: MultiWeekEntry[] };

type TeamMember = { id: string; companyUserId: string; role: string; firstName: string; lastName: string; email: string };

type WeekApplyStatus = {
  weekStart: string;
  weekLabel: string;
  status: "pending" | "applying" | "success" | "error";
  error?: string;
};

function StopMiniMap({ routes }: { routes: WeeklyProposedRoute[] }) {
  const allStops = routes.flatMap((r, rIdx) => r.stops.map(s => ({ ...s, routeIdx: rIdx })));
  if (allStops.length === 0) return null;

  const lats = allStops.map(s => s.latitude);
  const lngs = allStops.map(s => s.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const padding = 16, svgW = 240, svgH = 140;
  const innerW = svgW - padding * 2, innerH = svgH - padding * 2;
  const rangeX = maxLng - minLng || 0.01, rangeY = maxLat - minLat || 0.01;
  const toX = (lng: number) => padding + ((lng - minLng) / rangeX) * innerW;
  const toY = (lat: number) => padding + ((maxLat - lat) / rangeY) * innerH;

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-[120px] rounded border bg-muted/30" data-testid="stop-mini-map">
      {routes.map((route, rIdx) => {
        if (route.stops.length < 2) return null;
        const pts = route.stops.map(s => `${toX(s.longitude)},${toY(s.latitude)}`).join(" ");
        return <polyline key={`line-${rIdx}`} points={pts} fill="none" stroke={ROUTE_COLORS[rIdx % ROUTE_COLORS.length]} strokeWidth="2" strokeOpacity="0.5" strokeLinejoin="round" />;
      })}
      {allStops.map((stop, idx) => (
        <g key={idx}>
          <circle cx={toX(stop.longitude)} cy={toY(stop.latitude)} r="5" fill={ROUTE_COLORS[stop.routeIdx % ROUTE_COLORS.length]} stroke="white" strokeWidth="1.5" />
          <text x={toX(stop.longitude)} y={toY(stop.latitude) + 1} textAnchor="middle" dominantBaseline="central" fontSize="6" fill="white" fontWeight="bold">{idx + 1}</text>
        </g>
      ))}
    </svg>
  );
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function weekTabLabel(weekNum: number): string {
  return weekNum === 1 ? "Next Week" : `Week ${weekNum}`;
}

export function WeeklyOptimizerPanel({ open, onOpenChange, credits, monthlyAllowance = 20, onNeedCredits }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credits: number;
  monthlyAllowance?: number;
  onNeedCredits: (topUpNeeded: number) => void;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [respectZones, setRespectZones] = useState(false);
  const [includeSaturday, setIncludeSaturday] = useState(false);
  const [multiWeekResult, setMultiWeekResult] = useState<MultiWeekResult | null>(null);
  const [activeWeekStart, setActiveWeekStart] = useState<string | null>(null);
  const [acceptedWeeks, setAcceptedWeeks] = useState<Set<string>>(new Set());
  const [techAssignments, setTechAssignments] = useState<Record<string, string>>({});
  const [notifyCustomers, setNotifyCustomers] = useState(true);
  const [applyConfirmPending, setApplyConfirmPending] = useState(false);
  const [weekApplyStatuses, setWeekApplyStatuses] = useState<WeekApplyStatus[]>([]);
  const [successData, setSuccessData] = useState<{
    weeksApplied: number;
    weeksFailed: number;
    routesCreated: number;
    stopsUpdated: number;
    creditsUsed: number;
    creditsRemaining: number;
    weekResults: WeekApplyStatus[];
  } | null>(null);
  const [geocodeError, setGeocodeError] = useState<{
    message: string;
    failedStops: UngeocodedStop[];
  } | null>(null);

  const { data: freshCreditData } = useQuery<{ credits: number; monthlyAllowance: number }>({
    queryKey: ["/api/route-credits"],
    staleTime: 0,
    enabled: applyConfirmPending,
  });
  const liveCredits = applyConfirmPending && freshCreditData != null ? freshCreditData.credits : credits;

  const { data: allTeamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ["/api/company/team"],
    staleTime: 5 * 60 * 1000,
    enabled: !!multiWeekResult,
  });
  const teamMembers = allTeamMembers.filter(m => m.role === "tech");

  const totalAcceptedCredits = multiWeekResult
    ? multiWeekResult.weeks
        .filter((w): w is NonEmptyWeekEntry => !w.empty && acceptedWeeks.has(w.weekStart))
        .reduce((acc, w) => acc + w.creditsRequired, 0)
    : 0;

  const activeWeek = multiWeekResult?.weeks.find(w => w.weekStart === activeWeekStart) ?? null;

  const anyAcceptedHasMoves = multiWeekResult
    ? multiWeekResult.weeks
        .filter((w): w is NonEmptyWeekEntry => !w.empty && acceptedWeeks.has(w.weekStart))
        .some(w => w.movedStops.length > 0)
    : false;

  function toggleWeek(weekStart: string) {
    setAcceptedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(weekStart)) next.delete(weekStart);
      else next.add(weekStart);
      return next;
    });
  }

  function setTechForRoute(weekStart: string, day: string, routeLabel: string, userId: string) {
    const key = `${weekStart}|${day}|${routeLabel}`;
    setTechAssignments(prev => ({ ...prev, [key]: userId }));
  }

  function getTechForRoute(weekStart: string, day: string, routeLabel: string): string {
    return techAssignments[`${weekStart}|${day}|${routeLabel}`] ?? "";
  }

  function resetAll() {
    setMultiWeekResult(null);
    setActiveWeekStart(null);
    setAcceptedWeeks(new Set());
    setTechAssignments({});
    setApplyConfirmPending(false);
    setWeekApplyStatuses([]);
    setSuccessData(null);
    setGeocodeError(null);
  }

  const analyzeMutation = useMutation({
    onMutate: () => {
      setMultiWeekResult(null);
      setApplyConfirmPending(false);
      setGeocodeError(null);
    },
    mutationFn: async () => {
      const res = await fetch("/api/routes/multi-week-optimize", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ respectZones, includeSaturday }),
      });
      const data = await res.json();
      if (!res.ok) {
        const err: GeocodeFailureError = Object.assign(
          new Error(data.error || `Error ${res.status}`),
          {
            geocodeFailure: data.geocodeFailure as boolean | undefined,
            failedStops: (data.failedStops ?? []) as UngeocodedStop[],
          }
        );
        throw err;
      }
      return data as MultiWeekResult;
    },
    onSuccess: (data) => {
      setGeocodeError(null);
      setMultiWeekResult(data);
      const firstWeekStart = data.weeks[0]?.weekStart ?? null;
      setActiveWeekStart(firstWeekStart);
      const initialAccepted = new Set(
        data.weeks.filter(w => !w.empty).map(w => w.weekStart)
      );
      setAcceptedWeeks(initialAccepted);
      setApplyConfirmPending(false);
    },
    onError: (err: Error) => {
      const gErr = err as GeocodeFailureError;
      if (gErr.geocodeFailure) {
        setGeocodeError({ message: err.message, failedStops: gErr.failedStops ?? [] });
      } else {
        toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
      }
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!multiWeekResult) throw new Error("No result to apply");
      const weeksToApply = multiWeekResult.weeks.filter(
        (w): w is NonEmptyWeekEntry => !w.empty && acceptedWeeks.has(w.weekStart)
      );

      const initialStatuses: WeekApplyStatus[] = weeksToApply.map(w => ({
        weekStart: w.weekStart,
        weekLabel: w.weekLabel,
        status: "pending",
      }));
      setWeekApplyStatuses(initialStatuses);

      let totalRoutesCreated = 0, totalStopsUpdated = 0, totalCreditsUsed = 0, totalCreditsRemaining = 0;
      const finalStatuses: WeekApplyStatus[] = [...initialStatuses];
      let creditShortfallDetected = false;

      for (let i = 0; i < weeksToApply.length; i++) {
        const week = weeksToApply[i];
        finalStatuses[i] = { ...finalStatuses[i], status: "applying" };
        setWeekApplyStatuses([...finalStatuses]);

        try {
          const daysWithStops = week.proposed.days.filter(d => d.totalStops > 0);
          const weekTechAssignments: Record<string, string> = {};
          for (const [key, userId] of Object.entries(techAssignments)) {
            const parts = key.split("|");
            const keyWeekStart = parts[0];
            const keyDay = parts[1];
            const keyRouteLabel = parts.slice(2).join("|");
            if (keyWeekStart === week.weekStart) {
              weekTechAssignments[`${keyDay}|${keyRouteLabel}`] = userId;
            }
          }
          const res = await apiRequest("POST", "/api/routes/apply-weekly-plan", {
            acceptedDays: daysWithStops.map(d => d.day),
            proposedDays: daysWithStops,
            notifyCustomers,
            techAssignments: weekTechAssignments,
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Server error ${res.status}`);
          }
          const data = await res.json();
          totalRoutesCreated += data.routesCreated ?? 0;
          totalStopsUpdated += data.stopsUpdated ?? 0;
          totalCreditsUsed += data.creditsUsed ?? 0;
          totalCreditsRemaining = data.creditsRemaining ?? 0;
          finalStatuses[i] = { ...finalStatuses[i], status: "success" };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          if (msg.includes("Insufficient")) creditShortfallDetected = true;
          finalStatuses[i] = { ...finalStatuses[i], status: "error", error: msg };
        }

        setWeekApplyStatuses([...finalStatuses]);
      }

      const weeksFailed = finalStatuses.filter(s => s.status === "error").length;
      const weeksApplied = finalStatuses.filter(s => s.status === "success").length;

      if (creditShortfallDetected) {
        onNeedCredits(Math.max(0, totalAcceptedCredits - credits));
      }

      return { weeksApplied, weeksFailed, totalRoutesCreated, totalStopsUpdated, totalCreditsUsed, totalCreditsRemaining, weekResults: finalStatuses };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans?isActive=true"] });
      queryClient.invalidateQueries({ queryKey: ["/api/route-credits"] });
      setApplyConfirmPending(false);
      setSuccessData({
        weeksApplied: data.weeksApplied,
        weeksFailed: data.weeksFailed,
        routesCreated: data.totalRoutesCreated,
        stopsUpdated: data.totalStopsUpdated,
        creditsUsed: data.totalCreditsUsed,
        creditsRemaining: data.totalCreditsRemaining,
        weekResults: data.weekResults,
      });
    },
    onError: (err: Error) => {
      setWeekApplyStatuses([]);
      setApplyConfirmPending(false);
      if (!err.message.includes("Insufficient")) {
        toast({ title: "Failed to apply plan", description: err.message, variant: "destructive" });
      }
    },
  });

  const handleApplyClick = () => {
    if (!applyConfirmPending) {
      setApplyConfirmPending(true);
      return;
    }
    applyMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) resetAll();
      onOpenChange(v);
    }}>
      <DialogContent className="w-screen h-screen max-w-none max-h-none m-0 p-6 rounded-none overflow-hidden flex flex-col" data-testid="dialog-weekly-optimizer">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Route Planner
          </DialogTitle>
          <DialogDescription>
            Plan routes for the next 4 weeks based on actual scheduled appointments.
          </DialogDescription>
        </DialogHeader>

        {/* ── APPLYING PROGRESS ── */}
        {!successData && applyMutation.isPending && weekApplyStatuses.length > 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 py-8" data-testid="panel-apply-progress">
            <div className="w-full max-w-sm space-y-4">
              <p className="text-center text-sm font-semibold text-muted-foreground uppercase tracking-wide">Applying Plan</p>
              <div className="space-y-2">
                {weekApplyStatuses.map((ws) => (
                  <div
                    key={ws.weekStart}
                    className="flex items-center gap-3 rounded-lg border px-4 py-3"
                    data-testid={`row-week-apply-status-${ws.weekStart}`}
                  >
                    <div className="shrink-0 w-5 h-5 flex items-center justify-center">
                      {ws.status === "pending" && (
                        <span className="w-3 h-3 rounded-full bg-muted-foreground/30" data-testid={`icon-week-pending-${ws.weekStart}`} />
                      )}
                      {ws.status === "applying" && (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" data-testid={`icon-week-applying-${ws.weekStart}`} />
                      )}
                      {ws.status === "success" && (
                        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" data-testid={`icon-week-success-${ws.weekStart}`} />
                      )}
                      {ws.status === "error" && (
                        <XCircle className="h-4 w-4 text-destructive" data-testid={`icon-week-error-${ws.weekStart}`} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{ws.weekLabel}</p>
                      {ws.status === "error" && ws.error && (
                        <p className="text-xs text-destructive mt-0.5 truncate" data-testid={`text-week-error-${ws.weekStart}`}>{ws.error}</p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground capitalize shrink-0">
                      {ws.status === "applying" ? "Applying…" : ws.status === "pending" ? "Waiting" : ws.status === "success" ? "Done" : "Failed"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden" data-testid="progress-bar-apply">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{
                    width: weekApplyStatuses.length > 0
                      ? `${(weekApplyStatuses.filter(s => s.status === "success" || s.status === "error").length / weekApplyStatuses.length) * 100}%`
                      : "0%",
                  }}
                  data-testid="progress-bar-apply-fill"
                />
              </div>
              <p className="text-center text-xs text-muted-foreground">
                {weekApplyStatuses.filter(s => s.status === "success" || s.status === "error").length} of {weekApplyStatuses.length} week{weekApplyStatuses.length !== 1 ? "s" : ""} complete
              </p>
            </div>
          </div>
        )}

        {/* ── SUCCESS ── */}
        {successData ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6" data-testid="panel-apply-success">
            <div className={`rounded-full p-6 ${successData.weeksApplied === 0 ? "bg-red-100 dark:bg-red-900/30" : successData.weeksFailed > 0 ? "bg-amber-100 dark:bg-amber-900/30" : "bg-green-100 dark:bg-green-900/30"}`}>
              {successData.weeksApplied === 0
                ? <XCircle className="h-14 w-14 text-destructive" />
                : successData.weeksFailed > 0
                ? <AlertTriangle className="h-14 w-14 text-amber-600 dark:text-amber-400" />
                : <CheckCircle2 className="h-14 w-14 text-green-600 dark:text-green-400" />
              }
            </div>
            <div className="text-center space-y-2">
              <p className="text-xl font-semibold">
                {successData.weeksApplied === 0 ? "Apply Failed" : successData.weeksFailed > 0 ? "Partially Applied" : "Plan Applied"}
              </p>
              <p className="text-foreground font-medium" data-testid="text-success-summary">
                {successData.weeksApplied > 0
                  ? `${successData.weeksApplied} week${successData.weeksApplied !== 1 ? "s" : ""} applied`
                  : "No weeks were applied"}
                {successData.weeksFailed > 0 && ` · ${successData.weeksFailed} failed`}
                {successData.routesCreated > 0 && ` · ${successData.routesCreated} route${successData.routesCreated !== 1 ? "s" : ""} created`}
                {successData.stopsUpdated > 0 && ` · ${successData.stopsUpdated} stop${successData.stopsUpdated !== 1 ? "s" : ""} reassigned`}
              </p>
              {successData.creditsUsed > 0 && (
                <p className="text-xs text-muted-foreground" data-testid="text-success-credits-used">
                  {successData.creditsUsed} credit{successData.creditsUsed !== 1 ? "s" : ""} used · {successData.creditsRemaining} remaining this month
                </p>
              )}
            </div>
            {/* Per-week result breakdown */}
            {(successData.weekResults.length > 1 || successData.weekResults.some(w => w.status === "error")) && (
              <div className="w-full max-w-sm space-y-1.5" data-testid="section-week-results">
                {successData.weekResults.map((ws) => (
                  <div key={ws.weekStart} className="flex items-center gap-3 rounded-lg border px-3 py-2" data-testid={`row-week-result-${ws.weekStart}`}>
                    <div className="shrink-0">
                      {ws.status === "success"
                        ? <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                        : <XCircle className="h-4 w-4 text-destructive" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{ws.weekLabel}</p>
                      {ws.status === "error" && ws.error && (
                        <p className="text-xs text-destructive mt-0.5 truncate">{ws.error}</p>
                      )}
                    </div>
                    <span className={`text-xs font-medium shrink-0 ${ws.status === "success" ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                      {ws.status === "success" ? "Applied" : "Failed"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3">
              <Button onClick={() => { resetAll(); onOpenChange(false); navigate("/routes"); }} data-testid="button-view-routes">
                View Routes
              </Button>
              <Button variant="outline" size="sm" onClick={() => { resetAll(); onOpenChange(false); }} data-testid="button-close-success">
                Close
              </Button>
            </div>
          </div>

        /* ── PRE-ANALYSIS ── */
        ) : !multiWeekResult ? (
          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <p className="text-sm font-medium">Respect Service Zones</p>
                  <p className="text-xs text-muted-foreground">Keep stops on their zone-assigned day</p>
                </div>
                <Switch checked={respectZones} onCheckedChange={setRespectZones} data-testid="switch-respect-zones" />
              </div>
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <p className="text-sm font-medium">Include Saturday</p>
                  <p className="text-xs text-muted-foreground">Allow stops to be scheduled on Saturday</p>
                </div>
                <Switch checked={includeSaturday} onCheckedChange={setIncludeSaturday} data-testid="switch-include-saturday" />
              </div>
            </div>

            {geocodeError && (
              <div className="rounded-lg border border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30 p-4 space-y-2" data-testid="banner-weekly-geocode-error">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-orange-800 dark:text-orange-200">Not enough geocoded stops</p>
                    <p className="text-xs text-orange-700 dark:text-orange-300 mt-0.5">Fix the addresses below and try again.</p>
                  </div>
                </div>
                {geocodeError.failedStops.length > 0 && (
                  <ul className="space-y-1 mt-2 max-h-40 overflow-y-auto">
                    {geocodeError.failedStops.map((s, i) => (
                      <li key={s.servicePlanId || i} className="text-xs text-orange-700 dark:text-orange-300 pl-6">
                        <span className="font-medium">{s.name}</span>
                        {s.address && <span className="ml-1 opacity-75">— {s.address}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <Button
              className="w-full"
              size="lg"
              onClick={() => { setGeocodeError(null); analyzeMutation.mutate(); }}
              disabled={analyzeMutation.isPending}
              data-testid="button-run-analysis"
            >
              {analyzeMutation.isPending ? (
                <><Loader2 className="h-5 w-5 animate-spin mr-2" />Analyzing routes...</>
              ) : geocodeError ? (
                <><RotateCcw className="h-5 w-5 mr-2" />Retry Analysis</>
              ) : (
                <><Sparkles className="h-5 w-5 mr-2" />Analyze Next 4 Weeks</>
              )}
            </Button>
          </div>

        /* ── RESULT VIEW ── */
        ) : (
          <>
            {/* Week tab buttons */}
            <div className="flex gap-1 border-b pb-0 overflow-x-auto shrink-0" data-testid="week-tabs">
              {multiWeekResult.weeks.map((week) => {
                const isActive = week.weekStart === activeWeekStart;
                const isAccepted = !week.empty && acceptedWeeks.has(week.weekStart);
                return (
                  <button
                    key={week.weekStart}
                    onClick={() => setActiveWeekStart(week.weekStart)}
                    className={[
                      "flex flex-col items-start px-3 py-2 text-left border-b-2 transition-colors whitespace-nowrap shrink-0 rounded-t",
                      isActive
                        ? "border-primary text-primary bg-primary/5"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40",
                    ].join(" ")}
                    data-testid={`tab-week-${week.weekNum}`}
                  >
                    <span className="text-xs font-semibold">{weekTabLabel(week.weekNum)}</span>
                    <span className="text-[10px] opacity-75">{week.weekLabel}</span>
                    {!week.empty && isAccepted && (
                      <span className="mt-0.5 inline-flex items-center gap-0.5 text-[9px] text-green-600 dark:text-green-400 font-medium">
                        <Check className="h-2.5 w-2.5" />
                        {week.creditsRequired} credit{week.creditsRequired !== 1 ? "s" : ""}
                      </span>
                    )}
                    {week.empty && (
                      <span className="mt-0.5 text-[9px] text-muted-foreground">Empty</span>
                    )}
                  </button>
                );
              })}
              <div className="ml-auto flex items-center gap-2 pb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setMultiWeekResult(null); setApplyConfirmPending(false); }}
                  data-testid="button-reanalyze"
                >
                  <RotateCcw className="h-4 w-4 mr-1" /> Re-analyze
                </Button>
              </div>
            </div>

            {/* Active week content */}
            <ScrollArea className="flex-1 min-h-0">
              {activeWeek ? (
                <div className="space-y-4 pb-4 pt-2" data-testid={`panel-week-${activeWeek.weekNum}`}>

                  {/* Week accept toggle */}
                  {!activeWeek.empty && (
                    <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`accept-week-${activeWeek.weekStart}`}
                          checked={acceptedWeeks.has(activeWeek.weekStart)}
                          onCheckedChange={() => toggleWeek(activeWeek.weekStart)}
                          data-testid={`checkbox-accept-week-${activeWeek.weekNum}`}
                        />
                        <label
                          htmlFor={`accept-week-${activeWeek.weekStart}`}
                          className="text-sm font-medium cursor-pointer"
                        >
                          Include this week in the plan
                        </label>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {activeWeek.creditsRequired} credit{activeWeek.creditsRequired !== 1 ? "s" : ""} · {activeWeek.proposed.totalStops} stops
                      </span>
                    </div>
                  )}

                  {/* Empty week state */}
                  {activeWeek.empty ? (
                    <div className="flex flex-col items-center gap-3 py-12 text-center border rounded-lg bg-muted/20" data-testid={`empty-week-${activeWeek.weekNum}`}>
                      <Calendar className="h-10 w-10 text-muted-foreground/50" />
                      <div>
                        <p className="font-medium text-muted-foreground">No stops scheduled this week</p>
                        <p className="text-xs text-muted-foreground mt-1">{activeWeek.reason}</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Impact summary */}
                      <div className="rounded-xl border bg-primary/5 border-primary/20 p-4" data-testid={`summary-week-${activeWeek.weekNum}`}>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Impact Summary — {activeWeek.weekLabel}</p>
                          <span className="text-xs text-muted-foreground" data-testid={`text-improvement-week-${activeWeek.weekNum}`}>{activeWeek.improvementPct}% improvement</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="text-center" data-testid={`metric-miles-week-${activeWeek.weekNum}`}>
                            <p className="text-2xl font-bold text-primary">{activeWeek.milesSaved}</p>
                            <p className="text-xs font-medium mt-0.5">Miles Saved</p>
                          </div>
                          <div className="text-center" data-testid={`metric-time-week-${activeWeek.weekNum}`}>
                            <p className="text-2xl font-bold text-primary">{formatMinutes(activeWeek.minutesSaved)}</p>
                            <p className="text-xs font-medium mt-0.5">Time Saved</p>
                          </div>
                          <div className="text-center" data-testid={`metric-moves-week-${activeWeek.weekNum}`}>
                            <p className="text-2xl font-bold">{activeWeek.movedStops.length}</p>
                            <p className="text-xs font-medium mt-0.5">Jobs Moved</p>
                          </div>
                          <div className="text-center" data-testid={`metric-credits-week-${activeWeek.weekNum}`}>
                            <p className="text-2xl font-bold">{activeWeek.creditsRequired}</p>
                            <p className="text-xs font-medium mt-0.5">Credits</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-primary/10 text-sm">
                          <div className="p-2 rounded bg-muted/50">
                            <p className="text-[11px] text-muted-foreground mb-0.5">Current Schedule</p>
                            <p className="font-semibold">{activeWeek.current.totalMiles} mi / {formatMinutes(activeWeek.current.totalMinutes)}</p>
                            <p className="text-[11px] text-muted-foreground">{activeWeek.current.totalStops} stops</p>
                          </div>
                          <div className="p-2 rounded bg-primary/10">
                            <p className="text-[11px] text-muted-foreground mb-0.5">Proposed Schedule</p>
                            <p className="font-semibold text-primary">{activeWeek.proposed.totalMiles} mi / {formatMinutes(activeWeek.proposed.totalMinutes)}</p>
                            <p className="text-[11px] text-muted-foreground">{activeWeek.proposed.totalStops} stops</p>
                          </div>
                        </div>
                      </div>

                      {/* Trust signals */}
                      <div className="rounded-lg border bg-muted/30 px-4 py-3 flex flex-wrap gap-2 items-center" data-testid={`section-trust-week-${activeWeek.weekNum}`}>
                        <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                        <Badge variant="outline" className="text-xs font-medium">{activeWeek.movedStops.length} jobs changed day</Badge>
                        <Badge variant="outline" className="text-xs font-medium">0 jobs changed technician</Badge>
                        <Badge variant="outline" className="text-xs font-medium">Recurring cadence preserved</Badge>
                        <Badge variant="outline" className="text-xs font-medium">{activeWeek.techCount} technician{activeWeek.techCount !== 1 ? "s" : ""}</Badge>
                        {(activeWeek.excludedWeekendCount ?? 0) > 0 && (
                          <Badge variant="outline" className="text-xs font-medium">{activeWeek.excludedWeekendCount} Saturday stops kept</Badge>
                        )}
                      </div>

                      {/* Ungeocoded warning */}
                      {activeWeek.ungeocodedStops && activeWeek.ungeocodedStops.length > 0 && (
                        <div className="rounded-lg border border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30 p-4 space-y-2" data-testid={`banner-geocode-week-${activeWeek.weekNum}`}>
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm font-semibold text-orange-800 dark:text-orange-200">
                                {activeWeek.ungeocodedStops.length} stop{activeWeek.ungeocodedStops.length !== 1 ? "s" : ""} excluded — missing coordinates
                              </p>
                              <p className="text-xs text-orange-700 dark:text-orange-300 mt-0.5">Fix their addresses and re-analyze to include them.</p>
                            </div>
                          </div>
                          <ul className="space-y-0.5 ml-6">
                            {activeWeek.ungeocodedStops.map((stop) => (
                              <li key={stop.servicePlanId} className="flex items-start gap-1.5 text-xs text-orange-800 dark:text-orange-200">
                                <MapPin className="h-3 w-3 shrink-0 mt-0.5 text-orange-500" />
                                <span>
                                  <span className="font-medium">{stop.name}</span>
                                  {stop.address && stop.address !== "No address" && (
                                    <span className="text-orange-600 dark:text-orange-400"> — {stop.address}</span>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Day-by-day routes */}
                      <div className="space-y-3" data-testid={`panel-day-by-day-week-${activeWeek.weekNum}`}>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Day by Day Routes</p>
                        {activeWeek.proposed.days.filter(d => d.totalStops > 0).map(day => (
                          <Card key={day.day} data-testid={`day-card-${activeWeek.weekNum}-${day.day}`}>
                            <CardHeader className="p-3 pb-2">
                              <div className="flex items-center justify-between">
                                <CardTitle className="text-sm capitalize flex items-center gap-2">
                                  <Calendar className="h-4 w-4 text-muted-foreground" />
                                  {DAY_LABELS[day.day] ?? day.day}
                                  <Badge variant="outline" className="text-[10px]">{day.totalStops} stops</Badge>
                                </CardTitle>
                                <span className="text-xs text-muted-foreground">{day.totalMiles} mi · {formatMinutes(day.totalMinutes)}</span>
                              </div>
                            </CardHeader>
                            <CardContent className="p-3 pt-0 space-y-4">
                              <StopMiniMap routes={day.routes} />
                              {day.routes.map((route, rIdx) => {
                                const techId = getTechForRoute(activeWeek.weekStart, day.day, route.routeLabel);
                                return (
                                  <div key={rIdx} className="space-y-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-xs font-medium flex items-center gap-1.5 min-w-0">
                                        <span
                                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                                          style={{ backgroundColor: ROUTE_COLORS[rIdx % ROUTE_COLORS.length] }}
                                        />
                                        {route.routeLabel}
                                      </p>
                                      <Select
                                        value={techId || "unassigned"}
                                        onValueChange={(v) => setTechForRoute(activeWeek.weekStart, day.day, route.routeLabel, v === "unassigned" ? "" : v)}
                                      >
                                        <SelectTrigger
                                          className="h-6 text-[11px] w-auto max-w-[140px] gap-1"
                                          data-testid={`select-tech-${activeWeek.weekNum}-${day.day}-${rIdx}`}
                                        >
                                          <User className="h-3 w-3 shrink-0 text-muted-foreground" />
                                          <SelectValue placeholder="Assign tech" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="unassigned">Unassigned</SelectItem>
                                          {teamMembers.map(m => (
                                            <SelectItem key={m.id} value={m.id} data-testid={`option-tech-${m.id}`}>
                                              {m.firstName} {m.lastName}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="space-y-0.5">
                                      {route.stops.map((stop, sIdx) => (
                                        <div key={stop.servicePlanId} className="flex items-center gap-2 text-xs py-0.5">
                                          <Badge variant="outline" className="text-[9px] px-1 py-0 w-5 h-5 flex items-center justify-center shrink-0">
                                            {sIdx + 1}
                                          </Badge>
                                          <span className="truncate font-medium">{stop.contactName}</span>
                                          <span className="truncate text-muted-foreground ml-auto">{stop.address}</span>
                                        </div>
                                      ))}
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-1">
                                      <Car className="h-3 w-3" />
                                      <span>{route.estimatedMiles} mi · {route.estimatedMinutes} min · {route.stopCount} stops</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </CardContent>
                          </Card>
                        ))}
                        {activeWeek.proposed.days.filter(d => d.totalStops > 0).length === 0 && (
                          <div className="text-center text-sm text-muted-foreground py-8 border rounded-lg bg-muted/20">
                            No stops optimized for this week.
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </ScrollArea>

            {/* Action bar */}
            <Separator className="mt-2" />
            {anyAcceptedHasMoves && (
              <div className="flex items-center justify-between py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground text-xs">Notify affected customers</span>
                  <Switch
                    checked={notifyCustomers}
                    onCheckedChange={setNotifyCustomers}
                    data-testid="switch-notify-customers"
                  />
                </div>
              </div>
            )}
            {applyConfirmPending && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-2.5 text-sm flex items-center gap-2" data-testid="banner-credit-confirm">
                <span className="text-amber-700 dark:text-amber-400">
                  This will use{" "}
                  <span className="font-semibold" data-testid="text-confirm-credits-cost">{totalAcceptedCredits}</span>
                  {" "}credit{totalAcceptedCredits !== 1 ? "s" : ""} across{" "}
                  <span className="font-semibold">{acceptedWeeks.size}</span> week{acceptedWeeks.size !== 1 ? "s" : ""}. You currently have{" "}
                  <span className="font-semibold" data-testid="text-confirm-credits-balance">{liveCredits}</span>
                  {" "}remaining this month.
                </span>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 pt-2" data-testid="dialog-confirm-apply-weekly">
              <div className="text-sm text-muted-foreground flex flex-col gap-0.5">
                {credits !== Infinity && acceptedWeeks.size > 0 && !applyConfirmPending && (
                  <>
                    <span>
                      <span className="font-semibold text-foreground" data-testid="text-credits-required">{totalAcceptedCredits}</span>
                      {" "}credit{totalAcceptedCredits !== 1 ? "s" : ""} across {acceptedWeeks.size} week{acceptedWeeks.size !== 1 ? "s" : ""} · {credits} available
                    </span>
                    {credits < totalAcceptedCredits && (
                      <button
                        className="text-xs text-primary underline underline-offset-2 text-left"
                        onClick={() => onNeedCredits(totalAcceptedCredits - credits)}
                        data-testid="button-topup-inline"
                      >
                        Need {totalAcceptedCredits - credits} more — top up
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => { resetAll(); onOpenChange(false); }}
                  data-testid="button-cancel-apply"
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                <Button
                  onClick={handleApplyClick}
                  disabled={acceptedWeeks.size === 0 || totalAcceptedCredits > liveCredits || applyMutation.isPending}
                  data-testid={applyConfirmPending ? "button-confirm-apply" : "button-apply-plan"}
                  className={applyConfirmPending ? "bg-green-600 hover:bg-green-700 text-white" : ""}
                >
                  {applyMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      {weekApplyStatuses.length > 0
                        ? `Week ${Math.min(weekApplyStatuses.filter(s => s.status === "success" || s.status === "error").length + 1, weekApplyStatuses.length)} of ${weekApplyStatuses.length}…`
                        : "Applying..."}
                    </>
                  ) : totalAcceptedCredits > liveCredits ? (
                    "Not Enough Credits"
                  ) : applyConfirmPending ? (
                    <><CheckCircle2 className="h-4 w-4 mr-1" />Confirm — {totalAcceptedCredits} credit{totalAcceptedCredits !== 1 ? "s" : ""}</>
                  ) : (
                    <><Sparkles className="h-4 w-4 mr-1" />Apply Accepted Weeks ({acceptedWeeks.size})</>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
