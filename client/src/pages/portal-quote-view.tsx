/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatMoneyForCurrency } from "@/hooks/use-currency";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Home,
  Building2,
  AlertTriangle,
  Loader2,
  CalendarDays,
} from "lucide-react";

interface LineItem {
  pricingItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

interface FrequencyOption {
  perVisit: number;
  monthlyEstimate: number;
}

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
  lineItems?: LineItem[] | null;
  approvalEnabled?: boolean;
  discountType?: string | null;
  discountValue?: string | null;
  discountLabel?: string | null;
  frequencyOptions?: {
    weekly: FrequencyOption;
    biweekly: FrequencyOption;
    monthly: FrequencyOption;
  } | null;
}

const SERVICE_DAYS = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "tbd", label: "No preference — let the provider choose" },
];

export default function PortalQuoteView({ quoteId, token }: { quoteId: string; token: string }) {
  const [selectedTier, setSelectedTier] = useState<string>("");
  const [selectedFrequency, setSelectedFrequency] = useState<string>("");
  const [serviceDay, setServiceDay] = useState<string>("tbd");
  const [startDate, setStartDate] = useState<string>("");

  const { data, isLoading, error } = useQuery<{
    quote: PortalQuote;
    companyName: string;
    companyCurrency: string;
    companyLogoUrl?: string;
    tierNames?: { tier1: string; tier2: string; tier3: string };
  }>({
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
    mutationFn: async ({
      tier,
      frequency,
      day,
      date,
    }: {
      tier?: string;
      frequency?: string;
      day: string;
      date: string;
    }) => {
      const res = await fetch(
        `/api/portal/quotes/${quoteId}/accept?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tier,
            frequency,
            serviceDay: day || "tbd",
            startDate: date || undefined,
          }),
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

  const companyCurrency = (data?.companyCurrency || "usd").toLowerCase();
  const formatMoney = (amount: number) => formatMoneyForCurrency(amount, companyCurrency);

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

  const { quote, companyName, companyLogoUrl } = data;
  // Residential proposals use the company's configured tier labels; commercial
  // quotes keep the fixed defaults.
  const DEFAULT_TIER_LABELS = { tier1: "Essential", tier2: "Property Care", tier3: "Deluxe" };
  const tierLabels =
    quote.type === "residential" ? (data.tierNames ?? DEFAULT_TIER_LABELS) : DEFAULT_TIER_LABELS;
  const approvalEnabled = quote.approvalEnabled !== false;

  if (quote.status === "accepted") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-md text-center">
          <CardContent className="p-8">
            <CheckCircle2 className="h-16 w-16 mx-auto text-green-500 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Service Approved!</h2>
            <p className="text-muted-foreground mb-4">
              Thank you, {quote.contactName}. Your service plan has been created and {companyName}{" "}
              will confirm your schedule shortly.
            </p>
            {quote.selectedPrice && parseFloat(quote.selectedPrice) > 0 && (
              <p className="text-sm font-medium text-green-700">
                {formatMoney(parseFloat(quote.selectedPrice))}/visit
              </p>
            )}
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

  const essentialPriceRaw = parseFloat(quote.essentialPrice || "0");
  const premiumPriceRaw = parseFloat(quote.premiumPrice || "0");
  const deluxePriceRaw = parseFloat(quote.deluxePrice || "0");
  const discountAmt = (base: number) => {
    if (!quote.discountType || !quote.discountValue) return 0;
    const v = parseFloat(quote.discountValue);
    if (!v) return 0;
    return quote.discountType === "percent" ? base * (v / 100) : v;
  };
  const essentialPrice = Math.max(0, essentialPriceRaw - discountAmt(essentialPriceRaw));
  const premiumPrice = Math.max(0, premiumPriceRaw - discountAmt(premiumPriceRaw));
  const deluxePrice = Math.max(0, deluxePriceRaw - discountAmt(deluxePriceRaw));
  const hasLineItems = Array.isArray(quote.lineItems) && quote.lineItems.length > 0;
  const allPricesIdentical =
    quote.type === "residential" && essentialPrice === premiumPrice && premiumPrice === deluxePrice;

  const tiers = [
    {
      key: "essential",
      name: tierLabels.tier1,
      price: essentialPrice,
      features: quote.essentialFeatures || [],
      borderColor: "border-slate-400",
      bgColor: "bg-slate-50",
      textColor: "text-slate-700",
    },
    {
      key: "premium",
      name: tierLabels.tier2,
      price: premiumPrice,
      features: quote.premiumFeatures || [],
      borderColor: "border-green-500",
      bgColor: "bg-green-50",
      textColor: "text-green-700",
      recommended: true,
    },
    {
      key: "deluxe",
      name: tierLabels.tier3,
      price: deluxePrice,
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

  const isResidentialFrequencyMode =
    quote.type === "residential" && !!quote.frequencyOptions && !hasLineItems;

  const canAccept =
    hasLineItems ||
    allPricesIdentical ||
    (isResidentialFrequencyMode ? !!selectedFrequency : !!selectedTier);

  const freqLabelMap: Record<string, string> = {
    weekly: "Weekly",
    biweekly: "Bi-Weekly",
    monthly: "Monthly",
  };

  const acceptLabel =
    hasLineItems || allPricesIdentical
      ? approvalEnabled
        ? "Approve & Start Service"
        : "Accept Quote"
      : isResidentialFrequencyMode
        ? selectedFrequency
          ? approvalEnabled
            ? `Approve ${freqLabelMap[selectedFrequency] || selectedFrequency} Service`
            : `Accept ${freqLabelMap[selectedFrequency] || selectedFrequency} Service`
          : "Select a frequency to continue"
        : selectedTier
          ? approvalEnabled
            ? `Approve ${tiers.find((t) => t.key === selectedTier)?.name} Plan`
            : `Accept ${tiers.find((t) => t.key === selectedTier)?.name} Plan`
          : "Select a plan to continue";

  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white">
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="text-center mb-8">
          {companyLogoUrl && (
            <img
              src={companyLogoUrl}
              alt={companyName}
              className="mx-auto mb-3 max-h-16 max-w-48 object-contain"
              data-testid="img-company-logo"
            />
          )}
          <h1
            className="text-2xl md:text-3xl font-bold text-gray-900 mb-1"
            data-testid="text-company-name"
          >
            {companyName}
          </h1>
          <p className="text-muted-foreground">Service Proposal #{quote.quoteNumber}</p>
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
                  <p className="text-sm text-muted-foreground">{quote.propertyAddress}</p>
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

        {hasLineItems ? (
          <Card className="mb-6" data-testid="card-line-items">
            <CardContent className="p-0">
              <p className="px-6 py-4 text-sm font-semibold text-gray-700 border-b">
                Services Included
              </p>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-6 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Service
                    </th>
                    <th className="text-center px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Qty
                    </th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Unit Price
                    </th>
                    <th className="text-right px-6 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Subtotal
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(quote.lineItems ?? []).map((item, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-6 py-3 text-gray-800">{item.name}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{item.quantity}</td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {formatMoney(item.unitPrice)}
                      </td>
                      <td className="px-6 py-3 text-right font-semibold text-gray-800">
                        {formatMoney(item.unitPrice * item.quantity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t">
                  <tr>
                    <td colSpan={3} className="px-6 py-3 text-right font-bold text-gray-800">
                      Total per visit
                    </td>
                    <td className="px-6 py-3 text-right font-bold text-green-700">
                      {formatMoney(
                        (quote.lineItems ?? []).reduce(
                          (sum, li) => sum + li.unitPrice * li.quantity,
                          0
                        )
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>
        ) : isResidentialFrequencyMode ? (
          <>
            <h2 className="text-lg font-semibold text-center mb-4">
              Choose Your Service Frequency
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {(
                [
                  { key: "weekly", label: "Weekly" },
                  { key: "biweekly", label: "Bi-Weekly", recommended: true },
                  { key: "monthly", label: "Monthly" },
                ] as {
                  key: "weekly" | "biweekly" | "monthly";
                  label: string;
                  recommended?: boolean;
                }[]
              ).map((opt) => {
                const fo = quote.frequencyOptions![opt.key];
                return (
                  <div
                    key={opt.key}
                    data-testid={`portal-freq-${opt.key}`}
                    className={`relative border-2 rounded-xl cursor-pointer transition-all ${
                      selectedFrequency === opt.key
                        ? "border-green-500 bg-green-50 ring-2 ring-offset-2 scale-[1.02]"
                        : "border-gray-200 hover:border-gray-300 hover:shadow-md"
                    }`}
                    onClick={() => setSelectedFrequency(opt.key)}
                  >
                    {opt.recommended && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <Badge className="bg-green-600 text-white">Most Popular</Badge>
                      </div>
                    )}
                    <div className="p-6 text-center">
                      <p className="text-sm font-medium text-muted-foreground mb-1">{opt.label}</p>
                      <p className="text-3xl font-bold text-green-700 mb-1">
                        {formatMoney(fo.perVisit)}
                        <span className="text-sm font-normal text-muted-foreground">/visit</span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        ~{formatMoney(fo.monthlyEstimate)}/month
                      </p>
                    </div>
                    {selectedFrequency === opt.key && (
                      <div className="px-4 py-2 bg-green-50 border-t border-green-500 text-center">
                        <p className="text-sm font-semibold text-green-700">Selected</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : allPricesIdentical ? (
          <Card className="mb-6" data-testid="card-single-price">
            <CardContent className="p-8 text-center">
              <p className="text-sm text-muted-foreground mb-2">Service Price</p>
              {quote.discountType && quote.discountValue && parseFloat(quote.discountValue) > 0 && (
                <p className="text-sm line-through text-muted-foreground mb-0.5">
                  {formatMoney(essentialPriceRaw)}
                </p>
              )}
              <p className="text-4xl font-bold text-green-700 mb-1">
                {formatMoney(essentialPrice)}
                <span className="text-base font-normal text-muted-foreground">/visit</span>
              </p>
              {quote.discountType && quote.discountValue && parseFloat(quote.discountValue) > 0 && (
                <p className="text-sm text-green-600 font-medium mt-1">
                  {quote.discountLabel || "Discount applied"}
                  {" — "}
                  {quote.discountType === "percent"
                    ? `${quote.discountValue}% off`
                    : `${formatMoney(parseFloat(quote.discountValue))} off`}
                </p>
              )}
              <p className="text-sm text-muted-foreground mt-2">{frequencyLabel} service</p>
            </CardContent>
          </Card>
        ) : (
          <>
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
                      {formatMoney(tier.price)}
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
                      <p className={`text-sm font-semibold ${tier.textColor}`}>Selected</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {parseFloat(quote.initialCleanFee || "0") > 0 && (
          <Card className="mb-6 border-amber-200 bg-amber-50">
            <CardContent className="p-4">
              <p className="text-sm text-amber-800">
                <strong>Initial Clean Fee:</strong>{" "}
                {formatMoney(parseFloat(quote.initialCleanFee || "0"))} (one-time) — Covers
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

        {approvalEnabled && (
          <Card className="mb-6 border-green-200 bg-green-50/50" data-testid="card-service-setup">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <CalendarDays className="h-4 w-4 text-green-700" />
                <p className="text-sm font-semibold text-green-800">Service Preferences</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="portal-start-date" className="text-sm font-medium text-gray-700">
                    Preferred start date
                  </Label>
                  <input
                    id="portal-start-date"
                    type="date"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    min={todayStr}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    data-testid="input-start-date"
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to start as soon as possible
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="portal-service-day" className="text-sm font-medium text-gray-700">
                    Preferred service day
                  </Label>
                  <Select value={serviceDay} onValueChange={setServiceDay}>
                    <SelectTrigger
                      id="portal-service-day"
                      className="h-9"
                      data-testid="select-service-day"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SERVICE_DAYS.map((d) => (
                        <SelectItem key={d.value} value={d.value}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Your provider will confirm availability
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            data-testid="button-accept-quote"
            size="lg"
            className="bg-green-600 hover:bg-green-700 font-semibold"
            disabled={acceptMutation.isPending || !canAccept}
            onClick={() => {
              if (isResidentialFrequencyMode) {
                acceptMutation.mutate({
                  frequency: selectedFrequency,
                  day: serviceDay,
                  date: startDate,
                });
              } else {
                const tier = hasLineItems || allPricesIdentical ? "essential" : selectedTier;
                acceptMutation.mutate({
                  tier,
                  day: serviceDay,
                  date: startDate,
                });
              }
            }}
          >
            {acceptMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            {acceptLabel}
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
