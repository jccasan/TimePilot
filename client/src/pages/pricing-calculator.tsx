import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
} from "lucide-react";

const pricingConfigSchema = z.object({
  techHourlyWageCents: z.coerce.number().min(0),
  burdenMultiplier: z.coerce.number().min(1),
  averageGasPriceCentsPerGallon: z.coerce.number().min(0),
  vehicleCostPerMileCents: z.coerce.number().min(0),
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
  advertisingCents: z.coerce.number().min(0),
  payrollProviderCents: z.coerce.number().min(0),
  benefitsCents: z.coerce.number().min(0),
  insuranceCents: z.coerce.number().min(0),
  softwareCents: z.coerce.number().min(0),
  otherOverheadCents: z.coerce.number().min(0),
  disinfectantCents: z.coerce.number().min(0),
  deodorizerCents: z.coerce.number().min(0),
  bagsCents: z.coerce.number().min(0),
  localMarketAverageWeeklyPriceCents: z.coerce.number().nullable(),
  marketAnchorTolerancePct: z.coerce.number().min(0).max(100),
  targetProfitMarginPct: z.coerce.number().min(0).max(100),
  premiumMarginPct: z.coerce.number().min(0).max(100),
  pricingMode: z.enum(["aggressive", "standard", "premium"]),
  clusterDiscountPct: z.coerce.number().min(0).max(100),
  clusterDiscountPct2: z.coerce.number().min(0).max(100),
  estimatedMonthlyStops: z.coerce.number().min(1),
});

