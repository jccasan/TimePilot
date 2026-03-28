import { useState, useMemo } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Dog, Loader2, Phone } from "lucide-react";

type PricingMetadata = {
  callForQuote?: boolean;
  [key: string]: unknown;
};

type PricingItem = {
  id: string;
  name: string;
  basePrice: string;
  category: string;
  unit: string;
  metadata: PricingMetadata | null;
  sortOrder: number;
};

type CompanyInfo = {
  name: string;
  logoUrl: string | null;
  pricing: PricingItem[];
  primaryColor: string | null;
};

type QuoteResult = {
  contactId: string;
  quote: {
    recommendedPriceCents: number;
    frequency: string;
    callForQuote?: boolean;
  };
};

type DogTier = {
  label: string;
  value: string;
  dogCount: number;
  surcharge: number;
  callForQuote: boolean;
  pricingItemId: string;
};

type FrequencyOption = {
  key: string;
  label: string;
  basePriceCents: number;
  callForQuote: boolean;
};

type LotAddon = {
  label: string;
  value: string;
  surcharge: number;
  callForQuote: boolean;
  pricingItemId: string | null;
};

const FREQ_DISPLAY: Record<string, string> = {
  twice_weekly: "Two Times a Week",
  weekly: "Once a Week",
  biweekly: "Every Other Week",
  monthly: "Monthly",
  onetime: "One-Time",
};

const FREQ_KEYWORDS: Record<string, string[]> = {
  twice_weekly: ["twice weekly", "twice-weekly", "two times", "2x", "twice per week", "2 times a week"],
  weekly: ["weekly", "once a week", "once per week", "1x"],
  biweekly: ["bi-weekly", "bi weekly", "every other week", "biweekly", "bi-weekly"],
  monthly: ["monthly"],
  onetime: ["one-time", "one time", "onetime"],
};

const BACKEND_FREQ_MAP: Record<string, string> = {
  twice_weekly: "twice_weekly",
  weekly: "weekly",
  biweekly: "biweekly",
  monthly: "monthly",
  onetime: "onetime",
};

const DAY_OPTIONS = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
];

