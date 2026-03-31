import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ServicePricingItem, ServicePackage, PricingRulesConfig } from "@shared/schema";
import { DEFAULT_PRICING_RULES } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Plus, Trash2, DollarSign, Package, Sparkles, RefreshCw, CheckCircle2, Phone, Settings2, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";

const CATEGORY_LABELS: Record<string, string> = {
  recurring_service: "Recurring Services",
  one_time_service: "One-Time Services",
  add_on: "Add-Ons & Extras",
};

const UNIT_LABELS: Record<string, string> = {
  per_visit: "per visit",
  per_week: "per week",
  per_month: "per month",
  flat_rate: "flat rate",
  one_time: "one-time",
};

const pricingFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().or(z.literal("")),
  category: z.enum(["recurring_service", "one_time_service", "add_on"]),
  basePrice: z.string().min(1, "Price is required"),
  unit: z.string().min(1, "Unit is required"),
});

const packageFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().or(z.literal("")),
  frequency: z.string().min(1, "Frequency is required"),
  basePrice: z.string().min(1, "Price is required"),
  includedItemsText: z.string().optional().or(z.literal("")),
});

type PricingFormValues = z.infer<typeof pricingFormSchema>;
type PackageFormValues = z.infer<typeof packageFormSchema>;

function EditablePriceCell({
  item,
  onSave,
  disabled,
}: {
  item: ServicePricingItem;
  onSave: (id: string, data: Partial<ServicePricingItem>) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(item.basePrice);
  const isCallForQuote = (item.metadata as any)?.callForQuote === true;

  if (isCallForQuote || disabled) {
    return (
      <span className="text-sm text-muted-foreground italic px-2 py-1" data-testid={`text-call-quote-${item.id}`}>
        <Phone className="inline h-3 w-3 mr-1" />
        Call for Quote
      </span>
    );
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">$</span>
        <Input
          type="number"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-24"
          data-testid={`input-price-${item.id}`}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSave(item.id, { basePrice: price, metadata: { ...(item.metadata as any || {}), manualOverride: true } } as any);
              setEditing(false);
            }
            if (e.key === "Escape") {
              setPrice(item.basePrice);
              setEditing(false);
            }
          }}
          onBlur={() => {
            onSave(item.id, { basePrice: price, metadata: { ...(item.metadata as any || {}), manualOverride: true } } as any);
            setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="font-semibold text-left hover-elevate rounded-md px-2 py-1"
      data-testid={`button-edit-price-${item.id}`}
    >
      ${parseFloat(item.basePrice).toFixed(2)}
    </button>
  );
}

function getDogCount(name: string): number | null {
  const match = name.match(/(\d+)\+?\s*Dogs?/i);
  return match ? parseInt(match[1]) : null;
}

