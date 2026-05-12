/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback, useRef } from "react";
import { ImportWizard } from "@/components/import-wizard";
import { ImportJobProgress } from "@/components/import-job-progress";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Upload,
  FileText,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Users,
  FileSpreadsheet,
  Loader2,
  ArrowRight,
  ArrowRightLeft,
  File,
  FileImage,
  X,
  FolderOpen,
  Sparkles,
  ChevronsUpDown,
  Check,
} from "lucide-react";

interface ParsedInvoicePreview {
  summary: {
    total: number;
    byStatus: Record<string, number>;
    totalAmount: number;
    totalPaid: number;
  };
  sampleInvoices: Array<{
    invoiceNumber: string;
    contactName?: string;
    contactEmail?: string;
    status: string;
    total: number;
    lineItemCount: number;
    paymentCount: number;
  }>;
  errors: Array<{ row: number; field?: string; message: string }>;
  warnings: string[];
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  importRunId: string;
}

interface ImportRun {
  id: string;
  type: string;
  status: string;
  fileName: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  createdAt: string;
  completedAt: string | null;
}

function formatDollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// ── TransferTab types ────────────────────────────────────────────────────────

type TransferPlatform = "sweepandgo" | "jobber" | "housecallpro" | "generic";

interface MappingResult {
  mappings: Array<{ csvColumn: string; internalField: string; confidence: number; reason: string }>;
  transformations: Array<{ field: string; type: string; params?: Record<string, unknown> }>;
  warnings: string[];
}

interface PreloadedMappings {
  headers: string[];
  rows: string[][];
  fileName: string;
  mappingResult: MappingResult;
  initialMappings: Record<string, string>;
  transformations: Array<{ field: string; type: string; params?: Record<string, unknown> }>;
}

// ── Export instruction data (from reference design) ──────────────────────────

const EXPORT_INSTRUCTIONS = {
  sweepandgo: {
    label: "Sweep & Go",
    color: "text-emerald-700 dark:text-emerald-400",
    borderColor: "border-emerald-200 dark:border-emerald-800",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
    files: [
      {
        label: "Residential Client List",
        nav: "Clients → Residential → CSV",
        required: true,
        steps: [
          "Log into Sweep & Go",
          'Click "Clients" in the left sidebar',
          'Click "Residential"',
          'Click "CSV" to export',
          "Upload that file here",
        ],
        tip: "Name, email, phone, address, status, referral source.",
      },
      {
        label: "Residential Subscriptions",
        nav: "Billing → Residential Subscriptions → CSV",
        required: true,
        steps: [
          'Click "Billing" in the left sidebar',
          'Click "Residential Subscriptions"',
          'Click "CSV" to export',
          "Upload that file here",
        ],
        tip: "Subscription name, billing interval, revenue, start/end dates.",
      },
      {
        label: "Master Schedule",
        nav: "Scheduler → Schedule → CSV",
        required: true,
        steps: [
          'Click "Scheduler" in the left sidebar',
          'Click "Schedule"',
          'Click "CSV" to export',
          "Upload that file here",
        ],
        tip: "Service days, cleanup frequency, dog count. The most critical file.",
      },
    ],
  },
  jobber: {
    label: "Jobber",
    color: "text-amber-700 dark:text-amber-400",
    borderColor: "border-amber-200 dark:border-amber-800",
    bgColor: "bg-amber-50 dark:bg-amber-950/30",
    emailNote: "Jobber emails your exports. Watch for an email at the address you use to log in.",
    files: [
      {
        label: "Client List",
        nav: "Clients → More Actions → Export Clients → CSV",
        required: true,
        steps: [
          'Click "Clients" in the left sidebar',
          'In the top right corner, click "More Actions"',
          'Click "Export Clients"',
          'In the pop-up, click "CSV"',
          "Jobber will email you the file — download the CSV attachment and upload it here",
        ],
        tip: "Contact info, addresses, custom fields (dog count, notes), tags, lead source.",
      },
      {
        label: "Recurring Jobs Report",
        nav: "Insights → Reports → Recurring Jobs Report → Export to CSV",
        required: true,
        steps: [
          'Click "Insights" in the left sidebar, then select "Reports"',
          'Under Work Reports, click "Recurring Jobs Report"',
          'Click the "Columns" button and enable: Client name, Client email, Client phone number, Service street, Service city, Service state/province, Service zip/postal code, Line items, Total ($), Schedule start date, Billing type',
          'Set the Active filter to "Active" and Started date to "All time"',
          'Click "Export to CSV" and select "All columns"',
          "Jobber will email you the file — download the CSV attachment and upload it here",
        ],
        tip: "Pricing, frequency, and start dates live here. Enabling the right columns before exporting is critical.",
      },
    ],
  },
  housecallpro: {
    label: "HouseCall Pro",
    color: "text-indigo-700 dark:text-indigo-400",
    borderColor: "border-indigo-200 dark:border-indigo-800",
    bgColor: "bg-indigo-50 dark:bg-indigo-950/30",
    emailNote:
      "HouseCall Pro emails your exports. Watch for an email from notifications@housecallpro.com — check spam if it doesn't arrive within a few minutes.",
    files: [
      {
        label: "Customer Export",
        nav: "Customers → Actions → Export",
        required: true,
        steps: [
          'Click "Customers" in the navigation bar at the top of your HCP account',
          'Click the "Actions" button on the right side of your screen',
          'Select "Export" from the drop-down',
          "Confirm your email address and click the blue Send File button",
          "Wait for the email from notifications@housecallpro.com, download the CSV attachment",
          "Upload that file here",
        ],
        tip: "HCP emails the file — usually arrives within a few minutes. Check spam if it doesn't show up.",
      },
      {
        label: "Jobs Export",
        nav: "Customers → Jobs → Actions → Export",
        required: true,
        steps: [
          'Click "Customers" in the navigation bar at the top of your HCP account',
          'Click "Jobs" from the menu on the left',
          'Click the "Actions" button on the right side of your screen',
          'Select "Export" from the drop-down',
          "Verify your email address and click Send File",
          "Wait for the email from notifications@housecallpro.com, download the CSV attachment",
          "Upload that file here",
        ],
        tip: "Grab both exports before coming back to upload — they both arrive via email.",
      },
    ],
  },
};

