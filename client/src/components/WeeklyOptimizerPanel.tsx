import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAddressLabels } from "@/hooks/use-address-labels";
import { formatDistance } from "@/lib/units";
import { useLocation } from "wouter";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Sparkles,
  Check,
  Loader2,
  RotateCcw,
  Car,
  Calendar,
  CheckCircle2,
  X,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  Clock,
} from "lucide-react";

function SettingRow({
  label,
  description,
  inputId,
  placeholder,
  min,
  step,
  value,
  onChange,
  onSave,
  isPending,
  testIdInput,
  testIdButton,
  muted = false,
}: {
  label: string;
  description: string | React.ReactNode;
  inputId: string;
  placeholder: string;
  min: number;
  step?: number;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  isPending: boolean;
  testIdInput: string;
  testIdButton: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between p-4 border rounded-lg ${muted ? "opacity-50" : ""}`}
    >
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <Label htmlFor={inputId} className="sr-only">
          {label}
        </Label>
        <Input
          id={inputId}
          type="number"
          min={min}
          step={step}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave();
          }}
          className="w-20 h-8 text-xs"
          data-testid={testIdInput}
          disabled={isPending}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs px-2"
          onClick={onSave}
          disabled={isPending}
          data-testid={testIdButton}
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
        </Button>
      </div>
    </div>
  );
}

const ROUTE_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#6366f1",
  "#14b8a6",
];

type PlannerStop = {
  customerId: string;
  customerName: string;
  latitude: number;
  longitude: number;
  serviceMinutes: number;
  revenuePerVisit: number;
  stopOrder: number;
};

type PlannerRoute = {
  id: string;
  routeName: string;
  planningWeekNumber: number;
  weekStartDate: string;
  weekEndDate: string;
  assignedStops: PlannerStop[];
  stopCount: number;
  totalServiceMinutes: number;
  totalDriveMinutes: number;
  totalRouteMinutes: number;
  estimatedMiles: number;
  revenue: number;
  grossProfit: number;
  profitMargin: number;
  feasibilityStatus: string;
  warnings: string[];
  recommendations: string[];
  estimatedFallback?: boolean;
};

type PlannerWeekSummary = {
  routeCount: number;
  stopCount: number;
  totalRouteMinutes: number;
  totalRevenue: number;
  totalGrossProfit: number;
  averageProfitMargin: number;
  excludedCount: number;
  needsReviewCount: number;
};

type PlannerWeek = {
  weekNumber: number;
  weekStartDate: string;
  weekEndDate: string;
  plannedRoutes: PlannerRoute[];
  summary: PlannerWeekSummary;
};

type FourWeekSummary = {
  totalRoutes: number;
  totalStops: number;
  totalRouteMinutes: number;
  totalRevenue: number;
  totalGrossProfit: number;
  averageProfitMargin: number;
  weeksPlanned: number;
};

type PlannerResult = {
  planId: string;
  status: string;
  planningWindow: {
    startDate: string;
    endDate: string;
    weeks: PlannerWeek[];
  };
  summary: FourWeekSummary;
  warnings: string[];
};

function StopMiniMap({ stops, color }: { stops: PlannerStop[]; color: string }) {
  if (stops.length === 0) return null;

  const lats = stops.map((s) => s.latitude);
  const lngs = stops.map((s) => s.longitude);
  const minLat = Math.min(...lats),
    maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs),
    maxLng = Math.max(...lngs);
  const padding = 16,
    svgW = 240,
    svgH = 120;
  const innerW = svgW - padding * 2,
    innerH = svgH - padding * 2;
  const rangeX = maxLng - minLng || 0.01,
    rangeY = maxLat - minLat || 0.01;
  const toX = (lng: number) => padding + ((lng - minLng) / rangeX) * innerW;
  const toY = (lat: number) => padding + ((maxLat - lat) / rangeY) * innerH;

  const pts = stops.map((s) => `${toX(s.longitude)},${toY(s.latitude)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${svgW} ${svgH}`}
      className="w-full h-[100px] rounded border bg-muted/30"
      data-testid="stop-mini-map"
    >
      {stops.length >= 2 && (
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeOpacity="0.5"
          strokeLinejoin="round"
        />
      )}
      {stops.map((stop, idx) => (
        <g key={idx}>
          <circle
            cx={toX(stop.longitude)}
            cy={toY(stop.latitude)}
            r="5"
            fill={color}
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

function formatMinutes(mins: number): string {
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60),
    m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatCurrency(val: number): string {
  return val.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function weekTabLabel(weekNum: number): string {
  return weekNum === 1 ? "Next Week" : `Week ${weekNum}`;
}

function weekLabel(week: PlannerWeek): string {
  const start = new Date(week.weekStartDate + "T00:00:00");
  const end = new Date(week.weekEndDate + "T00:00:00");
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

type DepotRecord = {
  id: string;
  name: string;
  address: string;
  isPrimary: boolean;
  latitude: string;
  longitude: string;
};

type RouteRecord = {
  id: string;
  depotId?: string | null;
  technicianId?: string | null;
};

type TeamRecord = {
  id: string;
  defaultDepotId?: string | null;
};

export function WeeklyOptimizerPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { country: weekOptimizerCountry } = useAddressLabels();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [planResult, setPlanResult] = useState<PlannerResult | null>(null);
  const [activeWeekNum, setActiveWeekNum] = useState<number>(1);
  const [acceptedWeeks, setAcceptedWeeks] = useState<Set<number>>(new Set());
  const [applyConfirmPending, setApplyConfirmPending] = useState(false);
  const [successData, setSuccessData] = useState<{
    routesCreated: number;
    routesReused: number;
    stopsUpdated: number;
    weeksApplied: number;
  } | null>(null);

  const [minStopsInput, setMinStopsInput] = useState<string>("");
  const [maxStopsInput, setMaxStopsInput] = useState<string>("");
  const [minDurationInput, setMinDurationInput] = useState<string>("");
  const [maxDurationInput, setMaxDurationInput] = useState<string>("");
  const [avgMinutesInput, setAvgMinutesInput] = useState<string>("");
  const [isTimeBased, setIsTimeBased] = useState(false);
  const [dismissedOverDuration, setDismissedOverDuration] = useState<Set<string>>(new Set());

  const { data: company } = useQuery<{
    minStopsPerDay?: number | null;
    maxStopsPerRoute?: number | null;
    minRouteDurationHours?: number | null;
    maxRouteDurationHours?: number | null;
    avgMinutesPerStop?: number | null;
    routePlanningMode?: string | null;
  }>({
    queryKey: ["/api/company"],
  });

  const { data: plannerDepots = [] } = useQuery<DepotRecord[]>({
    queryKey: ["/api/depots"],
  });
  const { data: plannerRoutes = [] } = useQuery<RouteRecord[]>({
    queryKey: ["/api/routes"],
  });
  const { data: plannerTeam = [] } = useQuery<TeamRecord[]>({
    queryKey: ["/api/company/team"],
  });

  const plannerPrimaryDepot = plannerDepots.find((d) => d.isPrimary);

  function resolveDepotForRoute(routeId: string): { name: string; isDefault: boolean } | null {
    const route = plannerRoutes.find((r) => r.id === routeId);
    if (!route)
      return plannerPrimaryDepot ? { name: plannerPrimaryDepot.name, isDefault: true } : null;
    let depot: DepotRecord | undefined;
    if (route.depotId) depot = plannerDepots.find((d) => d.id === route.depotId);
    if (!depot && route.technicianId) {
      const tech = plannerTeam.find((t) => t.id === route.technicianId);
      if (tech?.defaultDepotId) depot = plannerDepots.find((d) => d.id === tech.defaultDepotId);
    }
    if (!depot && plannerPrimaryDepot) {
      return {
        name: plannerPrimaryDepot.name,
        isDefault:
          !route.depotId && !plannerTeam.find((t) => t.id === route.technicianId)?.defaultDepotId,
      };
    }
    return depot ? { name: depot.name, isDefault: false } : null;
  }

  useEffect(() => {
    if (company?.minStopsPerDay != null) setMinStopsInput(String(company.minStopsPerDay));
    if (company?.maxStopsPerRoute != null) setMaxStopsInput(String(company.maxStopsPerRoute));
    if (company?.minRouteDurationHours != null)
      setMinDurationInput(String(company.minRouteDurationHours));
    if (company?.maxRouteDurationHours != null)
      setMaxDurationInput(String(company.maxRouteDurationHours));
    if (company?.avgMinutesPerStop != null) setAvgMinutesInput(String(company.avgMinutesPerStop));
    if (company?.routePlanningMode != null) setIsTimeBased(company.routePlanningMode === "time");
  }, [
    company?.minStopsPerDay,
    company?.maxStopsPerRoute,
    company?.minRouteDurationHours,
    company?.maxRouteDurationHours,
    company?.avgMinutesPerStop,
    company?.routePlanningMode,
  ]);

  const makeCompanyPatch = (field: string, successMsg: string) => ({
    mutationFn: async (value: number | string | null) => {
      await apiRequest("PATCH", "/api/company", { [field]: value });
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
    },
    onSuccess: () => toast({ title: "Saved", description: successMsg }),
    onError: () =>
      toast({ title: "Error", description: "Could not save setting.", variant: "destructive" }),
  });

  const saveMinStopsMutation = useMutation(
    makeCompanyPatch("minStopsPerDay", "Minimum stops per day updated.")
  );
  const saveMaxStopsMutation = useMutation(
    makeCompanyPatch("maxStopsPerRoute", "Maximum stops per day updated.")
  );
  const saveMinDurationMutation = useMutation(
    makeCompanyPatch("minRouteDurationHours", "Minimum route duration updated.")
  );
  const saveMaxDurationMutation = useMutation(
    makeCompanyPatch("maxRouteDurationHours", "Maximum route duration updated.")
  );
  const saveAvgMinutesMutation = useMutation(
    makeCompanyPatch("avgMinutesPerStop", "Average service time per stop updated.")
  );
  const saveModeMutation = useMutation(
    makeCompanyPatch("routePlanningMode", "Planning mode updated.")
  );

  const handleToggleMode = (checked: boolean) => {
    setIsTimeBased(checked);
    saveModeMutation.mutate(checked ? "time" : "stops");
  };

  const makeNumericSaveHandler =
    (
      input: string,
      mutation: { mutate: (v: number | string | null) => void; isPending: boolean },
      min: number,
      label: string,
      allowNull = true
    ) =>
    () => {
      const val = input.trim();
      const num = val === "" ? null : parseFloat(val);
      if (val !== "" && (isNaN(num!) || num! < min)) {
        toast({
          title: "Invalid value",
          description: `${label} must be ≥ ${min}.`,
          variant: "destructive",
        });
        return;
      }
      if (!allowNull && num == null) {
        toast({
          title: "Invalid value",
          description: `${label} is required.`,
          variant: "destructive",
        });
        return;
      }
      mutation.mutate(num);
    };

  const handleSaveMinStops = makeNumericSaveHandler(
    minStopsInput,
    saveMinStopsMutation,
    1,
    "Min stops per day"
  );
  const handleSaveMaxStops = makeNumericSaveHandler(
    maxStopsInput,
    saveMaxStopsMutation,
    1,
    "Max stops per day"
  );
  const handleSaveMinDuration = makeNumericSaveHandler(
    minDurationInput,
    saveMinDurationMutation,
    0.5,
    "Min route duration"
  );
  const handleSaveMaxDuration = makeNumericSaveHandler(
    maxDurationInput,
    saveMaxDurationMutation,
    1,
    "Max route duration"
  );
  const handleSaveAvgMinutes = makeNumericSaveHandler(
    avgMinutesInput,
    saveAvgMinutesMutation,
    5,
    "Avg service time"
  );

  function resetAll() {
    setPlanResult(null);
    setActiveWeekNum(1);
    setAcceptedWeeks(new Set());
    setApplyConfirmPending(false);
    setSuccessData(null);
  }

  function toggleWeek(weekNum: number) {
    setAcceptedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekNum)) next.delete(weekNum);
      else next.add(weekNum);
      return next;
    });
  }

  const activeWeek =
    planResult?.planningWindow.weeks.find((w) => w.weekNumber === activeWeekNum) ?? null;

  // Totals for accepted weeks only
  const acceptedWeekEntries = planResult
    ? planResult.planningWindow.weeks.filter((w) => acceptedWeeks.has(w.weekNumber))
    : [];
  const totalAcceptedStops = acceptedWeekEntries.reduce((a, w) => a + w.summary.stopCount, 0);
  const totalAcceptedRevenue = acceptedWeekEntries.reduce((a, w) => a + w.summary.totalRevenue, 0);

  const analyzeMutation = useMutation({
    onMutate: () => {
      setPlanResult(null);
      setApplyConfirmPending(false);
    },
    mutationFn: async () => {
      const res = await fetch("/api/planner/run", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Error ${res.status}`);
      }
      return data as { plan: PlannerResult };
    },
    onSuccess: ({ plan }) => {
      setPlanResult(plan);
      setActiveWeekNum(plan.planningWindow.weeks[0]?.weekNumber ?? 1);
      setApplyConfirmPending(false);
      // Pre-accept all non-empty weeks
      const initial = new Set(
        plan.planningWindow.weeks.filter((w) => w.summary.stopCount > 0).map((w) => w.weekNumber)
      );
      setAcceptedWeeks(initial);
    },
    onError: (err: Error) => {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!planResult) throw new Error("No plan to apply");

      const approveRes = await fetch(`/api/planner/plans/${planResult.planId}/approve`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!approveRes.ok) {
        const errData = await approveRes.json().catch(() => ({}));
        throw new Error(errData.error || `Approve failed: ${approveRes.status}`);
      }

      // Send only accepted week numbers so the backend applies just those weeks.
      const weekNumbers = Array.from(acceptedWeeks);
      const applyRes = await fetch(`/api/planner/plans/${planResult.planId}/apply`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ weekNumbers }),
      });
      if (!applyRes.ok) {
        const errData = await applyRes.json().catch(() => ({}));
        throw new Error(errData.error || `Apply failed: ${applyRes.status}`);
      }
      const data = await applyRes.json();
      return data as {
        appliedRouteCount: { created: number; reused: number; stopsUpdated: number };
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans?isActive=true"] });
      setApplyConfirmPending(false);
      setSuccessData({
        routesCreated: data.appliedRouteCount.created,
        routesReused: data.appliedRouteCount.reused,
        stopsUpdated: data.appliedRouteCount.stopsUpdated,
        weeksApplied: acceptedWeeks.size,
      });
    },
    onError: (err: Error) => {
      setApplyConfirmPending(false);
      toast({ title: "Failed to apply plan", description: err.message, variant: "destructive" });
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
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetAll();
        onOpenChange(v);
      }}
    >
      <DialogContent
        className="w-screen h-screen max-w-none max-h-none m-0 p-6 rounded-none overflow-hidden flex flex-col"
        data-testid="dialog-weekly-optimizer"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Route Planner
          </DialogTitle>
          <DialogDescription>
            Plan and optimize routes for the next 4 weeks based on actual scheduled appointments.
          </DialogDescription>
        </DialogHeader>

        {/* ── APPLYING PROGRESS ── */}
        {!successData && applyMutation.isPending && (
          <div
            className="flex-1 flex flex-col items-center justify-center gap-6 py-8"
            data-testid="panel-apply-progress"
          >
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Applying plan to routes…</p>
          </div>
        )}

        {/* ── SUCCESS ── */}
        {successData ? (
          <div
            className="flex-1 flex flex-col items-center justify-center gap-6"
            data-testid="panel-apply-success"
          >
            <div className="rounded-full p-6 bg-green-100 dark:bg-green-900/30">
              <CheckCircle2 className="h-14 w-14 text-green-600 dark:text-green-400" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-xl font-semibold">Plan Applied</p>
              <p className="text-foreground font-medium" data-testid="text-success-summary">
                {successData.weeksApplied} week{successData.weeksApplied !== 1 ? "s" : ""} applied
                {successData.routesCreated > 0 &&
                  ` · ${successData.routesCreated} route${successData.routesCreated !== 1 ? "s" : ""} created`}
                {successData.routesReused > 0 &&
                  ` · ${successData.routesReused} route${successData.routesReused !== 1 ? "s" : ""} updated`}
                {successData.stopsUpdated > 0 &&
                  ` · ${successData.stopsUpdated} stop${successData.stopsUpdated !== 1 ? "s" : ""} reassigned`}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap justify-center">
              <Button
                onClick={() => {
                  resetAll();
                  onOpenChange(false);
                  navigate("/routes");
                }}
                data-testid="button-view-routes"
              >
                View Routes
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  resetAll();
                  onOpenChange(false);
                }}
                data-testid="button-close-success"
              >
                Close
              </Button>
            </div>
          </div>
        ) : /* ── PRE-ANALYSIS ── */
        !planResult ? (
          <div className="space-y-6 py-4">
            {!applyMutation.isPending && (
              <>
                <div className="space-y-3">
                  {/* Planning mode toggle */}
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <p className="text-sm font-medium">Planning mode</p>
                      <p className="text-xs text-muted-foreground">
                        {isTimeBased
                          ? "Time-based: routes sized by daily time budget"
                          : "Stop-based: routes sized by stop count"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Stops</span>
                      <Switch
                        checked={isTimeBased}
                        onCheckedChange={handleToggleMode}
                        disabled={saveModeMutation.isPending}
                        data-testid="switch-planning-mode"
                      />
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Time
                      </span>
                    </div>
                  </div>

                  {/* Stop count settings (active in stop-based mode; stored for both) */}
                  <SettingRow
                    label="Min stops per day"
                    description={
                      isTimeBased
                        ? "Min stops threshold (not used in time-based mode)"
                        : "Merge days with fewer than this many stops"
                    }
                    inputId="min-stops-input"
                    placeholder="3"
                    min={1}
                    value={minStopsInput}
                    onChange={setMinStopsInput}
                    onSave={handleSaveMinStops}
                    isPending={saveMinStopsMutation.isPending}
                    testIdInput="input-min-stops-per-day"
                    testIdButton="button-save-min-stops"
                    muted={isTimeBased}
                  />
                  <SettingRow
                    label="Max stops per day"
                    description={
                      isTimeBased
                        ? "Max stops override (time budget is used instead in time-based mode)"
                        : "Split routes that exceed this many stops"
                    }
                    inputId="max-stops-input"
                    placeholder="50"
                    min={1}
                    value={maxStopsInput}
                    onChange={setMaxStopsInput}
                    onSave={handleSaveMaxStops}
                    isPending={saveMaxStopsMutation.isPending}
                    testIdInput="input-max-stops-per-day"
                    testIdButton="button-save-max-stops"
                    muted={isTimeBased}
                  />

                  {/* Time budget settings (active in time-based mode; stored for both) */}
                  <SettingRow
                    label="Min route duration (hrs)"
                    description={
                      isTimeBased
                        ? "Routes below this threshold are flagged as underutilized"
                        : "Min daily duration floor (used in time-based mode)"
                    }
                    inputId="min-duration-input"
                    placeholder="1"
                    min={0.5}
                    step={0.5}
                    value={minDurationInput}
                    onChange={setMinDurationInput}
                    onSave={handleSaveMinDuration}
                    isPending={saveMinDurationMutation.isPending}
                    testIdInput="input-min-route-duration"
                    testIdButton="button-save-min-duration"
                    muted={!isTimeBased}
                  />
                  <SettingRow
                    label="Max route duration (hrs)"
                    description={
                      isTimeBased
                        ? "Routes exceeding this limit are flagged with an over-duration warning"
                        : "Max daily duration cap (used in time-based mode)"
                    }
                    inputId="max-duration-input"
                    placeholder="8"
                    min={1}
                    step={0.5}
                    value={maxDurationInput}
                    onChange={setMaxDurationInput}
                    onSave={handleSaveMaxDuration}
                    isPending={saveMaxDurationMutation.isPending}
                    testIdInput="input-max-route-duration"
                    testIdButton="button-save-max-duration"
                    muted={!isTimeBased}
                  />
                  <SettingRow
                    label="Avg service time per stop (min)"
                    description={
                      isTimeBased
                        ? "Used to compute how many stops fit in the daily time budget"
                        : "Per-stop service time estimate (used in time-based mode)"
                    }
                    inputId="avg-minutes-input"
                    placeholder="12"
                    min={5}
                    value={avgMinutesInput}
                    onChange={setAvgMinutesInput}
                    onSave={handleSaveAvgMinutes}
                    isPending={saveAvgMinutesMutation.isPending}
                    testIdInput="input-avg-minutes-per-stop"
                    testIdButton="button-save-avg-minutes"
                    muted={!isTimeBased}
                  />
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
                      Analyzing routes…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-5 w-5 mr-2" />
                      Analyze Next 4 Weeks
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        ) : (
          /* ── RESULT VIEW ── */
          <>
            {/* Week tab buttons */}
            <div
              className="flex gap-1 border-b pb-0 overflow-x-auto shrink-0"
              data-testid="week-tabs"
            >
              {planResult.planningWindow.weeks.map((week) => {
                const isActive = week.weekNumber === activeWeekNum;
                const isAccepted = acceptedWeeks.has(week.weekNumber);
                const hasStops = week.summary.stopCount > 0;
                return (
                  <button
                    key={week.weekNumber}
                    onClick={() => setActiveWeekNum(week.weekNumber)}
                    className={[
                      "flex flex-col items-start px-3 py-2 text-left border-b-2 transition-colors whitespace-nowrap shrink-0 rounded-t",
                      isActive
                        ? "border-primary text-primary bg-primary/5"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40",
                    ].join(" ")}
                    data-testid={`tab-week-${week.weekNumber}`}
                  >
                    <span className="text-xs font-semibold">{weekTabLabel(week.weekNumber)}</span>
                    <span className="text-[10px] opacity-75">{weekLabel(week)}</span>
                    {hasStops && isAccepted ? (
                      <span className="mt-0.5 inline-flex items-center gap-0.5 text-[9px] text-green-600 dark:text-green-400 font-medium">
                        <Check className="h-2.5 w-2.5" />
                        {week.summary.stopCount} stops
                      </span>
                    ) : hasStops ? (
                      <span className="mt-0.5 text-[9px] text-muted-foreground">Skipped</span>
                    ) : (
                      <span className="mt-0.5 text-[9px] text-muted-foreground">Empty</span>
                    )}
                  </button>
                );
              })}
              <div className="ml-auto flex items-center gap-2 pb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPlanResult(null);
                    setApplyConfirmPending(false);
                  }}
                  data-testid="button-reanalyze"
                >
                  <RotateCcw className="h-4 w-4 mr-1" /> Re-analyze
                </Button>
              </div>
            </div>

            {/* Active week content */}
            <ScrollArea className="flex-1 min-h-0">
              {activeWeek ? (
                <div
                  className="space-y-4 pb-4 pt-2"
                  data-testid={`panel-week-${activeWeek.weekNumber}`}
                >
                  {/* Week accept toggle */}
                  {activeWeek.summary.stopCount > 0 && (
                    <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`accept-week-${activeWeek.weekNumber}`}
                          checked={acceptedWeeks.has(activeWeek.weekNumber)}
                          onCheckedChange={() => toggleWeek(activeWeek.weekNumber)}
                          data-testid={`checkbox-accept-week-${activeWeek.weekNumber}`}
                        />
                        <label
                          htmlFor={`accept-week-${activeWeek.weekNumber}`}
                          className="text-sm font-medium cursor-pointer"
                        >
                          Include this week in the plan
                        </label>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {activeWeek.summary.routeCount} route
                        {activeWeek.summary.routeCount !== 1 ? "s" : ""} ·{" "}
                        {activeWeek.summary.stopCount} stops
                      </span>
                    </div>
                  )}

                  {activeWeek.summary.stopCount === 0 ? (
                    <div
                      className="flex flex-col items-center gap-3 py-12 text-center border rounded-lg bg-muted/20"
                      data-testid={`empty-week-${activeWeek.weekNumber}`}
                    >
                      <Calendar className="h-10 w-10 text-muted-foreground/50" />
                      <div>
                        <p className="font-medium text-muted-foreground">
                          No stops scheduled this week
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          No customers are due for service during this period.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Week summary */}
                      <div
                        className="rounded-xl border bg-primary/5 border-primary/20 p-4"
                        data-testid={`summary-week-${activeWeek.weekNumber}`}
                      >
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                          Week {activeWeek.weekNumber} Summary — {weekLabel(activeWeek)}
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div
                            className="text-center"
                            data-testid={`metric-routes-week-${activeWeek.weekNumber}`}
                          >
                            <p className="text-2xl font-bold text-primary">
                              {activeWeek.summary.routeCount}
                            </p>
                            <p className="text-xs font-medium mt-0.5">Routes</p>
                          </div>
                          <div
                            className="text-center"
                            data-testid={`metric-stops-week-${activeWeek.weekNumber}`}
                          >
                            <p className="text-2xl font-bold text-primary">
                              {activeWeek.summary.stopCount}
                            </p>
                            <p className="text-xs font-medium mt-0.5">Stops</p>
                          </div>
                          <div
                            className="text-center"
                            data-testid={`metric-revenue-week-${activeWeek.weekNumber}`}
                          >
                            <p className="text-2xl font-bold text-primary">
                              {formatCurrency(activeWeek.summary.totalRevenue)}
                            </p>
                            <p className="text-xs font-medium mt-0.5">Revenue</p>
                          </div>
                          <div
                            className="text-center"
                            data-testid={`metric-profit-week-${activeWeek.weekNumber}`}
                          >
                            <p className="text-2xl font-bold">
                              {Math.round(activeWeek.summary.averageProfitMargin * 100)}%
                            </p>
                            <p className="text-xs font-medium mt-0.5">Avg Margin</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-primary/10 text-sm">
                          <div className="p-2 rounded bg-muted/50">
                            <p className="text-[11px] text-muted-foreground mb-0.5">Drive Time</p>
                            <p className="font-semibold">
                              {formatMinutes(
                                activeWeek.plannedRoutes.reduce(
                                  (a, r) => a + r.totalDriveMinutes,
                                  0
                                )
                              )}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              across {activeWeek.summary.routeCount} route
                              {activeWeek.summary.routeCount !== 1 ? "s" : ""}
                            </p>
                          </div>
                          <div className="p-2 rounded bg-primary/10">
                            <p className="text-[11px] text-muted-foreground mb-0.5">Gross Profit</p>
                            <p className="font-semibold text-primary">
                              {formatCurrency(activeWeek.summary.totalGrossProfit)}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {activeWeek.summary.excludedCount > 0
                                ? `${activeWeek.summary.excludedCount} excluded`
                                : "all stops routable"}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Planner warnings for this week */}
                      {activeWeek.plannedRoutes.some((r) => r.warnings.length > 0) && (
                        <div
                          className="rounded-lg border border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30 p-4 space-y-1.5"
                          data-testid={`banner-warnings-week-${activeWeek.weekNumber}`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
                            <p className="text-sm font-semibold text-orange-800 dark:text-orange-200">
                              Planner Warnings
                            </p>
                          </div>
                          {activeWeek.plannedRoutes
                            .flatMap((r) => r.warnings)
                            .map((w, i) => (
                              <p
                                key={i}
                                className="text-xs text-orange-700 dark:text-orange-300 pl-6"
                              >
                                {w}
                              </p>
                            ))}
                        </div>
                      )}

                      {/* Excluded stops notice */}
                      {activeWeek.summary.excludedCount > 0 && (
                        <div
                          className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3 text-sm flex items-center gap-2"
                          data-testid={`banner-excluded-week-${activeWeek.weekNumber}`}
                        >
                          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                          <span className="text-amber-700 dark:text-amber-400">
                            {activeWeek.summary.excludedCount} stop
                            {activeWeek.summary.excludedCount !== 1 ? "s" : ""} excluded — missing
                            or unverified coordinates. Fix addresses and re-analyze to include them.
                          </span>
                        </div>
                      )}

                      {/* Fallback estimate warning */}
                      {activeWeek.plannedRoutes.some((r) => r.estimatedFallback) && (
                        <div
                          className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 px-4 py-3 text-xs flex items-center gap-2"
                          data-testid={`banner-fallback-week-${activeWeek.weekNumber}`}
                        >
                          <AlertTriangle className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                          <span className="text-blue-700 dark:text-blue-400">
                            Some drive times use distance estimates — Mapbox was unavailable for
                            these legs.
                          </span>
                        </div>
                      )}

                      {/* Route-by-route breakdown */}
                      <div
                        className="space-y-3"
                        data-testid={`panel-routes-week-${activeWeek.weekNumber}`}
                      >
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Planned Routes ({activeWeek.summary.routeCount})
                        </p>
                        {activeWeek.plannedRoutes.map((route, rIdx) => {
                          const depotInfo = resolveDepotForRoute(route.id);
                          return (
                            <Card
                              key={route.id}
                              data-testid={`route-card-${activeWeek.weekNumber}-${rIdx}`}
                            >
                              <CardHeader className="p-3 pb-2">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <CardTitle className="text-sm flex items-center gap-2">
                                    <span
                                      className="inline-block w-3 h-3 rounded-full shrink-0"
                                      style={{
                                        backgroundColor: ROUTE_COLORS[rIdx % ROUTE_COLORS.length],
                                      }}
                                    />
                                    {route.routeName}
                                    {depotInfo && (
                                      <span
                                        className="text-[10px] font-normal text-muted-foreground flex items-center gap-0.5"
                                        data-testid={`text-planner-depot-${activeWeek.weekNumber}-${rIdx}`}
                                      >
                                        <Car className="h-2.5 w-2.5 shrink-0" />
                                        {depotInfo.name}
                                        {depotInfo.isDefault && (
                                          <span className="text-amber-600 dark:text-amber-400 ml-0.5">
                                            (default)
                                          </span>
                                        )}
                                      </span>
                                    )}
                                    <Badge
                                      variant={
                                        route.feasibilityStatus === "feasible"
                                          ? "outline"
                                          : route.feasibilityStatus === "feasible_with_warnings"
                                            ? "secondary"
                                            : "destructive"
                                      }
                                      className="text-[10px]"
                                    >
                                      {route.feasibilityStatus === "feasible"
                                        ? "Feasible"
                                        : route.feasibilityStatus === "feasible_with_warnings"
                                          ? "Warnings"
                                          : "Infeasible"}
                                    </Badge>
                                  </CardTitle>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                      <DollarSign className="h-3 w-3" />
                                      {formatCurrency(route.revenue)}
                                    </span>
                                    <span
                                      className="flex items-center gap-1"
                                      title="Direct-cost margin only — does not include overhead. Not comparable to fully-loaded customer profitability margin."
                                    >
                                      <TrendingUp className="h-3 w-3" />
                                      {Math.round(route.profitMargin * 100)}% margin*
                                    </span>
                                  </div>
                                </div>
                              </CardHeader>
                              <CardContent className="p-3 pt-0 space-y-3">
                                <StopMiniMap
                                  stops={route.assignedStops}
                                  color={ROUTE_COLORS[rIdx % ROUTE_COLORS.length]}
                                />
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                  <Car className="h-3 w-3" />
                                  <span>
                                    {
                                      formatDistance(route.estimatedMiles, weekOptimizerCountry)
                                        .formatted
                                    }{" "}
                                    · {formatMinutes(route.totalRouteMinutes)} total ·{" "}
                                    {route.stopCount} stops
                                  </span>
                                </div>
                                {route.warnings?.includes("route_over_duration") &&
                                  !dismissedOverDuration.has(
                                    `${activeWeek.weekNumber}-${route.id}`
                                  ) && (
                                    <div
                                      className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-3 py-1.5"
                                      data-testid={`warning-over-duration-${activeWeek.weekNumber}-${rIdx}`}
                                    >
                                      <div className="flex items-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-400">
                                        <Clock className="h-3 w-3 shrink-0" />
                                        <span>
                                          Route exceeds the configured time budget (
                                          {formatMinutes(route.totalRouteMinutes)})
                                        </span>
                                      </div>
                                      <button
                                        className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300"
                                        onClick={() =>
                                          setDismissedOverDuration(
                                            (prev) =>
                                              new Set([
                                                ...prev,
                                                `${activeWeek.weekNumber}-${route.id}`,
                                              ])
                                          )
                                        }
                                        data-testid={`dismiss-over-duration-${activeWeek.weekNumber}-${rIdx}`}
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  )}
                                <div className="space-y-0.5">
                                  {route.assignedStops.map((stop, sIdx) => (
                                    <div
                                      key={stop.customerId}
                                      className="flex items-center gap-2 text-xs py-0.5"
                                    >
                                      <Badge
                                        variant="outline"
                                        className="text-[9px] px-1 py-0 w-5 h-5 flex items-center justify-center shrink-0"
                                      >
                                        {sIdx + 1}
                                      </Badge>
                                      <span className="truncate font-medium">
                                        {stop.customerName}
                                      </span>
                                      <span className="text-muted-foreground ml-auto shrink-0">
                                        {formatCurrency(stop.revenuePerVisit)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                                {route.recommendations.length > 0 && (
                                  <div className="text-[10px] text-muted-foreground space-y-0.5 pt-1 border-t">
                                    {route.recommendations.map((r, i) => (
                                      <p key={i}>💡 {r}</p>
                                    ))}
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          );
                        })}
                        {activeWeek.plannedRoutes.length === 0 && (
                          <div className="text-center text-sm text-muted-foreground py-8 border rounded-lg bg-muted/20">
                            No routes planned for this week.
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

            {/* Global planner warnings */}
            {planResult.warnings.length > 0 && (
              <div
                className="rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30 px-3 py-2 text-xs text-orange-700 dark:text-orange-400 space-y-0.5"
                data-testid="banner-global-warnings"
              >
                {planResult.warnings.slice(0, 3).map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
                {planResult.warnings.length > 3 && (
                  <p className="opacity-75">+{planResult.warnings.length - 3} more warnings</p>
                )}
              </div>
            )}

            {applyConfirmPending && (
              <div
                className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-2.5 text-sm flex items-center gap-2"
                data-testid="banner-apply-confirm"
              >
                <span className="text-amber-700 dark:text-amber-400">
                  This will apply <span className="font-semibold">{acceptedWeeks.size}</span> week
                  {acceptedWeeks.size !== 1 ? "s" : ""} covering{" "}
                  <span className="font-semibold">{totalAcceptedStops} stop</span>
                  {totalAcceptedStops !== 1 ? "s" : ""} to your routes.
                </span>
              </div>
            )}

            <div
              className="flex items-center justify-between gap-3 pt-2"
              data-testid="dialog-confirm-apply-weekly"
            >
              <div className="text-sm text-muted-foreground">
                {!applyConfirmPending && acceptedWeeks.size > 0 && (
                  <span>
                    <span className="font-semibold text-foreground">{totalAcceptedStops}</span>{" "}
                    stops across{" "}
                    <span className="font-semibold text-foreground">{acceptedWeeks.size}</span> week
                    {acceptedWeeks.size !== 1 ? "s" : ""} ·{" "}
                    <span className="font-semibold text-foreground">
                      {formatCurrency(totalAcceptedRevenue)}
                    </span>{" "}
                    revenue
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    resetAll();
                    onOpenChange(false);
                  }}
                  data-testid="button-cancel-apply"
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                <Button
                  onClick={handleApplyClick}
                  disabled={acceptedWeeks.size === 0 || applyMutation.isPending}
                  data-testid={applyConfirmPending ? "button-confirm-apply" : "button-apply-plan"}
                  className={
                    applyConfirmPending ? "bg-green-600 hover:bg-green-700 text-white" : ""
                  }
                >
                  {applyMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      Applying…
                    </>
                  ) : applyConfirmPending ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Confirm & Apply {acceptedWeeks.size} Week
                      {acceptedWeeks.size !== 1 ? "s" : ""}
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-1" />
                      Apply Accepted Weeks ({acceptedWeeks.size})
                    </>
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
