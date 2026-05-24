import { useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Download, Upload, FileText, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";

interface SkippedRow {
  row: number;
  reason: string;
}

interface ImportResult {
  imported: number;
  skipped: SkippedRow[];
}

interface PreviewData {
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
}

interface CrmImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityLabel: string;
  templateUrl: string;
  importUrl: string;
  invalidateKeys: string[];
  knownFields?: string[];
}

const PREVIEW_LIMIT = 10;

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function parseCSVPreview(raw: string): PreviewData {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return { headers: [], rows: [], totalRows: 0 };
  const headers = splitCSVLine(lines[0]).map((h) => h.trim());
  const allDataLines = lines.slice(1).filter((l) => l.trim() !== "");
  const totalRows = allDataLines.length;
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < Math.min(PREVIEW_LIMIT, allDataLines.length); i++) {
    const vals = splitCSVLine(allDataLines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (vals[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return { headers, rows, totalRows };
}

export function CrmImportModal({
  open,
  onOpenChange,
  entityLabel,
  templateUrl,
  importUrl,
  invalidateKeys,
  knownFields,
}: CrmImportModalProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [step, setStep] = useState<"select" | "preview" | "result">("select");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setResult(null);
    setPreview(null);
  }

  function handleClose(val: boolean) {
    if (!val) {
      setSelectedFile(null);
      setResult(null);
      setPreview(null);
      setStep("select");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    onOpenChange(val);
  }

  async function handlePreview() {
    if (!selectedFile) return;
    const text = await selectedFile.text();
    const data = parseCSVPreview(text);
    if (data.headers.length === 0 || data.totalRows === 0) {
      toast({
        title: "Empty or invalid file",
        description: "The CSV file appears to be empty or has no data rows.",
        variant: "destructive",
      });
      return;
    }
    setPreview(data);
    setStep("preview");
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
      setStep("result");
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

  const unknownColumns =
    knownFields && preview ? preview.headers.filter((h) => !knownFields.includes(h)) : [];

  const isWide = step === "preview";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={isWide ? "max-w-3xl" : "max-w-md"}>
        <DialogHeader>
          <DialogTitle>Import {entityLabel}s from CSV</DialogTitle>
        </DialogHeader>

        {step === "select" && (
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
                Step 2 — Select your filled CSV
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
                disabled={!selectedFile}
                onClick={handlePreview}
                data-testid={`button-crm-import-preview-${entityLabel.toLowerCase()}`}
              >
                <FileText className="w-4 h-4" />
                Preview Import
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && preview && (
          <div className="space-y-4 pt-1">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing <span className="font-medium text-foreground">{preview.rows.length}</span>{" "}
                of <span className="font-medium text-foreground">{preview.totalRows}</span> rows
                {preview.totalRows > PREVIEW_LIMIT && " (first 10 shown)"}
              </div>
              {unknownColumns.length > 0 && (
                <Badge
                  variant="outline"
                  className="text-amber-600 border-amber-300 dark:border-amber-700 dark:text-amber-400 text-xs gap-1"
                >
                  <AlertCircle className="w-3 h-3" />
                  {unknownColumns.length} unknown column{unknownColumns.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            {unknownColumns.length > 0 && (
              <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 space-y-1">
                <p className="font-medium">Column mapping notes:</p>
                <p>
                  The following columns are not recognized and will be ignored during import:{" "}
                  <span className="font-mono">{unknownColumns.join(", ")}</span>
                </p>
              </div>
            )}

            <div className="overflow-auto rounded-lg border border-border/60 max-h-72">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground border-b border-border/60 w-10">
                      #
                    </th>
                    {preview.headers.map((h) => {
                      const isUnknown = knownFields ? !knownFields.includes(h) : false;
                      return (
                        <th
                          key={h}
                          className={`px-2 py-1.5 text-left font-medium border-b border-border/60 whitespace-nowrap ${
                            isUnknown
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                          }`}
                          data-testid={`th-crm-preview-col-${h}`}
                        >
                          {h}
                          {isUnknown && (
                            <span className="ml-1 text-amber-500 dark:text-amber-400">*</span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/40 last:border-0 hover:bg-muted/30"
                      data-testid={`row-crm-preview-${i}`}
                    >
                      <td className="px-2 py-1.5 text-muted-foreground font-mono">{i + 2}</td>
                      {preview.headers.map((h) => (
                        <td key={h} className="px-2 py-1.5 max-w-[180px] truncate" title={row[h]}>
                          {row[h] || <span className="text-muted-foreground/50 italic">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => setStep("select")}
                data-testid="button-crm-import-back"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </Button>
              <Button
                className="gap-2 flex-1"
                onClick={handleUpload}
                disabled={uploading}
                data-testid={`button-crm-import-confirm-${entityLabel.toLowerCase()}`}
              >
                <Upload className="w-4 h-4" />
                {uploading
                  ? "Importing..."
                  : `Confirm & Import ${preview.totalRows} ${entityLabel}${preview.totalRows !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </div>
        )}

        {step === "result" && result && (
          <div className="space-y-4 pt-1">
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
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => handleClose(false)}
                data-testid="button-crm-import-done"
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