function PricingRulesPanel({
  rules,
  onGenerate,
  isGenerating,
}: {
  rules: PricingRulesConfig;
  onGenerate: (rules: PricingRulesConfig) => void;
  isGenerating: boolean;
}) {
  const [localRules, setLocalRules] = useState<PricingRulesConfig>(rules);

  useEffect(() => {
    setLocalRules(rules);
  }, [rules]);

  const updateBasePrice = (key: keyof PricingRulesConfig["basePrices"], value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setLocalRules((prev) => ({
        ...prev,
        basePrices: { ...prev.basePrices, [key]: num },
      }));
    }
  };

  const updatePerDogRule = (key: keyof PricingRulesConfig["perDogRule"], value: string) => {
    const num = key === "surchargeAmount" ? parseFloat(value) : parseInt(value);
    if (!isNaN(num)) {
      setLocalRules((prev) => ({
        ...prev,
        perDogRule: { ...prev.perDogRule, [key]: num },
      }));
    }
  };

  const updateYardTier = (index: number, key: "upToAcres" | "surcharge", value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setLocalRules((prev) => {
        const tiers = [...prev.yardSizeTiers];
        tiers[index] = { ...tiers[index], [key]: num };
        return { ...prev, yardSizeTiers: tiers };
      });
    }
  };

  const addYardTier = () => {
    setLocalRules((prev) => {
      const lastTier = prev.yardSizeTiers[prev.yardSizeTiers.length - 1];
      return {
        ...prev,
        yardSizeTiers: [
          ...prev.yardSizeTiers,
          { upToAcres: (lastTier?.upToAcres || 0) + 0.25, surcharge: (lastTier?.surcharge || 0) + 7 },
        ],
      };
    });
  };

  const removeYardTier = (index: number) => {
    setLocalRules((prev) => ({
      ...prev,
      yardSizeTiers: prev.yardSizeTiers.filter((_, i) => i !== index),
    }));
  };

  return (
    <div className="space-y-4" data-testid="pricing-rules-panel">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Base Prices (1 Dog)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Weekly</label>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">$</span>
                <Input
                  type="number"
                  step="0.01"
                  value={localRules.basePrices.weekly}
                  onChange={(e) => updateBasePrice("weekly", e.target.value)}
                  data-testid="input-base-weekly"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Bi-Weekly</label>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">$</span>
                <Input
                  type="number"
                  step="0.01"
                  value={localRules.basePrices.biWeekly}
                  onChange={(e) => updateBasePrice("biWeekly", e.target.value)}
                  data-testid="input-base-biweekly"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Twice Weekly</label>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">$</span>
                <Input
                  type="number"
                  step="0.01"
                  value={localRules.basePrices.twiceWeekly}
                  onChange={(e) => updateBasePrice("twiceWeekly", e.target.value)}
                  data-testid="input-base-twiceweekly"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Per-Dog Pricing Rule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">For every</label>
              <Input
                type="number"
                min={1}
                value={localRules.perDogRule.incrementDogs}
                onChange={(e) => updatePerDogRule("incrementDogs", e.target.value)}
                className="w-20"
                data-testid="input-increment-dogs"
              />
            </div>
            <span className="text-sm text-muted-foreground pb-2">dog(s), add</span>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Surcharge</label>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={localRules.perDogRule.surchargeAmount}
                  onChange={(e) => updatePerDogRule("surchargeAmount", e.target.value)}
                  className="w-24"
                  data-testid="input-surcharge-amount"
                />
              </div>
            </div>
            <span className="text-sm text-muted-foreground pb-2">up to</span>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Max Dogs</label>
              <Input
                type="number"
                min={1}
                max={20}
                value={localRules.perDogRule.maxDogs}
                onChange={(e) => updatePerDogRule("maxDogs", e.target.value)}
                className="w-20"
                data-testid="input-max-dogs"
              />
            </div>
            <span className="text-sm text-muted-foreground pb-2">dogs</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Dogs beyond the max will be marked "Call for Quote"
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Yard Size Adjustments
          </CardTitle>
          <Button variant="outline" size="sm" onClick={addYardTier} data-testid="button-add-yard-tier">
            <Plus className="h-3 w-3 mr-1" /> Add Tier
          </Button>
        </CardHeader>
        <CardContent>
          {localRules.yardSizeTiers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2">No yard size tiers defined.</p>
          ) : (
            <div className="space-y-2">
              {localRules.yardSizeTiers.map((tier, index) => (
                <div key={index} className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">Up to</span>
                  <Input
                    type="number"
                    step="0.05"
                    min={0}
                    value={tier.upToAcres}
                    onChange={(e) => updateYardTier(index, "upToAcres", e.target.value)}
                    className="w-24"
                    data-testid={`input-yard-acres-${index}`}
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">acre =</span>
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={tier.surcharge}
                      onChange={(e) => updateYardTier(index, "surcharge", e.target.value)}
                      className="w-24"
                      data-testid={`input-yard-surcharge-${index}`}
                    />
                  </div>
                  <span className="text-sm text-muted-foreground whitespace-nowrap">surcharge</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => removeYardTier(index)}
                    data-testid={`button-remove-yard-tier-${index}`}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Button
        onClick={() => onGenerate(localRules)}
        disabled={isGenerating}
        className="w-full"
        data-testid="button-generate-prices"
      >
        <RefreshCw className={`mr-2 h-4 w-4 ${isGenerating ? "animate-spin" : ""}`} />
        {isGenerating ? "Generating..." : "Generate Prices from Rules"}
      </Button>
    </div>
  );
}

export default function Pricing() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("recurring_service");
  const [pricingDialogOpen, setPricingDialogOpen] = useState(false);
  const [packageDialogOpen, setPackageDialogOpen] = useState(false);

  const { data: pricingItems, isLoading: pricingLoading } = useQuery<ServicePricingItem[]>({
    queryKey: ["/api/pricing"],
  });

  const { data: packages, isLoading: packagesLoading } = useQuery<ServicePackage[]>({
    queryKey: ["/api/packages"],
  });

  const { data: pricingConfig } = useQuery<Record<string, any>>({
    queryKey: ["/api/pricing-config"],
  });

  const pricingRules: PricingRulesConfig = pricingConfig?.pricingRules || DEFAULT_PRICING_RULES;

  const pricingForm = useForm<PricingFormValues>({
    resolver: zodResolver(pricingFormSchema),
    defaultValues: {
      name: "",
      description: "",
      category: "recurring_service",
      basePrice: "",
      unit: "per_visit",
    },
  });

  const packageForm = useForm<PackageFormValues>({
    resolver: zodResolver(packageFormSchema),
    defaultValues: {
      name: "",
      description: "",
      frequency: "weekly",
      basePrice: "",
      includedItemsText: "",
    },
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/pricing/seed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/packages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-config"] });
      toast({ title: "Pricing loaded", description: "Default pricing has been set up. Review and confirm your pricing." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const generateFromRulesMutation = useMutation({
    mutationFn: async (rules: PricingRulesConfig) => {
      const res = await apiRequest("POST", "/api/pricing/generate-from-rules", rules);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-config"] });
      toast({
        title: "Prices generated",
        description: `${data.itemsGenerated} pricing items generated from your rules.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createPricingMutation = useMutation({
    mutationFn: async (data: PricingFormValues) => {
      await apiRequest("POST", "/api/pricing", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing"] });
      toast({ title: "Service added" });
      setPricingDialogOpen(false);
      pricingForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updatePricingMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ServicePricingItem> }) => {
      await apiRequest("PATCH", `/api/pricing/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing"] });
    },
  });

  const deletePricingMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/pricing/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing"] });
      toast({ title: "Service removed" });
    },
  });

  const createPackageMutation = useMutation({
    mutationFn: async (data: PackageFormValues) => {
      const { includedItemsText, ...rest } = data;
      const includedItems = includedItemsText ? includedItemsText.split("\n").filter((s) => s.trim()) : [];
      await apiRequest("POST", "/api/packages", { ...rest, includedItems });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/packages"] });
      toast({ title: "Package created" });
      setPackageDialogOpen(false);
      packageForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updatePackageMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ServicePackage> }) => {
      await apiRequest("PATCH", `/api/packages/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/packages"] });
    },
  });

  const deletePackageMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/packages/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/packages"] });
      toast({ title: "Package removed" });
    },
  });

  const confirmPricingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pricing/confirm-and-generate-packages");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/packages"] });
      toast({
        title: "Pricing confirmed",
        description: `${data.packagesCreated} packages generated from your pricing.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handlePriceSave = (id: string, data: Partial<ServicePricingItem>) => {
    updatePricingMutation.mutate({ id, data });
  };

  const handleToggleActive = (id: string, isActive: boolean) => {
    updatePricingMutation.mutate({ id, data: { isActive } as any });
  };

  const handleToggleCallForQuote = (item: ServicePricingItem, checked: boolean) => {
    const currentMeta = (item.metadata as Record<string, any>) || {};
    updatePricingMutation.mutate({
      id: item.id,
      data: { metadata: { ...currentMeta, callForQuote: checked } } as any,
    });
  };

  const handlePackageToggleActive = (id: string, isActive: boolean) => {
    updatePackageMutation.mutate({ id, data: { isActive } as any });
  };

  const filteredItems = pricingItems?.filter((item) => item.category === activeTab) || [];
  const hasPricing = pricingItems && pricingItems.length > 0;

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-pricing-heading">Pricing & Packages</h1>
          <p className="text-sm text-muted-foreground">Customize your service pricing, then confirm to generate packages</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!hasPricing && (
            <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} data-testid="button-load-defaults">
              <Sparkles className="mr-1 h-4 w-4" />
              {seedMutation.isPending ? "Loading..." : "Load Default Pricing"}
            </Button>
          )}
          {hasPricing && (
            <>
              <Dialog open={pricingDialogOpen} onOpenChange={setPricingDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" data-testid="button-add-service">
                    <Plus className="mr-1 h-4 w-4" /> Add Service
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Service / Option</DialogTitle>
                  </DialogHeader>
                  <Form {...pricingForm}>
                    <form onSubmit={pricingForm.handleSubmit((v) => createPricingMutation.mutate(v))} className="space-y-4">
                      <FormField control={pricingForm.control} name="name" render={({ field }) => (
                        <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} data-testid="input-service-name" /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={pricingForm.control} name="description" render={({ field }) => (
                        <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea {...field} data-testid="input-service-description" /></FormControl><FormMessage /></FormItem>
                      )} />
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={pricingForm.control} name="category" render={({ field }) => (
                          <FormItem><FormLabel>Category</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl><SelectTrigger data-testid="select-category"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="recurring_service">Recurring Service</SelectItem>
                                <SelectItem value="one_time_service">One-Time Service</SelectItem>
                                <SelectItem value="add_on">Add-On</SelectItem>
                              </SelectContent>
                            </Select><FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={pricingForm.control} name="unit" render={({ field }) => (
                          <FormItem><FormLabel>Billing Unit</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl><SelectTrigger data-testid="select-unit"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="per_visit">Per Visit</SelectItem>
                                <SelectItem value="per_week">Per Week</SelectItem>
                                <SelectItem value="per_month">Per Month</SelectItem>
                                <SelectItem value="flat_rate">Flat Rate</SelectItem>
                                <SelectItem value="one_time">One-Time</SelectItem>
                              </SelectContent>
                            </Select><FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <FormField control={pricingForm.control} name="basePrice" render={({ field }) => (
                        <FormItem><FormLabel>Base Price ($)</FormLabel><FormControl><Input type="number" step="0.01" {...field} data-testid="input-service-price" /></FormControl><FormMessage /></FormItem>
                      )} />
                      <Button type="submit" disabled={createPricingMutation.isPending} data-testid="button-submit-service">
                        {createPricingMutation.isPending ? "Adding..." : "Add Service"}
                      </Button>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
              <Button
                onClick={() => confirmPricingMutation.mutate()}
                disabled={confirmPricingMutation.isPending}
                data-testid="button-confirm-pricing"
              >
                <CheckCircle2 className="mr-1 h-4 w-4" />
                {confirmPricingMutation.isPending ? "Generating..." : "Confirm Pricing"}
              </Button>
            </>
          )}
        </div>
      </div>

      {pricingLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : !hasPricing ? (
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <DollarSign className="h-12 w-12 text-muted-foreground mx-auto" />
            <div>
              <p className="text-lg font-medium">No pricing configured yet</p>
              <p className="text-sm text-muted-foreground">
                Load default pricing to get started with industry-standard rates, then customize to match your business.
              </p>
            </div>
            <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} data-testid="button-load-defaults-empty">
              <Sparkles className="mr-1 h-4 w-4" />
              {seedMutation.isPending ? "Loading..." : "Load Default Pricing"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="recurring_service" data-testid="tab-recurring">
                <RefreshCw className="mr-1 h-4 w-4" /> Recurring
              </TabsTrigger>
              <TabsTrigger value="one_time_service" data-testid="tab-onetime">
                <DollarSign className="mr-1 h-4 w-4" /> One-Time
              </TabsTrigger>
              <TabsTrigger value="add_on" data-testid="tab-addons">
                <Plus className="mr-1 h-4 w-4" /> Add-Ons
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {activeTab === "recurring_service" && (
            <PricingRulesPanel
              rules={pricingRules}
              onGenerate={(rules) => generateFromRulesMutation.mutate(rules)}
              isGenerating={generateFromRulesMutation.isPending}
            />
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-lg">{CATEGORY_LABELS[activeTab]}</CardTitle>
              <p className="text-sm text-muted-foreground">Click any price to edit it</p>
            </CardHeader>
            <CardContent>
              {filteredItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No items in this category yet.</p>
              ) : (
                <div className="space-y-2">
                  {filteredItems
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((item) => {
                      const dogCount = getDogCount(item.name);
                      const isCallForQuote = (item.metadata as any)?.callForQuote === true;
                      const is7Plus = item.name.includes("7+");
                      const canToggleQuote = dogCount !== null && dogCount >= 4;
                      const isManualOverride = (item.metadata as any)?.manualOverride === true;

                      return (
                        <div
                          key={item.id}
                          className={`flex flex-wrap items-center justify-between gap-3 border rounded-md p-3 ${isCallForQuote ? "bg-muted/50" : ""}`}
                          data-testid={`pricing-item-${item.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className={`font-medium truncate ${isCallForQuote ? "text-muted-foreground" : ""}`}>{item.name}</p>
                              <Badge variant="secondary" className="no-default-active-elevate">
                                {UNIT_LABELS[item.unit] || item.unit}
                              </Badge>
                              {is7Plus && (
                                <Badge variant="outline" className="no-default-active-elevate text-muted-foreground">
                                  <Phone className="h-3 w-3 mr-1" /> Custom Quote
                                </Badge>
                              )}
                              {isManualOverride && activeTab === "recurring_service" && (
                                <Badge variant="outline" className="no-default-active-elevate text-xs">
                                  Override
                                </Badge>
                              )}
                              {!item.isActive && (
                                <Badge variant="outline" className="no-default-active-elevate text-muted-foreground">
                                  Inactive
                                </Badge>
                              )}
                            </div>
                            {item.description && (
                              <p className="text-sm text-muted-foreground truncate">{item.description}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            {(canToggleQuote || is7Plus) && !is7Plus && (
                              <div className="flex items-center gap-1.5">
                                <Switch
                                  checked={isCallForQuote}
                                  onCheckedChange={(checked) => handleToggleCallForQuote(item, checked)}
                                  data-testid={`switch-call-quote-${item.id}`}
                                />
                                <span className="text-xs text-muted-foreground whitespace-nowrap">Call for Quote</span>
                              </div>
                            )}
                            <EditablePriceCell
                              item={item}
                              onSave={handlePriceSave}
                              disabled={isCallForQuote}
                            />
                            <Switch
                              checked={item.isActive}
                              onCheckedChange={(checked) => handleToggleActive(item.id, checked)}
                              data-testid={`switch-active-${item.id}`}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deletePricingMutation.mutate(item.id)}
                              data-testid={`button-delete-pricing-${item.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-bold" data-testid="text-packages-heading">Service Packages</h2>
            <Dialog open={packageDialogOpen} onOpenChange={setPackageDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" data-testid="button-add-package">
                  <Package className="mr-1 h-4 w-4" /> Add Package
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Service Package</DialogTitle>
                </DialogHeader>
                <Form {...packageForm}>
                  <form onSubmit={packageForm.handleSubmit((v) => createPackageMutation.mutate(v))} className="space-y-4">
                    <FormField control={packageForm.control} name="name" render={({ field }) => (
                      <FormItem><FormLabel>Package Name</FormLabel><FormControl><Input {...field} data-testid="input-package-name" /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={packageForm.control} name="description" render={({ field }) => (
                      <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea {...field} data-testid="input-package-description" /></FormControl><FormMessage /></FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={packageForm.control} name="frequency" render={({ field }) => (
                        <FormItem><FormLabel>Frequency</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger data-testid="select-package-frequency"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="weekly">Weekly</SelectItem>
                              <SelectItem value="biweekly">Bi-Weekly</SelectItem>
                              <SelectItem value="monthly">Monthly</SelectItem>
                              <SelectItem value="one_time">One-Time</SelectItem>
                            </SelectContent>
                          </Select><FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={packageForm.control} name="basePrice" render={({ field }) => (
                        <FormItem><FormLabel>Package Price ($)</FormLabel><FormControl><Input type="number" step="0.01" {...field} data-testid="input-package-price" /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                    <FormField control={packageForm.control} name="includedItemsText" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Included Items (one per line)</FormLabel>
                        <FormControl><Textarea {...field} placeholder={"Weekly scooping\nDeodorizing treatment\nUp to 2 dogs"} data-testid="input-package-items" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <Button type="submit" disabled={createPackageMutation.isPending} data-testid="button-submit-package">
                      {createPackageMutation.isPending ? "Creating..." : "Create Package"}
                    </Button>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {packagesLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
            </div>
          ) : packages && packages.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {packages.map((pkg) => (
                <Card key={pkg.id} data-testid={`package-card-${pkg.id}`}>
                  <CardHeader className="flex flex-row items-start justify-between gap-2">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">{pkg.name}</CardTitle>
                      {pkg.description && (
                        <p className="text-sm text-muted-foreground">{pkg.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="text-xl font-bold">${parseFloat(pkg.basePrice).toFixed(2)}</p>
                      <span className="text-sm text-muted-foreground">/{pkg.frequency === "one_time" ? "one-time" : pkg.frequency}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(pkg.includedItems as string[])?.length > 0 && (
                      <ul className="space-y-1">
                        {(pkg.includedItems as string[]).map((item, i) => (
                          <li key={i} className="text-sm flex items-center gap-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={pkg.isActive}
                          onCheckedChange={(checked) => handlePackageToggleActive(pkg.id, checked)}
                          data-testid={`switch-package-active-${pkg.id}`}
                        />
                        <span className="text-sm text-muted-foreground">{pkg.isActive ? "Active" : "Inactive"}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deletePackageMutation.mutate(pkg.id)}
                        data-testid={`button-delete-package-${pkg.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-6 text-center">
                <Package className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  No packages yet. Confirm your pricing above to auto-generate packages, or add one manually.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
