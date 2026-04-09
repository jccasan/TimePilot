import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
} from "lucide-react";

function centsToDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

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
  deodorizerDollars: z.coerce.number().min(0),
  bagsDollars: z.coerce.number().min(0),
  localMarketAverageWeeklyDollars: z.coerce.number().nullable(),
  marketAnchorTolerancePct: z.coerce.number().min(0).max(100),
  targetProfitMarginPct: z.coerce.number().min(0).max(100),
  premiumMarginPct: z.coerce.number().min(0).max(100),
  pricingMode: z.enum(["aggressive", "standard", "premium"]),
  clusterDiscountPct: z.coerce.number().min(0).max(100),
  clusterDiscountPct2: z.coerce.number().min(0).max(100),
  estimatedMonthlyStops: z.coerce.number().min(1),
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
    deodorizerDollars: config.deodorizerCents / 100,
    bagsDollars: config.bagsCents / 100,
    localMarketAverageWeeklyDollars: config.localMarketAverageWeeklyPriceCents ? config.localMarketAverageWeeklyPriceCents / 100 : null,
    marketAnchorTolerancePct: config.marketAnchorTolerancePct,
    targetProfitMarginPct: config.targetProfitMarginPct,
    premiumMarginPct: config.premiumMarginPct,
    pricingMode: config.pricingMode,
    clusterDiscountPct: config.clusterDiscountPct,
    clusterDiscountPct2: config.clusterDiscountPct2,
    estimatedMonthlyStops: config.estimatedMonthlyStops,
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
    deodorizerCents: dollarsToCents(values.deodorizerDollars),
    bagsCents: dollarsToCents(values.bagsDollars),
    localMarketAverageWeeklyPriceCents: values.localMarketAverageWeeklyDollars ? dollarsToCents(values.localMarketAverageWeeklyDollars) : null,
    marketAnchorTolerancePct: values.marketAnchorTolerancePct,
    targetProfitMarginPct: values.targetProfitMarginPct,
    premiumMarginPct: values.premiumMarginPct,
    pricingMode: values.pricingMode,
    clusterDiscountPct: values.clusterDiscountPct,
    clusterDiscountPct2: values.clusterDiscountPct2,
    estimatedMonthlyStops: values.estimatedMonthlyStops,
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

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

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
      toast({ title: "Settings saved", description: "Pricing configuration updated successfully." });
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
          <h3 className="text-lg font-semibold" data-testid="text-settings-heading">Pricing Settings</h3>
          <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-settings">
            <Save className="mr-1 h-4 w-4" />
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>

        <div>
          <p className="text-sm text-muted-foreground mb-2">Choose a pricing strategy. This sets the profit margin used when calculating recommended prices.</p>
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

        <Accordion type="multiple" defaultValue={["labor", "travel", "frequency", "difficulty", "overhead", "equipment", "profit"]}>
          <AccordionItem value="labor">
            <AccordionTrigger data-testid="accordion-labor">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Labor Costs
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <FormField control={form.control} name="techHourlyWageDollars" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Tech Hourly Wage ($)" info="The hourly pay rate for your technicians before taxes and benefits. For example, if you pay $15/hr, enter 15.00." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-tech-wage" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="burdenMultiplier" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Burden Multiplier" info="The true cost of an employee is more than their wage. This multiplier accounts for payroll taxes, workers comp, and other employer costs. A typical value is 1.3-1.5. For example, 1.4 means an employee actually costs 40% more than their hourly wage." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-burden-multiplier" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
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
                <FormField control={form.control} name="averageGasPricePerGallon" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Gas Price ($/gallon)" info="The average price you pay for gas. Used to estimate fuel costs per mile if you don't set a flat vehicle cost per mile." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-gas-price" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="vehicleCostPerMile" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Vehicle Cost ($/mile)" info="The total cost to operate your vehicle per mile, including gas, maintenance, insurance, and depreciation. The IRS standard rate is around $0.67/mile. If set, this is used instead of calculating from gas price." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-vehicle-cost" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="driveSpeedAverageMph" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Avg Drive Speed (mph)" info="The average speed you drive between stops, including neighborhood streets and stopping. Usually 20-35 mph for residential service areas." />
                    </FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-drive-speed" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
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
                <FormField control={form.control} name="baseTimePerTenthAcreMinutes" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Minutes per 1/10 Acre" info="How many minutes it takes to service one-tenth of an acre of yard. This is the building block for estimating service time. A typical value is 8-12 minutes." />
                    </FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-base-time" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="extraDogMinutesAfterFirst" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Extra Minutes per Additional Dog" info="Each additional dog beyond the first adds more waste to clean up. This is the extra time (in minutes) added for each dog after the first one." />
                    </FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-extra-dog-min" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="minimumServiceMinutesFloor" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Minimum Service Time (min)" info="The shortest a visit can be, even for a tiny yard. This ensures you don't undercharge for very small properties where you still spend time getting in and out." />
                    </FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-min-service-min" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="weeklyMultiplier" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Weekly Multiplier" info="Adjusts the estimated service time for weekly visits. Weekly cleanups are faster because there's less buildup. Usually 1.0 (no adjustment)." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-weekly-mult" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="biweeklyMultiplier" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Bi-Weekly Multiplier" info="Adjusts service time for every-other-week visits. More waste accumulates, so each visit takes longer. A typical value is 1.2-1.4." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-biweekly-mult" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="monthlyMultiplier" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Monthly Multiplier" info="Adjusts service time for monthly visits. A full month of buildup means significantly more work per visit. A typical value is 1.6-2.0." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-monthly-mult" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="oneTimeMultiplier" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="One-Time Multiplier" info="Adjusts service time for one-time cleanups. These are often initial cleanups with heavy buildup. Set higher if first-time jobs are usually worse." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-onetime-mult" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
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
              <p className="text-sm text-muted-foreground mb-3">These multipliers adjust service time based on how hard the yard is to work in. A value of 1.0 means no change, 1.5 means 50% more time.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <FormField control={form.control} name="difficultyFlat" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Flat Yard" info="Standard flat yard with easy access. This is the baseline, usually set to 1.0." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-diff-flat" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="difficultyModerate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Moderate Yard" info="Some hills, obstacles, or harder-to-reach areas that slow you down. Typically 1.1-1.3." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-diff-moderate" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="difficultyDifficult" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Difficult Yard" info="Steep hills, heavy landscaping, multiple fenced areas, or other challenges that significantly increase service time. Typically 1.4-1.6." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-diff-difficult" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
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
              <p className="text-sm text-muted-foreground mb-3">Enter your monthly business expenses. These get spread across all your stops so each job covers its fair share of your fixed costs.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <FormField control={form.control} name="advertisingDollars" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Advertising ($/mo)" info="Monthly spend on ads, flyers, online marketing, yard signs, etc." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-advertising" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="payrollProviderDollars" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Payroll Provider ($/mo)" info="Monthly cost for payroll processing services like Gusto, ADP, or QuickBooks Payroll." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-payroll" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="benefitsDollars" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Benefits ($/mo)" info="Monthly cost of employee benefits like health insurance, PTO, or retirement contributions." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-benefits" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="insuranceDollars" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Insurance ($/mo)" info="Monthly business insurance costs, including general liability and any vehicle/equipment coverage." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-insurance" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="softwareDollars" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Software ($/mo)" info="Monthly software subscriptions like this app, accounting software, CRM tools, etc." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-software" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="otherOverheadDollars" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Other Overhead ($/mo)" info="Any other monthly fixed costs not covered above, like phone bills, storage rental, uniforms, etc." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-other-overhead" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="estimatedMonthlyStops" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Estimated Monthly Stops" info="How many total service stops you do in a typical month across all customers. Overhead costs get divided by this number to figure out how much each stop needs to cover." />
                    </FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-monthly-stops" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
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
              <p className="text-sm text-muted-foreground mb-3">The cost of consumable supplies you use on each visit.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <FormField control={form.control} name="disinfectantDollars" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Disinfectant ($)" info="Cost of disinfectant spray or solution used per visit to sanitize the yard." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-disinfectant" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="deodorizerDollars" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Deodorizer ($)" info="Cost of deodorizer applied per visit to reduce yard odor." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-deodorizer" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="bagsDollars" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Bags ($)" info="Cost of waste bags used per visit." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-bags" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
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
                <FormField control={form.control} name="targetProfitMarginPct" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Target Profit Margin (%)" info="The percentage of each dollar collected that you want to keep as profit. 30% means for every $100 you charge, $30 is profit after covering all costs." />
                    </FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-target-margin" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="premiumMarginPct" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Premium Margin (%)" info="A higher profit margin used for the 'Premium' price tier. This gives you a ceiling price for customers willing to pay more for premium service." />
                    </FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-premium-margin" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="localMarketAverageWeeklyDollars" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Local Market Avg Weekly ($)" info="What competitors in your area typically charge per week. If set, the calculator will keep recommendations within a reasonable range of this number so you stay competitive. Leave blank to skip this check." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))} data-testid="input-market-avg" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="marketAnchorTolerancePct" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Market Tolerance (%)" info="How far above or below the local market average your recommended price is allowed to go. For example, 35% means your price can be up to 35% higher or lower than the market average." />
                    </FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-market-tolerance" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="clusterDiscountPct" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Cluster Discount (%)" info="A discount applied when a customer is very close to another stop on the route (within about 250 feet). Since you're already in the neighborhood, you can offer a small discount." />
                    </FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-cluster-discount" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="clusterDiscountPct2" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Neighbor Discount (%)" info="A larger discount for customers that are extremely close to another stop (within about 100 feet), like next-door neighbors. Since travel time is almost zero, you can pass more savings along." />
                    </FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-cluster-discount-2" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </form>
    </Form>
  );
}

