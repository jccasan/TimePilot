/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Home,
  Building2,
  AlertTriangle,
  Loader2,
} from "lucide-react";

interface PortalQuote {
  id: string;
  quoteNumber: string;
  type: string;
  status: string;
  contactName: string;
  propertyAddress?: string;
  frequency?: string;
  essentialPrice: string;
  premiumPrice: string;
  deluxePrice: string;
  initialCleanFee?: string;
  selectedTier?: string;
  selectedPrice?: string;
  essentialFeatures?: string[];
  premiumFeatures?: string[];
  deluxeFeatures?: string[];
  notes?: string;
  expiresAt?: string;
  sentAt?: string;
  acceptedAt?: string;
}

export default function PortalQuoteView({ quoteId, token }: { quoteId: string; token: string }) {
  const [selectedTier, setSelectedTier] = useState<string>("");

  const { data, isLoading, error } = useQuery<{ quote: PortalQuote; companyName: string }>({
    queryKey: ["/api/portal/quotes", quoteId, token],
    queryFn: async () => {
      const res = await fetch(`/api/portal/quotes/${quoteId}?token=${encodeURIComponent(token)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Quote not found");
      }
      return res.json();
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async (tier: string) => {
      const res = await fetch(
        `/api/portal/quotes/${quoteId}/accept?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier }),
        }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to accept");
      }
      return res.json();
    },
    onSuccess: () => {
      window.location.reload();
    },
  });

  const declineMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/portal/quotes/${quoteId}/decline?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to decline");
      }
      return res.json();
    },
    onSuccess: () => {
      window.location.reload();
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
        <Card className="w-full max-w-3xl">
          <CardContent className="p-8 space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
            <div className="grid grid-cols-3 gap-4 mt-6">
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    const errorMsg = (error as Error)?.message;
    const isAccessDenied =
      errorMsg?.includes("access token") || errorMsg?.includes("Invalid or missing");
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-md text-center">
          <CardContent className="p-8">
            <AlertTriangle className="h-12 w-12 mx-auto text-amber-500 mb-4" />
            <h2 className="text-lg font-semibold mb-2">
              {isAccessDenied ? "Access Denied" : "Quote Not Found"}
            </h2>
            <p className="text-muted-foreground">
              {errorMsg || "This quote may have been removed or the link is invalid."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { quote, companyName } = data;

  if (quote.status === "accepted") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-md text-center">
          <CardContent className="p-8">
            <CheckCircle2 className="h-16 w-16 mx-auto text-green-500 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Quote Accepted!</h2>
            <p className="text-muted-foreground mb-4">
              Thank you, {quote.contactName}. You selected the{" "}
              <strong className="capitalize">{quote.selectedTier}</strong> plan at{" "}
              <strong>${parseFloat(quote.selectedPrice || "0").toFixed(2)}/visit</strong>.
            </p>
            <p className="text-sm text-muted-foreground">
              {companyName} will reach out to schedule your first service.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (quote.status === "declined") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-md text-center">
          <CardContent className="p-8">
            <XCircle className="h-16 w-16 mx-auto text-gray-400 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Quote Declined</h2>
            <p className="text-muted-foreground">
              This quote has been declined. Contact {companyName} if you'd like a new quote.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (quote.status === "expired") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-md text-center">
          <CardContent className="p-8">
            <Clock className="h-16 w-16 mx-auto text-amber-500 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Quote Expired</h2>
            <p className="text-muted-foreground">
              This quote is no longer valid. Contact {companyName} for a new quote.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const tiers = [
    {
      key: "essential",
      name: "Essential",
      price: parseFloat(quote.essentialPrice || "0"),
      features: quote.essentialFeatures || [],
      borderColor: "border-slate-400",
      bgColor: "bg-slate-50",
      textColor: "text-slate-700",
    },
    {
      key: "premium",
      name: "Property Care",
      price: parseFloat(quote.premiumPrice || "0"),
      features: quote.premiumFeatures || [],
      borderColor: "border-green-500",
      bgColor: "bg-green-50",
      textColor: "text-green-700",
      recommended: true,
    },
    {
      key: "deluxe",
      name: "Deluxe",
      price: parseFloat(quote.deluxePrice || "0"),
      features: quote.deluxeFeatures || [],
      borderColor: "border-violet-500",
      bgColor: "bg-violet-50",
      textColor: "text-violet-700",
    },
  ];

  const frequencyLabel =
    quote.frequency === "weekly"
      ? "Weekly"
      : quote.frequency === "biweekly"
        ? "Bi-weekly"
        : quote.frequency === "monthly"
          ? "Monthly"
          : quote.frequency === "1x_weekly"
            ? "Weekly"
            : quote.frequency === "2x_weekly"
              ? "2x Weekly"
              : quote.frequency === "3x_weekly"
                ? "3x Weekly"
                : quote.frequency || "";

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white">
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="text-center mb-8">
          <h1
            className="text-2xl md:text-3xl font-bold text-gray-900 mb-1"
            data-testid="text-company-name"
          >
            {companyName}
          </h1>
          <p className="text-muted-foreground">
            Service {quote.type === "commercial" ? "Proposal" : "Quote"} #{quote.quoteNumber}
          </p>
        </div>

        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Prepared for</p>
                <p className="text-lg font-semibold" data-testid="text-contact-name">
                  {quote.contactName}
                </p>
                {quote.propertyAddress && (
                  <p className="text-sm text-muted-foreground">📍 {quote.propertyAddress}</p>
                )}
              </div>
              <div className="text-right">
                <Badge variant="outline" className="mb-1">
                  {quote.type === "residential" ? (
                    <Home className="h-3 w-3 mr-1" />
                  ) : (
                    <Building2 className="h-3 w-3 mr-1" />
                  )}
                  <span className="capitalize">{quote.type}</span>
                </Badge>
                <p className="text-sm text-muted-foreground">{frequencyLabel} Service</p>
                {quote.expiresAt && (
                  <p className="text-xs text-amber-600 mt-1">
                    Expires{" "}
                    {new Date(quote.expiresAt).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <h2 className="text-lg font-semibold text-center mb-4">Choose Your Service Level</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {tiers.map((tier) => (
            <div
              key={tier.key}
              data-testid={`portal-tier-${tier.key}`}
              className={`relative border-2 rounded-xl cursor-pointer transition-all ${
                selectedTier === tier.key
                  ? `${tier.borderColor} ${tier.bgColor} ring-2 ring-offset-2 scale-[1.02]`
                  : "border-gray-200 hover:border-gray-300 hover:shadow-md"
              }`}
              onClick={() => setSelectedTier(tier.key)}
            >
              {tier.recommended && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-green-600 text-white">Most Popular</Badge>
                </div>
              )}
              <div className="p-6 text-center">
                <p className="text-sm font-medium text-muted-foreground mb-1">{tier.name}</p>
                <p className={`text-3xl font-bold ${tier.textColor} mb-4`}>
                  ${tier.price.toFixed(2)}
                  <span className="text-sm font-normal text-muted-foreground">/visit</span>
                </p>
                <ul className="space-y-2 text-left">
                  {tier.features.map((f, i) => (
                    <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {selectedTier === tier.key && (
                <div
                  className={`px-4 py-2 ${tier.bgColor} border-t ${tier.borderColor} text-center`}
                >
                  <p className={`text-sm font-semibold ${tier.textColor}`}>Selected ✓</p>
                </div>
              )}
            </div>
          ))}
        </div>

        {parseFloat(quote.initialCleanFee || "0") > 0 && (
          <Card className="mb-6 border-amber-200 bg-amber-50">
            <CardContent className="p-4">
              <p className="text-sm text-amber-800">
                <strong>Initial Clean Fee:</strong> $
                {parseFloat(quote.initialCleanFee || "0").toFixed(2)} (one-time) — Covers
                first-visit deep clean.
              </p>
            </CardContent>
          </Card>
        )}

        {quote.notes && (
          <Card className="mb-6">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{quote.notes}</p>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            data-testid="button-accept-quote"
            size="lg"
            className="bg-green-600 hover:bg-green-700"
            disabled={!selectedTier || acceptMutation.isPending}
            onClick={() => selectedTier && acceptMutation.mutate(selectedTier)}
          >
            {acceptMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            {selectedTier
              ? `Accept ${tiers.find((t) => t.key === selectedTier)?.name} Plan`
              : "Select a plan to accept"}
          </Button>
          <Button
            data-testid="button-decline-quote"
            variant="outline"
            size="lg"
            disabled={declineMutation.isPending}
            onClick={() => {
              if (confirm("Are you sure you want to decline this quote?")) {
                declineMutation.mutate();
              }
            }}
          >
            {declineMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <XCircle className="h-4 w-4 mr-2" />
            )}
            Decline
          </Button>
        </div>

        {(acceptMutation.isError || declineMutation.isError) && (
          <p className="text-center text-sm text-red-500 mt-3">
            {(acceptMutation.error as any)?.message || (declineMutation.error as any)?.message}
          </p>
        )}

        <p className="text-center text-xs text-muted-foreground mt-8">Powered by {companyName}</p>
      </div>
    </div>
  );
}
