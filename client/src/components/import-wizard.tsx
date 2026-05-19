import { useState, useCallback, useRef, useEffect, Suspense, lazy } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  Upload,
  FileText,
  ChevronRight,
  ChevronLeft,
  Check,
  X,
  AlertTriangle,
  Info,
  Sparkles,
  Phone,
  Scissors,
  Calendar,
  DollarSign,
  Loader2,
  CheckCircle2,
  XCircle,
  SkipForward,
  ExternalLink,
  ClipboardPaste,
  FileImage,
  Link as LinkIcon,
  Route,
  RefreshCw,
  Shuffle,
  CalendarDays,
} from "lucide-react";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

const RouteMapView = lazy(() => import("@/components/route-map-view"));

// Types

interface FieldMapping {
  csvColumn: string;
  internalField: string;
  confidence: number;
  reason: string;
}

interface TransformSuggestion {
  field: string;
  type: string;
  params?: Record<string, unknown>;
}

interface MappingResult {
  mappings: FieldMapping[];
  transformations: TransformSuggestion[];
  warnings: string[];
}

interface ValidationError {
  row: number;
  field: string;
  value: string;
  message: string;
}

interface TransformedRow {
  rowIndex: number;
  original: Record<string, string>;
  transformed: Record<string, unknown>;
  errors: ValidationError[];
  isValid: boolean;
}

interface ImportResult {
  importRunId: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  errors: Array<{ row: number; message: string }>;
}

type SourceSystem = "sweepandgo" | "jobber" | "generic" | "googlesheet" | "housecallpro";
type RoutePreference = "preserve" | "rebuild" | "hybrid";
type UploadMode = "csv" | "paste" | "googlesheet" | "screenshot";

interface WizardAnswers {
  sourceSystem: SourceSystem | null;
  hasExport: boolean | null;
  knowsNextServiceDate: boolean | null;
  knowsServiceDays: boolean | null;
  knowsFrequency: boolean | null;
  routePreference: RoutePreference | null;
}

export interface ImportWizardProps {
  targetSchema: "contacts" | "invoices" | "routes";
  onComplete: (result: ImportResult) => void;
  onCancel: () => void;
  initialPlatform?: SourceSystem | null;
  preloadedMappings?: {
    headers: string[];
    rows: string[][];
    fileName: string;
    mappingResult: MappingResult;
    initialMappings: Record<string, string>;
    transformations: TransformSuggestion[];
  } | null;
}

// Schema Fields

const SCHEMA_FIELDS: Record<
  string,
  { field: string; label: string; required: boolean; sensitive: boolean }[]
> = {
  contacts: [
    { field: "firstName", label: "First Name", required: true, sensitive: false },
    { field: "lastName", label: "Last Name", required: true, sensitive: false },
    { field: "email", label: "Email", required: false, sensitive: false },
    { field: "phone", label: "Phone", required: false, sensitive: false },
    { field: "streetAddress", label: "Street Address", required: false, sensitive: false },
    { field: "address2", label: "Address 2", required: false, sensitive: false },
    { field: "city", label: "City", required: false, sensitive: false },
    { field: "state", label: "State", required: false, sensitive: false },
    { field: "zipCode", label: "Zip Code", required: false, sensitive: false },
    { field: "numberOfDogs", label: "Number of Dogs", required: false, sensitive: false },
    { field: "yardSize", label: "Yard Size", required: false, sensitive: false },
    { field: "serviceFrequency", label: "Service Frequency", required: false, sensitive: false },
    { field: "leadSource", label: "Lead Source", required: false, sensitive: false },
    { field: "status", label: "Status", required: false, sensitive: true },
    { field: "notes", label: "Notes", required: false, sensitive: false },
    { field: "gateCode", label: "Gate Code", required: false, sensitive: false },
    { field: "serviceDay", label: "Service Day", required: false, sensitive: false },
  ],
  invoices: [
    { field: "invoiceNumber", label: "Invoice Number", required: true, sensitive: false },
    { field: "invoiceDate", label: "Invoice Date", required: true, sensitive: true },
    { field: "dueDate", label: "Due Date", required: false, sensitive: true },
    { field: "paidDate", label: "Paid Date", required: false, sensitive: true },
    { field: "invoiceTotal", label: "Invoice Total", required: true, sensitive: true },
    { field: "invoiceStatus", label: "Invoice Status", required: true, sensitive: true },
    { field: "description", label: "Description", required: false, sensitive: false },
    { field: "quantity", label: "Quantity", required: false, sensitive: false },
    { field: "unitPrice", label: "Unit Price", required: false, sensitive: true },
    { field: "lineTotal", label: "Line Total", required: false, sensitive: true },
    { field: "taxAmount", label: "Tax Amount", required: false, sensitive: true },
    { field: "taxRate", label: "Tax Rate", required: false, sensitive: false },
    { field: "discountAmount", label: "Discount Amount", required: false, sensitive: true },
    { field: "paymentAmount", label: "Payment Amount", required: false, sensitive: true },
    { field: "paymentMethod", label: "Payment Method", required: false, sensitive: false },
    { field: "paymentReference", label: "Payment Reference", required: false, sensitive: false },
    { field: "firstName", label: "First Name", required: false, sensitive: false },
    { field: "lastName", label: "Last Name", required: false, sensitive: false },
    { field: "email", label: "Email", required: false, sensitive: false },
  ],
  routes: [
    { field: "routeName", label: "Route Name", required: true, sensitive: false },
    { field: "firstName", label: "First Name", required: false, sensitive: false },
    { field: "lastName", label: "Last Name", required: false, sensitive: false },
    { field: "email", label: "Email", required: false, sensitive: false },
    { field: "streetAddress", label: "Street Address", required: false, sensitive: false },
    { field: "city", label: "City", required: false, sensitive: false },
    { field: "state", label: "State", required: false, sensitive: false },
    { field: "zipCode", label: "Zip Code", required: false, sensitive: false },
  ],
};

const TRANSFORM_OPTIONS = [
  { type: "split_name", label: "Split Full Name", icon: Scissors },
  { type: "trim", label: "Trim Whitespace", icon: Scissors },
  { type: "parse_currency", label: "Parse Currency", icon: DollarSign },
  { type: "parse_date", label: "Parse Date", icon: Calendar },
  { type: "normalize_phone", label: "Normalize Phone", icon: Phone },
];

// Platform config

const PLATFORM_CONFIG: Record<
  SourceSystem,
  {
    label: string;
    shortLabel: string;
    color: string;
    bgColor: string;
    exportHint: string;
    columnHints: string[];
  }
> = {
  sweepandgo: {
    label: "Sweep & Go",
    shortLabel: "S&G",
    color: "text-emerald-700 dark:text-emerald-400",
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
    exportHint:
      "In Sweep & Go, go to Customers → click Export to download your customer list as CSV. The file will have columns like First Name, Last Name, Gate Code, # of Dogs, Service Day, and Service Frequency.",
    columnHints: ["First Name", "Last Name", "# of Dogs", "Gate Code", "Service Day", "Frequency"],
  },
  jobber: {
    label: "Jobber",
    shortLabel: "J",
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
    exportHint:
      "In Jobber, go to Clients → click the gear icon → Export to CSV. The file will have columns like Client First Name, Client Last Name, Client Email, Property Street 1, and Property City.",
    columnHints: [
      "Client First Name",
      "Client Last Name",
      "Client Email",
      "Property Street 1",
      "Property City",
    ],
  },
  generic: {
    label: "Other / Generic CSV",
    shortLabel: "CSV",
    color: "text-gray-700 dark:text-gray-400",
    bgColor: "bg-gray-100 dark:bg-gray-800",
    exportHint:
      "Upload any customer CSV and we'll detect the column format automatically using AI. Your file should have at least a name column and ideally an address column.",
    columnHints: ["Name", "Email", "Phone", "Address", "City", "State"],
  },
  googlesheet: {
    label: "Google Sheet",
    shortLabel: "GS",
    color: "text-green-700 dark:text-green-400",
    bgColor: "bg-green-100 dark:bg-green-900/30",
    exportHint:
      "Share your Google Sheet publicly (View only) and paste the link below. We'll fetch it as a CSV automatically. Your sheet should have a header row.",
    columnHints: ["Name", "Email", "Phone", "Address"],
  },
  housecallpro: {
    label: "HouseCall Pro",
    shortLabel: "HCP",
    color: "text-indigo-700 dark:text-indigo-400",
    bgColor: "bg-indigo-100 dark:bg-indigo-900/30",
    exportHint:
      "In HouseCall Pro, go to Customers → Actions → Export to request your customer file by email (from notifications@housecallpro.com). Also export Jobs: Customers → Jobs → Actions → Export. Upload both CSV files together.",
    columnHints: ["Customer Name", "Email", "Mobile Number", "Street", "City", "Job Description"],
  },
};

// Helpers

