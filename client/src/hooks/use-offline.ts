import { useState, useEffect, useCallback, useRef } from "react";
import { getPendingCount } from "@/lib/offline-store";
import { syncAll, type SyncResult } from "@/lib/offline-sync";
import { queryClient } from "@/lib/queryClient";

export function useOffline() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const syncingRef = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await getPendingCount();
      setPendingCount(count);
    } catch {
      // IndexedDB not available
    }
  }, []);

  const performSync = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setIsSyncing(true);

    try {
      const result = await syncAll();
      setLastSyncResult(result);
      await refreshPendingCount();

      if (result.mutationsSynced > 0 || result.photosSynced > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/visits/today"] });
        queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      }
    } catch {
      // sync failed, will retry
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, [refreshPendingCount]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      performSync();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    refreshPendingCount().then(async () => {
      const count = await getPendingCount();
      if (count > 0 && navigator.onLine) {
        performSync();
      }
    });

    const interval = setInterval(refreshPendingCount, 5000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [performSync, refreshPendingCount]);

  return {
    isOnline,
    pendingCount,
    isSyncing,
    lastSyncResult,
    refreshPendingCount,
    performSync,
  };
}
