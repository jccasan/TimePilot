import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { CloudOff, Image } from "lucide-react";
import { getPendingPhotosForVisit, type PendingPhoto } from "@/lib/offline-store";

interface PendingPhotosIndicatorProps {
  visitId: string;
  refreshTrigger?: number;
}

export function PendingPhotosIndicator({ visitId, refreshTrigger }: PendingPhotosIndicatorProps) {
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);

  useEffect(() => {
    getPendingPhotosForVisit(visitId).then(photos => {
      setPendingPhotos(photos.filter(p => p.status === "pending" || p.status === "failed"));
    }).catch(() => {});
  }, [visitId, refreshTrigger]);

  if (pendingPhotos.length === 0) return null;

  const failedCount = pendingPhotos.filter(p => p.status === "failed").length;
  const typeLabels = pendingPhotos.map(p => {
    switch (p.photoType) {
      case "before": return "Before";
      case "after": return "After";
      case "gate": return "Proof";
      case "extra": return "Extra";
      default: return "Photo";
    }
  });

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2"
      data-testid={`container-pending-photos-${visitId}`}
    >
      <CloudOff className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
      <span className="text-xs text-amber-700 dark:text-amber-300">
        {pendingPhotos.length} photo{pendingPhotos.length !== 1 ? "s" : ""} pending upload
      </span>
      {typeLabels.map((label, i) => (
        <Badge
          key={i}
          variant="outline"
          className={`text-xs ${pendingPhotos[i].status === "failed" ? "border-red-300 text-red-600 dark:border-red-700 dark:text-red-400" : "border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400"}`}
          data-testid={`badge-pending-photo-${visitId}-${i}`}
        >
          <Image className="h-3 w-3 mr-1" />
          {label}
          {pendingPhotos[i].status === "failed" && " (failed)"}
        </Badge>
      ))}
      {failedCount > 0 && (
        <span className="text-xs text-red-600 dark:text-red-400">
          Will retry on next sync
        </span>
      )}
    </div>
  );
}
