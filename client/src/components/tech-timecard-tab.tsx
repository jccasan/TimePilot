import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Clock,
  Coffee,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  Loader2,
  Play,
  Square,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Break {
  id: string;
  breakStart: string;
  breakEnd: string | null;
  durationMinutes: number | null;
}

interface TimeEntry {
  id: string;
  clockIn: string;
  clockOut: string | null;
  durationMinutes: number | null;
  notes: string | null;
  editedBy: string | null;
  breaks: Break[];
}

interface DailyBreakdown {
  date: string;
  regularMinutes: number;
  overtimeMinutes: number;
  breakMinutes: number;
}

interface Totals {
  totalRegularMinutes: number;
  totalOvertimeMinutes: number;
  totalBreakMinutes: number;
  dailyBreakdown: DailyBreakdown[];
}

interface TimecardPeriod {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "submitted" | "approved" | "rejected";
  submittedAt: string | null;
  rejectionNotes: string | null;
  totalRegularMinutes: number | null;
  totalOvertimeMinutes: number | null;
  entries: TimeEntry[];
  totals: Totals;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function statusColor(
  status: TimecardPeriod["status"]
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "approved":
      return "default";
    case "submitted":
      return "secondary";
    case "rejected":
      return "destructive";
    default:
      return "outline";
  }
}

