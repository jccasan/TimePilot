import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/use-currency";
import { useAddressLabels } from "@/hooks/use-address-labels";
import type { PricingConfig, PricingRulesConfig } from "@shared/schema";
import { DEFAULT_PRICING_CONFIG, DEFAULT_PRICING_RULES } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DollarSign,
  Calculator,
  Save,
  TrendingUp,
  Clock,
  Truck,
  Target,
  HelpCircle,
  Zap,
  Shield,
  Crown,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Lock,
  Route,
  Package,
  RefreshCw,
  Info,
  Pencil,
  Check,
  X as XIcon,
  Percent,
} from "lucide-react";
import AIPricingOptimizer from "@/pages/ai-pricing-optimizer";

// ─── Types ────────────────────────────────────────────────────────────────────

type OverheadCostItem = {
  id: string;
  companyId: string;
  category: string;
  name: string;
  monthlyCostCents: number;
  type: "fixed" | "variable";
  isDefault: boolean;
  sortOrder: number;
  costDriverType: "pct_revenue" | "per_stop" | null;
  driverRate: string | null;
};

type OverheadData = {
  items: OverheadCostItem[];
  totalMonthlyOverheadCents: number;
  trailingMonthlyStops: number;
  trailingMonthlyRevenueCents: number;
  dataSource: "trailing_90d" | "estimated";
};

type MonthlyFuelData = {
  totalMiles: number;
  weeklyMiles: number;
  fuelCostCents: number;
  routeCount: number;
};

type PricingConfigResponse = PricingConfig & { pricingRules?: PricingRulesConfig };

type FreqMultKey =
  | "weeklyMultiplier"
  | "biweeklyMultiplier"
  | "monthlyMultiplier"
  | "oneTimeMultiplier";

// ─── Tab routing via URL search params ───────────────────────────────────────

function readTabFromUrl(): string {
  if (typeof window === "undefined") return "pricing";
  const params = new URLSearchParams(window.location.search);
  const t = params.get("tab");
  if (t === "engine" || t === "simulator" || t === "costs" || t === "pricing") return t;
  return "pricing";
}