function parseCSVClient(text: string): { headers: string[]; rows: string[][] } {
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

  // Detect delimiter: if first line has more tabs than commas, use tab
  const firstLine = lines[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  if (tabCount > commaCount) {
    // Tab-delimited
    const parseTabLine = (line: string) =>
      line.split("\t").map((c) => c.trim().replace(/^"|"$/g, ""));
    const headers = parseTabLine(lines[0]);
    const rows = lines.slice(1).map(parseTabLine);
    return { headers, rows };
  }

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence > 0.9) {
    return (
      <Badge
        variant="outline"
        className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800"
        data-testid="badge-confidence-high"
      >
        {Math.round(confidence * 100)}%
      </Badge>
    );
  }
  if (confidence >= 0.75) {
    return (
      <Badge
        variant="outline"
        className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800"
        data-testid="badge-confidence-medium"
      >
        {Math.round(confidence * 100)}%
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800"
      data-testid="badge-confidence-low"
    >
      {Math.round(confidence * 100)}%
    </Badge>
  );
}

// Two-layer Progress Indicator

const LAYER1_STEPS = ["Checklist", "Upload", "Map Fields", "Review Rows"];
const LAYER2_STEPS = ["Route Mode", "Day Preview", "Confirm & Stage"];

// step 0-3 = layer 1, step 4-6 = layer 2
function TwoLayerProgress({ step }: { step: number }) {
  const layer1Active = step <= 3;
  const layer2Active = step >= 4;

  return (
    <div className="flex flex-col gap-2 mb-6" data-testid="two-layer-progress">
      {/* Layer labels */}
      <div className="flex gap-3 items-start">
        {/* Layer 1 */}
        <div className={`flex-1 ${layer1Active ? "" : "opacity-60"}`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-full ${layer1Active ? "bg-primary text-primary-foreground" : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"}`}
            >
              {step > 3 ? <Check className="w-3 h-3 inline" /> : "Layer 1"}{" "}
              {step > 3 ? " Done" : ""}
              {step <= 3 ? "Layer 1" : ""}
            </span>
            <span className="text-xs text-muted-foreground">Contact Info</span>
          </div>
          <div className="flex items-center gap-1">
            {LAYER1_STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-1">
                <div
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                    step === i
                      ? "bg-primary text-primary-foreground"
                      : step > i
                        ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                        : "bg-muted text-muted-foreground"
                  }`}
                  data-testid={`step-indicator-${i}`}
                >
                  {step > i ? <Check className="w-3 h-3" /> : <span>{i + 1}</span>}
                  <span className="hidden sm:inline">{label}</span>
                </div>
                {i < LAYER1_STEPS.length - 1 && (
                  <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>

        <ChevronRight className="w-4 h-4 text-muted-foreground mt-5 flex-shrink-0" />

        {/* Layer 2 */}
        <div className={`flex-1 ${layer2Active ? "" : "opacity-40"}`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-full ${layer2Active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              Layer 2
            </span>
            <span className="text-xs text-muted-foreground">Service Logic</span>
          </div>
          <div className="flex items-center gap-1">
            {LAYER2_STEPS.map((label, i) => {
              const globalStep = i + 4;
              return (
                <div key={label} className="flex items-center gap-1">
                  <div
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                      step === globalStep
                        ? "bg-primary text-primary-foreground"
                        : step > globalStep
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : "bg-muted text-muted-foreground"
                    }`}
                    data-testid={`step-indicator-${globalStep}`}
                  >
                    {step > globalStep ? <Check className="w-3 h-3" /> : <span>{i + 5}</span>}
                    <span className="hidden sm:inline">{label}</span>
                  </div>
                  {i < LAYER2_STEPS.length - 1 && (
                    <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Step 0: Migration Checklist

function MigrationChecklist({
  answers,
  onChange,
  onNext,
  onCancel,
}: {
  answers: WizardAnswers;
  onChange: (patch: Partial<WizardAnswers>) => void;
  onNext: () => void;
  onCancel: () => void;
}) {
  const platforms: { value: SourceSystem; label: string; icon: string; description: string }[] = [
    {
      value: "sweepandgo",
      label: "Sweep & Go",
      icon: "S&G",
      description: "Coming from Sweep & Go",
    },
    { value: "jobber", label: "Jobber", icon: "J", description: "Coming from Jobber" },
    {
      value: "generic",
      label: "Other Software / CSV",
      icon: "CSV",
      description: "Generic CSV or spreadsheet",
    },
    {
      value: "googlesheet",
      label: "Google Sheets",
      icon: "GS",
      description: "Direct Google Sheet link",
    },
  ];

  const canAdvance = answers.sourceSystem !== null;

  return (
    <Card data-testid="step-checklist">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardPaste className="w-5 h-5" />
          Before We Start — Quick Setup Check
        </CardTitle>
        <CardDescription>
          Answer a few questions so we can tailor the import to your data. This takes less than a
          minute.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Question 1: Source system */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold flex items-center gap-2">
            <span className="inline-flex w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs items-center justify-center font-bold">
              1
            </span>
            Where are you importing from?
          </Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {platforms.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => onChange({ sourceSystem: p.value })}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border-2 text-center transition-colors ${
                  answers.sourceSystem === p.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                }`}
                data-testid={`checklist-source-${p.value}`}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${PLATFORM_CONFIG[p.value].bgColor} ${PLATFORM_CONFIG[p.value].color}`}
                >
                  {p.icon}
                </div>
                <span className="text-xs font-medium">{p.label}</span>
                {answers.sourceSystem === p.value && <Check className="w-3 h-3 text-primary" />}
              </button>
            ))}
          </div>
        </div>

        <Separator />

        {/* Question 2: Do you have an export ready? */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold flex items-center gap-2">
            <span className="inline-flex w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs items-center justify-center font-bold">
              2
            </span>
            Do you have a customer export file ready to upload?
          </Label>
          <RadioGroup
            value={answers.hasExport === null ? "" : answers.hasExport ? "yes" : "no"}
            onValueChange={(v) => onChange({ hasExport: v === "yes" })}
            className="flex gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="yes" id="export-yes" data-testid="checklist-export-yes" />
              <Label htmlFor="export-yes" className="text-sm font-normal cursor-pointer">
                Yes, I have the file
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="no" id="export-no" data-testid="checklist-export-no" />
              <Label htmlFor="export-no" className="text-sm font-normal cursor-pointer">
                Not yet, I need to export it first
              </Label>
            </div>
          </RadioGroup>
          {answers.hasExport === false &&
            answers.sourceSystem &&
            answers.sourceSystem !== "googlesheet" && (
              <div className="p-3 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300">
                <strong>Tip:</strong> {PLATFORM_CONFIG[answers.sourceSystem].exportHint}
              </div>
            )}
        </div>

        <Separator />

        {/* Question 3: Do you know each customer's next service date? */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold flex items-center gap-2">
            <span className="inline-flex w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs items-center justify-center font-bold">
              3
            </span>
            Do you know each customer's next service date?
          </Label>
          <RadioGroup
            value={
              answers.knowsNextServiceDate === null
                ? ""
                : answers.knowsNextServiceDate
                  ? "yes"
                  : "no"
            }
            onValueChange={(v) => onChange({ knowsNextServiceDate: v === "yes" })}
            className="flex gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem
                value="yes"
                id="next-date-yes"
                data-testid="checklist-next-date-yes"
              />
              <Label htmlFor="next-date-yes" className="text-sm font-normal cursor-pointer">
                Yes, I have a next service date column
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="no" id="next-date-no" data-testid="checklist-next-date-no" />
              <Label htmlFor="next-date-no" className="text-sm font-normal cursor-pointer">
                No — we'll use service day + cadence as the anchor
              </Label>
            </div>
          </RadioGroup>
          {answers.knowsNextServiceDate === false && (
            <div className="p-3 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300">
              That's fine. We'll estimate the first visit date from the service day and frequency
              (e.g., a Monday weekly customer defaults to next Monday). You can adjust individual
              dates in the resolver after staging.
            </div>
          )}
        </div>

        <Separator />

        {/* Question 4: Do you know service days? */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold flex items-center gap-2">
            <span className="inline-flex w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs items-center justify-center font-bold">
              4
            </span>
            Does your export include which day each customer is serviced?
          </Label>
          <RadioGroup
            value={answers.knowsServiceDays === null ? "" : answers.knowsServiceDays ? "yes" : "no"}
            onValueChange={(v) => onChange({ knowsServiceDays: v === "yes" })}
            className="flex gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="yes" id="days-yes" data-testid="checklist-days-yes" />
              <Label htmlFor="days-yes" className="text-sm font-normal cursor-pointer">
                Yes, there's a service day column
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="no" id="days-no" data-testid="checklist-days-no" />
              <Label htmlFor="days-no" className="text-sm font-normal cursor-pointer">
                No, I'll assign days after import
              </Label>
            </div>
          </RadioGroup>
        </div>

        <Separator />

        {/* Question 5: Do you know service frequency? */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold flex items-center gap-2">
            <span className="inline-flex w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs items-center justify-center font-bold">
              5
            </span>
            Does your export include service frequency (weekly, biweekly, etc.)?
          </Label>
          <RadioGroup
            value={answers.knowsFrequency === null ? "" : answers.knowsFrequency ? "yes" : "no"}
            onValueChange={(v) => onChange({ knowsFrequency: v === "yes" })}
            className="flex gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="yes" id="freq-yes" data-testid="checklist-freq-yes" />
              <Label htmlFor="freq-yes" className="text-sm font-normal cursor-pointer">
                Yes, there's a frequency column
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="no" id="freq-no" data-testid="checklist-freq-no" />
              <Label htmlFor="freq-no" className="text-sm font-normal cursor-pointer">
                No, I'll set frequency later
              </Label>
            </div>
          </RadioGroup>
        </div>

        <Separator />

        {/* Question 6: Route preference */}
        <div className="space-y-3">
          <Label className="text-sm font-semibold flex items-center gap-2">
            <span className="inline-flex w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs items-center justify-center font-bold">
              6
            </span>
            What would you like to do with your existing route days?
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                value: "preserve" as RoutePreference,
                icon: <Route className="w-4 h-4" />,
                label: "Preserve Current Days",
                description: "Keep the service day from each customer's record",
              },
              {
                value: "rebuild" as RoutePreference,
                icon: <RefreshCw className="w-4 h-4" />,
                label: "Rebuild Optimized Routes",
                description: "ScooPilot assigns days based on geography and route density",
              },
              {
                value: "hybrid" as RoutePreference,
                icon: <Shuffle className="w-4 h-4" />,
                label: "Hybrid",
                description: "Keep confident assignments, flag inefficient ones for review",
              },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ routePreference: opt.value })}
                className={`flex flex-col gap-2 p-3 rounded-lg border-2 text-left transition-colors ${
                  answers.routePreference === opt.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                }`}
                data-testid={`checklist-route-${opt.value}`}
              >
                <div className="flex items-center gap-2">
                  {opt.icon}
                  <span className="text-sm font-medium">{opt.label}</span>
                  {answers.routePreference === opt.value && (
                    <Check className="w-3 h-3 text-primary ml-auto" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{opt.description}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" onClick={onCancel} data-testid="button-cancel-checklist">
            Cancel
          </Button>
          <div className="flex items-center gap-4">
            <a
              href="/sample-clients.csv"
              download="sample-clients.csv"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-download-sample-csv-checklist"
            >
              <FileText className="w-3.5 h-3.5" />
              Download sample CSV
            </a>
            <Button onClick={onNext} disabled={!canAdvance} data-testid="button-next-checklist">
              Continue to Upload
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Step 1: Upload Screen (competitor-aware, multi-mode)

function UploadScreen({
  answers,
  onFileReady,
  onBack,
  isAnalyzing,
  hasError,
}: {
  answers: WizardAnswers;
  onFileReady: (text: string, filename: string) => void;
  onBack: () => void;
  isAnalyzing: boolean;
  hasError: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadMode, setUploadMode] = useState<UploadMode>("csv");
  const [dragOver, setDragOver] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState("");
  const [fileName, setFileName] = useState("");

  const platform = answers.sourceSystem || "generic";
  const config = PLATFORM_CONFIG[platform];

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith(".csv")) {
        return;
      }
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        onFileReady(text, file.name);
      };
      reader.readAsText(file);
    },
    [onFileReady]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handlePaste = () => {
    if (!pasteText.trim()) return;
    onFileReady(pasteText, "pasted-data.csv");
  };

  const handleGoogleSheet = async () => {
    if (!sheetUrl.trim()) return;
    setSheetLoading(true);
    setSheetError("");
    try {
      // Convert Google Sheet URL to CSV export URL
      // Format: https://docs.google.com/spreadsheets/d/{ID}/export?format=csv
      const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!match) {
        setSheetError(
          "That doesn't look like a valid Google Sheets URL. Make sure you copied the full link."
        );
        setSheetLoading(false);
        return;
      }
      const sheetId = match[1];
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      const res = await fetch(`/api/imports/fetch-url?url=${encodeURIComponent(csvUrl)}`);
      if (!res.ok) {
        setSheetError("Could not fetch the sheet. Make sure it's shared publicly (View access).");
        setSheetLoading(false);
        return;
      }
      const text = await res.text();
      onFileReady(text, `google-sheet-${sheetId}.csv`);
    } catch {
      setSheetError(
        "Failed to fetch Google Sheet. Check that the link is correct and the sheet is publicly shared."
      );
    } finally {
      setSheetLoading(false);
    }
  };

  return (
    <Card data-testid="step-upload">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload Your Customer Data
          </CardTitle>
          <Badge
            variant="outline"
            className={`${config.color} border-current`}
            data-testid="badge-platform"
          >
            {config.label}
          </Badge>
        </div>
        <CardDescription>{config.exportHint}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Expected columns hint */}
        {platform !== "generic" && (
          <div className="p-3 rounded-md bg-muted/50 border border-border">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">
              Expected columns from {config.label}:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {config.columnHints.map((hint) => (
                <Badge key={hint} variant="secondary" className="text-xs">
                  {hint}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Upload mode tabs */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
          {(
            [
              {
                mode: "csv" as UploadMode,
                label: "CSV File",
                icon: <FileText className="w-3.5 h-3.5" />,
              },
              {
                mode: "paste" as UploadMode,
                label: "Paste Data",
                icon: <ClipboardPaste className="w-3.5 h-3.5" />,
              },
              ...(platform === "googlesheet" || platform === "generic"
                ? [
                    {
                      mode: "googlesheet" as UploadMode,
                      label: "Google Sheet",
                      icon: <LinkIcon className="w-3.5 h-3.5" />,
                    },
                  ]
                : []),
              {
                mode: "screenshot" as UploadMode,
                label: "Screenshot / PDF",
                icon: <FileImage className="w-3.5 h-3.5" />,
              },
            ] as { mode: UploadMode; label: string; icon: React.ReactNode }[]
          ).map(({ mode, label, icon }) => (
            <button
              key={mode}
              type="button"
              onClick={() => setUploadMode(mode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                uploadMode === mode
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`upload-mode-${mode}`}
            >
              {icon}
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* CSV file drop zone */}
        {uploadMode === "csv" && (
          <div>
            <div
              className={`border-2 border-dashed rounded-md p-12 text-center cursor-pointer transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              }`}
              onDrop={handleDrop}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              data-testid="drop-zone"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
                data-testid="input-file"
              />
              {isAnalyzing ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-10 h-10 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Analyzing your file with AI...</p>
                </div>
              ) : fileName ? (
                <div className="flex flex-col items-center gap-3">
                  <FileText className="w-10 h-10 text-primary" />
                  <p className="font-medium" data-testid="text-filename">
                    {fileName}
                  </p>
                  <p className="text-sm text-muted-foreground">Analyzing columns...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Upload className="w-10 h-10 text-muted-foreground" />
                  <p className="font-medium">Drop your CSV file here</p>
                  <p className="text-sm text-muted-foreground">or click to browse</p>
                </div>
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <a
                href="/sample-clients.csv"
                download="sample-clients.csv"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                data-testid="link-download-sample-csv"
              >
                <FileText className="w-3.5 h-3.5" />
                Download sample CSV
              </a>
            </div>
            {hasError && (
              <div
                className="mt-3 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2"
                data-testid="text-upload-error"
              >
                <XCircle className="w-4 h-4 flex-shrink-0" />
                Failed to analyze file. Please try again.
              </div>
            )}
          </div>
        )}

        {/* Paste / copy-paste mode */}
        {uploadMode === "paste" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Paste tab-delimited or comma-delimited text from a spreadsheet below. Include the
              header row.
            </p>
            <Textarea
              placeholder={
                "First Name\tLast Name\tEmail\tPhone\nJane\tSmith\tjane@example.com\t555-1234"
              }
              className="min-h-[200px] font-mono text-xs"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              data-testid="textarea-paste"
            />
            <Button
              onClick={handlePaste}
              disabled={!pasteText.trim() || isAnalyzing}
              data-testid="button-parse-paste"
            >
              {isAnalyzing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Parse & Continue
            </Button>
          </div>
        )}

        {/* Google Sheet link mode */}
        {uploadMode === "googlesheet" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Share your Google Sheet publicly (anyone with link, View access) and paste the URL
              below.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                className="flex-1"
                data-testid="input-sheet-url"
              />
              <Button
                onClick={handleGoogleSheet}
                disabled={!sheetUrl.trim() || sheetLoading || isAnalyzing}
                data-testid="button-fetch-sheet"
              >
                {sheetLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ExternalLink className="w-4 h-4" />
                )}
              </Button>
            </div>
            {sheetError && (
              <p className="text-sm text-destructive" data-testid="text-sheet-error">
                {sheetError}
              </p>
            )}
            <div className="p-3 rounded-md bg-muted/50 text-xs text-muted-foreground space-y-1">
              <p>How to share your Google Sheet publicly:</p>
              <ol className="list-decimal list-inside space-y-0.5 pl-1">
                <li>Open your sheet in Google Sheets</li>
                <li>
                  Click <strong>Share</strong> → <strong>Change to anyone with the link</strong>
                </li>
                <li>
                  Set permission to <strong>Viewer</strong>
                </li>
                <li>Copy the link and paste it above</li>
              </ol>
            </div>
          </div>
        )}

        {/* Screenshot / PDF fallback */}
        {uploadMode === "screenshot" && (
          <div className="space-y-3">
            <div className="p-4 rounded-md border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  Manual Review Required
                </p>
              </div>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                Accuracy depends on image quality. You'll review every row before anything is
                imported — nothing is committed automatically from screenshots or PDFs.
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              Screenshot and PDF import is handled through our manual review flow. Please contact
              support or use the copy/paste option to enter data from a screenshot manually.
            </p>
            <Button
              variant="outline"
              onClick={() => setUploadMode("paste")}
              data-testid="button-switch-to-paste"
            >
              <ClipboardPaste className="w-4 h-4 mr-2" />
              Use Copy/Paste Instead
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" onClick={onBack} data-testid="button-back-upload">
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Step 4: Route Assignment Mode

function RouteAssignmentStep({
  routePreference,
  onChange,
  onNext,
  onBack,
}: {
  routePreference: RoutePreference | null;
  onChange: (pref: RoutePreference) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const options = [
    {
      value: "preserve" as RoutePreference,
      icon: <Route className="w-5 h-5" />,
      label: "Preserve Current Days",
      description:
        "Keep the service day exactly as recorded in each customer's import data. Best if your existing schedule is already working well.",
      badge: "Recommended if you have service days in your export",
      color: "border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20",
    },
    {
      value: "rebuild" as RoutePreference,
      icon: <RefreshCw className="w-5 h-5" />,
      label: "Rebuild Optimized Routes",
      description:
        "ScooPilot assigns service days based on address geography and route density. Best if your current routing is scattered or inefficient.",
      badge: "Requires addresses in your data",
      color: "border-purple-200 bg-purple-50/50 dark:border-purple-800 dark:bg-purple-950/20",
    },
    {
      value: "hybrid" as RoutePreference,
      icon: <Shuffle className="w-5 h-5" />,
      label: "Hybrid",
      description:
        "Keeps high-confidence day assignments from your data, and flags low-confidence ones for your review before committing.",
      badge: "Review step before finalizing",
      color: "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20",
    },
  ];

  return (
    <Card data-testid="step-route-assignment">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5" />
          How should we group your customers into routes?
        </CardTitle>
        <CardDescription>
          Each customer needs a service day so they land on the right route. Tell us how to handle
          that for the customers you're importing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`w-full flex items-start gap-4 p-4 rounded-lg border-2 text-left transition-colors ${
                routePreference === opt.value
                  ? `border-primary bg-primary/5`
                  : `${opt.color} hover:border-primary/50`
              }`}
              data-testid={`route-mode-${opt.value}`}
            >
              <div
                className={`mt-0.5 ${routePreference === opt.value ? "text-primary" : "text-muted-foreground"}`}
              >
                {opt.icon}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{opt.label}</span>
                  {routePreference === opt.value && <Check className="w-4 h-4 text-primary" />}
                  <Badge variant="secondary" className="text-xs">
                    {opt.badge}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{opt.description}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="p-3 rounded-md bg-muted/50 border border-border text-xs text-muted-foreground">
          <Info className="w-3.5 h-3.5 inline mr-1 mb-0.5" />
          Next you'll see your customers grouped by day on a map so you can spot any misassignments
          before staging. After that you'll confirm and stage, then land in the{" "}
          <strong className="text-foreground">Review page</strong> to fill in any remaining service
          details and commit your contacts to the CRM.
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" onClick={onBack} data-testid="button-back-route">
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <Button onClick={onNext} disabled={!routePreference} data-testid="button-preview-days">
            Preview Route Days
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Step 5: Route Day Preview

const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DAY_ALIASES: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
  m: "Monday",
  t: "Tuesday",
  w: "Wednesday",
  th: "Thursday",
  f: "Friday",
};

function normalizeDay(raw: unknown): string {
  if (!raw) return "Unassigned";
  const s = String(raw).trim().toLowerCase();
  if (DAY_ALIASES[s]) return DAY_ALIASES[s];
  const match = WEEK_DAYS.find((d) => d.toLowerCase().startsWith(s.slice(0, 3)));
  return match || "Unassigned";
}

type DayEntry = { rowIndex: number; name: string; weekSlot?: "A" | "B" };

function TransformExplainer() {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-4 rounded-md border border-border bg-muted/30 text-xs overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/40 transition-colors"
        onClick={() => setOpen((p) => !p)}
        data-testid="button-transform-explainer-toggle"
      >
        <span className="font-semibold text-foreground">What are transforms?</span>
        <span className="text-muted-foreground text-[10px] ml-2">{open ? "▲ hide" : "▼ show"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-muted-foreground">
            Transforms clean or convert raw CSV values before they're saved. Add one using the "Add
            transform…" dropdown on any field row.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">Normalize Phone</p>
              <p className="text-muted-foreground">
                <span className="font-mono bg-muted px-1 rounded">5551234567</span>
                {" → "}
                <span className="font-mono bg-muted px-1 rounded">+15551234567</span>
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">Trim Whitespace</p>
              <p className="text-muted-foreground">
                <span className="font-mono bg-muted px-1 rounded">" John "</span>
                {" → "}
                <span className="font-mono bg-muted px-1 rounded">"John"</span>
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">Split Full Name</p>
              <p className="text-muted-foreground">
                <span className="font-mono bg-muted px-1 rounded">"Jane Doe"</span>
                {" → "}
                <span className="font-mono bg-muted px-1 rounded">First: Jane, Last: Doe</span>
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">Parse Currency</p>
              <p className="text-muted-foreground">
                <span className="font-mono bg-muted px-1 rounded">"$24.99"</span>
                {" → "}
                <span className="font-mono bg-muted px-1 rounded">2499 (cents)</span>
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">Parse Date</p>
              <p className="text-muted-foreground">
                <span className="font-mono bg-muted px-1 rounded">"3/15/24"</span>
                {" → "}
                <span className="font-mono bg-muted px-1 rounded">2024-03-15</span>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function haversineDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function RouteDayPreviewStep({
  previewRows,
  skippedRows,
  routePreference,
  geocodedPositions,
  onNext,
  onBack,
  onDayOverride,
  onAddressOverride,
}: {
  previewRows: TransformedRow[];
  skippedRows: Set<number>;
  routePreference: RoutePreference | null;
  geocodedPositions: Record<number, { lat: number; lng: number }>;
  onNext: () => void;
  onBack: () => void;
  onDayOverride: (rowIndex: number, newDay: string) => void;
  onAddressOverride?: (rowIndex: number, field: string, value: string) => void;
}) {
  const [localOverrides, setLocalOverrides] = useState<Record<number, string>>({});
  const [showMap, setShowMap] = useState(false);
  const [addressEdits, setAddressEdits] = useState<
    Record<number, { streetAddress?: string; city?: string; state?: string; zipCode?: string }>
  >({});
  const [showSuspiciousPanel, setShowSuspiciousPanel] = useState(false);
  const [selectedSuspiciousRow, setSelectedSuspiciousRow] = useState<number | null>(null);

  const { data: company } = useQuery<{
    startLatitude?: string | null;
    startLongitude?: string | null;
  }>({ queryKey: ["/api/company"] });

  // One distinct color per day for the map legend
  const DAY_COLORS: Record<string, string> = {
    Monday: "#3b82f6",
    Tuesday: "#8b5cf6",
    Wednesday: "#22c55e",
    Thursday: "#f97316",
    Friday: "#ec4899",
    Saturday: "#06b6d4",
    Sunday: "#84cc16",
    Unassigned: "#94a3b8",
  };

  function isBiweeklyFreq(freq: unknown) {
    const f = String(freq || "").toLowerCase();
    return f.includes("biweek") || f.includes("every other") || f.includes("every_other");
  }

  // Build day → customer groups, accounting for local overrides
  const dayGroups: Record<string, DayEntry[]> = {};
  const biweeklyCounters: Record<string, number> = {};
  for (const row of previewRows) {
    if (skippedRows.has(row.rowIndex)) continue;
    const rawDay =
      localOverrides[row.rowIndex] !== undefined
        ? localOverrides[row.rowIndex]
        : normalizeDay(row.transformed?.serviceDay);
    const name =
      [row.transformed?.firstName || "", row.transformed?.lastName || ""]
        .filter(Boolean)
        .join(" ")
        .trim() || `Row ${row.rowIndex + 1}`;
    const biweekly = isBiweeklyFreq(row.transformed?.serviceFrequency);
    const entry: DayEntry = { rowIndex: row.rowIndex, name };
    if (biweekly) {
      biweeklyCounters[rawDay] = (biweeklyCounters[rawDay] || 0) + 1;
      entry.weekSlot = biweeklyCounters[rawDay] % 2 === 1 ? "A" : "B";
    }
    if (!dayGroups[rawDay]) dayGroups[rawDay] = [];
    dayGroups[rawDay].push(entry);
  }

  const orderedDays = [...WEEK_DAYS, "Saturday", "Sunday", "Unassigned"];
  const allDays = orderedDays.filter((d) => dayGroups[d]?.length);
  const total = Object.values(dayGroups).reduce((s, g) => s + g.length, 0);

  const modeNote =
    routePreference === "rebuild"
      ? "All service days will be cleared and re-assigned by the resolver using address geography."
      : routePreference === "preserve"
        ? "Existing service days from your CSV will be kept as-is. Use the dropdowns below to fix any misassignments before staging."
        : "Days present in your CSV are kept; gaps are flagged for resolver review. Reassign below as needed.";

  function handleReassign(rowIndex: number, newDay: string) {
    setLocalOverrides((prev) => ({ ...prev, [rowIndex]: newDay }));
    onDayOverride(rowIndex, newDay);
  }

  const unassigned = dayGroups["Unassigned"] || [];

  const companyLat = company?.startLatitude ? parseFloat(company.startLatitude) : null;
  const companyLng = company?.startLongitude ? parseFloat(company.startLongitude) : null;
  const SUSPICIOUS_MILES = 75;

  const suspiciousRows = previewRows.filter((r) => {
    if (skippedRows.has(r.rowIndex)) return false;
    const pos = geocodedPositions[r.rowIndex];
    if (!pos || companyLat == null || companyLng == null) return false;
    return haversineDistanceMiles(companyLat, companyLng, pos.lat, pos.lng) > SUSPICIOUS_MILES;
  });

  const geocodedCount = Object.keys(geocodedPositions).length;
  const totalAddressRows = previewRows.filter(
    (r) => !skippedRows.has(r.rowIndex) && (r.transformed as Record<string, unknown>).streetAddress
  ).length;

  function getRowName(r: TransformedRow) {
    const t = r.transformed as Record<string, unknown>;
    return (
      [(t.firstName as string) || "", (t.lastName as string) || ""]
        .filter(Boolean)
        .join(" ")
        .trim() || `Row ${r.rowIndex + 1}`
    );
  }

  return (
    <Card data-testid="step-route-day-preview">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5" />
          Check the route day distribution
        </CardTitle>
        <CardDescription>
          {total} customer{total !== 1 ? "s" : ""} grouped by service day
          {Object.values(dayGroups).some((g) => g.some((e) => e.weekSlot)) &&
            " — biweekly customers split into Week A / Week B"}
          . Use the dropdown next to any name to reassign them before staging.
          {suspiciousRows.length > 0 && (
            <span className="block mt-1 text-amber-600 dark:text-amber-400">
              {suspiciousRows.length} address
              {suspiciousRows.length !== 1 ? "es" : ""} appear more than {SUSPICIOUS_MILES} miles
              from your service area — see flags below.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Map / List toggle */}
        <div className="flex items-center gap-2">
          <Button
            variant={showMap ? "default" : "outline"}
            size="sm"
            onClick={() => setShowMap(true)}
            data-testid="button-view-map"
          >
            Map View
          </Button>
          <Button
            variant={!showMap ? "default" : "outline"}
            size="sm"
            onClick={() => setShowMap(false)}
            data-testid="button-view-panels"
          >
            Day Panels
          </Button>
          {showMap && (
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {allDays
                .filter((d) => d !== "Unassigned")
                .map((d) => (
                  <span key={d} className="flex items-center gap-1 text-xs">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: DAY_COLORS[d] ?? "#64748b" }}
                    />
                    {d} ({(dayGroups[d] || []).length})
                  </span>
                ))}
            </div>
          )}
        </div>

        {/* Route preview map — uses existing RouteMapView component with geocoded customer
            positions colored by service day. Addresses are geocoded when entering this step. */}
        {showMap && (
          <div className="relative rounded-lg overflow-hidden border" style={{ height: 320 }}>
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <RouteMapView
                stops={previewRows
                  .filter((r) => !skippedRows.has(r.rowIndex) && geocodedPositions[r.rowIndex])
                  .map((r, idx) => {
                    const pos = geocodedPositions[r.rowIndex];
                    const effectiveDay =
                      localOverrides[r.rowIndex] !== undefined
                        ? localOverrides[r.rowIndex]
                        : normalizeDay(r.transformed?.serviceDay);
                    const t = r.transformed as Record<string, unknown>;
                    const name =
                      [(t.firstName as string) || "", (t.lastName as string) || ""]
                        .filter(Boolean)
                        .join(" ")
                        .trim() || `Row ${r.rowIndex + 1}`;
                    const isSuspicious = suspiciousRows.some((s) => s.rowIndex === r.rowIndex);
                    return {
                      id: String(r.rowIndex),
                      stopNumber: idx + 1,
                      contactName: isSuspicious
                        ? `${name} — address may be wrong, click to correct`
                        : name,
                      streetAddress: (t.streetAddress as string) || "",
                      latitude: pos.lat,
                      longitude: pos.lng,
                      routeColor: isSuspicious
                        ? "#ef4444"
                        : (DAY_COLORS[effectiveDay] ?? "#64748b"),
                    };
                  })}
                routeName="Import Route Preview"
                selectedStopId={
                  selectedSuspiciousRow !== null ? String(selectedSuspiciousRow) : undefined
                }
                onStopClick={(id) => {
                  const rowIndex = parseInt(id);
                  const isSusp = suspiciousRows.some((s) => s.rowIndex === rowIndex);
                  if (isSusp) {
                    setSelectedSuspiciousRow((prev) => (prev === rowIndex ? null : rowIndex));
                    setShowSuspiciousPanel(true);
                  }
                }}
                companyLatitude={
                  company?.startLatitude != null ? parseFloat(company.startLatitude) : null
                }
                companyLongitude={
                  company?.startLongitude != null ? parseFloat(company.startLongitude) : null
                }
              />
            </Suspense>
            {Object.keys(geocodedPositions).length === 0 && (
              <div className="absolute inset-0 flex items-end justify-center pb-3 pointer-events-none">
                <span className="bg-background/90 text-xs px-3 py-1 rounded shadow border">
                  Geocoding customer addresses… markers will appear shortly
                </span>
              </div>
            )}
          </div>
        )}

        {/* Geocoding count label */}
        {totalAddressRows > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="text-geocoding-count">
            {geocodedCount === 0
              ? `Locating addresses on the map (${totalAddressRows} total)…`
              : `Showing sampled ${geocodedCount} of ${totalAddressRows} total addresses`}
          </p>
        )}

        {/* Day panel grid — Mon through Fri (+ Sat/Sun if present) */}
        {!showMap && allDays.filter((d) => d !== "Unassigned").length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {allDays
              .filter((d) => d !== "Unassigned")
              .map((day) => {
                const entries = dayGroups[day] || [];
                const weekAEntries = entries.filter((e) => e.weekSlot === "A");
                const weekBEntries = entries.filter((e) => e.weekSlot === "B");
                const weeklyEntries = entries.filter((e) => !e.weekSlot);

                const allGrouped = [
                  ...(weeklyEntries.length > 0 ? [{ label: null, items: weeklyEntries }] : []),
                  ...(weekAEntries.length > 0 ? [{ label: "Week A", items: weekAEntries }] : []),
                  ...(weekBEntries.length > 0 ? [{ label: "Week B", items: weekBEntries }] : []),
                ];

                return (
                  <div
                    key={day}
                    className="rounded-lg border bg-muted/20 p-3 flex flex-col gap-2"
                    data-testid={`day-panel-${day.toLowerCase()}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">{day}</span>
                      <Badge
                        variant="secondary"
                        className="text-xs"
                        data-testid={`day-count-${day.toLowerCase()}`}
                      >
                        {entries.length}
                      </Badge>
                    </div>

                    {allGrouped.map(({ label, items }) => (
                      <div key={label ?? "weekly"}>
                        {label && (
                          <span
                            className={`text-xs font-medium ${label === "Week A" ? "text-blue-600 dark:text-blue-400" : "text-purple-600 dark:text-purple-400"}`}
                          >
                            {label}
                          </span>
                        )}
                        <div className="space-y-1 mt-0.5">
                          {items.map((e) => (
                            <div
                              key={e.rowIndex}
                              className="flex items-center gap-1.5"
                              data-testid={`day-panel-row-${e.rowIndex}`}
                            >
                              <span className="text-xs text-muted-foreground flex-1 truncate min-w-0">
                                {e.name}
                              </span>
                              <Select
                                value={localOverrides[e.rowIndex] ?? day}
                                onValueChange={(val) => handleReassign(e.rowIndex, val)}
                              >
                                <SelectTrigger
                                  className="h-5 text-xs w-24 shrink-0"
                                  data-testid={`select-day-${e.rowIndex}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {[...WEEK_DAYS, "Saturday", "Sunday", "Unassigned"].map((d) => (
                                    <SelectItem key={d} value={d} className="text-xs">
                                      {d}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
          </div>
        ) : !showMap ? (
          <div className="p-4 rounded-md bg-amber-50 dark:bg-amber-950/30 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 inline mr-1.5" />
            No service day data found in your CSV. All customers will be placed in the Unassigned
            bucket for resolver review.
          </div>
        ) : null}

        {/* Unassigned bucket with per-customer day selects */}
        {!showMap && unassigned.length > 0 && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                Unassigned ({unassigned.length}) — assign a day or leave for resolver
              </span>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {unassigned.map((e) => (
                <div
                  key={e.rowIndex}
                  className="flex items-center gap-2"
                  data-testid={`unassigned-row-${e.rowIndex}`}
                >
                  <span className="text-xs text-muted-foreground flex-1 truncate">{e.name}</span>
                  <Select
                    value={localOverrides[e.rowIndex] || ""}
                    onValueChange={(val) => handleReassign(e.rowIndex, val)}
                  >
                    <SelectTrigger
                      className="h-6 text-xs w-32"
                      data-testid={`select-day-${e.rowIndex}`}
                    >
                      <SelectValue placeholder="Assign day…" />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEK_DAYS.map((d) => (
                        <SelectItem key={d} value={d} className="text-xs">
                          {d}
                        </SelectItem>
                      ))}
                      <SelectItem value="Saturday" className="text-xs">
                        Saturday
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Suspicious address flags */}
        {suspiciousRows.length > 0 && (
          <div
            className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 p-3 space-y-2"
            data-testid="suspicious-addresses-panel"
          >
            <button
              type="button"
              className="w-full flex items-center justify-between text-left"
              onClick={() => setShowSuspiciousPanel((p) => !p)}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                <span className="text-xs font-semibold text-red-700 dark:text-red-300">
                  {suspiciousRows.length} address
                  {suspiciousRows.length !== 1 ? "es" : ""} more than {SUSPICIOUS_MILES} miles from
                  your service area — may be typos
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {showSuspiciousPanel ? "▲" : "▼"}
              </span>
            </button>
            {showSuspiciousPanel && (
              <div className="space-y-3 pt-1">
                {suspiciousRows.map((r) => {
                  const t = r.transformed as Record<string, unknown>;
                  const edit = addressEdits[r.rowIndex] || {};
                  return (
                    <div
                      key={r.rowIndex}
                      className="space-y-1.5 border-t border-red-200 dark:border-red-800 pt-2"
                      data-testid={`suspicious-row-${r.rowIndex}`}
                    >
                      <p className="text-xs font-medium text-foreground">{getRowName(r)}</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input
                          className="h-7 text-xs col-span-2"
                          placeholder="Street address"
                          defaultValue={edit.streetAddress ?? ((t.streetAddress as string) || "")}
                          onBlur={(e) => {
                            const newVal = e.target.value;
                            setAddressEdits((prev) => ({
                              ...prev,
                              [r.rowIndex]: { ...(prev[r.rowIndex] || {}), streetAddress: newVal },
                            }));
                            onAddressOverride?.(r.rowIndex, "streetAddress", newVal);
                          }}
                          data-testid={`input-fix-address-${r.rowIndex}`}
                        />
                        <Input
                          className="h-7 text-xs"
                          placeholder="City"
                          defaultValue={edit.city ?? ((t.city as string) || "")}
                          onBlur={(e) => {
                            const newVal = e.target.value;
                            setAddressEdits((prev) => ({
                              ...prev,
                              [r.rowIndex]: { ...(prev[r.rowIndex] || {}), city: newVal },
                            }));
                            onAddressOverride?.(r.rowIndex, "city", newVal);
                          }}
                          data-testid={`input-fix-city-${r.rowIndex}`}
                        />
                        <div className="flex gap-1">
                          <Input
                            className="h-7 text-xs w-16"
                            placeholder="ST"
                            defaultValue={edit.state ?? ((t.state as string) || "")}
                            onBlur={(e) => {
                              const newVal = e.target.value;
                              setAddressEdits((prev) => ({
                                ...prev,
                                [r.rowIndex]: { ...(prev[r.rowIndex] || {}), state: newVal },
                              }));
                              onAddressOverride?.(r.rowIndex, "state", newVal);
                            }}
                            data-testid={`input-fix-state-${r.rowIndex}`}
                          />
                          <Input
                            className="h-7 text-xs flex-1"
                            placeholder="ZIP"
                            defaultValue={edit.zipCode ?? ((t.zipCode as string) || "")}
                            onBlur={(e) => {
                              const newVal = e.target.value;
                              setAddressEdits((prev) => ({
                                ...prev,
                                [r.rowIndex]: { ...(prev[r.rowIndex] || {}), zipCode: newVal },
                              }));
                              onAddressOverride?.(r.rowIndex, "zipCode", newVal);
                            }}
                            data-testid={`input-fix-zip-${r.rowIndex}`}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="p-3 rounded-md bg-muted/50 border border-border text-xs text-muted-foreground">
          <Info className="w-3.5 h-3.5 inline mr-1 mb-0.5" />
          {modeNote}
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" onClick={onBack} data-testid="button-back-day-preview">
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <Button onClick={onNext} data-testid="button-to-confirm">
            Continue to Confirm
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Main ImportWizard

export function ImportWizard({
  targetSchema,
  onComplete,
  onCancel,
  initialPlatform,
  preloadedMappings,
}: ImportWizardProps) {
  // Step 0=checklist, 1=upload, 2=map, 3=review, 4=route assignment (→ navigate to resolve page)
  const [step, setStep] = useState(preloadedMappings ? 2 : 0);
  const [, navigate] = useLocation();

  const [wizardAnswers, setWizardAnswers] = useState<WizardAnswers>({
    sourceSystem: initialPlatform ?? null,
    hasExport: null,
    knowsNextServiceDate: null,
    knowsServiceDays: null,
    knowsFrequency: null,
    routePreference: null,
  });

  // CSV data
  const [csvHeaders, setCsvHeaders] = useState<string[]>(preloadedMappings?.headers ?? []);
  const [csvRows, setCsvRows] = useState<string[][]>(preloadedMappings?.rows ?? []);
  const [fileName, setFileName] = useState(preloadedMappings?.fileName ?? "");

  // Mapping state
  const [mappingResult, setMappingResult] = useState<MappingResult | null>(
    preloadedMappings?.mappingResult ?? null
  );
  const [userMappings, setUserMappings] = useState<Record<string, string>>(
    preloadedMappings?.initialMappings ?? {}
  );
  const [userTransforms, setUserTransforms] = useState<TransformSuggestion[]>(
    preloadedMappings?.transformations ?? []
  );

  // Review state
  const [previewRows, setPreviewRows] = useState<TransformedRow[]>([]);
  const [skippedRows, setSkippedRows] = useState<Set<number>>(new Set());
  const [editedCells, setEditedCells] = useState<Record<string, string>>({});
  const [editingCell, setEditingCell] = useState<string | null>(null);

  // Import state — jobId tracked for non-contacts fallback path
  const [_activeJobId, setActiveJobId] = useState<string | null>(null);

  // Geocoded positions for the route-day-preview map (populated when entering step 5)
  const [geocodedPositions, setGeocodedPositions] = useState<
    Record<number, { lat: number; lng: number }>
  >({});

  // Per-row sequence counter for single-row re-geocode calls — latest-wins guard against races
  const regeocodeSeqRef = useRef<Record<number, number>>({});
  const regeocodeDebounceRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const regeocodePendingRef = useRef<
    Record<
      number,
      {
        rowIndex: number;
        streetAddress: string | null;
        city: string | null;
        state: string | null;
        zipCode: string | null;
        _seq: number;
      }
    >
  >({});

  const targetFields = SCHEMA_FIELDS[targetSchema] || [];

  // Clear any pending debounce timers when the component unmounts to prevent
  // stale geocode requests from firing after navigation away from the wizard.
  useEffect(() => {
    return () => {
      for (const id of Object.values(regeocodeDebounceRef.current)) {
        clearTimeout(id);
      }
    };
  }, []);

  // ── Mutations ──

  const aiMapMutation = useMutation({
    mutationFn: async (data: {
      headers: string[];
      sampleRows: string[][];
      targetSchema: string;
    }) => {
      const res = await apiRequest("POST", "/api/imports/ai-map", data);
      return res.json() as Promise<MappingResult>;
    },
    onSuccess: (result) => {
      setMappingResult(result);
      const initialMappings: Record<string, string> = {};
      for (const m of result.mappings) {
        initialMappings[m.internalField] = m.csvColumn;
      }
      setUserMappings(initialMappings);
      setUserTransforms(result.transformations);
      setStep(2);
    },
  });

  const geocodePreviewMutation = useMutation({
    mutationFn: async (
      addresses: Array<{
        rowIndex: number;
        streetAddress?: string | null;
        city?: string | null;
        state?: string | null;
        zipCode?: string | null;
      }>
    ) => {
      const res = await apiRequest("POST", "/api/imports/geocode-preview", { addresses });
      return res.json() as Promise<{
        results: Array<{ rowIndex: number; latitude: number | null; longitude: number | null }>;
      }>;
    },
    onSuccess: (data) => {
      const positions: Record<number, { lat: number; lng: number }> = {};
      for (const r of data.results) {
        if (r.latitude != null && r.longitude != null) {
          positions[r.rowIndex] = { lat: r.latitude, lng: r.longitude };
        }
      }
      setGeocodedPositions(positions);
    },
  });

  // Single-row re-geocode after suspicious-address correction — merges into existing positions.
  // _seq is a per-row monotonic counter; onSuccess discards results from stale requests so that
  // rapid multi-field edits never let an older response overwrite a newer one.
  const regeocodeRowMutation = useMutation({
    mutationFn: async (
      addresses: Array<{
        rowIndex: number;
        streetAddress?: string | null;
        city?: string | null;
        state?: string | null;
        zipCode?: string | null;
        _seq?: number;
      }>
    ) => {
      const res = await apiRequest("POST", "/api/imports/geocode-preview", {
        addresses: addresses.map(({ _seq: _s, ...a }) => a),
      });
      return res.json() as Promise<{
        results: Array<{ rowIndex: number; latitude: number | null; longitude: number | null }>;
      }>;
    },
    onSuccess: (data, variables) => {
      setGeocodedPositions((prev) => {
        const next = { ...prev };
        for (let i = 0; i < data.results.length; i++) {
          const r = data.results[i];
          const sentSeq = variables[i]?._seq;
          const currentSeq = regeocodeSeqRef.current[r.rowIndex];
          if (sentSeq !== undefined && sentSeq !== currentSeq) continue;
          if (r.latitude != null && r.longitude != null) {
            next[r.rowIndex] = { lat: r.latitude, lng: r.longitude };
          } else {
            delete next[r.rowIndex];
          }
        }
        return next;
      });
    },
  });

  const previewMutation = useMutation({
    mutationFn: async (data: {
      headers: string[];
      rows: string[][];
      mappings: Array<{ csvColumn: string; internalField: string }>;
      transformations: TransformSuggestion[];
      targetSchema: string;
    }) => {
      const res = await apiRequest("POST", "/api/imports/preview", data);
      return res.json() as Promise<{ rows: TransformedRow[] }>;
    },
    onSuccess: (result) => {
      setPreviewRows(result.rows);
      setSkippedRows(new Set());
      setEditedCells({});
      setStep(3);
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (data: {
      headers: string[];
      rows: string[][];
      mappings: Array<{ csvColumn: string; internalField: string }>;
      transformations: TransformSuggestion[];
      targetSchema: string;
      skippedRows: number[];
      editedCells: Record<string, string>;
      routePreference?: RoutePreference | null;
      platform?: SourceSystem | null;
      knowsNextServiceDate?: boolean | null;
    }) => {
      const res = await apiRequest("POST", "/api/imports/apply", data);
      return res.json() as Promise<{ jobId: string; batchId?: string; totalRows: number }>;
    },
    onSuccess: (result) => {
      setActiveJobId(result.jobId);
      if (result.batchId) {
        // Navigate to the staging resolver — Import Health Score + missing logic review + commit
        navigate(`/import/${result.batchId}/resolve`);
      } else {
        // Non-contacts schemas (invoices, routes) don't create a batch — fall back to onComplete
        const importResult: ImportResult = {
          importRunId: result.jobId,
          totalRows: result.totalRows,
          importedRows: result.totalRows,
          skippedRows: 0,
          errors: [],
        };
        onComplete(importResult);
      }
    },
  });

  // ── Helpers ──

  const handleFileReady = useCallback(
    (text: string, name: string) => {
      setFileName(name);
      const { headers, rows } = parseCSVClient(text);
      setCsvHeaders(headers);
      setCsvRows(rows);
      // Reset all prior mapping, preview, and geocoded state so a re-upload never shows stale data
      setMappingResult(null);
      setUserMappings({});
      setUserTransforms([]);
      setPreviewRows([]);
      setSkippedRows(new Set());
      setEditedCells({});
      setGeocodedPositions({});
      aiMapMutation.mutate({
        headers,
        sampleRows: rows.slice(0, 25),
        targetSchema,
      });
      setStep(2); // will be overridden by onSuccess, but prevents brief blank state
    },
    [targetSchema]
  );

  const getMappingsArray = () =>
    Object.entries(userMappings)
      .filter(([, csvCol]) => csvCol && csvCol !== "__unmapped__")
      .map(([internalField, csvColumn]) => ({ csvColumn, internalField }));

  const goToPreview = () => {
    previewMutation.mutate({
      headers: csvHeaders,
      rows: csvRows,
      mappings: getMappingsArray(),
      transformations: userTransforms,
      targetSchema,
    });
  };

  const handleImport = () => {
    applyMutation.mutate({
      headers: csvHeaders,
      rows: csvRows,
      mappings: getMappingsArray(),
      transformations: userTransforms,
      targetSchema,
      skippedRows: Array.from(skippedRows),
      editedCells,
      routePreference: wizardAnswers.routePreference,
      platform: wizardAnswers.sourceSystem,
      knowsNextServiceDate: wizardAnswers.knowsNextServiceDate,
    });
  };

  const getMappingForField = (fieldName: string): FieldMapping | undefined =>
    mappingResult?.mappings.find((m) => m.internalField === fieldName);

  const addTransform = (field: string, type: string) => {
    if (userTransforms.some((t) => t.field === field && t.type === type)) return;
    setUserTransforms([...userTransforms, { field, type }]);
  };

  const removeTransform = (field: string, type: string) => {
    setUserTransforms(userTransforms.filter((t) => !(t.field === field && t.type === type)));
  };

  const toggleSkipRow = (rowIndex: number) => {
    const next = new Set(skippedRows);
    if (next.has(rowIndex)) next.delete(rowIndex);
    else next.add(rowIndex);
    setSkippedRows(next);
  };

  const handleCellEdit = (rowIndex: number, field: string, value: string) => {
    setEditedCells({ ...editedCells, [`${rowIndex}:${field}`]: value });
  };

  const applyBulkFix = (fixType: string) => {
    const updated = { ...editedCells };
    for (const row of previewRows) {
      if (skippedRows.has(row.rowIndex)) continue;
      for (const err of row.errors) {
        if (fixType === "trim" && err.message.includes("trim")) {
          updated[`${row.rowIndex}:${err.field}`] = err.value.trim();
        }
        if (fixType === "normalize_phone" && err.field === "phone") {
          const digits = err.value.replace(/\D/g, "");
          updated[`${row.rowIndex}:${err.field}`] = digits.length === 10 ? `+1${digits}` : digits;
        }
      }
    }
    setEditedCells(updated);
  };

  const validCount = previewRows.filter((r) => r.isValid && !skippedRows.has(r.rowIndex)).length;
  const invalidCount = previewRows.filter((r) => !r.isValid && !skippedRows.has(r.rowIndex)).length;
  const skippedCount = skippedRows.size;
  // Rows that pass validation but have missing service fields (no day or frequency)
  const needsServiceSetupCount = previewRows.filter((r) => {
    if (skippedRows.has(r.rowIndex)) return false;
    const t = r.transformed as Record<string, unknown>;
    return !t.serviceDay || !t.serviceFrequency;
  }).length;

  // ── Render ──

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto" data-testid="import-wizard">
      <TwoLayerProgress step={step} />

      {/* Step 0: Migration Checklist */}
      {step === 0 && (
        <MigrationChecklist
          answers={wizardAnswers}
          onChange={(patch) => setWizardAnswers((prev) => ({ ...prev, ...patch }))}
          onNext={() => setStep(1)}
          onCancel={onCancel}
        />
      )}

      {/* Step 1: Upload */}
      {step === 1 && (
        <UploadScreen
          answers={wizardAnswers}
          onFileReady={handleFileReady}
          onBack={() => setStep(0)}
          isAnalyzing={aiMapMutation.isPending}
          hasError={aiMapMutation.isError}
        />
      )}

      {/* Step 2: Map Fields — loading state while AI mapping runs */}
      {step === 2 && !mappingResult && aiMapMutation.isPending && (
        <Card data-testid="step-map-loading">
          <CardContent className="pt-10 pb-10 flex flex-col items-center gap-4 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <div>
              <p className="font-medium">Analyzing your CSV with AI…</p>
              <p className="text-sm text-muted-foreground mt-1">
                Mapping columns to ScooPilot fields. This usually takes 5–10 seconds.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && !mappingResult && aiMapMutation.isError && (
        <Card data-testid="step-map-error">
          <CardContent className="pt-10 pb-10 flex flex-col items-center gap-4 text-center">
            <XCircle className="w-8 h-8 text-destructive" />
            <div>
              <p className="font-medium">Column analysis failed</p>
              <p className="text-sm text-muted-foreground mt-1">
                {aiMapMutation.error instanceof Error
                  ? aiMapMutation.error.message
                  : "Could not analyze your CSV columns. Check your connection and try again."}
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="ghost"
                onClick={() => setStep(1)}
                data-testid="button-back-from-map-error"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
              <Button
                onClick={() =>
                  aiMapMutation.mutate({
                    headers: csvHeaders,
                    sampleRows: csvRows.slice(0, 25),
                    targetSchema,
                  })
                }
                data-testid="button-retry-map"
              >
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Map Fields */}
      {step === 2 && mappingResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              Layer 1 — Review &amp; Map Fields
            </CardTitle>
            <CardDescription>
              Columns from <strong>{fileName}</strong> have been matched to ScooPilot fields. Review
              each mapping and adjust if needed. Add transforms to clean up messy data before it's
              imported.
              {mappingResult.warnings.length > 0 && (
                <span className="block mt-1 text-yellow-600 dark:text-yellow-400">
                  {mappingResult.warnings.length} warning(s) detected
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Transform explainer — collapsible */}
            <TransformExplainer />

            <div className="space-y-3">
              {targetFields.map((tf) => {
                const aiMapping = getMappingForField(tf.field);
                const currentCsvCol = userMappings[tf.field];
                const fieldTransforms = userTransforms.filter((t) => t.field === tf.field);
                const needsManual = aiMapping && aiMapping.confidence < 0.75;
                const needsWarning = tf.sensitive && aiMapping && aiMapping.confidence < 0.9;

                return (
                  <div
                    key={tf.field}
                    className={`flex flex-wrap items-start gap-3 p-3 rounded-md border ${
                      needsManual
                        ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30"
                        : "border-border"
                    }`}
                    data-testid={`field-row-${tf.field}`}
                  >
                    <div className="flex-1 min-w-[180px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{tf.label}</span>
                        {tf.required && (
                          <Badge variant="secondary" className="text-xs">
                            Required
                          </Badge>
                        )}
                        {needsWarning && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Sensitive field with moderate confidence. Please verify.</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {needsManual && (
                          <Badge
                            variant="outline"
                            className="bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800 text-xs"
                          >
                            Manual selection needed
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <Select
                        value={currentCsvCol || "__unmapped__"}
                        onValueChange={(val) =>
                          setUserMappings({ ...userMappings, [tf.field]: val })
                        }
                      >
                        <SelectTrigger
                          className="w-[200px]"
                          data-testid={`select-mapping-${tf.field}`}
                        >
                          <SelectValue placeholder="Select column..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__unmapped__">-- Not mapped --</SelectItem>
                          {csvHeaders.map((h) => (
                            <SelectItem key={h} value={h}>
                              {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {aiMapping && (
                        <div className="flex items-center gap-1.5">
                          <ConfidenceBadge confidence={aiMapping.confidence} />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[250px]">
                              <p className="text-xs">{aiMapping.reason}</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      )}
                    </div>

                    <div className="w-full flex items-center gap-1.5 flex-wrap">
                      {fieldTransforms.map((t) => (
                        <Badge
                          key={`${t.field}-${t.type}`}
                          variant="outline"
                          className="gap-1 text-xs"
                          data-testid={`badge-transform-${t.field}-${t.type}`}
                        >
                          {TRANSFORM_OPTIONS.find((o) => o.type === t.type)?.label || t.type}
                          <button
                            onClick={() => removeTransform(t.field, t.type)}
                            className="ml-1 hover:text-destructive"
                            data-testid={`button-remove-transform-${t.field}-${t.type}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))}
                      {TRANSFORM_OPTIONS.filter(
                        (o) => !fieldTransforms.some((ft) => ft.type === o.type)
                      ).length > 0 && (
                        <Select onValueChange={(val) => addTransform(tf.field, val)} value="">
                          <SelectTrigger
                            className="w-[160px]"
                            data-testid={`select-add-transform-${tf.field}`}
                          >
                            <SelectValue placeholder="Add transform..." />
                          </SelectTrigger>
                          <SelectContent>
                            {TRANSFORM_OPTIONS.filter(
                              (o) => !fieldTransforms.some((ft) => ft.type === o.type)
                            ).map((o) => (
                              <SelectItem key={o.type} value={o.type}>
                                <span className="flex items-center gap-1.5">
                                  <o.icon className="w-3.5 h-3.5" />
                                  {o.label}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {mappingResult.warnings.length > 0 && (
              <div className="mt-4 p-3 rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  Warnings
                </p>
                <ul className="mt-1.5 text-sm text-yellow-700 dark:text-yellow-400 list-disc list-inside">
                  {mappingResult.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-between mt-6">
              <Button variant="ghost" onClick={() => setStep(1)} data-testid="button-back-mapping">
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
              <Button
                onClick={goToPreview}
                disabled={previewMutation.isPending}
                data-testid="button-preview"
              >
                {previewMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Preview Rows
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Review Rows */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Layer 1 — Review Rows</CardTitle>
            <CardDescription>
              Showing first {Math.min(50, previewRows.length)} rows. Edit invalid cells or skip rows
              before proceeding to service logic setup.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-1.5 text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span data-testid="text-valid-count">{validCount} valid</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                <span data-testid="text-invalid-count">{invalidCount} invalid</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <SkipForward className="w-4 h-4 text-muted-foreground" />
                <span data-testid="text-skipped-count">{skippedCount} skipped</span>
              </div>
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => applyBulkFix("trim")}
                data-testid="button-fix-trim"
              >
                <Scissors className="w-3.5 h-3.5 mr-1.5" />
                Trim All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => applyBulkFix("normalize_phone")}
                data-testid="button-fix-phone"
              >
                <Phone className="w-3.5 h-3.5 mr-1.5" />
                Fix Phones
              </Button>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">Skip</TableHead>
                    <TableHead className="w-[50px]">#</TableHead>
                    {getMappingsArray().map((m) => (
                      <TableHead key={m.internalField}>{m.internalField}</TableHead>
                    ))}
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.slice(0, 50).map((row) => {
                    const isSkipped = skippedRows.has(row.rowIndex);
                    return (
                      <TableRow
                        key={row.rowIndex}
                        className={isSkipped ? "opacity-40" : ""}
                        data-testid={`row-preview-${row.rowIndex}`}
                      >
                        <TableCell>
                          <Checkbox
                            checked={isSkipped}
                            onCheckedChange={() => toggleSkipRow(row.rowIndex)}
                            data-testid={`checkbox-skip-${row.rowIndex}`}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {row.rowIndex + 1}
                        </TableCell>
                        {getMappingsArray().map((m) => {
                          const cellKey = `${row.rowIndex}:${m.internalField}`;
                          const hasError = row.errors.some((e) => e.field === m.internalField);
                          const editedValue = editedCells[cellKey];
                          const displayValue =
                            editedValue !== undefined
                              ? editedValue
                              : String(row.transformed[m.internalField] ?? "");
                          const isEditing = editingCell === cellKey;

                          return (
                            <TableCell
                              key={m.internalField}
                              className={
                                hasError && editedValue === undefined
                                  ? "bg-red-50 dark:bg-red-950/40"
                                  : ""
                              }
                            >
                              {isEditing ? (
                                <Input
                                  autoFocus
                                  defaultValue={displayValue}
                                  onBlur={(e) => {
                                    handleCellEdit(row.rowIndex, m.internalField, e.target.value);
                                    setEditingCell(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      handleCellEdit(
                                        row.rowIndex,
                                        m.internalField,
                                        (e.target as HTMLInputElement).value
                                      );
                                      setEditingCell(null);
                                    }
                                    if (e.key === "Escape") {
                                      setEditingCell(null);
                                    }
                                  }}
                                  className="h-7 text-xs"
                                  data-testid={`input-cell-${row.rowIndex}-${m.internalField}`}
                                />
                              ) : (
                                <div
                                  className="cursor-pointer text-xs truncate max-w-[150px]"
                                  onClick={() => setEditingCell(cellKey)}
                                  title={displayValue}
                                  data-testid={`cell-${row.rowIndex}-${m.internalField}`}
                                >
                                  {displayValue || (
                                    <span className="text-muted-foreground italic">empty</span>
                                  )}
                                  {hasError && editedValue === undefined && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span>
                                          <AlertTriangle className="w-3 h-3 text-red-500 inline ml-1" />
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p className="text-xs">
                                          {
                                            row.errors.find((e) => e.field === m.internalField)
                                              ?.message
                                          }
                                        </p>
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                              )}
                            </TableCell>
                          );
                        })}
                        <TableCell>
                          {isSkipped ? (
                            <Badge variant="secondary" className="text-xs">
                              Skipped
                            </Badge>
                          ) : row.isValid ? (
                            <Badge
                              variant="outline"
                              className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800 text-xs"
                            >
                              Valid
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800 text-xs"
                            >
                              {row.errors.length} error(s)
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between mt-6">
              <Button variant="ghost" onClick={() => setStep(2)} data-testid="button-back-review">
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
              <Button
                onClick={() => setStep(4)}
                disabled={validCount === 0}
                data-testid="button-to-layer2"
              >
                Continue to Service Logic
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Route Assignment Mode */}
      {step === 4 && (
        <RouteAssignmentStep
          routePreference={wizardAnswers.routePreference}
          onChange={(pref) => setWizardAnswers((prev) => ({ ...prev, routePreference: pref }))}
          onNext={() => {
            // Trigger batch geocode for map preview before entering step 5
            const addressInputs = previewRows
              .filter((r) => !skippedRows.has(r.rowIndex))
              .slice(0, 200)
              .map((r) => {
                const t = r.transformed as Record<string, unknown>;
                return {
                  rowIndex: r.rowIndex,
                  streetAddress: (t.streetAddress as string | null) || null,
                  city: (t.city as string | null) || null,
                  state: (t.state as string | null) || null,
                  zipCode: (t.zipCode as string | null) || null,
                };
              });
            if (addressInputs.some((a) => a.streetAddress)) {
              geocodePreviewMutation.mutate(addressInputs);
            }
            setStep(5);
          }}
          onBack={() => setStep(3)}
        />
      )}

      {/* Step 5: Route Day Distribution Preview */}
      {step === 5 && (
        <RouteDayPreviewStep
          previewRows={previewRows}
          skippedRows={skippedRows}
          routePreference={wizardAnswers.routePreference}
          geocodedPositions={geocodedPositions}
          onNext={() => setStep(6)}
          onBack={() => setStep(4)}
          onDayOverride={(rowIndex, newDay) =>
            setEditedCells((prev) => ({ ...prev, [`${rowIndex}:serviceDay`]: newDay }))
          }
          onAddressOverride={(rowIndex, field, value) => {
            setEditedCells((prev) => {
              const updated = { ...prev, [`${rowIndex}:${field}`]: value };
              // Assemble the full address from the preview row + all overrides so far + this change
              const row = previewRows.find((r) => r.rowIndex === rowIndex);
              if (row) {
                const t = row.transformed as Record<string, unknown>;
                const get = (f: string) =>
                  f === field ? value : (updated[`${rowIndex}:${f}`] ?? (t[f] as string) ?? null);
                // Increment the per-row sequence so that if an older response arrives after a
                // newer one it will be discarded by regeocodeRowMutation.onSuccess.
                const seq = (regeocodeSeqRef.current[rowIndex] ?? 0) + 1;
                regeocodeSeqRef.current[rowIndex] = seq;
                // Store the latest complete address so the debounced timer always uses it.
                regeocodePendingRef.current[rowIndex] = {
                  rowIndex,
                  streetAddress: get("streetAddress"),
                  city: get("city"),
                  state: get("state"),
                  zipCode: get("zipCode"),
                  _seq: seq,
                };
                // Clear stale position immediately so the map shows it's being refreshed.
                setGeocodedPositions((pos) => {
                  const next = { ...pos };
                  delete next[rowIndex];
                  return next;
                });
                // Debounce: cancel any pending timer for this row and schedule a new one so
                // that tabbing through all four fields only fires a single geocode request
                // 300 ms after the last field edit settles.
                if (regeocodeDebounceRef.current[rowIndex] !== undefined) {
                  clearTimeout(regeocodeDebounceRef.current[rowIndex]);
                }
                regeocodeDebounceRef.current[rowIndex] = setTimeout(() => {
                  delete regeocodeDebounceRef.current[rowIndex];
                  const pending = regeocodePendingRef.current[rowIndex];
                  if (pending) {
                    delete regeocodePendingRef.current[rowIndex];
                    regeocodeRowMutation.mutate([pending]);
                  }
                }, 300);
              }
              return updated;
            });
          }}
        />
      )}

      {/* Step 6: Final Confirmation & Stage */}
      {step === 6 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              Ready to stage — review before you go
            </CardTitle>
            <CardDescription>
              Nothing is saved to your CRM yet. Staging creates a draft that you can review, fix,
              and then commit. You'll land on the Review page where you can fill in any missing
              service details before going live.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Summary grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-4 rounded-md bg-muted">
                  <p className="text-2xl font-bold" data-testid="text-total-rows">
                    {csvRows.length}
                  </p>
                  <p className="text-sm text-muted-foreground">Contacts in File</p>
                </div>
                <div className="p-4 rounded-md bg-green-50 dark:bg-green-950/30">
                  <p
                    className="text-2xl font-bold text-green-700 dark:text-green-300"
                    data-testid="text-import-valid"
                  >
                    {validCount}
                  </p>
                  <p className="text-sm text-muted-foreground">Ready to Import</p>
                </div>
                <div className="p-4 rounded-md bg-amber-50 dark:bg-amber-950/30">
                  <p
                    className="text-2xl font-bold text-amber-700 dark:text-amber-300"
                    data-testid="text-import-invalid"
                  >
                    {invalidCount}
                  </p>
                  <p className="text-sm text-muted-foreground">Need Review</p>
                </div>
                <div className="p-4 rounded-md bg-muted">
                  <p
                    className="text-2xl font-bold text-muted-foreground"
                    data-testid="text-import-skipped"
                  >
                    {skippedCount}
                  </p>
                  <p className="text-sm text-muted-foreground">Skipped</p>
                </div>
              </div>

              {/* What will be staged */}
              <div className="p-4 rounded-md border space-y-2">
                <p className="text-sm font-semibold">What will be created / staged:</p>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-green-600" />
                    <span>
                      <strong className="text-foreground">
                        {validCount + invalidCount - skippedCount < 0
                          ? 0
                          : validCount + invalidCount}
                      </strong>{" "}
                      contact
                      {validCount + invalidCount !== 1 ? "s" : ""} staged for resolver review
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-green-600" />
                    <span>
                      <strong className="text-foreground">
                        {validCount - needsServiceSetupCount > 0
                          ? validCount - needsServiceSetupCount
                          : 0}
                      </strong>{" "}
                      service plan
                      {validCount - needsServiceSetupCount !== 1 ? "s" : ""} ready to assign
                      immediately
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-green-600" />
                    <span>
                      <strong className="text-foreground">
                        {[
                          ...new Set(
                            previewRows
                              .filter((r) => !skippedRows.has(r.rowIndex))
                              .map(
                                (r) =>
                                  (r.transformed as Record<string, unknown>).serviceDay as string
                              )
                              .filter(Boolean)
                          ),
                        ].length || 1}
                      </strong>{" "}
                      route day
                      {[
                        ...new Set(
                          previewRows
                            .filter((r) => !skippedRows.has(r.rowIndex))
                            .map(
                              (r) => (r.transformed as Record<string, unknown>).serviceDay as string
                            )
                            .filter(Boolean)
                        ),
                      ].length !== 1
                        ? "s"
                        : ""}{" "}
                      impacted
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-green-600" />
                    <span>Billing rules assigned via AI defaults for each contact</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-green-600" />
                    <span>
                      Route mode:{" "}
                      <strong className="text-foreground">
                        {wizardAnswers.routePreference === "preserve"
                          ? "Preserve existing service days"
                          : wizardAnswers.routePreference === "rebuild"
                            ? "Rebuild with optimized routing"
                            : "Hybrid — keep present, review absent"}
                      </strong>
                    </span>
                  </li>
                  {needsServiceSetupCount > 0 && (
                    <li className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>
                        <strong>{needsServiceSetupCount}</strong> contact
                        {needsServiceSetupCount > 1 ? "s" : ""} missing service day or frequency —
                        resolver will apply AI suggestions
                      </span>
                    </li>
                  )}
                  {invalidCount > 0 && (
                    <li className="flex items-center gap-2 text-destructive">
                      <XCircle className="w-3.5 h-3.5" />
                      <span>
                        <strong>{invalidCount}</strong> contact
                        {invalidCount > 1 ? "s" : ""} with validation errors — held for resolver
                        review
                      </span>
                    </li>
                  )}
                  {wizardAnswers.knowsNextServiceDate === true && (
                    <li className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                      <Info className="w-3.5 h-3.5" />
                      <span>
                        Next service date confirmed known — AI suggestions will have boosted
                        confidence
                      </span>
                    </li>
                  )}
                </ul>
              </div>

              {applyMutation.isError && (
                <div
                  className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2"
                  data-testid="text-import-error"
                >
                  <XCircle className="w-4 h-4 flex-shrink-0" />
                  Staging failed. Please try again.
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setStep(5)}
                  data-testid="button-back-confirm"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={applyMutation.isPending || validCount === 0}
                  data-testid="button-stage-import"
                >
                  {applyMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {applyMutation.isPending ? "Staging Import…" : `Stage ${validCount} Contacts`}
                  {!applyMutation.isPending && <ChevronRight className="w-4 h-4 ml-1" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
