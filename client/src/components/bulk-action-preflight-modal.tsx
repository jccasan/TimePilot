import { useQuery } from "@tanstack/react-query";
import { useCurrency } from "@/hooks/use-currency";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  CreditCard,
  Mail,
  SendHorizonal,
  Zap,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Users,
  ShieldAlert,
} from "lucide-react";

export type BulkPreflightAction = "generate" | "send" | "charge";

interface PreflightData {
  generate: {
    totalContacts: number;
    totalDollars: number;
    exceptionCount: number;
    eligibleCount: number;
    eligibleContactIds: string[];
    exceptionContactIds: string[];
    exceptions: {
      missingEmail: number;
      noPaymentMethod: number;
      highValue: number;
      onboardingPending: number;
    };
    breakdown: {
      recurringCount: number;
      recurringDollars: number;
      onetimeCount: number;
      onetimeDollars: number;
    };
  };
  send: {
    totalInvoices: number;
    totalDollars: number;
    missingEmailCount: number;
    eligibleCount: number;
    missingEmailContacts: { id: string; name: string }[];
  };
  charge: {
    eligibleCount: number;
    totalDollars: number;
    skippedCount: number;
  };
}

interface BulkActionPreflightModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionType: BulkPreflightAction;
  onConfirm: (opts?: { excludeExceptions?: boolean; eligibleContactIds?: string[] }) => void;
  onReviewExceptions?: (exceptionContactIds: string[]) => void;
  isPending?: boolean;
}

