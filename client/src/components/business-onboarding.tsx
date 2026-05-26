/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import {
  DEFAULT_PRICING_CONFIG,
  DEFAULT_PRICING_RULES,
  type PricingConfig,
  type PricingRulesConfig,
} from "@shared/schema";
import { YardSizeTierEditor } from "@/components/yard-size-tier-editor";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { ZipMapSelector, RadiusMapSelector } from "@/components/zip-map-selector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Building2,
  Globe,
  DollarSign,
  CreditCard,
  Rocket,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Upload,
  Sparkles,
  Zap,
  Shield,
  Crown,
  SkipForward,
  ExternalLink,
  PartyPopper,
  AlertCircle,
  Image,
  PhoneCall,
  Phone,
} from "lucide-react";
import logoSquare from "@assets/ScooPilot_Square_text_1771089502024.png";

type BusinessOnboardingStatus = {
  currentStep: number;
  isComplete: boolean;
  companyData: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    logoUrl: string | null;
    websiteUrl: string | null;
    businessDescription: string | null;
    serviceAreaDescription: string | null;
    pricingConfig: PricingConfig | null;
    stripeConnectAccountId: string | null;
    stripeConnectOnboarded: boolean;
    voicePlanStatus: string | null;
    subscriptionTier: string | null;
    leadResponseActive: boolean;
    setupComplete: boolean;
    lrPhoneNumber: string | null;
  };
};

type WebsiteInsights = {
  businessDescription: string;
  serviceArea: string;
  servicesOffered: string[];
  pricingInfo: {
    weeklyPrice?: number;
    biweeklyPrice?: number;
    monthlyPrice?: number;
    oneTimePrice?: number;
    perDogExtra?: number;
  };
  competitiveInsights: string;
  suggestedPricingMode: "aggressive" | "standard" | "premium";
};

function buildSteps(): { key: string; label: string; icon: React.ElementType }[] {
  return [
    { key: "profile", label: "Company Profile", icon: Building2 },
    { key: "intelligence", label: "Business Intelligence", icon: Globe },
    { key: "pricing", label: "Pricing Setup", icon: DollarSign },
    { key: "payments", label: "Payment Processing", icon: CreditCard },
    { key: "launch", label: "Review & Launch", icon: Rocket },
  ];
}

const LAUNCH_STEP_IDX = 4;

const profileSchema = z.object({
  name: z.string().min(1, "Company name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().optional().or(z.literal("")),
  country: z.enum(["us", "ca"]).default("us"),
  address: z.string().optional().or(z.literal("")),
  websiteUrl: z.string().optional().or(z.literal("")),
  timezone: z.string().optional().or(z.literal("")),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

const DRAFT_KEYS = {
  profile: "scoopilot_onboarding_draft_profile",
  intelligence: "scoopilot_onboarding_draft_intelligence",
  pricing: "scoopilot_onboarding_draft_pricing",
  voice: "scoopilot_onboarding_draft_voice",
} as const;

function readDraft<T>(key: string): Partial<T> {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : {};
  } catch {
    return {};
  }
}

function saveDraft<T>(key: string, data: T): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch {}
}

function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}

