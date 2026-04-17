import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Invoice, Contact, ServicePricingItem, InvoicePayment, InvoiceLineItem } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, FileText, Mail, Trash2, Zap, Printer, CreditCard, ExternalLink, Palette, RotateCcw, Pencil, Save, Loader2, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { ClientInfoPopover } from "@/components/client-info-popover";
import { GenerateInvoiceDialog } from "@/components/generate-invoice-dialog";
import { LearnHowButton } from "@/components/interactive-tutorial";
import { useTutorialContext } from "@/hooks/use-tutorials";

const invoiceStatusLabels: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  pending: "Pending",
  paid: "Paid",
  voided: "Voided",
  failed: "Failed",
  refunded: "Refunded",
};

const invoiceStatusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  voided: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  refunded: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
  servicePricingId?: string;
  visitId?: string;
}

interface InvoiceWithLineItems extends Invoice {
  lineItems?: InvoiceLineItem[];
}

function formatPaymentDate(dateStr: string | Date): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function PaymentHistorySection({ invoiceId, invoiceTotal }: { invoiceId: string; invoiceTotal: number }) {
  const { data: payments, isLoading } = useQuery<InvoicePayment[]>({
    queryKey: ["/api/invoices", invoiceId, "payments"],
    enabled: !!invoiceId,
  });

  const totalPaidCents = useMemo(
    () => (payments || []).reduce((sum, p) => sum + p.amountCents, 0),
    [payments]
  );

  const invoiceTotalCents = Math.round(invoiceTotal * 100);
  const balanceRemainingCents = invoiceTotalCents - totalPaidCents;

  if (isLoading) {
    return (
      <div data-testid="payment-history-loading" className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <Card data-testid="payment-history-section">
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-sm font-medium">Payment History</CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {!payments || payments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-3" data-testid="text-no-payments">
            No payments recorded
          </p>
        ) : (
          <>
            <Table data-testid="table-payments">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs text-right">Amount</TableHead>
                  <TableHead className="text-xs">Method</TableHead>
                  <TableHead className="text-xs">Source</TableHead>
                  <TableHead className="text-xs">Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id} data-testid={`row-payment-${payment.id}`}>
                    <TableCell className="text-xs py-2" data-testid={`text-payment-date-${payment.id}`}>
                      {formatPaymentDate(payment.paidAt)}
                    </TableCell>
                    <TableCell className="text-xs py-2 text-right" data-testid={`text-payment-amount-${payment.id}`}>
                      ${formatCents(payment.amountCents)}
                    </TableCell>
                    <TableCell className="text-xs py-2" data-testid={`text-payment-method-${payment.id}`}>
                      {payment.method}
                    </TableCell>
                    <TableCell className="text-xs py-2" data-testid={`text-payment-source-${payment.id}`}>
                      {payment.source === "imported" ? (
                        <Badge variant="secondary" data-testid={`badge-imported-payment-${payment.id}`}>
                          Imported (non-Stripe)
                        </Badge>
                      ) : (
                        payment.source
                      )}
                    </TableCell>
                    <TableCell className="text-xs py-2" data-testid={`text-payment-reference-${payment.id}`}>
                      {payment.reference || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {balanceRemainingCents > 0 && (
              <div className="flex flex-wrap justify-between gap-1 mt-3 pt-2 border-t text-sm" data-testid="payment-balance-remaining">
                <span className="text-muted-foreground">Balance Remaining:</span>
                <span className="font-semibold text-orange-600 dark:text-orange-400">
                  ${formatCents(balanceRemainingCents)}
                </span>
              </div>
            )}

            <div className="flex flex-wrap justify-between gap-1 mt-1 text-sm" data-testid="payment-total-paid">
              <span className="text-muted-foreground">Total Paid:</span>
              <span className="font-semibold text-green-600 dark:text-green-400">
                ${formatCents(totalPaidCents)}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function getInitialTab(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("tab") || localStorage.getItem("scoopilot_inv_status_filter") || "all";
}

export default function Invoices() {
  const { toast } = useToast();
  const { startTutorial, isTutorialCompleted } = useTutorialContext();
  const [statusFilter, setStatusFilter] = useState(getInitialTab);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceWithLineItems | null>(null);

  const [contactId, setContactId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [taxRate, setTaxRate] = useState("0");
  const [discountType, setDiscountType] = useState<string>("");
  const [discountValue, setDiscountValue] = useState("0");
  const [invoiceStatus, setInvoiceStatus] = useState("pending");
  const [loadingUninvoiced, setLoadingUninvoiced] = useState(false);
  const [draftInvoiceIds, setDraftInvoiceIds] = useState<string[]>([]);


  const [editMode, setEditMode] = useState(false);
  const [editLineItems, setEditLineItems] = useState<LineItem[]>([]);
  const [editDueDate, setEditDueDate] = useState("");
  const [editTaxRate, setEditTaxRate] = useState("0");
  const [editDiscountType, setEditDiscountType] = useState<string>("");
  const [editDiscountValue, setEditDiscountValue] = useState("0");
  const [editNotes, setEditNotes] = useState("");

  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewInvoiceId, setPreviewInvoiceId] = useState<string | null>(null);
  const [themeDialogOpen, setThemeDialogOpen] = useState(false);

  type SortField = "invoiceNumber" | "contact" | "dueDate" | "total" | "status" | "createdAt";
  type SortDir = "asc" | "desc";
  const [sortField, setSortField] = useState<SortField>(() => {
    const saved = localStorage.getItem("scoopilot_inv_sort_field");
    const valid: SortField[] = ["invoiceNumber", "contact", "dueDate", "total", "status", "createdAt"];
    return (valid.includes(saved as SortField) ? saved as SortField : "createdAt");
  });
  const [sortDir, setSortDir] = useState<SortDir>(() =>
    (localStorage.getItem("scoopilot_inv_sort_dir") as SortDir) || "desc"
  );

  useEffect(() => {
    try { localStorage.setItem("scoopilot_inv_status_filter", statusFilter); } catch {}
  }, [statusFilter]);

  useEffect(() => {
    try { localStorage.setItem("scoopilot_inv_sort_field", sortField); } catch {}
  }, [sortField]);

  useEffect(() => {
    try { localStorage.setItem("scoopilot_inv_sort_dir", sortDir); } catch {}
  }, [sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const { data: invoices, isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices", statusFilter],
    queryFn: async () => {
      const token = localStorage.getItem("sessionToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (statusFilter === "awaiting") {
        const [sent, pending] = await Promise.all([
          fetch("/api/invoices?status=sent", { credentials: "include", headers }).then(r => r.ok ? r.json() : []),
          fetch("/api/invoices?status=pending", { credentials: "include", headers }).then(r => r.ok ? r.json() : []),
        ]);
        return [...sent, ...pending];
      }
      const queryParams = statusFilter !== "all" && statusFilter !== "uninvoiced" ? `?status=${statusFilter}` : "";
      const r = await fetch(`/api/invoices${queryParams}`, { credentials: "include", headers });
      if (!r.ok) throw new Error("Failed to fetch invoices");
      const all = await r.json();
      return all.filter((inv: Invoice) => inv.status !== "voided");
    },
  });

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const { data: pricing } = useQuery<ServicePricingItem[]>({
    queryKey: ["/api/pricing"],
  });

  interface UninvoicedSummary {
    count: number;
    totalDollars: number;
    byContact: { contactId: string; contactName: string; count: number; totalDollars: number }[];
  }

  const { data: uninvoicedSummary, isLoading: uninvoicedLoading } = useQuery<UninvoicedSummary>({
    queryKey: ["/api/company/uninvoiced-summary"],
    enabled: statusFilter === "uninvoiced",
  });

  const activePricing = useMemo(() => pricing?.filter(p => p.isActive) || [], [pricing]);

  const subtotal = useMemo(() => lineItems.reduce((sum, li) => sum + (parseInt(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0), 0), [lineItems]);
  const parsedDiscountValue = parseFloat(discountValue) || 0;
  const discountAmount = discountType === "percent" ? subtotal * (Math.abs(parsedDiscountValue) / 100) : discountType === "amount" ? Math.abs(parsedDiscountValue) : 0;
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const parsedTaxRate = parseFloat(taxRate) || 0;
  const taxAmount = afterDiscount * (parsedTaxRate / 100);
  const total = afterDiscount + taxAmount;

  const { data: stripeConfig } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/stripe/config"],
  });

  interface InvoiceTheme {
    primaryColor: string;
    accentColor: string;
    textColor: string;
    mutedColor: string;
    borderColor: string;
    backgroundColor: string;
    cardColor: string;
    fontFamily: string;
    logoSize: number;
    borderRadius: number;
    showLogo: boolean;
    logoPosition: "left" | "center" | "right";
  }

  const { data: invoiceTheme } = useQuery<InvoiceTheme>({
    queryKey: ["/api/invoice-theme"],
  });

  const [editTheme, setEditTheme] = useState<InvoiceTheme | null>(null);

  const saveThemeMutation = useMutation({
    mutationFn: async (theme: InvoiceTheme) => {
      await apiRequest("PUT", "/api/invoice-theme", theme);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-theme"] });
      toast({ title: "Theme saved", description: "Your invoice template has been updated." });
      setThemeDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const sendEmailMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/send-email`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ predicate: (query) => (query.queryKey[0] as string)?.startsWith("/api/invoices") });
      const desc = data?.paymentUrl
        ? "Invoice emailed with a payment link."
        : "Invoice emailed to the client.";
      toast({ title: "Invoice sent", description: desc });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send", description: error.message, variant: "destructive" });
    },
  });

  const chargeMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/charge`);
      return res.json();
    },
    onSuccess: (data: { status: string }) => {
      queryClient.invalidateQueries({ predicate: (query) => (query.queryKey[0] as string)?.startsWith("/api/invoices") });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/uninvoiced-summary"] });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey.includes("uninvoiced-visits") });
      if (data.status === "paid") {
        toast({ title: "Payment successful", description: "Invoice charged to card on file." });
      } else {
        toast({ title: "Payment processing", description: "Payment is being processed." });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Charge failed", description: error.message, variant: "destructive" });
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/checkout`);
      return res.json();
    },
    onSuccess: (data: { url?: string }) => {
      if (data.url) {
        window.open(data.url, "_blank");
      }
    },
    onError: (error: Error) => {
      toast({ title: "Checkout failed", description: error.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!contactId) throw new Error("Please select a contact");
      if (!dueDate) throw new Error("Please set a due date");
      if (lineItems.length === 0) throw new Error("Please add at least one line item");

      if (draftInvoiceIds.length > 0) {
        await apiRequest("POST", "/api/invoices/consolidate", {
          contactId,
          draftInvoiceIds,
          lineItems: lineItems.map(li => ({
            description: li.description,
            quantity: parseInt(li.quantity) || 1,
            unitPrice: li.unitPrice,
            visitId: li.visitId || null,
          })),
          dueDate,
          discountType: discountType || null,
          discountValue,
        });
      } else {
        await apiRequest("POST", "/api/invoices", {
          contactId,
          dueDate,
          status: invoiceStatus,
          lineItems: lineItems.map(li => ({
            description: li.description,
            quantity: parseInt(li.quantity) || 1,
            unitPrice: li.unitPrice,
            servicePricingId: li.servicePricingId || null,
            visitId: li.visitId || null,
          })),
          taxRate,
          discountType: discountType || null,
          discountValue,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => (query.queryKey[0] as string)?.startsWith("/api/invoices") });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/uninvoiced-summary"] });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey.includes("uninvoiced-visits") });
      const msg = draftInvoiceIds.length > 0
        ? `Consolidated ${draftInvoiceIds.length} draft invoice${draftInvoiceIds.length !== 1 ? "s" : ""} into one.`
        : "New invoice has been created.";
      toast({ title: "Invoice created", description: msg });
      resetCreateForm();
      setCreateDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });


  const markPaidMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      await apiRequest("PATCH", `/api/invoices/${invoiceId}`, { status: "paid", paidAt: new Date().toISOString() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => (query.queryKey[0] as string)?.startsWith("/api/invoices") });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      toast({ title: "Invoice updated", description: "Invoice marked as paid." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      await apiRequest("DELETE", `/api/invoices/${invoiceId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0] as string;
        return key?.startsWith("/api/invoices") || key?.startsWith("/api/contacts");
      }});
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/uninvoiced-summary"] });
      toast({ title: "Invoice deleted", description: "Invoice has been permanently removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const editSubtotal = useMemo(() => editLineItems.reduce((sum, li) => sum + (parseInt(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0), 0), [editLineItems]);
  const editParsedDiscountValue = parseFloat(editDiscountValue) || 0;
  const editDiscountAmount = editDiscountType === "percent" ? editSubtotal * (Math.abs(editParsedDiscountValue) / 100) : editDiscountType === "amount" ? Math.abs(editParsedDiscountValue) : 0;
  const editAfterDiscount = Math.max(0, editSubtotal - editDiscountAmount);
  const editParsedTaxRate = parseFloat(editTaxRate) || 0;
  const editTaxAmount = editAfterDiscount * (editParsedTaxRate / 100);
  const editTotal = editAfterDiscount + editTaxAmount;

  function enterEditMode() {
    if (!selectedInvoice) return;
    setEditLineItems((selectedInvoice.lineItems || []).map((li: InvoiceLineItem) => ({
      description: li.description || "",
      quantity: String(li.quantity || 1),
      unitPrice: String(li.unitPrice || "0"),
      servicePricingId: li.servicePricingId || undefined,
      visitId: li.visitId || undefined,
    })));
    setEditDueDate(selectedInvoice.dueDate || "");
    setEditTaxRate(String(selectedInvoice.taxRate || "0"));
    setEditDiscountType(selectedInvoice.discountType || "");
    setEditDiscountValue(String(selectedInvoice.discountValue || "0"));
    setEditNotes(selectedInvoice.notes || "");
    setEditMode(true);
  }

  const updateInvoiceMutation = useMutation({
    mutationFn: async () => {
      if (!selectedInvoice) throw new Error("No invoice selected");
      const body: Record<string, unknown> = {
        dueDate: editDueDate,
        taxRate: editTaxRate,
        discountType: editDiscountType || null,
        discountValue: editDiscountValue,
        notes: editNotes || null,
        lineItems: editLineItems.map(li => ({
          description: li.description,
          quantity: parseInt(li.quantity) || 1,
          unitPrice: li.unitPrice,
          servicePricingId: li.servicePricingId || null,
          visitId: li.visitId || null,
        })),
      };
      const res = await apiRequest("PATCH", `/api/invoices/${selectedInvoice.id}`, body);
      return res.json();
    },
    onSuccess: (data: InvoiceWithLineItems) => {
      queryClient.invalidateQueries({ predicate: (query) => (query.queryKey[0] as string)?.startsWith("/api/invoices") });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      setSelectedInvoice(data);
      setEditMode(false);
      toast({ title: "Invoice updated", description: "Changes saved successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  function resetCreateForm() {
    setContactId("");
    setDueDate("");
    setLineItems([]);
    setDraftInvoiceIds([]);
    setTaxRate("0");
    setDiscountType("");
    setDiscountValue("0");
    setInvoiceStatus("pending");
  }

  async function handleContactSelect(newContactId: string) {
    setContactId(newContactId);
    setLineItems([]);
    setDraftInvoiceIds([]);
    if (!newContactId) {
      return;
    }
    setLoadingUninvoiced(true);
    try {
      const token = localStorage.getItem("sessionToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const [unsentRes, uninvoicedRes] = await Promise.all([
        fetch(`/api/contacts/${newContactId}/unsent-invoices`, { credentials: "include", headers }),
        fetch(`/api/contacts/${newContactId}/uninvoiced-visits`, { credentials: "include", headers }),
      ]);

      const consolidatedItems: LineItem[] = [];
      const draftIds: string[] = [];

      if (unsentRes.ok) {
        const unsentData = await unsentRes.json();
        if (unsentData.invoices && unsentData.invoices.length > 0) {
          for (const inv of unsentData.invoices) {
            draftIds.push(inv.id);
            for (const item of inv.lineItems || []) {
              consolidatedItems.push({
                description: item.description || "",
                quantity: String(item.quantity ?? "1"),
                unitPrice: item.unitPrice || "0",
                visitId: item.visitId ?? undefined,
              });
            }
          }
        }
      }

      if (uninvoicedRes.ok) {
        const uninvoicedData = await uninvoicedRes.json();
        if (uninvoicedData.visits && uninvoicedData.visits.length > 0) {
          for (const v of uninvoicedData.visits) {
            consolidatedItems.push({
              description: `${v.servicePlanName} - ${v.propertyAddress} (${v.scheduledDate})`,
              quantity: "1",
              unitPrice: v.pricePerVisit || "0",
              visitId: v.id,
            });
          }
        }
      }

      setDraftInvoiceIds(draftIds);
      setLineItems(consolidatedItems);

      if (!unsentRes.ok && !uninvoicedRes.ok) {
        toast({ title: "Could not load billing data", description: "You can still add items manually.", variant: "destructive" });
      }
    } catch (err) {
      console.error("Failed to fetch billing data:", err);
      toast({ title: "Could not load billing data", description: "You can still add items manually.", variant: "destructive" });
    } finally {
      setLoadingUninvoiced(false);
    }
  }

  function addServiceItem(pricingItem: ServicePricingItem) {
    setLineItems([...lineItems, {
      description: pricingItem.name,
      quantity: "1",
      unitPrice: pricingItem.basePrice,
      servicePricingId: pricingItem.id,
    }]);
  }

  function addCustomLineItem() {
    setLineItems([...lineItems, {
      description: "",
      quantity: "1",
      unitPrice: "0",
    }]);
  }

  function updateLineItem(index: number, updates: Partial<LineItem>) {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], ...updates };
    setLineItems(updated);
  }

  function removeLineItem(index: number) {
    setLineItems(lineItems.filter((_, i) => i !== index));
  }

  async function viewInvoiceDetail(invoiceId: string) {
    try {
      const token = localStorage.getItem("sessionToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/invoices/${invoiceId}`, { credentials: "include", headers });
      const data = await res.json();
      setSelectedInvoice(data);
      setDetailDialogOpen(true);
    } catch {
      toast({ title: "Error", description: "Failed to load invoice details", variant: "destructive" });
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const selectedId = params.get("selected");
    if (selectedId) {
      viewInvoiceDetail(selectedId);
    }
  }, []);

  const contactMap = useMemo(() => {
    const map: Record<string, Contact> = {};
    contacts?.forEach(c => { map[c.id] = c; });
    return map;
  }, [contacts]);

  const sortedInvoices = useMemo(() => {
    if (!invoices) return [];
    return [...invoices].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "invoiceNumber":
          cmp = (a.invoiceNumber || "").localeCompare(b.invoiceNumber || "", undefined, { numeric: true });
          break;
        case "contact": {
          const ca = contactMap[a.contactId];
          const cb = contactMap[b.contactId];
          const nameA = ca ? `${ca.lastName} ${ca.firstName}` : "";
          const nameB = cb ? `${cb.lastName} ${cb.firstName}` : "";
          cmp = nameA.localeCompare(nameB);
          break;
        }
        case "dueDate":
          cmp = (a.dueDate || "").localeCompare(b.dueDate || "");
          break;
        case "total":
          cmp = Number(a.total) - Number(b.total);
          break;
        case "status":
          cmp = (a.status || "").localeCompare(b.status || "");
          break;
        case "createdAt":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [invoices, sortField, sortDir, contactMap]);

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <TableHead>
      <button
        className="flex items-center gap-1 hover:text-foreground transition-colors font-medium"
        onClick={() => toggleSort(field)}
        data-testid={`sort-${field}`}
      >
        {children}
        {sortField === field ? (
          sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  );

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold" data-testid="text-invoices-heading">Invoices</h1>
          <LearnHowButton
            tutorialId="tutorial_invoice_creation"
            onStart={startTutorial}
            isCompleted={isTutorialCompleted("tutorial_invoice_creation")}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setGenerateDialogOpen(true)} data-testid="button-generate-invoice">
            <Zap className="mr-1 h-4 w-4" /> Generate from Completed Work
          </Button>
          <Button variant="outline" onClick={() => {
                if (invoiceTheme) setEditTheme({ ...invoiceTheme });
                setThemeDialogOpen(true);
              }} data-testid="button-customize-template">
                <Palette className="mr-1 h-4 w-4" /> Customize Template
              </Button>
          <Dialog open={createDialogOpen} onOpenChange={(open) => { setCreateDialogOpen(open); if (!open) resetCreateForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-invoice">
                <Plus className="mr-1 h-4 w-4" /> Create Invoice
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Invoice</DialogTitle>
                <DialogDescription>Select a customer to auto-load their unsent draft invoices and uninvoiced work into one combined invoice.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Contact</Label>
                    <Select value={contactId} onValueChange={handleContactSelect}>
                      <SelectTrigger data-testid="select-invoice-contact"><SelectValue placeholder="Select contact" /></SelectTrigger>
                      <SelectContent>
                        {contacts?.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Due Date</Label>
                    <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} data-testid="input-due-date" />
                  </div>
                </div>

                <div>
                  <Label>Status</Label>
                  <Select value={invoiceStatus} onValueChange={setInvoiceStatus}>
                    <SelectTrigger data-testid="select-invoice-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <Label className="text-sm font-medium">Line Items</Label>
                    <Button variant="default" size="sm" onClick={addCustomLineItem} data-testid="button-add-custom-item">
                      <Plus className="mr-1 h-3 w-3" /> Add Custom Charge
                    </Button>
                  </div>

                  {activePricing.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-1">Or add from service catalog:</p>
                      <div className="flex flex-wrap gap-1">
                        {activePricing.map((p) => (
                          <Button
                            key={p.id}
                            variant="outline"
                            size="sm"
                            onClick={() => addServiceItem(p)}
                            data-testid={`button-add-pricing-${p.id}`}
                          >
                            {p.name} (${parseFloat(p.basePrice).toFixed(2)})
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}

                  {draftInvoiceIds.length > 0 && (
                    <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-md p-3 text-sm text-blue-800 dark:text-blue-200" data-testid="consolidation-banner">
                      Consolidating {draftInvoiceIds.length} unsent draft invoice{draftInvoiceIds.length !== 1 ? "s" : ""} into one. The old drafts will be voided when you create this invoice.
                    </div>
                  )}

                  {loadingUninvoiced ? (
                    <div className="flex items-center justify-center py-4 gap-2" data-testid="loading-uninvoiced">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <p className="text-sm text-muted-foreground">Loading billing data...</p>
                    </div>
                  ) : lineItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-line-items">
                      {contactId
                        ? "No unsent drafts or uninvoiced work found. Use \"Add Custom Charge\" for any item, or pick from your service catalog."
                        : "Select a contact to auto-load unsent invoices, or add items manually."}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {lineItems.map((li, idx) => (
                        <Card key={idx}>
                          <CardContent className="p-3">
                            <div className="flex flex-wrap items-end gap-2">
                              <div className="flex-1 min-w-[150px]">
                                <Label className="text-xs">Description</Label>
                                <Input
                                  value={li.description}
                                  onChange={e => updateLineItem(idx, { description: e.target.value })}
                                  placeholder="e.g., Extra buckets, trip fee, supplies"
                                  data-testid={`input-line-desc-${idx}`}
                                />
                              </div>
                              <div className="w-20">
                                <Label className="text-xs">Qty</Label>
                                <Input
                                  type="number"
                                  min="1"
                                  value={li.quantity}
                                  onChange={e => updateLineItem(idx, { quantity: e.target.value })}
                                  data-testid={`input-line-qty-${idx}`}
                                />
                              </div>
                              <div className="w-28">
                                <Label className="text-xs">Unit Price</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={li.unitPrice}
                                  onChange={e => updateLineItem(idx, { unitPrice: e.target.value })}
                                  data-testid={`input-line-price-${idx}`}
                                />
                              </div>
                              <div className="w-24 text-right">
                                <Label className="text-xs">Total</Label>
                                <p className="font-medium text-sm leading-9" data-testid={`text-line-total-${idx}`}>
                                  ${((parseInt(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0)).toFixed(2)}
                                </p>
                              </div>
                              <Button variant="ghost" size="icon" onClick={() => removeLineItem(idx)} data-testid={`button-remove-line-${idx}`}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>Tax Rate (%)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={taxRate}
                      onChange={e => setTaxRate(e.target.value)}
                      data-testid="input-tax-rate"
                    />
                  </div>
                  <div>
                    <Label>Discount Type</Label>
                    <Select value={discountType || "none"} onValueChange={v => setDiscountType(v === "none" ? "" : v)}>
                      <SelectTrigger data-testid="select-discount-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="percent">Percent (%)</SelectItem>
                        <SelectItem value="amount">Amount ($)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Discount Value</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={discountValue}
                      onChange={e => setDiscountValue(e.target.value)}
                      disabled={!discountType}
                      data-testid="input-discount-value"
                    />
                  </div>
                </div>

                <Card>
                  <CardContent className="p-3 space-y-1">
                    <div className="flex flex-wrap justify-between gap-1 text-sm">
                      <span className="text-muted-foreground">Subtotal:</span>
                      <span data-testid="text-calc-subtotal">${subtotal.toFixed(2)}</span>
                    </div>
                    {discountAmount > 0 && (
                      <div className="flex flex-wrap justify-between gap-1 text-sm">
                        <span className="text-muted-foreground">Discount:</span>
                        <span className="text-red-600 dark:text-red-400" data-testid="text-calc-discount">-${discountAmount.toFixed(2)}</span>
                      </div>
                    )}
                    {taxAmount > 0 && (
                      <div className="flex flex-wrap justify-between gap-1 text-sm">
                        <span className="text-muted-foreground">Tax ({parsedTaxRate}%):</span>
                        <span data-testid="text-calc-tax">${taxAmount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex flex-wrap justify-between gap-1 font-semibold border-t pt-1">
                      <span>Total:</span>
                      <span data-testid="text-calc-total">${total.toFixed(2)}</span>
                    </div>
                  </CardContent>
                </Card>

                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={createMutation.isPending || !contactId || !dueDate || lineItems.length === 0}
                  className="w-full"
                  data-testid="button-submit-invoice"
                >
                  {createMutation.isPending ? "Creating..." : draftInvoiceIds.length > 0 ? "Consolidate & Create Invoice" : "Create Invoice"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="all" data-testid="tab-invoice-all">All</TabsTrigger>
          <TabsTrigger value="uninvoiced" data-testid="tab-invoice-uninvoiced">Uninvoiced</TabsTrigger>
          <TabsTrigger value="draft" data-testid="tab-invoice-draft">Draft</TabsTrigger>
          <TabsTrigger value="sent" data-testid="tab-invoice-sent">Sent</TabsTrigger>
          <TabsTrigger value="awaiting" data-testid="tab-invoice-awaiting">Awaiting Payment</TabsTrigger>
          <TabsTrigger value="pending" data-testid="tab-invoice-pending">Pending</TabsTrigger>
          <TabsTrigger value="paid" data-testid="tab-invoice-paid">Paid</TabsTrigger>
          <TabsTrigger value="failed" data-testid="tab-invoice-failed">Failed</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : statusFilter === "uninvoiced" ? (
        <div className="space-y-3">
          {uninvoicedLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : uninvoicedSummary && uninvoicedSummary.count > 0 ? (
            <>
              <Card>
                <CardContent className="p-4" data-testid="text-uninvoiced-total">
                  <p className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">{uninvoicedSummary.count}</span> completed visit{uninvoicedSummary.count !== 1 ? "s" : ""} worth{" "}
                    <span className="font-semibold text-foreground">${uninvoicedSummary.totalDollars.toFixed(2)}</span> need invoicing
                  </p>
                </CardContent>
              </Card>
              {uninvoicedSummary.byContact.map((entry) => (
                <Card key={entry.contactId} data-testid={`card-uninvoiced-${entry.contactId}`}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div>
                      <p className="font-medium" data-testid={`text-uninvoiced-name-${entry.contactId}`}>{entry.contactName}</p>
                      <p className="text-sm text-muted-foreground">
                        {entry.count} visit{entry.count !== 1 ? "s" : ""} -- ${entry.totalDollars.toFixed(2)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setGenerateDialogOpen(true)}
                      data-testid={`button-generate-invoice-${entry.contactId}`}
                    >
                      <Zap className="mr-1 h-4 w-4" /> Generate Invoice
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </>
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-no-uninvoiced">
                All completed visits have been invoiced.
              </CardContent>
            </Card>
          )}
        </div>
      ) : sortedInvoices.length > 0 ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader field="invoiceNumber">Invoice</SortHeader>
                <SortHeader field="contact">Client</SortHeader>
                <SortHeader field="createdAt">Created</SortHeader>
                <SortHeader field="dueDate">Due Date</SortHeader>
                <SortHeader field="total">Amount</SortHeader>
                <SortHeader field="status">Status</SortHeader>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedInvoices.map((invoice) => {
                const contact = contactMap[invoice.contactId];
                const isOverdue = invoice.dueDate && invoice.status !== "paid" && invoice.status !== "voided" && new Date(invoice.dueDate + "T23:59:59") < new Date();
                return (
                  <TableRow
                    key={invoice.id}
                    data-testid={`row-invoice-${invoice.id}`}
                    className={`cursor-pointer ${isOverdue ? "bg-red-50/60 dark:bg-red-950/20" : ""}`}
                    onClick={() => viewInvoiceDetail(invoice.id)}
                  >
                    <TableCell className="font-medium" data-testid={`text-invoice-number-${invoice.id}`}>
                      <div className="flex items-center gap-2">
                        {isOverdue && <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />}
                        {invoice.invoiceNumber}
                        {invoice.autoGenerated && (
                          <Badge variant="outline" className="text-xs">Auto</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {contact ? (
                        <ClientInfoPopover contactId={contact.id}>
                          <span className="hover:underline">{contact.firstName} {contact.lastName}</span>
                        </ClientInfoPopover>
                      ) : <span className="text-muted-foreground">Unknown</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(invoice.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className={isOverdue ? "text-red-600 dark:text-red-400 font-medium" : ""}>
                      {invoice.dueDate}{isOverdue ? " (Overdue)" : ""}
                    </TableCell>
                    <TableCell className="font-semibold" data-testid={`text-invoice-total-${invoice.id}`}>
                      ${Number(invoice.total).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={invoiceStatusColors[invoice.status] || ""} data-testid={`badge-invoice-status-${invoice.id}`}>
                        {invoiceStatusLabels[invoice.status] || invoice.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setPreviewInvoiceId(invoice.id);
                            setPreviewDialogOpen(true);
                          }}
                          data-testid={`button-preview-invoice-${invoice.id}`}
                          title="Preview invoice"
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        {invoice.status !== "paid" && stripeConfig?.configured && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => chargeMutation.mutate(invoice.id)}
                              disabled={chargeMutation.isPending}
                              data-testid={`button-charge-invoice-${invoice.id}`}
                              title="Charge card on file"
                            >
                              <CreditCard className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => checkoutMutation.mutate(invoice.id)}
                              disabled={checkoutMutation.isPending}
                              data-testid={`button-checkout-invoice-${invoice.id}`}
                              title="Send to Stripe Checkout"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {invoice.status !== "paid" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => markPaidMutation.mutate(invoice.id)}
                            disabled={markPaidMutation.isPending}
                            data-testid={`button-markpaid-invoice-${invoice.id}`}
                            title="Mark as paid"
                          >
                            <span className="text-xs font-bold">$</span>
                          </Button>
                        )}
                        {invoice.status !== "paid" && (
                          <Button
                            variant="default"
                            size="sm"
                            className="h-8"
                            onClick={() => sendEmailMutation.mutate(invoice.id)}
                            disabled={sendEmailMutation.isPending}
                            data-testid={`button-email-invoice-${invoice.id}`}
                          >
                            {sendEmailMutation.isPending && sendEmailMutation.variables === invoice.id
                              ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                              : <Mail className="mr-1 h-4 w-4" />}
                            Send
                          </Button>
                        )}
                        {invoice.status !== "paid" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              if (window.confirm("Permanently delete this invoice? This cannot be undone.")) {
                                deleteMutation.mutate(invoice.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-invoice-${invoice.id}`}
                            title="Delete invoice"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-no-invoices">
            No invoices found. Create your first invoice or auto-generate from completed services.
          </CardContent>
        </Card>
      )}

      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle data-testid="text-preview-title">Invoice Preview</DialogTitle>
            <DialogDescription>Preview of the rendered invoice template</DialogDescription>
          </DialogHeader>
          <div className="flex-1 px-6 pb-6 min-h-0">
            {previewInvoiceId && (
              <iframe
                key={previewInvoiceId}
                src={`/invoice/${previewInvoiceId}/render`}
                className="w-full h-full border rounded-md"
                title="Invoice Preview"
                data-testid="iframe-invoice-preview"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={themeDialogOpen} onOpenChange={(open) => {
        setThemeDialogOpen(open);
        if (open && invoiceTheme) {
          setEditTheme({ ...invoiceTheme });
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-theme-title">Customize Invoice Template</DialogTitle>
            <DialogDescription>Adjust colors, fonts, and styling for your invoice template</DialogDescription>
          </DialogHeader>
          {editTheme && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="font-medium text-sm">Colors</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Primary Color</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={editTheme.primaryColor}
                        onChange={e => setEditTheme({ ...editTheme, primaryColor: e.target.value })}
                        className="h-9 w-12 rounded-md border cursor-pointer"
                        data-testid="input-theme-primary"
                      />
                      <Input
                        value={editTheme.primaryColor}
                        onChange={e => setEditTheme({ ...editTheme, primaryColor: e.target.value })}
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Accent Color</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={editTheme.accentColor}
                        onChange={e => setEditTheme({ ...editTheme, accentColor: e.target.value })}
                        className="h-9 w-12 rounded-md border cursor-pointer"
                        data-testid="input-theme-accent"
                      />
                      <Input
                        value={editTheme.accentColor}
                        onChange={e => setEditTheme({ ...editTheme, accentColor: e.target.value })}
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Text Color</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={editTheme.textColor}
                        onChange={e => setEditTheme({ ...editTheme, textColor: e.target.value })}
                        className="h-9 w-12 rounded-md border cursor-pointer"
                        data-testid="input-theme-text"
                      />
                      <Input
                        value={editTheme.textColor}
                        onChange={e => setEditTheme({ ...editTheme, textColor: e.target.value })}
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Muted Color</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={editTheme.mutedColor}
                        onChange={e => setEditTheme({ ...editTheme, mutedColor: e.target.value })}
                        className="h-9 w-12 rounded-md border cursor-pointer"
                        data-testid="input-theme-muted"
                      />
                      <Input
                        value={editTheme.mutedColor}
                        onChange={e => setEditTheme({ ...editTheme, mutedColor: e.target.value })}
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Border Color</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={editTheme.borderColor}
                        onChange={e => setEditTheme({ ...editTheme, borderColor: e.target.value })}
                        className="h-9 w-12 rounded-md border cursor-pointer"
                        data-testid="input-theme-border"
                      />
                      <Input
                        value={editTheme.borderColor}
                        onChange={e => setEditTheme({ ...editTheme, borderColor: e.target.value })}
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Background</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={editTheme.backgroundColor}
                        onChange={e => setEditTheme({ ...editTheme, backgroundColor: e.target.value })}
                        className="h-9 w-12 rounded-md border cursor-pointer"
                        data-testid="input-theme-bg"
                      />
                      <Input
                        value={editTheme.backgroundColor}
                        onChange={e => setEditTheme({ ...editTheme, backgroundColor: e.target.value })}
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Card Background</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={editTheme.cardColor}
                        onChange={e => setEditTheme({ ...editTheme, cardColor: e.target.value })}
                        className="h-9 w-12 rounded-md border cursor-pointer"
                        data-testid="input-theme-card"
                      />
                      <Input
                        value={editTheme.cardColor}
                        onChange={e => setEditTheme({ ...editTheme, cardColor: e.target.value })}
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                </div>

                <h3 className="font-medium text-sm pt-2">Typography & Layout</h3>
                <div>
                  <Label className="text-xs">Font Family</Label>
                  <Select
                    value={editTheme.fontFamily.includes("Georgia") ? "georgia" : editTheme.fontFamily.includes("Roboto") ? "roboto" : "inter"}
                    onValueChange={(val) => {
                      const fonts: Record<string, string> = {
                        inter: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
                        roboto: "'Roboto', 'Helvetica Neue', Arial, sans-serif",
                        georgia: "'Georgia', 'Times New Roman', serif",
                      };
                      if (fonts[val]) setEditTheme({ ...editTheme, fontFamily: fonts[val] });
                    }}
                  >
                    <SelectTrigger data-testid="select-theme-font"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inter">Inter (Default)</SelectItem>
                      <SelectItem value="roboto">Roboto</SelectItem>
                      <SelectItem value="georgia">Georgia (Serif)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={editTheme.fontFamily}
                    onChange={e => setEditTheme({ ...editTheme, fontFamily: e.target.value })}
                    className="mt-1 font-mono text-xs"
                    data-testid="input-theme-font-raw"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Border Radius (px)</Label>
                    <Input
                      type="number"
                      min="0"
                      max="24"
                      value={editTheme.borderRadius}
                      onChange={e => setEditTheme({ ...editTheme, borderRadius: parseInt(e.target.value) || 0 })}
                      data-testid="input-theme-radius"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Logo Size (px)</Label>
                    <Input
                      type="number"
                      min="24"
                      max="120"
                      value={editTheme.logoSize}
                      onChange={e => setEditTheme({ ...editTheme, logoSize: parseInt(e.target.value) || 56 })}
                      data-testid="input-theme-logo-size"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Show Logo</Label>
                    <Select
                      value={editTheme.showLogo === false ? "hide" : "show"}
                      onValueChange={v => setEditTheme({ ...editTheme, showLogo: v === "show" })}
                    >
                      <SelectTrigger data-testid="select-theme-show-logo">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="show">Visible</SelectItem>
                        <SelectItem value="hide">Hidden</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Logo Position</Label>
                    <Select
                      value={editTheme.logoPosition || "left"}
                      onValueChange={v => setEditTheme({ ...editTheme, logoPosition: v as "left" | "center" | "right" })}
                    >
                      <SelectTrigger data-testid="select-theme-logo-position">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="left">Left</SelectItem>
                        <SelectItem value="center">Center</SelectItem>
                        <SelectItem value="right">Right</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    onClick={() => editTheme && saveThemeMutation.mutate(editTheme)}
                    disabled={saveThemeMutation.isPending}
                    data-testid="button-save-theme"
                  >
                    {saveThemeMutation.isPending ? "Saving..." : "Save Theme"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (invoiceTheme) setEditTheme({ ...invoiceTheme });
                    }}
                    data-testid="button-reset-theme"
                  >
                    <RotateCcw className="mr-1 h-4 w-4" /> Reset
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="font-medium text-sm">Live Preview</h3>
                <div
                  className="border rounded-md p-4 text-sm"
                  style={{
                    backgroundColor: editTheme.backgroundColor,
                    color: editTheme.textColor,
                    fontFamily: editTheme.fontFamily,
                    borderRadius: `${editTheme.borderRadius}px`,
                  }}
                  data-testid="div-theme-preview"
                >
                  <div
                    className="p-3 mb-3"
                    style={{
                      backgroundColor: editTheme.primaryColor,
                      color: "#ffffff",
                      borderRadius: `${editTheme.borderRadius}px`,
                    }}
                  >
                    <p className="font-bold text-base">Your Business Name</p>
                    <p style={{ opacity: 0.8 }} className="text-xs">123 Main St | (555) 123-4567</p>
                  </div>
                  <div
                    className="p-3 mb-3"
                    style={{
                      backgroundColor: editTheme.cardColor,
                      border: `1px solid ${editTheme.borderColor}`,
                      borderRadius: `${editTheme.borderRadius}px`,
                    }}
                  >
                    <p className="font-semibold mb-1">Invoice #INV-001</p>
                    <p style={{ color: editTheme.mutedColor }} className="text-xs">Due: March 15, 2026</p>
                  </div>
                  <table className="w-full text-xs mb-3" style={{ borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: `2px solid ${editTheme.primaryColor}` }}>
                        <th className="text-left py-1">Description</th>
                        <th className="text-right py-1">Qty</th>
                        <th className="text-right py-1">Price</th>
                        <th className="text-right py-1">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: `1px solid ${editTheme.borderColor}` }}>
                        <td className="py-1">Weekly Yard Cleanup</td>
                        <td className="text-right py-1">4</td>
                        <td className="text-right py-1">$35.00</td>
                        <td className="text-right py-1">$140.00</td>
                      </tr>
                      <tr style={{ borderBottom: `1px solid ${editTheme.borderColor}` }}>
                        <td className="py-1">Initial Deep Clean</td>
                        <td className="text-right py-1">1</td>
                        <td className="text-right py-1">$75.00</td>
                        <td className="text-right py-1">$75.00</td>
                      </tr>
                    </tbody>
                  </table>
                  <div
                    className="p-2 text-right"
                    style={{
                      backgroundColor: editTheme.cardColor,
                      border: `1px solid ${editTheme.borderColor}`,
                      borderRadius: `${editTheme.borderRadius}px`,
                    }}
                  >
                    <p style={{ color: editTheme.mutedColor }} className="text-xs">Subtotal: $215.00</p>
                    <p className="font-bold" style={{ color: editTheme.accentColor }}>Total: $215.00</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={detailDialogOpen} onOpenChange={(open) => { setDetailDialogOpen(open); if (!open) setEditMode(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="flex flex-wrap items-center gap-2">
                Invoice {selectedInvoice?.invoiceNumber}
                {selectedInvoice?.source === "imported" && (
                  <Badge variant="secondary" data-testid="badge-imported-invoice">Imported</Badge>
                )}
              </DialogTitle>
              {selectedInvoice && !editMode && ["draft", "sent", "pending"].includes(selectedInvoice.status) && (
                <Button size="sm" onClick={enterEditMode} data-testid="button-edit-invoice-header">
                  <Pencil className="mr-1 h-3 w-3" /> Edit Invoice
                </Button>
              )}
            </div>
            <DialogDescription>
              {editMode ? "Edit invoice details, line items, and pricing" : "Invoice details and line items"}
            </DialogDescription>
          </DialogHeader>
          {selectedInvoice && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Contact: </span>
                  {contactMap[selectedInvoice.contactId] ? (
                    <ClientInfoPopover contactId={selectedInvoice.contactId}>
                      <span>{contactMap[selectedInvoice.contactId].firstName} {contactMap[selectedInvoice.contactId].lastName}</span>
                    </ClientInfoPopover>
                  ) : (
                    <span>Unknown</span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">Status: </span>
                  <Badge variant="secondary" className={invoiceStatusColors[selectedInvoice.status] || ""}>
                    {invoiceStatusLabels[selectedInvoice.status] || selectedInvoice.status}
                  </Badge>
                </div>
                <div>
                  {editMode ? (
                    <div>
                      <Label className="text-xs text-muted-foreground">Due Date</Label>
                      <Input type="date" value={editDueDate} onChange={e => setEditDueDate(e.target.value)} data-testid="input-edit-due-date" />
                    </div>
                  ) : (
                    <>
                      <span className="text-muted-foreground">Due: </span>
                      <span>{selectedInvoice.dueDate}</span>
                    </>
                  )}
                </div>
                {selectedInvoice.autoGenerated && (
                  <div>
                    <Badge variant="outline">Auto-generated</Badge>
                  </div>
                )}
              </div>

              {editMode ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-sm font-medium">Line Items</Label>
                    <div className="flex gap-1">
                      <Button variant="default" size="sm" onClick={() => setEditLineItems([...editLineItems, { description: "", quantity: "1", unitPrice: "0" }])} data-testid="button-edit-add-line">
                        <Plus className="mr-1 h-3 w-3" /> Add Custom Charge
                      </Button>
                      {activePricing.length > 0 && (
                        <Select onValueChange={(pId) => {
                          const p = activePricing.find(x => x.id === pId);
                          if (p) setEditLineItems([...editLineItems, { description: p.name, quantity: "1", unitPrice: p.basePrice, servicePricingId: p.id }]);
                        }}>
                          <SelectTrigger className="w-auto h-8 text-xs" data-testid="select-edit-add-service">
                            <SelectValue placeholder="From catalog" />
                          </SelectTrigger>
                          <SelectContent>
                            {activePricing.map(p => (
                              <SelectItem key={p.id} value={p.id}>{p.name} (${parseFloat(p.basePrice).toFixed(2)})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                  {editLineItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-3">No line items yet. Use "Add Custom Charge" for any item, or pick from your service catalog.</p>
                  ) : (
                    <div className="space-y-2">
                      {editLineItems.map((li, idx) => (
                        <div key={idx} className="flex flex-wrap items-end gap-2 p-2 border rounded-lg">
                          <div className="flex-1 min-w-[120px]">
                            <Label className="text-xs">Description</Label>
                            <Input
                              value={li.description}
                              onChange={e => { const u = [...editLineItems]; u[idx] = { ...u[idx], description: e.target.value }; setEditLineItems(u); }}
                              placeholder="e.g., Extra buckets, trip fee, supplies"
                              data-testid={`input-edit-line-desc-${idx}`}
                            />
                          </div>
                          <div className="w-20">
                            <Label className="text-xs">Qty</Label>
                            <Input
                              type="number" min="1"
                              value={li.quantity}
                              onChange={e => { const u = [...editLineItems]; u[idx] = { ...u[idx], quantity: e.target.value }; setEditLineItems(u); }}
                              data-testid={`input-edit-line-qty-${idx}`}
                            />
                          </div>
                          <div className="w-28">
                            <Label className="text-xs">Price</Label>
                            <Input
                              type="number" step="0.01"
                              value={li.unitPrice}
                              onChange={e => { const u = [...editLineItems]; u[idx] = { ...u[idx], unitPrice: e.target.value }; setEditLineItems(u); }}
                              data-testid={`input-edit-line-price-${idx}`}
                            />
                          </div>
                          <div className="w-20 text-right">
                            <Label className="text-xs">Total</Label>
                            <p className="font-medium text-sm leading-9">${((parseInt(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0)).toFixed(2)}</p>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => setEditLineItems(editLineItems.filter((_, i) => i !== idx))} data-testid={`button-edit-remove-line-${idx}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Tax Rate (%)</Label>
                      <Input type="number" step="0.01" min="0" value={editTaxRate} onChange={e => setEditTaxRate(e.target.value)} data-testid="input-edit-tax-rate" />
                    </div>
                    <div>
                      <Label className="text-xs">Discount Type</Label>
                      <Select value={editDiscountType || "none"} onValueChange={v => setEditDiscountType(v === "none" ? "" : v)}>
                        <SelectTrigger data-testid="select-edit-discount-type"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="percent">Percent (%)</SelectItem>
                          <SelectItem value="amount">Amount ($)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Discount Value</Label>
                      <Input type="number" step="0.01" min="0" value={editDiscountValue} onChange={e => setEditDiscountValue(e.target.value)} disabled={!editDiscountType} data-testid="input-edit-discount-value" />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">Notes / Memo</Label>
                    <Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Add notes for this invoice..." rows={2} data-testid="input-edit-notes" />
                  </div>

                  <Card>
                    <CardContent className="p-3 space-y-1 text-sm">
                      <div className="flex flex-wrap justify-between gap-1">
                        <span className="text-muted-foreground">Subtotal:</span>
                        <span>${editSubtotal.toFixed(2)}</span>
                      </div>
                      {editDiscountAmount > 0 && (
                        <div className="flex flex-wrap justify-between gap-1">
                          <span className="text-muted-foreground">Discount:</span>
                          <span className="text-red-600 dark:text-red-400">-${editDiscountAmount.toFixed(2)}</span>
                        </div>
                      )}
                      {editTaxAmount > 0 && (
                        <div className="flex flex-wrap justify-between gap-1">
                          <span className="text-muted-foreground">Tax ({editParsedTaxRate}%):</span>
                          <span>${editTaxAmount.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex flex-wrap justify-between gap-1 font-semibold border-t pt-1">
                        <span>Total:</span>
                        <span>${editTotal.toFixed(2)}</span>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="flex gap-2">
                    <Button onClick={() => updateInvoiceMutation.mutate()} disabled={updateInvoiceMutation.isPending || editLineItems.length === 0} className="flex-1" data-testid="button-save-invoice-edit">
                      <Save className="mr-1 h-4 w-4" /> {updateInvoiceMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                    <Button variant="outline" onClick={() => setEditMode(false)} data-testid="button-cancel-edit">Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  {selectedInvoice.lineItems && selectedInvoice.lineItems.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-2">Line Items</h4>
                      <div className="space-y-1">
                        {selectedInvoice.lineItems.map((li: InvoiceLineItem, idx: number) => (
                          <div key={idx} className="flex flex-wrap justify-between gap-2 text-sm py-1 border-b last:border-0">
                            <span>{li.description}</span>
                            <span>{li.quantity} x ${Number(li.unitPrice).toFixed(2)} = ${Number(li.total).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedInvoice.notes && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Notes: </span>
                      <span>{selectedInvoice.notes}</span>
                    </div>
                  )}

                  <Card>
                    <CardContent className="p-3 space-y-1 text-sm">
                      <div className="flex flex-wrap justify-between gap-1">
                        <span className="text-muted-foreground">Subtotal:</span>
                        <span>${Number(selectedInvoice.subtotal).toFixed(2)}</span>
                      </div>
                      {Number(selectedInvoice.discountAmount) > 0 && (
                        <div className="flex flex-wrap justify-between gap-1">
                          <span className="text-muted-foreground">
                            Discount ({selectedInvoice.discountType === "percent" ? `${selectedInvoice.discountValue}%` : `$${Number(selectedInvoice.discountValue).toFixed(2)}`}):
                          </span>
                          <span className="text-red-600 dark:text-red-400">-${Number(selectedInvoice.discountAmount).toFixed(2)}</span>
                        </div>
                      )}
                      {Number(selectedInvoice.tax) > 0 && (
                        <div className="flex flex-wrap justify-between gap-1">
                          <span className="text-muted-foreground">Tax ({selectedInvoice.taxRate}%):</span>
                          <span>${Number(selectedInvoice.tax).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex flex-wrap justify-between gap-1 font-semibold border-t pt-1">
                        <span>Total:</span>
                        <span>${Number(selectedInvoice.total).toFixed(2)}</span>
                      </div>
                    </CardContent>
                  </Card>

                  <PaymentHistorySection
                    invoiceId={selectedInvoice.id}
                    invoiceTotal={Number(selectedInvoice.total)}
                  />

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => {
                      setDetailDialogOpen(false);
                      setPreviewInvoiceId(selectedInvoice.id);
                      setPreviewDialogOpen(true);
                    }} data-testid="button-detail-preview">
                      <Printer className="mr-1 h-3 w-3" /> Preview
                    </Button>
                    {selectedInvoice.status !== "paid" && stripeConfig?.configured && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => { chargeMutation.mutate(selectedInvoice.id); setDetailDialogOpen(false); }} disabled={chargeMutation.isPending}>
                          <CreditCard className="mr-1 h-3 w-3" /> Charge Now
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { checkoutMutation.mutate(selectedInvoice.id); }} disabled={checkoutMutation.isPending}>
                          <ExternalLink className="mr-1 h-3 w-3" /> Payment Link
                        </Button>
                      </>
                    )}
                    {selectedInvoice.status !== "paid" && (
                      <Button size="sm" variant="outline" onClick={() => { markPaidMutation.mutate(selectedInvoice.id); setDetailDialogOpen(false); }}>
                        Mark as Paid
                      </Button>
                    )}
                    {selectedInvoice.status !== "paid" && (
                      <Button size="sm" variant="default" onClick={() => sendEmailMutation.mutate(selectedInvoice.id)} disabled={sendEmailMutation.isPending} data-testid="button-send-invoice-email">
                        {sendEmailMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Mail className="mr-1 h-3 w-3" />} Send to Client
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <GenerateInvoiceDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
        showContactPicker
      />
    </div>
  );
}