function CalculatorPanel() {
  const { toast } = useToast();
  const [result, setResult] = useState<CalculatorResult | null>(null);

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
      const payload = {
        ...data,
        currentPriceCents: data.currentPriceDollars !== undefined ? dollarsToCents(data.currentPriceDollars) : undefined,
      };
      const { currentPriceDollars, ...rest } = payload as any;
      const res = await apiRequest("POST", "/api/pricing/calculate", rest);
      return res.json();
    },
    onSuccess: (data: CalculatorResult) => {
      setResult(data);
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
            <form onSubmit={form.handleSubmit((v) => calculateMutation.mutate(v))} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <FormField control={form.control} name="yardSizeAcres" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Yard Size (acres)" info="The size of the yard in acres. 1/10 of an acre (0.1) is a typical small residential yard, about 4,350 sq ft. If you know the square footage, divide by 43,560 to get acres." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-calc-yard-size" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="dogCount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Number of Dogs" info="How many dogs are at this property. More dogs means more waste and more time on each visit." />
                    </FormLabel>
                    <FormControl><Input type="number" min="1" {...field} data-testid="input-calc-dog-count" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="serviceFrequency" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Service Frequency" info="How often the yard gets cleaned. Less frequent visits mean more buildup and longer service times per visit." />
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-calc-frequency"><SelectValue /></SelectTrigger>
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
                )} />
                <FormField control={form.control} name="yardDifficulty" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Yard Difficulty" info="How hard is this yard to service? Flat yards are quickest. Moderate yards have some hills or obstacles. Difficult yards have steep terrain, heavy landscaping, or tricky access." />
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-calc-difficulty"><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="flat">Flat</SelectItem>
                        <SelectItem value="moderate">Moderate</SelectItem>
                        <SelectItem value="difficult">Difficult</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="distanceFromNearestStopMiles" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Distance from Nearest Stop (mi)" info="How far this property is from the closest other stop on the route. Closer stops cost less in travel time and gas. Enter 0 if it's right next to another customer." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-calc-distance" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="currentPriceDollars" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <LabelWithInfo label="Current Price ($, optional)" info="If this customer already has a price, enter it here. The calculator will tell you if that price is profitable or if you're losing money on this stop." />
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))} data-testid="input-calc-current-price" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <Button type="submit" disabled={calculateMutation.isPending} data-testid="button-calculate">
                <Calculator className="mr-1 h-4 w-4" />
                {calculateMutation.isPending ? "Calculating..." : "Calculate Price"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {result && <ResultsDisplay result={result} />}
    </div>
  );
}