// ── Client-side CSV parser (re-used from wizard pattern) ──────────────────────

function parseCSVSimple(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ",") {
          result.push(current.trim());
          current = "";
        } else if (char === "\t") {
          result.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
    }
    result.push(current.trim());
    return result;
  };

  const firstLine = lines[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;

  if (tabCount > commaCount) {
    const parseTabLine = (line: string) =>
      line.split("\t").map((c) => c.trim().replace(/^"|"$/g, ""));
    return { headers: parseTabLine(lines[0]), rows: lines.slice(1).map(parseTabLine) };
  }

  return { headers: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) };
}

// ── Platform detection from merged headers ────────────────────────────────────

function detectPlatformFromHeaders(headers: string[]): TransferPlatform {
  const normalized = new Set(headers.map((h) => h.toLowerCase().trim()));
  if (normalized.has("job description") && normalized.has("job amount")) return "housecallpro";
  if (normalized.has("job description") && normalized.has("customer name")) return "housecallpro";
  if (
    normalized.has("subs. name") ||
    normalized.has("cleanup frequency") ||
    normalized.has("subs name")
  )
    return "sweepandgo";
  if (
    normalized.has("j-id") ||
    (normalized.has("client first name") && normalized.has("property street 1"))
  )
    return "jobber";
  return "generic";
}

// ── Multi-file client-side merge ──────────────────────────────────────────────

function normalizeKey(firstName: string, lastName: string, street: string): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  return `${clean(firstName)}|${clean(lastName)}|${clean(street)}`;
}

interface FileStat {
  name: string;
  rawRows: number;
}

async function mergeUploadedFiles(files: File[]): Promise<{
  mergedHeaders: string[];
  mergedRows: string[][];
  detectedPlatform: TransferPlatform;
  fileName: string;
  fileStats: FileStat[];
}> {
  const parsed: Array<{ headers: string[]; rows: string[][] }> = [];

  for (const file of files) {
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
    parsed.push(parseCSVSimple(text));
  }

  const fileStats: FileStat[] = files.map((f, i) => ({
    name: f.name,
    rawRows: parsed[i]?.rows.length ?? 0,
  }));

  if (parsed.length === 0)
    return {
      mergedHeaders: [],
      mergedRows: [],
      detectedPlatform: "generic",
      fileName: "",
      fileStats: [],
    };
  if (parsed.length === 1) {
    const { headers, rows } = parsed[0];
    return {
      mergedHeaders: headers,
      mergedRows: rows,
      detectedPlatform: detectPlatformFromHeaders(headers),
      fileName: files[0].name,
      fileStats,
    };
  }

  // Union all headers (preserve first-seen order)
  const allHeaders: string[] = [];
  const headerSet = new Set<string>();
  for (const { headers } of parsed) {
    for (const h of headers) {
      const key = h.toLowerCase().trim();
      if (!headerSet.has(key)) {
        headerSet.add(key);
        allHeaders.push(h);
      }
    }
  }

  // Build index maps per file
  const fileMaps = parsed.map(({ headers }) => {
    const map: Record<string, number> = {};
    headers.forEach((h, i) => {
      map[h.toLowerCase().trim()] = i;
    });
    return map;
  });

  // Detect name/address columns in each file for join key
  const nameFirstAliases = [
    "first name",
    "firstname",
    "first_name",
    "client first name",
    "fname",
    "customer first name",
  ];
  const nameLastAliases = [
    "last name",
    "lastname",
    "last_name",
    "client last name",
    "lname",
    "customer last name",
  ];
  const streetAliases = [
    "address",
    "street address",
    "property street 1",
    "street",
    "service address",
    "address line 1",
  ];

  function findColIdx(map: Record<string, number>, aliases: string[]): number {
    for (const a of aliases) {
      if (map[a] !== undefined) return map[a];
    }
    return -1;
  }

  // Produce rows from each file with all merged headers
  const fileRows = parsed.map(({ rows }, fi) => {
    const fileMap = fileMaps[fi];
    return rows.map((row) => {
      return allHeaders.map((h) => {
        const idx = fileMap[h.toLowerCase().trim()];
        return idx !== undefined ? (row[idx] ?? "") : "";
      });
    });
  });

  // Build a global position map keyed by name+address across all files.
  // Requires at least one name component so street-only keys don't produce
  // false merges for shared addresses (e.g. HOA units). File-order independent:
  // whichever file contributes a key first owns the merged row; subsequent
  // files with the same key merge their columns in, filling blank cells only.
  const merged: string[][] = [];
  const mergedPosMap = new Map<string, number>(); // join-key → index in merged[]

  for (let fi = 0; fi < parsed.length; fi++) {
    const fileMap = fileMaps[fi];
    const fFirstIdx = findColIdx(fileMap, nameFirstAliases);
    const fLastIdx = findColIdx(fileMap, nameLastAliases);
    const fStreetIdx = findColIdx(fileMap, streetAliases);

    for (let ri = 0; ri < parsed[fi].rows.length; ri++) {
      const raw = parsed[fi].rows[ri];
      const firstName = fFirstIdx >= 0 ? (raw[fFirstIdx] ?? "") : "";
      const lastName = fLastIdx >= 0 ? (raw[fLastIdx] ?? "") : "";
      const street = fStreetIdx >= 0 ? (raw[fStreetIdx] ?? "") : "";

      // Require at least one name component to prevent street-only false merges
      const hasName = firstName.trim() !== "" || lastName.trim() !== "";
      const key = hasName ? normalizeKey(firstName, lastName, street) : "";
      const validKey = key && key !== "||";

      const fullRow = fileRows[fi][ri];

      if (validKey && mergedPosMap.has(key)) {
        // Merge into existing row — fill blank columns only
        const pos = mergedPosMap.get(key)!;
        for (let ci = 0; ci < allHeaders.length; ci++) {
          if (!merged[pos][ci] && fullRow[ci]) {
            merged[pos][ci] = fullRow[ci];
          }
        }
      } else {
        // New row — add to merged list and index by key if valid
        const pos = merged.length;
        merged.push([...fullRow]);
        if (validKey) mergedPosMap.set(key, pos);
      }
    }
  }

  const fileName = files.map((f) => f.name).join(" + ");
  return {
    mergedHeaders: allHeaders,
    mergedRows: merged,
    detectedPlatform: detectPlatformFromHeaders(allHeaders),
    fileName,
    fileStats,
  };
}

