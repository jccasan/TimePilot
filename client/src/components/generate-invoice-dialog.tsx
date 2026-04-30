import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toLocalDateString } from "@/lib/utils";
import { useCompanyTimezone } from "@/hooks/use-company-timezone";
import { useToast } from "@/hooks/use-toast";
import type { Contact, Visit, Invoice, InvoiceLineItem } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, CheckCircle, DollarSign, Calendar, Filter, Zap } from "lucide-react";

type UninvoicedVisit = Visit & {
  servicePlanName: string;
  pricePerVisit: string;
  propertyAddress: string;
};

type UninvoicedResult = {
  visits: UninvoicedVisit[];
  totalDollars: number;
};

interface GenerateInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId?: string;
  showContactPicker?: boolean;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getMonthRange(
  monthsAgo: number,
  timezone?: string
): { start: string; end: string; label: string } {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  const year = d.getFullYear();
  const month = d.getMonth();
  const start = toLocalDateString(new Date(year, month, 1), timezone);
  const end = toLocalDateString(new Date(year, month + 1, 0), timezone);
  const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return { start, end, label };
}

export function GenerateInvoiceDialog({
  open,
  onOpenChange,
  contactId: initialContactId,
  showContactPicker = false,
}: GenerateInvoiceDialogProps) {
  const tz = useCompanyTimezone();
  const { toast } = useToast();
  const [selectedContactId, setSelectedContactId] = useState(initialContactId || "");
  const [selectedVisitIds, setSelectedVisitIds] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return toLocalDateString(d, tz);
  });
  const [suppressNotifications, setSuppressNotifications] = useState(false);

  useEffect(() => {
    if (!open) setSuppressNotifications(false);
  }, [open]);

  const activeContactId = initialContactId || selectedContactId;

  const handleContactChange = (newContactId: string) => {
    setSelectedContactId(newContactId);
    setSelectedVisitIds(new Set());
  };

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
    enabled: showContactPicker && open,
  });

  const {
    data: uninvoicedData,
    isLoading,
    isError,
  } = useQuery<UninvoicedResult>({
    queryKey: ["/api/contacts", activeContactId, "uninvoiced-visits"],
    enabled: !!activeContactId && open,
  });

  const filteredVisits = useMemo(() => {
    if (!uninvoicedData?.visits) return [];
    let visits = uninvoicedData.visits;
    let rangeStart = "";
    let rangeEnd = "";

    if (dateFilter === "custom") {
      rangeStart = customStart;
      rangeEnd = customEnd;
    } else if (dateFilter !== "all") {
      const monthsAgo = parseInt(dateFilter);
      if (!isNaN(monthsAgo)) {
        const range = getMonthRange(monthsAgo, tz);
        rangeStart = range.start;
        rangeEnd = range.end;
      }
    }

    if (rangeStart && rangeEnd) {
      visits = visits.filter((v) => v.scheduledDate >= rangeStart && v.scheduledDate <= rangeEnd);
    } else if (rangeStart) {
      visits = visits.filter((v) => v.scheduledDate >= rangeStart);
    } else if (rangeEnd) {
      visits = visits.filter((v) => v.scheduledDate <= rangeEnd);
    }

    return visits;
  }, [uninvoicedData, dateFilter, customStart, customEnd]);

  const visitsByPlan = useMemo(() => {
    const map = new Map<string, UninvoicedVisit[]>();
    for (const v of filteredVisits) {
      const key = `${v.servicePlanName} - ${v.propertyAddress}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    }
    return map;
  }, [filteredVisits]);

  const selectedTotal = useMemo(() => {
    if (!uninvoicedData?.visits) return 0;
    return uninvoicedData.visits
      .filter((v) => selectedVisitIds.has(v.id))
      .reduce((sum, v) => sum + (parseFloat(v.pricePerVisit) || 0), 0);
  }, [uninvoicedData, selectedVisitIds]);

  const allSelected =
    filteredVisits.length > 0 && filteredVisits.every((v) => selectedVisitIds.has(v.id));

  const toggleAll = () => {
    if (filteredVisits.length === 0) return;
    if (allSelected) {
      setSelectedVisitIds(new Set());
    } else {
      setSelectedVisitIds(new Set(filteredVisits.map((v) => v.id)));
    }
  };

  const toggleVisit = (visitId: string) => {
    setSelectedVisitIds((prev) => {
      const next = new Set(prev);
      if (next.has(visitId)) next.delete(visitId);
      else next.add(visitId);
      return next;
    });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/invoices/from-visits", {
        contactId: activeContactId,
        visitIds: Array.from(selectedVisitIds),
        dueDate,
        suppressNotifications,
      });
      return res.json();
    },
    onSuccess: (data: Invoice & { lineItems: InvoiceLineItem[] }) => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0] as string;
          return (
            key?.startsWith("/api/invoices") ||
            key?.startsWith("/api/company/uninvoiced") ||
            (key === "/api/contacts" && query.queryKey[2] === "uninvoiced-visits")
          );
        },
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/contacts", activeContactId, "uninvoiced-visits"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      toast({
        title: "Invoice created",
        description: `Invoice #${data.invoiceNumber} for $${parseFloat(data.total).toFixed(2)} created from ${selectedVisitIds.size} visit${selectedVisitIds.size > 1 ? "s" : ""}.`,
      });
      onOpenChange(false);
      setSelectedVisitIds(new Set());
      setSelectedContactId("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedVisitIds(new Set());
      setDateFilter("all");
      setCustomStart("");
      setCustomEnd("");
      if (showContactPicker) setSelectedContactId("");
    } else if (initialContactId) {
      setSelectedVisitIds(new Set());
      setDateFilter("all");
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle
            className="flex items-center gap-2"
            data-testid="text-generate-invoice-title"
          >
            <FileText className="h-5 w-5" />
            Generate Invoice from Completed Work
          </DialogTitle>
          <DialogDescription>Select completed visits to include in the invoice.</DialogDescription>
        </DialogHeader>

        {showContactPicker && !initialContactId && (
          <div data-testid="section-contact-picker">
            <Label>Client</Label>
            <Select value={selectedContactId} onValueChange={handleContactChange}>
              <SelectTrigger data-testid="select-invoice-contact">
                <SelectValue placeholder="Select a client" />
              </SelectTrigger>
              <SelectContent>
                {contacts
                  ?.filter((c) => c.status === "active")
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {activeContactId && uninvoicedData?.visits && uninvoicedData.visits.length > 0 && (
          <div className="space-y-2" data-testid="section-date-filter">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Filter by date range</Label>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button
                variant={dateFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setDateFilter("all");
                  setSelectedVisitIds(new Set());
                }}
                data-testid="button-filter-all"
              >
                All
              </Button>
              <Button
                variant={dateFilter === "0" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setDateFilter("0");
                  setSelectedVisitIds(new Set());
                }}
                data-testid="button-filter-this-month"
              >
                {getMonthRange(0, tz).label}
              </Button>
              <Button
                variant={dateFilter === "1" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setDateFilter("1");
                  setSelectedVisitIds(new Set());
                }}
                data-testid="button-filter-last-month"
              >
                {getMonthRange(1, tz).label}
              </Button>
              <Button
                variant={dateFilter === "2" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setDateFilter("2");
                  setSelectedVisitIds(new Set());
                }}
                data-testid="button-filter-2-months"
              >
                {getMonthRange(2, tz).label}
              </Button>
              <Button
                variant={dateFilter === "custom" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setDateFilter("custom");
                  setSelectedVisitIds(new Set());
                }}
                data-testid="button-filter-custom"
              >
                Custom
              </Button>
            </div>
            {dateFilter === "custom" && (
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => {
                    setCustomStart(e.target.value);
                    setSelectedVisitIds(new Set());
                  }}
                  className="w-auto"
                  data-testid="input-filter-start"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => {
                    setCustomEnd(e.target.value);
                    setSelectedVisitIds(new Set());
                  }}
                  className="w-auto"
                  data-testid="input-filter-end"
                />
              </div>
            )}
            {dateFilter !== "all" && (
              <p className="text-xs text-muted-foreground">
                Showing {filteredVisits.length} of {uninvoicedData.visits.length} uninvoiced visits
              </p>
            )}
          </div>
        )}

        {!activeContactId ? (
          <div
            className="text-center py-8 text-muted-foreground"
            data-testid="text-select-client-prompt"
          >
            <DollarSign className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p>Select a client to see their uninvoiced completed work.</p>
          </div>
        ) : isError ? (
          <div className="text-center py-8 text-destructive" data-testid="text-error-uninvoiced">
            <p className="font-medium">Failed to load uninvoiced visits</p>
            <p className="text-sm text-muted-foreground">Please try again later.</p>
          </div>
        ) : isLoading ? (
          <div className="space-y-3" data-testid="loading-uninvoiced-visits">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !uninvoicedData?.visits || uninvoicedData.visits.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground" data-testid="text-no-uninvoiced">
            <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500 opacity-60" />
            <p className="font-medium">All caught up</p>
            <p className="text-sm">No uninvoiced completed visits for this client.</p>
          </div>
        ) : filteredVisits.length === 0 ? (
          <div
            className="text-center py-8 text-muted-foreground"
            data-testid="text-no-filtered-visits"
          >
            <Calendar className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="font-medium">No visits in this date range</p>
            <p className="text-sm">Try selecting a different date range above.</p>
          </div>
        ) : (
          <div className="space-y-4" data-testid="section-uninvoiced-visits">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={allSelected || false}
                  onCheckedChange={toggleAll}
                  data-testid="checkbox-select-all"
                />
                <span className="text-sm font-medium">
                  Select All ({filteredVisits.length} visit{filteredVisits.length !== 1 ? "s" : ""})
                </span>
              </div>
              <Badge variant="secondary" className="text-sm" data-testid="badge-total-uninvoiced">
                $
                {filteredVisits
                  .reduce((sum, v) => sum + (parseFloat(v.pricePerVisit) || 0), 0)
                  .toFixed(2)}{" "}
                total
              </Badge>
            </div>

            <div className="space-y-3 border rounded-lg p-3">
              {Array.from(visitsByPlan.entries()).map(([planKey, planVisits]) => (
                <div key={planKey}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-muted-foreground">{planKey}</span>
                    <Badge variant="outline" className="text-xs">
                      {planVisits.length} visit{planVisits.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <div className="space-y-1 ml-1">
                    {planVisits.map((visit) => (
                      <label
                        key={visit.id}
                        className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer"
                        data-testid={`row-visit-${visit.id}`}
                      >
                        <Checkbox
                          checked={selectedVisitIds.has(visit.id)}
                          onCheckedChange={() => toggleVisit(visit.id)}
                          data-testid={`checkbox-visit-${visit.id}`}
                        />
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm">{formatDate(visit.scheduledDate)}</span>
                          {visit.completedAt && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1 py-0 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                            >
                              Completed
                            </Badge>
                          )}
                        </div>
                        <span
                          className="text-sm font-medium tabular-nums"
                          data-testid={`text-visit-price-${visit.id}`}
                        >
                          ${(parseFloat(visit.pricePerVisit) || 0).toFixed(2)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t pt-3 space-y-3">
              <div className="flex items-center gap-3">
                <Label className="whitespace-nowrap">Due Date</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="max-w-[200px]"
                  data-testid="input-invoice-due-date"
                />
              </div>

              <div className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {selectedVisitIds.size} visit{selectedVisitIds.size !== 1 ? "s" : ""} selected
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold" data-testid="text-selected-total">
                    ${selectedTotal.toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="invoice-suppress-notifications"
                  checked={suppressNotifications}
                  onCheckedChange={setSuppressNotifications}
                  data-testid="switch-suppress-notifications"
                />
                <Label
                  htmlFor="invoice-suppress-notifications"
                  className="text-sm text-muted-foreground cursor-pointer"
                >
                  Suppress notifications
                </Label>
              </div>

              <Button
                onClick={() => createMutation.mutate()}
                disabled={selectedVisitIds.size === 0 || createMutation.isPending}
                className="w-full"
                data-testid="button-create-invoice-from-visits"
              >
                {createMutation.isPending
                  ? "Creating Invoice..."
                  : `Create Invoice ($${selectedTotal.toFixed(2)})`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Generate by Date Range Dialog ───────────────────────────────────────────

interface GenerateByDateRangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GenerateByDateRangeDialog({ open, onOpenChange }: GenerateByDateRangeDialogProps) {
  const tz = useCompanyTimezone();
  const { toast } = useToast();
  const [dateFilter, setDateFilter] = useState<string>("0");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [suppressNotifications, setSuppressNotifications] = useState(false);

  const resolvedRange = useMemo(() => {
    if (dateFilter === "custom") {
      return { start: customStart, end: customEnd };
    }
    const monthsAgo = parseInt(dateFilter);
    if (!isNaN(monthsAgo)) return getMonthRange(monthsAgo, tz);
    return { start: "", end: "" };
  }, [dateFilter, customStart, customEnd, tz]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { suppressNotifications };
      if (resolvedRange.start) body.startDate = resolvedRange.start;
      if (resolvedRange.end) body.endDate = resolvedRange.end;
      const res = await apiRequest("POST", "/api/invoices/generate-all-from-uninvoiced", body);
      return res.json();
    },
    onSuccess: (data: { created: number; totalDollars: number }) => {
      queryClient.invalidateQueries({
        predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/invoices"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/company/uninvoiced-summary"] });
      if (data.created > 0) {
        const dollarStr = data.totalDollars.toFixed(2);
        toast({
          title: `$${dollarStr} in invoices generated`,
          description: `${data.created} invoice${data.created !== 1 ? "s" : ""} created`,
        });
      } else {
        toast({
          title: "No invoices generated",
          description: "No uninvoiced completed work found in this date range.",
        });
      }
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setDateFilter("0");
      setCustomStart("");
      setCustomEnd("");
      setSuppressNotifications(false);
    }
    onOpenChange(isOpen);
  };

  const canGenerate = dateFilter !== "custom" || (!!customStart && !!customEnd);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-generate-by-date-range">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Generate Invoices by Date Range
          </DialogTitle>
          <DialogDescription>
            Generate invoices for all completed, uninvoiced work within a specific period.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Select period</Label>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button
                variant={dateFilter === "0" ? "default" : "outline"}
                size="sm"
                onClick={() => setDateFilter("0")}
                data-testid="button-dr-this-month"
              >
                {getMonthRange(0, tz).label}
              </Button>
              <Button
                variant={dateFilter === "1" ? "default" : "outline"}
                size="sm"
                onClick={() => setDateFilter("1")}
                data-testid="button-dr-last-month"
              >
                {getMonthRange(1, tz).label}
              </Button>
              <Button
                variant={dateFilter === "2" ? "default" : "outline"}
                size="sm"
                onClick={() => setDateFilter("2")}
                data-testid="button-dr-2-months"
              >
                {getMonthRange(2, tz).label}
              </Button>
              <Button
                variant={dateFilter === "custom" ? "default" : "outline"}
                size="sm"
                onClick={() => setDateFilter("custom")}
                data-testid="button-dr-custom"
              >
                Custom
              </Button>
            </div>

            {dateFilter === "custom" && (
              <div className="flex items-center gap-2 pt-1">
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-auto"
                  data-testid="input-dr-start"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-auto"
                  data-testid="input-dr-end"
                />
              </div>
            )}

            {dateFilter !== "custom" && resolvedRange.start && (
              <p className="text-xs text-muted-foreground">
                {formatDate(resolvedRange.start)} – {formatDate(resolvedRange.end)}
              </p>
            )}
          </div>

          <p className="text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            One invoice will be created per customer for all their completed, uninvoiced visits that
            fall within this period.
          </p>

          <div className="flex items-center gap-2 border-t pt-3">
            <Switch
              id="dr-suppress-notifications"
              checked={suppressNotifications}
              onCheckedChange={setSuppressNotifications}
              data-testid="switch-suppress-notifications"
            />
            <Label
              htmlFor="dr-suppress-notifications"
              className="text-sm text-muted-foreground cursor-pointer"
            >
              Suppress notifications
            </Label>
          </div>

          <Button
            className="w-full"
            disabled={!canGenerate || generateMutation.isPending}
            onClick={() => generateMutation.mutate()}
            data-testid="button-dr-generate"
          >
            <Zap className="mr-2 h-4 w-4" />
            {generateMutation.isPending ? "Generating…" : "Generate Invoices"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