function parsePricingData(pricing: PricingItem[]) {
  const recurring = pricing.filter(p => p.category === "recurring_service");
  const addons = pricing.filter(p => p.category === "add_on");

  const detectFreq = (name: string): string | null => {
    const lower = name.toLowerCase();
    for (const [freq, keys] of Object.entries(FREQ_KEYWORDS)) {
      if (freq === "weekly") continue;
      if (keys.some(k => lower.includes(k))) return freq;
    }
    if (FREQ_KEYWORDS.weekly.some(k => lower.includes(k))) return "weekly";
    return null;
  };

  const parseDogCount = (name: string): { count: number; isPlus: boolean } | null => {
    const lower = name.toLowerCase();
    const plusMatch = lower.match(/(\d+)\s*\+\s*dog/);
    if (plusMatch) return { count: parseInt(plusMatch[1]), isPlus: true };
    const nMatch = lower.match(/(\d+)\s*dog/);
    if (nMatch) return { count: parseInt(nMatch[1]), isPlus: false };
    return null;
  };

  const freqGroups: Record<string, { dogCount: number; price: number; callForQuote: boolean; isPlus: boolean }[]> = {};

  for (const item of recurring) {
    const freq = detectFreq(item.name);
    if (!freq) continue;
    const dog = parseDogCount(item.name);
    if (!dog) continue;
    if (!freqGroups[freq]) freqGroups[freq] = [];
    const cfq = !!(item.metadata?.callForQuote);
    freqGroups[freq].push({
      dogCount: dog.count,
      price: cfq ? 0 : Math.round(parseFloat(item.basePrice) * 100),
      callForQuote: cfq,
      isPlus: dog.isPlus,
      itemId: item.id,
    });
  }

  for (const freq of Object.keys(freqGroups)) {
    freqGroups[freq].sort((a, b) => a.dogCount - b.dogCount);
  }

  const availableFreqs = Object.keys(freqGroups).filter(f => freqGroups[f].length > 0);

  const buildDogTiers = (dogItems: typeof freqGroups[string]): DogTier[] => {
    if (dogItems.length === 0) return [];
    const tiers: DogTier[] = [];
    const basePriceCents = dogItems[0].price;

    const regular = dogItems.filter(d => !d.isPlus && !d.callForQuote);
    const plusDogItems = dogItems.filter(d => d.isPlus || d.callForQuote);

    for (let i = 0; i < regular.length; i += 2) {
      const first = regular[i];
      const second = regular[i + 1];
      const surcharge = first.price - basePriceCents;

      if (second) {
        tiers.push({
          label: surcharge > 0
            ? `${first.dogCount}-${second.dogCount} dogs (+$${(surcharge / 100).toFixed(0)})`
            : `${first.dogCount}-${second.dogCount} dogs (Base Price)`,
          value: String(first.dogCount),
          dogCount: first.dogCount,
          surcharge,
          callForQuote: false,
          pricingItemId: first.itemId,
        });
      } else {
        tiers.push({
          label: surcharge > 0
            ? `${first.dogCount} dog${first.dogCount > 1 ? "s" : ""} (+$${(surcharge / 100).toFixed(0)})`
            : `${first.dogCount} dog${first.dogCount > 1 ? "s" : ""} (Base Price)`,
          value: String(first.dogCount),
          dogCount: first.dogCount,
          surcharge,
          callForQuote: false,
          pricingItemId: first.itemId,
        });
      }
    }

    for (const plus of plusDogItems) {
      const surcharge = plus.callForQuote ? 0 : (plus.price - basePriceCents);
      tiers.push({
        label: plus.callForQuote
          ? `${plus.dogCount}+ dogs (Call for Quote)`
          : surcharge > 0
            ? `${plus.dogCount}+ dogs (+$${(surcharge / 100).toFixed(0)})`
            : `${plus.dogCount}+ dogs`,
        value: String(plus.dogCount),
        dogCount: plus.dogCount,
        surcharge: plus.callForQuote ? 0 : surcharge,
        callForQuote: plus.callForQuote,
        pricingItemId: plus.itemId,
      });
    }

    return tiers;
  };

  const lotAddons: LotAddon[] = [];
  const lotItems = addons
    .filter(p => p.name.toLowerCase().includes("lot size") || p.name.toLowerCase().includes("acre"))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  for (const item of lotItems) {
    const price = parseFloat(item.basePrice);
    const acreMatch = item.name.match(/([\d.]+)\s*acre/i);
    const acre = acreMatch ? parseFloat(acreMatch[1]) : 0;
    lotAddons.push({
      label: price > 0 ? `${item.name} (+$${price.toFixed(0)}/visit)` : `${item.name} (Base price)`,
      value: String(acre || item.sortOrder),
      surcharge: Math.round(price * 100),
      callForQuote: false,
      pricingItemId: item.id,
    });
  }
  if (lotAddons.length === 0) {
    lotAddons.push(
      { label: "Small (under 1/4 acre)", value: "small", surcharge: 0, callForQuote: false, pricingItemId: null },
      { label: "Medium (1/4 - 1/2 acre)", value: "medium", surcharge: 0, callForQuote: false, pricingItemId: null },
      { label: "Large (1/2 - 1 acre)", value: "large", surcharge: 0, callForQuote: false, pricingItemId: null },
      { label: "Extra Large (1+ acre)", value: "extra-large", surcharge: 0, callForQuote: false, pricingItemId: null },
    );
  }

  return { freqGroups, availableFreqs, buildDogTiers, lotAddons };
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return null;
  let r = parseInt(match[1], 16) / 255;
  let g = parseInt(match[2], 16) / 255;
  let b = parseInt(match[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function getBrandStyles(primaryColor: string | null) {
  const defaultColor = "#15803d";
  const color = primaryColor || defaultColor;
  const hsl = hexToHsl(color);
  if (!hsl) return {
    headerBg: defaultColor,
    headerBgHover: "#166534",
    buttonBg: defaultColor,
    buttonHover: "#166534",
    lightBg: "#f0fdf4",
    lightBorder: "#bbf7d0",
    accentText: defaultColor,
    accentHover: "#166534",
    checkBg: "#dcfce7",
    checkIcon: "#16a34a",
    gradientFrom: "#f0fdf4",
  };

  const lighterBg = `hsl(${hsl.h}, ${Math.min(hsl.s + 10, 100)}%, 95%)`;
  const lightBorder = `hsl(${hsl.h}, ${Math.min(hsl.s + 5, 100)}%, 85%)`;
  const darkerShade = `hsl(${hsl.h}, ${hsl.s}%, ${Math.max(hsl.l - 10, 10)}%)`;
  const checkBg = `hsl(${hsl.h}, ${Math.min(hsl.s + 10, 100)}%, 92%)`;
  const checkIcon = `hsl(${hsl.h}, ${hsl.s}%, ${Math.max(hsl.l + 5, 40)}%)`;

  return {
    headerBg: color,
    headerBgHover: darkerShade,
    buttonBg: color,
    buttonHover: darkerShade,
    lightBg: lighterBg,
    lightBorder,
    accentText: color,
    accentHover: darkerShade,
    checkBg,
    checkIcon,
    gradientFrom: lighterBg,
  };
}

export default function SignupWidget() {
  const [, params] = useRoute("/signup/:slug");
  const slug = params?.slug || "";

  const { data: company, isLoading, error } = useQuery<CompanyInfo>({
    queryKey: ["/api/public/company", slug],
    queryFn: async () => {
      const res = await fetch(`/api/public/company/${slug}`);
      if (!res.ok) throw new Error("Company not found");
      return res.json();
    },
    enabled: !!slug,
  });

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    streetAddress: "",
    city: "",
    state: "",
    zipCode: "",
    serviceDay: "",
  });
  const [selectedFreq, setSelectedFreq] = useState<string>("");
  const [selectedDogTier, setSelectedDogTier] = useState<string>("");
  const [selectedLot, setSelectedLot] = useState<string>("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [quoteResult, setQuoteResult] = useState<QuoteResult | null>(null);

  const brandStyles = useMemo(() => getBrandStyles(company?.primaryColor || null), [company?.primaryColor]);

  const parsed = useMemo(() => {
    if (!company?.pricing) return null;
    return parsePricingData(company.pricing);
  }, [company?.pricing]);

  const hasPricing = !!(parsed && parsed.availableFreqs.length > 0);

  const dogTiers = useMemo(() => {
    if (!parsed || !selectedFreq || !parsed.freqGroups[selectedFreq]) return [];
    return parsed.buildDogTiers(parsed.freqGroups[selectedFreq]);
  }, [parsed, selectedFreq]);

  const currentTier = useMemo(() => {
    if (!dogTiers.length || !selectedDogTier) return null;
    return dogTiers.find(t => t.value === selectedDogTier) || null;
  }, [dogTiers, selectedDogTier]);

  const currentLot = useMemo(() => {
    if (!parsed || !selectedLot) return null;
    return parsed.lotAddons.find(l => l.value === selectedLot) || null;
  }, [parsed, selectedLot]);

  const freqBasePrice = useMemo(() => {
    if (!parsed || !selectedFreq || !parsed.freqGroups[selectedFreq]) return 0;
    const items = parsed.freqGroups[selectedFreq];
    const first = items.find(i => !i.callForQuote);
    return first ? first.price : 0;
  }, [parsed, selectedFreq]);

  const livePrice = useMemo(() => {
    if (!hasPricing || !currentTier) return null;
    if (currentTier.callForQuote) return { callForQuote: true, cents: 0 };
    const base = freqBasePrice + currentTier.surcharge;
    const lotSurcharge = currentLot ? currentLot.surcharge : 0;
    return { callForQuote: false, cents: base + lotSurcharge };
  }, [hasPricing, currentTier, freqBasePrice, currentLot]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const numberOfDogs = currentTier ? currentTier.dogCount : 1;
      const backendFreq = BACKEND_FREQ_MAP[selectedFreq] || selectedFreq || "weekly";
      let yardSize: string;
      if (["small", "medium", "large", "extra-large"].includes(selectedLot)) {
        yardSize = selectedLot;
      } else {
        const acreVal = parseFloat(selectedLot);
        if (!isNaN(acreVal)) {
          if (acreVal <= 0.25) yardSize = "small";
          else if (acreVal <= 0.5) yardSize = "medium";
          else if (acreVal <= 0.75) yardSize = "large";
          else yardSize = "extra-large";
        } else {
          yardSize = "medium";
        }
      }
      const pricingItemId = currentTier?.pricingItemId || undefined;
      const lotAddonId = currentLot?.pricingItemId || undefined;
      const res = await fetch(`/api/public/leads/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          numberOfDogs,
          serviceDay: formData.serviceDay || undefined,
          yardSize,
          serviceFrequency: backendFreq,
          pricingItemId,
          lotAddonId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Submission failed");
      }
      return res.json() as Promise<QuoteResult>;
    },
    onSuccess: (data) => {
      setQuoteResult(data);
    },
  });

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="p-8 space-y-4">
            <Skeleton className="h-8 w-48 mx-auto" />
            <Skeleton className="h-4 w-64 mx-auto" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="p-8 text-center">
            <Dog className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-company-not-found">Company Not Found</h2>
            <p className="text-muted-foreground">This signup page is not available. Please check the link and try again.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (quoteResult) {
    const isCallForQuote = quoteResult.quote.callForQuote;
    const priceDollars = (quoteResult.quote.recommendedPriceCents / 100).toFixed(2);
    const freqLabel = selectedFreq ? (FREQ_DISPLAY[selectedFreq] || selectedFreq) : "visit";
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: `linear-gradient(to bottom, ${brandStyles.gradientFrom}, white)` }}>
        <Card className="w-full max-w-lg">
          <div className="p-6 text-center rounded-t-lg" style={{ backgroundColor: brandStyles.headerBg }}>
            {company.logoUrl && (
              <img src={company.logoUrl} alt={company.name} className="h-12 mx-auto mb-3 rounded" data-testid="img-company-logo" />
            )}
            <h1 className="text-xl font-bold text-white" data-testid="text-company-name">{company.name}</h1>
          </div>
          <CardContent className="p-8 text-center space-y-6">
            <div className="flex justify-center">
              <div className="h-16 w-16 rounded-full flex items-center justify-center" style={{ backgroundColor: brandStyles.checkBg }}>
                {isCallForQuote ? (
                  <Phone className="h-8 w-8" style={{ color: brandStyles.checkIcon }} />
                ) : (
                  <CheckCircle2 className="h-8 w-8" style={{ color: brandStyles.checkIcon }} />
                )}
              </div>
            </div>
            <div>
              {isCallForQuote ? (
                <>
                  <h2 className="text-2xl font-bold mb-2" data-testid="text-quote-title">We'll Get You a Custom Quote</h2>
                  <p className="text-lg text-muted-foreground" data-testid="text-quote-price">
                    A team member will contact you with personalized pricing.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-bold mb-2" data-testid="text-quote-title">Your Estimated Quote</h2>
                  <div className="text-4xl font-bold mb-1" style={{ color: brandStyles.accentText }} data-testid="text-quote-price">
                    ${priceDollars}
                  </div>
                  <p className="text-muted-foreground" data-testid="text-quote-frequency">per {freqLabel.toLowerCase()} visit</p>
                </>
              )}
            </div>
            <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground space-y-2">
              <p>Thank you, {formData.firstName}! Your information has been submitted.</p>
              <p>A representative from <strong>{company.name}</strong> will reach out to you shortly to confirm your service and schedule.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isFormValid = formData.firstName.trim().length > 0 &&
    formData.streetAddress.trim().length > 0 &&
    formData.city.trim().length > 0 &&
    formData.state.trim().length > 0 &&
    formData.zipCode.trim().length > 0 &&
    smsOptIn &&
    !!selectedFreq && !!selectedDogTier && !!selectedLot;

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: `linear-gradient(to bottom, ${brandStyles.gradientFrom}, white)` }}>
      <Card className="w-full max-w-lg">
        <div className="p-6 text-center rounded-t-lg" style={{ backgroundColor: brandStyles.headerBg }}>
          {company.logoUrl && (
            <img src={company.logoUrl} alt={company.name} className="h-12 mx-auto mb-3 rounded" data-testid="img-company-logo" />
          )}
          <h1 className="text-xl font-bold text-white" data-testid="text-company-name">{company.name}</h1>
          <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.8)" }}>Get a free quote for pet waste removal</p>
        </div>
        <CardContent className="p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (isFormValid) submitMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => updateField("firstName", e.target.value)}
                  required
                  data-testid="input-first-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => updateField("lastName", e.target.value)}
                  data-testid="input-last-name"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  data-testid="input-email"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  data-testid="input-phone"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="streetAddress">Street Address *</Label>
              <Input
                id="streetAddress"
                value={formData.streetAddress}
                onChange={(e) => updateField("streetAddress", e.target.value)}
                required
                data-testid="input-street-address"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="city">City *</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => updateField("city", e.target.value)}
                  required
                  data-testid="input-city"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="state">State *</Label>
                <Input
                  id="state"
                  value={formData.state}
                  onChange={(e) => updateField("state", e.target.value)}
                  maxLength={2}
                  required
                  data-testid="input-state"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="zipCode">ZIP Code *</Label>
                <Input
                  id="zipCode"
                  value={formData.zipCode}
                  onChange={(e) => updateField("zipCode", e.target.value)}
                  required
                  data-testid="input-zip-code"
                />
              </div>
            </div>

            {hasPricing && parsed ? (
              <>
                <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: brandStyles.lightBorder, backgroundColor: brandStyles.lightBg }}>
                  <h3 className="font-semibold text-sm" style={{ color: brandStyles.accentText }}>Service Options</h3>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Service Frequency *</Label>
                    <div className="space-y-1.5">
                      {parsed.availableFreqs.map(freq => {
                        const items = parsed.freqGroups[freq];
                        let priceLabel = "";
                        if (selectedDogTier) {
                          const dogCount = parseInt(selectedDogTier);
                          const matchedItem = items.find(i => i.dogCount === dogCount);
                          if (matchedItem) {
                            priceLabel = matchedItem.callForQuote ? "Call for Quote" : `$${(matchedItem.price / 100).toFixed(2)}/visit`;
                          }
                        }
                        if (!priceLabel) {
                          const baseItem = items.find(i => !i.callForQuote);
                          priceLabel = baseItem ? `from $${(baseItem.price / 100).toFixed(2)}/visit` : "";
                        }
                        const isSelected = selectedFreq === freq;
                        return (
                          <label
                            key={freq}
                            className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                              isSelected ? "border-2 bg-white shadow-sm" : "border-transparent hover:bg-white/60"
                            }`}
                            style={isSelected ? { borderColor: brandStyles.accentText } : {}}
                            data-testid={`radio-freq-${freq}`}
                          >
                            <input
                              type="radio"
                              name="frequency"
                              value={freq}
                              checked={isSelected}
                              onChange={() => {
                                setSelectedFreq(freq);
                                setSelectedDogTier("");
                              }}
                              className="h-4 w-4"
                              style={{ accentColor: brandStyles.accentText }}
                            />
                            <span className="flex-1 text-sm">{FREQ_DISPLAY[freq] || freq}</span>
                            {priceLabel && <span className="text-xs text-muted-foreground">{priceLabel}</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {selectedFreq && dogTiers.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">How Many Dogs? *</Label>
                      <div className="space-y-1.5">
                        {dogTiers.map(tier => {
                          const isSelected = selectedDogTier === tier.value;
                          return (
                            <label
                              key={tier.value}
                              className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                                isSelected ? "border-2 bg-white shadow-sm" : "border-transparent hover:bg-white/60"
                              }`}
                              style={isSelected ? { borderColor: brandStyles.accentText } : {}}
                              data-testid={`radio-dogs-${tier.value}`}
                            >
                              <input
                                type="radio"
                                name="dogs"
                                value={tier.value}
                                checked={isSelected}
                                onChange={() => setSelectedDogTier(tier.value)}
                                className="h-4 w-4"
                                style={{ accentColor: brandStyles.accentText }}
                              />
                              <span className="text-sm">{tier.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {selectedDogTier && parsed.lotAddons.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Estimated Lot Size *</Label>
                      <div className="space-y-1.5">
                        {parsed.lotAddons.map(lot => {
                          const isSelected = selectedLot === lot.value;
                          return (
                            <label
                              key={lot.value}
                              className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                                isSelected ? "border-2 bg-white shadow-sm" : "border-transparent hover:bg-white/60"
                              }`}
                              style={isSelected ? { borderColor: brandStyles.accentText } : {}}
                              data-testid={`radio-lot-${lot.value}`}
                            >
                              <input
                                type="radio"
                                name="lotSize"
                                value={lot.value}
                                checked={isSelected}
                                onChange={() => setSelectedLot(lot.value)}
                                className="h-4 w-4"
                                style={{ accentColor: brandStyles.accentText }}
                              />
                              <span className="text-sm">{lot.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {livePrice && (
                  <div className="rounded-lg p-4 text-center border" style={{ borderColor: brandStyles.lightBorder, backgroundColor: brandStyles.lightBg }}>
                    {livePrice.callForQuote ? (
                      <div className="flex items-center justify-center gap-2">
                        <Phone className="h-5 w-5" style={{ color: brandStyles.accentText }} />
                        <span className="font-semibold" style={{ color: brandStyles.accentText }} data-testid="text-live-price">
                          Call for Quote
                        </span>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground mb-1">Estimated Price</p>
                        <p className="text-3xl font-bold" style={{ color: brandStyles.accentText }} data-testid="text-live-price">
                          ${(livePrice.cents / 100).toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">per visit</p>
                      </>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="border rounded-lg p-4 space-y-4" style={{ borderColor: brandStyles.lightBorder, backgroundColor: brandStyles.lightBg }}>
                <h3 className="font-semibold text-sm" style={{ color: brandStyles.accentText }}>Service Options</h3>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Service Frequency *</Label>
                  <div className="space-y-1.5">
                    {[
                      { value: "weekly", label: "Once a Week" },
                      { value: "biweekly", label: "Every Other Week" },
                      { value: "onetime", label: "One-Time Cleaning" },
                    ].map(opt => {
                      const isSelected = selectedFreq === opt.value;
                      return (
                        <label
                          key={opt.value}
                          className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                            isSelected ? "border-2 bg-white shadow-sm" : "border-transparent hover:bg-white/60"
                          }`}
                          style={isSelected ? { borderColor: brandStyles.accentText } : {}}
                          data-testid={`radio-freq-${opt.value}`}
                        >
                          <input type="radio" name="frequency" value={opt.value} checked={isSelected}
                            onChange={() => setSelectedFreq(opt.value)} className="h-4 w-4"
                            style={{ accentColor: brandStyles.accentText }} />
                          <span className="flex-1 text-sm">{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Number of Dogs *</Label>
                  <div className="space-y-1.5">
                    {[
                      { value: "1", label: "1-2 dogs" },
                      { value: "3", label: "3-4 dogs" },
                      { value: "5", label: "5-6 dogs" },
                      { value: "7", label: "7+ dogs" },
                    ].map(opt => {
                      const isSelected = selectedDogTier === opt.value;
                      return (
                        <label
                          key={opt.value}
                          className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                            isSelected ? "border-2 bg-white shadow-sm" : "border-transparent hover:bg-white/60"
                          }`}
                          style={isSelected ? { borderColor: brandStyles.accentText } : {}}
                          data-testid={`radio-dogs-${opt.value}`}
                        >
                          <input type="radio" name="dogs" value={opt.value} checked={isSelected}
                            onChange={() => setSelectedDogTier(opt.value)} className="h-4 w-4"
                            style={{ accentColor: brandStyles.accentText }} />
                          <span className="text-sm">{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Yard Size *</Label>
                  <div className="space-y-1.5">
                    {[
                      { value: "small", label: "Small (under 1/4 acre)" },
                      { value: "medium", label: "Medium (1/4 - 1/2 acre)" },
                      { value: "large", label: "Large (1/2 - 3/4 acre)" },
                      { value: "extra-large", label: "Extra Large (3/4+ acre)" },
                    ].map(opt => {
                      const isSelected = selectedLot === opt.value;
                      return (
                        <label
                          key={opt.value}
                          className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                            isSelected ? "border-2 bg-white shadow-sm" : "border-transparent hover:bg-white/60"
                          }`}
                          style={isSelected ? { borderColor: brandStyles.accentText } : {}}
                          data-testid={`radio-lot-${opt.value}`}
                        >
                          <input type="radio" name="lot" value={opt.value} checked={isSelected}
                            onChange={() => setSelectedLot(opt.value)} className="h-4 w-4"
                            style={{ accentColor: brandStyles.accentText }} />
                          <span className="text-sm">{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="serviceDay">Preferred Service Day</Label>
              <div className="grid grid-cols-4 gap-1.5">
                {DAY_OPTIONS.map((d) => {
                  const isSelected = formData.serviceDay === d.value;
                  return (
                    <label
                      key={d.value}
                      className={`flex items-center justify-center p-2 rounded-md border text-xs cursor-pointer transition-colors ${
                        isSelected ? "border-2 bg-white shadow-sm font-medium" : "border-gray-200 hover:bg-gray-50"
                      }`}
                      style={isSelected ? { borderColor: brandStyles.accentText, color: brandStyles.accentText } : {}}
                      data-testid={`radio-day-${d.value}`}
                    >
                      <input
                        type="radio"
                        name="serviceDay"
                        value={d.value}
                        checked={isSelected}
                        onChange={() => updateField("serviceDay", d.value)}
                        className="sr-only"
                      />
                      {d.label.slice(0, 3)}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="mt-2">
              <label className="flex items-start gap-2.5 cursor-pointer" data-testid="label-sms-opt-in">
                <input
                  type="checkbox"
                  checked={smsOptIn}
                  onChange={(e) => setSmsOptIn(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                  style={{ accentColor: brandStyles.accentText }}
                  data-testid="checkbox-sms-opt-in"
                />
                <span className="text-xs text-muted-foreground leading-relaxed">
                  I agree to receive recurring automated marketing and informational text messages
                  (e.g., service alerts and project updates) from <strong>{company.name}</strong> at the
                  phone number provided. Consent is not a condition of purchase. Msg &amp; data rates
                  may apply. Msg frequency varies. Reply HELP for help and STOP to cancel.
                  View our{" "}
                  <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: brandStyles.accentText }}>Privacy Policy</a>
                  {" "}and{" "}
                  <a href="/sms-terms" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: brandStyles.accentText }}>SMS Terms</a>.
                </span>
              </label>
            </div>

            {submitMutation.isError && (
              <p className="text-sm text-destructive" data-testid="text-submit-error">
                {(submitMutation.error as Error).message || "Something went wrong. Please try again."}
              </p>
            )}

            <Button
              type="submit"
              className="w-full text-white"
              style={{ backgroundColor: brandStyles.buttonBg }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = brandStyles.buttonHover)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = brandStyles.buttonBg)}
              disabled={!isFormValid || submitMutation.isPending}
              data-testid="button-get-quote"
            >
              {submitMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Get My Free Quote"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
      <div className="mt-6 text-center space-y-1">
        <p className="text-xs text-muted-foreground font-medium" data-testid="text-powered-by">
          Powered by <a href="https://servicd.app" target="_blank" rel="noopener noreferrer" className="underline font-semibold" style={{ color: brandStyles.accentText }}>Servicd</a>
        </p>
        <p className="text-xs text-muted-foreground" data-testid="text-copyright">
          &copy; {new Date().getFullYear()} PetPilot LLC dba Servicd and ScooPilot
        </p>
      </div>
    </div>
  );
}