function StepIndicator({
  currentStep,
  completedSteps,
  steps,
}: {
  currentStep: number;
  completedSteps: number[];
  steps: Array<{ key: string; label: string; icon: React.ElementType }>;
}) {
  return (
    <div className="flex items-center gap-1 w-full mb-8" data-testid="stepper-indicator">
      {steps.map((step, idx) => {
        const isActive = idx === currentStep;
        const isCompleted = completedSteps.includes(idx);
        const Icon = step.icon;
        return (
          <div key={step.key} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                    : isCompleted
                      ? "bg-green-500 text-white"
                      : "bg-muted text-muted-foreground"
                }`}
                data-testid={`step-indicator-${idx}`}
              >
                {isCompleted ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
              </div>
              <span
                className={`text-xs mt-1.5 text-center leading-tight ${isActive ? "font-semibold text-foreground" : "text-muted-foreground"}`}
              >
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={`h-0.5 w-full mx-1 mt-[-1.25rem] ${isCompleted ? "bg-green-500" : "bg-muted"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CompanyProfileStep({
  companyData,
  onNext,
  isPending,
}: {
  companyData: BusinessOnboardingStatus["companyData"];
  onNext: (data: ProfileFormValues & { logoUrl?: string }) => void;
  isPending: boolean;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(companyData.logoUrl || null);

  const { uploadFile, isUploading } = useUpload({
    onSuccess: async (response) => {
      await apiRequest("PATCH", "/api/company", { logoUrl: response.objectPath });
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/business-status"] });
      toast({ title: "Logo uploaded", description: "Your company logo has been saved." });
    },
    onError: () => {
      toast({
        title: "Upload failed",
        description: "Could not upload logo. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid file",
        description: "Please select an image file (PNG or JPG).",
        variant: "destructive",
      });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Logo must be under 2 MB.",
        variant: "destructive",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
    await uploadFile(file);
  };

  const profileDraft = readDraft<ProfileFormValues>(DRAFT_KEYS.profile);
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: profileDraft.name ?? companyData.name ?? "",
      email: profileDraft.email ?? companyData.email ?? "",
      phone: profileDraft.phone ?? companyData.phone ?? "",
      country: (profileDraft.country ?? (companyData as { country?: string }).country ?? "us") as
        | "us"
        | "ca",
      address: profileDraft.address ?? companyData.address ?? "",
      websiteUrl: profileDraft.websiteUrl ?? companyData.websiteUrl ?? "",
      timezone:
        profileDraft.timezone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone ??
        "America/New_York",
    },
  });

  useEffect(() => {
    const { unsubscribe } = form.watch((values) => {
      saveDraft(DRAFT_KEYS.profile, values);
    });
    return unsubscribe;
  }, [form]);

  return (
    <div className="max-w-xl mx-auto">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold" data-testid="text-step-title">
          Tell us about your business
        </h2>
        <p className="text-muted-foreground mt-1">
          This information will appear on invoices, quotes, and customer communications.
        </p>
      </div>

      <div className="flex items-center gap-4 mb-6 p-4 rounded-lg border bg-muted/30">
        <div className="w-16 h-16 rounded-lg border-2 border-dashed border-muted-foreground/25 flex items-center justify-center overflow-hidden bg-muted/50 shrink-0">
          {logoPreview ? (
            <img
              src={logoPreview}
              alt="Company logo"
              className="w-full h-full object-cover rounded-lg"
              data-testid="img-onboarding-logo"
            />
          ) : (
            <Image className="h-6 w-6 text-muted-foreground/50" />
          )}
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleLogoUpload}
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            data-testid="button-upload-logo"
          >
            <Upload className="mr-1 h-4 w-4" />
            {isUploading ? "Uploading..." : logoPreview ? "Change Logo" : "Upload Logo"}
          </Button>
          <p className="text-xs text-muted-foreground mt-1">PNG or JPG, max 2 MB</p>
        </div>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((data) => {
            onNext({ ...data, logoUrl: logoPreview || undefined });
          })}
          className="space-y-4"
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Company Name *</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g. Clean Paws Pet Waste Removal"
                    {...field}
                    data-testid="input-company-name"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Business Email *</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder="you@yourcompany.com"
                    {...field}
                    data-testid="input-company-email"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Business Phone</FormLabel>
                <FormControl>
                  <Input
                    placeholder="(555) 123-4567"
                    {...field}
                    data-testid="input-company-phone"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="country"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Country</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger data-testid="select-company-country">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="us">United States</SelectItem>
                    <SelectItem value="ca">Canada</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Business Address</FormLabel>
                <FormControl>
                  <AddressAutocomplete
                    value={field.value || ""}
                    onChange={field.onChange}
                    onSelect={(parsed) => {
                      form.setValue(
                        "address",
                        `${parsed.streetAddress}, ${parsed.city}, ${parsed.state} ${parsed.zipCode}`
                      );
                    }}
                    placeholder="Start typing your business address..."
                    data-testid="input-company-address"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="websiteUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Website URL</FormLabel>
                <FormControl>
                  <Input
                    placeholder="https://yourcompany.com"
                    {...field}
                    data-testid="input-company-website"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Timezone</FormLabel>
                <FormControl>
                  <Input {...field} data-testid="input-company-timezone" />
                </FormControl>
                <p className="text-xs text-muted-foreground mt-1">
                  Auto-detected from your browser. Used for scheduling and notifications.
                </p>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={isPending} data-testid="button-next-step">
              {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Continue
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

function BusinessIntelligenceStep({
  companyData,
  onNext,
  onBack,
  onSkip,
  isPending,
  isFetchingData,
}: {
  companyData: BusinessOnboardingStatus["companyData"];
  onNext: (data: { businessDescription: string; serviceAreaDescription: string }) => void;
  onBack: () => void;
  onSkip: () => void;
  isPending: boolean;
  isFetchingData?: boolean;
}) {
  const { toast } = useToast();
  const [insights, setInsights] = useState<WebsiteInsights | null>(null);
  const intelligenceDraft = readDraft<{
    businessDescription: string;
    serviceArea: string;
    serviceAreaMode: "zip" | "radius";
    radiusMiles: number;
  }>(DRAFT_KEYS.intelligence);
  const [businessDescription, setBusinessDescription] = useState(
    intelligenceDraft.businessDescription ?? companyData.businessDescription ?? ""
  );
  const [serviceArea, setServiceArea] = useState(
    intelligenceDraft.serviceArea ?? companyData.serviceAreaDescription ?? ""
  );
  const [serviceAreaMode, setServiceAreaMode] = useState<"zip" | "radius">(
    intelligenceDraft.serviceAreaMode ?? "zip"
  );
  const [radiusMiles, setRadiusMiles] = useState(intelligenceDraft.radiusMiles ?? 15);

  useEffect(() => {
    saveDraft(DRAFT_KEYS.intelligence, {
      businessDescription,
      serviceArea,
      serviceAreaMode,
      radiusMiles,
    });
  }, [businessDescription, serviceArea, serviceAreaMode, radiusMiles]);
  const scrapeMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/onboarding/scrape-website", { websiteUrl: url });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success && data.insights) {
        setInsights(data.insights);
        if (data.insights.businessDescription && !businessDescription) {
          setBusinessDescription(data.insights.businessDescription);
        }
        if (data.insights.serviceArea && !serviceArea) {
          setServiceArea(data.insights.serviceArea);
        }
        toast({
          title: "Website analyzed",
          description: "We found some useful information about your business.",
        });
      } else {
        toast({
          title: "Analysis issue",
          description: data.error || "Could not analyze website.",
          variant: "destructive",
        });
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to analyze website.", variant: "destructive" });
    },
  });

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold" data-testid="text-step-title">
          Business Intelligence
        </h2>
        <p className="text-muted-foreground mt-1">
          Let us learn about your business to provide better recommendations.
        </p>
      </div>

      <div className="space-y-6">
        {isFetchingData && <Skeleton className="h-32 w-full" />}
        {!isFetchingData && companyData.websiteUrl && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-500" />
                AI Website Analysis
              </CardTitle>
              <CardDescription>
                We can scan your website to auto-fill business details and find competitive pricing
                data.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <div className="flex-1 text-sm text-muted-foreground truncate">
                  {companyData.websiteUrl}
                </div>
                <Button
                  onClick={() => scrapeMutation.mutate(companyData.websiteUrl!)}
                  disabled={scrapeMutation.isPending}
                  variant="outline"
                  size="sm"
                  data-testid="button-analyze-website"
                >
                  {scrapeMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-1" />
                  )}
                  Analyze
                </Button>
              </div>
              {insights && (
                <div className="mt-4 p-3 bg-muted/50 rounded-lg space-y-2 text-sm">
                  {insights.servicesOffered?.length > 0 && (
                    <div>
                      <span className="font-medium">Services found:</span>{" "}
                      <span className="text-muted-foreground">
                        {insights.servicesOffered.join(", ")}
                      </span>
                    </div>
                  )}
                  {insights.pricingInfo && Object.keys(insights.pricingInfo).length > 0 && (
                    <div>
                      <span className="font-medium">Pricing found:</span>{" "}
                      <span className="text-muted-foreground">
                        {insights.pricingInfo.weeklyPrice &&
                          `Weekly: $${insights.pricingInfo.weeklyPrice}`}
                        {insights.pricingInfo.biweeklyPrice &&
                          ` | Bi-weekly: $${insights.pricingInfo.biweeklyPrice}`}
                        {insights.pricingInfo.monthlyPrice &&
                          ` | Monthly: $${insights.pricingInfo.monthlyPrice}`}
                      </span>
                    </div>
                  )}
                  {insights.competitiveInsights && (
                    <div>
                      <span className="font-medium">Insights:</span>{" "}
                      <span className="text-muted-foreground">{insights.competitiveInsights}</span>
                    </div>
                  )}
                  {insights.suggestedPricingMode && (
                    <div className="flex items-center gap-1">
                      <span className="font-medium">Suggested strategy:</span>
                      <Badge variant="secondary" className="capitalize">
                        {insights.suggestedPricingMode}
                      </Badge>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Business Description</label>
            <Textarea
              value={businessDescription}
              onChange={(e) => setBusinessDescription(e.target.value)}
              placeholder="Describe your pet waste removal business..."
              rows={3}
              className="mt-1"
              data-testid="input-business-description"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Service Area</label>
            <div className="flex gap-4 mt-2 mb-2">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="serviceAreaMode"
                  value="zip"
                  checked={serviceAreaMode === "zip"}
                  onChange={() => setServiceAreaMode("zip")}
                  data-testid="radio-service-area-zip"
                />
                ZIP Codes
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="serviceAreaMode"
                  value="radius"
                  checked={serviceAreaMode === "radius"}
                  onChange={() => setServiceAreaMode("radius")}
                  data-testid="radio-service-area-radius"
                />
                Radius
              </label>
            </div>
            {serviceAreaMode === "zip" ? (
              <div className="mt-2">
                <ZipMapSelector
                  value={serviceArea}
                  onChange={setServiceArea}
                  addressHint={companyData.address}
                />
              </div>
            ) : (
              <div className="mt-2 space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="50"
                    step="1"
                    value={radiusMiles}
                    onChange={(e) => {
                      const r = Number(e.target.value);
                      setRadiusMiles(r);
                      setServiceArea(`Within ${r} miles of your business address`);
                    }}
                    className="flex-1"
                    data-testid="input-radius-slider"
                  />
                  <span className="text-sm font-medium w-16 shrink-0">{radiusMiles} mi</span>
                </div>
                <RadiusMapSelector radiusMiles={radiusMiles} addressHint={companyData.address} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-6">
        <Button variant="ghost" onClick={onBack} data-testid="button-back-step">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onSkip} data-testid="button-skip-step">
            <SkipForward className="h-4 w-4 mr-1" />
            Skip
          </Button>
          <Button
            onClick={() => {
              onNext({ businessDescription, serviceAreaDescription: serviceArea });
            }}
            disabled={isPending}
            data-testid="button-next-step"
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Continue
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}

type FreqKey = "weekly" | "biWeekly" | "twiceWeekly" | "monthly";
type DogCol = "1" | "2" | "3" | "4p";

const PRICING_FREQS: { key: FreqKey; label: string }[] = [
  { key: "weekly", label: "Weekly" },
  { key: "biWeekly", label: "Bi-Weekly" },
  { key: "twiceWeekly", label: "2x / Week" },
  { key: "monthly", label: "Monthly" },
];
const DOG_COLS: { key: DogCol; label: string }[] = [
  { key: "1", label: "1 Dog" },
  { key: "2", label: "2 Dogs" },
  { key: "3", label: "3 Dogs" },
  { key: "4p", label: "4+ Dogs" },
];

function calcDogPrice(base: number, dogs: number, increment: number, surcharge: number): string {
  if (!base) return "";
  return (base + Math.floor((dogs - 1) / Math.max(1, increment)) * surcharge).toFixed(2);
}

function PricingSetupStep({
  companyData,
  onNext,
  onBack,
  onSkip,
  isPending,
}: {
  companyData: BusinessOnboardingStatus["companyData"];
  onNext: (data: { pricingConfig: Partial<PricingConfig> }) => void;
  onBack: () => void;
  onSkip: () => void;
  isPending: boolean;
}) {
  const { toast } = useToast();
  const [csvSummary, setCsvSummary] = useState<{
    totalRows: number;
    priceColumns: string[];
    frequencyColumns: string[];
  } | null>(null);

  const csvMutation = useMutation({
    mutationFn: async (csvText: string) => {
      const res = await apiRequest("POST", "/api/onboarding/import-pricing-csv", { csvText });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setCsvSummary(data.summary);
        toast({
          title: "CSV parsed",
          description: `Found ${data.summary.totalRows} rows of pricing data.`,
        });
      } else {
        toast({
          title: "Error",
          description: data.error || "Could not parse CSV.",
          variant: "destructive",
        });
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to parse CSV.", variant: "destructive" });
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      csvMutation.mutate(text);
    };
    reader.readAsText(file);
  };

  const existingConfig = { ...DEFAULT_PRICING_CONFIG, ...(companyData.pricingConfig || {}) };
  const existingRules = existingConfig.pricingRules || DEFAULT_PRICING_RULES;

  type PricingDraft = {
    pricingMode: "aggressive" | "standard" | "premium";
    qfBase: Record<FreqKey, string>;
    surcharge: string;
    increment: string;
    grid: Record<FreqKey, Record<DogCol, string>>;
  };
  const pricingDraft = readDraft<PricingDraft>(DRAFT_KEYS.pricing);

  const [pricingMode, setPricingMode] = useState<"aggressive" | "standard" | "premium">(
    pricingDraft.pricingMode ?? existingConfig.pricingMode ?? "standard"
  );

  const [qfBase, setQfBase] = useState<Record<FreqKey, string>>(
    pricingDraft.qfBase ?? {
      weekly: existingRules.basePrices.weekly ? String(existingRules.basePrices.weekly) : "",
      biWeekly: existingRules.basePrices.biWeekly ? String(existingRules.basePrices.biWeekly) : "",
      twiceWeekly: existingRules.basePrices.twiceWeekly
        ? String(existingRules.basePrices.twiceWeekly)
        : "",
      monthly: existingRules.basePrices.monthly ? String(existingRules.basePrices.monthly) : "",
    }
  );
  const [surcharge, setSurcharge] = useState(
    pricingDraft.surcharge ?? String(existingRules.perDogRule.surchargeAmount || "5")
  );
  const [increment, setIncrement] = useState(
    pricingDraft.increment ?? String(existingRules.perDogRule.incrementDogs || "1")
  );

  const buildGrid = (bases: Record<FreqKey, string>, sur: string, inc: string) => {
    const grid: Record<FreqKey, Record<DogCol, string>> = {} as any;
    for (const { key } of PRICING_FREQS) {
      const base = parseFloat(bases[key]) || 0;
      const s = parseFloat(sur) || 0;
      const i = parseInt(inc) || 1;
      grid[key] = {
        "1": calcDogPrice(base, 1, i, s),
        "2": calcDogPrice(base, 2, i, s),
        "3": calcDogPrice(base, 3, i, s),
        "4p": calcDogPrice(base, 4, i, s),
      };
    }
    return grid;
  };

  const [grid, setGrid] = useState<Record<FreqKey, Record<DogCol, string>>>(
    () => pricingDraft.grid ?? buildGrid(qfBase, surcharge, increment)
  );

  const [localYardTiers, setLocalYardTiers] = useState<PricingRulesConfig["yardSizeTiers"]>(
    existingRules.yardSizeTiers.length > 0
      ? existingRules.yardSizeTiers
      : DEFAULT_PRICING_RULES.yardSizeTiers
  );

  useEffect(() => {
    saveDraft(DRAFT_KEYS.pricing, { pricingMode, qfBase, surcharge, increment, grid });
  }, [pricingMode, qfBase, surcharge, increment, grid]);

  const applyQuickFill = () => setGrid(buildGrid(qfBase, surcharge, increment));

  const handleSubmit = () => {
    const config: Partial<PricingConfig> = {
      ...DEFAULT_PRICING_CONFIG,
      pricingMode,
      targetProfitMarginPct:
        pricingMode === "aggressive" ? 20 : pricingMode === "premium" ? 40 : 30,
      premiumMarginPct: pricingMode === "aggressive" ? 30 : pricingMode === "premium" ? 55 : 40,
      pricingRules: {
        basePrices: {
          weekly: parseFloat(grid.weekly?.["1"] || qfBase.weekly) || 0,
          biWeekly: parseFloat(grid.biWeekly?.["1"] || qfBase.biWeekly) || 0,
          twiceWeekly: parseFloat(grid.twiceWeekly?.["1"] || qfBase.twiceWeekly) || 0,
          monthly: parseFloat(grid.monthly?.["1"] || qfBase.monthly) || undefined,
        },
        perDogRule: {
          incrementDogs: parseInt(increment) || 1,
          surchargeAmount: parseFloat(surcharge) || 5,
          maxDogs: 6,
        },
        yardSizeTiers: localYardTiers,
      },
    };
    onNext({ pricingConfig: config });
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold" data-testid="text-step-title">
          Set Your Pricing
        </h2>
        <p className="text-muted-foreground mt-1">
          Enter your rates for each service frequency and dog count.
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Import Pricing CSV
            </CardTitle>
            <CardDescription>
              Upload a CSV with your current pricing data to help set up your rate card.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              data-testid="input-csv-upload"
            />
            {csvMutation.isPending && (
              <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Parsing CSV...
              </div>
            )}
            {csvSummary && (
              <div className="mt-3 p-3 bg-muted/50 rounded-lg text-sm space-y-1">
                <p>
                  <span className="font-medium">{csvSummary.totalRows}</span> rows found
                </p>
                {csvSummary.priceColumns.length > 0 && (
                  <p>
                    Price columns:{" "}
                    <span className="text-muted-foreground">
                      {csvSummary.priceColumns.join(", ")}
                    </span>
                  </p>
                )}
                {csvSummary.frequencyColumns.length > 0 && (
                  <p>
                    Frequency columns:{" "}
                    <span className="text-muted-foreground">
                      {csvSummary.frequencyColumns.join(", ")}
                    </span>
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div>
          <label className="text-sm font-medium mb-3 block">Pricing Strategy</label>
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                mode: "aggressive" as const,
                label: "Growth",
                desc: "Lower prices, grow fast",
                icon: Zap,
                color: "text-blue-500",
              },
              {
                mode: "standard" as const,
                label: "Standard",
                desc: "Balanced market rate",
                icon: Shield,
                color: "text-green-500",
              },
              {
                mode: "premium" as const,
                label: "Premium",
                desc: "Higher prices, premium feel",
                icon: Crown,
                color: "text-amber-500",
              },
            ].map(({ mode, label, desc, icon: Icon, color }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPricingMode(mode)}
                className={`p-3 rounded-lg border-2 transition-all text-left ${
                  pricingMode === mode
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/30"
                }`}
                data-testid={`button-pricing-${mode}`}
              >
                <Icon className={`h-4 w-4 ${color} mb-1`} />
                <div className="font-medium text-sm">{label}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-semibold">Quick Fill</span>
              <span className="text-xs text-muted-foreground ml-2">
                formula: base + &#8970;(dogs&minus;1) &divide; step&#8971; &times; surcharge
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={applyQuickFill}
              data-testid="button-apply-quickfill"
            >
              Apply
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead>
                <tr>
                  <th className="text-left pr-4 pb-1 text-xs font-medium text-muted-foreground">
                    Frequency
                  </th>
                  <th className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                    Base / 1 dog ($)
                  </th>
                  <th className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                    Surcharge / step ($)
                  </th>
                  <th className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                    Dogs / step
                  </th>
                </tr>
              </thead>
              <tbody>
                {PRICING_FREQS.map(({ key, label }, i) => (
                  <tr key={key}>
                    <td className="pr-4 py-1 whitespace-nowrap text-sm">{label}</td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="h-7 w-24 text-sm"
                        value={qfBase[key]}
                        onChange={(e) => setQfBase((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder="e.g. 25"
                        data-testid={`input-qf-base-${key}`}
                      />
                    </td>
                    <td className="px-2 py-1">
                      {i === 0 ? (
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="h-7 w-20 text-sm"
                          value={surcharge}
                          onChange={(e) => setSurcharge(e.target.value)}
                          placeholder="e.g. 5"
                          data-testid="input-qf-surcharge"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground px-2">shared</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {i === 0 ? (
                        <Input
                          type="number"
                          step="1"
                          min="1"
                          className="h-7 w-16 text-sm"
                          value={increment}
                          onChange={(e) => setIncrement(e.target.value)}
                          placeholder="1"
                          data-testid="input-qf-increment"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground px-2">shared</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">Price Matrix</label>
          <div className="overflow-x-auto rounded-lg border">
            <table className="text-sm w-full">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
                    Frequency
                  </th>
                  {DOG_COLS.map(({ key, label }) => (
                    <th
                      key={key}
                      className="px-2 py-2 text-xs font-medium text-muted-foreground text-center"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PRICING_FREQS.map(({ key: freq, label }, i) => (
                  <tr key={freq} className={i % 2 === 0 ? "" : "bg-muted/20"}>
                    <td className="px-3 py-1.5 font-medium text-sm whitespace-nowrap">{label}</td>
                    {DOG_COLS.map(({ key: col }) => (
                      <td key={col} className="px-1 py-1 text-center">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="h-7 w-20 text-sm text-center mx-auto"
                          value={grid[freq]?.[col] ?? ""}
                          onChange={(e) =>
                            setGrid((prev) => ({
                              ...prev,
                              [freq]: { ...prev[freq], [col]: e.target.value },
                            }))
                          }
                          placeholder="—"
                          data-testid={`input-price-${freq}-${col}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Use Quick Fill to calculate prices automatically, or enter them directly in any cell.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Yard Size Tiers</CardTitle>
            <CardDescription>
              Configure up to 6 yard size tiers (3 required, 3 optional) and the surcharge added for
              each. The last filled tier applies to any larger yard.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <YardSizeTierEditor tiers={localYardTiers} onChange={setLocalYardTiers} maxTiers={5} />
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between pt-6">
        <Button variant="ghost" onClick={onBack} data-testid="button-back-step">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onSkip} data-testid="button-skip-step">
            <SkipForward className="h-4 w-4 mr-1" />
            Skip
          </Button>
          <Button onClick={handleSubmit} disabled={isPending} data-testid="button-next-step">
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Continue
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function PaymentProcessingStep({
  companyData: _companyData,
  onNext,
  onBack,
  onSkip,
  isPending,
}: {
  companyData: BusinessOnboardingStatus["companyData"];
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  isPending: boolean;
}) {
  const { toast } = useToast();
  const [justReturned, setJustReturned] = useState(false);
  const connectedCardRef = useRef<HTMLDivElement>(null);

  const { data: connectStatus, isLoading: loadingStatus } = useQuery<{
    status: "not_started" | "pending" | "connected";
    accountId?: string;
  }>({
    queryKey: ["/api/stripe-connect/status"],
  });

  const onboardMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe-connect/onboard", {
        context: "onboarding",
      });
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      window.location.href = data.url;
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message || "Failed to start Stripe onboarding.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stripeConnect = params.get("stripe_connect");
    const url = new URL(window.location.href);
    url.searchParams.delete("stripe_connect");
    window.history.replaceState({}, "", url.toString());
    if (stripeConnect === "return") {
      queryClient.invalidateQueries({ queryKey: ["/api/stripe-connect/status"] });
      setJustReturned(true);
      toast({
        title: "Stripe connected",
        description: "Returning to setup — your payment account is ready.",
      });
    }
  }, [toast]);

  useEffect(() => {
    if (justReturned && !loadingStatus && connectStatus?.status === "connected") {
      setTimeout(() => {
        connectedCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
    }
  }, [justReturned, loadingStatus, connectStatus?.status]);

  const status = connectStatus?.status || "not_started";

  return (
    <div className="max-w-xl mx-auto">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold" data-testid="text-step-title">
          Payment Processing
        </h2>
        <p className="text-muted-foreground mt-1">
          Connect Stripe to accept credit card payments from your customers.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          {loadingStatus ? (
            <Skeleton className="h-20 w-full" />
          ) : status === "connected" ? (
            <div
              ref={connectedCardRef}
              className={`text-center py-4 rounded-md transition-all duration-700 ${justReturned ? "ring-2 ring-green-400 ring-offset-2 bg-green-50 dark:bg-green-950/20" : ""}`}
              data-testid="stripe-connected-card"
            >
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
              <h3 className="font-semibold text-lg">Stripe Connected</h3>
              <p className="text-muted-foreground text-sm mt-1">
                Your Stripe account is set up and ready to accept payments.
              </p>
            </div>
          ) : status === "pending" ? (
            <div className="text-center py-4">
              <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-3" />
              <h3 className="font-semibold text-lg">Setup In Progress</h3>
              <p className="text-muted-foreground text-sm mt-1">
                Your Stripe account needs additional information.
              </p>
              <Button
                onClick={() => onboardMutation.mutate()}
                disabled={onboardMutation.isPending}
                className="mt-4"
                data-testid="button-continue-stripe"
              >
                {onboardMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4 mr-2" />
                )}
                Continue Setup
              </Button>
            </div>
          ) : (
            <div className="text-center py-4">
              <CreditCard className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold text-lg">Connect Stripe</h3>
              <p className="text-muted-foreground text-sm mt-1 max-w-sm mx-auto">
                Connect your Stripe account to accept credit card payments. You can also do this
                later from Settings.
              </p>
              <Button
                onClick={() => onboardMutation.mutate()}
                disabled={onboardMutation.isPending}
                className="mt-4"
                data-testid="button-connect-stripe"
              >
                {onboardMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CreditCard className="h-4 w-4 mr-2" />
                )}
                Connect Stripe Account
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pt-6">
        <Button variant="ghost" onClick={onBack} data-testid="button-back-step">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="flex gap-2">
          {status !== "connected" && (
            <Button variant="outline" onClick={onSkip} data-testid="button-skip-step">
              <SkipForward className="h-4 w-4 mr-1" />
              Skip for Now
            </Button>
          )}
          <Button onClick={onNext} disabled={isPending} data-testid="button-next-step">
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Continue
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReviewLaunchStep({
  companyData,
  onComplete,
  onBack,
  isPending,
}: {
  companyData: BusinessOnboardingStatus["companyData"];
  onComplete: () => void;
  onBack: () => void;
  isPending: boolean;
}) {
  const lrStatus = (() => {
    if (!companyData.leadResponseActive) return "not_subscribed";
    if (companyData.setupComplete) return "active";
    return "setup_incomplete";
  })();

  const voiceStatus = companyData.voicePlanStatus === "active" ? "active" : "not_subscribed";

  const productRows = [
    {
      label: "ScooPilot Core",
      icon: Rocket,
      done: !!(companyData.name && companyData.email),
      badge: companyData.name && companyData.email ? "Active" : "Skipped",
      badgeVariant: (companyData.name && companyData.email ? "active" : "skipped") as
        | "active"
        | "skipped",
    },
    {
      label: "Lead Response",
      icon: PhoneCall,
      done: lrStatus === "active",
      badge:
        lrStatus === "active"
          ? "Active"
          : lrStatus === "setup_incomplete"
            ? "Setup incomplete"
            : "Not subscribed",
      badgeVariant: (lrStatus === "active"
        ? "active"
        : lrStatus === "setup_incomplete"
          ? "warn"
          : "secondary") as "active" | "warn" | "secondary",
    },
    {
      label: "Voice/Chat Agent",
      icon: Phone,
      done: voiceStatus === "active",
      badge: voiceStatus === "active" ? "Active" : "Not subscribed",
      badgeVariant: (voiceStatus === "active" ? "active" : "secondary") as "active" | "secondary",
    },
  ];

  const coreItems = [
    { label: "Company profile", done: !!(companyData.name && companyData.email), icon: Building2 },
    { label: "Pricing strategy", done: !!companyData.pricingConfig, icon: DollarSign },
    { label: "Payment processing", done: companyData.stripeConnectOnboarded, icon: CreditCard },
  ];

  const doneCount = coreItems.filter((c) => c.done).length;

  return (
    <div className="max-w-xl mx-auto">
      <div className="text-center mb-6">
        <PartyPopper className="h-12 w-12 text-amber-500 mx-auto mb-3" />
        <h2 className="text-2xl font-bold" data-testid="text-step-title">
          You're All Set!
        </h2>
        <p className="text-muted-foreground mt-1">Review your setup and launch your dashboard.</p>
      </div>

      {/* Product status rows */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Product Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {productRows.map((row) => (
            <div
              key={row.label}
              className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
              data-testid={`product-row-${row.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <row.icon className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="flex-1 text-sm font-medium">{row.label}</span>
              {row.badgeVariant === "active" ? (
                <Badge variant="default" className="bg-green-500">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {row.badge}
                </Badge>
              ) : row.badgeVariant === "warn" ? (
                <Badge variant="outline" className="text-amber-600 border-amber-300">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  {row.badge}
                </Badge>
              ) : (
                <Badge variant="secondary">{row.badge}</Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-3">
            {coreItems.map((item) => (
              <div key={item.label} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <item.icon className="h-5 w-5 text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm font-medium">{item.label}</span>
                {item.done ? (
                  <Badge variant="default" className="bg-green-500">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Done
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    <SkipForward className="h-3 w-3 mr-1" />
                    Skipped
                  </Badge>
                )}
              </div>
            ))}
          </div>

          <div className="pt-2 text-center">
            <p className="text-sm text-muted-foreground">
              {doneCount === coreItems.length
                ? "Everything looks great! Launch your dashboard to get started."
                : "You can complete any skipped items later from Settings."}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pt-6">
        <Button variant="ghost" onClick={onBack} data-testid="button-back-step">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button onClick={onComplete} disabled={isPending} size="lg" data-testid="button-launch">
          {isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Rocket className="h-4 w-4 mr-2" />
          )}
          Launch Dashboard
        </Button>
      </div>
    </div>
  );
}
export default function BusinessOnboarding({
  onComplete,
  onDismiss,
}: {
  onComplete: () => void;
  onDismiss?: () => void;
}) {
  const { toast } = useToast();
  const {
    data: status,
    isLoading,
    isFetching,
  } = useQuery<BusinessOnboardingStatus>({
    queryKey: ["/api/onboarding/business-status"],
  });

  const STEPS = buildSteps();

  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);

  useEffect(() => {
    if (status) {
      const maxStep = LAUNCH_STEP_IDX;
      const step = Math.min(status.currentStep, maxStep);
      setCurrentStep(step);
      setCompletedSteps(Array.from({ length: step }, (_, i) => i));
    }
  }, [status, LAUNCH_STEP_IDX]);

  const STEP_DRAFT_KEYS: Record<number, string> = {
    0: DRAFT_KEYS.profile,
    1: DRAFT_KEYS.intelligence,
    2: DRAFT_KEYS.pricing,
  };

  const stepMutation = useMutation({
    mutationFn: async ({
      step,
      stepType,
      data,
    }: {
      step: number;
      stepType?: string;
      data?: Record<string, unknown>;
    }) => {
      const res = await apiRequest("POST", "/api/onboarding/business-step", {
        step,
        stepType,
        data,
      });
      return res.json();
    },
    onSuccess: (data) => {
      const draftKey = STEP_DRAFT_KEYS[currentStep];
      if (draftKey) clearDraft(draftKey);
      setCompletedSteps((prev) => [...new Set([...prev, currentStep])]);
      setCurrentStep(data.nextStep);
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/business-status"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/onboarding/business-complete");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/business-status"] });
      onComplete();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const backMutation = useMutation({
    mutationFn: async (targetStep: number) => {
      const res = await apiRequest("POST", "/api/onboarding/business-step", {
        step: targetStep,
        goingBack: true,
      });
      return res.json();
    },
  });

  const handleSkip = () => {
    stepMutation.mutate({ step: currentStep });
  };

  const handleBack = () => {
    if (currentStep > 0) {
      const prevStep = currentStep - 1;
      setCurrentStep(prevStep);
      backMutation.mutate(prevStep);
    }
  };

  if (isLoading || !status) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-3 text-muted-foreground">Setting up your workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b px-6 py-3 flex items-center gap-3 shrink-0">
        <img src={logoSquare} alt="ScooPilot" className="h-8 w-8 rounded" />
        <div>
          <h1 className="text-sm font-bold">ScooPilot</h1>
          <p className="text-[10px] text-muted-foreground">Business Setup</p>
        </div>
        <div className="flex-1" />
        <div className="text-xs text-muted-foreground mr-3">
          Step {currentStep + 1} of {STEPS.length}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            if (onDismiss) {
              onDismiss();
            } else {
              completeMutation.mutate();
            }
          }}
          data-testid="button-skip-onboarding"
        >
          Do this later
        </Button>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <StepIndicator currentStep={currentStep} completedSteps={completedSteps} steps={STEPS} />

          {currentStep === 0 && (
            <CompanyProfileStep
              companyData={status.companyData}
              onNext={(data) => stepMutation.mutate({ step: 0, data })}
              isPending={stepMutation.isPending}
            />
          )}

          {currentStep === 1 && (
            <BusinessIntelligenceStep
              companyData={status.companyData}
              onNext={(data) => stepMutation.mutate({ step: 1, data })}
              onBack={handleBack}
              onSkip={handleSkip}
              isPending={stepMutation.isPending}
              isFetchingData={isFetching}
            />
          )}

          {currentStep === 2 && (
            <PricingSetupStep
              companyData={status.companyData}
              onNext={(data) => stepMutation.mutate({ step: 2, data })}
              onBack={handleBack}
              onSkip={handleSkip}
              isPending={stepMutation.isPending}
            />
          )}

          {currentStep === 3 && (
            <PaymentProcessingStep
              companyData={status.companyData}
              onNext={() => stepMutation.mutate({ step: 3 })}
              onBack={handleBack}
              onSkip={handleSkip}
              isPending={stepMutation.isPending}
            />
          )}

          {currentStep === LAUNCH_STEP_IDX && (
            <ReviewLaunchStep
              companyData={status.companyData}
              onComplete={() => completeMutation.mutate()}
              onBack={handleBack}
              isPending={completeMutation.isPending}
            />
          )}
        </div>
      </div>

      <footer className="border-t px-6 py-2 text-center shrink-0">
        <Progress value={((currentStep + 1) / STEPS.length) * 100} className="h-1.5 mb-1" />
        <p className="text-xs text-muted-foreground">
          {Math.round(((currentStep + 1) / STEPS.length) * 100)}% complete
        </p>
      </footer>
    </div>
  );
}
