/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useCurrency } from "@/hooks/use-currency";
import { useAddressLabels } from "@/hooks/use-address-labels";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { LearnHowButton } from "@/components/interactive-tutorial";
import { useTutorialContext } from "@/hooks/use-tutorials";
import type { PricingConfig } from "@shared/schema";
import { DEFAULT_PRICING_CONFIG } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Calculator,
  Save,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  Clock,
  Truck,
  Wrench,
  Building2,
  Target,
  Info,
  Zap,
  Shield,
  Crown,
  SlidersHorizontal,
  HelpCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Users,
  Tag,
  FileText,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import AIPricingOptimizer from "@/pages/ai-pricing-optimizer";

function dollarsToCents(dollars: number | string): number {
  const val = typeof dollars === "string" ? parseFloat(dollars) : dollars;
  if (isNaN(val)) return 0;
  return Math.round(val * 100);
}

const pricingConfigSchema = z.object({
  techHourlyWageDollars: z.coerce.number().min(0),
  burdenMultiplier: z.coerce.number().min(1),
  averageGasPricePerGallon: z.coerce.number().min(0),
  vehicleCostPerMile: z.coerce.number().min(0),
  baseTimePerTenthAcreMinutes: z.coerce.number().min(1),
  extraDogMinutesAfterFirst: z.coerce.number().min(0),
  driveSpeedAverageMph: z.coerce.number().min(1),
  minimumServiceMinutesFloor: z.coerce.number().min(1),
  weeklyMultiplier: z.coerce.number().min(0.1),
  biweeklyMultiplier: z.coerce.number().min(0.1),
  monthlyMultiplier: z.coerce.number().min(0.1),
  oneTimeMultiplier: z.coerce.number().min(0.1),
  difficultyFlat: z.coerce.number().min(0.1),
  difficultyModerate: z.coerce.number().min(0.1),
  difficultyDifficult: z.coerce.number().min(0.1),
  advertisingDollars: z.coerce.number().min(0),
  payrollProviderDollars: z.coerce.number().min(0),
  benefitsDollars: z.coerce.number().min(0),
  insuranceDollars: z.coerce.number().min(0),
  softwareDollars: z.coerce.number().min(0),
  otherOverheadDollars: z.coerce.number().min(0),
  disinfectantDollars: z.coerce.number().min(0),
  bagsDollars: z.coerce.number().min(0),
  localMarketAverageWeeklyDollars: z.coerce.number().nullable(),
  marketAnchorTolerancePct: z.coerce.number().min(0).max(100),
  targetProfitMarginPct: z.coerce.number().min(0).max(100),
  premiumMarginPct: z.coerce.number().min(0).max(100),
  pricingMode: z.enum(["aggressive", "standard", "premium"]),
  clusterDiscountPct: z.coerce.number().min(0).max(100),
  clusterDiscountPct2: z.coerce.number().min(0).max(100),
  estimatedMonthlyStops: z.coerce.number().min(1),
  standardTravelMinutesPerStop: z.coerce.number().min(0).max(30),
});

function configToFormValues(config: PricingConfig) {
  return {
    techHourlyWageDollars: config.techHourlyWageCents / 100,
    burdenMultiplier: config.burdenMultiplier,
    averageGasPricePerGallon: config.averageGasPriceCentsPerGallon / 100,
    vehicleCostPerMile: config.vehicleCostPerMileCents / 100,
    baseTimePerTenthAcreMinutes: config.baseTimePerTenthAcreMinutes,
    extraDogMinutesAfterFirst: config.extraDogMinutesAfterFirst,
    driveSpeedAverageMph: config.driveSpeedAverageMph,
    minimumServiceMinutesFloor: config.minimumServiceMinutesFloor,
    weeklyMultiplier: config.weeklyMultiplier,
    biweeklyMultiplier: config.biweeklyMultiplier,
    monthlyMultiplier: config.monthlyMultiplier,
    oneTimeMultiplier: config.oneTimeMultiplier,
    difficultyFlat: config.difficultyFlat,
    difficultyModerate: config.difficultyModerate,
    difficultyDifficult: config.difficultyDifficult,
    advertisingDollars: config.advertisingCents / 100,
    payrollProviderDollars: config.payrollProviderCents / 100,
    benefitsDollars: config.benefitsCents / 100,
    insuranceDollars: config.insuranceCents / 100,
    softwareDollars: config.softwareCents / 100,
    otherOverheadDollars: config.otherOverheadCents / 100,
    disinfectantDollars: config.disinfectantCents / 100,
    bagsDollars: config.bagsCents / 100,
    localMarketAverageWeeklyDollars: config.localMarketAverageWeeklyPriceCents
      ? config.localMarketAverageWeeklyPriceCents / 100
      : null,
    marketAnchorTolerancePct: config.marketAnchorTolerancePct,
    targetProfitMarginPct: config.targetProfitMarginPct,
    premiumMarginPct: config.premiumMarginPct,
    pricingMode: config.pricingMode,
    clusterDiscountPct: config.clusterDiscountPct,
    clusterDiscountPct2: config.clusterDiscountPct2,
    estimatedMonthlyStops: config.estimatedMonthlyStops,
    standardTravelMinutesPerStop: config.standardTravelMinutesPerStop ?? 3,
  };
}

