import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  Dog,
  Loader2,
  Phone,
  MapPin,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  Sparkles,
} from "lucide-react";

function StepTracker({ track }: { track: (event: string, step?: number) => void }) {
  useEffect(() => { track("step3_started", 3); }, [track]);
  return null;
}

function useQuoteTracking(slug: string, isEmbed: boolean) {
  const sessionId = useRef(crypto.randomUUID());
  const firedRef = useRef<Set<string>>(new Set());

  const track = useCallback((event: string, step?: number, zipCode?: string) => {
    if (firedRef.current.has(event)) return;
    firedRef.current.add(event);
    const body: Record<string, unknown> = {
      sessionId: sessionId.current,
      event,
      isEmbed,
    };
    if (step !== undefined) body.step = step;
    if (zipCode) body.zipCode = zipCode;
    fetch(`/api/public/quote-events/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  }, [slug, isEmbed]);

  return track;
}

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

type LotAddon = {
  label: string;
  value: string;
  surcharge: number;
  callForQuote: boolean;
  pricingItemId: string | null;
};

type ZipCheckResult = {
  inServiceArea: boolean;
  hasZones: boolean;
  zoneSurchargePercent?: number;
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

const LAST_CLEANUP_OPTIONS = [
  { value: "1_week", label: "One week ago", multiplier: 1.0 },
  { value: "2_weeks", label: "Two weeks ago", multiplier: 1.2 },
  { value: "3_weeks", label: "Three weeks ago", multiplier: 1.4 },
  { value: "1_month", label: "One month ago", multiplier: 1.6 },
  { value: "2_months", label: "Two months ago", multiplier: 2.0 },
  { value: "3_4_months", label: "3-4 months ago", multiplier: 2.5 },
  { value: "never", label: "Never / Not sure", multiplier: 3.0 },
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

  const freqGroups: Record<string, { dogCount: number; price: number; callForQuote: boolean; isPlus: boolean; itemId: string }[]> = {};

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
    ringColor: "rgba(21, 128, 61, 0.3)",
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
    ringColor: `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, 0.3)`,
  };
}

function StepIndicator({ currentStep, totalSteps, brandStyles }: { currentStep: number; totalSteps: number; brandStyles: ReturnType<typeof getBrandStyles> }) {
  const labels = ["Service Area", "Service Details", "Contact Info"];
  return (
    <div className="flex items-center justify-center gap-2 py-4 px-6" data-testid="step-indicator">
      {Array.from({ length: totalSteps }, (_, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === currentStep;
        const isCompleted = stepNum < currentStep;
        return (
          <div key={stepNum} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className="w-8 h-0.5 rounded-full transition-colors duration-300"
                style={{ backgroundColor: isCompleted ? brandStyles.accentText : "#e5e7eb" }}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300"
                style={{
                  backgroundColor: isActive || isCompleted ? brandStyles.accentText : "#e5e7eb",
                  color: isActive || isCompleted ? "white" : "#9ca3af",
                }}
                data-testid={`step-dot-${stepNum}`}
              >
                {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : stepNum}
              </div>
              <span className="text-[10px] font-medium whitespace-nowrap" style={{ color: isActive ? brandStyles.accentText : "#9ca3af" }}>
                {labels[i]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RadioOption({
  isSelected,
  brandStyles,
  testId,
  children,
  onClick,
}: {
  isSelected: boolean;
  brandStyles: ReturnType<typeof getBrandStyles>;
  testId: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <label
      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all duration-200 ${
        isSelected ? "border-2 bg-white shadow-sm" : "border-gray-200 hover:bg-gray-50 hover:border-gray-300"
      }`}
      style={isSelected ? { borderColor: brandStyles.accentText } : {}}
      data-testid={testId}
      onClick={onClick}
    >
      <div
        className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors"
        style={{
          borderColor: isSelected ? brandStyles.accentText : "#d1d5db",
          backgroundColor: isSelected ? brandStyles.accentText : "transparent",
        }}
      >
        {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
      </div>
      {children}
    </label>
  );
}

export default function SignupWidget() {
  const [, params] = useRoute("/signup/:slug");
  const slug = params?.slug || "";

  const isEmbed = useMemo(() => {
    const searchParams = new URLSearchParams(window.location.search);
    return searchParams.get("embed") === "true";
  }, []);

  const track = useQuoteTracking(slug, isEmbed);

  const [currentStep, setCurrentStep] = useState(1);
  const [zipCode, setZipCode] = useState("");
  const [zipError, setZipError] = useState<string | null>(null);

  const [selectedFreq, setSelectedFreq] = useState("");
  const [selectedDogTier, setSelectedDogTier] = useState("");
  const [selectedLot, setSelectedLot] = useState("");
  const [lastCleanup, setLastCleanup] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [serviceDay, setServiceDay] = useState("");

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    streetAddress: "",
    city: "",
    state: "",
  });
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [quoteResult, setQuoteResult] = useState<QuoteResult | null>(null);

  const { data: company, isLoading, error } = useQuery<CompanyInfo>({
    queryKey: ["/api/public/company", slug],
    queryFn: async () => {
      const res = await fetch(`/api/public/company/${slug}`);
      if (!res.ok) throw new Error("Company not found");
      return res.json();
    },
    enabled: !!slug,
  });

  useEffect(() => {
    if (company && slug) track("form_loaded", 1);
  }, [company, slug, track]);

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

  const initialCleanupRange = useMemo(() => {
    if (!lastCleanup) return null;
    const option = LAST_CLEANUP_OPTIONS.find(o => o.value === lastCleanup);
    if (!option) return null;
    const baseCents = quoteResult?.quote?.recommendedPriceCents ??
      (livePrice && !livePrice.callForQuote ? livePrice.cents : null);
    if (!baseCents) return null;
    const low = Math.round(baseCents * option.multiplier);
    const high = Math.round(baseCents * (option.multiplier + 0.5));
    return { low, high };
  }, [livePrice, lastCleanup, quoteResult]);

  const checkZipMutation = useMutation({
    mutationFn: async () => {
      const normalizedZip = zipCode.trim().slice(0, 5);
      if (normalizedZip.length < 5 || !/^\d{5}$/.test(normalizedZip)) {
        throw new Error("Please enter a valid 5-digit ZIP code.");
      }
      track("zip_entered", 1, normalizedZip);
      const res = await fetch(`/api/public/check-zip/${slug}/${normalizedZip}`);
      if (!res.ok) throw new Error("Unable to check service area. Please try again.");
      return res.json() as Promise<ZipCheckResult>;
    },
    onSuccess: (data) => {
      if (data.inServiceArea) {
        setZipError(null);
        track("zip_passed", 1, zipCode.trim().slice(0, 5));
        setCurrentStep(2);
      } else {
        track("zip_failed", 1, zipCode.trim().slice(0, 5));
        setZipError("Sorry, we don't currently service your area. Please check back soon!");
      }
    },
    onError: (err: Error) => {
      setZipError(err.message);
    },
  });

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

      const noteParts: string[] = [];
      if (couponCode.trim()) noteParts.push(`Coupon code: ${couponCode.trim()}`);

      const res = await fetch(`/api/public/leads/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          zipCode: zipCode.trim().slice(0, 5),
          numberOfDogs,
          yardSize,
          serviceFrequency: backendFreq,
          serviceDay: serviceDay || undefined,
          pricingItemId,
          lotAddonId,
          lastCleanup: lastCleanup || undefined,
          notes: noteParts.length > 0 ? noteParts.join(". ") : undefined,
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
      track("quote_shown", 4);
    },
  });

  const updateField = useCallback((field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const hasLotAddons = parsed && parsed.lotAddons.length > 0;
  const isStep2Valid = !!selectedFreq && !!selectedDogTier && !!lastCleanup;
  const isStep3Valid = formData.firstName.trim().length > 0 &&
    formData.streetAddress.trim().length > 0 &&
    formData.city.trim().length > 0 &&
    formData.state.trim().length > 0;

  if (isLoading) {
    return (
      <div className={isEmbed ? "" : "min-h-screen bg-gradient-to-b from-gray-50 to-white flex items-center justify-center p-4"}>
        <Card className={`w-full ${isEmbed ? "shadow-none border-0" : "max-w-lg shadow-xl"}`}>
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
      <div className={isEmbed ? "" : "min-h-screen bg-gradient-to-b from-gray-50 to-white flex items-center justify-center p-4"}>
        <Card className={`w-full ${isEmbed ? "shadow-none border-0" : "max-w-lg shadow-xl"}`}>
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
      <div className={isEmbed ? "" : "min-h-screen flex items-center justify-center p-4"} style={isEmbed ? {} : { background: `linear-gradient(to bottom, ${brandStyles.gradientFrom}, white)` }}>
        <div className={`w-full ${isEmbed ? "" : "max-w-lg"}`}>
          <Card className={`overflow-hidden ${isEmbed ? "shadow-none border-0" : "shadow-xl"}`}>
            <div className="p-8 text-center" style={{ backgroundColor: brandStyles.headerBg }}>
              {company.logoUrl && (
                <img src={company.logoUrl} alt={company.name} className="h-14 mx-auto mb-4 rounded-lg shadow-sm" data-testid="img-company-logo-result" />
              )}
              <h1 className="text-2xl font-bold text-white mb-1" data-testid="text-company-name-result">{company.name}</h1>
              {isCallForQuote ? (
                <p className="text-white/80 text-sm">Custom Quote</p>
              ) : (
                <p className="text-white/80 text-sm">{freqLabel} Cleanup Estimate</p>
              )}
            </div>
            <CardContent className="p-8 space-y-6">
              <div className="flex justify-center">
                <div className="h-16 w-16 rounded-full flex items-center justify-center" style={{ backgroundColor: brandStyles.checkBg }}>
                  {isCallForQuote ? (
                    <Phone className="h-8 w-8" style={{ color: brandStyles.checkIcon }} />
                  ) : (
                    <CheckCircle2 className="h-8 w-8" style={{ color: brandStyles.checkIcon }} />
                  )}
                </div>
              </div>
              <div className="text-center">
                {isCallForQuote ? (
                  <>
                    <h2 className="text-2xl font-bold mb-2" data-testid="text-quote-title">We'll Get You a Custom Quote</h2>
                    <p className="text-lg text-muted-foreground" data-testid="text-quote-price">
                      A team member will contact you with personalized pricing.
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="text-lg font-semibold text-muted-foreground mb-1" data-testid="text-quote-title">{freqLabel} Cleanup Estimate</h2>
                    <div className="text-5xl font-bold mb-2" style={{ color: brandStyles.accentText }} data-testid="text-quote-price">
                      ${priceDollars}
                    </div>
                    <p className="text-muted-foreground" data-testid="text-quote-frequency">per cleanup visit</p>
                  </>
                )}
              </div>

              {!isCallForQuote && initialCleanupRange && (
                <div className="rounded-xl p-4 text-center" style={{ backgroundColor: brandStyles.lightBg, border: `1px solid ${brandStyles.lightBorder}` }}>
                  <p className="text-sm font-medium mb-1" style={{ color: brandStyles.accentText }}>Initial Cleanup Estimate</p>
                  <p className="text-lg font-bold">
                    ${(initialCleanupRange.low / 100).toFixed(2)} - ${(initialCleanupRange.high / 100).toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Based on time since last cleanup</p>
                </div>
              )}

              <div className="rounded-xl bg-muted/50 p-5 text-sm text-muted-foreground space-y-3">
                <p>Thank you, <strong>{formData.firstName}</strong>! Your information has been submitted.</p>
                <p>A representative from <strong>{company.name}</strong> will reach out to you shortly to confirm your service and schedule.</p>
                <p className="text-xs italic">* Exact pricing may vary based on property assessment. Sales tax may apply.</p>
              </div>
            </CardContent>
          </Card>
          {!isEmbed && (
            <div className="mt-6 text-center space-y-1">
              <p className="text-xs text-muted-foreground font-medium" data-testid="text-powered-by">
                Powered by <a href="https://servicd.app" target="_blank" rel="noopener noreferrer" className="underline font-semibold" style={{ color: brandStyles.accentText }}>Servicd</a>
              </p>
              <p className="text-xs text-muted-foreground" data-testid="text-copyright">
                &copy; {new Date().getFullYear()} PetPilot LLC dba Servicd and ScooPilot
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={isEmbed ? "" : "min-h-screen flex items-center justify-center p-4"} style={isEmbed ? {} : { background: `linear-gradient(to bottom, ${brandStyles.gradientFrom}, white)` }}>
      <div className={`w-full ${isEmbed ? "" : "max-w-lg"}`}>
        <Card className={`overflow-hidden ${isEmbed ? "shadow-none border-0" : "shadow-xl"}`}>
          <div className="p-6 text-center" style={{ backgroundColor: brandStyles.headerBg }}>
            {company.logoUrl && (
              <img src={company.logoUrl} alt={company.name} className="h-14 mx-auto mb-3 rounded-lg shadow-sm" data-testid="img-company-logo" />
            )}
            <h1 className="text-xl font-bold text-white" data-testid="text-company-name">{company.name}</h1>
            <p className="text-sm mt-1 text-white/80">Get a Free Quote for Pet Waste Removal</p>
          </div>

          <StepIndicator currentStep={currentStep} totalSteps={3} brandStyles={brandStyles} />

          <CardContent className="p-6 pt-0">
            {currentStep === 1 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300" data-testid="step-1-zip">
                <div className="text-center space-y-2">
                  <div className="h-16 w-16 rounded-full mx-auto flex items-center justify-center" style={{ backgroundColor: brandStyles.lightBg }}>
                    <MapPin className="h-8 w-8" style={{ color: brandStyles.accentText }} />
                  </div>
                  <h2 className="text-xl font-bold">Check Your Service Area</h2>
                  <p className="text-sm text-muted-foreground">Enter your ZIP code to see if we service your area</p>
                </div>

                <div className="space-y-3">
                  <Label htmlFor="zipCode" className="text-sm font-medium">ZIP Code</Label>
                  <Input
                    id="zipCode"
                    placeholder="Enter your ZIP code"
                    value={zipCode}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 5);
                      setZipCode(val);
                      setZipError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        checkZipMutation.mutate();
                      }
                    }}
                    maxLength={5}
                    className="text-center text-lg h-12"
                    data-testid="input-zip-code"
                  />

                  {zipError && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200" data-testid="text-zip-error">
                      <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700">{zipError}</p>
                    </div>
                  )}

                  <Button
                    className="w-full text-white h-12 text-base font-semibold"
                    style={{ backgroundColor: brandStyles.buttonBg }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = brandStyles.buttonHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = brandStyles.buttonBg)}
                    disabled={zipCode.length < 5 || checkZipMutation.isPending}
                    onClick={() => checkZipMutation.mutate()}
                    data-testid="button-check-zip"
                  >
                    {checkZipMutation.isPending ? (
                      <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Checking...</>
                    ) : (
                      <><ArrowRight className="h-5 w-5 mr-2" /> Check Service Area</>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300" data-testid="step-2-details">
                <div className="text-center space-y-1">
                  <h2 className="text-xl font-bold">Service Details</h2>
                  <p className="text-sm text-muted-foreground">Tell us about your yard and pets</p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">How Many Dogs? *</Label>
                    <div className="space-y-1.5">
                      {hasPricing && parsed ? (
                        dogTiers.length > 0 ? dogTiers : parsed.buildDogTiers(parsed.freqGroups[parsed.availableFreqs[0]] || [])
                      ).map(tier => (
                        <RadioOption
                          key={tier.value}
                          isSelected={selectedDogTier === tier.value}
                          brandStyles={brandStyles}
                          testId={`radio-dogs-${tier.value}`}
                          onClick={() => setSelectedDogTier(tier.value)}
                        >
                          <span className="text-sm flex-1">{tier.label}</span>
                        </RadioOption>
                      )) : (
                        [
                          { value: "1", label: "1-2 dogs" },
                          { value: "3", label: "3-4 dogs" },
                          { value: "5", label: "5-6 dogs" },
                          { value: "7", label: "7+ dogs" },
                        ].map(opt => (
                          <RadioOption
                            key={opt.value}
                            isSelected={selectedDogTier === opt.value}
                            brandStyles={brandStyles}
                            testId={`radio-dogs-${opt.value}`}
                            onClick={() => setSelectedDogTier(opt.value)}
                          >
                            <span className="text-sm flex-1">{opt.label}</span>
                          </RadioOption>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Cleanup Frequency *</Label>
                    <div className="space-y-1.5">
                      {hasPricing && parsed ? (
                        parsed.availableFreqs.map(freq => {
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
                          return (
                            <RadioOption
                              key={freq}
                              isSelected={selectedFreq === freq}
                              brandStyles={brandStyles}
                              testId={`radio-freq-${freq}`}
                              onClick={() => {
                                setSelectedFreq(freq);
                                if (selectedDogTier) {
                                  const newTiers = parsed.buildDogTiers(parsed.freqGroups[freq] || []);
                                  if (!newTiers.find(t => t.value === selectedDogTier)) {
                                    setSelectedDogTier("");
                                  }
                                }
                              }}
                            >
                              <span className="flex-1 text-sm">{FREQ_DISPLAY[freq] || freq}</span>
                              {priceLabel && <span className="text-xs text-muted-foreground font-medium">{priceLabel}</span>}
                            </RadioOption>
                          );
                        })
                      ) : (
                        [
                          { value: "weekly", label: "Once a Week" },
                          { value: "biweekly", label: "Every Other Week" },
                          { value: "onetime", label: "One-Time Cleaning" },
                        ].map(opt => (
                          <RadioOption
                            key={opt.value}
                            isSelected={selectedFreq === opt.value}
                            brandStyles={brandStyles}
                            testId={`radio-freq-${opt.value}`}
                            onClick={() => setSelectedFreq(opt.value)}
                          >
                            <span className="flex-1 text-sm">{opt.label}</span>
                          </RadioOption>
                        ))
                      )}
                    </div>
                  </div>

                  {hasLotAddons && (
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">Estimated Yard Size (optional)</Label>
                      <div className="space-y-1.5">
                        {parsed!.lotAddons.map(lot => (
                          <RadioOption
                            key={lot.value}
                            isSelected={selectedLot === lot.value}
                            brandStyles={brandStyles}
                            testId={`radio-lot-${lot.value}`}
                            onClick={() => setSelectedLot(lot.value)}
                          >
                            <span className="text-sm flex-1">{lot.label}</span>
                          </RadioOption>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Last Time Yard Was Cleaned *</Label>
                    <div className="space-y-1.5">
                      {LAST_CLEANUP_OPTIONS.map(opt => (
                        <RadioOption
                          key={opt.value}
                          isSelected={lastCleanup === opt.value}
                          brandStyles={brandStyles}
                          testId={`radio-cleanup-${opt.value}`}
                          onClick={() => setLastCleanup(opt.value)}
                        >
                          <span className="text-sm flex-1">{opt.label}</span>
                        </RadioOption>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="couponCode" className="text-sm font-semibold">Coupon Code (optional)</Label>
                    <Input
                      id="couponCode"
                      placeholder="Enter coupon code"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value)}
                      data-testid="input-coupon-code"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Preferred Service Day</Label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { value: "monday", label: "Mon" },
                        { value: "tuesday", label: "Tue" },
                        { value: "wednesday", label: "Wed" },
                        { value: "thursday", label: "Thu" },
                        { value: "friday", label: "Fri" },
                        { value: "saturday", label: "Sat" },
                        { value: "sunday", label: "Sun" },
                      ].map((d) => {
                        const isSelected = serviceDay === d.value;
                        return (
                          <label
                            key={d.value}
                            className={`flex items-center justify-center p-2.5 rounded-lg border text-xs cursor-pointer transition-all duration-200 ${
                              isSelected ? "border-2 bg-white shadow-sm font-semibold" : "border-gray-200 hover:bg-gray-50 hover:border-gray-300"
                            }`}
                            style={isSelected ? { borderColor: brandStyles.accentText, color: brandStyles.accentText } : {}}
                            data-testid={`radio-day-${d.value}`}
                          >
                            <input
                              type="radio"
                              name="serviceDay"
                              value={d.value}
                              checked={isSelected}
                              onChange={() => setServiceDay(d.value)}
                              className="sr-only"
                            />
                            {d.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {livePrice && (
                  <div className="rounded-xl p-4 text-center" style={{ backgroundColor: brandStyles.lightBg, border: `1px solid ${brandStyles.lightBorder}` }}>
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

                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 h-12"
                    onClick={() => setCurrentStep(1)}
                    data-testid="button-back-step1"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" /> Back
                  </Button>
                  <Button
                    type="button"
                    className="flex-[2] text-white h-12 text-base font-semibold"
                    style={{ backgroundColor: brandStyles.buttonBg }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = brandStyles.buttonHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = brandStyles.buttonBg)}
                    disabled={!isStep2Valid}
                    onClick={() => { track("step2_completed", 2); setCurrentStep(3); }}
                    data-testid="button-next-step3"
                  >
                    Continue <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300" data-testid="step-3-contact">
                <StepTracker track={track} />
                <div className="text-center space-y-1">
                  <h2 className="text-xl font-bold">Contact Information</h2>
                  <p className="text-sm text-muted-foreground">Almost done! Tell us how to reach you</p>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (isStep3Valid) {
                      track("submitted", 3, zipCode.trim().slice(0, 5));
                      submitMutation.mutate();
                    }
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
                      <Label>ZIP Code</Label>
                      <Input
                        value={zipCode}
                        disabled
                        className="bg-muted"
                        data-testid="input-zip-display"
                      />
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
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200" data-testid="text-submit-error">
                      <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700">{(submitMutation.error as Error).message || "Something went wrong. Please try again."}</p>
                    </div>
                  )}

                  {livePrice && !livePrice.callForQuote && (
                    <div className="rounded-xl p-3 text-center" style={{ backgroundColor: brandStyles.lightBg, border: `1px solid ${brandStyles.lightBorder}` }}>
                      <div className="flex items-center justify-center gap-2">
                        <Sparkles className="h-4 w-4" style={{ color: brandStyles.accentText }} />
                        <span className="text-sm font-medium" style={{ color: brandStyles.accentText }}>
                          Your Estimate: ${(livePrice.cents / 100).toFixed(2)}/visit
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 h-12"
                      onClick={() => setCurrentStep(2)}
                      data-testid="button-back-step2"
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" /> Back
                    </Button>
                    <Button
                      type="submit"
                      className="flex-[2] text-white h-12 text-base font-semibold"
                      style={{ backgroundColor: brandStyles.buttonBg }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = brandStyles.buttonHover)}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = brandStyles.buttonBg)}
                      disabled={!isStep3Valid || submitMutation.isPending}
                      data-testid="button-get-quote"
                    >
                      {submitMutation.isPending ? (
                        <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Submitting...</>
                      ) : (
                        <><CheckCircle2 className="h-5 w-5 mr-2" /> Get My Free Quote</>
                      )}
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
        {!isEmbed && (
          <div className="mt-6 text-center space-y-1">
            <p className="text-xs text-muted-foreground font-medium" data-testid="text-powered-by">
              Powered by <a href="https://servicd.app" target="_blank" rel="noopener noreferrer" className="underline font-semibold" style={{ color: brandStyles.accentText }}>Servicd</a>
            </p>
            <p className="text-xs text-muted-foreground" data-testid="text-copyright">
              &copy; {new Date().getFullYear()} PetPilot LLC dba Servicd and ScooPilot
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
