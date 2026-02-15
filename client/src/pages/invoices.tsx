import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Invoice, Contact, ServicePricingItem } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Plus, FileText, Mail, Trash2, Eye, Zap, Printer } from "lucide-react";

const invoiceStatusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  pending: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
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

  const [genContactId, setGenContactId] = useState("");
  const [genStartDate, setGenStartDate] = useState("");
  const [genEndDate, setGenEndDate] = useState("");
  const [genMode, setGenMode] = useState("completed");

  const queryParams = statusFilter !== "all" ? `?status=${statusFilter}` : "";

  const { data: invoices, isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices", statusFilter],
    queryFn: () => fetch(`/api/invoices${queryParams}`, { credentials: "include" }).then(r => {
      if (!r.ok) throw new Error("Failed to fetch invoices");
      return r.json();
    }),
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

  const sendEmailMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      await apiRequest("POST", `/api/invoices/${invoiceId}/send-email`);
    },
    onSuccess: () => {
      toast({ title: "Invoice emailed", description: "Invoice sent to the client's email." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send", description: error.message, variant: "destructive" });
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

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!genContactId || !genStartDate || !genEndDate) throw new Error("All fields required");
      const res = await apiRequest("POST", "/api/invoices/generate", {
        contactId: genContactId,
        startDate: genStartDate,
        endDate: genEndDate,
        mode: genMode,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ predicate: (query) => (query.queryKey[0] as string)?.startsWith("/api/invoices") });
      if (data.invoice) {
        toast({ title: "Invoice generated", description: `Invoice ${data.invoiceNumber || ""} created for the selected period.` });
      } else {
        toast({ title: "No billable visits", description: data.message || "No visits found for that period." });
      }
      setGenerateDialogOpen(false);
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
      const res = await fetch(`/api/invoices/${invoiceId}`, { credentials: "include" });
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
          <Dialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-generate-invoice">
                <Zap className="mr-1 h-4 w-4" /> Auto-Generate
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Auto-Generate Invoice</DialogTitle>
                <DialogDescription>Generate an invoice from visits in a date range for a specific client.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Contact</Label>
                  <Select value={genContactId} onValueChange={setGenContactId}>
                    <SelectTrigger data-testid="select-gen-contact"><SelectValue placeholder="Select contact" /></SelectTrigger>
                    <SelectContent>
                      {contacts?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Mode</Label>
                  <Select value={genMode} onValueChange={setGenMode}>
                    <SelectTrigger data-testid="select-gen-mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="completed">Completed visits</SelectItem>
                      <SelectItem value="scheduled">Scheduled visits</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Start Date</Label>
                    <Input type="date" value={genStartDate} onChange={e => setGenStartDate(e.target.value)} data-testid="input-gen-start-date" />
                  </div>
                  <div>
                    <Label>End Date</Label>
                    <Input type="date" value={genEndDate} onChange={e => setGenEndDate(e.target.value)} data-testid="input-gen-end-date" />
                  </div>
                </div>
                <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} data-testid="button-submit-generate">
                  {generateMutation.isPending ? "Generating..." : "Generate Invoice"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
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
                      <Plus className="mr-1 h-3 w-3" /> Custom Item
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
                        <span className="text-red-600" data-testid="text-calc-discount">-${discountAmount.toFixed(2)}</span>
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
                        {contact ? `${contact.firstName} ${contact.lastName}` : "Unknown"} -- Due: {invoice.dueDate}
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
                      {invoice.status}
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
                      onClick={() => window.open(`/invoice/${invoice.id}/render`, "_blank")}
                      data-testid={`button-print-invoice-${invoice.id}`}
                      title="Print invoice"
                    >
                      <Printer className="h-4 w-4" />
                    </Button>
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
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => sendEmailMutation.mutate(invoice.id)}
                      disabled={sendEmailMutation.isPending}
                      data-testid={`button-email-invoice-${invoice.id}`}
                    >
                      <Mail className="h-4 w-4" />
                    </Button>
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

      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Invoice {selectedInvoice?.invoiceNumber}</DialogTitle>
            <DialogDescription>Invoice details and line items</DialogDescription>
          </DialogHeader>
          {selectedInvoice && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Contact: </span>
                  <span>{contactMap[selectedInvoice.contactId]?.firstName} {contactMap[selectedInvoice.contactId]?.lastName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status: </span>
                  <Badge variant="secondary" className={invoiceStatusColors[selectedInvoice.status] || ""}>
                    {selectedInvoice.status}
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
                      <span className="text-red-600">-${Number(selectedInvoice.discountAmount).toFixed(2)}</span>
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

              <div className="flex flex-wrap gap-2">
                {selectedInvoice.status !== "paid" && (
                  <Button size="sm" variant="outline" onClick={() => { markPaidMutation.mutate(selectedInvoice.id); setDetailDialogOpen(false); }}>
                    Mark as Paid
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => sendEmailMutation.mutate(selectedInvoice.id)} disabled={sendEmailMutation.isPending}>
                  <Mail className="mr-1 h-3 w-3" /> Send to Client
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