function formValuesToConfig(values: z.infer<typeof pricingConfigSchema>): PricingConfig {
  return {
    techHourlyWageCents: dollarsToCents(values.techHourlyWageDollars),
    burdenMultiplier: values.burdenMultiplier,
    averageGasPriceCentsPerGallon: dollarsToCents(values.averageGasPricePerGallon),
    vehicleCostPerMileCents: dollarsToCents(values.vehicleCostPerMile),
    vehicleMPG: null,
    baseTimePerTenthAcreMinutes: values.baseTimePerTenthAcreMinutes,
    extraDogMinutesAfterFirst: values.extraDogMinutesAfterFirst,
    driveSpeedAverageMph: values.driveSpeedAverageMph,
    minimumServiceMinutesFloor: values.minimumServiceMinutesFloor,
    weeklyMultiplier: values.weeklyMultiplier,
    biweeklyMultiplier: values.biweeklyMultiplier,
    monthlyMultiplier: values.monthlyMultiplier,
    oneTimeMultiplier: values.oneTimeMultiplier,
    difficultyFlat: values.difficultyFlat,
    difficultyModerate: values.difficultyModerate,
    difficultyDifficult: values.difficultyDifficult,
    advertisingCents: dollarsToCents(values.advertisingDollars),
    payrollProviderCents: dollarsToCents(values.payrollProviderDollars),
    benefitsCents: dollarsToCents(values.benefitsDollars),
    insuranceCents: dollarsToCents(values.insuranceDollars),
    softwareCents: dollarsToCents(values.softwareDollars),
    otherOverheadCents: dollarsToCents(values.otherOverheadDollars),
    disinfectantCents: dollarsToCents(values.disinfectantDollars),
    deodorizerCents: 0, // now dynamic: $7/acre when yard deodorizing add-on is active
    bagsCents: dollarsToCents(values.bagsDollars),
    localMarketAverageWeeklyPriceCents: values.localMarketAverageWeeklyDollars
      ? dollarsToCents(values.localMarketAverageWeeklyDollars)
      : null,
    marketAnchorTolerancePct: values.marketAnchorTolerancePct,
    targetProfitMarginPct: values.targetProfitMarginPct,
    premiumMarginPct: values.premiumMarginPct,
    pricingMode: values.pricingMode,
    clusterDiscountPct: values.clusterDiscountPct,
    clusterDiscountPct2: values.clusterDiscountPct2,
    estimatedMonthlyStops: values.estimatedMonthlyStops,
    standardTravelMinutesPerStop: values.standardTravelMinutesPerStop,
  };
}

const calculatorInputSchema = z.object({
  yardSizeAcres: z.coerce.number().min(0.01),
  dogCount: z.coerce.number().min(1).int(),
  serviceFrequency: z.enum(["weekly", "biweekly", "monthly", "onetime"]),
  yardDifficulty: z.enum(["flat", "moderate", "difficult"]),
  distanceFromNearestStopMiles: z.coerce.number().min(0),
  currentPriceDollars: z.coerce.number().min(0).optional(),
});

type CalculatorInputValues = z.infer<typeof calculatorInputSchema>;

interface CalculatorResult {
  minimumPriceCents: number;
  recommendedPriceCents: number;
  premiumPriceCents: number;
  breakdown: {
    serviceMinutes: number;
    travelMinutes: number;
    adjustedTravelMinutes: number;
    densityMultiplier: number;
    laborCostCents: number;
    travelCostCents: number;
    adjustedTravelCostCents: number;
    equipmentCostCents: number;
    overheadPerVisitCents: number;
  };
  derived: {
    jobMinutes: number;
    profitAtRecommendedCents: number;
    profitPerHourAtRecommendedCents: number;
    clusterDiscountAppliedPct: number;
    marketAnchorClamped: boolean;
    isEstimated: boolean;
  };
  profitWarning?: {
    message: string;
    lossPerVisitCents: number;
    profitPerVisitCents: number;
    profitPerHourCents: number;
  };
  inputsUsed: any;
}

// formatDollars is now a locale-aware helper created inside ResultsDisplay

