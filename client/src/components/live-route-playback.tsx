import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Play, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";

const EMPTY_QUERY_KEYS: unknown[][] = [];

type PlaybackSpeed = "slow" | "normal" | "fast" | "turbo";
const SPEED_MS: Record<PlaybackSpeed, number> = { slow: 3000, normal: 1500, fast: 600, turbo: 150 };
const SPEED_LABELS: Record<PlaybackSpeed, string> = { slow: "1×", normal: "2×", fast: "5×", turbo: "10×" };

export interface PlaybackVisit {
  id: string;
  status: string;
  startedAt?: string | null;
}

export function LiveRoutePlayback({
  visits,
  onClose,
  extraQueryKeys = EMPTY_QUERY_KEYS,
}: {
  visits: PlaybackVisit[];
  onClose: () => void;
  extraQueryKeys?: unknown[][];
}) {
  const scheduledVisits = useMemo(
    () => visits.filter(v => v.status === "scheduled" || v.status === "in_progress"),
    [visits]
  );
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>("normal");
  const [done, setDone] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopInterval = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const advanceStop = useCallback(async (idx: number) => {
    const visit = scheduledVisits[idx];
    if (!visit) return;
    try {
      await apiRequest("PATCH", `/api/visits/${visit.id}`, {
        status: "completed",
        completedAt: new Date().toISOString(),
        startedAt: visit.startedAt ?? new Date().toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/visits/range"] });
      for (const key of extraQueryKeys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    } catch (_) {}
  }, [scheduledVisits, extraQueryKeys]);

  useEffect(() => {
    if (!isPlaying || done) return;
    stopInterval();
    intervalRef.current = setInterval(async () => {
      setCurrentIdx(prev => {
        const next = prev;
        advanceStop(next).then(() => {});
        if (next + 1 >= scheduledVisits.length) {
          stopInterval();
          setIsPlaying(false);
          setDone(true);
        }
        return next + 1 < scheduledVisits.length ? next + 1 : next;
      });
    }, SPEED_MS[speed]);
    return () => stopInterval();
  }, [isPlaying, speed, done, advanceStop, scheduledVisits.length]);

  const handleReset = () => {
    stopInterval();
    setIsPlaying(false);
    setDone(false);
    setCurrentIdx(0);
    queryClient.invalidateQueries({ queryKey: ["/api/visits/range"] });
    for (const key of extraQueryKeys) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const total = scheduledVisits.length;
  const completed = Math.min(currentIdx, total);
  const progress = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div
      className="fixed bottom-6 right-6 z-50 w-80 rounded-xl border bg-card shadow-2xl shadow-black/20"
      data-testid="panel-live-playback"
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b">
        <div className="flex items-center gap-2">
          <Play className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Live Route Playback</span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors" data-testid="button-close-playback">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="px-4 py-3 space-y-3">
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span data-testid="text-playback-progress">{completed} / {total} stops</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
              data-testid="bar-playback-progress"
            />
          </div>
          {done && <p className="text-xs text-green-600 font-medium">All stops completed!</p>}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Speed:</span>
          <div className="flex gap-1 flex-1">
            {(["slow", "normal", "fast", "turbo"] as PlaybackSpeed[]).map(s => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`flex-1 text-xs py-1 rounded border transition-colors ${speed === s ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                data-testid={`button-speed-${s}`}
              >
                {SPEED_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            variant={isPlaying ? "outline" : "default"}
            onClick={() => setIsPlaying(p => !p)}
            disabled={done || total === 0}
            data-testid="button-playback-playpause"
          >
            {isPlaying ? (
              <><span className="inline-block w-3 h-3 border-2 border-current mr-1.5 rounded-sm" />Pause</>
            ) : (
              <><Play className="h-3.5 w-3.5 mr-1.5" />{done ? "Done" : "Play"}</>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleReset}
            data-testid="button-playback-reset"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
        {total === 0 && (
          <p className="text-xs text-muted-foreground text-center">No scheduled visits for today</p>
        )}
      </div>
    </div>
  );
}
