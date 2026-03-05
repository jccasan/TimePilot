import { useState, useCallback, useRef } from "react";
import { ImportWizard } from "@/components/import-wizard";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  FileText,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Users,
  FileSpreadsheet,
  Loader2,
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

function InvoicesTab() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<ParsedInvoicePreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [includeInReminders, setIncludeInReminders] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const parseMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", "/api/migrations/sweepandgo/parse-invoices", { csvText: text });
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
      return res.json() as Promise<ImportResult>;
    },
    onSuccess: (data) => {
      setImportResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/imports"] });
      toast({ title: "Import complete", description: `${data.imported} invoices imported.` });
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast({ title: "Invalid file", description: "Please upload a CSV file.", variant: "destructive" });
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

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = (e as any).dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleFileInput = useCallback((e: any) => {
    const file = e.target?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const resetState = () => {
    setCsvText(null);
    setFileName("");
    setPreview(null);
    setImportResult(null);
  };

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
              <span className="text-sm font-medium" data-testid="text-file-name">{fileName}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={resetState} data-testid="button-reset-upload">
              Upload different file
            </Button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Invoices</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold" data-testid="text-total-invoices">{preview.summary.total}</p>
              </CardContent>
            </Card>
            {Object.entries(preview.summary.byStatus).map(([status, count]) => (
              <Card key={status}>
                <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium capitalize">{status}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold" data-testid={`text-status-${status}`}>{count}</p>
                </CardContent>
              </Card>
            ))}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Amount</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold" data-testid="text-total-amount">{formatDollars(preview.summary.totalAmount)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Paid</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold" data-testid="text-total-paid">{formatDollars(preview.summary.totalPaid)}</p>
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
                    <li key={i} data-testid={`text-error-${i}`}>Row {err.row}: {err.message}</li>
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
                    <li key={i} data-testid={`text-warning-${i}`}>{warn}</li>
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
                            <div>{inv.contactName || "—"}</div>
                            <div className="text-xs text-muted-foreground">{inv.contactEmail || ""}</div>
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
                <Label htmlFor="allow-duplicates" className="text-sm">Allow duplicates (import even if external ID already exists)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="include-reminders"
                  checked={includeInReminders}
                  onCheckedChange={(v) => setIncludeInReminders(!!v)}
                  data-testid="checkbox-include-reminders"
                />
                <Label htmlFor="include-reminders" className="text-sm">Include unpaid invoices in payment reminders</Label>
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
                        <li key={i}>Row {err.row}: {err.message}</li>
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

function ContactsTab() {
  const { toast } = useToast();
  return (
    <div className="space-y-4" data-testid="contacts-tab-content">
      <Alert>
        <Users className="h-4 w-4" />
        <AlertTitle>Contact Import</AlertTitle>
        <AlertDescription>
          Use the AI-assisted import wizard to map and import contacts from CSV files. Column mappings will be automatically suggested based on your file headers.
        </AlertDescription>
      </Alert>
      <ImportWizard
        targetSchema="contacts"
        onComplete={(result) => {
          toast({ title: "Import Complete", description: `Successfully imported ${result.imported} contacts` });
          queryClient.invalidateQueries({ queryKey: ["/api/imports"] });
        }}
        onCancel={() => {}}
      />
    </div>
  );
}

function ImportHistory() {
  const { data: imports, isLoading } = useQuery<ImportRun[]>({
    queryKey: ["/api/imports"],
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (!imports || imports.length === 0) {
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
            <TableHead>File</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Imported</TableHead>
            <TableHead className="text-right">Skipped</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {imports.map((run) => (
            <TableRow key={run.id} data-testid={`row-import-${run.id}`}>
              <TableCell>
                <Badge variant="secondary" className="text-xs">{run.type}</Badge>
              </TableCell>
              <TableCell className="text-sm">{run.fileName || "—"}</TableCell>
              <TableCell>
                <Badge
                  variant={run.status === "completed" ? "default" : run.status === "failed" ? "destructive" : "secondary"}
                  className="text-xs"
                >
                  {run.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right">{run.totalRows ?? 0}</TableCell>
              <TableCell className="text-right">{run.importedRows ?? 0}</TableCell>
              <TableCell className="text-right">{run.skippedRows ?? 0}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {run.createdAt ? new Date(run.createdAt).toLocaleDateString() : "—"}
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
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Data Migration</h1>
          <p className="text-muted-foreground mt-1" data-testid="text-page-description">
            Import your data from Sweep&Go or other sources. Upload CSV files to migrate contacts, invoices, and payment history.
          </p>
        </div>

        <Tabs defaultValue="invoices" data-testid="tabs-migration">
          <TabsList>
            <TabsTrigger value="contacts" data-testid="tab-contacts">
              <Users className="h-4 w-4 mr-1.5" />
              Contacts
            </TabsTrigger>
            <TabsTrigger value="invoices" data-testid="tab-invoices">
              <FileText className="h-4 w-4 mr-1.5" />
              Invoices
            </TabsTrigger>
          </TabsList>
          <TabsContent value="contacts" className="mt-6">
            <ContactsTab />
          </TabsContent>
          <TabsContent value="invoices" className="mt-6">
            <InvoicesTab />
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
