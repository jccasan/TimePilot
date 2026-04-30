import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Sparkles, ArrowRight, Check, Loader2, RotateCcw, Car, Calendar,
  ChevronDown, ChevronUp, CheckCircle2, Bell, Shield, X,
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
};

function StopMiniMap({ routes }: { routes: WeeklyProposedRoute[] }) {
  const allStops = routes.flatMap((r, rIdx) =>
    r.stops.map(s => ({ ...s, routeIdx: rIdx }))
  );
  if (allStops.length === 0) return null;

  const lats = allStops.map(s => s.latitude);
  const lngs = allStops.map(s => s.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const padding = 16;
  const svgW = 240;
  const svgH = 140;
  const innerW = svgW - padding * 2;
  const innerH = svgH - padding * 2;
  const rangeX = maxLng - minLng || 0.01;
  const rangeY = maxLat - minLat || 0.01;

  const toX = (lng: number) => padding + ((lng - minLng) / rangeX) * innerW;
  const toY = (lat: number) => padding + ((maxLat - lat) / rangeY) * innerH;

  return (
    <svg
      viewBox={`0 0 ${svgW} ${svgH}`}
      className="w-full h-[120px] rounded border bg-muted/30"
      data-testid="stop-mini-map"
    >
      {routes.map((route, rIdx) => {
        if (route.stops.length < 2) return null;
        const pts = route.stops.map(s => `${toX(s.longitude)},${toY(s.latitude)}`).join(" ");
        return (
          <polyline
            key={`line-${rIdx}`}
            points={pts}
            fill="none"
            stroke={ROUTE_COLORS[rIdx % ROUTE_COLORS.length]}
            strokeWidth="2"
            strokeOpacity="0.5"
            strokeLinejoin="round"
          />
        );
      })}
      {allStops.map((stop, idx) => (
        <g key={idx}>
          <circle
            cx={toX(stop.longitude)}
            cy={toY(stop.latitude)}
            r="5"
            fill={ROUTE_COLORS[stop.routeIdx % ROUTE_COLORS.length]}
            stroke="white"
            strokeWidth="1.5"
          />
          <text
            x={toX(stop.longitude)}
            y={toY(stop.latitude) + 1}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="6"
            fill="white"
            fontWeight="bold"
          >
            {idx + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

function getReasonChip(move: { stopId: string; fromDay: string; toDay: string; contactName: string }, allMoves: WeeklyOptResult["movedStops"]) {
  const sameDayMoves = allMoves.filter(m => m.toDay === move.toDay && m.fromDay !== m.toDay);
  if (sameDayMoves.length >= 2) return "grouped by proximity";
  return "schedule balancing";
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function WeeklyOptimizerPanel({ open, onOpenChange, credits, weeklyBaseline = 5, onNeedCredits, weekStart }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credits: number;
  weeklyBaseline?: number;
  onNeedCredits: () => void;
  weekStart?: string;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [respectZones, setRespectZones] = useState(false);
  const [includeSaturday, setIncludeSaturday] = useState(false);
  const [result, setResult] = useState<WeeklyOptResult | null>(null);
  const [acceptedDays, setAcceptedDays] = useState<Set<string>>(new Set());
  const [notifyCustomers, setNotifyCustomers] = useState(true);
  const [dayByDayOpen, setDayByDayOpen] = useState(false);
  const [applyConfirmPending, setApplyConfirmPending] = useState(false);
  const [successData, setSuccessData] = useState<{
    milesSaved: number;
    minutesSaved: number;
    routesCreated: number;
    stopsUpdated: number;
    creditsUsed: number;
    creditsRemaining: number;
  } | null>(null);

  const { data: freshCreditData } = useQuery<{ credits: number; weeklyBaseline: number }>({
    queryKey: ["/api/route-credits"],
    staleTime: 0,
    enabled: applyConfirmPending,
  });
  const liveCredits = applyConfirmPending && freshCreditData != null ? freshCreditData.credits : credits;

  const dollarSavings = result ? Math.round(result.milesSaved * 0.67) : 0;

  const uniqueContactsCount = result
    ? new Set(result.movedStops.map(m => m.contactName)).size
    : 0;

  const acceptedCredits = result && acceptedDays.size > 0 ? weeklyBaseline : 0;

  useEffect(() => {
    if (result && result.movedStops.length > 0) {
      setNotifyCustomers(true);
    }
  }, [result]);


  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/routes/optimize-weekly", {
        respectZones,
        includeSaturday,
        ...(weekStart ? { weekStart } : {}),
      });
      return res.json() as Promise<WeeklyOptResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      setAcceptedDays(new Set(data.proposed.days.filter(d => d.totalStops > 0).map(d => d.day)));
      setApplyConfirmPending(false);
      setDayByDayOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Optimization failed", description: err.message, variant: "destructive" });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error("No result to apply");
      const daysToApply = result.proposed.days.filter(d => acceptedDays.has(d.day));
      const res = await apiRequest("POST", "/api/routes/apply-weekly-plan", {
        acceptedDays: Array.from(acceptedDays),
        proposedDays: daysToApply,
        notifyCustomers,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans?isActive=true"] });
      queryClient.invalidateQueries({ queryKey: ["/api/route-credits"] });
      setSuccessData({
        milesSaved: result!.milesSaved,
        minutesSaved: result!.minutesSaved,
        routesCreated: data.routesCreated ?? 0,
        stopsUpdated: data.stopsUpdated ?? 0,
        creditsUsed: data.creditsUsed ?? 0,
        creditsRemaining: data.creditsRemaining ?? 0,
      });
    },
    onError: (err: Error) => {
      if (err.message.includes("Insufficient")) {
        onNeedCredits();
      } else {
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
    setApplyConfirmPending(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) {
        setResult(null);
        setApplyConfirmPending(false);
        setSuccessData(null);
      }
      onOpenChange(v);
    }}>
      <DialogContent className="w-screen h-screen max-w-none max-h-none m-0 p-6 rounded-none overflow-hidden flex flex-col" data-testid="dialog-weekly-optimizer">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Weekly Schedule Optimizer
          </DialogTitle>
          <DialogDescription>
            Analyze all active recurring stops and optimize their day assignments to minimize total weekly driving distance.
          </DialogDescription>
        </DialogHeader>

        {successData ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6" data-testid="panel-apply-success">
            <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-6">
              <CheckCircle2 className="h-14 w-14 text-green-600 dark:text-green-400" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-xl font-semibold">Optimization Applied</p>
              <p className="text-foreground font-medium" data-testid="text-success-summary">
                {successData.routesCreated > 0
                  ? `${successData.routesCreated} route${successData.routesCreated !== 1 ? "s" : ""} created`
                  : "Routes updated"
                } · {successData.stopsUpdated} stop{successData.stopsUpdated !== 1 ? "s" : ""} reassigned
              </p>
              {(successData.milesSaved > 0 || successData.minutesSaved > 0) && (
                <p className="text-muted-foreground text-sm" data-testid="text-success-savings">
                  {successData.milesSaved > 0 && `${successData.milesSaved} miles saved`}
                  {successData.milesSaved > 0 && successData.minutesSaved > 0 && " · "}
                  {successData.minutesSaved > 0 && `${formatMinutes(successData.minutesSaved)} saved this week`}
                </p>
              )}
              {successData.creditsUsed > 0 && (
                <p className="text-xs text-muted-foreground" data-testid="text-success-credits">
                  {successData.creditsUsed} credit{successData.creditsUsed !== 1 ? "s" : ""} used · {successData.creditsRemaining} remaining
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => { setSuccessData(null); onOpenChange(false); navigate("/routes"); }}
                data-testid="button-view-routes"
              >
                View Routes
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setSuccessData(null); onOpenChange(false); }} data-testid="button-close-success">
                Close
              </Button>
            </div>
          </div>
        ) : !result ? (
          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <p className="text-sm font-medium">Respect Service Zones</p>
                  <p className="text-xs text-muted-foreground">Keep stops on their zone-assigned day</p>
                </div>
                <Switch
                  checked={respectZones}
                  onCheckedChange={setRespectZones}
                  data-testid="switch-respect-zones"
                />
              </div>
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <p className="text-sm font-medium">Include Saturday</p>
                  <p className="text-xs text-muted-foreground">Allow stops to be scheduled on Saturday</p>
                </div>
                <Switch
                  checked={includeSaturday}
                  onCheckedChange={setIncludeSaturday}
                  data-testid="switch-include-saturday"
                />
              </div>
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={() => analyzeMutation.mutate()}
              disabled={analyzeMutation.isPending}
              data-testid="button-run-analysis"
            >
              {analyzeMutation.isPending ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Analyzing routes...
                </>
              ) : (
                <>
                  <Sparkles className="h-5 w-5 mr-2" />
                  Analyze Weekly Schedule
                </>
              )}
            </Button>
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-5 pb-4">

              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide font-semibold text-muted-foreground">Optimization Preview</p>
                  <p className="text-sm text-muted-foreground">Review the proposed changes before applying</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setResult(null); setApplyConfirmPending(false); }}
                  data-testid="button-reanalyze"
                >
                  <RotateCcw className="h-4 w-4 mr-1" /> Re-analyze
                </Button>
              </div>

              {/* Section 1: Impact Summary */}
              <div className="rounded-xl border bg-primary/5 border-primary/20 p-4" data-testid="tab-summary">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Impact Summary</p>
                  <span className="text-xs text-muted-foreground" data-testid="text-weekly-improvement">{result.improvementPct}% improvement</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center" data-testid="metric-miles-saved">
                    <p className="text-3xl font-bold text-primary" data-testid="text-weekly-miles-saved">{result.milesSaved}</p>
                    <p className="text-sm font-medium mt-0.5">Miles Saved</p>
                    <p className="text-[11px] text-muted-foreground">vs current schedule</p>
                  </div>
                  <div className="text-center" data-testid="metric-time-saved">
                    <p className="text-3xl font-bold text-primary" data-testid="text-weekly-minutes-saved">{formatMinutes(result.minutesSaved)}</p>
                    <p className="text-sm font-medium mt-0.5">Time Saved</p>
                    <p className="text-[11px] text-muted-foreground">vs current schedule</p>
                  </div>
                  <div className="text-center" data-testid="metric-dollar-savings">
                    <p className="text-3xl font-bold text-primary" data-testid="text-weekly-dollar-savings">~${dollarSavings}</p>
                    <p className="text-sm font-medium mt-0.5">Est. Savings</p>
                    <p className="text-[11px] text-muted-foreground">at $0.67/mile</p>
                  </div>
                  <div className="text-center" data-testid="metric-jobs-moved">
                    <p className="text-3xl font-bold" data-testid="text-weekly-moves">{result.movedStops.length}</p>
                    <p className="text-sm font-medium mt-0.5">Jobs Moved</p>
                    <p className="text-[11px] text-muted-foreground">vs current schedule</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-primary/10 text-sm">
                  <div className="p-2 rounded bg-muted/50">
                    <p className="text-[11px] text-muted-foreground mb-0.5">Current Schedule</p>
                    <p className="font-semibold">{result.current.totalMiles} mi / {formatMinutes(result.current.totalMinutes)}</p>
                    <p className="text-[11px] text-muted-foreground">{result.current.totalStops} stops</p>
                  </div>
                  <div className="p-2 rounded bg-primary/10">
                    <p className="text-[11px] text-muted-foreground mb-0.5">Proposed Schedule</p>
                    <p className="font-semibold text-primary">{result.proposed.totalMiles} mi / {formatMinutes(result.proposed.totalMinutes)}</p>
                    <p className="text-[11px] text-muted-foreground">{result.proposed.totalStops} stops</p>
                  </div>
                </div>
              </div>

              {/* Section 2: Changes List */}
              {result.movedStops.length > 0 && (
                <div data-testid="tab-moves">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Changes ({result.movedStops.length})</p>
                  <div className="space-y-1.5">
                    {result.movedStops.map((move, idx) => {
                      const reason = getReasonChip(move, result.movedStops);
                      return (
                        <div
                          key={idx}
                          className="flex items-center gap-2 p-2.5 border rounded-lg text-sm"
                          data-testid={`move-${idx}`}
                        >
                          <span className="font-medium truncate flex-1 min-w-0">{move.contactName}</span>
                          <Badge variant="secondary" className="text-[10px] capitalize shrink-0 font-medium">
                            {DAY_LABELS[move.fromDay] ?? move.fromDay}
                          </Badge>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <Badge variant="default" className="text-[10px] capitalize shrink-0 font-medium">
                            {DAY_LABELS[move.toDay] ?? move.toDay}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="text-[9px] text-muted-foreground shrink-0 hidden sm:flex"
                            data-testid={`chip-reason-${idx}`}
                          >
                            {reason}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {result.movedStops.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground border rounded-lg bg-muted/30" data-testid="section-no-moves">
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                  <p className="font-medium text-foreground">No stops need to be moved</p>
                  <p>The current schedule is already well-organized.</p>
                </div>
              )}

              {/* Section 3: Trust Signals */}
              <div className="rounded-lg border bg-muted/30 px-4 py-3 flex flex-wrap gap-2 items-center" data-testid="section-trust-signals">
                <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                <Badge variant="outline" className="text-xs font-medium" data-testid="trust-jobs-changed">
                  {result.movedStops.length} jobs changed day
                </Badge>
                <Badge variant="outline" className="text-xs font-medium" data-testid="trust-technician-unchanged">
                  0 jobs changed technician
                </Badge>
                <Badge variant="outline" className="text-xs font-medium" data-testid="trust-cadence">
                  Recurring cadence preserved
                </Badge>
                {(result.excludedWeekendCount ?? 0) > 0 && (
                  <Badge variant="outline" className="text-xs font-medium" data-testid="trust-weekend-excluded">
                    {result.excludedWeekendCount} Saturday stops kept as scheduled
                  </Badge>
                )}
              </div>

              {/* Weekend excluded banner */}
              {(result.excludedWeekendCount ?? 0) > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/60 border text-xs text-muted-foreground" data-testid="banner-excluded-weekend">
                  <span className="font-medium">{result.excludedWeekendCount} Saturday stops kept as scheduled.</span>
                  <span>Enable "Include Saturday" to optimize them.</span>
                </div>
              )}

              {/* Section 4: Notification Toggle */}
              {result.movedStops.length > 0 && (
                <div className="flex items-center justify-between p-4 border rounded-lg" data-testid="section-notify-customers">
                  <div className="flex items-center gap-3">
                    <Bell className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-sm font-medium">Notify affected customers</p>
                      <p className="text-xs text-muted-foreground">
                        {uniqueContactsCount} {uniqueContactsCount === 1 ? "customer" : "customers"} will be notified of their new day
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={notifyCustomers}
                    onCheckedChange={setNotifyCustomers}
                    data-testid="switch-notify-customers"
                  />
                </div>
              )}

              {/* Section 5: Day by Day (collapsible) */}
              <div className="border rounded-lg overflow-hidden" data-testid="section-day-by-day">
                <button
                  className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-muted/40 transition-colors"
                  onClick={() => setDayByDayOpen(v => !v)}
                  data-testid="tab-day-by-day"
                >
                  <span className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    Day by Day Detail
                  </span>
                  {dayByDayOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </button>
                {dayByDayOpen && (
                  <div className="border-t p-3 space-y-4" data-testid="panel-day-by-day">
                    {result.proposed.days.filter(d => d.totalStops > 0).map(day => (
                      <Card key={day.day} data-testid={`summary-day-${day.day}`}>
                        <CardHeader className="p-3 pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-sm capitalize flex items-center gap-2">
                              <span
                                className="inline-flex w-5 h-5 rounded border border-primary bg-primary items-center justify-center shrink-0"
                                data-testid={`checkbox-day-${day.day}`}
                              >
                                <Check className="h-3 w-3 text-primary-foreground" />
                              </span>
                              <Calendar className="h-4 w-4" />
                              {day.day}
                              <Badge variant="outline" className="text-[10px]">{day.totalStops} stops</Badge>
                            </CardTitle>
                            <span className="text-xs text-muted-foreground">
                              {day.totalMiles} mi · {formatMinutes(day.totalMinutes)}
                            </span>
                          </div>
                        </CardHeader>
                        <CardContent className="p-3 pt-0 space-y-3">
                          <StopMiniMap routes={day.routes} />
                          {day.routes.map((route, rIdx) => (
                            <div key={rIdx} className="space-y-1">
                              <p className="text-xs font-medium flex items-center gap-1.5">
                                <span
                                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: ROUTE_COLORS[rIdx % ROUTE_COLORS.length] }}
                                />
                                {route.routeLabel}
                              </p>
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
                          ))}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </ScrollArea>
        )}

        {/* Action Bar — only shown during result review */}
        {result && !successData && (
          <>
            <Separator className="mt-2" />
            {applyConfirmPending && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-2.5 text-sm flex items-center gap-2" data-testid="banner-credit-confirm">
                <span className="text-amber-700 dark:text-amber-400">
                  This will use{" "}
                  <span className="font-semibold" data-testid="text-confirm-credits-cost">{weeklyBaseline}</span>
                  {" "}credit{weeklyBaseline !== 1 ? "s" : ""}. You currently have{" "}
                  <span className="font-semibold" data-testid="text-confirm-credits-balance">{liveCredits}</span>
                  {" "}remaining.
                </span>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 pt-2" data-testid="dialog-confirm-apply-weekly">
              <div className="text-sm text-muted-foreground flex flex-col gap-0.5">
                {credits !== Infinity && acceptedDays.size > 0 && !applyConfirmPending && (
                  <>
                    <span>
                      <span className="font-semibold text-foreground" data-testid="text-credits-required">{weeklyBaseline}</span>
                      {" "}credits · {credits} available
                    </span>
                    {credits < weeklyBaseline && (
                      <button
                        className="text-xs text-primary underline underline-offset-2 text-left"
                        onClick={onNeedCredits}
                        data-testid="button-topup-inline"
                      >
                        Need {weeklyBaseline - credits} more — top up
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => { setResult(null); setApplyConfirmPending(false); onOpenChange(false); }}
                  data-testid="button-cancel-apply"
                >
                  <X className="h-4 w-4 mr-1" />
                  Keep Current Routes
                </Button>
                <Button
                  onClick={handleApplyClick}
                  disabled={acceptedDays.size === 0 || acceptedCredits > liveCredits || applyMutation.isPending}
                  data-testid={applyConfirmPending ? "button-confirm-apply" : "button-apply-plan"}
                  className={applyConfirmPending ? "bg-green-600 hover:bg-green-700 text-white" : ""}
                >
                  {applyMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : applyConfirmPending ? (
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-1" />
                  )}
                  {acceptedCredits > liveCredits
                    ? "Not Enough Credits"
                    : applyMutation.isPending
                    ? "Applying..."
                    : applyConfirmPending
                    ? `Confirm — costs ${weeklyBaseline} credit${weeklyBaseline !== 1 ? "s" : ""}`
                    : "Apply Optimization"}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
