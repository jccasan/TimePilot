/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2 } from "lucide-react";
import { formatMoneyForCurrency } from "@/hooks/use-currency";

interface PublicInvoice {
  invoiceNumber: string;
  total: string;
  status: string;
  dueDate: string;
  companyName: string;
  logoUrl: string;
  contactName: string;
  stripeEnabled: boolean;
  currency: string;
}

const TIP_OPTIONS = [1, 3, 5, 10];

function getCurrencySymbol(currency: string): string {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(0);
  return formatted.replace(/[\d\s,.']/g, "").trim();
}

function getTokenFromPath(): string | undefined {
  const match = window.location.pathname.match(/^\/invoice\/([^/]+)\/pay$/);
  return match?.[1];
}

export default function InvoicePayPage() {
  const token = getTokenFromPath();
  const { toast } = useToast();

  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTip, setSelectedTip] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState("");
  const [paying, setPaying] = useState(false);

  const searchParams = new URLSearchParams(window.location.search);
  const paid = searchParams.get("paid") === "1";

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/invoices/${token}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || "Invoice not found");
        return r.json();
      })
      .then(setInvoice)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const invoiceTotal = invoice ? parseFloat(invoice.total) : 0;
  const tipValue = customTip ? parseFloat(customTip) || 0 : (selectedTip ?? 0);
  const chargeTotal = invoiceTotal + tipValue;
  const canPay = invoice?.stripeEnabled && chargeTotal >= 0.5;
  const currency = invoice?.currency || "usd";
  const fmt = (amount: number) => formatMoneyForCurrency(amount, currency);

  const handlePay = async () => {
    if (!token) return;
    setPaying(true);
    try {
      const res = await fetch(`/api/public/invoices/${token}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipAmount: tipValue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Payment failed");
      if (data.url) window.location.href = data.url;
    } catch (e: any) {
      toast({ title: "Payment error", description: e.message, variant: "destructive" });
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center text-muted-foreground">
          <p className="text-lg font-medium">{error || "Invoice not found"}</p>
        </div>
      </div>
    );
  }

  if (paid || invoice.status === "paid") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-md p-8 max-w-sm w-full text-center space-y-4">
          {invoice.logoUrl && (
            <img
              src={invoice.logoUrl}
              alt={invoice.companyName}
              className="h-16 mx-auto object-contain"
            />
          )}
          <div className="flex justify-center">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
          </div>
          <h1 className="text-xl font-bold text-green-700">Payment Received!</h1>
          <p className="text-muted-foreground text-sm">
            Thank you{invoice.contactName ? `, ${invoice.contactName.split(" ")[0]}` : ""}! Your
            payment for invoice <span className="font-medium">{invoice.invoiceNumber}</span> has
            been received.
          </p>
          <p className="text-xs text-muted-foreground">
            {invoice.companyName} appreciates your business.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="bg-white rounded-2xl shadow-md p-6 max-w-sm w-full space-y-5">
        {invoice.logoUrl && (
          <div className="text-center">
            <img
              src={invoice.logoUrl}
              alt={invoice.companyName}
              className="h-14 mx-auto object-contain"
            />
          </div>
        )}
        <div className="text-center">
          <h1 className="text-lg font-bold">{invoice.companyName}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Invoice {invoice.invoiceNumber}</p>
        </div>

        <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount Due</span>
            <span className="font-semibold">{fmt(invoiceTotal)}</span>
          </div>
          {invoice.contactName && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Billed To</span>
              <span className="font-medium">{invoice.contactName}</span>
            </div>
          )}
          {invoice.dueDate && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Due</span>
              <span>{invoice.dueDate}</span>
            </div>
          )}
        </div>

        {invoice.stripeEnabled ? (
          <>
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {invoiceTotal === 0 ? "Leave a Tip" : "Add a Tip (optional)"}
              </Label>
              <p className="text-xs text-muted-foreground">
                Tips are appreciated but never expected.
              </p>
              <div className="grid grid-cols-4 gap-2">
                {TIP_OPTIONS.map((amt) => (
                  <Button
                    key={amt}
                    type="button"
                    variant={selectedTip === amt && !customTip ? "default" : "outline"}
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setSelectedTip(amt);
                      setCustomTip("");
                    }}
                    data-testid={`button-tip-${amt}`}
                  >
                    {fmt(amt)}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Label
                  htmlFor="custom-tip"
                  className="text-xs text-muted-foreground whitespace-nowrap"
                >
                  Custom:
                </Label>
                <div className="relative flex-1">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground leading-none">
                    {getCurrencySymbol(currency)}
                  </span>
                  <Input
                    id="custom-tip"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    className="pl-10"
                    value={customTip}
                    onChange={(e) => {
                      setCustomTip(e.target.value);
                      setSelectedTip(null);
                    }}
                    data-testid="input-custom-tip"
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div className="flex justify-between text-sm font-semibold">
              <span>Total Charge</span>
              <span data-testid="text-total-charge">{fmt(chargeTotal)}</span>
            </div>

            {!canPay && chargeTotal < 0.5 && (
              <p className="text-xs text-amber-600 text-center">
                {invoiceTotal === 0
                  ? `Please add a tip of at least ${fmt(0.5)} to pay online.`
                  : `Minimum charge is ${fmt(0.5)}.`}
              </p>
            )}

            <Button
              className="w-full"
              onClick={handlePay}
              disabled={paying || !canPay}
              data-testid="button-pay"
            >
              {paying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                `Pay ${fmt(chargeTotal)}`
              )}
            </Button>
          </>
        ) : (
          <div className="text-center text-sm text-muted-foreground py-2">
            <p>Online payment is not available for this invoice.</p>
            <p className="mt-1">Please contact {invoice.companyName} for payment instructions.</p>
          </div>
        )}
      </div>
    </div>
  );
}
