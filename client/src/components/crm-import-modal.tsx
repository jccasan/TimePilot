import { useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Upload, FileText, CheckCircle2, AlertCircle } from "lucide-react";

interface SkippedRow {
  row: number;
  reason: string;
}

interface ImportResult {
  imported: number;
  skipped: SkippedRow[];
}

interface CrmImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityLabel: string;
  templateUrl: string;
  importUrl: string;
  invalidateKeys: string[];
}

export function CrmImportModal({
  open,
  onOpenChange,
  entityLabel,
  templateUrl,
  importUrl,
  invalidateKeys,
}: CrmImportModalProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setResult(null);
  }

  function handleClose(val: boolean) {
    if (!val) {
      setSelectedFile(null);
      setResult(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    onOpenChange(val);
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      const res = await fetch(importUrl, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message ?? "Upload failed");
      }
      const data: ImportResult = await res.json();
      setResult(data);
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      if (data.imported > 0) {
        toast({
          title: `Imported ${data.imported} ${entityLabel.toLowerCase()}${data.imported !== 1 ? "s" : ""}`,
          description:
            data.skipped.length > 0
              ? `${data.skipped.length} row${data.skipped.length !== 1 ? "s" : ""} skipped`
              : "All rows imported successfully",
        });
      } else {
        toast({
          title: "No records imported",
          description:
            data.skipped.length > 0
              ? `${data.skipped.length} rows had errors`
              : "File appears empty",
          variant: "destructive",
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Import failed";
      toast({ title: "Import failed", description: msg, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import {entityLabel}s from CSV</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileText className="w-4 h-4 text-muted-foreground" />
              Step 1 — Download the template
            </div>
            <p className="text-xs text-muted-foreground">
              Fill in the template with your data. Required fields are marked in the header row.
            </p>
            <a
              href={templateUrl}
              download
              data-testid={`link-crm-import-template-${entityLabel.toLowerCase()}`}
            >
              <Button variant="outline" size="sm" className="gap-2 mt-1">
                <Download className="w-4 h-4" />
                Download Template
              </Button>
            </a>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Upload className="w-4 h-4 text-muted-foreground" />
              Step 2 — Upload your filled CSV
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-border file:text-xs file:font-medium file:bg-background file:text-foreground hover:file:bg-muted cursor-pointer"
              onChange={handleFileChange}
              data-testid={`input-crm-import-file-${entityLabel.toLowerCase()}`}
            />
            {selectedFile && (
              <p className="text-xs text-muted-foreground">
                Selected: <span className="font-mono">{selectedFile.name}</span> (
                {(selectedFile.size / 1024).toFixed(1)} KB)
              </p>
            )}
            <Button
              className="gap-2 w-full mt-1"
              disabled={!selectedFile || uploading}
              onClick={handleUpload}
              data-testid={`button-crm-import-upload-${entityLabel.toLowerCase()}`}
            >
              <Upload className="w-4 h-4" />
              {uploading ? "Importing..." : "Upload & Import"}
            </Button>
          </div>

          {result && (
            <div className="rounded-lg border border-border/60 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                {result.imported > 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-destructive" />
                )}
                Import Results
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 px-3 py-2 text-center">
                  <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                    {result.imported}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-500">Imported</p>
                </div>
                <div className="rounded bg-muted border border-border px-3 py-2 text-center">
                  <p className="text-2xl font-bold">{result.skipped.length}</p>
                  <p className="text-xs text-muted-foreground">Skipped</p>
                </div>
              </div>
              {result.skipped.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  <p className="text-xs font-medium text-muted-foreground">Skipped rows:</p>
                  {result.skipped.map((s, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 rounded px-2 py-1"
                      data-testid={`text-crm-import-skip-${idx}`}
                    >
                      <span className="font-mono shrink-0">Row {s.row}:</span>
                      <span>{s.reason}</span>
                    </div>
                  ))}
                </div>
              )}
              {result.imported > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => handleClose(false)}
                  data-testid="button-crm-import-done"
                >
                  Done
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
