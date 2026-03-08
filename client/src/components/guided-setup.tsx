import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
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
  Users,
  DollarSign,
  Calendar,
  MapPin,
  CheckCircle2,
  Circle,
  ArrowRight,
  Loader2,
  PartyPopper,
  X,
} from "lucide-react";
import { AddressAutocomplete } from "@/components/address-autocomplete";

type OnboardingStep = {
  key: string;
  label: string;
  completed: boolean;
};

type OnboardingStatus = {
  isComplete: boolean;
  steps: OnboardingStep[];
  firstContact: { id: string; firstName: string; lastName: string } | null;
  firstProperty: {
    id: string;
    streetAddress: string;
    city: string;
    state: string;
    yardSize: string;
    numberOfDogs: number;
    measuredYardSqft: number | null;
  } | null;
  firstServicePlan: { id: string; routeId: string | null } | null;
};

type PricingResult = {
  recommendedPriceCents: number;
  minimumPriceCents: number;
  premiumPriceCents: number;
  breakdown: {
    laborCostCents: number;
    travelCostCents: number;
    equipmentCostCents: number;
    overheadPerVisitCents: number;
  };
  derived: {
    profitAtRecommendedCents: number;
    jobMinutes: number;
  };
};

const customerFormSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  streetAddress: z.string().min(1, "Address is required"),
  city: z.string().optional().or(z.literal("")),
  state: z.string().optional().or(z.literal("")),
  zipCode: z.string().optional().or(z.literal("")),
  yardSize: z.string().min(1, "Yard size is required"),
  numberOfDogs: z.coerce.number().min(1, "At least 1 dog"),
  serviceFrequency: z.string().min(1, "Frequency is required"),
  serviceDay: z.string().min(1, "Service day is required"),
});

type CustomerFormValues = z.infer<typeof customerFormSchema>;

const STEP_ICONS = [Users, DollarSign, Calendar, MapPin];
const STEP_LABELS = [
  "Add your first customer",
  "Price your first property",
  "Create your first service plan",
  "Generate your first route",
];

const DAYS = [
  { value: "tbd", label: "TBD" },
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
];

const YARD_SIZES = [
  { value: "Small", label: "Small (under 3,000 sqft)" },
  { value: "Standard", label: "Standard (3,000-7,000 sqft)" },
  { value: "Large", label: "Large (7,000-15,000 sqft)" },
  { value: "Extra Large", label: "Extra Large (15,000+ sqft)" },
];

const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
];

function frequencyToVisitsPerMonth(freq: string): number {
  switch (freq) {
    case "weekly": return 4.33;
    case "biweekly": return 2.17;
    case "monthly": return 1;
    default: return 4.33;
  }
}

function cents(c: number): string {
  return `$${(c / 100).toFixed(2)}`;
}

interface GuidedSetupProps {
  onboarding: OnboardingStatus;
}