export function BulkActionPreflightModal({
  open,
  onOpenChange,
  actionType,
  onConfirm,
  onReviewExceptions,
  isPending,
}: BulkActionPreflightModalProps) {
  const { formatMoney } = useCurrency();

  const { data: preflight, isLoading } = useQuery<PreflightData>({
    queryKey: ["/api/invoices/bulk-preflight"],
    enabled: open,
    staleTime: 10_000,
  });

  function handleClose() {
    if (!isPending) onOpenChange(false);
  }

  function renderContent() {
    if (isLoading) {
      return (
        <div className="space-y-3 py-2" data-testid="preflight-loading">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      );
    }

    if (!preflight) return null;

    if (actionType === "generate") {
      const g = preflight.generate;
      const hasExceptions = g.exceptionCount > 0;
      return (
        <div className="space-y-4" data-testid="preflight-generate-body">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Invoices to create</p>
              <p className="text-2xl font-bold" data-testid="preflight-generate-count">
                {g.totalContacts}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Total amount</p>
              <p className="text-2xl font-bold" data-testid="preflight-generate-total">
                {formatMoney(g.totalDollars)}
              </p>
            </div>
          </div>

          {hasExceptions && (
            <div
              className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2"
              data-testid="preflight-generate-exceptions"
            >
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <p className="text-sm font-medium">
                  {g.exceptionCount} contact{g.exceptionCount !== 1 ? "s" : ""} flagged
                </p>
              </div>
              <div className="space-y-1.5 text-sm">
                {g.exceptions.missingEmail > 0 && (
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    <span data-testid="preflight-exception-missing-email">
                      {g.exceptions.missingEmail} missing email — invoice won't be sent
                    </span>
                  </div>
                )}
                {g.exceptions.noPaymentMethod > 0 && (
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                    <CreditCard className="h-3.5 w-3.5 shrink-0" />
                    <span data-testid="preflight-exception-no-payment">
                      {g.exceptions.noPaymentMethod} no payment method on file
                    </span>
                  </div>
                )}
                {g.exceptions.highValue > 0 && (
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                    <TrendingUp className="h-3.5 w-3.5 shrink-0" />
                    <span data-testid="preflight-exception-high-value">
                      {g.exceptions.highValue} invoice{g.exceptions.highValue !== 1 ? "s" : ""} over
                      $500 — review before sending
                    </span>
                  </div>
                )}
                {g.exceptions.onboardingPending > 0 && (
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                    <Users className="h-3.5 w-3.5 shrink-0" />
                    <span data-testid="preflight-exception-onboarding">
                      {g.exceptions.onboardingPending} contact
                      {g.exceptions.onboardingPending !== 1 ? "s" : ""} still in onboarding
                    </span>
                  </div>
                )}
              </div>
              {g.eligibleCount > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400 border-t border-amber-200 dark:border-amber-700 pt-2">
                  {g.eligibleCount} eligible contact{g.eligibleCount !== 1 ? "s" : ""} have no
                  exceptions
                </p>
              )}
            </div>
          )}

          {!hasExceptions && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>All {g.totalContacts} contacts look good — no exceptions found.</span>
            </div>
          )}

          {(g.breakdown.recurringCount > 0 || g.breakdown.onetimeCount > 0) && (
            <div
              className="rounded-lg border bg-muted/40 p-3 space-y-1.5"
              data-testid="preflight-generate-breakdown"
            >
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Invoice Breakdown
              </p>
              {g.breakdown.recurringCount > 0 && (
                <div
                  className="flex items-center justify-between text-sm"
                  data-testid="preflight-breakdown-recurring"
                >
                  <span className="text-muted-foreground">
                    Recurring ({g.breakdown.recurringCount} contact
                    {g.breakdown.recurringCount !== 1 ? "s" : ""})
                  </span>
                  <span className="font-medium">{formatMoney(g.breakdown.recurringDollars)}</span>
                </div>
              )}
              {g.breakdown.onetimeCount > 0 && (
                <div
                  className="flex items-center justify-between text-sm"
                  data-testid="preflight-breakdown-onetime"
                >
                  <span className="text-muted-foreground">
                    One-time ({g.breakdown.onetimeCount} contact
                    {g.breakdown.onetimeCount !== 1 ? "s" : ""})
                  </span>
                  <span className="font-medium">{formatMoney(g.breakdown.onetimeDollars)}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-start gap-2 p-3 rounded-md bg-muted/60 border text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              Visits will be marked as invoiced and removed from this view. This cannot be undone
              without voiding the invoices.
            </p>
          </div>
        </div>
      );
    }

    if (actionType === "send") {
      const s = preflight.send;
      const missingContactCount = s.missingEmailContacts.length;
      const hasMissingEmail = missingContactCount > 0;
      return (
        <div className="space-y-4" data-testid="preflight-send-body">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Invoices to send</p>
              <p className="text-2xl font-bold" data-testid="preflight-send-count">
                {s.totalInvoices}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Total amount</p>
              <p className="text-2xl font-bold" data-testid="preflight-send-total">
                {formatMoney(s.totalDollars)}
              </p>
            </div>
          </div>

          {hasMissingEmail && (
            <div
              className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2"
              data-testid="preflight-send-exceptions"
            >
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <p className="text-sm font-medium">
                  {missingContactCount} contact{missingContactCount !== 1 ? "s" : ""} missing email
                  — their invoice{missingContactCount !== 1 ? "s" : ""} will be skipped
                </p>
              </div>
              <ul className="space-y-1 pl-1" data-testid="preflight-send-missing-email-list">
                {s.missingEmailContacts.slice(0, 5).map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400"
                    data-testid={`preflight-send-missing-contact-${c.id}`}
                  >
                    <Mail className="h-3 w-3 shrink-0" />
                    {c.name}
                  </li>
                ))}
                {s.missingEmailContacts.length > 5 && (
                  <li className="text-xs text-amber-600 dark:text-amber-500 pl-4">
                    + {s.missingEmailContacts.length - 5} more
                  </li>
                )}
              </ul>
              {s.eligibleCount > 0 && (
                <p
                  className="text-sm text-amber-700 dark:text-amber-400 border-t border-amber-200 dark:border-amber-700 pt-2"
                  data-testid="preflight-send-skip-note"
                >
                  {s.eligibleCount} eligible invoice{s.eligibleCount !== 1 ? "s" : ""} will be sent.
                </p>
              )}
            </div>
          )}

          {!hasMissingEmail && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>All {s.totalInvoices} clients have email addresses on file.</span>
            </div>
          )}
        </div>
      );
    }

    if (actionType === "charge") {
      const c = preflight.charge;
      return (
        <div className="space-y-4" data-testid="preflight-charge-body">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Cards to charge</p>
              <p className="text-2xl font-bold" data-testid="preflight-charge-count">
                {c.eligibleCount}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Total to collect</p>
              <p className="text-2xl font-bold" data-testid="preflight-charge-total">
                {formatMoney(c.totalDollars)}
              </p>
            </div>
          </div>

          {c.skippedCount > 0 && (
            <div
              className="flex items-start gap-2 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-sm"
              data-testid="preflight-charge-skipped"
            >
              <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <p className="text-amber-800 dark:text-amber-300">
                {c.skippedCount} invoice{c.skippedCount !== 1 ? "s" : ""} will be skipped — autopay
                is enabled but no card is on file
              </p>
            </div>
          )}

          <div
            className="flex items-start gap-2 p-3 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 text-sm"
            data-testid="preflight-charge-warning"
          >
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <p className="font-medium">
              This will immediately charge {c.eligibleCount} card
              {c.eligibleCount !== 1 ? "s" : ""}. This cannot be undone.
            </p>
          </div>
        </div>
      );
    }

    return null;
  }

  function renderFooter() {
    if (isLoading || !preflight) {
      return (
        <div className="mt-2">
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={isPending}
            data-testid="button-preflight-cancel"
            className="w-full"
          >
            Cancel
          </Button>
        </div>
      );
    }

    if (actionType === "generate") {
      const g = preflight.generate;
      const hasExceptions = g.exceptionCount > 0;
      return (
        <div className="flex flex-col gap-2 mt-2">
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => onConfirm({ excludeExceptions: false })}
              disabled={isPending || g.totalContacts === 0}
              data-testid="button-preflight-generate-all"
            >
              {isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-1 h-4 w-4" />
              )}
              Generate All ({g.totalContacts})
            </Button>
            {hasExceptions && g.eligibleCount > 0 && (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() =>
                  onConfirm({ excludeExceptions: true, eligibleContactIds: g.eligibleContactIds })
                }
                disabled={isPending}
                data-testid="button-preflight-generate-eligible"
              >
                {isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                )}
                Eligible Only ({g.eligibleCount})
              </Button>
            )}
          </div>
          {hasExceptions && onReviewExceptions && (
            <Button
              variant="ghost"
              onClick={() => {
                onOpenChange(false);
                onReviewExceptions(g.exceptionContactIds);
              }}
              data-testid="button-preflight-review-exceptions"
              className="w-full text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300"
            >
              <AlertTriangle className="mr-1 h-4 w-4" />
              Review {g.exceptionCount} Flagged Contact{g.exceptionCount !== 1 ? "s" : ""}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={isPending}
            data-testid="button-preflight-cancel"
            className="w-full"
          >
            Cancel
          </Button>
        </div>
      );
    }

    if (actionType === "send") {
      const s = preflight.send;
      const missingCount = s.missingEmailContacts.length;
      const allBlocked = missingCount > 0 && s.eligibleCount === 0 && s.totalInvoices > 0;
      return (
        <div className="flex flex-col gap-2 mt-2">
          <div className="flex gap-2">
            {!allBlocked && (
              <Button
                className="flex-1"
                onClick={() => onConfirm()}
                disabled={isPending || s.totalInvoices === 0}
                data-testid="button-preflight-send-all"
              >
                {isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <SendHorizonal className="mr-1 h-4 w-4" />
                )}
                {missingCount > 0
                  ? `Send Eligible Only (${s.eligibleCount})`
                  : `Send All (${s.totalInvoices})`}
              </Button>
            )}
            <Button
              variant={allBlocked ? "default" : "outline"}
              onClick={handleClose}
              disabled={isPending}
              data-testid="button-preflight-cancel"
              className={allBlocked ? "flex-1" : ""}
            >
              {allBlocked ? "Close" : "Cancel"}
            </Button>
          </div>
        </div>
      );
    }

    if (actionType === "charge") {
      const c = preflight.charge;
      return (
        <div className="flex gap-2 mt-2">
          <Button
            className="flex-1 bg-red-600 hover:bg-red-700 text-white dark:bg-red-700 dark:hover:bg-red-600"
            onClick={() => onConfirm()}
            disabled={isPending || c.eligibleCount === 0}
            data-testid="button-preflight-charge-confirm"
          >
            {isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <CreditCard className="mr-1 h-4 w-4" />
            )}
            Charge {c.eligibleCount} Card{c.eligibleCount !== 1 ? "s" : ""}
          </Button>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isPending}
            data-testid="button-preflight-cancel"
          >
            Cancel
          </Button>
        </div>
      );
    }

    return null;
  }

  function getTitle() {
    if (actionType === "generate") return "Generate All Invoices";
    if (actionType === "send") return "Send All Draft Invoices";
    return "Charge Autopay";
  }

  function getDescription() {
    if (actionType === "generate")
      return "Review the breakdown below before generating invoices for all uninvoiced work.";
    if (actionType === "send")
      return "Review the breakdown below before emailing all draft invoices.";
    return "Review the breakdown below before charging all autopay-enabled cards.";
  }

  function getIcon() {
    if (actionType === "generate") return <Zap className="h-5 w-5 text-primary" />;
    if (actionType === "send") return <SendHorizonal className="h-5 w-5 text-blue-500" />;
    return <CreditCard className="h-5 w-5 text-emerald-500" />;
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md" data-testid={`dialog-preflight-${actionType}`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getIcon()}
            {getTitle()}
          </DialogTitle>
          <DialogDescription>{getDescription()}</DialogDescription>
        </DialogHeader>
        {renderContent()}
        {renderFooter()}
      </DialogContent>
    </Dialog>
  );
}
