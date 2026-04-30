import {
  WifiOff,
  Wifi,
  Loader2,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import type { SyncResult } from "@/lib/offline-sync";

interface OfflineStatusBarProps {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSyncResult: SyncResult | null;
  onRetrySync: () => void;
  onDismissFailures?: () => void;
}

export function OfflineStatusBar({
  isOnline,
  pendingCount,
  isSyncing,
  lastSyncResult,
  onRetrySync,
  onDismissFailures,
}: OfflineStatusBarProps) {
  const [showSyncSuccess, setShowSyncSuccess] = useState(false);
  const [showFailureDetails, setShowFailureDetails] = useState(false);

  useEffect(() => {
    if (
      lastSyncResult &&
      (lastSyncResult.mutationsSynced > 0 || lastSyncResult.photosSynced > 0) &&
      lastSyncResult.mutationsFailed === 0 &&
      lastSyncResult.photosFailed === 0
    ) {
      setShowSyncSuccess(true);
      setShowFailureDetails(false);
      const timer = setTimeout(() => setShowSyncSuccess(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [lastSyncResult]);

  const hasFailures = lastSyncResult && lastSyncResult.failedItems.length > 0;

  if (isOnline && pendingCount === 0 && !isSyncing && !showSyncSuccess && !hasFailures) {
    return null;
  }

  return (
    <div
      className={`rounded-lg mb-3 ${
        !isOnline
          ? "bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200"
          : hasFailures
            ? "bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200"
            : isSyncing
              ? "bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200"
              : showSyncSuccess
                ? "bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200"
                : pendingCount > 0
                  ? "bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200"
                  : ""
      }`}
      data-testid="status-offline-bar"
    >
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        {!isOnline ? (
          <>
            <WifiOff className="h-4 w-4 shrink-0" />
            <span className="flex-1">
              You're offline — changes will sync when connection returns
            </span>
            {pendingCount > 0 && (
              <Badge variant="secondary" className="shrink-0" data-testid="badge-pending-count">
                {pendingCount} pending
              </Badge>
            )}
          </>
        ) : isSyncing ? (
          <>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <span className="flex-1">Syncing offline changes...</span>
          </>
        ) : showSyncSuccess ? (
          <>
            <Check className="h-4 w-4 shrink-0" />
            <span className="flex-1">All changes synced successfully</span>
          </>
        ) : hasFailures ? (
          <>
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1">
              {lastSyncResult!.failedItems.length} item
              {lastSyncResult!.failedItems.length !== 1 ? "s" : ""} failed to sync
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowFailureDetails(!showFailureDetails)}
              className="shrink-0 h-7 w-7 p-0"
              data-testid="button-toggle-failure-details"
            >
              {showFailureDetails ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onRetrySync}
              className="shrink-0 h-7 text-xs"
              data-testid="button-retry-sync"
            >
              Retry
            </Button>
            {onDismissFailures && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onDismissFailures}
                className="shrink-0 h-7 w-7 p-0"
                data-testid="button-dismiss-failures"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        ) : pendingCount > 0 ? (
          <>
            <Wifi className="h-4 w-4 shrink-0" />
            <span className="flex-1">
              {pendingCount} item{pendingCount !== 1 ? "s" : ""} waiting to sync
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={onRetrySync}
              className="shrink-0 h-7 text-xs"
              data-testid="button-sync-now"
            >
              Sync Now
            </Button>
          </>
        ) : null}
      </div>

      {hasFailures && showFailureDetails && (
        <div className="px-3 pb-2 space-y-1" data-testid="container-failure-details">
          {lastSyncResult!.failedItems.map((item, i) => {
            const label =
              item.type === "mutation"
                ? `Visit update${item.url ? ` (${item.url.replace(/^\/api\/visits\/[^/]+/, "visit")})` : ""}`
                : `Photo upload`;
            return (
              <div
                key={i}
                className="text-xs rounded px-2 py-1.5 bg-white/50 dark:bg-black/20"
                data-testid={`text-failure-detail-${i}`}
              >
                <span className="font-medium">{label}</span>
                <span className="text-muted-foreground ml-1">— {item.error}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
