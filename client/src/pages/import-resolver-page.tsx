import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  EyeOff,
  Loader2,
  RefreshCw,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import type { ImportBatch, ImportRow, ImportRuleSuggestion } from "@shared/schema";

interface ResolverRow extends ImportRow {
  suggestion: ImportRuleSuggestion | null;
}

interface ResolverData {
  rows: ResolverRow[];
  grouped: {
    frequency: ResolverRow[];
    serviceDay: ResolverRow[];
    price: ResolverRow[];
    billingRule: ResolverRow[];
  };
  missingFieldCounts: {
    frequency: number;
    serviceDay: number;
    price: number;
    billingRule: number;
  };
  statusCounts: {
    needs_review: number;
    ready: number;
    ignored: number;
    imported: number;
  };
}

interface HealthData {
  batchId: string;
  status: string;
  totalRows: number;
  readyRows: number;
  needsReviewRows: number;
  ignoredRows: number;
  importedRows: number;
  health: {
    overall: number;
    categories: {
      names: number;
      addresses: number;
      contactInfo: number;
      frequency: number;
      serviceDay: number;
      price: number;
      billingRule: number;
    };
    counts: {
      missingFrequency: number;
      missingServiceDay: number;
      missingPrice: number;
      missingBillingRule: number;
    };
  };
}

const FREQUENCY_OPTIONS = ["weekly", "biweekly", "monthly", "as-needed"];
const DAY_OPTIONS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "tbd",
];
const BILLING_OPTIONS = ["per_visit", "monthly_flat", "per_dog", "custom"];

function HealthGauge({ score }: { score: number }) {
  const color =
    score >= 80
      ? "text-green-600 dark:text-green-400"
      : score >= 60
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-red-600 dark:text-red-400";
  const bg =
    score >= 80
      ? "bg-green-100 dark:bg-green-950/40"
      : score >= 60
        ? "bg-yellow-100 dark:bg-yellow-950/40"
        : "bg-red-100 dark:bg-red-950/40";

  const interpretation =
    score >= 80
      ? "Most rows are ready to commit. Review any flagged items and you're set."
      : score >= 60
        ? "Several rows need attention before committing. Use the tabs below to fix missing fields."
        : "Many rows are missing required service details. Address the issues below before committing.";

  return (
    <div className={`flex flex-col items-center justify-center rounded-xl p-6 gap-3 ${bg}`}>
      <p className={`text-5xl font-bold ${color}`} data-testid="text-health-score">
        {score}
      </p>
      <p className="text-sm text-muted-foreground">Health Score</p>
      <p
        className={`text-xs text-center leading-relaxed ${color}`}
        data-testid="text-health-interpretation"
      >
        {interpretation}
      </p>
      <div className="flex items-center gap-3 text-xs mt-1" data-testid="health-score-legend">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
          <span className="text-muted-foreground">80+ Good</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-500" />
          <span className="text-muted-foreground">60–79 Fair</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
          <span className="text-muted-foreground">&lt;60 Needs work</span>
        </span>
      </div>
    </div>
  );
}

