import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, CreditCard, AlertCircle } from "lucide-react";

interface BillingSetupInfo {
  expired?: boolean;
  alreadyUsed?: boolean;
  contactFirstName?: string;
  companyName?: string;
  cardOnFile?: boolean;
}

function getTokenFromPath(): string | undefined {
  const match = window.location.pathname.match(/^\/billing-setup\/([^/]+)$/);
  return match?.[1];
}

export default function BillingSetupPage() {
  const token = getTokenFromPath();
  const searchParams = new URLSearchParams(window.location.search);
  const success = searchParams.get("success") === "1";

  const [info, setInfo] = useState<BillingSetupInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    fetch(`/api/public/billing-setup/${token}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || "Failed to load");
        return r.json();
      })
      .then(setInfo)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSetupBilling = async () => {
    if (!token) return;
    setRedirecting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/billing-setup/${token}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start billing setup");
      if (data.url) window.location.href = data.url;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setRedirecting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!token || (!info && !error)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-md p-8 max-w-sm w-full text-center space-y-3">
          <AlertCircle className="h-12 w-12 text-amber-500 mx-auto" />
          <h1 className="text-lg font-semibold">Invalid Link</h1>
          <p className="text-sm text-muted-foreground">
            This billing setup link is not valid. Please contact your service provider for a new
            link.
          </p>
        </div>
      </div>
    );
  }

  if (info?.expired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-md p-8 max-w-sm w-full text-center space-y-3">
          <AlertCircle className="h-12 w-12 text-amber-500 mx-auto" />
          <h1 className="text-lg font-semibold">Link Expired</h1>
          <p className="text-sm text-muted-foreground">
            This billing setup link has expired or is no longer valid. Please contact{" "}
            {info?.companyName ? (
              <span className="font-medium">{info.companyName}</span>
            ) : (
              "your service provider"
            )}{" "}
            to request a new link.
          </p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-md p-8 max-w-sm w-full text-center space-y-4">
          {info?.companyName && (
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {info.companyName}
            </p>
          )}
          <div className="flex justify-center">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
          </div>
          <h1 className="text-xl font-bold text-green-700">Payment Method Saved</h1>
          <p className="text-sm text-muted-foreground">
            {info?.contactFirstName ? `Thanks, ${info.contactFirstName}! Your` : "Your"} payment
            method has been saved securely. Future invoices can now be paid automatically.
          </p>
          {info?.companyName && (
            <p className="text-xs text-muted-foreground pt-2">
              {info.companyName} thanks you for being a customer.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="bg-white rounded-2xl shadow-md p-6 max-w-sm w-full space-y-5">
        {info?.companyName && (
          <div className="text-center">
            <h1 className="text-lg font-bold">{info.companyName}</h1>
          </div>
        )}

        <div className="text-center space-y-1">
          <div className="flex justify-center">
            <CreditCard className="h-12 w-12 text-primary" />
          </div>
          <h2 className="text-base font-semibold">
            {info?.contactFirstName
              ? `Hi ${info.contactFirstName} — add a payment method`
              : "Add a payment method"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Save a card on file for easy, automatic invoice payments. No account login required.
          </p>
        </div>

        {info?.cardOnFile && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 text-center">
            You already have a payment method on file. You can add a new one below to replace it.
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 text-center">
            {error}
          </div>
        )}

        <Button
          className="w-full"
          onClick={handleSetupBilling}
          disabled={redirecting}
          data-testid="button-setup-billing"
        >
          {redirecting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Redirecting...
            </>
          ) : info?.cardOnFile ? (
            "Update Payment Method"
          ) : (
            "Add Payment Method"
          )}
        </Button>

        <p className="text-xs text-center text-muted-foreground">
          Your card details are processed securely by Stripe. We never store your full card number.
        </p>
      </div>
    </div>
  );
}
