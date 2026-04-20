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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, FileText, Mail, Trash2, Zap, Printer, CreditCard, ExternalLink, Palette, RotateCcw, Pencil, Save, Loader2, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, DollarSign, Clock, CheckCircle2, ChevronDown, ChevronRight, SendHorizonal, RefreshCw, Square, CheckSquare, Bell, Settings, X, History, Eye, ShieldCheck, Users, Calendar, AlertCircle, Activity } from "lucide-react";
import { useLocation } from "wouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ClientInfoPopover } from "@/components/client-info-popover";
import { GenerateInvoiceDialog, GenerateByDateRangeDialog } from "@/components/generate-invoice-dialog";
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

interface ReminderLog {
  id: string;
  contactId: string;
  reminderType: string;
  channel: string;
  messagePreview: string;
  deliveryStatus: string;
  sentAt: string;
}

function CollectionsPanel({
  invoice,
  contact,
  onSendReminder,
  onRetryCharge,
  sendReminderPending,
  retryChargePending,
  stripeConfigured,
}: {
  invoice: Invoice;
  contact?: Contact;
  onSendReminder: () => void;
  onRetryCharge: () => void;
  sendReminderPending: boolean;
  retryChargePending: boolean;
  stripeConfigured: boolean;
}) {
  const { data: reminderLogsData } = useQuery<{ logs: ReminderLog[]; total: number }>({
    queryKey: ["/api/company/reminder-logs"],
    enabled: !!contact?.id,
  });

  const contactReminderLogs = useMemo(() => {
    if (!reminderLogsData?.logs || !contact?.id) return [];
    return reminderLogsData.logs
      .filter(l => l.contactId === contact.id && l.reminderType.startsWith("invoice"))
      .slice(0, 5);
  }, [reminderLogsData, contact?.id]);

  const hasAutopay = !!(contact?.autoPayEnabled && contact?.stripeCustomerId);
  const isOverdue = invoice.dueDate && new Date(invoice.dueDate + "T23:59:59") < new Date();
  const isFailed = invoice.status === "failed";

  return (
    <Card data-testid="collections-panel" className={isOverdue ? "border-red-200 dark:border-red-900" : ""}>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          Collections
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        {contact && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {hasAutopay
                ? <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1"><CreditCard className="h-3 w-3" /> Autopay enabled</span>
                : <span className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> No autopay</span>
              }
            </span>
            {contact.email && <span>{contact.email}</span>}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onSendReminder}
            disabled={sendReminderPending || (!contact?.email && !contact?.phone)}
            data-testid="button-send-payment-reminder"
          >
            {sendReminderPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Mail className="mr-1 h-3.5 w-3.5" />}
            Send Reminder
          </Button>
          {stripeConfigured && hasAutopay && (
            <Button
              size="sm"
              variant="outline"
              onClick={onRetryCharge}
              disabled={retryChargePending}
              data-testid="button-retry-charge"
              className={isFailed ? "border-red-400 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950" : ""}
            >
              {retryChargePending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CreditCard className="mr-1 h-3.5 w-3.5" />}
              {isFailed ? "Retry Charge" : "Charge Card"}
            </Button>
          )}
        </div>

        {contactReminderLogs.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <History className="h-3 w-3" /> Recent Reminders
            </p>
            <div className="space-y-1">
              {contactReminderLogs.map(log => (
                <div key={log.id} className="text-xs flex items-center justify-between gap-2 py-0.5" data-testid={`reminder-log-${log.id}`}>
                  <span className="text-muted-foreground truncate flex-1">{log.messagePreview?.substring(0, 60)}…</span>
                  <Badge variant="outline" className={`shrink-0 text-[10px] px-1.5 py-0 h-4 ${log.deliveryStatus === "sent" ? "border-green-400 text-green-700 dark:text-green-400" : "border-red-400 text-red-600"}`}>
                    {log.channel} · {log.deliveryStatus}
                  </Badge>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {new Date(log.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {contactReminderLogs.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No reminder history for this client.</p>
        )}
      </CardContent>
    </Card>
  );
}

function UninvoicedVisitBreakdown({ contactId }: { contactId: string }) {
  const { data, isLoading } = useQuery<{ visits: { id: string; scheduledDate: string; servicePlanName: string; pricePerVisit: string; propertyAddress: string }[]; totalDollars: number }>({
    queryKey: ["/api/contacts", contactId, "uninvoiced-visits"],
    queryFn: () => apiRequest("GET", `/api/contacts/${contactId}/uninvoiced-visits`).then(r => r.json()),
  });

  if (isLoading) {
    return (
      <div className="px-4 pb-3 space-y-1.5">
        {[1, 2].map(i => <Skeleton key={i} className="h-7 w-full" />)}
      </div>
    );
  }

  if (!data || data.visits.length === 0) {
    return (
      <p className="px-4 pb-3 text-xs text-muted-foreground" data-testid={`text-no-uninvoiced-visits-${contactId}`}>
        No visit details available.
      </p>
    );
  }

  return (
    <div className="px-4 pb-3 pt-0 border-t mt-0" data-testid={`breakdown-uninvoiced-${contactId}`}>
      <div className="mt-2 space-y-1">
        {data.visits.map(visit => (
          <div
            key={visit.id}
            className="flex items-center justify-between text-xs text-muted-foreground py-1"
            data-testid={`row-visit-detail-${visit.id}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium text-foreground shrink-0">{visit.scheduledDate}</span>
              <span className="truncate hidden sm:inline">{visit.servicePlanName}</span>
              {visit.propertyAddress && visit.propertyAddress !== "Unknown" && (
                <span className="truncate text-muted-foreground/70 hidden md:inline">{visit.propertyAddress}</span>
              )}
            </div>
            <span className="font-medium text-foreground shrink-0 ml-3">${parseFloat(visit.pricePerVisit).toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface BillingHealthData {
  autopayCustomers: number;
  totalCustomers: number;
  autopayPercent: number;
  autopayContacts: Array<{ id: string; name: string }>;
  missingPaymentMethod: number;
  failedPayments: number;
  upcomingChargesTotal: number;
  upcomingChargesCustomers: number;
  upcomingCharges: Array<{ date: string; customers: number; totalCents: number; invoiceIds: string[] }>;
  misconfigurations: Array<{ contactId: string; contactName: string; issue: string }>;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" });
}

function BillingHealthPanel({ onSwitchToFailed }: { onSwitchToFailed: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [showAutopayList, setShowAutopayList] = useState(false);
  const [miscFilter, setMiscFilter] = useState<"all" | "no_payment_method" | "failed_charge" | "no_billing_rule">("all");

  const { data: health, isLoading, refetch } = useQuery<BillingHealthData>({
    queryKey: ["/api/billing/health"],
  });

  const chargeByDateMutation = useMutation({
    mutationFn: async (date: string) => {
      return apiRequest("POST", "/api/billing/charge-by-date", { date });
    },
    onSuccess: (_data, date) => {
      toast({ title: "Charges initiated", description: `Batch charge for ${formatDateLabel(date)} started.` });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to initiate batch charges.", variant: "destructive" });
    },
  });

  const runAllMutation = useMutation({
    mutationFn: async () => {
      if (!health) return;
      for (const row of health.upcomingCharges) {
        await apiRequest("POST", "/api/billing/charge-by-date", { date: row.date });
      }
    },
    onSuccess: () => {
      toast({ title: "All charges initiated", description: "Batch charges for all upcoming dates started." });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to initiate all charges.", variant: "destructive" });
    },
  });

  const retryAllMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("GET", "/api/invoices?status=failed");
      const failed: Array<{ id: string }> = await r.json();
      for (const inv of failed) {
        await apiRequest("POST", `/api/invoices/${inv.id}/charge`, {}).catch(() => {});
      }
    },
    onSuccess: () => {
      toast({ title: "Retrying failed payments", description: "All failed invoices are being retried." });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to retry invoices.", variant: "destructive" });
    },
  });

  const filteredMisconfigs = health?.misconfigurations.filter(m => {
    if (miscFilter === "all") return true;
    return m.issue === miscFilter;
  }) ?? [];

  const issueLabel: Record<string, string> = {
    no_payment_method: "Autopay on, no payment method",
    failed_charge: "Last charge failed",
    no_billing_rule: "No billing rule configured",
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!health) return null;

  return (
    <div className="space-y-6" data-testid="panel-billing-health">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          data-testid="card-autopay-customers"
          onClick={() => setShowAutopayList(v => !v)}
        >
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground font-medium">Autopay Customers</p>
                <p className="text-3xl font-bold mt-1">{health.autopayCustomers}</p>
                <p className="text-xs text-muted-foreground mt-1">{health.autopayPercent}% adoption · {health.totalCustomers} total</p>
              </div>
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
            </div>
            {health.autopayCustomers > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full text-xs h-7"
                onClick={(e) => { e.stopPropagation(); setShowAutopayList(v => !v); }}
                data-testid="button-view-autopay-list"
              >
                {showAutopayList ? "Collapse" : "View All"}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer hover:border-primary/50 transition-colors ${health.missingPaymentMethod > 0 ? "border-amber-300 dark:border-amber-700" : ""}`}
          data-testid="card-missing-payment"
          onClick={() => setMiscFilter("no_payment_method")}
        >
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground font-medium">Missing Payment Method</p>
                <p className="text-3xl font-bold mt-1">{health.missingPaymentMethod}</p>
                <p className="text-xs text-muted-foreground mt-1">autopay on, no card</p>
              </div>
              <div className={`p-2 rounded-lg ${health.missingPaymentMethod > 0 ? "bg-amber-100 dark:bg-amber-900/30" : "bg-muted"}`}>
                <Users className={`h-5 w-5 ${health.missingPaymentMethod > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} />
              </div>
            </div>
            {health.missingPaymentMethod > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full text-xs h-7"
                onClick={(e) => { e.stopPropagation(); setMiscFilter("no_payment_method"); }}
                data-testid="button-fix-missing-payment"
              >
                Fix Now
              </Button>
            )}
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          data-testid="card-upcoming-charges"
          onClick={() => setShowUpcoming(v => !v)}
        >
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground font-medium">Upcoming Charges (7d)</p>
                <p className="text-3xl font-bold mt-1">${(health.upcomingChargesTotal / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <p className="text-xs text-muted-foreground mt-1">across {health.upcomingChargesCustomers} customer{health.upcomingChargesCustomers !== 1 ? "s" : ""}</p>
              </div>
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <Calendar className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            {health.upcomingCharges.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full text-xs h-7"
                onClick={(e) => { e.stopPropagation(); setShowUpcoming(v => !v); }}
                data-testid="button-review-upcoming"
              >
                {showUpcoming ? "Collapse" : "Review"}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer hover:border-primary/50 transition-colors ${health.failedPayments > 0 ? "border-red-300 dark:border-red-800" : ""}`}
          data-testid="card-failed-payments"
          onClick={() => onSwitchToFailed()}
        >
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground font-medium">Failed Payments</p>
                <p className="text-3xl font-bold mt-1">{health.failedPayments}</p>
                <p className="text-xs text-muted-foreground mt-1">need attention</p>
              </div>
              <div className={`p-2 rounded-lg ${health.failedPayments > 0 ? "bg-red-100 dark:bg-red-900/30" : "bg-muted"}`}>
                <AlertCircle className={`h-5 w-5 ${health.failedPayments > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`} />
              </div>
            </div>
            {health.failedPayments > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full text-xs h-7 border-red-300 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20"
                onClick={(e) => { e.stopPropagation(); retryAllMutation.mutate(); }}
                disabled={retryAllMutation.isPending}
                data-testid="button-retry-all-failed"
              >
                {retryAllMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                Retry All
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {showAutopayList && health.autopayContacts && health.autopayContacts.length > 0 && (
        <Card data-testid="card-autopay-list">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Autopay Customers ({health.autopayContacts.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y max-h-64 overflow-y-auto">
              {health.autopayContacts.map(c => (
                <div key={c.id} className="px-4 py-2 flex items-center justify-between hover:bg-muted/50" data-testid={`row-autopay-contact-${c.id}`}>
                  <span className="text-sm">{c.name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-6 px-2"
                    onClick={() => navigate(`/contacts/${c.id}`)}
                    data-testid={`button-view-contact-${c.id}`}
                  >
                    View
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {showUpcoming && health.upcomingCharges.length > 0 && (
        <Card data-testid="card-upcoming-charges-list">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Upcoming Autopay Charges</CardTitle>
              <Button
                size="sm"
                variant="default"
                onClick={() => runAllMutation.mutate()}
                disabled={runAllMutation.isPending}
                data-testid="button-run-all-charges"
              >
                {runAllMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1 h-3.5 w-3.5" />}
                Run All
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-center">Customers</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.upcomingCharges.map((row) => (
                  <TableRow key={row.date} data-testid={`row-upcoming-charge-${row.date}`}>
                    <TableCell className="font-medium">{formatDateLabel(row.date)}</TableCell>
                    <TableCell className="text-center">{row.customers}</TableCell>
                    <TableCell className="text-right font-semibold">
                      ${(row.totalCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => chargeByDateMutation.mutate(row.date)}
                        disabled={chargeByDateMutation.isPending}
                        data-testid={`button-run-now-${row.date}`}
                      >
                        {chargeByDateMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                        Run Now
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-misconfiguration-list">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Billing Misconfigurations
              {filteredMisconfigs.length > 0 && (
                <Badge variant="secondary" className="ml-1">{filteredMisconfigs.length}</Badge>
              )}
            </CardTitle>
            <div className="flex flex-wrap gap-1.5">
              {(["all", "no_payment_method", "failed_charge", "no_billing_rule"] as const).map(f => (
                <Button
                  key={f}
                  size="sm"
                  variant={miscFilter === f ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setMiscFilter(f)}
                  data-testid={`button-misc-filter-${f}`}
                >
                  {f === "all" ? "All Issues" : f === "no_payment_method" ? "Missing Card" : f === "failed_charge" ? "Failed Charge" : "No Rule"}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredMisconfigs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground" data-testid="text-no-misconfigs">
              <Activity className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm">{miscFilter === "all" ? "No billing issues found" : "No issues of this type"}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMisconfigs.map((m, idx) => (
                  <TableRow key={`${m.contactId}-${m.issue}-${idx}`} data-testid={`row-misconfig-${m.contactId}`}>
                    <TableCell className="font-medium">{m.contactName || "Unknown"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          m.issue === "failed_charge"
                            ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                            : m.issue === "no_billing_rule"
                              ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                        }
                      >
                        {issueLabel[m.issue] || m.issue}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {m.issue === "no_payment_method" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => navigate(`/contacts/${m.contactId}`)}
                          data-testid={`button-add-card-${m.contactId}`}
                        >
                          Add Card
                        </Button>
                      )}
                      {m.issue === "failed_charge" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => onSwitchToFailed()}
                          data-testid={`button-retry-${m.contactId}`}
                        >
                          Retry
                        </Button>
                      )}
                      {m.issue === "no_billing_rule" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => navigate(`/contacts/${m.contactId}`)}
                          data-testid={`button-set-rule-${m.contactId}`}
                        >
                          Set Rule
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const VALID_TAB_VALUES = ["all", "uninvoiced", "unpaid", "overdue", "paid", "failed", "billing-health"];

function getInitialTab(): string {
  const params = new URLSearchParams(window.location.search);
  const urlTab = params.get("tab");
  if (urlTab && VALID_TAB_VALUES.includes(urlTab)) return urlTab;
  const stored = localStorage.getItem("scoopilot_inv_status_filter");
  if (stored && VALID_TAB_VALUES.includes(stored)) return stored;
  return "all";
}

export default function Invoices() {
  const { toast } = useToast();
  const { startTutorial, isTutorialCompleted } = useTutorialContext();
  const [statusFilter, setStatusFilter] = useState(getInitialTab);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceWithLineItems | null>(null);
  const [invoiceToDelete, setInvoiceToDelete] = useState<string | null>(null);

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

  type UninvoicedSortField = "name" | "amount" | "visits";
  const [uninvoicedSortField, setUninvoicedSortField] = useState<UninvoicedSortField>("amount");
  const [uninvoicedSortDir, setUninvoicedSortDir] = useState<SortDir>("desc");

  const toggleUninvoicedSort = (field: UninvoicedSortField) => {
    if (uninvoicedSortField === field) {
      setUninvoicedSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setUninvoicedSortField(field);
      setUninvoicedSortDir(field === "name" ? "asc" : "desc");
    }
  };

  const { data: invoices, isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices", statusFilter],
    queryFn: async () => {
      const token = localStorage.getItem("sessionToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (statusFilter === "unpaid") {
        const [draft, sent, pending] = await Promise.all([
          fetch("/api/invoices?status=draft", { credentials: "include", headers }).then(r => r.ok ? r.json() : []),
          fetch("/api/invoices?status=sent", { credentials: "include", headers }).then(r => r.ok ? r.json() : []),
          fetch("/api/invoices?status=pending", { credentials: "include", headers }).then(r => r.ok ? r.json() : []),
        ]);
        const now = new Date();
        const combined = [...draft, ...sent, ...pending];
        return combined.filter((inv: Invoice) => !(inv.dueDate && new Date(inv.dueDate + "T23:59:59") < now));
      }
      if (statusFilter === "overdue") {
        const r = await fetch("/api/invoices", { credentials: "include", headers });
        if (!r.ok) throw new Error("Failed to fetch invoices");
        const all: Invoice[] = await r.json();
        const now = new Date();
        return all.filter((inv: Invoice) =>
          inv.status !== "paid" && inv.status !== "voided" && inv.dueDate && new Date(inv.dueDate + "T23:59:59") < now
        );
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
  });

  const activePricing = useMemo(() => pricing?.filter(p => p.isActive) || [], [pricing]);

  const { data: allInvoicesForStats } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
    queryFn: async () => {
      const token = localStorage.getItem("sessionToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const r = await fetch("/api/invoices", { credentials: "include", headers });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const revenueDashboard = useMemo(() => {
    const all = allInvoicesForStats || [];
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    let thisWeekRevenue = 0;
    let collectedThisWeek = 0;
    let outstandingBalance = 0;
    let overdueAmount = 0;

    for (const inv of all) {
      const total = Number(inv.total) || 0;
      const isPaid = inv.status === "paid";
      const isVoided = inv.status === "voided";
      const isOverdue = inv.dueDate && !isPaid && !isVoided &&
        new Date(inv.dueDate + "T23:59:59") < now;

      if (isPaid) {
        if (inv.paidAt && new Date(inv.paidAt) >= weekStart) {
          thisWeekRevenue += total;
          collectedThisWeek += total;
        }
      }
      if (!isPaid && !isVoided) {
        outstandingBalance += total;
        if (isOverdue) overdueAmount += total;
      }
    }
    return { thisWeekRevenue, collectedThisWeek, outstandingBalance, overdueAmount };
  }, [allInvoicesForStats]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    overdue: true, unpaid: true, draft: true, paid: false,
  });
  const [confirmSendAll, setConfirmSendAll] = useState(false);
  const [confirmChargeAll, setConfirmChargeAll] = useState(false);
  const [confirmGenerateAll, setConfirmGenerateAll] = useState(false);
  const [generateAllContactIds, setGenerateAllContactIds] = useState<string[] | null>(null);
  const [selectedUninvoicedIds, setSelectedUninvoicedIds] = useState<Set<string>>(new Set());
  const [expandedUninvoicedIds, setExpandedUninvoicedIds] = useState<Set<string>>(new Set());
  const [previewSheetOpen, setPreviewSheetOpen] = useState(false);
  const [generateDialogContactId, setGenerateDialogContactId] = useState<string | undefined>(undefined);
  const [generateByDateRangeOpen, setGenerateByDateRangeOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [editInvoiceReminders, setEditInvoiceReminders] = useState<{
    preDueDays: number[];
    overdueIntervalDays: number;
    maxReminders: number;
  } | null>(null);
  const [preDueDaysInput, setPreDueDaysInput] = useState("");

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

  const { data: demoStatus } = useQuery<{ isDemo: boolean }>({
    queryKey: ["/api/demo/status"],
  });
  const isDemo = !!demoStatus?.isDemo;

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

  interface InvoiceReminderSettings {
    preDueDays: number[];
    overdueIntervalDays: number;
    maxReminders: number;
  }
  interface CompanyReminderSettingsData {
    reminderSettings: unknown[];
    invoiceReminderSettings: InvoiceReminderSettings;
    remindersEnabled: boolean;
  }

  const { data: companyReminderSettings } = useQuery<CompanyReminderSettingsData>({
    queryKey: ["/api/company/reminder-settings"],
  });

  const saveReminderSettingsMutation = useMutation({
    mutationFn: async (settings: InvoiceReminderSettings) => {
      await apiRequest("PATCH", "/api/company", { invoiceReminderSettings: settings });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/reminder-settings"] });
      toast({ title: "Reminder settings saved", description: "Invoice reminder schedule updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error saving settings", description: error.message, variant: "destructive" });
    },
  });

  const sendPaymentReminderMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const res = await apiRequest("POST", `/api/contacts/${contactId}/send-payment-reminder`);
      return res.json();
    },
    onSuccess: (data: { smsSent?: boolean; emailSent?: boolean; totalOwed?: number }) => {
      const channel = data.smsSent ? "SMS" : data.emailSent ? "email" : "message";
      toast({ title: "Reminder sent", description: `Payment reminder sent via ${channel}.` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send reminder", description: error.message, variant: "destructive" });
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

  const generateAllMutation = useMutation({
    mutationFn: async ({ contactIds, sendAfterGenerate }: { contactIds: string[] | null; sendAfterGenerate?: boolean }) => {
      const body: Record<string, unknown> = {};
      if (contactIds) body.contactIds = contactIds;
      if (sendAfterGenerate) body.sendAfterGenerate = true;
      const res = await apiRequest("POST", "/api/invoices/generate-all-from-uninvoiced", body);
      return res.json();
    },
    onSuccess: (data: { created: number; totalDollars: number; sent?: number; failed?: number }, variables) => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/invoices") });
      queryClient.invalidateQueries({ queryKey: ["/api/company/uninvoiced-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      setConfirmGenerateAll(false);
      setGenerateAllContactIds(null);
      setSelectedUninvoicedIds(new Set());
      if (data.created > 0) {
        const dollarStr = data.totalDollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (variables.sendAfterGenerate) {
          const sentN = data.sent ?? 0;
          const failedN = data.failed ?? 0;
          const sentDesc = failedN > 0
            ? `${data.created} invoice${data.created !== 1 ? "s" : ""} created, ${sentN} sent, ${failedN} failed to send`
            : `${data.created} invoice${data.created !== 1 ? "s" : ""} created and sent to ${sentN} customer${sentN !== 1 ? "s" : ""}`;
          toast({ title: `$${dollarStr} generated and sent`, description: sentDesc });
        } else {
          toast({
            title: `$${dollarStr} in invoices generated`,
            description: `${data.created} invoice${data.created !== 1 ? "s" : ""} created`,
          });
        }
      } else {
        toast({ title: "No invoices generated", description: "No uninvoiced work found." });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Generation failed", description: error.message, variant: "destructive" });
    },
  });

  const [batchPending, setBatchPending] = useState(false);

  async function batchSend(ids: string[]) {
    setBatchPending(true);
    let sent = 0; let failed = 0;
    try {
      await Promise.all(ids.map(id =>
        apiRequest("POST", `/api/invoices/${id}/send-email`).then(() => { sent++; }).catch(() => { failed++; })
      ));
      queryClient.invalidateQueries({ predicate: q => (q.queryKey[0] as string)?.startsWith("/api/invoices") });
      const total = sent + failed;
      toast({ title: failed === 0 ? `${sent} invoice${sent !== 1 ? "s" : ""} sent` : `${sent} of ${total} invoices sent`, description: failed > 0 ? `${failed} failed.` : undefined });
      setSelectedIds(new Set());
    } finally { setBatchPending(false); }
  }

  async function batchCharge(ids: string[]) {
    setBatchPending(true);
    try {
      if (isDemo) {
        await new Promise(r => setTimeout(r, 1200));
        const eligible = autopayEligibleInvoices.filter(inv => ids.includes(inv.id));
        const totalAmount = eligible.reduce((sum, inv) => sum + Number(inv.total), 0);
        await Promise.all(eligible.map(inv =>
          apiRequest("PATCH", `/api/invoices/${inv.id}`, { status: "paid", paidAt: new Date().toISOString() }).catch(() => {})
        ));
        queryClient.invalidateQueries({ predicate: q => (q.queryKey[0] as string)?.startsWith("/api/invoices") });
        queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/company/uninvoiced-summary"] });
        toast({
          title: `${eligible.length} invoice${eligible.length !== 1 ? "s" : ""} charged`,
          description: `$${totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} collected via autopay.`,
        });
        setSelectedIds(new Set());
        return;
      }
      let charged = 0; let failed = 0;
      await Promise.all(ids.map(id =>
        apiRequest("POST", `/api/invoices/${id}/charge`).then(() => { charged++; }).catch(() => { failed++; })
      ));
      queryClient.invalidateQueries({ predicate: q => (q.queryKey[0] as string)?.startsWith("/api/invoices") });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      const total = charged + failed;
      toast({ title: failed === 0 ? `${charged} invoice${charged !== 1 ? "s" : ""} charged` : `${charged} of ${total} invoices charged`, description: failed > 0 ? `${failed} failed.` : undefined });
      setSelectedIds(new Set());
    } finally { setBatchPending(false); }
  }

  async function batchMarkPaid(ids: string[]) {
    setBatchPending(true);
    let marked = 0;
    try {
      await Promise.all(ids.map(id =>
        apiRequest("PATCH", `/api/invoices/${id}`, { status: "paid", paidAt: new Date().toISOString() })
          .then(() => { marked++; }).catch(() => {})
      ));
      queryClient.invalidateQueries({ predicate: q => (q.queryKey[0] as string)?.startsWith("/api/invoices") });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      toast({ title: `Marked ${marked} invoice${marked !== 1 ? "s" : ""} as paid` });
      setSelectedIds(new Set());
    } finally { setBatchPending(false); }
  }

  function toggleSelectAll(invoiceList: Invoice[]) {
    if (invoiceList.every(inv => selectedIds.has(inv.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(invoiceList.map(inv => inv.id)));
    }
  }

  function toggleSelectOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  const groupedInvoices = useMemo(() => {
    if (!sortedInvoices) return { overdue: [], unpaid: [], draft: [], paid: [] };
    const now = new Date();
    const overdue: Invoice[] = [];
    const unpaid: Invoice[] = [];
    const draft: Invoice[] = [];
    const paid: Invoice[] = [];
    for (const inv of sortedInvoices) {
      if (inv.status === "paid") { paid.push(inv); continue; }
      if (inv.status === "draft") { draft.push(inv); continue; }
      if (inv.dueDate && new Date(inv.dueDate + "T23:59:59") < now) { overdue.push(inv); continue; }
      unpaid.push(inv);
    }
    return { overdue, unpaid, draft, paid };
  }, [sortedInvoices]);

  const allUnpaidInvoices = useMemo(() => {
    if (!allInvoicesForStats) return [];
    return allInvoicesForStats.filter(inv => ["draft", "pending", "sent"].includes(inv.status));
  }, [allInvoicesForStats]);

  const tabBadges = useMemo(() => {
    if (!allInvoicesForStats) return { unpaid: { count: 0, total: 0 }, overdue: { count: 0, total: 0 } };
    const now = new Date();
    let unpaidCount = 0; let unpaidTotal = 0;
    let overdueCount = 0; let overdueTotal = 0;
    for (const inv of allInvoicesForStats) {
      if (inv.status === "voided" || inv.status === "paid") continue;
      const total = Number(inv.total) || 0;
      const isOverdue = inv.dueDate && new Date(inv.dueDate + "T23:59:59") < now;
      if (isOverdue) {
        overdueCount++;
        overdueTotal += total;
      } else if (["draft", "sent", "pending"].includes(inv.status)) {
        unpaidCount++;
        unpaidTotal += total;
      }
    }
    return {
      unpaid: { count: unpaidCount, total: unpaidTotal },
      overdue: { count: overdueCount, total: overdueTotal },
    };
  }, [allInvoicesForStats]);

  const sortedUninvoicedByContact = useMemo(() => {
    const list = uninvoicedSummary?.byContact ?? [];
    return [...list].sort((a, b) => {
      let cmp = 0;
      if (uninvoicedSortField === "name") {
        cmp = a.contactName.localeCompare(b.contactName);
      } else if (uninvoicedSortField === "amount") {
        cmp = a.totalDollars - b.totalDollars;
      } else {
        cmp = a.count - b.count;
      }
      return uninvoicedSortDir === "asc" ? cmp : -cmp;
    });
  }, [uninvoicedSummary, uninvoicedSortField, uninvoicedSortDir]);

  const autopayEligibleInvoices = useMemo(() => {
    if (!allInvoicesForStats || !contacts) return [];
    if (isDemo) {
      return allInvoicesForStats.filter(inv => ["draft", "pending", "sent"].includes(inv.status));
    }
    const contactsWithAutopay = new Set(contacts.filter(c => c.autoPayEnabled && c.stripeCustomerId).map(c => c.id));
    return allInvoicesForStats.filter(inv =>
      ["pending", "sent"].includes(inv.status) && contactsWithAutopay.has(inv.contactId)
    );
  }, [allInvoicesForStats, contacts, isDemo]);

  function renderInvoiceRows(list: Invoice[], testPrefix?: string) {
    return list.map((invoice) => {
      const contact = contactMap[invoice.contactId];
      const hasAutopay = !!(contact?.stripeCustomerId);
      const isOverdue = invoice.dueDate && invoice.status !== "paid" && invoice.status !== "voided" && new Date(invoice.dueDate + "T23:59:59") < new Date();
      return (
        <TableRow
          key={invoice.id}
          data-testid={`row-invoice-${testPrefix ? testPrefix + "-" : ""}${invoice.id}`}
          className={`cursor-pointer ${isOverdue ? "bg-red-50/60 dark:bg-red-950/20" : ""} ${selectedIds.has(invoice.id) ? "bg-muted/40" : ""}`}
          onClick={() => viewInvoiceDetail(invoice.id)}
        >
          <TableCell className="pl-3" onClick={e => e.stopPropagation()}>
            <Checkbox
              checked={selectedIds.has(invoice.id)}
              onCheckedChange={() => toggleSelectOne(invoice.id)}
              data-testid={`checkbox-invoice-${invoice.id}`}
            />
          </TableCell>
          <TableCell className="font-medium">
            <div className="flex items-center gap-2">
              {isOverdue && <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />}
              {invoice.invoiceNumber}
              {invoice.autoGenerated && <Badge variant="outline" className="text-xs">Auto</Badge>}
            </div>
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-1.5">
              {contact ? (
                <ClientInfoPopover contactId={contact.id}>
                  <span className="hover:underline">{contact.firstName} {contact.lastName}</span>
                </ClientInfoPopover>
              ) : <span className="text-muted-foreground">Unknown</span>}
              {hasAutopay && (
                <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 font-normal border-emerald-400 text-emerald-700 dark:text-emerald-400 hidden sm:inline-flex" title="Card on file">
                  <CreditCard className="h-2.5 w-2.5 mr-0.5" />Autopay
                </Badge>
              )}
            </div>
          </TableCell>
          <TableCell className="text-muted-foreground">{new Date(invoice.createdAt).toLocaleDateString()}</TableCell>
          <TableCell className={isOverdue ? "text-red-600 dark:text-red-400 font-medium" : ""}>
            {invoice.dueDate}{isOverdue ? " (Overdue)" : ""}
          </TableCell>
          <TableCell className="font-semibold">${Number(invoice.total).toFixed(2)}</TableCell>
          <TableCell>
            <Badge variant="secondary" className={invoiceStatusColors[invoice.status] || ""}>
              {invoiceStatusLabels[invoice.status] || invoice.status}
            </Badge>
          </TableCell>
          <TableCell className="text-right" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-end gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8"
                onClick={() => { setPreviewInvoiceId(invoice.id); setPreviewDialogOpen(true); }}
                title="Preview invoice"
              >
                <Printer className="h-4 w-4" />
              </Button>
              {invoice.status !== "paid" && stripeConfig?.configured && (
                <>
                  <Button variant="ghost" size="icon" className="h-8 w-8"
                    onClick={() => chargeMutation.mutate(invoice.id)}
                    disabled={chargeMutation.isPending}
                    title="Charge card on file"
                  >
                    {chargeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8"
                    onClick={() => checkoutMutation.mutate(invoice.id)}
                    disabled={checkoutMutation.isPending}
                    title="Send to Stripe Checkout"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </>
              )}
              {invoice.status !== "paid" && (
                <Button variant="ghost" size="icon" className="h-8 w-8"
                  onClick={() => markPaidMutation.mutate(invoice.id)}
                  disabled={markPaidMutation.isPending}
                  title="Mark as paid"
                >
                  <CheckCircle2 className="h-4 w-4" />
                </Button>
              )}
              {invoice.status !== "paid" && (
                <Button variant="default" size="sm" className="h-8"
                  onClick={() => sendEmailMutation.mutate(invoice.id)}
                  disabled={sendEmailMutation.isPending}
                >
                  {sendEmailMutation.isPending && sendEmailMutation.variables === invoice.id
                    ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    : <Mail className="mr-1 h-4 w-4" />}
                  Send
                </Button>
              )}
              {invoice.status !== "paid" && (
                <Button variant="ghost" size="icon" className="h-8 w-8"
                  onClick={() => setInvoiceToDelete(invoice.id)}
                  disabled={deleteMutation.isPending}
                  title="Delete invoice"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </TableCell>
        </TableRow>
      );
    });
  }

  function renderGroupedSection(
    label: string,
    list: Invoice[],
    key: string,
    headerClass: string,
  ) {
    const sectionTotal = list.reduce((s, inv) => s + Number(inv.total), 0);
    const isExpanded = expandedSections[key] !== false;
    return (
      <div key={key} className="rounded-md border overflow-hidden" data-testid={`section-${key}`}>
        <div
          className={`flex items-center justify-between px-4 py-2 cursor-pointer select-none ${headerClass}`}
          onClick={() => setExpandedSections(s => ({ ...s, [key]: !isExpanded }))}
          data-testid={`section-header-${key}`}
        >
          <div className="flex items-center gap-2">
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span className="font-semibold text-sm">{label}</span>
            <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 font-normal">{list.length}</Badge>
          </div>
          <span className="text-sm font-medium">${sectionTotal.toFixed(2)}</span>
        </div>
        {isExpanded && list.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pl-3">
                  <Checkbox
                    checked={list.every(inv => selectedIds.has(inv.id))}
                    onCheckedChange={() => {
                      if (list.every(inv => selectedIds.has(inv.id))) {
                        setSelectedIds(prev => { const next = new Set(prev); list.forEach(inv => next.delete(inv.id)); return next; });
                      } else {
                        setSelectedIds(prev => { const next = new Set(prev); list.forEach(inv => next.add(inv.id)); return next; });
                      }
                    }}
                    aria-label={`Select all ${label} invoices`}
                  />
                </TableHead>
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
              {renderInvoiceRows(list, key)}
            </TableBody>
          </Table>
        )}
        {isExpanded && list.length === 0 && (
          <div className="py-6 text-center text-sm text-muted-foreground">No {label.toLowerCase()} invoices.</div>
        )}
      </div>
    );
  }

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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="revenue-dashboard">
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">This Week</p>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400" data-testid="stat-this-week-revenue">
                  ${revenueDashboard.thisWeekRevenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-emerald-500 opacity-70" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Outstanding</p>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="stat-outstanding-balance">
                  ${revenueDashboard.outstandingBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <Clock className="h-8 w-8 text-amber-500 opacity-70" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Overdue</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="stat-overdue-amount">
                  ${revenueDashboard.overdueAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-500 opacity-70" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Collected This Week</p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="stat-collected-week">
                  ${revenueDashboard.collectedThisWeek.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-blue-500 opacity-70" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-border bg-card" data-testid="persistent-batch-actions">
        <div className="flex items-center">
          <Button
            variant="default"
            onClick={() => {
              setGenerateAllContactIds(null);
              setConfirmGenerateAll(true);
            }}
            className="rounded-r-none border-r-0"
            data-testid="button-persistent-generate"
            disabled={generateAllMutation.isPending}
          >
            <Zap className="mr-1 h-4 w-4" />
            Generate All Invoices
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="default"
                className="rounded-l-none px-2"
                data-testid="button-generate-dropdown-trigger"
                disabled={generateAllMutation.isPending}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={() => { setTimeout(() => { setGenerateDialogContactId(undefined); setGenerateDialogOpen(true); }, 0); }}
                data-testid="dropdown-generate-by-customer"
              >
                <FileText className="mr-2 h-4 w-4" />
                Generate by Customer
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => { setTimeout(() => setGenerateByDateRangeOpen(true), 0); }}
                data-testid="dropdown-generate-by-date"
              >
                <Clock className="mr-2 h-4 w-4" />
                Generate by Date Range
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={selectedUninvoicedIds.size === 0}
                onClick={() => {
                  if (selectedUninvoicedIds.size > 0) {
                    const ids = Array.from(selectedUninvoicedIds);
                    setTimeout(() => { setGenerateAllContactIds(ids); setConfirmGenerateAll(true); }, 0);
                  }
                }}
                data-testid="dropdown-generate-selected"
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Generate Selected {selectedUninvoicedIds.size > 0 ? `(${selectedUninvoicedIds.size})` : ""}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={batchPending || allUnpaidInvoices.length === 0}
          onClick={() => setConfirmSendAll(true)}
          data-testid="button-persistent-send-unpaid"
          className="flex items-center gap-1.5"
        >
          <SendHorizonal className="h-3.5 w-3.5 text-blue-500" />
          Send All Unpaid
          {allUnpaidInvoices.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0 h-4">
              {allUnpaidInvoices.length}
            </Badge>
          )}
        </Button>

        {(stripeConfig?.configured || isDemo) && (
          <Button
            variant="outline"
            size="sm"
            disabled={batchPending || autopayEligibleInvoices.length === 0}
            onClick={() => setConfirmChargeAll(true)}
            data-testid="button-persistent-charge-autopay"
            className="flex items-center gap-1.5"
          >
            <CreditCard className="h-3.5 w-3.5 text-emerald-500" />
            Charge Autopay
            {autopayEligibleInvoices.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0 h-4">
                ${autopayEligibleInvoices.reduce((s, inv) => s + Number(inv.total), 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} · {autopayEligibleInvoices.length}
              </Badge>
            )}
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const currentSettings = companyReminderSettings?.invoiceReminderSettings;
            const defaults = currentSettings || { preDueDays: [7, 2, 1, 0], overdueIntervalDays: 2, maxReminders: 10 };
            setEditInvoiceReminders(defaults);
            setPreDueDaysInput(defaults.preDueDays.join(", "));
            setAutomationOpen(v => !v);
          }}
          data-testid="button-toggle-automation"
          className="ml-auto"
        >
          <Settings className="mr-1 h-3.5 w-3.5" />
          Automation
        </Button>

        {(batchPending || generateAllMutation.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-muted/70 border border-border" data-testid="batch-action-bar">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="flex flex-wrap items-center gap-2 ml-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => batchSend(Array.from(selectedIds))}
              disabled={batchPending}
              data-testid="button-batch-send"
            >
              <SendHorizonal className="mr-1 h-3.5 w-3.5" />
              Send All
            </Button>
            {(stripeConfig?.configured || isDemo) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => batchCharge(Array.from(selectedIds))}
                disabled={batchPending}
                data-testid="button-batch-charge"
              >
                <CreditCard className="mr-1 h-3.5 w-3.5" />
                Charge All
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => batchMarkPaid(Array.from(selectedIds))}
              disabled={batchPending}
              data-testid="button-batch-mark-paid"
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              Mark Paid
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds(new Set())}
              data-testid="button-clear-selection"
            >
              Clear
            </Button>
          </div>
          {batchPending && <Loader2 className="h-4 w-4 animate-spin ml-auto" />}
        </div>
      )}

      <Dialog open={confirmSendAll} onOpenChange={setConfirmSendAll}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Send {allUnpaidInvoices.length} Unpaid Invoices?</DialogTitle>
            <DialogDescription>
              This will email all {allUnpaidInvoices.length} unpaid invoice{allUnpaidInvoices.length !== 1 ? "s" : ""} to their respective clients.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-2">
            <Button
              className="flex-1"
              onClick={() => {
                setConfirmSendAll(false);
                batchSend(allUnpaidInvoices.map(inv => inv.id));
              }}
              disabled={batchPending}
              data-testid="button-confirm-send-all"
            >
              {batchPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <SendHorizonal className="mr-1 h-4 w-4" />}
              Send All
            </Button>
            <Button variant="outline" onClick={() => setConfirmSendAll(false)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmChargeAll} onOpenChange={setConfirmChargeAll}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Charge {autopayEligibleInvoices.length} Autopay Invoices?</DialogTitle>
            <DialogDescription>
              This will attempt to charge {autopayEligibleInvoices.length} autopay-enabled invoice{autopayEligibleInvoices.length !== 1 ? "s" : ""} to the cards on file.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-2">
            <Button
              className="flex-1"
              onClick={() => {
                setConfirmChargeAll(false);
                batchCharge(autopayEligibleInvoices.map(inv => inv.id));
              }}
              disabled={batchPending}
              data-testid="button-confirm-charge-all"
            >
              {batchPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CreditCard className="mr-1 h-4 w-4" />}
              Charge All
            </Button>
            <Button variant="outline" onClick={() => setConfirmChargeAll(false)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmGenerateAll} onOpenChange={(open) => { if (!open) { setConfirmGenerateAll(false); setGenerateAllContactIds(null); } }}>
        <DialogContent className="max-w-md" data-testid="dialog-confirm-generate-all">
          <DialogHeader>
            <DialogTitle>
              Generate {generateAllContactIds ? generateAllContactIds.length : uninvoicedSummary?.byContact.length ?? 0} invoice{(generateAllContactIds ? generateAllContactIds.length : uninvoicedSummary?.byContact.length ?? 0) !== 1 ? "s" : ""}?
            </DialogTitle>
            <DialogDescription>
              This will create invoices totaling ${
                generateAllContactIds
                  ? (uninvoicedSummary?.byContact.filter(c => generateAllContactIds.includes(c.contactId)).reduce((s, c) => s + c.totalDollars, 0) ?? 0).toFixed(2)
                  : uninvoicedSummary?.totalDollars.toFixed(2) ?? "0.00"
              } for {generateAllContactIds ? generateAllContactIds.length : uninvoicedSummary?.byContact.length ?? 0} customer{(generateAllContactIds ? generateAllContactIds.length : uninvoicedSummary?.byContact.length ?? 0) !== 1 ? "s" : ""} based on their completed work.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>These visits will be marked as invoiced and removed from this view. This cannot be undone without voiding the invoices.</p>
          </div>
          <div className="flex flex-col gap-2 mt-2">
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => generateAllMutation.mutate({ contactIds: generateAllContactIds, sendAfterGenerate: true })}
                disabled={generateAllMutation.isPending}
                data-testid="button-confirm-generate-and-send"
              >
                {generateAllMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <SendHorizonal className="mr-1 h-4 w-4" />}
                Generate &amp; Send
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => generateAllMutation.mutate({ contactIds: generateAllContactIds })}
                disabled={generateAllMutation.isPending}
                data-testid="button-confirm-generate-all"
              >
                {generateAllMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Zap className="mr-1 h-4 w-4" />}
                Generate Only
              </Button>
            </div>
            <Button variant="ghost" onClick={() => { setConfirmGenerateAll(false); setGenerateAllContactIds(null); }} data-testid="button-cancel-generate-all" className="w-full">
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Sheet open={previewSheetOpen} onOpenChange={setPreviewSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto" data-testid="sheet-preview-uninvoiced">
          <SheetHeader>
            <SheetTitle>Invoice Preview</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {uninvoicedSummary && uninvoicedSummary.count > 0 ? (
              <>
                <div className="text-sm text-muted-foreground border-b pb-3 mb-3">
                  <span className="font-semibold text-foreground">{uninvoicedSummary.count}</span> visits · Total: <span className="font-semibold text-foreground">${uninvoicedSummary.totalDollars.toFixed(2)}</span>
                </div>
                {sortedUninvoicedByContact.map((entry) => {
                  const contact = contacts?.find(c => c.id === entry.contactId);
                  const hasAutopay = !!(contact?.autoPayEnabled && contact?.stripeCustomerId);
                  return (
                    <div key={entry.contactId} className="flex items-start justify-between gap-3 p-3 rounded-md border" data-testid={`preview-row-${entry.contactId}`}>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{entry.contactName}</p>
                          {hasAutopay && (
                            <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 font-normal border-emerald-400 text-emerald-700 dark:text-emerald-400">
                              <CreditCard className="h-2.5 w-2.5 mr-0.5" />Autopay
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{entry.count} visit{entry.count !== 1 ? "s" : ""}</p>
                      </div>
                      <span className="font-semibold">${entry.totalDollars.toFixed(2)}</span>
                    </div>
                  );
                })}
                <Button
                  className="w-full mt-2"
                  onClick={() => {
                    setPreviewSheetOpen(false);
                    setGenerateAllContactIds(null);
                    setConfirmGenerateAll(true);
                  }}
                  data-testid="button-generate-from-preview"
                >
                  <Zap className="mr-2 h-4 w-4" />
                  Generate All (${uninvoicedSummary.totalDollars.toFixed(2)})
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">No uninvoiced work found.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {automationOpen && (
        <Card className="border-dashed" data-testid="section-automation">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bell className="h-4 w-4 text-muted-foreground" />
                Invoice Auto-Reminder Rules
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAutomationOpen(false)} data-testid="button-close-automation">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Control when automatic payment reminders are sent to clients with outstanding invoices.</p>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-4">
            {editInvoiceReminders && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Pre-Due Reminder Days</Label>
                    <Input
                      value={preDueDaysInput}
                      onChange={e => setPreDueDaysInput(e.target.value)}
                      placeholder="e.g., 7, 2, 1, 0"
                      data-testid="input-pre-due-days"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Days before due date (comma-separated)</p>
                  </div>
                  <div>
                    <Label className="text-xs">Overdue Interval (days)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={editInvoiceReminders.overdueIntervalDays}
                      onChange={e => setEditInvoiceReminders({ ...editInvoiceReminders, overdueIntervalDays: parseInt(e.target.value) || 2 })}
                      data-testid="input-overdue-interval"
                    />
                    <p className="text-xs text-muted-foreground mt-1">How often to remind after overdue</p>
                  </div>
                  <div>
                    <Label className="text-xs">Max Reminders</Label>
                    <Input
                      type="number"
                      min="1"
                      max="30"
                      value={editInvoiceReminders.maxReminders}
                      onChange={e => setEditInvoiceReminders({ ...editInvoiceReminders, maxReminders: parseInt(e.target.value) || 10 })}
                      data-testid="input-max-reminders"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Stop sending after this many</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      const days = preDueDaysInput.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 0);
                      if (days.length === 0) {
                        toast({ title: "Invalid days", description: "Enter at least one day value.", variant: "destructive" });
                        return;
                      }
                      saveReminderSettingsMutation.mutate({ ...editInvoiceReminders, preDueDays: days });
                    }}
                    disabled={saveReminderSettingsMutation.isPending}
                    data-testid="button-save-reminder-settings"
                  >
                    {saveReminderSettingsMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
                    Save Settings
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const defaults = companyReminderSettings?.invoiceReminderSettings || { preDueDays: [7, 2, 1, 0], overdueIntervalDays: 2, maxReminders: 10 };
                      setEditInvoiceReminders(defaults);
                      setPreDueDaysInput(defaults.preDueDays.join(", "));
                    }}
                    data-testid="button-reset-reminder-settings"
                  >
                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setSelectedIds(new Set()); }}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="all" data-testid="tab-invoice-all">All</TabsTrigger>
          <TabsTrigger value="uninvoiced" data-testid="tab-invoice-uninvoiced">Uninvoiced</TabsTrigger>
          <TabsTrigger value="unpaid" data-testid="tab-invoice-unpaid">
            Unpaid
            {tabBadges.unpaid.count > 0 && (
              <span className="ml-1.5 text-xs font-normal opacity-80">
                ({tabBadges.unpaid.count} · ${tabBadges.unpaid.total.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="overdue" data-testid="tab-invoice-overdue">
            Overdue
            {tabBadges.overdue.count > 0 && (
              <span className="ml-1.5 text-xs font-normal opacity-80">
                ({tabBadges.overdue.count} · ${tabBadges.overdue.total.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="paid" data-testid="tab-invoice-paid">Paid</TabsTrigger>
          <TabsTrigger value="failed" data-testid="tab-invoice-failed">Failed</TabsTrigger>
          <TabsTrigger value="billing-health" data-testid="tab-invoice-billing-health" className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            Billing Health
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {statusFilter === "billing-health" ? (
        <BillingHealthPanel onSwitchToFailed={() => setStatusFilter("failed")} />
      ) : isLoading ? (
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
              <Card className="border-2 border-primary/20 bg-primary/5" data-testid="card-uninvoiced-cta">
                <CardContent className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div data-testid="text-uninvoiced-total">
                      <p className="text-base font-semibold text-foreground">
                        {uninvoicedSummary.count} completed visit{uninvoicedSummary.count !== 1 ? "s" : ""} ready to invoice
                      </p>
                      <p className="text-2xl font-bold text-primary mt-0.5">
                        Total: ${uninvoicedSummary.totalDollars.toFixed(2)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="default"
                        variant="default"
                        onClick={() => {
                          setGenerateAllContactIds(null);
                          setConfirmGenerateAll(true);
                        }}
                        disabled={generateAllMutation.isPending}
                        data-testid="button-generate-all-cta"
                        className="font-semibold"
                      >
                        {generateAllMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Zap className="mr-2 h-4 w-4" />
                        )}
                        Generate All (${uninvoicedSummary.totalDollars.toFixed(0)})
                      </Button>
                      <Button
                        size="default"
                        variant="outline"
                        onClick={() => setPreviewSheetOpen(true)}
                        data-testid="button-preview-uninvoiced"
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        Preview First
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <div className="flex items-center gap-1.5 flex-wrap" data-testid="uninvoiced-sort-controls">
                <span className="text-xs text-muted-foreground mr-1">Sort by:</span>
                {(["amount", "visits", "name"] as const).map((field) => {
                  const labels: Record<string, string> = { amount: "Amount", visits: "Visit Count", name: "Name" };
                  const active = uninvoicedSortField === field;
                  return (
                    <Button
                      key={field}
                      size="sm"
                      variant={active ? "secondary" : "ghost"}
                      className="h-7 px-2.5 text-xs font-medium"
                      onClick={() => toggleUninvoicedSort(field)}
                      data-testid={`button-uninvoiced-sort-${field}`}
                    >
                      {labels[field]}
                      {active ? (
                        uninvoicedSortDir === "asc" ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
                      ) : (
                        <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />
                      )}
                    </Button>
                  );
                })}
              </div>
              {sortedUninvoicedByContact.map((entry) => {
                const contact = contacts?.find(c => c.id === entry.contactId);
                const hasAutopay = !!(contact?.autoPayEnabled && contact?.stripeCustomerId);
                const isSelected = selectedUninvoicedIds.has(entry.contactId);
                const isExpanded = expandedUninvoicedIds.has(entry.contactId);
                return (
                  <Card key={entry.contactId} data-testid={`card-uninvoiced-${entry.contactId}`} className={isSelected ? "border-primary/40 bg-primary/5" : ""}>
                    <CardContent className="flex items-center gap-3 p-4">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => {
                          setSelectedUninvoicedIds(prev => {
                            const next = new Set(prev);
                            if (checked) next.add(entry.contactId);
                            else next.delete(entry.contactId);
                            return next;
                          });
                        }}
                        data-testid={`checkbox-uninvoiced-${entry.contactId}`}
                        aria-label={`Select ${entry.contactName}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium" data-testid={`text-uninvoiced-name-${entry.contactId}`}>{entry.contactName}</p>
                          {hasAutopay && (
                            <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 font-normal border-emerald-400 text-emerald-700 dark:text-emerald-400">
                              <CreditCard className="h-2.5 w-2.5 mr-0.5" />Autopay
                            </Badge>
                          )}
                        </div>
                        <button
                          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mt-0.5 cursor-pointer"
                          onClick={() => {
                            setExpandedUninvoicedIds(prev => {
                              const next = new Set(prev);
                              if (next.has(entry.contactId)) next.delete(entry.contactId);
                              else next.add(entry.contactId);
                              return next;
                            });
                          }}
                          data-testid={`button-expand-uninvoiced-${entry.contactId}`}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Collapse" : "Expand"} visit details for ${entry.contactName}`}
                        >
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                          {entry.count} visit{entry.count !== 1 ? "s" : ""} · ${entry.totalDollars.toFixed(2)}
                        </button>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setGenerateDialogContactId(entry.contactId);
                          setGenerateDialogOpen(true);
                        }}
                        data-testid={`button-generate-invoice-${entry.contactId}`}
                      >
                        <Zap className="mr-1 h-3.5 w-3.5" /> Generate Invoice
                      </Button>
                    </CardContent>
                    {isExpanded && <UninvoicedVisitBreakdown contactId={entry.contactId} />}
                  </Card>
                );
              })}
              {selectedUninvoicedIds.size > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/70 border" data-testid="uninvoiced-batch-bar">
                  <span className="text-sm font-medium">{selectedUninvoicedIds.size} selected</span>
                  <Button
                    size="sm"
                    onClick={() => {
                      setGenerateAllContactIds(Array.from(selectedUninvoicedIds));
                      setConfirmGenerateAll(true);
                    }}
                    disabled={generateAllMutation.isPending}
                    data-testid="button-generate-selected"
                  >
                    <Zap className="mr-1 h-3.5 w-3.5" /> Generate Selected ({selectedUninvoicedIds.size})
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedUninvoicedIds(new Set())}
                    data-testid="button-clear-uninvoiced-selection"
                  >
                    Clear
                  </Button>
                </div>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-no-uninvoiced">
                All completed visits have been invoiced.
              </CardContent>
            </Card>
          )}
        </div>
      ) : statusFilter === "all" && sortedInvoices.length > 0 ? (
        <div className="space-y-3">
          {groupedInvoices.overdue.length > 0 && renderGroupedSection(
            "Overdue", groupedInvoices.overdue, "overdue",
            "bg-red-50/80 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-b"
          )}
          {renderGroupedSection(
            "Unpaid / Sent", groupedInvoices.unpaid, "unpaid",
            "bg-amber-50/60 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 border-b"
          )}
          {renderGroupedSection(
            "Draft", groupedInvoices.draft, "draft",
            "bg-muted/40 text-muted-foreground border-b"
          )}
          {renderGroupedSection(
            "Paid", groupedInvoices.paid, "paid",
            "bg-emerald-50/40 dark:bg-emerald-950/10 text-emerald-700 dark:text-emerald-400 border-b"
          )}
        </div>
      ) : sortedInvoices.length > 0 ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pl-3">
                  <Checkbox
                    checked={sortedInvoices.length > 0 && sortedInvoices.every(inv => selectedIds.has(inv.id))}
                    onCheckedChange={() => toggleSelectAll(sortedInvoices)}
                    data-testid="checkbox-select-all"
                    aria-label="Select all invoices"
                  />
                </TableHead>
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
                const hasAutopay = !!(contact?.stripeCustomerId);
                const isOverdue = invoice.dueDate && invoice.status !== "paid" && invoice.status !== "voided" && new Date(invoice.dueDate + "T23:59:59") < new Date();
                return (
                  <TableRow
                    key={invoice.id}
                    data-testid={`row-invoice-${invoice.id}`}
                    className={`cursor-pointer ${isOverdue ? "bg-red-50/60 dark:bg-red-950/20" : ""} ${selectedIds.has(invoice.id) ? "bg-muted/40" : ""}`}
                    onClick={() => viewInvoiceDetail(invoice.id)}
                  >
                    <TableCell className="pl-3" onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(invoice.id)}
                        onCheckedChange={() => toggleSelectOne(invoice.id)}
                        data-testid={`checkbox-invoice-${invoice.id}`}
                        aria-label={`Select invoice ${invoice.invoiceNumber}`}
                      />
                    </TableCell>
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
                      <div className="flex items-center gap-1.5">
                        {contact ? (
                          <ClientInfoPopover contactId={contact.id}>
                            <span className="hover:underline">{contact.firstName} {contact.lastName}</span>
                          </ClientInfoPopover>
                        ) : <span className="text-muted-foreground">Unknown</span>}
                        {hasAutopay && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 font-normal border-emerald-400 text-emerald-700 dark:text-emerald-400 hidden sm:inline-flex" data-testid={`badge-autopay-${invoice.id}`} title="Card on file">
                            <CreditCard className="h-2.5 w-2.5 mr-0.5" />Autopay
                          </Badge>
                        )}
                      </div>
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
                            onClick={() => setInvoiceToDelete(invoice.id)}
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

                  {selectedInvoice.status !== "paid" && (
                    <CollectionsPanel
                      invoice={selectedInvoice}
                      contact={contactMap[selectedInvoice.contactId]}
                      onSendReminder={() => sendPaymentReminderMutation.mutate(selectedInvoice.contactId)}
                      onRetryCharge={() => { chargeMutation.mutate(selectedInvoice.id); }}
                      sendReminderPending={sendPaymentReminderMutation.isPending}
                      retryChargePending={chargeMutation.isPending}
                      stripeConfigured={!!stripeConfig?.configured}
                    />
                  )}

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
        onOpenChange={(open) => {
          setGenerateDialogOpen(open);
          if (!open) setGenerateDialogContactId(undefined);
        }}
        contactId={generateDialogContactId}
        showContactPicker={!generateDialogContactId}
      />

      <GenerateByDateRangeDialog
        open={generateByDateRangeOpen}
        onOpenChange={setGenerateByDateRangeOpen}
      />

      <AlertDialog open={!!invoiceToDelete} onOpenChange={(open) => { if (!open) setInvoiceToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the invoice and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-invoice">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-invoice"
              onClick={() => {
                if (invoiceToDelete) deleteMutation.mutate(invoiceToDelete);
                setInvoiceToDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