function CategoryBar({ label, score }: { label: string; score: number }) {
  const bar = score >= 80 ? "bg-green-500" : score >= 60 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span data-testid={`pct-${label.toLowerCase().replace(/\s/g, "-")}`}>{score}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

export default function ImportResolverPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkFrequency, setBulkFrequency] = useState("");
  const [bulkDay, setBulkDay] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkBillingRule, setBulkBillingRule] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [rowEdits, setRowEdits] = useState<Record<string, Record<string, string>>>({});

  const healthQuery = useQuery<HealthData>({
    queryKey: ["/api/import-batches", batchId, "health"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/import-batches/${batchId}/health`);
      return res.json();
    },
    enabled: !!batchId,
    refetchInterval: 5000,
  });

  const resolverQuery = useQuery<ResolverData>({
    queryKey: ["/api/import-batches", batchId, "resolver", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      const res = await apiRequest("GET", `/api/import-batches/${batchId}/resolver?${params}`);
      return res.json();
    },
    enabled: !!batchId,
  });

  const batchQuery = useQuery<ImportBatch>({
    queryKey: ["/api/import-batches", batchId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/import-batches/${batchId}`);
      return res.json();
    },
    enabled: !!batchId,
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async (payload: { rowIds: string[]; updates: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/import-batches/${batchId}/rows/bulk`, payload);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `Updated ${data.updated} rows` });
      queryClient.invalidateQueries({ queryKey: ["/api/import-batches", batchId] });
      setSelectedIds(new Set());
      setBulkFrequency("");
      setBulkDay("");
      setBulkPrice("");
      setBulkBillingRule("");
    },
    onError: () => {
      toast({ title: "Failed to update rows", variant: "destructive" });
    },
  });

  const rowUpdateMutation = useMutation({
    mutationFn: async ({ rowId, data }: { rowId: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/import-batches/${batchId}/rows/${rowId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/import-batches", batchId] });
    },
    onError: () => {
      toast({ title: "Failed to update row", variant: "destructive" });
    },
  });

  const acceptSuggestionsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/import-batches/${batchId}/accept-suggestions`, {
        threshold: 75,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `Accepted ${data.accepted} AI suggestions` });
      queryClient.invalidateQueries({ queryKey: ["/api/import-batches", batchId] });
    },
    onError: () => {
      toast({ title: "Failed to accept suggestions", variant: "destructive" });
    },
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/import-batches/${batchId}/commit`, {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Import Committed",
        description: `Created ${data.createdContacts} contacts. ${data.needsSetup} need service setup.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
    },
    onError: () => {
      toast({ title: "Commit failed", variant: "destructive" });
    },
  });

  const resolverData = resolverQuery.data;
  const health = healthQuery.data;
  const batch = batchQuery.data;

  const displayedRows = useMemo(() => {
    if (!resolverData) return [];
    if (activeTab === "all") return resolverData.rows;
    if (activeTab === "frequency") return resolverData.grouped.frequency;
    if (activeTab === "serviceDay") return resolverData.grouped.serviceDay;
    if (activeTab === "price") return resolverData.grouped.price;
    if (activeTab === "billingRule") return resolverData.grouped.billingRule;
    return resolverData.rows;
  }, [resolverData, activeTab]);

  const allSelected = displayedRows.length > 0 && selectedIds.size === displayedRows.length;
  const someSelected = selectedIds.size > 0;

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayedRows.map((r) => r.id)));
    }
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function applyBulkEdit() {
    const updates: Record<string, unknown> = {};
    if (bulkFrequency) updates.serviceFrequency = bulkFrequency;
    if (bulkDay) updates.serviceDay = bulkDay;
    if (bulkPrice) updates.price = parseFloat(bulkPrice);
    if (bulkBillingRule) updates.billingRule = bulkBillingRule;
    if (Object.keys(updates).length === 0) {
      toast({ title: "No changes to apply", variant: "destructive" });
      return;
    }
    bulkUpdateMutation.mutate({ rowIds: Array.from(selectedIds), updates });
  }

  function applyRowIgnore(rowId: string) {
    rowUpdateMutation.mutate({ rowId, data: { status: "ignored" } });
  }

  function applyRowReady(rowId: string) {
    rowUpdateMutation.mutate({ rowId, data: { status: "ready" } });
  }

  function saveRowEdit(rowId: string) {
    const edit = rowEdits[rowId];
    if (!edit) return;
    const currentRow = resolverData?.rows.find((r) => r.id === rowId);
    if (!currentRow) return;
    const currentService = (currentRow.mappedServiceJson || {}) as Record<string, unknown>;
    const updatedService = { ...currentService };
    if (edit.serviceFrequency) updatedService.serviceFrequency = edit.serviceFrequency;
    if (edit.serviceDay) updatedService.serviceDay = edit.serviceDay;
    if (edit.priceCents) updatedService.priceCents = Math.round(parseFloat(edit.priceCents) * 100);
    if (edit.billingRule) updatedService.billingRule = edit.billingRule;
    rowUpdateMutation.mutate({ rowId, data: { mappedServiceJson: updatedService } });
    setRowEdits((prev) => {
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  }

  function setRowField(rowId: string, field: string, value: string) {
    setRowEdits((prev) => ({
      ...prev,
      [rowId]: { ...(prev[rowId] || {}), [field]: value },
    }));
  }

  function getContactName(row: ResolverRow): string {
    const c = (row.mappedContactJson || {}) as Record<string, string>;
    return [c.firstName, c.lastName].filter(Boolean).join(" ") || `Row ${row.rowIndex + 1}`;
  }

  function getServiceVal(row: ResolverRow, field: string): string {
    const s = (row.mappedServiceJson || {}) as Record<string, unknown>;
    const c = (row.mappedContactJson || {}) as Record<string, unknown>;
    if (field === "serviceFrequency") return String(s.serviceFrequency || c.serviceFrequency || "");
    if (field === "serviceDay") return String(s.serviceDay || c.serviceDay || "");
    if (field === "priceCents") {
      const cents = Number(s.priceCents || 0);
      return cents ? (cents / 100).toFixed(2) : "";
    }
    if (field === "billingRule") return String(s.billingRule || "");
    return "";
  }

  const isCommitted = batch?.status === "committed";

  if (healthQuery.isLoading || resolverQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!health || !resolverData) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <AlertTriangle className="w-8 h-8 text-muted-foreground" />
        <p className="text-muted-foreground">Batch not found or still processing.</p>
        <Button variant="outline" onClick={() => navigate("/migration")}>
          <ChevronLeft className="w-4 h-4 mr-1" /> Back to Migration
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/migration")}
            data-testid="button-back-migration"
            className="mb-2 -ml-2"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back to Migration
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Review Staged Import</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {batch?.fileName || "Import batch"} &mdash; {health.totalRows} rows staged for review
            {isCommitted && (
              <Badge className="ml-2 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                Committed
              </Badge>
            )}
          </p>
          {!isCommitted && (
            <p className="text-muted-foreground text-xs mt-2 max-w-xl">
              Your contacts are staged but not yet in your CRM. Fill in any missing service details
              using the tabs below, then click{" "}
              <strong className="text-foreground">Commit to Production</strong> to create the
              contacts and service plans.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => acceptSuggestionsMutation.mutate()}
            disabled={acceptSuggestionsMutation.isPending || isCommitted}
            data-testid="button-accept-suggestions"
          >
            {acceptSuggestionsMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-1.5" />
            )}
            Accept AI Suggestions
          </Button>
          <Button
            onClick={() => commitMutation.mutate()}
            disabled={commitMutation.isPending || isCommitted}
            data-testid="button-commit"
          >
            {commitMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Zap className="w-4 h-4 mr-1.5" />
            )}
            {isCommitted ? "Committed" : "Commit to Production"}
          </Button>
        </div>
      </div>

      {/* Health Score + Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <HealthGauge score={health.health.overall} />

        <div className="sm:col-span-2 grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p
                className="text-2xl font-bold text-green-600 dark:text-green-400"
                data-testid="text-ready-rows"
              >
                {health.readyRows}
              </p>
              <p className="text-xs text-muted-foreground">Ready to Commit</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p
                className="text-2xl font-bold text-yellow-600 dark:text-yellow-400"
                data-testid="text-needs-review-rows"
              >
                {health.needsReviewRows}
              </p>
              <p className="text-xs text-muted-foreground">Need Review</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p
                className="text-2xl font-bold text-muted-foreground"
                data-testid="text-ignored-rows"
              >
                {health.ignoredRows}
              </p>
              <p className="text-xs text-muted-foreground">Ignored</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p
                className="text-2xl font-bold text-blue-600 dark:text-blue-400"
                data-testid="text-imported-rows"
              >
                {health.importedRows}
              </p>
              <p className="text-xs text-muted-foreground">Imported</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Category breakdown */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Data Completeness</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <CategoryBar label="Names" score={health.health.categories.names} />
          <CategoryBar label="Addresses" score={health.health.categories.addresses} />
          <CategoryBar label="Contact Info" score={health.health.categories.contactInfo} />
          <CategoryBar label="Frequency" score={health.health.categories.frequency} />
          <CategoryBar label="Service Day" score={health.health.categories.serviceDay} />
          <CategoryBar label="Price" score={health.health.categories.price} />
          <CategoryBar label="Billing Rule" score={health.health.categories.billingRule} />
        </CardContent>
      </Card>

      {/* Bulk Edit Toolbar */}
      {someSelected && !isCommitted && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-sm font-medium text-primary">
                {selectedIds.size} row{selectedIds.size !== 1 ? "s" : ""} selected
              </p>
              <Select value={bulkFrequency} onValueChange={setBulkFrequency}>
                <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-bulk-frequency">
                  <SelectValue placeholder="Frequency" />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={bulkDay} onValueChange={setBulkDay}>
                <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-bulk-day">
                  <SelectValue placeholder="Service Day" />
                </SelectTrigger>
                <SelectContent>
                  {DAY_OPTIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Price $"
                value={bulkPrice}
                onChange={(e) => setBulkPrice(e.target.value)}
                className="w-24 h-8 text-xs"
                type="number"
                step="0.01"
                data-testid="input-bulk-price"
              />
              <Select value={bulkBillingRule} onValueChange={setBulkBillingRule}>
                <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-bulk-billing">
                  <SelectValue placeholder="Billing Rule" />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_OPTIONS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={applyBulkEdit}
                disabled={bulkUpdateMutation.isPending}
                data-testid="button-apply-bulk"
              >
                {bulkUpdateMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                )}
                Apply to Selected
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
                data-testid="button-clear-selection"
              >
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resolver Table */}
      <Card>
        <CardHeader className="pb-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4" />
              Staged Rows
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-status-filter">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="needs_review">Needs Review</SelectItem>
                  <SelectItem value="ready">Ready</SelectItem>
                  <SelectItem value="ignored">Ignored</SelectItem>
                  <SelectItem value="imported">Imported</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        {/* Issue summary breakdown */}
        {!isCommitted && (
          <div className="px-6 pb-3">
            {(() => {
              const counts = resolverData.missingFieldCounts;
              const parts: string[] = [];
              if (counts.price > 0)
                parts.push(`${counts.price} missing price${counts.price !== 1 ? "s" : ""}`);
              if (counts.serviceDay > 0)
                parts.push(
                  `${counts.serviceDay} missing service day${counts.serviceDay !== 1 ? "s" : ""}`
                );
              if (counts.frequency > 0)
                parts.push(
                  `${counts.frequency} missing frequenc${counts.frequency !== 1 ? "ies" : "y"}`
                );
              if (counts.billingRule > 0)
                parts.push(
                  `${counts.billingRule} missing billing rule${counts.billingRule !== 1 ? "s" : ""}`
                );
              if (parts.length === 0) {
                return (
                  <p
                    className="text-xs text-green-600 dark:text-green-400"
                    data-testid="text-issue-summary"
                  >
                    All service fields are complete — ready to commit.
                  </p>
                );
              }
              return (
                <p className="text-xs text-muted-foreground" data-testid="text-issue-summary">
                  {parts.join(", ")} — use the tabs below to fix before committing.
                </p>
              );
            })()}
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-2">
          <div className="px-6 space-y-2">
            <TabsList className="h-8">
              <TabsTrigger value="all" className="text-xs" data-testid="tab-all">
                All ({resolverData.rows.length})
              </TabsTrigger>
              <TabsTrigger value="frequency" className="text-xs" data-testid="tab-frequency">
                Frequency ({resolverData.missingFieldCounts.frequency})
              </TabsTrigger>
              <TabsTrigger value="serviceDay" className="text-xs" data-testid="tab-service-day">
                Service Day ({resolverData.missingFieldCounts.serviceDay})
              </TabsTrigger>
              <TabsTrigger value="price" className="text-xs" data-testid="tab-price">
                Price ({resolverData.missingFieldCounts.price})
              </TabsTrigger>
              <TabsTrigger value="billingRule" className="text-xs" data-testid="tab-billing">
                Billing ({resolverData.missingFieldCounts.billingRule})
              </TabsTrigger>
            </TabsList>
            <p className="text-xs text-muted-foreground pb-1" data-testid="text-tab-description">
              {activeTab === "all" &&
                "All staged contacts — review or filter by a specific missing field using the tabs above."}
              {activeTab === "frequency" &&
                "Contacts missing a service frequency (weekly, biweekly, etc.). Set one per row or use bulk-edit to apply the same value to many rows at once."}
              {activeTab === "serviceDay" &&
                "Contacts not yet assigned to a route day. Pick a day for each customer here or let the resolver assign them automatically on commit."}
              {activeTab === "price" &&
                "Contacts without a confirmed price per visit. Enter a dollar amount per row, or use bulk-edit to apply a standard rate to a group."}
              {activeTab === "billingRule" &&
                "Contacts missing a billing rule (per visit, monthly flat, per dog, etc.). This controls how invoices are generated for each customer."}
            </p>
          </div>

          <TabsContent value={activeTab} className="mt-0">
            <CardContent className="pt-3 px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {!isCommitted && (
                        <TableHead className="w-10 pl-6">
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={toggleSelectAll}
                            data-testid="checkbox-select-all"
                          />
                        </TableHead>
                      )}
                      <TableHead>#</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Service Day</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Billing Rule</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>AI</TableHead>
                      {!isCommitted && <TableHead className="text-right pr-6">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedRows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={isCommitted ? 8 : 9}
                          className="text-center py-12 text-muted-foreground"
                        >
                          No rows in this category.
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayedRows.map((row) => {
                        const isSelected = selectedIds.has(row.id);
                        const edit = rowEdits[row.id];
                        const suggestion = row.suggestion;
                        const isMissing = (field: string) =>
                          (row.missingFields || []).includes(field);

                        return (
                          <TableRow
                            key={row.id}
                            className={`${isSelected ? "bg-primary/5" : ""} ${row.status === "ignored" ? "opacity-50" : ""}`}
                            data-testid={`row-resolver-${row.id}`}
                          >
                            {!isCommitted && (
                              <TableCell className="pl-6">
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => toggleSelect(row.id)}
                                  disabled={row.status === "imported"}
                                  data-testid={`checkbox-row-${row.id}`}
                                />
                              </TableCell>
                            )}
                            <TableCell className="text-muted-foreground text-xs">
                              {row.rowIndex + 1}
                            </TableCell>
                            <TableCell>
                              <p className="font-medium text-sm">{getContactName(row)}</p>
                              <p className="text-xs text-muted-foreground">
                                {((row.mappedContactJson as Record<string, string>) || {}).email ||
                                  ""}
                              </p>
                            </TableCell>

                            {/* Frequency */}
                            <TableCell>
                              {!isCommitted && isMissing("frequency") ? (
                                <Select
                                  value={edit?.serviceFrequency || ""}
                                  onValueChange={(v) => setRowField(row.id, "serviceFrequency", v)}
                                >
                                  <SelectTrigger
                                    className="w-28 h-7 text-xs"
                                    data-testid={`select-freq-${row.id}`}
                                  >
                                    <SelectValue placeholder="Set…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {FREQUENCY_OPTIONS.map((f) => (
                                      <SelectItem key={f} value={f}>
                                        {f}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span
                                  className={`text-sm ${isMissing("frequency") ? "text-muted-foreground italic" : ""}`}
                                >
                                  {getServiceVal(row, "serviceFrequency") || (
                                    <span className="text-muted-foreground italic">—</span>
                                  )}
                                </span>
                              )}
                            </TableCell>

                            {/* Service Day */}
                            <TableCell>
                              {!isCommitted && isMissing("serviceDay") ? (
                                <Select
                                  value={edit?.serviceDay || ""}
                                  onValueChange={(v) => setRowField(row.id, "serviceDay", v)}
                                >
                                  <SelectTrigger
                                    className="w-28 h-7 text-xs"
                                    data-testid={`select-day-${row.id}`}
                                  >
                                    <SelectValue placeholder="Set…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {DAY_OPTIONS.map((d) => (
                                      <SelectItem key={d} value={d}>
                                        {d}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span className="text-sm">
                                  {getServiceVal(row, "serviceDay") || (
                                    <span className="text-muted-foreground italic">—</span>
                                  )}
                                </span>
                              )}
                            </TableCell>

                            {/* Price */}
                            <TableCell>
                              {!isCommitted && isMissing("price") ? (
                                <Input
                                  type="number"
                                  placeholder="$"
                                  value={edit?.priceCents || ""}
                                  onChange={(e) =>
                                    setRowField(row.id, "priceCents", e.target.value)
                                  }
                                  className="w-20 h-7 text-xs"
                                  step="0.01"
                                  data-testid={`input-price-${row.id}`}
                                />
                              ) : (
                                <span className="text-sm">
                                  {getServiceVal(row, "priceCents") ? (
                                    `$${getServiceVal(row, "priceCents")}`
                                  ) : (
                                    <span className="text-muted-foreground italic">—</span>
                                  )}
                                </span>
                              )}
                            </TableCell>

                            {/* Billing Rule */}
                            <TableCell>
                              {!isCommitted && isMissing("billingRule") ? (
                                <Select
                                  value={edit?.billingRule || ""}
                                  onValueChange={(v) => setRowField(row.id, "billingRule", v)}
                                >
                                  <SelectTrigger
                                    className="w-32 h-7 text-xs"
                                    data-testid={`select-billing-${row.id}`}
                                  >
                                    <SelectValue placeholder="Set…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {BILLING_OPTIONS.map((b) => (
                                      <SelectItem key={b} value={b}>
                                        {b}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span className="text-sm">
                                  {getServiceVal(row, "billingRule") || (
                                    <span className="text-muted-foreground italic">—</span>
                                  )}
                                </span>
                              )}
                            </TableCell>

                            {/* Status */}
                            <TableCell>
                              {row.status === "ready" && (
                                <Badge
                                  className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs"
                                  data-testid={`status-${row.id}`}
                                >
                                  <CheckCircle2 className="w-3 h-3 mr-1" /> Ready
                                </Badge>
                              )}
                              {row.status === "needs_review" && (
                                <Badge
                                  className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 text-xs"
                                  data-testid={`status-${row.id}`}
                                >
                                  <AlertTriangle className="w-3 h-3 mr-1" /> Review
                                </Badge>
                              )}
                              {row.status === "ignored" && (
                                <Badge
                                  variant="outline"
                                  className="text-xs text-muted-foreground"
                                  data-testid={`status-${row.id}`}
                                >
                                  <EyeOff className="w-3 h-3 mr-1" /> Ignored
                                </Badge>
                              )}
                              {row.status === "imported" && (
                                <Badge
                                  className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs"
                                  data-testid={`status-${row.id}`}
                                >
                                  <CheckCircle2 className="w-3 h-3 mr-1" /> Imported
                                </Badge>
                              )}
                            </TableCell>

                            {/* AI Suggestion */}
                            <TableCell>
                              {suggestion && !suggestion.isAccepted && (
                                <Badge
                                  variant="outline"
                                  className={`text-xs ${
                                    suggestion.confidenceScore >= 75
                                      ? "border-purple-400 text-purple-700 dark:text-purple-300"
                                      : "text-muted-foreground"
                                  }`}
                                  title={suggestion.reason || ""}
                                  data-testid={`ai-suggestion-${row.id}`}
                                >
                                  <Sparkles className="w-3 h-3 mr-1" />
                                  {suggestion.confidenceScore}%
                                </Badge>
                              )}
                              {suggestion?.isAccepted && (
                                <Badge
                                  variant="outline"
                                  className="text-xs border-green-400 text-green-700 dark:text-green-300"
                                  data-testid={`ai-accepted-${row.id}`}
                                >
                                  <CheckCircle2 className="w-3 h-3 mr-1" /> Used
                                </Badge>
                              )}
                            </TableCell>

                            {/* Actions */}
                            {!isCommitted && (
                              <TableCell className="text-right pr-6">
                                <div className="flex items-center justify-end gap-1">
                                  {edit && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs"
                                      onClick={() => saveRowEdit(row.id)}
                                      disabled={rowUpdateMutation.isPending}
                                      data-testid={`button-save-${row.id}`}
                                    >
                                      Save
                                    </Button>
                                  )}
                                  {row.status !== "imported" && row.status !== "ignored" && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                      onClick={() => applyRowIgnore(row.id)}
                                      data-testid={`button-ignore-${row.id}`}
                                    >
                                      <EyeOff className="w-3 h-3" />
                                    </Button>
                                  )}
                                  {row.status === "ignored" && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs"
                                      onClick={() => applyRowReady(row.id)}
                                      data-testid={`button-unignore-${row.id}`}
                                    >
                                      Restore
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