function statusLabel(status: TimecardPeriod["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// ─── Clock Widget ─────────────────────────────────────────────────────────────

export function ClockWidget() {
  const { toast } = useToast();

  const { data: activeEntry, isLoading } = useQuery<TimeEntry | null>({
    queryKey: ["/api/time-entries/active"],
    refetchInterval: 30000,
  });

  const { data: activeBreak, refetch: refetchBreak } = useQuery<Break | null>({
    queryKey: ["/api/time-entries/active/break"],
    enabled: !!activeEntry,
    queryFn: () =>
      activeEntry
        ? apiRequest("GET", `/api/time-entries/${activeEntry.id}/breaks`).then((r: Break[]) =>
            r.find((b) => b.breakEnd === null) ?? null
          )
        : Promise.resolve(null),
    refetchInterval: activeEntry ? 15000 : false,
  });

  const [elapsed, setElapsed] = useState(0);
  const [breakElapsed, setBreakElapsed] = useState(0);

  useEffect(() => {
    if (!activeEntry) return;
    const tick = () => {
      setElapsed(
        Math.floor((Date.now() - new Date(activeEntry.clockIn).getTime()) / 1000)
      );
      if (activeBreak?.breakStart) {
        setBreakElapsed(
          Math.floor((Date.now() - new Date(activeBreak.breakStart).getTime()) / 1000)
        );
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeEntry, activeBreak]);

  const clockInMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/time-entries/clock-in", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries/active"] });
      toast({ title: "Clocked in" });
    },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const clockOutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/time-entries/clock-out", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timecards/my/current"] });
      toast({ title: "Clocked out" });
    },
    onError: (e: any) =>
      toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const startBreakMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/time-entries/${activeEntry!.id}/breaks/start`, {}),
    onSuccess: () => {
      refetchBreak();
      toast({ title: "Break started" });
    },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const endBreakMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/time-entries/${activeEntry!.id}/breaks/end`, {}),
    onSuccess: () => {
      refetchBreak();
      toast({ title: "Break ended" });
    },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-20 w-full rounded-xl" />;

  const fmtElapsed = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  if (!activeEntry) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Not clocked in</span>
          </div>
          <Button
            size="sm"
            onClick={() => clockInMutation.mutate()}
            disabled={clockInMutation.isPending}
          >
            {clockInMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            Clock In
          </Button>
        </CardContent>
      </Card>
    );
  }

  const onBreak = !!activeBreak;
  const grossSecs = elapsed;
  const breakSecs = onBreak ? breakElapsed : 0;
  const netSecs = Math.max(0, grossSecs - breakSecs);

  return (
    <Card className={onBreak ? "border-amber-400" : "border-green-500"}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${onBreak ? "bg-amber-400" : "bg-green-500 animate-pulse"}`}
            />
            <span className="text-sm font-medium">
              {onBreak ? "On Break" : "Clocked In"}
            </span>
            <span className="text-xs text-muted-foreground">
              since {fmtTime(activeEntry.clockIn)}
            </span>
          </div>
          <span className="font-mono text-sm">{fmtElapsed(elapsed)}</span>
        </div>

        {onBreak && (
          <div className="flex items-center justify-between text-sm text-amber-600 bg-amber-50 rounded-md px-3 py-2">
            <span className="flex items-center gap-1.5">
              <Coffee className="h-4 w-4" />
              Break time
            </span>
            <span className="font-mono">{fmtElapsed(breakElapsed)}</span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 text-xs text-center text-muted-foreground border-t pt-2">
          <div>
            <div className="font-medium text-foreground">{fmtElapsed(grossSecs)}</div>
            <div>Total</div>
          </div>
          <div>
            <div className="font-medium text-foreground">{fmtElapsed(breakSecs)}</div>
            <div>Break</div>
          </div>
          <div>
            <div className="font-medium text-foreground">{fmtElapsed(netSecs)}</div>
            <div>Net</div>
          </div>
        </div>

        <div className="flex gap-2">
          {!onBreak ? (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => startBreakMutation.mutate()}
              disabled={startBreakMutation.isPending}
            >
              {startBreakMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Coffee className="h-4 w-4 mr-1" />
              )}
              Start Break
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 border-amber-400"
              onClick={() => endBreakMutation.mutate()}
              disabled={endBreakMutation.isPending}
            >
              {endBreakMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-1" />
              )}
              End Break
            </Button>
          )}

          {!onBreak && (
            <Button
              variant="destructive"
              size="sm"
              className="flex-1"
              onClick={() => clockOutMutation.mutate()}
              disabled={clockOutMutation.isPending}
            >
              {clockOutMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Square className="h-4 w-4 mr-1" />
              )}
              Clock Out
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Period Detail ────────────────────────────────────────────────────────────

function PeriodDetail({
  period,
  onBack,
  readOnly,
}: {
  period: TimecardPeriod;
  onBack: () => void;
  readOnly?: boolean;
}) {
  const { toast } = useToast();

  const submitMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/timecards/my/${period.id}/submit`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timecards/my/current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timecards/my"] });
      toast({ title: "Timecard submitted" });
      onBack();
    },
    onError: (e: any) =>
      toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const hasCompletedEntries = period.entries.some((e) => e.clockOut !== null);
  const canSubmit = !readOnly && period.status === "draft" && hasCompletedEntries;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          ← Back
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">
            {fmtDate(period.periodStart)} – {fmtDate(period.periodEnd)}
          </div>
        </div>
        <Badge variant={statusColor(period.status)}>{statusLabel(period.status)}</Badge>
      </div>

      {period.status === "rejected" && period.rejectionNotes && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Returned by office</div>
            <div className="text-destructive/80 mt-0.5">{period.rejectionNotes}</div>
          </div>
        </div>
      )}

      {/* Summary totals */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold">
              {fmtMins(period.totals.totalRegularMinutes)}
            </div>
            <div className="text-xs text-muted-foreground">Regular</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div
              className={`text-lg font-bold ${period.totals.totalOvertimeMinutes > 0 ? "text-orange-500" : ""}`}
            >
              {fmtMins(period.totals.totalOvertimeMinutes)}
            </div>
            <div className="text-xs text-muted-foreground">Overtime</div>
          </CardContent>
        </Card>
      </div>

      {/* Entries */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Entries</h3>
        {period.entries.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No entries yet</p>
        )}
        {period.entries.map((entry) => {
          const breakMins = entry.breaks.reduce(
            (s, b) => s + (b.durationMinutes ?? 0),
            0
          );
          const netMins = Math.max(0, (entry.durationMinutes ?? 0) - breakMins);
          return (
            <Card key={entry.id}>
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {new Date(entry.clockIn).toLocaleDateString([], {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  {entry.editedBy && (
                    <Badge variant="outline" className="text-xs">
                      Edited by office
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>In: {fmtTime(entry.clockIn)}</span>
                  {entry.clockOut && <span>Out: {fmtTime(entry.clockOut)}</span>}
                  {!entry.clockOut && (
                    <Badge variant="outline" className="text-xs">
                      Active
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span>
                    {entry.breaks.length} break{entry.breaks.length !== 1 ? "s" : ""}{" "}
                    {breakMins > 0 && `(${fmtMins(breakMins)})`}
                  </span>
                  <span className="font-medium">{fmtMins(netMins)} net</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Daily breakdown */}
      {period.totals.dailyBreakdown.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-muted-foreground">Daily Totals</h3>
          {period.totals.dailyBreakdown.map((day) => (
            <div
              key={day.date}
              className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-muted/40"
            >
              <span>{fmtDate(day.date)}</span>
              <div className="flex items-center gap-3">
                <span>{fmtMins(day.regularMinutes)}</span>
                {day.overtimeMinutes > 0 && (
                  <span className="text-orange-500 font-medium">
                    +{fmtMins(day.overtimeMinutes)} OT
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canSubmit && (
        <Button
          className="w-full"
          onClick={() => submitMutation.mutate()}
          disabled={submitMutation.isPending}
        >
          {submitMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <CheckCircle className="h-4 w-4 mr-2" />
          )}
          Submit for Approval
        </Button>
      )}

      {period.status === "submitted" && (
        <div className="text-center text-sm text-muted-foreground py-2">
          Submitted — awaiting approval
        </div>
      )}
    </div>
  );
}

// ─── Main Timecard Tab ────────────────────────────────────────────────────────

export function TechTimecardTab() {
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);

  const { data: currentPeriod, isLoading: currentLoading } = useQuery<TimecardPeriod>({
    queryKey: ["/api/timecards/my/current"],
    refetchInterval: 60000,
  });

  const { data: pastPeriods = [], isLoading: pastLoading } = useQuery<TimecardPeriod[]>({
    queryKey: ["/api/timecards/my"],
  });

  const { data: selectedPeriod, isLoading: selectedLoading } = useQuery<TimecardPeriod>({
    queryKey: [`/api/timecards/my/${selectedPeriodId}`],
    enabled: !!selectedPeriodId && selectedPeriodId !== currentPeriod?.id,
  });

  if (selectedPeriodId) {
    const period =
      selectedPeriodId === currentPeriod?.id
        ? currentPeriod
        : selectedPeriod;

    if (selectedLoading || (selectedPeriodId !== currentPeriod?.id && !selectedPeriod)) {
      return (
        <div className="space-y-3 p-4">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      );
    }

    if (period) {
      return (
        <div className="p-4">
          <PeriodDetail
            period={period}
            onBack={() => setSelectedPeriodId(null)}
            readOnly={selectedPeriodId !== currentPeriod?.id}
          />
        </div>
      );
    }
  }

  return (
    <div className="p-4 space-y-4">
      {/* Current period card */}
      <div>
        <h2 className="text-base font-semibold mb-2">Current Period</h2>
        {currentLoading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : currentPeriod ? (
          <Card
            className="cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => setSelectedPeriodId(currentPeriod.id)}
          >
            <CardContent className="p-4 flex items-center justify-between">
              <div className="space-y-1">
                <div className="text-sm font-medium">
                  {fmtDate(currentPeriod.periodStart)} – {fmtDate(currentPeriod.periodEnd)}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{fmtMins(currentPeriod.totals.totalRegularMinutes)} regular</span>
                  {currentPeriod.totals.totalOvertimeMinutes > 0 && (
                    <span className="text-orange-500">
                      +{fmtMins(currentPeriod.totals.totalOvertimeMinutes)} OT
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={statusColor(currentPeriod.status)}>
                  {statusLabel(currentPeriod.status)}
                </Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">No active period</p>
        )}
      </div>

      {/* Past periods */}
      <div>
        <h2 className="text-base font-semibold mb-2">Past Periods</h2>
        {pastLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : (
          <div className="space-y-2">
            {pastPeriods
              .filter((p) => p.id !== currentPeriod?.id)
              .map((period) => (
                <Card
                  key={period.id}
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => setSelectedPeriodId(period.id)}
                >
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">
                        {fmtDate(period.periodStart)} – {fmtDate(period.periodEnd)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {period.totalRegularMinutes !== null
                          ? `${fmtMins(period.totalRegularMinutes)} total`
                          : `${period.entries?.length ?? 0} entries`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusColor(period.status)}>
                        {statusLabel(period.status)}
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            {pastPeriods.filter((p) => p.id !== currentPeriod?.id).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No past periods yet
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