const calculatorInputSchema = z.object({
  yardSizeAcres: z.coerce.number().min(0.01),
  dogCount: z.coerce.number().min(1).int(),
  serviceFrequency: z.enum(["weekly", "biweekly", "monthly", "onetime"]),
  yardDifficulty: z.enum(["flat", "moderate", "difficult"]),
  distanceFromNearestStopMiles: z.coerce.number().min(0),
  currentPriceCents: z.coerce.number().min(0).optional(),
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

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatMinutes(mins: number): string {
  return `${mins.toFixed(1)} min`;
}

function TenantSettingsPanel({ config, onSaved }: { config: PricingConfig; onSaved: () => void }) {
  const { toast } = useToast();

  const form = useForm({
    resolver: zodResolver(pricingConfigSchema),
    defaultValues: config,
  });

  const saveMutation = useMutation({
    mutationFn: async (data: PricingConfig) => {
      await apiRequest("PUT", "/api/pricing-config", data);
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
      <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v as PricingConfig))} className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold" data-testid="text-settings-heading">Tenant Pricing Settings</h3>
          <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-settings">
            <Save className="mr-1 h-4 w-4" />
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>

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
                <FormField control={form.control} name="techHourlyWageCents" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tech Hourly Wage (cents)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-tech-wage" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="burdenMultiplier" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Burden Multiplier</FormLabel>
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
                <FormField control={form.control} name="averageGasPriceCentsPerGallon" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gas Price (cents/gallon)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-gas-price" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="vehicleCostPerMileCents" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vehicle Cost (cents/mile)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-vehicle-cost" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="driveSpeedAverageMph" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Average Drive Speed (mph)</FormLabel>
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
                    <FormLabel>Base Time per 1/10 Acre (min)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-base-time" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="extraDogMinutesAfterFirst" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Extra Dog Minutes (after 1st)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-extra-dog-min" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="minimumServiceMinutesFloor" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum Service Minutes</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-min-service-min" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="weeklyMultiplier" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Weekly Multiplier</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-weekly-mult" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="biweeklyMultiplier" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bi-Weekly Multiplier</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-biweekly-mult" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="monthlyMultiplier" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly Multiplier</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-monthly-mult" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="oneTimeMultiplier" render={({ field }) => (
                  <FormItem>
                    <FormLabel>One-Time Multiplier</FormLabel>
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <FormField control={form.control} name="difficultyFlat" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Flat</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-diff-flat" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="difficultyModerate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Moderate</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-diff-moderate" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="difficultyDifficult" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Difficult</FormLabel>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <FormField control={form.control} name="advertisingCents" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Advertising (cents/mo)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-advertising" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="payrollProviderCents" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payroll Provider (cents/mo)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-payroll" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="benefitsCents" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Benefits (cents/mo)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-benefits" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="insuranceCents" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Insurance (cents/mo)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-insurance" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="softwareCents" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Software (cents/mo)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-software" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="otherOverheadCents" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Other Overhead (cents/mo)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-other-overhead" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="estimatedMonthlyStops" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estimated Monthly Stops</FormLabel>
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
                Equipment Per Visit
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <FormField control={form.control} name="disinfectantCents" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Disinfectant (cents)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-disinfectant" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="deodorizerCents" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Deodorizer (cents)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-deodorizer" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="bagsCents" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bags (cents)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-bags" /></FormControl>
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
                    <FormLabel>Target Profit Margin (%)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-target-margin" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="premiumMarginPct" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Premium Margin (%)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-premium-margin" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="localMarketAverageWeeklyPriceCents" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Local Market Avg Weekly (cents)</FormLabel>
                    <FormControl><Input type="number" {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))} data-testid="input-market-avg" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="marketAnchorTolerancePct" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Market Anchor Tolerance (%)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-market-tolerance" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="clusterDiscountPct" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cluster Discount (%)</FormLabel>
                    <FormControl><Input type="number" {...field} data-testid="input-cluster-discount" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="clusterDiscountPct2" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cluster Discount Tier 2 (%)</FormLabel>
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
      currentPriceCents: undefined,
    },
  });

  const calculateMutation = useMutation({
    mutationFn: async (data: CalculatorInputValues) => {
      const res = await apiRequest("POST", "/api/pricing/calculate", data);
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
                    <FormLabel>Yard Size (acres)</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-calc-yard-size" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="dogCount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Number of Dogs</FormLabel>
                    <FormControl><Input type="number" min="1" {...field} data-testid="input-calc-dog-count" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="serviceFrequency" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service Frequency</FormLabel>
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
                    <FormLabel>Yard Difficulty</FormLabel>
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
                    <FormLabel>Distance from Nearest Stop (mi)</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-calc-distance" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="currentPriceCents" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Price (cents, optional)</FormLabel>
                    <FormControl><Input type="number" {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))} data-testid="input-calc-current-price" /></FormControl>
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
    { label: "Equipment", value: breakdown.equipmentCostCents, icon: Wrench },
    { label: "Overhead", value: breakdown.overheadPerVisitCents, icon: Building2 },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-destructive/30">
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground mb-1">Minimum (Break-Even)</p>
            <p className="text-3xl font-bold text-destructive" data-testid="text-price-minimum">{formatCents(result.minimumPriceCents)}</p>
            <p className="text-xs text-muted-foreground mt-1">per visit</p>
          </CardContent>
        </Card>
        <Card className="border-primary/50 ring-2 ring-primary/20">
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground mb-1">Recommended</p>
            <p className="text-3xl font-bold text-primary" data-testid="text-price-recommended">{formatCents(result.recommendedPriceCents)}</p>
            <p className="text-xs text-muted-foreground mt-1">per visit</p>
          </CardContent>
        </Card>
        <Card className="border-chart-4/30">
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground mb-1">Premium</p>
            <p className="text-3xl font-bold" style={{ color: "hsl(var(--chart-4))" }} data-testid="text-price-premium">{formatCents(result.premiumPriceCents)}</p>
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
          <AlertTitle>Profit Warning</AlertTitle>
          <AlertDescription>
            {result.profitWarning.message} ({formatCents(result.profitWarning.profitPerHourCents)}/hr)
          </AlertDescription>
        </Alert>
      )}

      {result.profitWarning && result.profitWarning.lossPerVisitCents === 0 && (
        <Alert data-testid="alert-profit-info">
          <TrendingUp className="h-4 w-4" />
          <AlertTitle>Profit Info</AlertTitle>
          <AlertDescription>
            {result.profitWarning.message} ({formatCents(result.profitWarning.profitPerHourCents)}/hr)
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost Breakdown</CardTitle>
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
                  {formatCents(item.value)}
                </span>
              </div>
            ))}
            <div className="border-t pt-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">Total Cost per Visit</span>
              <span className="text-sm font-bold" data-testid="text-total-cost">{formatCents(totalCost)}</span>
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
                  Base service time: {formatMinutes(breakdown.serviceMinutes)} (includes frequency and difficulty multipliers)
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">Travel Time</p>
                <p className="text-muted-foreground">
                  Raw travel: {formatMinutes(breakdown.travelMinutes)} | Adjusted (density {breakdown.densityMultiplier.toFixed(2)}x): {formatMinutes(breakdown.adjustedTravelMinutes)}
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">Total Job Time</p>
                <p className="text-muted-foreground">
                  {formatMinutes(derived.jobMinutes)} (service + adjusted travel)
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">Labor Cost</p>
                <p className="text-muted-foreground">
                  {formatCents(breakdown.laborCostCents)} = ({formatMinutes(derived.jobMinutes)} / 60) x fully burdened hourly rate
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">Travel Cost</p>
                <p className="text-muted-foreground">
                  Raw: {formatCents(breakdown.travelCostCents)} | Adjusted: {formatCents(breakdown.adjustedTravelCostCents)}
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">Equipment</p>
                <p className="text-muted-foreground">
                  {formatCents(breakdown.equipmentCostCents)} (disinfectant + deodorizer + bags)
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">Overhead</p>
                <p className="text-muted-foreground">
                  {formatCents(breakdown.overheadPerVisitCents)} (monthly overhead / estimated monthly stops)
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">Pricing Formula</p>
                <p className="text-muted-foreground">
                  Minimum = Total Cost | Recommended = Cost / (1 - margin%) | Premium = Cost / (1 - premium%)
                </p>
              </div>
              <div>
                <p className="font-medium mb-1">Profit at Recommended</p>
                <p className="text-muted-foreground">
                  {formatCents(derived.profitAtRecommendedCents)}/visit | {formatCents(derived.profitPerHourAtRecommendedCents)}/hr
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
  const { data: configData, isLoading: configLoading } = useQuery<PricingConfig>({
    queryKey: ["/api/pricing-config"],
  });

  const effectiveConfig = configData || DEFAULT_PRICING_CONFIG;

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
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-pricing-calculator-heading">Price Calculator</h1>
        <p className="text-sm text-muted-foreground">Configure cost inputs and calculate recommended pricing per property</p>
      </div>

      <Tabs defaultValue="calculator">
        <TabsList className="flex-wrap">
          <TabsTrigger value="calculator" data-testid="tab-calculator">
            <Calculator className="mr-1 h-4 w-4" />
            Calculator
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">
            <SlidersHorizontal className="mr-1 h-4 w-4" />
            Tenant Settings
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