// ── Accordion help section ────────────────────────────────────────────────────

function ExportInstructionsAccordion() {
  const [openPlatform, setOpenPlatform] = useState<string | null>(null);
  const [openFileIdx, setOpenFileIdx] = useState<Record<string, number | null>>({});

  const platforms = Object.entries(EXPORT_INSTRUCTIONS) as Array<
    [
      keyof typeof EXPORT_INSTRUCTIONS,
      (typeof EXPORT_INSTRUCTIONS)[keyof typeof EXPORT_INSTRUCTIONS],
    ]
  >;

  return (
    <div
      className="rounded-lg border border-border bg-muted/30"
      data-testid="export-instructions-accordion"
    >
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpenPlatform(openPlatform ? null : platforms[0][0])}
        data-testid="button-toggle-instructions"
      >
        <span>Not sure what to export? Get step-by-step instructions</span>
        <ArrowRight className={`h-4 w-4 transition-transform ${openPlatform ? "rotate-90" : ""}`} />
      </button>

      {openPlatform !== null && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-2">
          <div className="flex flex-wrap gap-2 mb-3">
            {platforms.map(([key, cfg]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setOpenPlatform(key);
                  setOpenFileIdx({});
                }}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  openPlatform === key
                    ? `${cfg.bgColor} ${cfg.color} ${cfg.borderColor}`
                    : "border-border text-muted-foreground hover:border-primary/40"
                }`}
                data-testid={`button-instructions-tab-${key}`}
              >
                {cfg.label}
              </button>
            ))}
          </div>

          {platforms.map(([key, cfg]) => {
            if (openPlatform !== key) return null;
            return (
              <div key={key} className="space-y-2">
                {"emailNote" in cfg && cfg.emailNote && (
                  <div
                    className={`text-xs p-2.5 rounded-md border ${cfg.bgColor} ${cfg.borderColor} ${cfg.color}`}
                  >
                    {cfg.emailNote}
                  </div>
                )}
                {cfg.files.map((file, fi) => {
                  const fileKey = `${key}-${fi}`;
                  const isOpen = openFileIdx[key] === fi;
                  return (
                    <div key={fi} className="rounded-md border border-border overflow-hidden">
                      <button
                        type="button"
                        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                        onClick={() =>
                          setOpenFileIdx((prev) => ({
                            ...prev,
                            [key]: prev[key] === fi ? null : fi,
                          }))
                        }
                        data-testid={`button-instructions-file-${fileKey}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold">{file.label}</span>
                          {file.required ? (
                            <span className="text-xs text-destructive font-medium">required</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">optional</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-mono ${cfg.color} hidden sm:inline`}>
                            {file.nav}
                          </span>
                          <ArrowRight
                            className={`h-3 w-3 text-muted-foreground flex-shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                          />
                        </div>
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3 pt-1 border-t border-border bg-muted/20 space-y-2">
                          <ol className="space-y-1.5">
                            {file.steps.map((step, si) => (
                              <li key={si} className="flex gap-2 text-xs text-muted-foreground">
                                <span className="flex-shrink-0 w-4 h-4 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold mt-0.5">
                                  {si + 1}
                                </span>
                                <span>{step}</span>
                              </li>
                            ))}
                          </ol>
                          <div
                            className={`text-xs italic p-2 rounded border ${cfg.bgColor} ${cfg.borderColor} ${cfg.color}`}
                          >
                            {file.tip}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Merge summary types ───────────────────────────────────────────────────────

interface PendingMerge {
  mergedHeaders: string[];
  mergedRows: string[][];
  detectedPlatform: TransferPlatform;
  fileName: string;
  fileStats: FileStat[];
}

const PLATFORM_LABELS: Record<TransferPlatform, string> = {
  sweepandgo: "Sweep & Go",
  jobber: "Jobber",
  housecallpro: "HouseCall Pro",
  generic: "Generic CSV",
};

const PLATFORM_BADGE_COLORS: Record<TransferPlatform, string> = {
  sweepandgo: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  jobber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  housecallpro: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  generic: "bg-muted text-muted-foreground",
};

// ── MergeSummaryCard ──────────────────────────────────────────────────────────

interface MergeSummaryCardProps {
  pending: PendingMerge;
  analyzing: boolean;
  analyzeError: string | null;
  onConfirm: () => void;
  onReset: () => void;
}

function MergeSummaryCard({
  pending,
  analyzing,
  analyzeError,
  onConfirm,
  onReset,
}: MergeSummaryCardProps) {
  const totalRaw = pending.fileStats.reduce((s, f) => s + f.rawRows, 0);
  const mergedCount = pending.mergedRows.length;
  const deduped = pending.fileStats.length > 1 ? totalRaw - mergedCount : 0;

  return (
    <div className="space-y-4" data-testid="merge-summary-card">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Files ready for analysis</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Review the summary below, then run AI column mapping.
            </p>
          </div>
          <span
            className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${PLATFORM_BADGE_COLORS[pending.detectedPlatform]}`}
            data-testid="text-detected-platform"
          >
            {PLATFORM_LABELS[pending.detectedPlatform]}
          </span>
        </div>

        {/* Per-file breakdown */}
        <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {pending.fileStats.map((fs, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-3 py-2.5 bg-muted/20"
              data-testid={`row-file-stat-${i}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs font-medium truncate">{fs.name}</span>
              </div>
              <span className="text-xs text-muted-foreground flex-shrink-0 ml-3">
                {fs.rawRows.toLocaleString()} rows
              </span>
            </div>
          ))}
        </div>

        {/* Merge stats */}
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            <span data-testid="text-merged-row-count">
              <span className="font-semibold text-foreground">{mergedCount.toLocaleString()}</span>{" "}
              {mergedCount === 1 ? "row" : "rows"} to import
            </span>
          </div>
          {deduped > 0 && (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              <span data-testid="text-deduped-count">
                <span className="font-semibold text-foreground">{deduped.toLocaleString()}</span>{" "}
                matched across files
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>
              <span className="font-semibold text-foreground">
                {pending.mergedHeaders.length}
              </span>{" "}
              columns
            </span>
          </div>
        </div>

        {/* Error */}
        {analyzeError && (
          <Alert variant="destructive" data-testid="alert-analyze-error">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Analysis failed</AlertTitle>
            <AlertDescription>{analyzeError}</AlertDescription>
          </Alert>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <Button
            onClick={onConfirm}
            disabled={analyzing}
            className="flex-1 sm:flex-none"
            data-testid="button-analyze-with-ai"
          >
            {analyzing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Mapping columns...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Analyze with AI
              </>
            )}
          </Button>
          <button
            type="button"
            onClick={onReset}
            disabled={analyzing}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors disabled:opacity-50"
            data-testid="button-remove-files"
          >
            Remove files and start over
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TransferTab ───────────────────────────────────────────────────────────────

function TransferTab() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [merging, setMerging] = useState(false);
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [preloaded, setPreloaded] = useState<PreloadedMappings | null>(null);
  const [wizardPlatform, setWizardPlatform] = useState<TransferPlatform>("generic");
  const [wizardStarted, setWizardStarted] = useState(false);

  // Phase 1: merge files client-side and show summary
  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const csvFiles = Array.from(files).filter(
        (f) => f.name.toLowerCase().endsWith(".csv") || f.type === "text/csv"
      );
      if (csvFiles.length === 0) {
        toast({
          title: "No CSV files found",
          description: "Please upload one or more .csv files.",
          variant: "destructive",
        });
        return;
      }
      setAnalyzeError(null);
      setPendingMerge(null);
      setMerging(true);

      try {
        const result = await mergeUploadedFiles(csvFiles);
        setPendingMerge(result);
      } catch (err) {
        setAnalyzeError(
          err instanceof Error ? err.message : "Something went wrong reading your files."
        );
      } finally {
        setMerging(false);
      }
    },
    [toast]
  );

  // Phase 2: run AI mapping after user confirms the summary
  const handleAnalyze = useCallback(async () => {
    if (!pendingMerge) return;
    setAnalyzeError(null);
    setAnalyzing(true);

    try {
      const { mergedHeaders, mergedRows, detectedPlatform, fileName } = pendingMerge;
      const sampleRows = mergedRows.slice(0, 25);

      const res = await apiRequest("POST", "/api/imports/ai-map", {
        headers: mergedHeaders,
        sampleRows,
        targetSchema: "contacts",
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || "AI mapping failed");
      }

      const mappingResult: MappingResult = await res.json();

      const initialMappings: Record<string, string> = {};
      for (const m of mappingResult.mappings) {
        initialMappings[m.internalField] = m.csvColumn;
      }

      setPreloaded({
        headers: mergedHeaders,
        rows: mergedRows,
        fileName,
        mappingResult,
        initialMappings,
        transformations: mappingResult.transformations,
      });
      setWizardPlatform(detectedPlatform);
      setWizardStarted(true);
    } catch (err) {
      setAnalyzeError(
        err instanceof Error ? err.message : "Something went wrong analyzing your files."
      );
    } finally {
      setAnalyzing(false);
    }
  }, [pendingMerge]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) handleFiles(e.target.files);
    },
    [handleFiles]
  );

  const reset = useCallback(() => {
    setAnalyzeError(null);
    setPendingMerge(null);
    setPreloaded(null);
    setWizardStarted(false);
    setWizardPlatform("generic");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  if (wizardStarted && preloaded) {
    return (
      <ImportWizard
        targetSchema="contacts"
        initialPlatform={wizardPlatform}
        preloadedMappings={preloaded}
        onComplete={(result) => {
          toast({
            title: "Transfer Complete",
            description: `${result.importedRows} contacts imported successfully.`,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/imports"] });
          reset();
        }}
        onCancel={reset}
      />
    );
  }

  // Show merge summary confirmation before AI analysis
  if (pendingMerge) {
    return (
      <div className="space-y-5" data-testid="transfer-upload-zone">
        <MergeSummaryCard
          pending={pendingMerge}
          analyzing={analyzing}
          analyzeError={analyzeError}
          onConfirm={handleAnalyze}
          onReset={reset}
        />
        <ExportInstructionsAccordion />
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="transfer-upload-zone">
      {/* Drop zone */}
      <div
        className={`relative rounded-xl border-2 border-dashed transition-colors cursor-pointer ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !(merging || analyzing) && fileInputRef.current?.click()}
        data-testid="dropzone-transfer"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          multiple
          className="hidden"
          onChange={handleInputChange}
          data-testid="input-transfer-files"
        />

        <div className="flex flex-col items-center justify-center py-12 px-6 text-center gap-3">
          {merging ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div>
                <p className="font-medium text-sm">Reading your files...</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Merging columns and detecting platform.
                </p>
              </div>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">Drop your CSV files here, or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Upload one file or multiple — we'll merge them automatically
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-1"
                data-testid="button-browse-files"
              >
                Browse files
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Error state */}
      {analyzeError && (
        <Alert variant="destructive" data-testid="alert-analyze-error">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Could not read files</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{analyzeError}</span>
            <Button variant="outline" size="sm" onClick={reset} data-testid="button-try-again">
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Export instructions accordion */}
      <ExportInstructionsAccordion />
    </div>
  );
}

function InvoicesTab() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<ParsedInvoicePreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [includeInReminders, setIncludeInReminders] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const parseMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", "/api/migrations/sweepandgo/parse-invoices", {
        csvText: text,
      });
      return res.json() as Promise<ParsedInvoicePreview>;
    },
    onSuccess: (data) => {
      setPreview(data);
      setImportResult(null);
    },
    onError: (error: Error) => {
      toast({ title: "Parse failed", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/migrations/sweepandgo/run-invoices", {
        csvText,
        allowDuplicates,
        includeInReminders,
      });
      return res.json() as Promise<{ jobId: string; totalRows: number }>;
    },
    onSuccess: (data) => {
      setActiveJobId(data.jobId);
      queryClient.invalidateQueries({ queryKey: ["/api/imports"] });
      toast({
        title: "Import started",
        description: `Processing ${data.totalRows} rows in the background.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast({
        title: "Invalid file",
        description: "Please upload a CSV file.",
        variant: "destructive",
      });
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setCsvText(text);
      parseMutation.mutate(text);
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = (e as any).dataTransfer?.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleFileInput = useCallback(
    (e: any) => {
      const file = e.target?.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const resetState = () => {
    setCsvText(null);
    setFileName("");
    setPreview(null);
    setImportResult(null);
    setActiveJobId(null);
  };

  if (activeJobId) {
    return (
      <div className="space-y-6">
        <div className="text-sm font-medium text-muted-foreground">
          Importing invoices from Sweep & Go
        </div>
        <ImportJobProgress
          jobId={activeJobId}
          label="Importing invoices"
          onComplete={(job) => {
            queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
            if (job.status === "completed") {
              toast({
                title: "Import complete",
                description: `${job.importedRows} invoices imported.`,
              });
            }
          }}
          onReset={resetState}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!preview && !importResult && (
        <div
          className={`border-2 border-dashed rounded-md p-12 text-center cursor-pointer transition-colors ${
            isDragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"
          }`}
          onDrop={handleDrop as any}
          onDragOver={handleDragOver as any}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          data-testid="dropzone-invoices"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileInput}
            data-testid="input-invoice-file"
          />
          <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium">Drop your Sweep&Go invoice CSV here</p>
          <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
        </div>
      )}

      {parseMutation.isPending && (
        <div className="flex items-center justify-center py-12 gap-2" data-testid="loading-parse">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm text-muted-foreground">Parsing CSV...</span>
        </div>
      )}

      {preview && !importResult && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium" data-testid="text-file-name">
                {fileName}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={resetState}
              data-testid="button-reset-upload"
            >
              Upload different file
            </Button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Invoices</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold" data-testid="text-total-invoices">
                  {preview.summary.total}
                </p>
              </CardContent>
            </Card>
            {Object.entries(preview.summary.byStatus).map(([status, count]) => (
              <Card key={status}>
                <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium capitalize">{status}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold" data-testid={`text-status-${status}`}>
                    {count}
                  </p>
                </CardContent>
              </Card>
            ))}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Amount</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold" data-testid="text-total-amount">
                  {formatDollars(preview.summary.totalAmount)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Paid</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold" data-testid="text-total-paid">
                  {formatDollars(preview.summary.totalPaid)}
                </p>
              </CardContent>
            </Card>
          </div>

          {preview.errors.length > 0 && (
            <Alert variant="destructive" data-testid="alert-errors">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Errors ({preview.errors.length})</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 mt-2 space-y-1 text-sm">
                  {preview.errors.map((err, i) => (
                    <li key={i} data-testid={`text-error-${i}`}>
                      Row {err.row}: {err.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {preview.warnings.length > 0 && (
            <Alert data-testid="alert-warnings">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Warnings ({preview.warnings.length})</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 mt-2 space-y-1 text-sm">
                  {preview.warnings.map((warn, i) => (
                    <li key={i} data-testid={`text-warning-${i}`}>
                      {warn}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {preview.sampleInvoices.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sample Invoices (first 10)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table data-testid="table-sample-invoices">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Line Items</TableHead>
                        <TableHead className="text-right">Payments</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.sampleInvoices.slice(0, 10).map((inv, i) => (
                        <TableRow key={i} data-testid={`row-invoice-${i}`}>
                          <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                          <TableCell>
                            <div>{inv.contactName || "---"}</div>
                            <div className="text-xs text-muted-foreground">
                              {inv.contactEmail || ""}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={inv.status === "paid" ? "default" : "secondary"}
                              className="text-xs"
                              data-testid={`badge-status-${i}`}
                            >
                              {inv.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{formatDollars(inv.total)}</TableCell>
                          <TableCell className="text-right">{inv.lineItemCount}</TableCell>
                          <TableCell className="text-right">{inv.paymentCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="allow-duplicates"
                  checked={allowDuplicates}
                  onCheckedChange={(v) => setAllowDuplicates(!!v)}
                  data-testid="checkbox-allow-duplicates"
                />
                <Label htmlFor="allow-duplicates" className="text-sm">
                  Allow duplicates (import even if external ID already exists)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="include-reminders"
                  checked={includeInReminders}
                  onCheckedChange={(v) => setIncludeInReminders(!!v)}
                  data-testid="checkbox-include-reminders"
                />
                <Label htmlFor="include-reminders" className="text-sm">
                  Include unpaid invoices in payment reminders
                </Label>
              </div>
              <Button
                onClick={() => importMutation.mutate()}
                disabled={importMutation.isPending || preview.errors.length > 0}
                data-testid="button-import-invoices"
              >
                {importMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Import {preview.summary.total} Invoices
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {importResult && (
        <div className="space-y-4">
          <Alert data-testid="alert-import-result">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Import Complete</AlertTitle>
            <AlertDescription>
              <div className="mt-2 space-y-1 text-sm">
                <p data-testid="text-imported-count">Imported: {importResult.imported}</p>
                <p data-testid="text-skipped-count">Skipped: {importResult.skipped}</p>
                {importResult.errors.length > 0 && (
                  <div>
                    <p className="font-medium mt-2">Errors:</p>
                    <ul className="list-disc pl-4 space-y-1">
                      {importResult.errors.map((err, i) => (
                        <li key={i}>
                          Row {err.row}: {err.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </AlertDescription>
          </Alert>
          <Button variant="outline" onClick={resetState} data-testid="button-new-import">
            Start New Import
          </Button>
        </div>
      )}
    </div>
  );
}

const DOCUMENT_CATEGORIES = [
  "Invoice",
  "Service Record",
  "Contract",
  "License",
  "Insurance Certificate",
  "Photo",
  "Other",
] as const;

type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

interface PendingDocument {
  id: string;
  file: File;
  category: DocumentCategory | "";
  contactId: string;
  notes: string;
  classifying: boolean;
  uploading: boolean;
  saved: boolean;
  objectPath: string | null;
}

interface ContactOption {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

interface SavedDocument {
  id: string;
  fileName: string;
  documentCategory: string | null;
  notes: string | null;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  createdAt: string | null;
}

// Dialog is used here instead of Popover intentionally.
// Radix UI's focus-trap causes Popovers to fail to open when rendered inside a
// Sheet or Drawer (a known issue on Android and some desktop browsers). Using a
// Dialog avoids the nested-focus-trap conflict and keeps this picker safe to
// embed in any context, including Sheets, as the app grows.
function ContactCombobox({
  value,
  onChange,
  contacts,
  testId,
}: {
  value: string;
  onChange: (val: string) => void;
  contacts: ContactOption[];
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = contacts.find((c) => c.id === value);
  const label = selected
    ? `${selected.firstName} ${selected.lastName}${selected.email ? ` (${selected.email})` : ""}`
    : "None";

  return (
    <>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className="w-full h-9 justify-between font-normal"
        data-testid={testId}
        onClick={() => setOpen(true)}
      >
        <span className="truncate">{label}</span>
        <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 text-muted-foreground" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md p-0 gap-0" data-testid={`${testId}-dialog`}>
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle>Select a contact</DialogTitle>
          </DialogHeader>
          <Command>
            <div className="px-2 pb-2">
              <CommandInput
                placeholder="Search contacts…"
                autoFocus
                data-testid={`${testId}-search`}
              />
            </div>
            <CommandList className="max-h-72 overflow-y-auto px-2 pb-2">
              <CommandEmpty>No contacts found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 ${!value ? "opacity-100" : "opacity-0"}`} />
                  None
                </CommandItem>
                {contacts.map((c) => {
                  const display = `${c.firstName} ${c.lastName}${c.email ? ` (${c.email})` : ""}`;
                  return (
                    <CommandItem
                      key={c.id}
                      value={display}
                      onSelect={() => {
                        onChange(c.id);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={`mr-2 h-4 w-4 ${value === c.id ? "opacity-100" : "opacity-0"}`}
                      />
                      {display}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

function fileIcon(file: File) {
  if (file.type.startsWith("image/")) return <FileImage className="h-5 w-5 text-blue-500" />;
  if (file.type === "application/pdf") return <FileText className="h-5 w-5 text-red-500" />;
  return <File className="h-5 w-5 text-muted-foreground" />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocumentsTab() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pendingDocs, setPendingDocs] = useState<PendingDocument[]>([]);

  const { data: contacts } = useQuery<ContactOption[]>({
    queryKey: ["/api/contacts"],
    queryFn: async () => {
      const token = localStorage.getItem("sessionToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const r = await fetch("/api/contacts?all=true", { credentials: "include", headers });
      return r.ok ? r.json() : [];
    },
    select: (data: ContactOption[]) =>
      data.map((c) => ({
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email ?? null,
      })),
  });

  const { data: savedDocs, refetch: refetchDocs } = useQuery<SavedDocument[]>({
    queryKey: ["/api/documents"],
  });

  const classifyMutation = useMutation({
    mutationFn: async ({
      docId,
      fileName,
      mimeType,
    }: {
      docId: string;
      fileName: string;
      mimeType: string;
    }) => {
      const res = await apiRequest("POST", "/api/documents/classify", { fileName, mimeType });
      return { docId, ...((await res.json()) as { category: string }) };
    },
    onSuccess: ({ docId, category }) => {
      setPendingDocs((prev) =>
        prev.map((d) =>
          d.id === docId
            ? {
                ...d,
                classifying: false,
                category: (DOCUMENT_CATEGORIES.includes(category as DocumentCategory)
                  ? category
                  : "Other") as DocumentCategory,
              }
            : d
        )
      );
    },
    onError: (_err, { docId }) => {
      setPendingDocs((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, classifying: false, category: "Other" } : d))
      );
    },
  });

  const addFiles = useCallback((files: File[]) => {
    const allowed = files.filter((f) => {
      const ext = f.name.toLowerCase();
      return (
        ext.endsWith(".pdf") ||
        ext.endsWith(".docx") ||
        ext.endsWith(".jpg") ||
        ext.endsWith(".jpeg") ||
        ext.endsWith(".png")
      );
    });
    if (allowed.length < files.length) {
      toast({
        title: "Some files skipped",
        description: "Only PDF, DOCX, JPG, and PNG files are supported.",
        variant: "destructive",
      });
    }
    const newDocs: PendingDocument[] = allowed.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      category: "",
      contactId: "",
      notes: "",
      classifying: true,
      uploading: false,
      saved: false,
      objectPath: null,
    }));
    setPendingDocs((prev) => [...prev, ...newDocs]);
    for (const doc of newDocs) {
      classifyMutation.mutate({ docId: doc.id, fileName: doc.file.name, mimeType: doc.file.type });
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length) addFiles(files);
    },
    [addFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length) addFiles(files);
      e.target.value = "";
    },
    [addFiles]
  );

  const updateDoc = (id: string, patch: Partial<PendingDocument>) => {
    setPendingDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const removeDoc = (id: string) => {
    setPendingDocs((prev) => prev.filter((d) => d.id !== id));
  };

  const saveDoc = async (doc: PendingDocument) => {
    updateDoc(doc.id, { uploading: true });
    try {
      const token = localStorage.getItem("sessionToken");
      const hdrs: Record<string, string> = {};
      if (token) hdrs["Authorization"] = `Bearer ${token}`;
      const formData = new FormData();
      formData.append("file", doc.file);
      const uploadRes = await fetch("/api/uploads/direct", {
        method: "POST",
        credentials: "include",
        headers: hdrs,
        body: formData,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { objectPath } = await uploadRes.json();

      await apiRequest("POST", "/api/documents", {
        fileName: doc.file.name,
        fileUrl: objectPath,
        fileType: doc.file.type || null,
        fileSize: doc.file.size || null,
        documentCategory: doc.category || null,
        notes: doc.notes || null,
        contactId: doc.contactId || null,
      });
      updateDoc(doc.id, { uploading: false, saved: true, objectPath });
      refetchDocs();
      toast({ title: "Document saved", description: `${doc.file.name} has been imported.` });
    } catch (err: unknown) {
      updateDoc(doc.id, { uploading: false });
      const message = err instanceof Error ? err.message : "Failed to save document.";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    }
  };

  const unsavedDocs = pendingDocs.filter((d) => !d.saved);
  const savedPendingDocs = pendingDocs.filter((d) => d.saved);

  return (
    <div className="space-y-6">
      <Alert>
        <FolderOpen className="h-4 w-4" />
        <AlertTitle>Import Documents</AlertTitle>
        <AlertDescription>
          Upload PDF, DOCX, JPG, or PNG files from Jobber or Sweep & Go. AI will suggest a category
          for each file based on its name and type.
        </AlertDescription>
      </Alert>

      <div
        className={`border-2 border-dashed rounded-md p-10 text-center cursor-pointer transition-colors ${
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/40"
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
        data-testid="dropzone-documents"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.jpg,.jpeg,.png"
          multiple
          className="hidden"
          onChange={handleFileInput}
          data-testid="input-document-files"
        />
        <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm font-medium">Drop files here or click to browse</p>
        <p className="text-xs text-muted-foreground mt-1">
          PDF, DOCX, JPG, PNG — multiple files supported
        </p>
      </div>

      {unsavedDocs.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">
            {unsavedDocs.length} file{unsavedDocs.length !== 1 ? "s" : ""} ready to import
          </p>
          {unsavedDocs.map((doc) => (
            <Card key={doc.id} data-testid={`card-document-${doc.id}`}>
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="mt-0.5 flex-shrink-0">{fileIcon(doc.file)}</div>
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-sm font-medium truncate"
                        data-testid={`text-doc-name-${doc.id}`}
                      >
                        {doc.file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatBytes(doc.file.size)}</p>

                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            Document Type
                          </label>
                          {doc.classifying ? (
                            <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-muted/50">
                              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">AI analyzing…</span>
                            </div>
                          ) : (
                            <Select
                              value={doc.category}
                              onValueChange={(val) =>
                                updateDoc(doc.id, { category: val as DocumentCategory })
                              }
                            >
                              <SelectTrigger
                                data-testid={`select-category-${doc.id}`}
                                className="h-9"
                              >
                                <SelectValue placeholder="Select type…" />
                              </SelectTrigger>
                              <SelectContent>
                                {DOCUMENT_CATEGORIES.map((cat) => (
                                  <SelectItem
                                    key={cat}
                                    value={cat}
                                    data-testid={`option-category-${cat}`}
                                  >
                                    {cat}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">
                            Link to Contact (optional)
                          </label>
                          <ContactCombobox
                            value={doc.contactId}
                            onChange={(val) => updateDoc(doc.id, { contactId: val })}
                            contacts={contacts || []}
                            testId={`combobox-contact-${doc.id}`}
                          />
                        </div>

                        <div className="space-y-1 sm:col-span-2">
                          <label className="text-xs font-medium text-muted-foreground">
                            Notes (optional)
                          </label>
                          <Textarea
                            value={doc.notes}
                            onChange={(e) => updateDoc(doc.id, { notes: e.target.value })}
                            placeholder="e.g. Jobber March invoice for Smith account"
                            className="h-16 resize-none text-sm"
                            data-testid={`textarea-notes-${doc.id}`}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex sm:flex-col gap-2 items-center sm:items-end justify-end sm:justify-start flex-shrink-0">
                    <Button
                      size="sm"
                      onClick={() => saveDoc(doc)}
                      disabled={doc.classifying || doc.uploading || !doc.category}
                      data-testid={`button-save-doc-${doc.id}`}
                    >
                      {doc.uploading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                      {doc.uploading ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeDoc(doc.id)}
                      disabled={doc.uploading}
                      data-testid={`button-remove-doc-${doc.id}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {savedPendingDocs.length > 0 && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>
            {savedPendingDocs.length} document{savedPendingDocs.length !== 1 ? "s" : ""} imported
            successfully
          </AlertTitle>
          <AlertDescription>They now appear in the import history below.</AlertDescription>
        </Alert>
      )}

      {savedDocs && savedDocs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Previously Imported Documents</CardTitle>
            <CardDescription>
              {savedDocs.length} document{savedDocs.length !== 1 ? "s" : ""} on file
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table data-testid="table-saved-documents">
                <TableHeader>
                  <TableRow>
                    <TableHead>File Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Linked Contact</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {savedDocs.map((doc) => (
                    <TableRow key={doc.id} data-testid={`row-saved-doc-${doc.id}`}>
                      <TableCell className="text-sm font-medium max-w-[160px] truncate">
                        {doc.fileName}
                      </TableCell>
                      <TableCell>
                        {doc.documentCategory ? (
                          <Badge variant="secondary" className="text-xs">
                            {doc.documentCategory}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">
                        {doc.contactName || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">
                        {doc.notes || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ContactsTab() {
  const { toast } = useToast();
  return (
    <div className="space-y-4" data-testid="contacts-tab-content">
      <Alert>
        <Users className="h-4 w-4" />
        <AlertTitle>Contact Import</AlertTitle>
        <AlertDescription>
          Use the AI-assisted import wizard to map and import contacts from CSV files. Column
          mappings will be automatically suggested based on your file headers.
        </AlertDescription>
      </Alert>
      <ImportWizard
        targetSchema="contacts"
        onComplete={(result) => {
          toast({
            title: "Import Complete",
            description: `Successfully imported ${result.importedRows} contacts`,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/imports"] });
        }}
        onCancel={() => {}}
      />
    </div>
  );
}

function ImportHistory() {
  const { data: imports, isLoading: importsLoading } = useQuery<ImportRun[]>({
    queryKey: ["/api/imports"],
  });

  const { data: docImports, isLoading: docsLoading } = useQuery<SavedDocument[]>({
    queryKey: ["/api/documents"],
  });

  const isLoading = importsLoading || docsLoading;

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  const hasImports = imports && imports.length > 0;
  const hasDocs = docImports && docImports.length > 0;

  if (!hasImports && !hasDocs) {
    return (
      <p className="text-sm text-muted-foreground py-4" data-testid="text-no-imports">
        No import history yet. Upload a file above to get started.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table data-testid="table-import-history">
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>File / Name</TableHead>
            <TableHead>Category / Status</TableHead>
            <TableHead className="text-right">Count</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(imports || []).map((run) => (
            <TableRow key={run.id} data-testid={`row-import-${run.id}`}>
              <TableCell>
                <Badge variant="secondary" className="text-xs">
                  {run.type}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{run.fileName || "---"}</TableCell>
              <TableCell>
                <Badge
                  variant={
                    run.status === "completed"
                      ? "default"
                      : run.status === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                  className="text-xs"
                >
                  {run.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right">{run.importedRows ?? 0}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {run.createdAt ? new Date(run.createdAt).toLocaleDateString() : "---"}
              </TableCell>
            </TableRow>
          ))}
          {(docImports || []).map((doc) => (
            <TableRow key={doc.id} data-testid={`row-import-doc-${doc.id}`}>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  Document
                </Badge>
              </TableCell>
              <TableCell className="text-sm">
                <div className="max-w-[180px]">
                  <p className="truncate font-medium">{doc.fileName}</p>
                  {doc.contactName && (
                    <p
                      className="truncate text-xs text-muted-foreground"
                      data-testid={`text-doc-contact-${doc.id}`}
                    >
                      {doc.contactName}
                    </p>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {doc.documentCategory ? (
                  <Badge variant="secondary" className="text-xs">
                    {doc.documentCategory}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">1</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : "---"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function MigrationPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            Data Migration
          </h1>
          <p className="text-muted-foreground mt-1" data-testid="text-page-description">
            Transfer your customers from Sweep & Go, Jobber, or other platforms. Upload CSV exports
            to migrate contacts, properties, invoices, and payment history into ScooPilot.
          </p>
        </div>

        <Tabs defaultValue="transfer" data-testid="tabs-migration">
          <TabsList>
            <TabsTrigger value="transfer" data-testid="tab-transfer">
              <ArrowRightLeft className="h-4 w-4 mr-1.5" />
              Transfer
            </TabsTrigger>
            <TabsTrigger value="contacts" data-testid="tab-contacts">
              <Users className="h-4 w-4 mr-1.5" />
              Contacts
            </TabsTrigger>
            <TabsTrigger value="invoices" data-testid="tab-invoices">
              <FileText className="h-4 w-4 mr-1.5" />
              Invoices
            </TabsTrigger>
            <TabsTrigger value="documents" data-testid="tab-documents">
              <FolderOpen className="h-4 w-4 mr-1.5" />
              Documents
            </TabsTrigger>
          </TabsList>
          <TabsContent value="transfer" className="mt-6">
            <TransferTab />
          </TabsContent>
          <TabsContent value="contacts" className="mt-6">
            <ContactsTab />
          </TabsContent>
          <TabsContent value="invoices" className="mt-6">
            <InvoicesTab />
          </TabsContent>
          <TabsContent value="documents" className="mt-6">
            <DocumentsTab />
          </TabsContent>
        </Tabs>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Import History</CardTitle>
            <CardDescription>Past import runs and their results</CardDescription>
          </CardHeader>
          <CardContent>
            <ImportHistory />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
