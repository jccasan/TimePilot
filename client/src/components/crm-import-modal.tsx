import { useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Download,
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";

interface SkippedRow {
  row: number;
  reason: string;
  data?: Record<string, string>;
}

interface ImportResult {
  imported?: number;
  created?: number;
  updated?: number;
  skipped: SkippedRow[];
}

interface PreviewData {
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
}

interface CellError {
  message: string;
}

type ValidationErrors = Record<number, Record<string, CellError>>;

interface CrmImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityLabel: string;
  templateUrl: string;
  importUrl: string;
  invalidateKeys: string[];
  knownFields?: string[];
  requiredFields?: string[];
}

const PREVIEW_LIMIT = 10;
const IGNORE_SENTINEL = "__ignore__";

// ── Validators ────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
const PHONE_DIGIT_RE = /\d/g;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

function isEmailField(name: string) {
  return /email/i.test(name);
}
function isPhoneField(name: string) {
  return /phone|mobile|cell/i.test(name);
}
function isNumericField(name: string) {
  return /price|rate|amount|cost|fee|revenue|balance|charge|total|qty|quantity/i.test(name);
}
function isZipField(name: string) {
  return /zip|postal/i.test(name);
}

function validateCell(header: string, value: string, required: boolean): CellError | null {
  const empty = value.trim() === "";

  if (required && empty) {
    return { message: `Required — "${header}" must not be blank` };
  }
  if (empty) return null;

  if (isEmailField(header)) {
    if (!EMAIL_RE.test(value.trim())) {
      return { message: `Invalid email format: "${value}"` };
    }
  }

  if (isPhoneField(header)) {
    const digits = (value.match(PHONE_DIGIT_RE) ?? []).length;
    if (digits < 7) {
      return { message: `Phone number looks too short: "${value}"` };
    }
  }

  if (isNumericField(header)) {
    const stripped = value.replace(/[$,\s]/g, "");
    if (!NUMERIC_RE.test(stripped)) {
      return { message: `Expected a number: "${value}"` };
    }
  }

  if (isZipField(header)) {
    if (!ZIP_RE.test(value.trim())) {
      return { message: `Expected a 5-digit ZIP code: "${value}"` };
    }
  }

  return null;
}

