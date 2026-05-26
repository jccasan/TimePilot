import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export interface ImportJobStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  errors: Array<{ row: number; message: string }> | null;
  completedAt: string | null;
}

export function downloadErrorReport(
  errors: Array<{ row: number; message: string }>,
  fileName: string
) {
  const csvRows = [
    ["Row", "Error Message"],
    ...errors.map((e) => [String(e.row || ""), e.message.replace(/"/g, '""')]),
  ];
  const csvContent = csvRows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportJobProgress({
  jobId,
  label,
  onComplete,
  onReset,
}: {
  jobId: string;
  label?: string;
  onComplete?: (job: ImportJobStatus) => void;
  onReset?: () => void;
}) {
  const calledComplete = useRef(false);

  const { data: job } = useQuery<ImportJobStatus>({
    queryKey: ["/api/import-batches", jobId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/import-batches/${jobId}`);
      return res.json();
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "completed" || status === "failed") return false;
      return 3000;
    },
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!calledComplete.current && (job?.status === "completed" || job?.status === "failed")) {
      calledComplete.current = true;
      onComplete?.(job);
    }
  }, [job?.status]);

  const processed = (job?.importedRows ?? 0) + (job?.skippedRows ?? 0);
  const total = job?.totalRows ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const isDone = job?.status === "completed" || job?.status === "failed";
  const hasErrors = (job?.errors?.length ?? 0) > 0;

  return (
    <div className="space-y-4" data-testid="import-job-progress">
      <div className="flex items-center gap-3">
        {!isDone ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary flex-shrink-0" />
        ) : job?.status === "failed" ? (
          <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
        ) : (
          <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
        )}
        <div className="flex-1">
          <p className="text-sm font-medium" data-testid="text-job-status">
            {!isDone
              ? `${label ?? "Importing"}… ${processed} of ${total} rows processed`
              : job?.status === "failed"
                ? "Import failed"
                : `Import complete — ${job?.importedRows ?? 0} imported, ${job?.skippedRows ?? 0} skipped`}
          </p>
          {!isDone && (
            <p className="text-xs text-muted-foreground mt-0.5">
              This runs in the background — you can leave this page and come back.
            </p>
          )}
        </div>
      </div>

      <Progress value={isDone ? 100 : pct} className="h-2" data-testid="progress-import" />

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
          <p className="text-xs text-muted-foreground">Imported</p>
          <p className="font-semibold text-green-600" data-testid="text-progress-imported">
            {job?.importedRows ?? 0}
          </p>
        </div>
        <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
          <p className="text-xs text-muted-foreground">Skipped</p>
          <p className="font-semibold text-muted-foreground" data-testid="text-progress-skipped">
            {job?.skippedRows ?? 0}
          </p>
        </div>
        <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="font-semibold" data-testid="text-progress-total">
            {total}
          </p>
        </div>
      </div>

      {isDone && hasErrors && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{job!.errors!.length} rows had errors</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <ul className="list-disc pl-4 space-y-1 text-sm mt-1">
              {job!.errors!.slice(0, 5).map((e, i) => (
                <li key={i}>
                  {e.row ? `Row ${e.row}: ` : ""}
                  {e.message}
                </li>
              ))}
              {job!.errors!.length > 5 && (
                <li className="text-muted-foreground">…and {job!.errors!.length - 5} more</li>
              )}
            </ul>
            <Button
              size="sm"
              variant="outline"
              className="w-fit mt-1"
              onClick={() => downloadErrorReport(job!.errors!, "import-errors.csv")}
              data-testid="button-download-errors"
            >
              Download error report
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isDone && onReset && (
        <Button variant="outline" onClick={onReset} data-testid="button-reset-after-import">
          Start new import
        </Button>
      )}
    </div>
  );
}
