import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Invoice, Contact, ServicePricingItem, InvoicePayment } from "@shared/schema";
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
import { Plus, FileText, Mail, Trash2, Eye, Zap, Printer, CreditCard, ExternalLink, Palette, RotateCcw, Ban } from "lucide-react";
import { ClientInfoPopover } from "@/components/client-info-popover";
import { GenerateInvoiceDialog } from "@/components/generate-invoice-dialog";

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
  lineItems?: any[];
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

export default function Invoices() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
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


  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewInvoiceId, setPreviewInvoiceId] = useState<string | null>(null);
  const [themeDialogOpen, setThemeDialogOpen] = useState(false);

  const queryParams = statusFilter !== "all" ? `?status=${statusFilter}` : "";

  const { data: invoices, isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices", statusFilter],
    queryFn: () => {
      const token = localStorage.getItem("sessionToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return fetch(`/api/invoices${queryParams}`, { credentials: "include", headers }).then(r => {
        if (!r.ok) throw new Error("Failed to fetch invoices");
        return r.json();
      });
    },
  });

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const { data: pricing } = useQuery<ServicePricingItem[]>({
    queryKey: ["/api/pricing"],
  });

  const activePricing = useMemo(() => pricing?.filter(p => p.isActive) || [], [pricing]);

  const subtotal = useMemo(() => lineItems.reduce((sum, li) => sum + (parseInt(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0), 0), [lineItems]);
  const parsedDiscountValue = parseFloat(discountValue) || 0;
  const discountAmount = discountType === "percent" ? subtotal * (parsedDiscountValue / 100) : discountType === "amount" ? parsedDiscountValue : 0;
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
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
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
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ predicate: (query) => (query.queryKey[0] as string)?.startsWith("/api/invoices") });
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
    onSuccess: (data: any) => {
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => (query.queryKey[0] as string)?.startsWith("/api/invoices") });
      toast({ title: "Invoice created", description: "New invoice has been created." });
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
      toast({ title: "Invoice updated", description: "Invoice marked as paid." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const voidMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      await apiRequest("PATCH", `/api/invoices/${invoiceId}`, { status: "voided" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => (query.queryKey[0] as string)?.startsWith("/api/invoices") });
      toast({ title: "Invoice voided", description: "Invoice has been voided." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  function resetCreateForm() {
    setContactId("");
    setDueDate("");
    setLineItems([]);
    setTaxRate("0");
    setDiscountType("");
    setDiscountValue("0");
    setInvoiceStatus("pending");
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

  const contactMap = useMemo(() => {
    const map: Record<string, Contact> = {};
    contacts?.forEach(c => { map[c.id] = c; });
    return map;
  }, [contacts]);

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-invoices-heading">Invoices</h1>
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
                <DialogDescription>Select services and set pricing for the invoice.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Contact</Label>
                    <Select value={contactId} onValueChange={setContactId}>
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
                    <Button variant="outline" size="sm" onClick={addCustomLineItem} data-testid="button-add-custom-item">
                      <Plus className="mr-1 h-3 w-3" /> Add Line Item
                    </Button>
                  </div>

                  {activePricing.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-1">Add from service catalog:</p>
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

                  {lineItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-line-items">
                      No line items added. Use the buttons above to add services or custom items.
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
                                  placeholder="Service description"
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
                    <Select value={discountType} onValueChange={setDiscountType}>
                      <SelectTrigger data-testid="select-discount-type"><SelectValue placeholder="None" /></SelectTrigger>
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
                      disabled={!discountType || discountType === "none"}
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
                  {createMutation.isPending ? "Creating..." : "Create Invoice"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="all" data-testid="tab-invoice-all">All</TabsTrigger>
          <TabsTrigger value="draft" data-testid="tab-invoice-draft">Draft</TabsTrigger>
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
      ) : invoices && invoices.length > 0 ? (
        <div className="space-y-3">
          {invoices.map((invoice) => {
            const contact = contactMap[invoice.contactId];
            return (
              <Card key={invoice.id} data-testid={`card-invoice-${invoice.id}`}>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="font-medium" data-testid={`text-invoice-number-${invoice.id}`}>
                        {invoice.invoiceNumber}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {contact ? (
                          <ClientInfoPopover contactId={contact.id}>
                            <span className="inline">{contact.firstName} {contact.lastName}</span>
                          </ClientInfoPopover>
                        ) : "Unknown"} -- Due: {invoice.dueDate}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {invoice.autoGenerated && (
                      <Badge variant="outline" className="text-xs">Auto</Badge>
                    )}
                    <span className="font-semibold" data-testid={`text-invoice-total-${invoice.id}`}>
                      ${Number(invoice.total).toFixed(2)}
                    </span>
                    <Badge variant="secondary" className={invoiceStatusColors[invoice.status] || ""} data-testid={`badge-invoice-status-${invoice.id}`}>
                      {invoiceStatusLabels[invoice.status] || invoice.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => viewInvoiceDetail(invoice.id)}
                      data-testid={`button-view-invoice-${invoice.id}`}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
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
                        onClick={() => markPaidMutation.mutate(invoice.id)}
                        disabled={markPaidMutation.isPending}
                        data-testid={`button-markpaid-invoice-${invoice.id}`}
                        title="Mark as paid"
                      >
                        <span className="text-xs font-bold">$</span>
                      </Button>
                    )}
                    {invoice.status !== "paid" && invoice.status !== "voided" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => sendEmailMutation.mutate(invoice.id)}
                        disabled={sendEmailMutation.isPending}
                        data-testid={`button-email-invoice-${invoice.id}`}
                      >
                        <Mail className="mr-1 h-4 w-4" />
                        Send
                      </Button>
                    )}
                    {invoice.status !== "paid" && invoice.status !== "voided" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => voidMutation.mutate(invoice.id)}
                        disabled={voidMutation.isPending}
                        data-testid={`button-void-invoice-${invoice.id}`}
                        title="Void invoice"
                      >
                        <Ban className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
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
                    value={editTheme.fontFamily.includes("Inter") ? "inter" : editTheme.fontFamily.includes("Georgia") ? "georgia" : editTheme.fontFamily.includes("Roboto") ? "roboto" : "custom"}
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
                      <SelectItem value="custom">Custom</SelectItem>
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

      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              Invoice {selectedInvoice?.invoiceNumber}
              {selectedInvoice?.source === "imported" && (
                <Badge variant="secondary" data-testid="badge-imported-invoice">Imported</Badge>
              )}
            </DialogTitle>
            <DialogDescription>Invoice details and line items</DialogDescription>
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
                  <span className="text-muted-foreground">Due: </span>
                  <span>{selectedInvoice.dueDate}</span>
                </div>
                {selectedInvoice.autoGenerated && (
                  <div>
                    <Badge variant="outline">Auto-generated</Badge>
                  </div>
                )}
              </div>

              {selectedInvoice.lineItems && selectedInvoice.lineItems.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-2">Line Items</h4>
                  <div className="space-y-1">
                    {selectedInvoice.lineItems.map((li: any, idx: number) => (
                      <div key={idx} className="flex flex-wrap justify-between gap-2 text-sm py-1 border-b last:border-0">
                        <span>{li.description}</span>
                        <span>{li.quantity} x ${Number(li.unitPrice).toFixed(2)} = ${Number(li.total).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
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
                  <Button size="sm" variant="outline" onClick={() => sendEmailMutation.mutate(selectedInvoice.id)} disabled={sendEmailMutation.isPending} data-testid="button-send-invoice-email">
                    <Mail className="mr-1 h-3 w-3" /> Send to Client
                  </Button>
                )}
              </div>
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