function validatePreview(data: PreviewData, requiredFields: string[]): ValidationErrors {
  const errors: ValidationErrors = {};
  data.rows.forEach((row, rowIdx) => {
    data.headers.forEach((header) => {
      const isRequired = requiredFields.includes(header);
      const err = validateCell(header, row[header] ?? "", isRequired);
      if (err) {
        if (!errors[rowIdx]) errors[rowIdx] = {};
        errors[rowIdx][header] = err;
      }
    });
  });
  return errors;
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

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
  for (let i = 0; i < allDataLines.length; i++) {
    const vals = splitCSVLine(allDataLines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (vals[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return { headers, rows, totalRows };
}

function buildPreviewErrorCsv(data: PreviewData, errors: ValidationErrors): string {
  const errorRowIndices = Object.keys(errors)
    .map(Number)
    .sort((a, b) => a - b);
  const headers = [...data.headers, "error_reason"];
  const escapeCell = (val: string) => {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };
  const lines = [
    headers.map(escapeCell).join(","),
    ...errorRowIndices.map((rowIdx) => {
      const row = data.rows[rowIdx];
      const rowErrors = errors[rowIdx];
      const reason = Object.values(rowErrors)
        .map((e) => e.message)
        .join("; ");
      return [...data.headers.map((h) => escapeCell(row[h] ?? "")), escapeCell(reason)].join(",");
    }),
  ];
  return lines.join("\n");
}

function buildErrorCsv(skipped: SkippedRow[]): string {
  const dataKeys = skipped.length > 0 && skipped[0].data ? Object.keys(skipped[0].data) : [];
  const headers = [...dataKeys, "error_reason"];
  const escapeCell = (val: string) => {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };
  const lines = [
    headers.join(","),
    ...skipped.map((s) => {
      const dataCells = dataKeys.map((k) => escapeCell(s.data?.[k] ?? ""));
      return [...dataCells, escapeCell(s.reason)].join(",");
    }),
  ];
  return lines.join("\n");
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function rebuildCsvWithRemap(rawText: string, columnRemap: Record<string, string>): string {
  const lines = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length === 0) return rawText;
  const originalHeaders = splitCSVLine(lines[0]).map((h) => h.trim());
  const remappedHeaders = originalHeaders.map((h) => {
    const mapped = columnRemap[h];
    if (mapped && mapped !== IGNORE_SENTINEL) return mapped;
    return h;
  });
  const newFirstLine = remappedHeaders
    .map((h) => (h.includes(",") || h.includes('"') ? `"${h.replace(/"/g, '""')}"` : h))
    .join(",");
  return [newFirstLine, ...lines.slice(1)].join("\n");
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CrmImportModal({
  open,
  onOpenChange,
  entityLabel,
  templateUrl,
  importUrl,
  invalidateKeys,
  knownFields,
  requiredFields = [],
}: CrmImportModalProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const retryFileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const [step, setStep] = useState<"select" | "preview" | "result" | "retry" | "retry-result">("select");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [rawCsvText, setRawCsvText] = useState<string>("");
  const [columnRemap, setColumnRemap] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [retryResult, setRetryResult] = useState<ImportResult | null>(null);
  const [errorCsvDownloaded, setErrorCsvDownloaded] = useState(false);

  const retryUrl = `${importUrl}/retry`;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setResult(null);
    setPreview(null);
    setColumnRemap({});
    setRawCsvText("");
  }

  function handleRetryFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setRetryFile(file);
  }

  function handleClose(val: boolean) {
    if (!val) {
      setSelectedFile(null);
      setRetryFile(null);
      setResult(null);
      setRetryResult(null);
      setPreview(null);
      setColumnRemap({});
      setRawCsvText("");
      setStep("select");
      setErrorCsvDownloaded(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (retryFileInputRef.current) retryFileInputRef.current.value = "";
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
    setRawCsvText(text);
    setColumnRemap({});
    setPreview(data);
    setStep("preview");
  }

  function handleRetry() {
    setResult(null);
    setSelectedFile(null);
    setColumnRemap({});
    setRawCsvText("");
    setStep("select");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  function handleDownloadPreviewErrors() {
    if (!preview || errorRowCount === 0) return;
    const csv = buildPreviewErrorCsv(preview, validationErrors);
    downloadCsv(csv, `${entityLabel.toLowerCase()}_preview_errors.csv`);
  }

  function handleDownloadErrors() {
    if (!result?.skipped.length) return;
    const csv = buildErrorCsv(result.skipped);
    downloadCsv(csv, `${entityLabel.toLowerCase()}_import_errors.csv`);
    setErrorCsvDownloaded(true);
  }

  function handleRemap(originalCol: string, targetField: string) {
    setColumnRemap((prev) => ({ ...prev, [originalCol]: targetField }));
  }

  function getEffectiveHeaders(headers: string[]): string[] {
    return headers.map((h) => {
      const mapped = columnRemap[h];
      if (mapped && mapped !== IGNORE_SENTINEL) return mapped;
      return h;
    });
  }

  function getEffectiveRows(
    rows: Record<string, string>[],
    headers: string[]
  ): Record<string, string>[] {
    const effectiveHeaders = getEffectiveHeaders(headers);
    return rows.map((row) => {
      const newRow: Record<string, string> = {};
      headers.forEach((orig, idx) => {
        const key = effectiveHeaders[idx];
        newRow[key] = row[orig];
      });
      return newRow;
    });
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setResult(null);
    try {
      const hasRemap = Object.values(columnRemap).some((v) => v && v !== IGNORE_SENTINEL);
      let fileToUpload: File = selectedFile;
      if (hasRemap && rawCsvText) {
        const rebuilt = rebuildCsvWithRemap(rawCsvText, columnRemap);
        const blob = new Blob([rebuilt], { type: "text/csv" });
        fileToUpload = new File([blob], selectedFile.name, { type: "text/csv" });
      }
      const fd = new FormData();
      fd.append("file", fileToUpload);
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
      const createdCount = data.created ?? data.imported ?? 0;
      const updatedCount = data.updated ?? 0;
      if (createdCount > 0 || updatedCount > 0) {
        const parts: string[] = [];
        if (createdCount > 0) parts.push(`${createdCount} created`);
        if (updatedCount > 0) parts.push(`${updatedCount} updated`);
        if (data.skipped.length > 0) parts.push(`${data.skipped.length} skipped`);
        toast({ title: "Import complete", description: parts.join(", ") });
      } else {
        toast({
          title: "No records imported",
          description:
            data.skipped.length > 0 ? `${data.skipped.length} rows skipped` : "File appears empty",
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

  // ── Derived preview state ─────────────────────────────────────────────────

  // All columns that were originally unrecognized (drives the remap panel)
  const originallyUnknownCols =
    knownFields && preview ? preview.headers.filter((h) => !knownFields.includes(h)) : [];

  async function handleRetryUpload() {
    if (!retryFile) return;
    setUploading(true);
    setRetryResult(null);
    try {
      const fd = new FormData();
      fd.append("file", retryFile);
      const res = await fetch(retryUrl, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message ?? "Upload failed");
      }
      const data: ImportResult = await res.json();
      setRetryResult(data);
      setStep("retry-result");
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      const recoveredCount = data.created ?? data.imported ?? 0;
      if (recoveredCount > 0) {
        toast({
          title: `Recovered ${recoveredCount} ${entityLabel.toLowerCase()}${recoveredCount !== 1 ? "s" : ""}`,
          description:
            data.skipped.length > 0
              ? `${data.skipped.length} row${data.skipped.length !== 1 ? "s" : ""} still have errors`
              : "All corrected rows imported successfully",
        });
      } else {
        toast({
          title: "No records recovered",
          description:
            data.skipped.length > 0
              ? `${data.skipped.length} rows still have errors`
              : "File appears empty",
          variant: "destructive",
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Retry failed";
      toast({ title: "Retry failed", description: msg, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function handleDownloadRetryErrors() {
    if (!retryResult?.skipped.length) return;
    const csv = buildErrorCsv(retryResult.skipped);
    downloadCsv(csv, `${entityLabel.toLowerCase()}_import_errors_retry.csv`);
  }

  // Badge count: only columns not yet resolved (not remapped and not ignored)
  const unresolvedCount = originallyUnknownCols.filter((h) => !columnRemap[h]).length;

  // Fields already chosen as remap targets by other columns (prevent duplicate targets)
  const alreadyRemappedTo = new Set(
    Object.values(columnRemap).filter((v) => v && v !== IGNORE_SENTINEL)
  );

  // Recognized fields already present as original headers — remapping another column
  // to one of these would create a duplicate header.
  const recognizedOriginalHeaders = new Set(
    preview?.headers.filter((h) => knownFields?.includes(h)) ?? []
  );

  // Effective headers/rows after applying column remappings
  const effectiveHeaders = preview ? getEffectiveHeaders(preview.headers) : [];
  const effectiveRows = preview ? getEffectiveRows(preview.rows, preview.headers) : [];

  // Validation runs against the effective (post-remap) data so errors reflect
  // the field names the server will actually see.
  const validationErrors: ValidationErrors = preview
    ? validatePreview(
        { headers: effectiveHeaders, rows: effectiveRows, totalRows: preview.totalRows },
        requiredFields
      )
    : {};

  // Summarise validation errors across ALL rows (full file)
  const totalErrorCells = Object.values(validationErrors).reduce(
    (sum, rowErrs) => sum + Object.keys(rowErrs).length,
    0
  );
  const errorRowCount = Object.keys(validationErrors).length;
  // Errors visible in the preview table (first PREVIEW_LIMIT rows only)
  const visibleErrorRowCount = Object.keys(validationErrors).filter(
    (k) => Number(k) < PREVIEW_LIMIT
  ).length;

  const isWide = step === "preview";

  const createdCount = result ? (result.created ?? result.imported ?? 0) : 0;
  const updatedCount = result?.updated ?? 0;
  const showUpdated = updatedCount > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={isWide ? "max-w-3xl" : "max-w-md"}>
        <DialogHeader>
          <DialogTitle>
            {step === "retry" || step === "retry-result"
              ? `Fix Failed Rows — ${entityLabel}s`
              : `Import ${entityLabel}s from CSV`}
          </DialogTitle>
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
            {/* Row / column summary */}
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing{" "}
                <span className="font-medium text-foreground">
                  {Math.min(PREVIEW_LIMIT, preview.totalRows)}
                </span>{" "}
                of <span className="font-medium text-foreground">{preview.totalRows}</span> rows
                {preview.totalRows > PREVIEW_LIMIT && " (first 10 shown)"}
              </div>
              <div className="flex items-center gap-2">
                {totalErrorCells > 0 && (
                  <Badge
                    variant="outline"
                    className="text-destructive border-destructive/40 dark:border-destructive/50 text-xs gap-1"
                    data-testid="badge-crm-preview-validation-errors"
                  >
                    <ShieldAlert className="w-3 h-3" />
                    {totalErrorCells} issue{totalErrorCells !== 1 ? "s" : ""}
                  </Badge>
                )}
                {originallyUnknownCols.length > 0 && (
                  <Badge
                    variant="outline"
                    className="text-amber-600 border-amber-300 dark:border-amber-700 dark:text-amber-400 text-xs gap-1"
                  >
                    <AlertCircle className="w-3 h-3" />
                    {unresolvedCount > 0
                      ? `${unresolvedCount} unresolved column${unresolvedCount !== 1 ? "s" : ""}`
                      : "All columns mapped"}
                  </Badge>
                )}
              </div>
            </div>

            {/* Validation summary banner */}
            {totalErrorCells > 0 && (
              <div
                className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive space-y-2"
                data-testid="banner-crm-preview-validation"
              >
                <p className="font-medium flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  {totalErrorCells} formatting issue{totalErrorCells !== 1 ? "s" : ""} across{" "}
                  {errorRowCount} row{errorRowCount !== 1 ? "s" : ""} in the full file
                  {visibleErrorRowCount < errorRowCount &&
                    ` (${visibleErrorRowCount} visible in preview)`}
                  {visibleErrorRowCount === errorRowCount && " (highlighted below)"}
                </p>
                <p className="text-destructive/80">
                  Fix these in your CSV for best results. The server will perform its own checks and
                  skip any rows it cannot process.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive h-7 text-xs"
                  onClick={handleDownloadPreviewErrors}
                  data-testid="button-crm-preview-download-errors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download rows with issues ({errorRowCount})
                </Button>
              </div>
            )}

            {/* Column remap panel */}
            {originallyUnknownCols.length > 0 && (
              <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 space-y-2">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  Unrecognized columns — remap to a known field or mark as ignored
                </p>
                <div className="space-y-1.5">
                  {originallyUnknownCols.map((col) => {
                    const currentValue = columnRemap[col] ?? "";
                    const availableFields =
                      knownFields?.filter(
                        (f) =>
                          !recognizedOriginalHeaders.has(f) &&
                          (!alreadyRemappedTo.has(f) || currentValue === f)
                      ) ?? [];
                    return (
                      <div key={col} className="flex items-center gap-2">
                        <span
                          className="font-mono text-xs text-amber-700 dark:text-amber-400 shrink-0 min-w-0 max-w-[140px] truncate"
                          title={col}
                        >
                          {col}
                        </span>
                        <span className="text-xs text-amber-600/70 dark:text-amber-500/70 shrink-0">
                          →
                        </span>
                        <Select value={currentValue} onValueChange={(val) => handleRemap(col, val)}>
                          <SelectTrigger
                            className="h-7 text-xs flex-1 min-w-0 border-amber-300 dark:border-amber-700 bg-white dark:bg-background"
                            data-testid={`select-remap-col-${col}`}
                          >
                            <SelectValue placeholder="Select a field or ignore" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem
                              value={IGNORE_SENTINEL}
                              data-testid={`option-ignore-${col}`}
                            >
                              Ignore this column
                            </SelectItem>
                            {availableFields.map((f) => (
                              <SelectItem
                                key={f}
                                value={f}
                                data-testid={`option-remap-${col}-to-${f}`}
                              >
                                {f}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Preview table */}
            <div className="overflow-auto rounded-lg border border-border/60 max-h-72">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground border-b border-border/60 w-10">
                      #
                    </th>
                    {preview.headers.map((origCol, idx) => {
                      const effectiveCol = effectiveHeaders[idx];
                      const wasRemapped = effectiveCol !== origCol;
                      const isMappedToIgnore = columnRemap[origCol] === IGNORE_SENTINEL;
                      const isUnknown =
                        knownFields && !wasRemapped && !isMappedToIgnore
                          ? !knownFields.includes(origCol)
                          : false;
                      const isRequired = requiredFields.includes(effectiveCol);
                      return (
                        <th
                          key={origCol}
                          className={`px-2 py-1.5 text-left font-medium border-b border-border/60 whitespace-nowrap ${
                            isMappedToIgnore
                              ? "text-muted-foreground/40 line-through"
                              : wasRemapped
                                ? "text-green-600 dark:text-green-400"
                                : isUnknown
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-muted-foreground"
                          }`}
                          data-testid={`th-crm-preview-col-${origCol}`}
                        >
                          {isMappedToIgnore ? origCol : effectiveCol}
                          {isRequired && (
                            <span className="ml-1 text-destructive" title="Required field">
                              *
                            </span>
                          )}
                          {isUnknown && !wasRemapped && !isRequired && (
                            <span className="ml-1 text-amber-500 dark:text-amber-400">*</span>
                          )}
                          {wasRemapped && (
                            <span
                              className="ml-1 text-green-500 dark:text-green-400 font-normal text-[10px] normal-case"
                              title={`Remapped from "${origCol}"`}
                            >
                              (was {origCol})
                            </span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {effectiveRows.slice(0, PREVIEW_LIMIT).map((row, rowIdx) => {
                    const rowErrors = validationErrors[rowIdx] ?? {};
                    const hasRowError = Object.keys(rowErrors).length > 0;
                    return (
                      <tr
                        key={rowIdx}
                        className={`border-b border-border/40 last:border-0 ${
                          hasRowError
                            ? "bg-destructive/5 hover:bg-destructive/10"
                            : "hover:bg-muted/30"
                        }`}
                        data-testid={`row-crm-preview-${rowIdx}`}
                      >
                        <td className="px-2 py-1.5 text-muted-foreground font-mono">
                          {rowIdx + 2}
                        </td>
                        {effectiveHeaders.map((col, idx) => {
                          const origCol = preview.headers[idx];
                          const isMappedToIgnore = columnRemap[origCol] === IGNORE_SENTINEL;
                          const cellErr = rowErrors[col];
                          return (
                            <td
                              key={col}
                              className={`px-2 py-1.5 max-w-[180px] truncate ${
                                isMappedToIgnore
                                  ? "opacity-30"
                                  : cellErr
                                    ? "text-destructive font-medium bg-destructive/10 rounded"
                                    : ""
                              }`}
                              title={cellErr ? cellErr.message : row[col] || undefined}
                              data-testid={
                                cellErr ? `cell-crm-preview-error-${rowIdx}-${col}` : undefined
                              }
                            >
                              {row[col] || (
                                <span
                                  className={
                                    cellErr
                                      ? "italic text-destructive/60"
                                      : "text-muted-foreground/50 italic"
                                  }
                                >
                                  —
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Actions */}
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
                {createdCount > 0 || updatedCount > 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-destructive" />
                )}
                Import Results
              </div>
              <div className={`grid gap-3 text-sm ${showUpdated ? "grid-cols-3" : "grid-cols-2"}`}>
                <div className="rounded bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 px-3 py-2 text-center">
                  <p
                    className="text-2xl font-bold text-green-700 dark:text-green-400"
                    data-testid="text-crm-import-created"
                  >
                    {createdCount}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-500">Created</p>
                </div>
                {showUpdated && (
                  <div className="rounded bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 px-3 py-2 text-center">
                    <p
                      className="text-2xl font-bold text-blue-700 dark:text-blue-400"
                      data-testid="text-crm-import-updated"
                    >
                      {updatedCount}
                    </p>
                    <p className="text-xs text-blue-600 dark:text-blue-500">Updated</p>
                  </div>
                )}
                <div className="rounded bg-muted border border-border px-3 py-2 text-center">
                  <p className="text-2xl font-bold" data-testid="text-crm-import-skipped">
                    {result.skipped.length}
                  </p>
                  <p className="text-xs text-muted-foreground">Skipped</p>
                </div>
              </div>
              {result.skipped.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Skipped rows:</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs gap-1"
                      onClick={handleDownloadErrors}
                      data-testid="button-crm-import-download-errors"
                    >
                      <Download className="w-3 h-3" />
                      Error report
                    </Button>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {result.skipped.map((s, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 text-xs bg-muted/50 rounded px-2 py-1"
                        data-testid={`text-crm-import-skip-${idx}`}
                      >
                        <span className="font-mono shrink-0 text-muted-foreground">
                          Row {s.row}:
                        </span>
                        <span
                          className={
                            s.reason.startsWith("Duplicate:")
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-destructive"
                          }
                        >
                          {s.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
                    <p className="text-xs font-medium">Fix & re-submit just the failed rows</p>
                    <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                      <li>
                        Download the error report above — it contains only the failed rows pre-filled with your data and the error reason.
                      </li>
                      <li>Open it in a spreadsheet, fix the issues, and delete the <span className="font-mono">error_reason</span> column.</li>
                      <li>Save and re-upload the corrected file below.</li>
                    </ol>
                    <Button
                      className="gap-2 w-full mt-1"
                      size="sm"
                      onClick={() => {
                        if (!errorCsvDownloaded) {
                          handleDownloadErrors();
                        }
                        setRetryFile(null);
                        if (retryFileInputRef.current) retryFileInputRef.current.value = "";
                        setStep("retry");
                      }}
                      data-testid="button-crm-import-start-retry"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Fix & Re-submit Failed Rows
                    </Button>
                  </div>
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

        {step === "retry" && (
          <div className="space-y-4 pt-1">
            <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400 space-y-1.5">
              <p className="font-medium">How to fix and re-submit:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  {errorCsvDownloaded ? (
                    <span>Open the error report you downloaded</span>
                  ) : (
                    <>
                      <button
                        className="underline font-medium"
                        onClick={handleDownloadErrors}
                        data-testid="button-crm-retry-download-errors"
                      >
                        Download the error report
                      </button>
                      {" "}— it has your failed rows pre-filled
                    </>
                  )}
                </li>
                <li>
                  Fix the data and delete the <span className="font-mono">error_reason</span> column
                </li>
                <li>Re-upload the corrected file below</li>
              </ol>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Upload corrected error report</p>
              <input
                ref={retryFileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-border file:text-xs file:font-medium file:bg-background file:text-foreground hover:file:bg-muted cursor-pointer"
                onChange={handleRetryFileChange}
                data-testid="input-crm-retry-file"
              />
              {retryFile && (
                <p className="text-xs text-muted-foreground">
                  Selected: <span className="font-mono">{retryFile.name}</span> (
                  {(retryFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => setStep("result")}
                data-testid="button-crm-retry-back"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </Button>
              <Button
                className="gap-2 flex-1"
                disabled={!retryFile || uploading}
                onClick={handleRetryUpload}
                data-testid="button-crm-retry-submit"
              >
                <Upload className="w-4 h-4" />
                {uploading ? "Importing..." : "Submit Corrected Rows"}
              </Button>
            </div>
          </div>
        )}

        {step === "retry-result" && retryResult && (
          <div className="space-y-4 pt-1">
            <div className="rounded-lg border border-border/60 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                {(retryResult.created ?? retryResult.imported ?? 0) > 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-destructive" />
                )}
                Retry Results
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 px-3 py-2 text-center">
                  <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                    {retryResult.created ?? retryResult.imported ?? 0}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-500">Recovered</p>
                </div>
                <div className="rounded bg-muted border border-border px-3 py-2 text-center">
                  <p className="text-2xl font-bold">{retryResult.skipped.length}</p>
                  <p className="text-xs text-muted-foreground">Still failed</p>
                </div>
              </div>
              {retryResult.skipped.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Remaining errors:</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs gap-1"
                      onClick={handleDownloadRetryErrors}
                      data-testid="button-crm-retry-download-errors"
                    >
                      <Download className="w-3 h-3" />
                      Error report
                    </Button>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {retryResult.skipped.map((s, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 rounded px-2 py-1"
                        data-testid={`text-crm-retry-skip-${idx}`}
                      >
                        <span className="font-mono shrink-0">Row {s.row}:</span>
                        <span>{s.reason}</span>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    onClick={() => {
                      setRetryFile(null);
                      if (retryFileInputRef.current) retryFileInputRef.current.value = "";
                      setStep("retry");
                    }}
                    data-testid="button-crm-retry-again"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Fix & Retry Again
                  </Button>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => handleClose(false)}
                data-testid="button-crm-retry-done"
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