function formatMinutes(mins: number): string {
  return `${mins.toFixed(1)} min`;
}

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground inline-block ml-1 cursor-help shrink-0" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-sm">
          <p>{text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function LabelWithInfo({ label, info }: { label: string; info: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {label}
      <InfoTip text={info} />
    </span>
  );
}

function TenantSettingsPanel({ config, onSaved }: { config: PricingConfig; onSaved: () => void }) {
  const { toast } = useToast();
  const { country } = useAddressLabels();
  const isCanada = country === "ca";
  const gasLabel = isCanada ? "Gas Price (CA$/litre)" : "Gas Price ($/gallon)";
  const gasInfo = isCanada
    ? "The average price you pay for gas per litre. Used to estimate fuel costs per km if you don't set a flat vehicle cost per km."
    : "The average price you pay for gas. Used to estimate fuel costs per mile if you don't set a flat vehicle cost per mile.";
  const vehicleLabel = isCanada ? "Vehicle Cost (CA$/km)" : "Vehicle Cost ($/mile)";
  const vehicleInfo = isCanada
    ? "The total cost to operate your vehicle per km, including gas, maintenance, insurance, and depreciation. If set, this is used instead of calculating from gas price."
    : "The total cost to operate your vehicle per mile, including gas, maintenance, insurance, and depreciation. The IRS standard rate is around $0.67/mile. If set, this is used instead of calculating from gas price.";

  const form = useForm({
    resolver: zodResolver(pricingConfigSchema),
    defaultValues: configToFormValues(config),
  });

  const saveMutation = useMutation({
    mutationFn: async (data: z.infer<typeof pricingConfigSchema>) => {
      const apiConfig = formValuesToConfig(data);
      await apiRequest("PUT", "/api/pricing-config", apiConfig);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({
        title: "Settings saved",
        description: "Pricing configuration updated successfully.",
      });
      onSaved();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleModePreset = (mode: "aggressive" | "standard" | "premium") => {
    form.setValue("pricingMode", mode);
    if (mode === "aggressive") {
      form.setValue("targetProfitMarginPct", 20);
      form.setValue("premiumMarginPct", 30);
    } else if (mode === "standard") {
      form.setValue("targetProfitMarginPct", 30);
      form.setValue("premiumMarginPct", 40);
    } else {
      form.setValue("targetProfitMarginPct", 40);
      form.setValue("premiumMarginPct", 55);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold" data-testid="text-settings-heading">
            Pricing Settings
          </h3>
          <Button
            type="submit"
            disabled={saveMutation.isPending}
            data-testid="button-save-settings"
          >
            <Save className="mr-1 h-4 w-4" />
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>

        <div>
          <p className="text-sm text-muted-foreground mb-2">
            Choose a pricing strategy. This sets the profit margin used when calculating recommended
            prices.
          </p>
          <div className="flex flex-wrap gap-2" data-testid="pricing-mode-toggle">
            <Button
              type="button"
              variant={form.watch("pricingMode") === "aggressive" ? "default" : "outline"}
              onClick={() => handleModePreset("aggressive")}
              data-testid="button-mode-aggressive"
            >
              <Zap className="mr-1 h-4 w-4" />
              Aggressive Growth (20%)
            </Button>
            <Button
              type="button"
              variant={form.watch("pricingMode") === "standard" ? "default" : "outline"}
              onClick={() => handleModePreset("standard")}
              data-testid="button-mode-standard"
            >
              <Shield className="mr-1 h-4 w-4" />
              Standard (30%)
            </Button>
            <Button
              type="button"
              variant={form.watch("pricingMode") === "premium" ? "default" : "outline"}
              onClick={() => handleModePreset("premium")}
              data-testid="button-mode-premium"
            >
              <Crown className="mr-1 h-4 w-4" />
              Premium (40%)
            </Button>
          </div>
        </div>

        <Accordion
          type="multiple"
          defaultValue={[
            "labor",
            "travel",
            "frequency",
            "difficulty",
            "overhead",
            "equipment",
            "profit",
          ]}
        >
          <AccordionItem value="labor">
            <AccordionTrigger data-testid="accordion-labor">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Labor Costs
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <FormField
                  control={form.control}
                  name="techHourlyWageDollars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Tech Hourly Wage ($)"
                          info="The hourly pay rate for your technicians before taxes and benefits. For example, if you pay $15/hr, enter 15.00."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-tech-wage" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="burdenMultiplier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Burden Multiplier"
                          info="The true cost of an employee is more than their wage. This multiplier accounts for payroll taxes, workers comp, and other employer costs. A typical value is 1.3-1.5. For example, 1.4 means an employee actually costs 40% more than their hourly wage."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          data-testid="input-burden-multiplier"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="travel">
            <AccordionTrigger data-testid="accordion-travel">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Travel & Vehicle
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <FormField
                  control={form.control}
                  name="averageGasPricePerGallon"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo label={gasLabel} info={gasInfo} />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-gas-price" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="vehicleCostPerMile"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo label={vehicleLabel} info={vehicleInfo} />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          data-testid="input-vehicle-cost"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="driveSpeedAverageMph"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Avg Drive Speed (mph)"
                          info="The average speed you drive between stops, including neighborhood streets and stopping. Usually 20-35 mph for residential service areas."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-drive-speed" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="frequency">
            <AccordionTrigger data-testid="accordion-frequency">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Time & Frequency
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <FormField
                  control={form.control}
                  name="baseTimePerTenthAcreMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Minutes per 1/10 Acre"
                          info="How many minutes it takes to service one-tenth of an acre of yard. This is the building block for estimating service time. A typical value is 8-12 minutes."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-base-time" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="extraDogMinutesAfterFirst"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Extra Minutes per Additional Dog"
                          info="Each additional dog beyond the first adds more waste to clean up. This is the extra time (in minutes) added for each dog after the first one."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-extra-dog-min" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="minimumServiceMinutesFloor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Minimum Service Time (min)"
                          info="The shortest a visit can be, even for a tiny yard. This ensures you don't undercharge for very small properties where you still spend time getting in and out."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-min-service-min" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="weeklyMultiplier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Weekly Multiplier"
                          info="Adjusts the estimated service time for weekly visits. Weekly cleanups are faster because there's less buildup. Usually 1.0 (no adjustment)."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          data-testid="input-weekly-mult"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="biweeklyMultiplier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Bi-Weekly Multiplier"
                          info="Adjusts service time for every-other-week visits. More waste accumulates, so each visit takes longer. A typical value is 1.2-1.4."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          data-testid="input-biweekly-mult"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="monthlyMultiplier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Monthly Multiplier"
                          info="Adjusts service time for monthly visits. A full month of buildup means significantly more work per visit. A typical value is 1.6-2.0."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          data-testid="input-monthly-mult"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="oneTimeMultiplier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="One-Time Multiplier"
                          info="Adjusts service time for one-time cleanups. These are often initial cleanups with heavy buildup. Set higher if first-time jobs are usually worse."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          data-testid="input-onetime-mult"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="difficulty">
            <AccordionTrigger data-testid="accordion-difficulty">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4" />
                Yard Difficulty
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <p className="text-sm text-muted-foreground mb-3">
                These multipliers adjust service time based on how hard the yard is to work in. A
                value of 1.0 means no change, 1.5 means 50% more time.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <FormField
                  control={form.control}
                  name="difficultyFlat"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Flat Yard"
                          info="Standard flat yard with easy access. This is the baseline, usually set to 1.0."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-diff-flat" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="difficultyModerate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Moderate Yard"
                          info="Some hills, obstacles, or harder-to-reach areas that slow you down. Typically 1.1-1.3."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          data-testid="input-diff-moderate"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="difficultyDifficult"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Difficult Yard"
                          info="Steep hills, heavy landscaping, multiple fenced areas, or other challenges that significantly increase service time. Typically 1.4-1.6."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          data-testid="input-diff-difficult"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="overhead">
            <AccordionTrigger data-testid="accordion-overhead">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Monthly Overhead
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <p className="text-sm text-muted-foreground mb-3">
                Enter your monthly business expenses. These get spread across all your stops so each
                job covers its fair share of your fixed costs.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <FormField
                  control={form.control}
                  name="advertisingDollars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Advertising ($/mo)"
                          info="Monthly spend on ads, flyers, online marketing, yard signs, etc."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          data-testid="input-advertising"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="payrollProviderDollars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Payroll Provider ($/mo)"
                          info="Monthly cost for payroll processing services like Gusto, ADP, or QuickBooks Payroll."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-payroll" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="benefitsDollars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Benefits ($/mo)"
                          info="Monthly cost of employee benefits like health insurance, PTO, or retirement contributions."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-benefits" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="insuranceDollars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Insurance ($/mo)"
                          info="Monthly business insurance costs, including general liability and any vehicle/equipment coverage."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-insurance" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="softwareDollars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Software ($/mo)"
                          info="Monthly software subscriptions like this app, accounting software, CRM tools, etc."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-software" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="otherOverheadDollars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Other Overhead ($/mo)"
                          info="Any other monthly fixed costs not covered above, like phone bills, storage rental, uniforms, etc."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          data-testid="input-other-overhead"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="estimatedMonthlyStops"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Estimated Monthly Stops"
                          info="How many total service stops you do in a typical month across all customers. Overhead costs get divided by this number to figure out how much each stop needs to cover."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-monthly-stops" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="standardTravelMinutesPerStop"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Target Travel Time (min/stop)"
                          info="The standardized travel time per stop used for job-level profitability analysis. This represents your target route density — e.g. 3 minutes if you want stops close together. Job economics use this instead of actual current drive time so pricing stays stable."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.5"
                          {...field}
                          data-testid="input-standard-travel-minutes"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="equipment">
            <AccordionTrigger data-testid="accordion-equipment">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4" />
                Supplies Per Visit
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <p className="text-sm text-muted-foreground mb-3">
                The cost of consumable supplies you use on each visit.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <FormField
                  control={form.control}
                  name="disinfectantDollars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Disinfectant/Deodorizer ($/stop)"
                          info="Base cost of disinfectant/deodorizer spray per stop ($0.01 default). When a yard deodorizing add-on is active, an additional $7.00/acre is added automatically."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          data-testid="input-disinfectant"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="bagsDollars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Bags ($/bag)"
                          info="Cost per waste bag. Bags used = 1 per 2 dogs, rounded up (e.g. 1–2 dogs = 1 bag, 3–4 dogs = 2 bags)."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-bags" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="profit">
            <AccordionTrigger data-testid="accordion-profit">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Profit & Market
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <FormField
                  control={form.control}
                  name="targetProfitMarginPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Target Profit Margin (%)"
                          info="The percentage of each dollar collected that you want to keep as profit. 30% means for every $100 you charge, $30 is profit after covering all costs."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-target-margin" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="premiumMarginPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Premium Margin (%)"
                          info="A higher profit margin used for the 'Premium' price tier. This gives you a ceiling price for customers willing to pay more for premium service."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-premium-margin" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="localMarketAverageWeeklyDollars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Local Market Avg Weekly ($)"
                          info="What competitors in your area typically charge per week. If set, the calculator will keep recommendations within a reasonable range of this number so you stay competitive. Leave blank to skip this check."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(e.target.value === "" ? null : Number(e.target.value))
                          }
                          data-testid="input-market-avg"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="marketAnchorTolerancePct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Market Tolerance (%)"
                          info="How far above or below the local market average your recommended price is allowed to go. For example, 35% means your price can be up to 35% higher or lower than the market average."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-market-tolerance" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="clusterDiscountPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Cluster Discount (%)"
                          info="A discount applied when a customer is very close to another stop on the route (within about 250 feet). Since you're already in the neighborhood, you can offer a small discount."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-cluster-discount" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="clusterDiscountPct2"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Neighbor Discount (%)"
                          info="A larger discount for customers that are extremely close to another stop (within about 100 feet), like next-door neighbors. Since travel time is almost zero, you can pass more savings along."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-cluster-discount-2" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </form>
    </Form>
  );
}

type AllFrequencyResults = {
  weekly: CalculatorResult;
  biweekly: CalculatorResult;
  monthly: CalculatorResult;
};

function CalculatorPanel() {
  const { toast } = useToast();
  const [result, setResult] = useState<CalculatorResult | null>(null);
  const [allFrequencies, setAllFrequencies] = useState<AllFrequencyResults | null>(null);

  const form = useForm<CalculatorInputValues>({
    resolver: zodResolver(calculatorInputSchema),
    defaultValues: {
      yardSizeAcres: 0.1,
      dogCount: 1,
      serviceFrequency: "weekly",
      yardDifficulty: "flat",
      distanceFromNearestStopMiles: 1,
      currentPriceDollars: undefined,
    },
  });

  const calculateMutation = useMutation({
    mutationFn: async (data: CalculatorInputValues) => {
      const base = {
        ...data,
        currentPriceCents:
          data.currentPriceDollars !== undefined
            ? dollarsToCents(data.currentPriceDollars)
            : undefined,
      };
      const { currentPriceDollars: _cpd, ...baseRest } = base as any;
      const makeReq = (freq: string) =>
        apiRequest("POST", "/api/pricing/calculate", { ...baseRest, serviceFrequency: freq }).then(
          (r) => r.json() as Promise<CalculatorResult>
        );
      const selectedFreq = data.serviceFrequency;
      const comparisonFreqs = ["weekly", "biweekly", "monthly"] as const;
      const isStandardFreq = comparisonFreqs.includes(
        selectedFreq as (typeof comparisonFreqs)[number]
      );
      const [primaryResult, weekly, biweekly, monthly] = await Promise.all([
        isStandardFreq ? Promise.resolve(null) : makeReq(selectedFreq),
        makeReq("weekly"),
        makeReq("biweekly"),
        makeReq("monthly"),
      ]);
      const all = { weekly, biweekly, monthly };
      const primary =
        primaryResult ??
        (selectedFreq === "biweekly" ? biweekly : selectedFreq === "monthly" ? monthly : weekly);
      return { primary, all };
    },
    onSuccess: ({ primary, all }: { primary: CalculatorResult; all: AllFrequencyResults }) => {
      setResult(primary);
      setAllFrequencies(all);
    },
    onError: (error: Error) => {
      toast({ title: "Calculation Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Property Calculator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((v) => calculateMutation.mutate(v))}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="yardSizeAcres"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Yard Size (acres)"
                          info="The size of the yard in acres. 1/10 of an acre (0.1) is a typical small residential yard, about 4,350 sq ft. If you know the square footage, divide by 43,560 to get acres."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          data-testid="input-calc-yard-size"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dogCount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Number of Dogs"
                          info="How many dogs are at this property. More dogs means more waste and more time on each visit."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          {...field}
                          data-testid="input-calc-dog-count"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="serviceFrequency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Service Frequency"
                          info="How often the yard gets cleaned. Less frequent visits mean more buildup and longer service times per visit."
                        />
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-calc-frequency">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="biweekly">Bi-Weekly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                          <SelectItem value="onetime">One-Time</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="yardDifficulty"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Yard Difficulty"
                          info="How hard is this yard to service? Flat yards are quickest. Moderate yards have some hills or obstacles. Difficult yards have steep terrain, heavy landscaping, or tricky access."
                        />
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-calc-difficulty">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="flat">Flat</SelectItem>
                          <SelectItem value="moderate">Moderate</SelectItem>
                          <SelectItem value="difficult">Difficult</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="distanceFromNearestStopMiles"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Distance from Nearest Stop (mi)"
                          info="How far this property is from the closest other stop on the route. Closer stops cost less in travel time and gas. Enter 0 if it's right next to another customer."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          data-testid="input-calc-distance"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="currentPriceDollars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Current Price ($, optional)"
                          info="If this customer already has a price, enter it here. The calculator will tell you if that price is profitable or if you're losing money on this stop."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === "" ? undefined : Number(e.target.value)
                            )
                          }
                          data-testid="input-calc-current-price"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <Button
                type="submit"
                disabled={calculateMutation.isPending}
                data-testid="button-calculate"
              >
                <Calculator className="mr-1 h-4 w-4" />
                {calculateMutation.isPending ? "Calculating..." : "Calculate Price"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {result && <ResultsDisplay result={result} allFrequencies={allFrequencies ?? undefined} />}
    </div>
  );
}

// ---- Plain-language helpers ----

function getYardSizeLabel(acres: number): string {
  if (acres < 0.075) return "small yard";
  if (acres < 0.2) return "medium yard";
  if (acres < 0.5) return "large yard";
  return "extra-large yard";
}

function getDriveTimeBurden(miles: number): string {
  if (miles < 0.5) return "low drive-time burden";
  if (miles < 2) return "moderate drive-time burden";
  return "high drive-time burden";
}

function getRouteDensityLabel(densityMultiplier: number): string {
  if (densityMultiplier < 0.9) return "good route density — nearby stops lower per-stop cost";
  if (densityMultiplier <= 1.1) return "moderate route density";
  return "sparse route density — this stop is out of the way";
}

function getFrequencyLabel(freq: string): string {
  if (freq === "weekly") return "weekly";
  if (freq === "biweekly") return "bi-weekly";
  if (freq === "monthly") return "monthly";
  return "one-time";
}

function getVisitsPerYear(freq: string): number {
  if (freq === "weekly") return 52;
  if (freq === "biweekly") return 26;
  if (freq === "monthly") return 12;
  return 1;
}

// ---- Contact + Service Plan Selector Dialog ----

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
}

interface ServicePlan {
  id: string;
  serviceName?: string | null;
  frequency?: string | null;
  pricePerVisit: string;
  isActive: boolean;
}

function ContactSelectorDialog({
  open,
  onOpenChange,
  title,
  description,
  actionLabel,
  requireServicePlan,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  actionLabel: string;
  requireServicePlan?: boolean;
  onConfirm: (contactId: string, servicePlanId?: string) => void;
  isPending?: boolean;
}) {
  const [selectedContactId, setSelectedContactId] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState("");

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
    enabled: open,
  });

  const { data: plans } = useQuery<ServicePlan[]>({
    queryKey: ["/api/service-plans", selectedContactId],
    queryFn: async () => {
      const { getAuthHeaders } = await import("@/lib/queryClient");
      const res = await fetch(`/api/service-plans?contactId=${selectedContactId}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: open && !!selectedContactId && !!requireServicePlan,
  });

  const activePlans = plans?.filter((p) => p.isActive) ?? [];

  const canConfirm = selectedContactId && (!requireServicePlan || selectedPlanId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-sm text-muted-foreground">{description}</p>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <label className="text-sm font-medium">Select customer</label>
            <Select
              value={selectedContactId}
              onValueChange={(v) => {
                setSelectedContactId(v);
                setSelectedPlanId("");
              }}
            >
              <SelectTrigger data-testid="select-action-contact">
                <SelectValue placeholder="Choose a customer…" />
              </SelectTrigger>
              <SelectContent>
                {(contacts ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                    {c.email ? ` — ${c.email}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {requireServicePlan && selectedContactId && (
            <div className="space-y-1">
              <label className="text-sm font-medium">Select service plan</label>
              {activePlans.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active service plans found.</p>
              ) : (
                <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                  <SelectTrigger data-testid="select-action-plan">
                    <SelectValue placeholder="Choose a plan…" />
                  </SelectTrigger>
                  <SelectContent>
                    {activePlans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.serviceName ?? "Service Plan"} — {getFrequencyLabel(p.frequency ?? "")} @
                        ${parseFloat(p.pricePerVisit).toFixed(2)}/visit
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canConfirm || isPending}
            onClick={() => onConfirm(selectedContactId, selectedPlanId || undefined)}
            data-testid="button-action-confirm"
          >
            {isPending ? "Saving…" : actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Main ResultsDisplay ----

function ResultsDisplay({
  result,
  allFrequencies,
}: {
  result: CalculatorResult;
  allFrequencies?: AllFrequencyResults;
}) {
  const { formatMoney } = useCurrency();
  const { toast } = useToast();
  const formatDollars = (cents: number) => formatMoney(cents / 100);
  const { breakdown, derived } = result;

  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [priceListDialogOpen, setPriceListDialogOpen] = useState(false);

  const inputs = result.inputsUsed as {
    yardSizeAcres: number;
    dogCount: number;
    serviceFrequency: string;
    yardDifficulty: string;
    distanceFromNearestStopMiles: number;
    currentPriceCents?: number;
    configSnapshot?: { targetProfitMarginPct?: number };
  };

  const totalCost =
    breakdown.laborCostCents +
    breakdown.adjustedTravelCostCents +
    breakdown.equipmentCostCents +
    breakdown.overheadPerVisitCents;

  const costBreakdownItems = [
    { label: "Labor", value: breakdown.laborCostCents, icon: DollarSign },
    { label: "Travel (adjusted)", value: breakdown.adjustedTravelCostCents, icon: Truck },
    { label: "Supplies", value: breakdown.equipmentCostCents, icon: Wrench },
    { label: "Overhead", value: breakdown.overheadPerVisitCents, icon: Building2 },
  ];

  const whyBullets: string[] = [
    `${getYardSizeLabel(inputs.yardSizeAcres)} (${inputs.yardSizeAcres.toFixed(2)} acres)`,
    `${inputs.dogCount} dog${inputs.dogCount !== 1 ? "s" : ""} — ${inputs.dogCount > 2 ? "above-average" : inputs.dogCount > 1 ? "standard" : "minimal"} waste load`,
    `${inputs.yardDifficulty === "flat" ? "flat terrain — easy access" : inputs.yardDifficulty === "moderate" ? "moderate terrain — some obstacles" : "difficult terrain — hills or heavy landscaping"}`,
    getDriveTimeBurden(inputs.distanceFromNearestStopMiles),
    getRouteDensityLabel(breakdown.densityMultiplier),
    `${inputs.configSnapshot?.targetProfitMarginPct ?? 30}% target profit margin`,
  ];

  const visitsPerYear = getVisitsPerYear(inputs.serviceFrequency);
  const currentBelowRecommended =
    inputs.currentPriceCents !== undefined &&
    inputs.currentPriceCents < result.recommendedPriceCents;
  const yearlyGainCents =
    currentBelowRecommended && inputs.currentPriceCents !== undefined
      ? (result.recommendedPriceCents - inputs.currentPriceCents) * visitsPerYear
      : 0;

  // Action mutations
  const applyMutation = useMutation({
    mutationFn: async ({
      contactId: _contactId,
      servicePlanId,
    }: {
      contactId: string;
      servicePlanId: string;
    }) => {
      const pricePerVisit = (result.recommendedPriceCents / 100).toFixed(2);
      await apiRequest("PATCH", `/api/service-plans/${servicePlanId}`, { pricePerVisit });
    },
    onSuccess: () => {
      setApplyDialogOpen(false);
      toast({
        title: "Price applied",
        description: `Service plan updated to ${formatDollars(result.recommendedPriceCents)}/visit.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const quoteMutation = useMutation({
    mutationFn: async ({ contactId }: { contactId: string }) => {
      const contacts = (await (await apiRequest("GET", `/api/contacts/${contactId}`)).json()) as {
        firstName: string;
        lastName: string;
        email?: string;
      };
      const freq =
        inputs.serviceFrequency === "biweekly"
          ? "biweekly"
          : inputs.serviceFrequency === "monthly"
            ? "monthly"
            : "weekly";
      const body = {
        type: "residential",
        contactId,
        contactName: `${contacts.firstName} ${contacts.lastName}`,
        contactEmail: contacts.email ?? undefined,
        frequency: freq,
        essentialPrice: (result.minimumPriceCents / 100).toFixed(2),
        premiumPrice: (result.recommendedPriceCents / 100).toFixed(2),
        deluxePrice: (result.premiumPriceCents / 100).toFixed(2),
        dogCount: inputs.dogCount,
        yardSize: getYardSizeLabel(inputs.yardSizeAcres),
      };
      await apiRequest("POST", "/api/quotes", body);
    },
    onSuccess: () => {
      setQuoteDialogOpen(false);
      toast({
        title: "Quote saved",
        description: "A new quote has been created.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const priceListMutation = useMutation({
    mutationFn: async ({ contactId }: { contactId: string }) => {
      const tagsRes = (await (await apiRequest("GET", "/api/tags")).json()) as {
        id: string;
        name: string;
      }[];
      let tag = tagsRes.find((t) => t.name.toLowerCase() === "price increase list");
      if (!tag) {
        tag = (await (
          await apiRequest("POST", "/api/tags", { name: "Price Increase List", color: "#f59e0b" })
        ).json()) as { id: string; name: string };
      }
      await apiRequest("POST", `/api/contacts/${contactId}/tags`, { tagId: tag.id });
    },
    onSuccess: () => {
      setPriceListDialogOpen(false);
      toast({
        title: "Contact flagged",
        description: 'Added to the "Price Increase List" for review.',
      });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      {/* ── Recommended Price Callout ── */}
      <Card className="border-primary/50 ring-2 ring-primary/20" data-testid="card-recommendation">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium text-primary uppercase tracking-wide">
              Recommended Price
            </span>
          </div>
          {/* Primary recommended price */}
          <div className="mb-4">
            <p
              className="text-5xl font-bold text-primary leading-none"
              data-testid="text-price-recommended"
            >
              {formatDollars(result.recommendedPriceCents)}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              per visit · {getFrequencyLabel(inputs.serviceFrequency)} service
            </p>
          </div>

          {/* Frequency comparison grid */}
          <div
            className="grid grid-cols-3 gap-2 mb-4 rounded-lg border bg-muted/30 p-3"
            data-testid="grid-frequency-prices"
          >
            {(
              [
                { key: "weekly", label: "Weekly" },
                { key: "biweekly", label: "Bi-Weekly" },
                { key: "monthly", label: "Monthly" },
              ] as const
            ).map(({ key, label }) => {
              const isSelected = inputs.serviceFrequency === key;
              const freqResult = allFrequencies?.[key];
              return (
                <div
                  key={key}
                  className={`text-center rounded-md p-2 ${isSelected ? "bg-primary/10 ring-1 ring-primary/40" : ""}`}
                  data-testid={`cell-freq-${key}`}
                >
                  <p
                    className={`text-xs font-medium mb-1 ${isSelected ? "text-primary" : "text-muted-foreground"}`}
                  >
                    {label}
                    {isSelected && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide">(selected)</span>
                    )}
                  </p>
                  <p
                    className={`text-lg font-bold ${isSelected ? "text-primary" : ""}`}
                    data-testid={`text-freq-recommended-${key}`}
                  >
                    {freqResult ? formatDollars(freqResult.recommendedPriceCents) : "—"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {freqResult ? `min ${formatDollars(freqResult.minimumPriceCents)}` : ""}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Break-even & Premium for selected frequency */}
          <div className="flex gap-4 mb-4">
            <div>
              <p className="text-xs text-muted-foreground">Break-even</p>
              <p
                className="text-base font-semibold text-destructive"
                data-testid="text-price-minimum"
              >
                {formatDollars(result.minimumPriceCents)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Premium</p>
              <p
                className="text-base font-semibold"
                style={{ color: "hsl(var(--chart-4))" }}
                data-testid="text-price-premium"
              >
                {formatDollars(result.premiumPriceCents)}
              </p>
            </div>
          </div>

          {/* Adjustment badges */}
          {(derived.clusterDiscountAppliedPct > 0 ||
            derived.marketAnchorClamped ||
            breakdown.densityMultiplier !== 1.0 ||
            derived.isEstimated) && (
            <div className="flex flex-wrap gap-2 mb-4" data-testid="badges-adjustments">
              {derived.clusterDiscountAppliedPct > 0 && (
                <Badge
                  variant="secondary"
                  className="no-default-active-elevate"
                  data-testid="badge-cluster-discount"
                >
                  Cluster Discount: {derived.clusterDiscountAppliedPct}%
                </Badge>
              )}
              {derived.marketAnchorClamped && (
                <Badge
                  variant="secondary"
                  className="no-default-active-elevate"
                  data-testid="badge-market-clamped"
                >
                  Market Anchor Applied
                </Badge>
              )}
              {breakdown.densityMultiplier !== 1.0 && (
                <Badge
                  variant="secondary"
                  className="no-default-active-elevate"
                  data-testid="badge-density"
                >
                  Density {breakdown.densityMultiplier.toFixed(2)}x
                </Badge>
              )}
              {derived.isEstimated && (
                <Badge
                  variant="outline"
                  className="no-default-active-elevate"
                  data-testid="badge-estimated"
                >
                  Estimated
                </Badge>
              )}
            </div>
          )}

          {/* Why this price */}
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2">Why this price?</p>
            <ul className="space-y-1" data-testid="list-why-bullets">
              {whyBullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                  {b}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* ── Current Price Comparison ── */}
      {currentBelowRecommended && inputs.currentPriceCents !== undefined && (
        <div
          className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-4"
          data-testid="alert-price-gap"
        >
          <TrendingUp className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            You're pricing this job at <strong>{formatDollars(inputs.currentPriceCents)}</strong>.
            At the recommended price you would earn an extra{" "}
            <strong>{formatDollars(yearlyGainCents)}/year</strong>.
          </p>
        </div>
      )}

      {result.profitWarning && result.profitWarning.lossPerVisitCents > 0 && (
        <Alert variant="destructive" data-testid="alert-profit-warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Losing Money at Current Price</AlertTitle>
          <AlertDescription>
            You are losing approximately {formatDollars(result.profitWarning.lossPerVisitCents)} on
            every visit at the current price.
          </AlertDescription>
        </Alert>
      )}

      {result.profitWarning &&
        result.profitWarning.lossPerVisitCents === 0 &&
        !currentBelowRecommended && (
          <Alert data-testid="alert-profit-info">
            <TrendingUp className="h-4 w-4" />
            <AlertTitle>Currently Profitable</AlertTitle>
            <AlertDescription>
              Earning {formatDollars(result.profitWarning.profitPerVisitCents)} profit per visit (
              {formatDollars(result.profitWarning.profitPerHourCents)}/hr).
            </AlertDescription>
          </Alert>
        )}

      {/* ── Full Breakdown (collapsible) ── */}
      <div className="rounded-lg border">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
          onClick={() => setBreakdownOpen((v) => !v)}
          data-testid="button-toggle-breakdown"
        >
          <span className="flex items-center gap-2">
            <Info className="h-4 w-4 text-muted-foreground" />
            See full breakdown
          </span>
          {breakdownOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {breakdownOpen && (
          <div className="px-4 pb-4 border-t">
            <div className="space-y-3 pt-3">
              {costBreakdownItems.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <item.icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{item.label}</span>
                  </div>
                  <span
                    className="text-sm font-medium"
                    data-testid={`text-cost-${item.label.toLowerCase().replace(/[^a-z]/g, "-")}`}
                  >
                    {formatDollars(item.value)}
                  </span>
                </div>
              ))}
              <div className="border-t pt-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">Total Cost per Visit</span>
                <span className="text-sm font-bold" data-testid="text-total-cost">
                  {formatDollars(totalCost)}
                </span>
              </div>
              <div className="border-t pt-2 text-xs text-muted-foreground space-y-1">
                <p>
                  Service time: {formatMinutes(breakdown.serviceMinutes)} · Travel:{" "}
                  {formatMinutes(breakdown.adjustedTravelMinutes)} · Total:{" "}
                  {formatMinutes(derived.jobMinutes)}
                </p>
                <p>
                  Profit at recommended: {formatDollars(derived.profitAtRecommendedCents)}/visit ·{" "}
                  {formatDollars(derived.profitPerHourAtRecommendedCents)}/hr
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Action Buttons ── */}
      <div className="flex flex-wrap gap-3" data-testid="section-action-buttons">
        <Button
          variant="default"
          onClick={() => setApplyDialogOpen(true)}
          data-testid="button-apply-to-customer"
        >
          <Users className="h-4 w-4 mr-2" />
          Apply to Customer
        </Button>
        <Button
          variant="outline"
          onClick={() => setQuoteDialogOpen(true)}
          data-testid="button-save-as-quote"
        >
          <FileText className="h-4 w-4 mr-2" />
          Save as Quote
        </Button>
        <Button
          variant="outline"
          onClick={() => setPriceListDialogOpen(true)}
          data-testid="button-add-price-increase-list"
        >
          <Tag className="h-4 w-4 mr-2" />
          Add to Price Increase List
        </Button>
      </div>

      {/* ── Apply to Customer Dialog ── */}
      <ContactSelectorDialog
        open={applyDialogOpen}
        onOpenChange={setApplyDialogOpen}
        title="Apply to Customer"
        description={`This will update the selected service plan's price to ${formatDollars(result.recommendedPriceCents)}/visit.`}
        actionLabel="Apply Price"
        requireServicePlan
        isPending={applyMutation.isPending}
        onConfirm={(contactId, servicePlanId) => {
          if (servicePlanId) applyMutation.mutate({ contactId, servicePlanId });
        }}
      />

      {/* ── Save as Quote Dialog ── */}
      <ContactSelectorDialog
        open={quoteDialogOpen}
        onOpenChange={setQuoteDialogOpen}
        title="Save as Quote"
        description="A quote will be created for the selected customer using these pricing figures."
        actionLabel="Create Quote"
        requireServicePlan={false}
        isPending={quoteMutation.isPending}
        onConfirm={(contactId) => quoteMutation.mutate({ contactId })}
      />

      {/* ── Add to Price Increase List Dialog ── */}
      <ContactSelectorDialog
        open={priceListDialogOpen}
        onOpenChange={setPriceListDialogOpen}
        title="Add to Price Increase List"
        description='The selected customer will be tagged "Price Increase List" for your review.'
        actionLabel="Add Tag"
        requireServicePlan={false}
        isPending={priceListMutation.isPending}
        onConfirm={(contactId) => priceListMutation.mutate({ contactId })}
      />
    </div>
  );
}

export default function PricingCalculator() {
  const { startTutorial, isTutorialCompleted } = useTutorialContext();
  const { data: configData, isLoading: configLoading } = useQuery<PricingConfig>({
    queryKey: ["/api/pricing-config"],
  });

  const effectiveConfig = { ...DEFAULT_PRICING_CONFIG, ...(configData || {}) };

  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    if (t === "simulator" || t === "settings") return t;
    return "calculator";
  });

  if (configLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-pricing-calculator-heading">
            Price Calculator
          </h1>
          <p className="text-sm text-muted-foreground">
            Figure out what to charge for each property based on your real costs
          </p>
        </div>
        <LearnHowButton
          tutorialId="tutorial_pricing_calculator"
          onStart={startTutorial}
          isCompleted={isTutorialCompleted("tutorial_pricing_calculator")}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="calculator" data-testid="tab-calculator">
            <Calculator className="mr-1 h-4 w-4" />
            Calculator
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">
            <SlidersHorizontal className="mr-1 h-4 w-4" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="simulator" data-testid="tab-simulator">
            <TrendingUp className="mr-1 h-4 w-4" />
            Pricing Simulator
          </TabsTrigger>
        </TabsList>
        <TabsContent value="calculator" className="mt-4">
          <CalculatorPanel />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <TenantSettingsPanel config={effectiveConfig} onSaved={() => {}} />
        </TabsContent>
        <TabsContent value="simulator" className="mt-0 -mx-4 md:-mx-6">
          <AIPricingOptimizer />
        </TabsContent>
      </Tabs>
    </div>
  );
}
