import { WifiOff, Wifi, Loader2, AlertTriangle, Check } from "lucide-react";
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
}

export function OfflineStatusBar({
  isOnline,
  pendingCount,
  isSyncing,
  lastSyncResult,
  onRetrySync,
}: OfflineStatusBarProps) {
  const [showSyncSuccess, setShowSyncSuccess] = useState(false);

  useEffect(() => {
    if (
      lastSyncResult &&
      (lastSyncResult.mutationsSynced > 0 || lastSyncResult.photosSynced > 0) &&
      lastSyncResult.mutationsFailed === 0 &&
      lastSyncResult.photosFailed === 0
    ) {
      setShowSyncSuccess(true);
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
      className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg mb-3 ${
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
          <span className="flex-1">
            All changes synced successfully
          </span>
        </>
      ) : hasFailures ? (
        <>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            {lastSyncResult!.failedItems.length} item{lastSyncResult!.failedItems.length !== 1 ? "s" : ""} failed to sync
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={onRetrySync}
            className="shrink-0 h-7 text-xs"
            data-testid="button-retry-sync"
          >
            Retry
          </Button>
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
  );
}