function writeTabToUrl(tab: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  window.history.replaceState(null, "", url.toString());
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dollarsToCents(dollars: number | string): number {
  const val = typeof dollars === "string" ? parseFloat(dollars) : dollars;
  if (isNaN(val)) return 0;
  return Math.round(val * 100);
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function getFreqMultiplier(config: PricingConfig, key: FreqMultKey): number {
  return config[key] ?? 1;
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

// ─── Overhead Ledger ──────────────────────────────────────────────────────────

const CATEGORY_ORDER = [
  "Office + Admin",
  "Marketing",
  "Vehicles + Transportation",
  "Tools + Field Supplies",
  "Labor",
  "Operations",
  "Financial Overhead",
];

function formulaLabel(item: OverheadCostItem): string {
  if (!item.costDriverType || !item.driverRate) return "";
  const rate = Number(item.driverRate);
  if (item.costDriverType === "pct_revenue") return `${rate}% of rev`;
  if (item.costDriverType === "per_stop") return `$${rate.toFixed(2)}/stop`;
  return "";
}

function CostItemRow({
  item,
  onUpdateCost,
  onDelete,
  onEditFormula,
  isPending,
  isAutoCalculated,
  autoFuelMiles,
}: {
  item: OverheadCostItem;
  onUpdateCost: (id: string, cents: number) => void;
  onDelete: (id: string) => void;
  onEditFormula: (item: OverheadCostItem) => void;
  isPending: boolean;
  isAutoCalculated?: boolean;
  autoFuelMiles?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSavedCents = useRef(item.monthlyCostCents);

  const isFormulaMode =
    item.type === "variable" && item.costDriverType !== null && item.costDriverType !== undefined;

  useEffect(() => {
    if (!isFormulaMode && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.value = (item.monthlyCostCents / 100).toFixed(2);
      lastSavedCents.current = item.monthlyCostCents;
    }
  }, [item.monthlyCostCents, isFormulaMode]);

  const handleBlur = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const parsed = parseFloat(el.value);
    if (!isNaN(parsed) && parsed >= 0) {
      const cents = Math.round(parsed * 100);
      if (cents !== lastSavedCents.current) {
        lastSavedCents.current = cents;
        onUpdateCost(item.id, cents);
      }
    } else {
      el.value = (lastSavedCents.current / 100).toFixed(2);
    }
  }, [item.id, onUpdateCost]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      const el = inputRef.current;
      if (el) el.value = (lastSavedCents.current / 100).toFixed(2);
      (e.target as HTMLInputElement).blur();
    }
  }, []);

  const isScoopilotSub = item.name === "ScooPilot subscription" && item.isDefault;

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors group"
      data-testid={`cost-item-${item.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm truncate" data-testid={`text-item-name-${item.id}`}>
            {isAutoCalculated ? "Fuel (from routes)" : item.name}
          </span>
          {isScoopilotSub && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
          {isAutoCalculated && <Route className="h-3 w-3 text-primary shrink-0" />}
          <Badge
            variant="outline"
            className={`text-[10px] px-1 py-0 shrink-0 ${
              item.type === "fixed"
                ? "border-blue-200 text-blue-600 dark:border-blue-800 dark:text-blue-400"
                : "border-amber-200 text-amber-600 dark:border-amber-800 dark:text-amber-400"
            }`}
          >
            {item.type}
          </Badge>
          {isFormulaMode && (
            <Badge
              variant="outline"
              className="text-[10px] px-1 py-0 shrink-0 border-violet-200 text-violet-600 dark:border-violet-800 dark:text-violet-400 font-mono"
              data-testid={`badge-formula-${item.id}`}
            >
              {formulaLabel(item)}
            </Badge>
          )}
        </div>
        {isAutoCalculated && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {autoFuelMiles != null && autoFuelMiles > 0
              ? `${autoFuelMiles.toFixed(1)} mi this month · auto-calculated`
              : "No routes this month · auto-calculated"}
          </p>
        )}
        {isFormulaMode && (
          <p
            className="text-[10px] text-muted-foreground mt-0.5"
            data-testid={`text-formula-source-${item.id}`}
          >
            {item.costDriverType === "pct_revenue" ? "% of revenue" : "per stop"} · based on last 90
            days
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {isFormulaMode ? (
          <>
            <span
              className="text-sm font-medium tabular-nums text-violet-600 dark:text-violet-400"
              data-testid={`text-formula-cost-${item.id}`}
            >
              ~{formatDollars(item.monthlyCostCents)}/mo
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              onClick={() => onEditFormula(item)}
              disabled={isPending}
              data-testid={`button-edit-formula-${item.id}`}
              title="Edit formula"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <>
            {item.type === "variable" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[10px] gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-violet-500 hover:text-violet-700 hover:bg-violet-50 dark:hover:bg-violet-950"
                onClick={() => onEditFormula(item)}
                disabled={isPending}
                data-testid={`button-add-formula-${item.id}`}
                title="Add formula"
              >
                <Percent className="h-2.5 w-2.5" />
                formula
              </Button>
            )}
            <span className="text-xs text-muted-foreground">$</span>
            <input
              ref={inputRef}
              type="number"
              min="0"
              step="0.01"
              defaultValue={(item.monthlyCostCents / 100).toFixed(2)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              disabled={isPending || isAutoCalculated}
              readOnly={isAutoCalculated}
              className={`w-24 h-7 text-sm text-right tabular-nums rounded-md border border-input px-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${isAutoCalculated ? "bg-muted/50 text-muted-foreground cursor-default" : "bg-background"}`}
              data-testid={`input-cost-${item.id}`}
            />
            <span className="text-xs text-muted-foreground">/mo</span>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(item.id)}
          disabled={isPending}
          data-testid={`button-delete-${item.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function CategorySection({
  category,
  items,
  onUpdateCost,
  onDelete,
  onAdd,
  onEditFormula,
  isPending,
  autoFuelMiles,
}: {
  category: string;
  items: OverheadCostItem[];
  onUpdateCost: (id: string, cents: number) => void;
  onDelete: (id: string) => void;
  onAdd: (category: string) => void;
  onEditFormula: (item: OverheadCostItem) => void;
  isPending: boolean;
  autoFuelMiles?: number;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const categoryTotal = items.reduce((s, i) => s + i.monthlyCostCents, 0);
  const fixedCount = items.filter((i) => i.type === "fixed").length;
  const variableCount = items.filter((i) => i.type === "variable").length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className="border rounded-lg overflow-hidden"
        data-testid={`category-section-${category}`}
      >
        <CollapsibleTrigger asChild>
          <button
            className="w-full flex items-center justify-between p-3 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
            data-testid={`button-toggle-category-${category}`}
          >
            <div className="flex items-center gap-2">
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="font-medium text-sm">{category}</span>
              <span className="text-xs text-muted-foreground">({items.length} items)</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                {fixedCount > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {fixedCount} fixed
                  </Badge>
                )}
                {variableCount > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {variableCount} variable
                  </Badge>
                )}
              </div>
              <span
                className={`text-sm font-semibold tabular-nums ${categoryTotal > 0 ? "text-foreground" : "text-muted-foreground"}`}
                data-testid={`text-category-total-${category}`}
              >
                {formatDollars(categoryTotal)}/mo
              </span>
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="divide-y">
            {items.map((item) => {
              const isAutoFuel =
                item.name === "Fuel" &&
                item.category === "Vehicles + Transportation" &&
                item.isDefault;
              return (
                <CostItemRow
                  key={item.id}
                  item={item}
                  onUpdateCost={onUpdateCost}
                  onDelete={onDelete}
                  onEditFormula={onEditFormula}
                  isPending={isPending}
                  isAutoCalculated={isAutoFuel}
                  autoFuelMiles={isAutoFuel ? autoFuelMiles : undefined}
                />
              );
            })}
          </div>
          <div className="p-2 border-t bg-muted/20">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 w-full"
              onClick={() => onAdd(category)}
              data-testid={`button-add-item-${category}`}
            >
              <Plus className="h-3 w-3" />
              Add item
            </Button>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ─── Labor & Settings form ────────────────────────────────────────────────────

const laborSettingsSchema = z.object({
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
  clusterDiscountPct: z.coerce.number().min(0).max(100),
  clusterDiscountPct2: z.coerce.number().min(0).max(100),
  estimatedMonthlyStops: z.coerce.number().min(1),
  standardTravelMinutesPerStop: z.coerce.number().min(0).max(30),
  disinfectantDollars: z.coerce.number().min(0),
  bagsDollars: z.coerce.number().min(0),
  targetProfitMarginPct: z.coerce.number().min(0).max(100),
  premiumMarginPct: z.coerce.number().min(0).max(100),
  pricingMode: z.enum(["aggressive", "standard", "premium"]),
  localMarketAverageWeeklyDollars: z.coerce.number().nullable(),
  marketAnchorTolerancePct: z.coerce.number().min(0).max(100),
});

type LaborFormValues = z.infer<typeof laborSettingsSchema>;

function configToLaborFormValues(config: PricingConfig): LaborFormValues {
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
    clusterDiscountPct: config.clusterDiscountPct,
    clusterDiscountPct2: config.clusterDiscountPct2,
    estimatedMonthlyStops: config.estimatedMonthlyStops,
    standardTravelMinutesPerStop: config.standardTravelMinutesPerStop ?? 3,
    disinfectantDollars: config.disinfectantCents / 100,
    bagsDollars: config.bagsCents / 100,
    targetProfitMarginPct: config.targetProfitMarginPct,
    premiumMarginPct: config.premiumMarginPct,
    pricingMode: config.pricingMode,
    localMarketAverageWeeklyDollars: config.localMarketAverageWeeklyPriceCents
      ? config.localMarketAverageWeeklyPriceCents / 100
      : null,
    marketAnchorTolerancePct: config.marketAnchorTolerancePct,
  };
}

function laborFormValuesToApiPayload(
  values: LaborFormValues,
  existingConfig: PricingConfig
): Partial<PricingConfig> {
  return {
    techHourlyWageCents: dollarsToCents(values.techHourlyWageDollars),
    burdenMultiplier: values.burdenMultiplier,
    averageGasPriceCentsPerGallon: dollarsToCents(values.averageGasPricePerGallon),
    vehicleCostPerMileCents: dollarsToCents(values.vehicleCostPerMile),
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
    clusterDiscountPct: values.clusterDiscountPct,
    clusterDiscountPct2: values.clusterDiscountPct2,
    estimatedMonthlyStops: values.estimatedMonthlyStops,
    standardTravelMinutesPerStop: values.standardTravelMinutesPerStop,
    disinfectantCents: dollarsToCents(values.disinfectantDollars),
    bagsCents: dollarsToCents(values.bagsDollars),
    targetProfitMarginPct: values.targetProfitMarginPct,
    premiumMarginPct: values.premiumMarginPct,
    pricingMode: values.pricingMode,
    localMarketAverageWeeklyPriceCents: values.localMarketAverageWeeklyDollars
      ? dollarsToCents(values.localMarketAverageWeeklyDollars)
      : null,
    marketAnchorTolerancePct: values.marketAnchorTolerancePct,
    vehicleMPG: existingConfig.vehicleMPG,
    deodorizerCents: existingConfig.deodorizerCents,
    advertisingCents: existingConfig.advertisingCents,
    payrollProviderCents: existingConfig.payrollProviderCents,
    benefitsCents: existingConfig.benefitsCents,
    insuranceCents: existingConfig.insuranceCents,
    softwareCents: existingConfig.softwareCents,
    otherOverheadCents: existingConfig.otherOverheadCents,
  };
}

function LaborSettingsPanel({ config, onSaved }: { config: PricingConfig; onSaved: () => void }) {
  const { toast } = useToast();
  const { country } = useAddressLabels();
  const isCanada = country === "ca";
  const gasLabel = isCanada ? "Gas Price (CA$/litre)" : "Gas Price ($/gallon)";
  const vehicleLabel = isCanada ? "Vehicle Cost (CA$/km)" : "Vehicle Cost ($/mile)";
  const vehicleInfo = isCanada
    ? "The total cost to operate your vehicle per km, including gas, maintenance, insurance, and depreciation."
    : "The total cost to operate your vehicle per mile. The IRS standard rate is around $0.67/mile.";

  const form = useForm<LaborFormValues>({
    resolver: zodResolver(laborSettingsSchema),
    defaultValues: configToLaborFormValues(config),
  });

  const saveMutation = useMutation({
    mutationFn: async (data: LaborFormValues) => {
      const payload = laborFormValuesToApiPayload(data, config);
      await apiRequest("PUT", "/api/pricing-config", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: "Settings saved", description: "Pricing configuration updated." });
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
      <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">Labor & Vehicle Settings</h3>
            <p className="text-xs text-muted-foreground">
              These parameters feed into the Pricing Engine calculations.
            </p>
          </div>
          <Button
            type="submit"
            disabled={saveMutation.isPending}
            size="sm"
            data-testid="button-save-labor-settings"
          >
            <Save className="mr-1 h-4 w-4" />
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>

        <div>
          <p className="text-sm text-muted-foreground mb-2">
            Pricing strategy sets the default profit margin used in the Pricing Engine tab.
          </p>
          <div className="flex flex-wrap gap-2" data-testid="pricing-mode-toggle">
            <Button
              type="button"
              size="sm"
              variant={form.watch("pricingMode") === "aggressive" ? "default" : "outline"}
              onClick={() => handleModePreset("aggressive")}
              data-testid="button-mode-aggressive"
            >
              <Zap className="mr-1 h-4 w-4" />
              Aggressive (20%)
            </Button>
            <Button
              type="button"
              size="sm"
              variant={form.watch("pricingMode") === "standard" ? "default" : "outline"}
              onClick={() => handleModePreset("standard")}
              data-testid="button-mode-standard"
            >
              <Shield className="mr-1 h-4 w-4" />
              Standard (30%)
            </Button>
            <Button
              type="button"
              size="sm"
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
          defaultValue={["labor", "travel", "time", "difficulty", "supplies", "routing"]}
        >
          <AccordionItem value="labor">
            <AccordionTrigger data-testid="accordion-labor-costs">
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
                          info="The hourly pay rate for your technicians before taxes and benefits."
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
                          info="Multiplier to account for payroll taxes, workers comp, etc. Typical value is 1.3–1.5."
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
                      <FormLabel>{gasLabel}</FormLabel>
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
                          info="Average speed between stops, including residential streets. Usually 20–35 mph."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-drive-speed" />
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
                          info="The target drive time per stop for pricing purposes. 3 minutes represents a dense route."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.5"
                          {...field}
                          data-testid="input-standard-travel"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="time">
            <AccordionTrigger data-testid="accordion-time">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Time & Frequency Multipliers
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
                          info="Minutes to service one-tenth of an acre. Typical value is 8–12 minutes."
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
                          info="Extra time added for each dog beyond the first."
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
                          info="Shortest a visit can be, even for a tiny yard."
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
                          info="Time multiplier for weekly visits. Usually 1.0."
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
                          info="Time multiplier for bi-weekly visits. More buildup. Typical 1.2–1.4."
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
                          info="Time multiplier for monthly visits. A full month of buildup. Typical 1.6–2.0."
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
                          info="Time multiplier for one-time cleanups."
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
                <FormField
                  control={form.control}
                  name="estimatedMonthlyStops"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Estimated Monthly Stops"
                          info="Total service stops per month. Used to spread overhead across all stops."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-monthly-stops" />
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
                Yard Difficulty Multipliers
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <p className="text-sm text-muted-foreground mb-3">
                Multipliers adjust service time based on yard difficulty. 1.0 = no change.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <FormField
                  control={form.control}
                  name="difficultyFlat"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Flat Yard</FormLabel>
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
                      <FormLabel>Moderate Yard</FormLabel>
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
                      <FormLabel>Difficult Yard</FormLabel>
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

          <AccordionItem value="supplies">
            <AccordionTrigger data-testid="accordion-supplies">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                Supplies Per Visit
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <FormField
                  control={form.control}
                  name="disinfectantDollars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Disinfectant/Deodorizer ($/stop)"
                          info="Base cost per stop. Add-on active yards charge $7.00/acre additionally."
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
                          info="Cost per waste bag. Used 1 per 2 dogs, rounded up."
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

          <AccordionItem value="routing">
            <AccordionTrigger data-testid="accordion-routing">
              <div className="flex items-center gap-2">
                <Route className="h-4 w-4" />
                Route Density Discounts
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <FormField
                  control={form.control}
                  name="clusterDiscountPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <LabelWithInfo
                          label="Cluster Discount (%)"
                          info="Discount for customers very close to another stop (~250 ft)."
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
                          info="Larger discount for next-door neighbor stops (~100 ft)."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-neighbor-discount" />
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
                          info="What competitors typically charge per week. Leave blank to skip market anchoring."
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
                          info="How far above/below market average is allowed."
                        />
                      </FormLabel>
                      <FormControl>
                        <Input type="number" {...field} data-testid="input-market-tolerance" />
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

// ─── Costs tab ────────────────────────────────────────────────────────────────

function CostsTab() {
  const { toast } = useToast();
  const [addingCategory, setAddingCategory] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [newItemType, setNewItemType] = useState<"fixed" | "variable">("fixed");
  const [newItemDriverType, setNewItemDriverType] = useState<"pct_revenue" | "per_stop">(
    "pct_revenue"
  );
  const [newItemDriverRate, setNewItemDriverRate] = useState("");

  const [editingFormulaItem, setEditingFormulaItem] = useState<OverheadCostItem | null>(null);
  const [formulaDriverType, setFormulaDriverType] = useState<"pct_revenue" | "per_stop">(
    "pct_revenue"
  );
  const [formulaDriverRate, setFormulaDriverRate] = useState("");

  const { data, isLoading } = useQuery<OverheadData>({ queryKey: ["/api/overhead-costs"] });
  const { data: pricingConfigData, isLoading: configLoading } = useQuery<PricingConfigResponse>({
    queryKey: ["/api/pricing-config"],
  });
  const { data: monthlyFuelData, isSuccess: fuelQuerySuccess } = useQuery<MonthlyFuelData>({
    queryKey: ["/api/overhead-costs/monthly-fuel"],
  });
  const { data: activePlans } = useQuery<
    { frequency: string; isActive: boolean; isStopOnly: boolean }[]
  >({
    queryKey: ["/api/service-plans", { isActive: true }],
    queryFn: () =>
      fetch("/api/service-plans?isActive=true", { credentials: "include" }).then((r) => r.json()),
  });
  const { data: companyData } = useQuery<{ pricingConfig?: { estimatedMonthlyStops?: number } }>({
    queryKey: ["/api/company"],
  });

  const seedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/overhead-costs/seed-defaults"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead-costs"] });
    },
  });

  useEffect(() => {
    if (data && data.items.length === 0 && !seedMutation.isPending) {
      seedMutation.mutate();
    }
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: ({ id, monthlyCostCents }: { id: string; monthlyCostCents: number }) =>
      apiRequest("PATCH", `/api/overhead-costs/${id}`, { monthlyCostCents }),
    onMutate: async ({ id, monthlyCostCents }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/overhead-costs"] });
      const previous = queryClient.getQueryData<OverheadData>(["/api/overhead-costs"]);
      if (previous) {
        const updatedItems = previous.items.map((i) =>
          i.id === id ? { ...i, monthlyCostCents } : i
        );
        queryClient.setQueryData<OverheadData>(["/api/overhead-costs"], {
          ...previous,
          items: updatedItems,
          totalMonthlyOverheadCents: updatedItems.reduce((s, i) => s + i.monthlyCostCents, 0),
        });
      }
      return { previous };
    },
    onError: (_err: Error, _vars: unknown, context: { previous?: OverheadData } | undefined) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/overhead-costs"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead-costs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overhead-costs/total"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/overhead-costs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead-costs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overhead-costs/total"] });
      toast({ title: "Item removed" });
    },
  });

  const createMutation = useMutation({
    mutationFn: (d: {
      category: string;
      name: string;
      type: "fixed" | "variable";
      costDriverType?: "pct_revenue" | "per_stop";
      driverRate?: number;
    }) => apiRequest("POST", "/api/overhead-costs", d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead-costs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overhead-costs/total"] });
      setAddingCategory(null);
      setNewItemName("");
      setNewItemType("fixed");
      setNewItemDriverType("pct_revenue");
      setNewItemDriverRate("");
      toast({ title: "Item added" });
    },
  });

  const updateFormulaMutation = useMutation({
    mutationFn: ({
      id,
      costDriverType,
      driverRate,
    }: {
      id: string;
      costDriverType: "pct_revenue" | "per_stop" | null;
      driverRate: number | null;
    }) => apiRequest("PATCH", `/api/overhead-costs/${id}`, { costDriverType, driverRate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead-costs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overhead-costs/total"] });
      setEditingFormulaItem(null);
      setFormulaDriverRate("");
    },
    onError: () => {
      toast({ title: "Failed to save formula", variant: "destructive" });
    },
  });

  const handleEditFormula = (item: OverheadCostItem) => {
    setEditingFormulaItem(item);
    setFormulaDriverType(item.costDriverType ?? "pct_revenue");
    setFormulaDriverRate(item.driverRate ? String(Number(item.driverRate)) : "");
  };

  const autoFuelCostCents = monthlyFuelData?.fuelCostCents ?? 0;

  useEffect(() => {
    if (!fuelQuerySuccess) return;
    if (!data || data.items.length === 0) return;
    const fuelItem = data.items.find(
      (i) => i.name === "Fuel" && i.category === "Vehicles + Transportation" && i.isDefault
    );
    if (!fuelItem) return;
    if (fuelItem.monthlyCostCents !== autoFuelCostCents) {
      updateMutation.mutate({ id: fuelItem.id, monthlyCostCents: autoFuelCostCents });
    }
  }, [autoFuelCostCents, fuelQuerySuccess, data?.items?.length]);

  const categorizedItems = useMemo(() => {
    const items = data?.items ?? [];
    const map = new Map<string, OverheadCostItem[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const item of items) {
      const existing = map.get(item.category);
      if (existing) existing.push(item);
      else map.set(item.category, [item]);
    }
    return map;
  }, [data?.items]);

  const items = data?.items ?? [];
  const totalMonthly = items.reduce((s, i) => s + i.monthlyCostCents, 0);
  const fixedTotal = items
    .filter((i) => i.type === "fixed")
    .reduce((s, i) => s + i.monthlyCostCents, 0);
  const variableTotal = items
    .filter((i) => i.type === "variable")
    .reduce((s, i) => s + i.monthlyCostCents, 0);

  const freqVisitsPerMonth = (freq: string) => {
    if (freq === "weekly") return 4.33;
    if (freq === "biweekly") return 2.17;
    if (freq === "monthly") return 1;
    return 0;
  };
  const actualMonthlyVisits =
    activePlans && activePlans.length > 0
      ? Math.round(
          activePlans
            .filter((p) => p.isActive && !p.isStopOnly)
            .reduce((sum, p) => sum + freqVisitsPerMonth(p.frequency), 0)
        )
      : (companyData?.pricingConfig?.estimatedMonthlyStops ?? 100);

  const overheadPerVisit = actualMonthlyVisits > 0 ? totalMonthly / actualMonthlyVisits : 0;

  const config: PricingConfig = pricingConfigData
    ? { ...DEFAULT_PRICING_CONFIG, ...pricingConfigData }
    : DEFAULT_PRICING_CONFIG;

  if (isLoading || seedMutation.isPending || configLoading) {
    return (
      <div className="space-y-4" data-testid="loading-costs-tab">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="costs-tab">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Monthly</span>
            </div>
            <p className="text-xl font-bold tabular-nums" data-testid="text-total-monthly">
              {formatDollars(totalMonthly)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Calculator className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Per Visit</span>
            </div>
            <p className="text-xl font-bold tabular-nums" data-testid="text-per-visit">
              {formatDollars(Math.round(overheadPerVisit))}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Based on {actualMonthlyVisits} visits/mo
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Lock className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-xs text-muted-foreground">Fixed</span>
            </div>
            <p
              className="text-xl font-bold tabular-nums text-blue-600 dark:text-blue-400"
              data-testid="text-fixed-total"
            >
              {formatDollars(fixedTotal)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs text-muted-foreground">Variable</span>
            </div>
            <p
              className="text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400"
              data-testid="text-variable-total"
            >
              {formatDollars(variableTotal)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h3 className="text-base font-semibold mb-3">Monthly Overhead Ledger</h3>
        <div className="space-y-3">
          {Array.from(categorizedItems.entries()).map(([category, catItems]) => {
            if (catItems.length === 0 && !CATEGORY_ORDER.includes(category)) return null;
            return (
              <CategorySection
                key={category}
                category={category}
                items={catItems}
                onUpdateCost={(id, cents) => updateMutation.mutate({ id, monthlyCostCents: cents })}
                onDelete={(id) => deleteMutation.mutate(id)}
                onAdd={(cat) => {
                  setAddingCategory(cat);
                  setNewItemName("");
                  setNewItemType("fixed");
                  setNewItemDriverType("pct_revenue");
                  setNewItemDriverRate("");
                }}
                onEditFormula={handleEditFormula}
                isPending={updateMutation.isPending || deleteMutation.isPending}
                autoFuelMiles={
                  category === "Vehicles + Transportation"
                    ? (monthlyFuelData?.totalMiles ?? 0)
                    : undefined
                }
              />
            );
          })}
        </div>
      </div>

      {addingCategory && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          data-testid="modal-add-item"
        >
          <Card className="w-full max-w-sm mx-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Add item to {addingCategory}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Item name"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape") setAddingCategory(null);
                }}
                data-testid="input-new-item-name"
              />
              <Select
                value={newItemType}
                onValueChange={(v) => {
                  setNewItemType(v as "fixed" | "variable");
                  setNewItemDriverType("pct_revenue");
                  setNewItemDriverRate("");
                }}
              >
                <SelectTrigger className="h-9" data-testid="select-new-item-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed cost</SelectItem>
                  <SelectItem value="variable">Variable cost</SelectItem>
                </SelectContent>
              </Select>
              {newItemType === "variable" && (
                <div className="rounded-md border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 p-3 space-y-2">
                  <p className="text-xs font-medium text-violet-700 dark:text-violet-300 flex items-center gap-1">
                    <Percent className="h-3 w-3" />
                    Cost driver (optional)
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Monthly cost is computed from your last 90 days of activity. Leave blank to
                    enter a manual dollar amount after adding.
                  </p>
                  <div className="flex rounded-md overflow-hidden border border-violet-200 dark:border-violet-800">
                    <button
                      type="button"
                      className={`flex-1 h-8 text-xs font-medium transition-colors ${
                        newItemDriverType === "pct_revenue"
                          ? "bg-violet-600 text-white"
                          : "bg-transparent text-muted-foreground hover:bg-violet-100 dark:hover:bg-violet-900"
                      }`}
                      onClick={() => {
                        setNewItemDriverType("pct_revenue");
                        setNewItemDriverRate("");
                      }}
                      data-testid="button-new-driver-pct-revenue"
                    >
                      % of revenue
                    </button>
                    <button
                      type="button"
                      className={`flex-1 h-8 text-xs font-medium transition-colors ${
                        newItemDriverType === "per_stop"
                          ? "bg-violet-600 text-white"
                          : "bg-transparent text-muted-foreground hover:bg-violet-100 dark:hover:bg-violet-900"
                      }`}
                      onClick={() => {
                        setNewItemDriverType("per_stop");
                        setNewItemDriverRate("");
                      }}
                      data-testid="button-new-driver-per-stop"
                    >
                      per stop
                    </button>
                  </div>
                  <div className="relative">
                    {newItemDriverType === "pct_revenue" ? (
                      <>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          placeholder="e.g. 2.9"
                          value={newItemDriverRate}
                          onChange={(e) => setNewItemDriverRate(e.target.value)}
                          className="h-8 text-sm pr-6"
                          data-testid="input-new-item-driver-rate"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          %
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          $
                        </span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="e.g. 0.30"
                          value={newItemDriverRate}
                          onChange={(e) => setNewItemDriverRate(e.target.value)}
                          className="h-8 text-sm pl-5"
                          data-testid="input-new-item-driver-rate"
                        />
                      </>
                    )}
                  </div>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAddingCategory(null)}
                  data-testid="button-cancel-add"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (!addingCategory || !newItemName.trim()) return;
                    const driverRate = parseFloat(newItemDriverRate);
                    createMutation.mutate({
                      category: addingCategory,
                      name: newItemName.trim(),
                      type: newItemType,
                      ...(newItemType === "variable" && !isNaN(driverRate) && driverRate > 0
                        ? { costDriverType: newItemDriverType, driverRate }
                        : {}),
                    });
                  }}
                  disabled={!newItemName.trim() || createMutation.isPending}
                  data-testid="button-confirm-add"
                >
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {editingFormulaItem && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          data-testid="modal-edit-formula"
        >
          <Card className="w-full max-w-sm mx-4">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Percent className="h-4 w-4 text-violet-500" />
                  Variable cost formula
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setEditingFormulaItem(null)}
                  data-testid="button-close-formula-modal"
                >
                  <XIcon className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{editingFormulaItem.name}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Monthly cost is auto-computed from your{" "}
                <span className="font-medium">last 90 days of activity</span>. New accounts fall
                back to your pricing config estimate.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium block mb-1.5">Driver type</label>
                  <div className="flex rounded-md overflow-hidden border border-input">
                    <button
                      type="button"
                      className={`flex-1 h-9 text-xs font-medium transition-colors ${
                        formulaDriverType === "pct_revenue"
                          ? "bg-violet-600 text-white"
                          : "bg-transparent text-muted-foreground hover:bg-violet-50 dark:hover:bg-violet-950"
                      }`}
                      onClick={() => {
                        setFormulaDriverType("pct_revenue");
                        setFormulaDriverRate("");
                      }}
                      data-testid="button-formula-driver-pct-revenue"
                    >
                      % of revenue
                    </button>
                    <button
                      type="button"
                      className={`flex-1 h-9 text-xs font-medium transition-colors ${
                        formulaDriverType === "per_stop"
                          ? "bg-violet-600 text-white"
                          : "bg-transparent text-muted-foreground hover:bg-violet-50 dark:hover:bg-violet-950"
                      }`}
                      onClick={() => {
                        setFormulaDriverType("per_stop");
                        setFormulaDriverRate("");
                      }}
                      data-testid="button-formula-driver-per-stop"
                    >
                      per stop
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1.5">
                    {formulaDriverType === "pct_revenue" ? "Rate (%)" : "Rate ($ per stop)"}
                  </label>
                  <div className="relative">
                    {formulaDriverType === "pct_revenue" ? (
                      <>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          placeholder="e.g. 2.9"
                          value={formulaDriverRate}
                          onChange={(e) => setFormulaDriverRate(e.target.value)}
                          className="h-9 text-sm pr-6"
                          data-testid="input-formula-driver-rate"
                          autoFocus
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          %
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          $
                        </span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="e.g. 0.30"
                          value={formulaDriverRate}
                          onChange={(e) => setFormulaDriverRate(e.target.value)}
                          className="h-9 text-sm pl-5"
                          data-testid="input-formula-driver-rate"
                          autoFocus
                        />
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground hover:text-destructive px-2"
                  onClick={() => {
                    updateFormulaMutation.mutate({
                      id: editingFormulaItem.id,
                      costDriverType: null,
                      driverRate: null,
                    });
                  }}
                  disabled={updateFormulaMutation.isPending}
                  data-testid="button-clear-formula"
                >
                  Clear driver
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingFormulaItem(null)}
                    data-testid="button-cancel-formula"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1"
                    onClick={() => {
                      const rate = parseFloat(formulaDriverRate);
                      updateFormulaMutation.mutate({
                        id: editingFormulaItem.id,
                        costDriverType: !isNaN(rate) && rate > 0 ? formulaDriverType : null,
                        driverRate: !isNaN(rate) && rate > 0 ? rate : null,
                      });
                    }}
                    disabled={updateFormulaMutation.isPending}
                    data-testid="button-save-formula"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Save
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="border rounded-lg p-4 space-y-4">
        <LaborSettingsPanel
          config={config}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/overhead-costs/total"] });
          }}
        />
      </div>
    </div>
  );
}

// ─── Pricing Engine tab ───────────────────────────────────────────────────────

const YARD_SIZE_TIERS = [
  { label: "Under 1/8 acre", midpointAcres: 0.0625, upToAcres: 0.125 as number | null },
  { label: "1/8–1/4 acre", midpointAcres: 0.1875, upToAcres: 0.25 as number | null },
  { label: "1/4–1/2 acre", midpointAcres: 0.375, upToAcres: 0.5 as number | null },
  { label: "Over 1/2 acre", midpointAcres: 0.625, upToAcres: null as number | null },
];

type BaseKey = "weekly" | "biweekly" | "monthly" | "onetime";
type Bases = Record<BaseKey, number>;

const FREQ_COLUMNS: Array<{ key: BaseKey; label: string; multKey: FreqMultKey }> = [
  { key: "weekly", label: "Weekly", multKey: "weeklyMultiplier" },
  { key: "biweekly", label: "Biweekly", multKey: "biweeklyMultiplier" },
  { key: "monthly", label: "Monthly", multKey: "monthlyMultiplier" },
  { key: "onetime", label: "One-time", multKey: "oneTimeMultiplier" },
];

/**
 * Map a display tier's upToAcres boundary to the persisted surcharge.
 * Uses exact upToAcres match first, then falls back to the smallest persisted tier
 * whose upper boundary covers the display tier's boundary. This handles legacy
 * 3-tier configs being loaded into the 4-tier display without index drift.
 */
function surchargeForDisplayTier(
  displayTier: { upToAcres: number | null },
  persistedTiers: PricingRulesConfig["yardSizeTiers"]
): number {
  if (!persistedTiers.length) return 0;
  // Exact boundary match
  const exact = persistedTiers.find((t) => t.upToAcres === displayTier.upToAcres);
  if (exact) return exact.surcharge;
  // "Over" tier (null upToAcres) → use surcharge of the last persisted tier
  if (displayTier.upToAcres === null) {
    const sorted = [...persistedTiers].sort(
      (a, b) => (a.upToAcres ?? Infinity) - (b.upToAcres ?? Infinity)
    );
    return sorted[sorted.length - 1]?.surcharge ?? 0;
  }
  // Bounded display tier with no exact match → find smallest persisted boundary
  // that is >= the display tier's upper boundary (i.e., the persisted tier that
  // covers this display tier's range)
  const covering = persistedTiers
    .filter((t) => t.upToAcres !== null && (t.upToAcres as number) >= displayTier.upToAcres!)
    .sort((a, b) => (a.upToAcres as number) - (b.upToAcres as number));
  return covering[0]?.surcharge ?? 0;
}

function computeSuggestedPrice(
  midpointAcres: number,
  freqMultiplier: number,
  config: PricingConfig,
  totalMonthlyOverheadDollars: number,
  marginPct: number
): number {
  const tenths = midpointAcres * 10;
  const rawServiceMin = Math.max(
    tenths * config.baseTimePerTenthAcreMinutes * freqMultiplier * config.difficultyFlat,
    config.minimumServiceMinutesFloor
  );
  const burdenedRatePerMin = ((config.techHourlyWageCents / 100) * config.burdenMultiplier) / 60;
  const laborCost = rawServiceMin * burdenedRatePerMin;
  const travelMin = config.standardTravelMinutesPerStop ?? 3;
  const travelLaborCost = travelMin * burdenedRatePerMin;
  const driveDistMiles = (config.driveSpeedAverageMph * travelMin) / 60;
  const vehicleCostPerStop = (config.vehicleCostPerMileCents / 100) * driveDistMiles;
  const overheadPerStop = totalMonthlyOverheadDollars / (config.estimatedMonthlyStops || 100);
  const totalCost = laborCost + travelLaborCost + vehicleCostPerStop + overheadPerStop;
  const margin = Math.max(0, Math.min(0.99, marginPct / 100));
  return totalCost / (1 - margin);
}

function PricingEngineTab() {
  const { toast } = useToast();
  const { formatMoney } = useCurrency();

  const { data: pricingConfigData } = useQuery<PricingConfigResponse>({
    queryKey: ["/api/pricing-config"],
  });
  const { data: overheadTotal } = useQuery<{ totalMonthlyOverheadCents: number }>({
    queryKey: ["/api/overhead-costs/total"],
  });

  const config: PricingConfig = pricingConfigData
    ? { ...DEFAULT_PRICING_CONFIG, ...pricingConfigData }
    : DEFAULT_PRICING_CONFIG;

  const pricingRules: PricingRulesConfig = pricingConfigData?.pricingRules ?? DEFAULT_PRICING_RULES;
  const totalMonthlyOverheadDollars = (overheadTotal?.totalMonthlyOverheadCents ?? 0) / 100;

  const [marginPct, setMarginPct] = useState(() => config.targetProfitMarginPct || 30);

  /**
   * Unified state model — single source of truth for every cell in the pricing grid:
   *
   *   displayPrice(tier, freq) = bases[freq] + yardSizeSurcharges[tier]
   *
   * All 4 frequency base prices are stored independently and saved.
   * Editing tier-0 cells → updates bases[freq].
   * Editing tier-i (i>0) cells → updates yardSizeSurcharges[i] = val - bases[freq].
   * The surcharge accordion also edits yardSizeSurcharges directly.
   *
   * On save:
   *   basePrices.weekly  = bases.weekly
   *   basePrices.biWeekly = bases.biweekly
   *   basePrices.monthly  = bases.monthly
   *   basePrices.oneTime  = bases.onetime
   *   yardSizeTiers[i].surcharge = yardSizeSurcharges[i]
   *
   * After reload the computed values are exactly reproduced with zero data loss.
   */
  const [bases, setBases] = useState<Bases>(() => {
    const w = pricingRules.basePrices.weekly ?? DEFAULT_PRICING_RULES.basePrices.weekly;
    const bw = pricingRules.basePrices.biWeekly ?? DEFAULT_PRICING_RULES.basePrices.biWeekly;
    const wMult = config.weeklyMultiplier || 1;
    return {
      weekly: w,
      biweekly: bw,
      monthly:
        pricingRules.basePrices.monthly ??
        (wMult > 0 ? w * ((config.monthlyMultiplier || 2) / wMult) : bw * 1.5),
      onetime:
        pricingRules.basePrices.oneTime ??
        (wMult > 0 ? w * ((config.oneTimeMultiplier || 3) / wMult) : w * 2.5),
    };
  });

  // Per-dog surcharge rule
  const [perDogRule, setPerDogRule] = useState<PricingRulesConfig["perDogRule"]>(
    () => pricingRules.perDogRule ?? DEFAULT_PRICING_RULES.perDogRule
  );

  // Yard-size surcharges — shared by accordion editor AND the tier-i table cells.
  // Mapped by upToAcres boundary (not array index) so legacy 3-tier configs load correctly.
  const [yardSizeSurcharges, setYardSizeSurcharges] = useState<number[]>(() =>
    YARD_SIZE_TIERS.map((tier) => surchargeForDisplayTier(tier, pricingRules.yardSizeTiers))
  );

  const [isDirty, setIsDirty] = useState(false);

  const displayPrice = useCallback(
    (tierIdx: number, freqKey: BaseKey): number =>
      (bases[freqKey] ?? 0) + (yardSizeSurcharges[tierIdx] ?? 0),
    [bases, yardSizeSurcharges]
  );

  // Re-sync from server when pricingConfigData first loads
  const syncedRef = useRef(false);
  useEffect(() => {
    if (pricingConfigData && !syncedRef.current) {
      syncedRef.current = true;
      const rules = pricingConfigData.pricingRules ?? DEFAULT_PRICING_RULES;
      const cfg = { ...DEFAULT_PRICING_CONFIG, ...pricingConfigData };
      const w = rules.basePrices.weekly ?? DEFAULT_PRICING_RULES.basePrices.weekly;
      const bw = rules.basePrices.biWeekly ?? DEFAULT_PRICING_RULES.basePrices.biWeekly;
      const wMult = cfg.weeklyMultiplier || 1;
      setBases({
        weekly: w,
        biweekly: bw,
        monthly:
          rules.basePrices.monthly ??
          (wMult > 0 ? w * ((cfg.monthlyMultiplier || 2) / wMult) : bw * 1.5),
        onetime:
          rules.basePrices.oneTime ??
          (wMult > 0 ? w * ((cfg.oneTimeMultiplier || 3) / wMult) : w * 2.5),
      });
      setPerDogRule(rules.perDogRule ?? DEFAULT_PRICING_RULES.perDogRule);
      setYardSizeSurcharges(
        YARD_SIZE_TIERS.map((tier) => surchargeForDisplayTier(tier, rules.yardSizeTiers))
      );
      setMarginPct(cfg.targetProfitMarginPct || 30);
    }
  }, [pricingConfigData]);

  const suggestedPrices = useMemo(() => {
    const result: Record<number, Partial<Record<BaseKey, number>>> = {};
    YARD_SIZE_TIERS.forEach((tier, ti) => {
      result[ti] = {};
      FREQ_COLUMNS.forEach((freq) => {
        const mult = getFreqMultiplier(config, freq.multKey);
        result[ti][freq.key] = computeSuggestedPrice(
          tier.midpointAcres,
          mult,
          config,
          totalMonthlyOverheadDollars,
          marginPct
        );
      });
    });
    return result;
  }, [config, totalMonthlyOverheadDollars, marginPct]);

  const saveRulesMutation = useMutation({
    mutationFn: async () => {
      const newBasePrices: PricingRulesConfig["basePrices"] = {
        weekly: Math.max(0, bases.weekly),
        biWeekly: Math.max(0, bases.biweekly),
        twiceWeekly:
          pricingRules.basePrices.twiceWeekly ?? DEFAULT_PRICING_RULES.basePrices.twiceWeekly,
        monthly: Math.max(0, bases.monthly),
        oneTime: Math.max(0, bases.onetime),
      };
      const newTiers: PricingRulesConfig["yardSizeTiers"] = YARD_SIZE_TIERS.map((tier, ti) => ({
        name: tier.label,
        upToAcres: tier.upToAcres,
        surcharge: Math.round((yardSizeSurcharges[ti] ?? 0) * 100) / 100,
      }));
      await apiRequest("PUT", "/api/pricing-rules", {
        basePrices: newBasePrices,
        perDogRule,
        yardSizeTiers: newTiers,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-config"] });
      syncedRef.current = false;
      setIsDirty(false);
      toast({ title: "Prices saved", description: "Your pricing rules have been updated." });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const handleCellChange = (tierIdx: number, freqKey: BaseKey, val: number) => {
    if (tierIdx === 0) {
      setBases((prev) => ({ ...prev, [freqKey]: Math.max(0, val) }));
    } else {
      const newSurcharge = Math.max(0, val - (bases[freqKey] ?? 0));
      setYardSizeSurcharges((prev) => {
        const next = [...prev];
        next[tierIdx] = newSurcharge;
        return next;
      });
    }
    setIsDirty(true);
  };

  const handleApplyAllSuggested = () => {
    const s0 = suggestedPrices[0] ?? {};
    const newBases: Bases = {
      weekly: Math.round((s0.weekly ?? bases.weekly) * 100) / 100,
      biweekly: Math.round((s0.biweekly ?? bases.biweekly) * 100) / 100,
      monthly: Math.round((s0.monthly ?? bases.monthly) * 100) / 100,
      onetime: Math.round((s0.onetime ?? bases.onetime) * 100) / 100,
    };
    setBases(newBases);
    // For tiers 1+, derive the shared yard-size surcharge as the average of the
    // frequency-specific implied surcharges (suggested[freq] - newBases[freq]).
    // This minimises the overall deviation from all 4 suggested values simultaneously.
    setYardSizeSurcharges(
      YARD_SIZE_TIERS.map((_, ti) => {
        if (ti === 0) return 0;
        const freqSurcharges = FREQ_COLUMNS.map((f) => {
          const suggested = suggestedPrices[ti]?.[f.key] ?? 0;
          return Math.max(0, suggested - (newBases[f.key] ?? 0));
        });
        const avg = freqSurcharges.reduce((sum, v) => sum + v, 0) / freqSurcharges.length;
        return Math.round(avg * 100) / 100;
      })
    );
    setIsDirty(true);
    toast({ title: "Suggested prices applied", description: "Review and save to confirm." });
  };

  const handleApplySuggested = (tierIdx: number, freqKey: BaseKey) => {
    const val = Math.round((suggestedPrices[tierIdx]?.[freqKey] ?? 0) * 100) / 100;
    handleCellChange(tierIdx, freqKey, val);
  };

  const standardWeeklySuggested = suggestedPrices[0]?.weekly ?? 0;
  const inMarketRange = standardWeeklySuggested >= 20 && standardWeeklySuggested <= 30;

  return (
    <div className="space-y-6" data-testid="pricing-engine-tab">
      {/* Margin control */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[220px] space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Profit Margin Target</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={80}
                    value={marginPct}
                    onChange={(e) =>
                      setMarginPct(Math.min(80, Math.max(0, Number(e.target.value))))
                    }
                    className="w-20 h-8 text-sm text-right"
                    data-testid="input-margin-pct"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <Slider
                value={[marginPct]}
                onValueChange={([v]) => setMarginPct(v)}
                min={0}
                max={70}
                step={1}
                data-testid="slider-margin"
              />
              <p className="text-xs text-muted-foreground">
                Overhead: {formatMoney(totalMonthlyOverheadDollars)}/mo &middot; Stops:{" "}
                {config.estimatedMonthlyStops}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleApplyAllSuggested}
                data-testid="button-apply-all-suggested"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Apply All Suggested
              </Button>
              <Button
                size="sm"
                onClick={() => saveRulesMutation.mutate()}
                disabled={saveRulesMutation.isPending}
                data-testid="button-save-pricing-rules"
              >
                <Save className="h-3.5 w-3.5 mr-1" />
                {saveRulesMutation.isPending ? "Saving..." : "Save Prices"}
              </Button>
            </div>
          </div>
          {isDirty && (
            <p
              className="text-xs text-amber-600 dark:text-amber-400 mt-2"
              data-testid="text-unsaved-changes"
            >
              You have unsaved changes — click Save Prices to apply.
            </p>
          )}
        </CardContent>
      </Card>

      {inMarketRange ? (
        <Alert className="border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-800">
          <Info className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-700 dark:text-green-400 text-sm">
            Suggested weekly price for a small yard ({formatMoney(standardWeeklySuggested)}) is
            within the typical market range of $20–$30.
          </AlertDescription>
        </Alert>
      ) : standardWeeklySuggested > 0 ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            Suggested weekly price for a small yard: {formatMoney(standardWeeklySuggested)}. Typical
            market range is $20–$30. Adjust your margin or costs if needed.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Pricing table */}
      <Card data-testid="card-pricing-engine-table">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Suggested vs. Current Prices</CardTitle>
          <div className="space-y-1 mt-1">
            <p className="text-xs text-muted-foreground">
              All four frequency columns are editable. The top row (up to 1/8 acre) sets the
              per-frequency base price for each column independently.
            </p>
            <p className="text-xs text-muted-foreground">
              Rows 2-4 share one yard-size surcharge per row. Editing any frequency cell in those
              rows — or clicking its &quot;use&quot; button — updates the shared surcharge for that
              row, recalculating all four frequency prices together.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-2 font-medium text-muted-foreground w-36">
                  Yard Size
                </th>
                {FREQ_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="text-center px-3 py-2 font-medium text-muted-foreground min-w-[130px]"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {YARD_SIZE_TIERS.map((tier, ti) => (
                <tr key={ti} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-3 text-xs font-medium text-muted-foreground">
                    {tier.label}
                    {ti > 0 && (
                      <span
                        className="block text-[9px] text-muted-foreground/60 font-normal mt-0.5"
                        title="All frequency prices in this row share one yard-size surcharge"
                      >
                        +{formatMoney(yardSizeSurcharges[ti] ?? 0)} surcharge
                      </span>
                    )}
                  </td>
                  {FREQ_COLUMNS.map((freq) => {
                    const suggested = suggestedPrices[ti]?.[freq.key] ?? 0;
                    const current = displayPrice(ti, freq.key);
                    const diff = current - suggested;
                    const isAbove = diff > 0.5;
                    const isBelow = diff < -0.5;
                    return (
                      <td key={freq.key} className="px-3 py-3">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground w-14 shrink-0">
                              Suggested:
                            </span>
                            <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                              {formatMoney(suggested)}
                            </span>
                            <button
                              className="ml-0.5 text-[9px] text-primary hover:underline"
                              onClick={() => handleApplySuggested(ti, freq.key)}
                              data-testid={`button-apply-suggested-${ti}-${freq.key}`}
                            >
                              use
                            </button>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground w-14 shrink-0">
                              Current:
                            </span>
                            <PricingEngineCell
                              value={current}
                              onChange={(val) => handleCellChange(ti, freq.key, val)}
                              testId={`cell-current-${ti}-${freq.key}`}
                            />
                            {isAbove && (
                              <span className="text-[9px] text-amber-600 dark:text-amber-400">
                                +{formatMoney(diff)}
                              </span>
                            )}
                            {isBelow && (
                              <span className="text-[9px] text-red-600 dark:text-red-400">
                                {formatMoney(diff)}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Surcharge rules — expandable section */}
      <Accordion type="multiple" defaultValue={[]}>
        <AccordionItem value="surcharges">
          <AccordionTrigger data-testid="accordion-surcharges">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Yard-Size Surcharges & Per-Dog Rule
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <div>
                <p className="text-xs text-muted-foreground mb-3">
                  Surcharges are added on top of the base price for larger yards.
                </p>
                <div className="space-y-2">
                  {YARD_SIZE_TIERS.map((tier, ti) => (
                    <div
                      key={ti}
                      className="flex items-center gap-3"
                      data-testid={`row-yard-surcharge-${ti}`}
                    >
                      <span className="text-sm w-36 shrink-0">{tier.label}</span>
                      <span className="text-xs text-muted-foreground">+$</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={yardSizeSurcharges[ti] ?? 0}
                        onChange={(e) => {
                          const val = Math.max(0, parseFloat(e.target.value) || 0);
                          setYardSizeSurcharges((prev) => {
                            const next = [...prev];
                            next[ti] = val;
                            return next;
                          });
                          setIsDirty(true);
                        }}
                        className="w-24 h-7 text-sm text-right tabular-nums rounded-md border border-input px-2 bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        data-testid={`input-yard-surcharge-${ti}`}
                      />
                      <span className="text-xs text-muted-foreground">per visit</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t pt-4">
                <p className="text-sm font-medium mb-1">Per-Dog Surcharge Rule</p>
                <p className="text-xs text-muted-foreground mb-3">
                  A surcharge is added for every N additional dogs beyond the first.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Dogs per increment</Label>
                    <input
                      type="number"
                      min={1}
                      value={perDogRule.incrementDogs}
                      onChange={(e) => {
                        setPerDogRule((r) => ({
                          ...r,
                          incrementDogs: Math.max(1, parseInt(e.target.value) || 1),
                        }));
                        setIsDirty(true);
                      }}
                      className="w-full h-8 text-sm text-right tabular-nums rounded-md border border-input px-2 bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      data-testid="input-per-dog-increment"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Surcharge amount ($)</Label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={perDogRule.surchargeAmount}
                      onChange={(e) => {
                        setPerDogRule((r) => ({
                          ...r,
                          surchargeAmount: Math.max(0, parseFloat(e.target.value) || 0),
                        }));
                        setIsDirty(true);
                      }}
                      className="w-full h-8 text-sm text-right tabular-nums rounded-md border border-input px-2 bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      data-testid="input-per-dog-surcharge-amount"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Max dogs</Label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={perDogRule.maxDogs}
                      onChange={(e) => {
                        setPerDogRule((r) => ({
                          ...r,
                          maxDogs: Math.max(1, Math.min(20, parseInt(e.target.value) || 1)),
                        }));
                        setIsDirty(true);
                      }}
                      className="w-full h-8 text-sm text-right tabular-nums rounded-md border border-input px-2 bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      data-testid="input-per-dog-max"
                    />
                  </div>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <p className="text-xs text-muted-foreground">
        Saving updates your pricing rules (base prices, yard-size surcharges, and per-dog rule).
        These flow into the Quotes tool.
      </p>
    </div>
  );
}

function PricingEngineCell({
  value,
  onChange,
  testId,
}: {
  value: number;
  onChange: (val: number) => void;
  testId: string;
}) {
  const { formatMoney } = useCurrency();
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState(value.toFixed(2));

  useEffect(() => {
    if (!editing) setLocalVal(value.toFixed(2));
  }, [value, editing]);

  const commit = () => {
    const parsed = parseFloat(localVal);
    if (!isNaN(parsed) && parsed >= 0) {
      onChange(Math.round(parsed * 100) / 100);
    } else {
      setLocalVal(value.toFixed(2));
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="number"
        step="0.01"
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setLocalVal(value.toFixed(2));
            setEditing(false);
          }
        }}
        autoFocus
        className="w-20 h-6 text-xs text-right tabular-nums rounded border border-input px-1 bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        data-testid={testId}
      />
    );
  }

  return (
    <button
      onClick={() => {
        setEditing(true);
        setLocalVal(value.toFixed(2));
      }}
      className="text-xs font-semibold tabular-nums text-left hover:text-primary hover:underline rounded px-1 py-0.5"
      data-testid={testId}
    >
      {formatMoney(value)}
    </button>
  );
}

// ─── My Pricing Tab ───────────────────────────────────────────────────────────

function MyPricingTab() {
  const { toast } = useToast();
  const { formatMoney } = useCurrency();

  const { data: pricingConfigData, isLoading } = useQuery<PricingConfig>({
    queryKey: ["/api/pricing-config"],
  });

  const config: PricingConfig = pricingConfigData
    ? { ...DEFAULT_PRICING_CONFIG, ...pricingConfigData }
    : DEFAULT_PRICING_CONFIG;
  const pricingRules: PricingRulesConfig = pricingConfigData?.pricingRules ?? DEFAULT_PRICING_RULES;

  const [bases, setBases] = useState<Bases>(() => {
    const w = pricingRules.basePrices.weekly ?? DEFAULT_PRICING_RULES.basePrices.weekly;
    const bw = pricingRules.basePrices.biWeekly ?? DEFAULT_PRICING_RULES.basePrices.biWeekly;
    const wMult = config.weeklyMultiplier || 1;
    return {
      weekly: w,
      biweekly: bw,
      monthly:
        pricingRules.basePrices.monthly ??
        (wMult > 0 ? w * ((config.monthlyMultiplier || 2) / wMult) : bw * 1.5),
      onetime:
        pricingRules.basePrices.oneTime ??
        (wMult > 0 ? w * ((config.oneTimeMultiplier || 3) / wMult) : w * 2.5),
    };
  });

  const [yardSizeSurcharges, setYardSizeSurcharges] = useState<number[]>(() =>
    YARD_SIZE_TIERS.map((tier) => surchargeForDisplayTier(tier, pricingRules.yardSizeTiers))
  );

  const [perDogRule, setPerDogRule] = useState<PricingRulesConfig["perDogRule"]>(
    () => pricingRules.perDogRule ?? DEFAULT_PRICING_RULES.perDogRule
  );

  const [isDirty, setIsDirty] = useState(false);

  const syncedRef = useRef(false);
  useEffect(() => {
    if (pricingConfigData && !syncedRef.current) {
      syncedRef.current = true;
      const rules = pricingConfigData.pricingRules ?? DEFAULT_PRICING_RULES;
      const cfg = { ...DEFAULT_PRICING_CONFIG, ...pricingConfigData };
      const w = rules.basePrices.weekly ?? DEFAULT_PRICING_RULES.basePrices.weekly;
      const bw = rules.basePrices.biWeekly ?? DEFAULT_PRICING_RULES.basePrices.biWeekly;
      const wMult = cfg.weeklyMultiplier || 1;
      setBases({
        weekly: w,
        biweekly: bw,
        monthly:
          rules.basePrices.monthly ??
          (wMult > 0 ? w * ((cfg.monthlyMultiplier || 2) / wMult) : bw * 1.5),
        onetime:
          rules.basePrices.oneTime ??
          (wMult > 0 ? w * ((cfg.oneTimeMultiplier || 3) / wMult) : w * 2.5),
      });
      setPerDogRule(rules.perDogRule ?? DEFAULT_PRICING_RULES.perDogRule);
      setYardSizeSurcharges(
        YARD_SIZE_TIERS.map((tier) => surchargeForDisplayTier(tier, rules.yardSizeTiers))
      );
    }
  }, [pricingConfigData]);

  const displayPrice = useCallback(
    (tierIdx: number, freqKey: BaseKey): number =>
      (bases[freqKey] ?? 0) + (yardSizeSurcharges[tierIdx] ?? 0),
    [bases, yardSizeSurcharges]
  );

  const handleCellChange = (tierIdx: number, freqKey: BaseKey, val: number) => {
    if (tierIdx === 0) {
      setBases((prev) => ({ ...prev, [freqKey]: Math.max(0, val) }));
    } else {
      const newSurcharge = Math.max(0, val - (bases[freqKey] ?? 0));
      setYardSizeSurcharges((prev) => {
        const next = [...prev];
        next[tierIdx] = newSurcharge;
        return next;
      });
    }
    setIsDirty(true);
  };

  const saveRulesMutation = useMutation({
    mutationFn: async () => {
      const newBasePrices: PricingRulesConfig["basePrices"] = {
        weekly: Math.max(0, bases.weekly),
        biWeekly: Math.max(0, bases.biweekly),
        twiceWeekly:
          pricingRules.basePrices.twiceWeekly ?? DEFAULT_PRICING_RULES.basePrices.twiceWeekly,
        monthly: Math.max(0, bases.monthly),
        oneTime: Math.max(0, bases.onetime),
      };
      const newTiers: PricingRulesConfig["yardSizeTiers"] = YARD_SIZE_TIERS.map((tier, ti) => ({
        name: tier.label,
        upToAcres: tier.upToAcres,
        surcharge: Math.round((yardSizeSurcharges[ti] ?? 0) * 100) / 100,
      }));
      await apiRequest("PUT", "/api/pricing-rules", {
        basePrices: newBasePrices,
        perDogRule,
        yardSizeTiers: newTiers,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-config"] });
      syncedRef.current = false;
      setIsDirty(false);
      toast({ title: "Prices saved", description: "Your pricing rules have been updated." });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="my-pricing-tab">
      {/* Save bar */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          These are the prices used when creating quotes and service agreements.
        </p>
        <Button
          size="sm"
          onClick={() => saveRulesMutation.mutate()}
          disabled={saveRulesMutation.isPending || !isDirty}
          data-testid="button-save-my-pricing"
        >
          <Save className="h-3.5 w-3.5 mr-1" />
          {saveRulesMutation.isPending ? "Saving..." : "Save Prices"}
        </Button>
      </div>
      {isDirty && (
        <p
          className="text-xs text-amber-600 dark:text-amber-400 -mt-4"
          data-testid="text-my-pricing-unsaved"
        >
          You have unsaved changes.
        </p>
      )}

      {/* Price table */}
      <Card data-testid="card-my-pricing-table">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Your Prices</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Tap any price to edit it. Prices for larger yard sizes adjust their surcharge; the base
            frequency price stays the same.
          </p>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-2 font-medium text-muted-foreground w-36">
                  Yard Size
                </th>
                {FREQ_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="text-center px-3 py-2 font-medium text-muted-foreground min-w-[90px]"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {YARD_SIZE_TIERS.map((tier, ti) => (
                <tr key={ti} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-3 text-sm font-medium">
                    {tier.label}
                    {ti > 0 && (yardSizeSurcharges[ti] ?? 0) > 0 && (
                      <span className="block text-[10px] text-muted-foreground font-normal mt-0.5">
                        +{formatMoney(yardSizeSurcharges[ti] ?? 0)} surcharge
                      </span>
                    )}
                  </td>
                  {FREQ_COLUMNS.map((freq) => (
                    <td key={freq.key} className="px-3 py-3 text-center">
                      <PricingEngineCell
                        value={displayPrice(ti, freq.key)}
                        onChange={(val) => handleCellChange(ti, freq.key, val)}
                        testId={`cell-mypricing-${ti}-${freq.key}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Modifiers */}
      <Card data-testid="card-my-pricing-modifiers">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Modifiers</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            These surcharges are added on top of the base price depending on yard size and number of
            dogs.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Yard size surcharges */}
          <div>
            <p className="text-sm font-medium mb-3">Yard Size Surcharges</p>
            <div className="space-y-2">
              {YARD_SIZE_TIERS.map((tier, ti) => (
                <div
                  key={ti}
                  className="flex items-center gap-3"
                  data-testid={`row-mp-yard-surcharge-${ti}`}
                >
                  <span className="text-sm flex-1">{tier.label}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">+$</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={yardSizeSurcharges[ti] ?? 0}
                      onChange={(e) => {
                        const val = Math.max(0, parseFloat(e.target.value) || 0);
                        setYardSizeSurcharges((prev) => {
                          const next = [...prev];
                          next[ti] = val;
                          return next;
                        });
                        setIsDirty(true);
                      }}
                      className="w-20 h-8 text-sm text-right tabular-nums rounded-md border border-input px-2 bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      data-testid={`input-mp-yard-surcharge-${ti}`}
                    />
                    <span className="text-xs text-muted-foreground">per visit</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Per-dog rule */}
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-1">Per-Dog Surcharge</p>
            <p className="text-xs text-muted-foreground mb-3">
              Add ${perDogRule.surchargeAmount.toFixed(2)} for every {perDogRule.incrementDogs}{" "}
              dog(s) beyond the first, up to {perDogRule.maxDogs} dogs.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Dogs per increment</Label>
                <input
                  type="number"
                  min={1}
                  value={perDogRule.incrementDogs}
                  onChange={(e) => {
                    setPerDogRule((r) => ({
                      ...r,
                      incrementDogs: Math.max(1, parseInt(e.target.value) || 1),
                    }));
                    setIsDirty(true);
                  }}
                  className="w-full h-8 text-sm text-right tabular-nums rounded-md border border-input px-2 bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  data-testid="input-mp-per-dog-increment"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Surcharge per increment ($)</Label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={perDogRule.surchargeAmount}
                  onChange={(e) => {
                    setPerDogRule((r) => ({
                      ...r,
                      surchargeAmount: Math.max(0, parseFloat(e.target.value) || 0),
                    }));
                    setIsDirty(true);
                  }}
                  className="w-full h-8 text-sm text-right tabular-nums rounded-md border border-input px-2 bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  data-testid="input-mp-per-dog-surcharge-amount"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max dogs</Label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={perDogRule.maxDogs}
                  onChange={(e) => {
                    setPerDogRule((r) => ({
                      ...r,
                      maxDogs: Math.max(1, Math.min(20, parseInt(e.target.value) || 1)),
                    }));
                    setIsDirty(true);
                  }}
                  className="w-full h-8 text-sm text-right tabular-nums rounded-md border border-input px-2 bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  data-testid="input-mp-per-dog-max"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function UnifiedPricingEngine() {
  const [tab, setTab] = useState(readTabFromUrl);

  const handleTabChange = (newTab: string) => {
    setTab(newTab);
    writeTabToUrl(newTab);
  };

  return (
    <div className="p-4 md:p-6 overflow-auto h-full">
      <div className="mb-4">
        <h1 className="text-2xl font-bold" data-testid="text-pricing-page-heading">
          Pricing
        </h1>
        <p className="text-sm text-muted-foreground">
          Configure your costs, set prices based on your margins, and simulate scenarios.
        </p>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList
          className="w-full grid grid-cols-4 sm:inline-flex sm:w-auto"
          data-testid="tabs-pricing"
        >
          <TabsTrigger
            value="pricing"
            data-testid="tab-my-pricing"
            className="gap-1 text-xs sm:text-sm sm:gap-1.5"
          >
            <Target className="h-3.5 w-3.5 shrink-0" />
            <span>My Pricing</span>
          </TabsTrigger>
          <TabsTrigger
            value="costs"
            data-testid="tab-costs"
            className="gap-1 text-xs sm:text-sm sm:gap-1.5"
          >
            <DollarSign className="h-3.5 w-3.5 shrink-0" />
            <span>Costs</span>
          </TabsTrigger>
          <TabsTrigger
            value="engine"
            data-testid="tab-engine"
            className="gap-1 text-xs sm:text-sm sm:gap-1.5"
          >
            <Calculator className="h-3.5 w-3.5 shrink-0" />
            <span>Engine</span>
          </TabsTrigger>
          <TabsTrigger
            value="simulator"
            data-testid="tab-simulator"
            className="gap-1 text-xs sm:text-sm sm:gap-1.5"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
            <span>Simulator</span>
          </TabsTrigger>
        </TabsList>

        <div className="mt-4 pb-6">
          <TabsContent value="costs" className="mt-0">
            <CostsTab />
          </TabsContent>

          <TabsContent value="pricing" className="mt-0">
            <MyPricingTab />
          </TabsContent>

          <TabsContent value="engine" className="mt-0">
            <PricingEngineTab />
          </TabsContent>

          <TabsContent value="simulator" className="mt-0">
            <AIPricingOptimizer />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
