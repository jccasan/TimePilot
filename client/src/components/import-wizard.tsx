import { useState, useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { ImportJobProgress } from "@/components/import-job-progress";
import type { ImportJobStatus } from "@/components/import-job-progress";
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
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
} from "lucide-react";

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

interface ImportWizardProps {
  targetSchema: "contacts" | "invoices" | "routes";
  onComplete: (result: ImportResult) => void;
  onCancel: () => void;
}

const SCHEMA_FIELDS: Record<string, { field: string; label: string; required: boolean; sensitive: boolean }[]> = {
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
        } else {
          current += char;
        }
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence > 0.9) {
    return (
      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800" data-testid="badge-confidence-high">
        {Math.round(confidence * 100)}%
      </Badge>
    );
  }
  if (confidence >= 0.75) {
    return (
      <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800" data-testid="badge-confidence-medium">
        {Math.round(confidence * 100)}%
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800" data-testid="badge-confidence-low">
      {Math.round(confidence * 100)}%
    </Badge>
  );
}

export function ImportWizard({ targetSchema, onComplete, onCancel }: ImportWizardProps) {
  const [step, setStep] = useState(1);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState("");
  const [mappingResult, setMappingResult] = useState<MappingResult | null>(null);
  const [userMappings, setUserMappings] = useState<Record<string, string>>({});
  const [userTransforms, setUserTransforms] = useState<TransformSuggestion[]>([]);
  const [previewRows, setPreviewRows] = useState<TransformedRow[]>([]);
  const [skippedRows, setSkippedRows] = useState<Set<number>>(new Set());
  const [editedCells, setEditedCells] = useState<Record<string, string>>({});
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const targetFields = SCHEMA_FIELDS[targetSchema] || [];

  const aiMapMutation = useMutation({
    mutationFn: async (data: { headers: string[]; sampleRows: string[][]; targetSchema: string }) => {
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
    }) => {
      const res = await apiRequest("POST", "/api/imports/apply", data);
      return res.json() as Promise<{ jobId: string; totalRows: number }>;
    },
    onSuccess: (result) => {
      setActiveJobId(result.jobId);
    },
  });

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.name.endsWith(".csv")) return;
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const { headers, rows } = parseCSVClient(text);
        setCsvHeaders(headers);
        setCsvRows(rows);
        aiMapMutation.mutate({
          headers,
          sampleRows: rows.slice(0, 25),
          targetSchema,
        });
      };
      reader.readAsText(file);
    },
    [targetSchema]
  );

  const handleDrop = useCallback(
    (e: { preventDefault: () => void; dataTransfer: { files: FileList } }) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: { preventDefault: () => void }) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const getMappingsArray = () => {
    return Object.entries(userMappings)
      .filter(([, csvCol]) => csvCol && csvCol !== "__unmapped__")
      .map(([internalField, csvColumn]) => ({ csvColumn, internalField }));
  };

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
    });
  };

  const getMappingForField = (fieldName: string): FieldMapping | undefined => {
    return mappingResult?.mappings.find((m) => m.internalField === fieldName);
  };

  const addTransform = (field: string, type: string) => {
    if (userTransforms.some((t) => t.field === field && t.type === type)) return;
    setUserTransforms([...userTransforms, { field, type }]);
  };

  const removeTransform = (field: string, type: string) => {
    setUserTransforms(userTransforms.filter((t) => !(t.field === field && t.type === type)));
  };

  const toggleSkipRow = (rowIndex: number) => {
    const next = new Set(skippedRows);
    if (next.has(rowIndex)) {
      next.delete(rowIndex);
    } else {
      next.add(rowIndex);
    }
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

  const stepLabels = ["Upload File", "Review & Map Fields", "Review Rows", "Confirm & Import"];

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto" data-testid="import-wizard">
      <div className="flex items-center gap-2 mb-2">
        {stepLabels.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                step === i + 1
                  ? "bg-primary text-primary-foreground"
                  : step > i + 1
                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                    : "bg-muted text-muted-foreground"
              }`}
              data-testid={`step-indicator-${i + 1}`}
            >
              {step > i + 1 ? <Check className="w-3.5 h-3.5" /> : <span>{i + 1}</span>}
              <span className="hidden sm:inline">{label}</span>
            </div>
            {i < stepLabels.length - 1 && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Upload CSV File
            </CardTitle>
            <CardDescription>
              Drag and drop your CSV file or click to browse. We'll analyze the columns and suggest mappings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`border-2 border-dashed rounded-md p-12 text-center cursor-pointer transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              }`}
              onDrop={handleDrop as unknown as React.DragEventHandler}
              onDragOver={handleDragOver as unknown as React.DragEventHandler}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              data-testid="drop-zone"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                }}
                data-testid="input-file"
              />
              {aiMapMutation.isPending ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-10 h-10 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Analyzing your file with AI...</p>
                </div>
              ) : fileName ? (
                <div className="flex flex-col items-center gap-3">
                  <FileText className="w-10 h-10 text-primary" />
                  <p className="font-medium" data-testid="text-filename">{fileName}</p>
                  <p className="text-sm text-muted-foreground">
                    {csvRows.length} rows, {csvHeaders.length} columns detected
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Upload className="w-10 h-10 text-muted-foreground" />
                  <p className="font-medium">Drop your CSV file here</p>
                  <p className="text-sm text-muted-foreground">or click to browse</p>
                </div>
              )}
            </div>
            {aiMapMutation.isError && (
              <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2" data-testid="text-upload-error">
                <XCircle className="w-4 h-4 flex-shrink-0" />
                Failed to analyze file. Please try again.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 2 && mappingResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              Review & Map Fields
            </CardTitle>
            <CardDescription>
              AI has suggested column mappings below. Review and adjust as needed.
              {mappingResult.warnings.length > 0 && (
                <span className="block mt-1 text-yellow-600 dark:text-yellow-400">
                  {mappingResult.warnings.length} warning(s) detected
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                          <Badge variant="secondary" className="text-xs">Required</Badge>
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
                          <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800 text-xs">
                            Manual selection needed
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <Select
                        value={currentCsvCol || "__unmapped__"}
                        onValueChange={(val) => {
                          setUserMappings({ ...userMappings, [tf.field]: val });
                        }}
                      >
                        <SelectTrigger className="w-[200px]" data-testid={`select-mapping-${tf.field}`}>
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
                        <Select
                          onValueChange={(val) => addTransform(tf.field, val)}
                          value=""
                        >
                          <SelectTrigger className="w-[160px]" data-testid={`select-add-transform-${tf.field}`}>
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
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Review Rows</CardTitle>
            <CardDescription>
              Showing first {Math.min(50, previewRows.length)} rows. Edit invalid cells or skip rows.
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
              <Button variant="outline" size="sm" onClick={() => applyBulkFix("trim")} data-testid="button-fix-trim">
                <Scissors className="w-3.5 h-3.5 mr-1.5" />
                Trim All
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyBulkFix("normalize_phone")} data-testid="button-fix-phone">
                <Phone className="w-3.5 h-3.5 mr-1.5" />
                Fix Phones
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyBulkFix("standardize_dates")} data-testid="button-fix-dates">
                <Calendar className="w-3.5 h-3.5 mr-1.5" />
                Fix Dates
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
                        <TableCell className="text-muted-foreground text-xs">{row.rowIndex + 1}</TableCell>
                        {getMappingsArray().map((m) => {
                          const cellKey = `${row.rowIndex}:${m.internalField}`;
                          const hasError = row.errors.some((e) => e.field === m.internalField);
                          const editedValue = editedCells[cellKey];
                          const displayValue = editedValue !== undefined ? editedValue : String(row.transformed[m.internalField] ?? "");
                          const isEditing = editingCell === cellKey;

                          return (
                            <TableCell
                              key={m.internalField}
                              className={hasError && editedValue === undefined ? "bg-red-50 dark:bg-red-950/40" : ""}
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
                                      handleCellEdit(row.rowIndex, m.internalField, (e.target as HTMLInputElement).value);
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
                                  {displayValue || <span className="text-muted-foreground italic">empty</span>}
                                  {hasError && editedValue === undefined && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span>
                                          <AlertTriangle className="w-3 h-3 text-red-500 inline ml-1" />
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p className="text-xs">
                                          {row.errors.find((e) => e.field === m.internalField)?.message}
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
                            <Badge variant="secondary" className="text-xs">Skipped</Badge>
                          ) : row.isValid ? (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800 text-xs">
                              Valid
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800 text-xs">
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
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {importResult ? (
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
              ) : activeJobId ? (
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              ) : (
                <FileText className="w-5 h-5" />
              )}
              {importResult ? "Import Complete" : activeJobId ? "Importing…" : "Confirm & Import"}
            </CardTitle>
            <CardDescription>
              {importResult
                ? "Your data has been imported successfully."
                : activeJobId
                  ? "Processing in the background — you can leave this page."
                  : "Review the summary below and start the import."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!activeJobId && !importResult && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="p-4 rounded-md bg-muted">
                    <p className="text-2xl font-bold" data-testid="text-total-rows">{csvRows.length}</p>
                    <p className="text-sm text-muted-foreground">Total Rows</p>
                  </div>
                  <div className="p-4 rounded-md bg-green-50 dark:bg-green-950/30">
                    <p className="text-2xl font-bold text-green-700 dark:text-green-300" data-testid="text-import-valid">{validCount}</p>
                    <p className="text-sm text-muted-foreground">Will Import</p>
                  </div>
                  <div className="p-4 rounded-md bg-red-50 dark:bg-red-950/30">
                    <p className="text-2xl font-bold text-red-700 dark:text-red-300" data-testid="text-import-invalid">{invalidCount}</p>
                    <p className="text-sm text-muted-foreground">Invalid</p>
                  </div>
                  <div className="p-4 rounded-md bg-muted">
                    <p className="text-2xl font-bold text-muted-foreground" data-testid="text-import-skipped">{skippedCount}</p>
                    <p className="text-sm text-muted-foreground">Skipped</p>
                  </div>
                </div>

                <div className="p-4 rounded-md border">
                  <p className="text-sm font-medium mb-2">Field Mappings</p>
                  <div className="grid grid-cols-2 gap-1 text-sm">
                    {getMappingsArray().map((m) => (
                      <div key={m.internalField} className="flex items-center gap-1.5">
                        <ChevronRight className="w-3 h-3 text-muted-foreground" />
                        <span className="text-muted-foreground">{m.csvColumn}</span>
                        <span className="mx-1">→</span>
                        <span className="font-medium">{m.internalField}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {userTransforms.length > 0 && (
                  <div className="p-4 rounded-md border">
                    <p className="text-sm font-medium mb-2">Transformations</p>
                    <div className="flex flex-wrap gap-1.5">
                      {userTransforms.map((t) => (
                        <Badge key={`${t.field}-${t.type}`} variant="outline" className="text-xs">
                          {t.field}: {TRANSFORM_OPTIONS.find((o) => o.type === t.type)?.label || t.type}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {applyMutation.isError && (
                  <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2" data-testid="text-import-error">
                    <XCircle className="w-4 h-4 flex-shrink-0" />
                    Import failed. Please try again.
                  </div>
                )}
              </div>
            )}

            {activeJobId && (
              <ImportJobProgress
                jobId={activeJobId}
                label="Importing"
                onComplete={(job: ImportJobStatus) => {
                  const result: ImportResult = {
                    importRunId: job.id,
                    totalRows: job.totalRows,
                    importedRows: job.importedRows,
                    skippedRows: job.skippedRows,
                    errors: job.errors ?? [],
                  };
                  setImportResult(result);
                }}
              />
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" onClick={onCancel} data-testid="button-cancel">
          Cancel
        </Button>
        <div className="flex items-center gap-2">
          {step > 1 && step < 4 && (
            <Button variant="outline" onClick={() => setStep(step - 1)} data-testid="button-back">
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          )}
          {step === 2 && (
            <Button onClick={goToPreview} disabled={previewMutation.isPending} data-testid="button-next-preview">
              {previewMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : null}
              Preview Data
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
          {step === 3 && (
            <Button onClick={() => setStep(4)} data-testid="button-next-confirm">
              Continue
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
          {step === 4 && !activeJobId && !importResult && (
            <Button onClick={handleImport} disabled={applyMutation.isPending || validCount === 0} data-testid="button-import">
              {applyMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-1.5" />
              )}
              Import {validCount} Rows
            </Button>
          )}
          {step === 4 && importResult && (
            <Button onClick={() => onComplete(importResult)} data-testid="button-done">
              <Check className="w-4 h-4 mr-1.5" />
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