export default function GuidedSetup({ onboarding }: GuidedSetupProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [activeStep, setActiveStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const [createdContactId, setCreatedContactId] = useState<string | null>(onboarding.firstContact?.id || null);
  const [createdContactName, setCreatedContactName] = useState<string>(
    onboarding.firstContact ? `${onboarding.firstContact.firstName} ${onboarding.firstContact.lastName}` : ""
  );
  const [createdPropertyId, setCreatedPropertyId] = useState<string | null>(onboarding.firstProperty?.id || null);
  const [propertyAddress, setPropertyAddress] = useState<string>(onboarding.firstProperty?.streetAddress || "");
  const [customerFrequency, setCustomerFrequency] = useState<string>("weekly");
  const [customerDay, setCustomerDay] = useState<string>("monday");
  const [customerYardSize, setCustomerYardSize] = useState<string>("");
  const [customerDogCount, setCustomerDogCount] = useState<number>(1);

  const [pricingResult, setPricingResult] = useState<PricingResult | null>(null);
  const [selectedPrice, setSelectedPrice] = useState<number>(0);
  const [customPrice, setCustomPrice] = useState<string>("");

  const [createdPlanId, setCreatedPlanId] = useState<string | null>(onboarding.firstServicePlan?.id || null);
  const [completionData, setCompletionData] = useState<{ routeName: string; visitCount: number } | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);

  useEffect(() => {
    const firstIncomplete = onboarding.steps.findIndex(s => !s.completed);
    if (firstIncomplete >= 0) {
      setActiveStep((prev) => Math.max(prev, firstIncomplete));
    } else {
      setActiveStep(onboarding.steps.length);
    }

    if (onboarding.firstContact && !createdContactId) {
      setCreatedContactId(onboarding.firstContact.id);
      setCreatedContactName(`${onboarding.firstContact.firstName} ${onboarding.firstContact.lastName}`);
    }
    if (onboarding.firstProperty && !createdPropertyId) {
      setCreatedPropertyId(onboarding.firstProperty.id);
      setPropertyAddress(onboarding.firstProperty.streetAddress || "");
      setCustomerYardSize(onboarding.firstProperty.yardSize || "");
      setCustomerDogCount(onboarding.firstProperty.numberOfDogs || 1);
    }
    if (onboarding.firstServicePlan && !createdPlanId) {
      setCreatedPlanId(onboarding.firstServicePlan.id);
    }
  }, [onboarding]);

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      streetAddress: "",
      city: "",
      state: "",
      zipCode: "",
      yardSize: "",
      numberOfDogs: 1,
      serviceFrequency: "weekly",
      serviceDay: "monday",
    },
  });

  const createContactMutation = useMutation({
    mutationFn: async (data: CustomerFormValues) => {
      const res = await apiRequest("POST", "/api/contacts", {
        firstName: data.firstName,
        lastName: data.lastName,
        streetAddress: data.streetAddress,
        city: data.city,
        state: data.state,
        zipCode: data.zipCode,
        yardSize: data.yardSize,
        numberOfDogs: Number(data.numberOfDogs) || 1,
        serviceFrequency: data.serviceFrequency,
        serviceDay: data.serviceDay,
        status: "active",
      });
      return res.json();
    },
    onSuccess: async (data: any) => {
      const freq = form.getValues("serviceFrequency");
      const day = form.getValues("serviceDay");
      const yard = form.getValues("yardSize");
      const dogs = Number(form.getValues("numberOfDogs")) || 1;
      setCreatedContactId(data.id);
      setCreatedContactName(`${data.firstName} ${data.lastName}`);
      setCustomerFrequency(freq);
      setCustomerDay(day);
      setCustomerYardSize(yard);
      setCustomerDogCount(dogs);

      let propId: string | null = null;
      const token = localStorage.getItem("sessionToken");
      const authHeaders: Record<string, string> = {};
      if (token) authHeaders["Authorization"] = `Bearer ${token}`;

      const propsRes = await fetch(`/api/properties?contactId=${data.id}`, {
        credentials: "include",
        headers: authHeaders,
      });
      if (propsRes.ok) {
        const props = await propsRes.json();
        if (props.length > 0) {
          propId = props[0].id;
          setCreatedPropertyId(propId);
          setPropertyAddress(props[0].streetAddress || "");
        }
      }

      if (!propId) {
        const createPropRes = await fetch("/api/properties", {
          method: "POST",
          credentials: "include",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({
            contactId: data.id,
            streetAddress: data.streetAddress || "Primary",
            city: data.city || "",
            state: data.state || "",
            zipCode: data.zipCode || "",
            yardSize: yard,
            numberOfDogs: dogs,
          }),
        });
        if (createPropRes.ok) {
          const prop = await createPropRes.json();
          propId = prop.id;
          setCreatedPropertyId(propId);
          setPropertyAddress(prop.streetAddress || "");
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setActiveStep(1);
      toast({ title: "Customer added" });

      runPriceCalculation(propId, yard, dogs, freq);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add customer", description: err.message, variant: "destructive" });
    },
  });

  const runPriceCalculation = async (propId?: string | null, yardSize?: string, dogCount?: number, freq?: string) => {
    setPricingLoading(true);
    try {
      const res = await apiRequest("POST", "/api/pricing/calculate", {
        propertyId: propId || undefined,
        yardSizeLabel: yardSize || customerYardSize || "Standard",
        dogCount: Number(dogCount || customerDogCount) || 1,
        serviceFrequency: freq || customerFrequency || "weekly",
        yardDifficulty: "flat",
        distanceFromNearestStopMiles: 2,
      });
      const data: PricingResult = await res.json();
      setPricingResult(data);
      setSelectedPrice(data.recommendedPriceCents);
      setCustomPrice((data.recommendedPriceCents / 100).toFixed(2));
    } catch (err: any) {
      toast({ title: "Pricing calculation failed", description: err.message, variant: "destructive" });
    } finally {
      setPricingLoading(false);
    }
  };

  const calculatePriceMutation = useMutation({
    mutationFn: () => runPriceCalculation(createdPropertyId, customerYardSize, customerDogCount, customerFrequency),
  });

  useEffect(() => {
    if (activeStep === 1 && !pricingResult && onboarding.firstProperty) {
      runPriceCalculation(onboarding.firstProperty.id, onboarding.firstProperty.yardSize, onboarding.firstProperty.numberOfDogs || 1, customerFrequency);
    }
  }, [activeStep]);

  const acceptPriceMutation = useMutation({
    mutationFn: async () => {
      if (createdPropertyId) {
        await apiRequest("POST", "/api/pricing/calculate-and-save", {
          propertyId: createdPropertyId,
          yardSizeLabel: customerYardSize,
          dogCount: Number(customerDogCount) || 1,
          serviceFrequency: customerFrequency,
          yardDifficulty: "flat",
          distanceFromNearestStopMiles: 2,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      setActiveStep(2);
    },
    onError: (err: Error) => {
      setActiveStep(2);
      toast({ title: "Price saved locally", description: "Continuing to next step." });
    },
  });

  const createServicePlanMutation = useMutation({
    mutationFn: async () => {
      if (!createdContactId || !createdPropertyId) {
        throw new Error("Customer or property data is missing. Please go back and try again.");
      }
      if (selectedPrice <= 0) {
        throw new Error("Please set a valid price first.");
      }

      const today = new Date();
      const dayIndex = DAYS.findIndex(d => d.value === customerDay);
      const todayDay = today.getDay();
      const targetDay = dayIndex === 6 ? 0 : dayIndex + 1;
      let daysUntil = targetDay - todayDay;
      if (daysUntil <= 0) daysUntil += 7;
      const startDate = new Date(today);
      startDate.setDate(today.getDate() + daysUntil);
      const startDateStr = startDate.toISOString().split("T")[0];

      const res = await apiRequest("POST", "/api/service-plans", {
        contactId: createdContactId,
        propertyId: createdPropertyId,
        frequency: customerFrequency,
        pricePerVisit: (selectedPrice / 100).toFixed(2),
        dayOfWeek: customerDay,
        startDate: startDateStr,
        isActive: true,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setCreatedPlanId(data.id);
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
      setActiveStep(3);
      toast({ title: "Service plan created" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create service plan", description: err.message, variant: "destructive" });
    },
  });

  const generateRouteMutation = useMutation({
    mutationFn: async () => {
      if (!createdPlanId) {
        throw new Error("Service plan not found. Please go back and create one first.");
      }
      const dayLabel = DAYS.find(d => d.value === customerDay)?.label || "Monday";
      const routeRes = await apiRequest("POST", "/api/routes", {
        name: `${dayLabel} Route`,
        dayOfWeek: customerDay,
        color: "#3B7A57",
      });
      const route = await routeRes.json();

      const planId = createdPlanId;
      if (planId) {
        await apiRequest("PATCH", `/api/service-plans/${planId}`, {
          routeId: route.id,
        });
      }

      const today = new Date();
      const endDate = new Date(today);
      endDate.setDate(today.getDate() + 28);
      const visitsRes = await apiRequest("POST", "/api/visits/generate", {
        startDate: today.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
      });
      const visitsData = await visitsRes.json();

      return { routeName: route.name, visitCount: visitsData.generated || 0 };
    },
    onSuccess: (data) => {
      setCompletionData(data);
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/visits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
      setActiveStep(4);
      toast({ title: "Route created with visits" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to generate route", description: err.message, variant: "destructive" });
    },
  });

  const completedCount = onboarding.steps.filter(s => s.completed).length + 
    (activeStep > onboarding.steps.findIndex(s => !s.completed) ? 
      activeStep - onboarding.steps.findIndex(s => !s.completed) : 0);
  const effectiveCompleted = Math.min(activeStep, 4);
  const progress = (effectiveCompleted / 4) * 100;

  if (dismissed || onboarding.isComplete) return null;

  const handleCustomPriceChange = (val: string) => {
    setCustomPrice(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed > 0) {
      setSelectedPrice(Math.round(parsed * 100));
    }
  };

  const visitsPerMonth = frequencyToVisitsPerMonth(customerFrequency);

  return (
    <Card className="border-primary/20 shadow-md" data-testid="guided-setup">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl" data-testid="text-setup-title">Set up your business in 3 minutes</CardTitle>
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-setup-progress-label">
              {effectiveCompleted} of 4 complete
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDismissed(true)}
            className="text-muted-foreground"
            data-testid="button-skip-setup"
          >
            <X className="h-4 w-4 mr-1" />
            Skip
          </Button>
        </div>
        <Progress value={progress} className="h-2 mt-3" data-testid="progress-setup" />
      </CardHeader>
      <CardContent className="space-y-3">
        {[0, 1, 2, 3].map((stepIdx) => {
          const Icon = STEP_ICONS[stepIdx];
          const isCompleted = stepIdx < activeStep;
          const isActive = stepIdx === activeStep;
          const isLocked = stepIdx > activeStep;

          return (
            <div
              key={stepIdx}
              className={`rounded-lg border transition-all ${
                isActive ? "border-primary/30 bg-primary/5 shadow-sm" :
                isCompleted ? "border-transparent bg-muted/30" :
                "border-transparent opacity-50"
              }`}
              data-testid={`setup-step-${stepIdx}`}
            >
              <button
                className="w-full flex items-center gap-3 p-4 text-left"
                disabled={isLocked}
                onClick={() => isCompleted && setActiveStep(stepIdx)}
                data-testid={`button-step-header-${stepIdx}`}
              >
                <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${
                  isCompleted ? "bg-primary text-primary-foreground" :
                  isActive ? "bg-primary/10 text-primary" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {isCompleted ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <span className="text-sm font-semibold">{stepIdx + 1}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${isCompleted ? "line-through text-muted-foreground" : ""}`}>
                    {STEP_LABELS[stepIdx]}
                  </p>
                </div>
                {isActive && <Icon className="h-5 w-5 text-primary flex-shrink-0" />}
              </button>

              {isActive && stepIdx === 0 && (
                <div className="px-4 pb-4" data-testid="step-0-form">
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit((data) => createContactMutation.mutate(data))} className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <FormField
                          control={form.control}
                          name="firstName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>First Name</FormLabel>
                              <FormControl>
                                <Input {...field} placeholder="John" data-testid="input-first-name" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="lastName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Last Name</FormLabel>
                              <FormControl>
                                <Input {...field} placeholder="Smith" data-testid="input-last-name" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name="streetAddress"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Street Address</FormLabel>
                            <FormControl>
                              <AddressAutocomplete
                                value={field.value}
                                onChange={field.onChange}
                                onSelect={(addr) => {
                                  form.setValue("streetAddress", addr.streetAddress);
                                  form.setValue("city", addr.city);
                                  form.setValue("state", addr.state);
                                  form.setValue("zipCode", addr.zipCode);
                                }}
                                placeholder="Start typing an address..."
                                data-testid="input-address"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="grid grid-cols-2 gap-3">
                        <FormField
                          control={form.control}
                          name="yardSize"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Yard Size</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger data-testid="select-yard-size">
                                    <SelectValue placeholder="Select size" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {YARD_SIZES.map((s) => (
                                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="numberOfDogs"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Number of Dogs</FormLabel>
                              <FormControl>
                                <Input type="number" min={1} max={20} {...field} data-testid="input-dog-count" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <FormField
                          control={form.control}
                          name="serviceFrequency"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Service Frequency</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger data-testid="select-frequency">
                                    <SelectValue placeholder="Select frequency" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {FREQUENCIES.map((f) => (
                                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="serviceDay"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Service Day</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger data-testid="select-service-day">
                                    <SelectValue placeholder="Select day" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {DAYS.map((d) => (
                                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <Button
                        type="submit"
                        className="w-full gap-2"
                        disabled={createContactMutation.isPending}
                        data-testid="button-add-customer"
                      >
                        {createContactMutation.isPending ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /> Adding...</>
                        ) : (
                          <>Add Customer <ArrowRight className="h-4 w-4" /></>
                        )}
                      </Button>
                    </form>
                  </Form>
                </div>
              )}

              {isActive && stepIdx === 1 && (
                <div className="px-4 pb-4 space-y-4" data-testid="step-1-pricing">
                  {(pricingLoading || calculatePriceMutation.isPending) ? (
                    <div className="space-y-3">
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : pricingResult ? (
                    <>
                      <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 text-center space-y-2">
                        <p className="text-sm text-muted-foreground">Recommended price</p>
                        <p className="text-3xl font-bold text-primary" data-testid="text-recommended-price">
                          {cents(pricingResult.recommendedPriceCents)}
                        </p>
                        <p className="text-xs text-muted-foreground">per visit</p>
                      </div>

                      <div className="rounded-lg bg-muted/50 border p-4 text-center space-y-1">
                        <p className="text-sm text-muted-foreground">Estimated monthly profit</p>
                        <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-monthly-profit">
                          {cents(Math.round(pricingResult.derived.profitAtRecommendedCents * visitsPerMonth))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {cents(pricingResult.derived.profitAtRecommendedCents)} profit x {visitsPerMonth.toFixed(1)} visits/month
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-muted/30 rounded p-2 text-center">
                          <p className="text-muted-foreground">Cost per visit</p>
                          <p className="font-medium">{cents(pricingResult.minimumPriceCents)}</p>
                        </div>
                        <div className="bg-muted/30 rounded p-2 text-center">
                          <p className="text-muted-foreground">Est. time</p>
                          <p className="font-medium">{Math.round(pricingResult.derived.jobMinutes)} min</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground mb-1 block">Your price</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                            <Input
                              type="number"
                              step="0.01"
                              min="1"
                              value={customPrice}
                              onChange={(e) => handleCustomPriceChange(e.target.value)}
                              className="pl-7"
                              data-testid="input-custom-price"
                            />
                          </div>
                        </div>
                        <Button
                          onClick={() => acceptPriceMutation.mutate()}
                          disabled={acceptPriceMutation.isPending || selectedPrice <= 0}
                          className="gap-2 mt-5"
                          data-testid="button-use-price"
                        >
                          {acceptPriceMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>Use this price <ArrowRight className="h-4 w-4" /></>
                          )}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-sm text-muted-foreground">Unable to calculate pricing. Please try again.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => calculatePriceMutation.mutate()}
                        data-testid="button-retry-pricing"
                      >
                        Retry
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {isActive && stepIdx === 2 && (
                <div className="px-4 pb-4 space-y-3" data-testid="step-2-service-plan">
                  <div className="rounded-lg bg-muted/30 border p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Customer</span>
                      <span className="font-medium" data-testid="text-plan-customer">{createdContactName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Property</span>
                      <span className="font-medium" data-testid="text-plan-address">{propertyAddress || "Primary property"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Frequency</span>
                      <span className="font-medium capitalize" data-testid="text-plan-frequency">{customerFrequency}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Price per visit</span>
                      <span className="font-medium" data-testid="text-plan-price">{cents(selectedPrice)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Service day</span>
                      <span className="font-medium capitalize" data-testid="text-plan-day">{customerDay}</span>
                    </div>
                  </div>
                  <Button
                    className="w-full gap-2"
                    onClick={() => createServicePlanMutation.mutate()}
                    disabled={createServicePlanMutation.isPending}
                    data-testid="button-create-plan"
                  >
                    {createServicePlanMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</>
                    ) : (
                      <>Create Service Plan <ArrowRight className="h-4 w-4" /></>
                    )}
                  </Button>
                </div>
              )}

              {isActive && stepIdx === 3 && (
                <div className="px-4 pb-4 space-y-3" data-testid="step-3-route">
                  <p className="text-sm text-muted-foreground">
                    We'll create a {DAYS.find(d => d.value === customerDay)?.label || customerDay} route, 
                    assign your service plan to it, and generate visits for the next 4 weeks.
                  </p>
                  <Button
                    className="w-full gap-2"
                    onClick={() => generateRouteMutation.mutate()}
                    disabled={generateRouteMutation.isPending}
                    data-testid="button-generate-route"
                  >
                    {generateRouteMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
                    ) : (
                      <>Generate Route and Visits <ArrowRight className="h-4 w-4" /></>
                    )}
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {activeStep >= 4 && (
          <div className="rounded-lg bg-primary/5 border border-primary/20 p-6 text-center space-y-3" data-testid="setup-complete">
            <PartyPopper className="h-10 w-10 text-primary mx-auto" />
            <h3 className="text-lg font-bold" data-testid="text-setup-complete-title">You're all set!</h3>
            <p className="text-sm text-muted-foreground" data-testid="text-setup-complete-description">
              {completionData
                ? `Your "${completionData.routeName}" has 1 stop and ${completionData.visitCount} upcoming visits.`
                : "Your business is ready to go."}
            </p>
            <div className="flex gap-2 justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
                }}
                data-testid="button-done-dashboard"
              >
                Stay on Dashboard
              </Button>
              <Button
                onClick={() => navigate("/routes")}
                className="gap-1"
                data-testid="button-view-routes"
              >
                View Route Builder <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