function ResultsDisplay({ result }: { result: CalculatorResult }) {
  const { breakdown, derived } = result;

  const totalCost = breakdown.laborCostCents + breakdown.adjustedTravelCostCents + breakdown.equipmentCostCents + breakdown.overheadPerVisitCents;

  const costBreakdownItems = [
    { label: "Labor", value: breakdown.laborCostCents, icon: DollarSign },
    { label: "Travel (adjusted)", value: breakdown.adjustedTravelCostCents, icon: Truck },
    { label: "Supplies", value: breakdown.equipmentCostCents, icon: Wrench },
    { label: "Overhead", value: breakdown.overheadPerVisitCents, icon: Building2 },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-destructive/30">
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground mb-1">Minimum (Break-Even)</p>
            <p className="text-3xl font-bold text-destructive" data-testid="text-price-minimum">{formatDollars(result.minimumPriceCents)}</p>
            <p className="text-xs text-muted-foreground mt-1">per visit</p>
          </CardContent>
        </Card>
        <Card className="border-primary/50 ring-2 ring-primary/20">
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground mb-1">Recommended</p>
            <p className="text-3xl font-bold text-primary" data-testid="text-price-recommended">{formatDollars(result.recommendedPriceCents)}</p>
            <p className="text-xs text-muted-foreground mt-1">per visit</p>
          </CardContent>
        </Card>
        <Card className="border-chart-4/30">
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground mb-1">Premium</p>
            <p className="text-3xl font-bold" style={{ color: "hsl(var(--chart-4))" }} data-testid="text-price-premium">{formatDollars(result.premiumPriceCents)}</p>
            <p className="text-xs text-muted-foreground mt-1">per visit</p>
          </CardContent>
        </Card>
      </div>

      {(derived.clusterDiscountAppliedPct > 0 || derived.marketAnchorClamped || breakdown.densityMultiplier !== 1.0) && (
        <div className="flex flex-wrap gap-2" data-testid="badges-adjustments">
          {derived.clusterDiscountAppliedPct > 0 && (
            <Badge variant="secondary" className="no-default-active-elevate" data-testid="badge-cluster-discount">
              Cluster Discount: {derived.clusterDiscountAppliedPct}%
            </Badge>
          )}
          {derived.marketAnchorClamped && (
            <Badge variant="secondary" className="no-default-active-elevate" data-testid="badge-market-clamped">
              Market Anchor Clamped
            </Badge>
          )}
          {breakdown.densityMultiplier !== 1.0 && (
            <Badge variant="secondary" className="no-default-active-elevate" data-testid="badge-density">
              Density: {breakdown.densityMultiplier.toFixed(2)}x
            </Badge>
          )}
          {derived.isEstimated && (
            <Badge variant="outline" className="no-default-active-elevate" data-testid="badge-estimated">
              Estimated (no route data)
            </Badge>
          )}
        </div>
      )}

      {result.profitWarning && result.profitWarning.lossPerVisitCents > 0 && (
        <Alert variant="destructive" data-testid="alert-profit-warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Losing Money</AlertTitle>
          <AlertDescription>
            You are losing approximately {formatDollars(result.profitWarning.lossPerVisitCents)} on every visit at the current price. Your hourly rate at this price: {formatDollars(result.profitWarning.profitPerHourCents)}/hr.
          </AlertDescription>
        </Alert>
      )}

      {result.profitWarning && result.profitWarning.lossPerVisitCents === 0 && (
        <Alert data-testid="alert-profit-info">
          <TrendingUp className="h-4 w-4" />
          <AlertTitle>Profitable</AlertTitle>
          <AlertDescription>
            Earning {formatDollars(result.profitWarning.profitPerVisitCents)} profit per visit ({formatDollars(result.profitWarning.profitPerHourCents)}/hr).
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost Breakdown per Visit</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {costBreakdownItems.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <item.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{item.label}</span>
                </div>
                <span className="text-sm font-medium" data-testid={`text-cost-${item.label.toLowerCase().replace(/[^a-z]/g, "-")}`}>
                  {formatDollars(item.value)}
                </span>
              </div>
            ))}
            <div className="border-t pt-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">Total Cost per Visit</span>
              <span className="text-sm font-bold" data-testid="text-total-cost">{formatDollars(totalCost)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Accordion type="single" collapsible>
        <AccordionItem value="how-calculated">
          <AccordionTrigger data-testid="accordion-how-calculated">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4" />
              How Was This Calculated?
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-medium mb-1">Service Time</p>
                <p className="text-muted-foreground">
                  {formatMinutes(breakdown.serviceMinutes)} on-site (includes adjustments for how often you visit and yard difficulty)
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">Travel Time</p>
                <p className="text-muted-foreground">
                  {formatMinutes(breakdown.travelMinutes)} drive time | Adjusted for route density ({breakdown.densityMultiplier.toFixed(2)}x): {formatMinutes(breakdown.adjustedTravelMinutes)}
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">Total Time per Visit</p>
                <p className="text-muted-foreground">
                  {formatMinutes(derived.jobMinutes)} (service + travel)
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">Labor Cost</p>
                <p className="text-muted-foreground">
                  {formatDollars(breakdown.laborCostCents)} = {formatMinutes(derived.jobMinutes)} of work at the fully loaded hourly rate
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">Travel Cost</p>
                <p className="text-muted-foreground">
                  Vehicle cost: {formatDollars(breakdown.travelCostCents)} | After route density adjustment: {formatDollars(breakdown.adjustedTravelCostCents)}
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">Supplies</p>
                <p className="text-muted-foreground">
                  {formatDollars(breakdown.equipmentCostCents)} (disinfectant + deodorizer + bags)
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">Overhead Share</p>
                <p className="text-muted-foreground">
                  {formatDollars(breakdown.overheadPerVisitCents)} (your monthly expenses divided across all your stops)
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">How Prices Are Set</p>
                <p className="text-muted-foreground">
                  Minimum = your total cost (break-even, no profit). Recommended = cost plus your target profit margin. Premium = cost plus a higher margin for premium-tier pricing.
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">Profit at Recommended Price</p>
                <p className="text-muted-foreground">
                  {formatDollars(derived.profitAtRecommendedCents)} per visit | {formatDollars(derived.profitPerHourAtRecommendedCents)} per hour
                </p>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

export default function PricingCalculator() {
  const { startTutorial, isTutorialCompleted } = useTutorialContext();
  const { data: configData, isLoading: configLoading } = useQuery<PricingConfig>({
    queryKey: ["/api/pricing-config"],
  });

  const effectiveConfig = { ...DEFAULT_PRICING_CONFIG, ...(configData || {}) };

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
          <h1 className="text-2xl font-bold" data-testid="text-pricing-calculator-heading">Price Calculator</h1>
          <p className="text-sm text-muted-foreground">Figure out what to charge for each property based on your real costs</p>
        </div>
        <LearnHowButton
          tutorialId="tutorial_pricing_calculator"
          onStart={startTutorial}
          isCompleted={isTutorialCompleted("tutorial_pricing_calculator")}
        />
      </div>

      <Tabs defaultValue="calculator">
        <TabsList className="flex-wrap">
          <TabsTrigger value="calculator" data-testid="tab-calculator">
            <Calculator className="mr-1 h-4 w-4" />
            Calculator
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">
            <SlidersHorizontal className="mr-1 h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="calculator" className="mt-4">
          <CalculatorPanel />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <TenantSettingsPanel
            config={effectiveConfig}
            onSaved={() => {}}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
