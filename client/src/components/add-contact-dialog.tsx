/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { isValidPostalCode } from "@shared/postal";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  CalendarDays,
  Send,
  CheckCircle2,
  Minus,
  Plus,
  Sparkles,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const FREQUENCIES = [
  { value: "1_per_week", label: "Weekly" },
  { value: "2_per_week", label: "2x / Week" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "as_needed", label: "As needed" },
];

const DAYS = [
  { value: "monday", label: "M" },
  { value: "tuesday", label: "T" },
  { value: "wednesday", label: "W" },
  { value: "thursday", label: "T" },
  { value: "friday", label: "F" },
  { value: "saturday", label: "S" },
  { value: "sunday", label: "S" },
];

const contactFormSchema = z
  .object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().optional().or(z.literal("")),
    phone: z.string().optional().or(z.literal("")),
    email: z.string().email("Enter a valid email").optional().or(z.literal("")),
    streetAddress: z.string().optional().or(z.literal("")),
    address2: z.string().optional().or(z.literal("")),
    city: z.string().optional().or(z.literal("")),
    state: z.string().optional().or(z.literal("")),
    zipCode: z
      .string()
      .optional()
      .or(z.literal(""))
      .refine(
        (v) => !v || isValidPostalCode(v),
        "Enter a valid ZIP or postal code (e.g. 12345 or V6B 2X3)"
      ),
    serviceFrequency: z.string().optional().or(z.literal("")),
    numberOfDogs: z.number().min(0).optional(),
    serviceDay: z.string().optional().or(z.literal("")),
    notes: z.string().optional().or(z.literal("")),
    status: z.enum(["lead", "estimate", "active", "paused", "cancelled"]),
    contactType: z.enum(["residential", "commercial"]),
    companyName: z.string().optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if (data.contactType === "commercial" && !data.companyName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Company name is required for commercial contacts",
        path: ["companyName"],
      });
    }
  });

type ContactFormValues = z.infer<typeof contactFormSchema>;

interface AddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddContactDialog({ open, onOpenChange }: AddContactDialogProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<1 | 2>(1);
  const [createdContact, setCreatedContact] = useState<{ id: string; firstName: string } | null>(
    null
  );
  const [sendingPortalInvite, setSendingPortalInvite] = useState(false);
  const [addressCoords, setAddressCoords] = useState<{ lat: string; lng: string } | null>(null);
  const [suggestedDay, setSuggestedDay] = useState<string | null>(null);
  const [isFetchingSuggestion, setIsFetchingSuggestion] = useState(false);
  const [suppressNotifications, setSuppressNotifications] = useState(false);
  const scheduleNowRef = useRef(false);
  const servicePrefRef = useRef<{ frequency: string; serviceDay: string }>({
    frequency: "",
    serviceDay: "",
  });

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      phone: "",
      email: "",
      streetAddress: "",
      address2: "",
      city: "",
      state: "",
      zipCode: "",
      serviceFrequency: "",
      numberOfDogs: undefined,
      serviceDay: "",
      notes: "",
      status: "lead",
      contactType: "residential",
      companyName: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: ContactFormValues & { suppressNotifications?: boolean }) => {
      const res = await apiRequest("POST", "/api/contacts", data);
      return res.json();
    },
    onSuccess: (result: Record<string, unknown>) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      form.reset();
      if (scheduleNowRef.current) {
        handleClose();
        const params = new URLSearchParams({ addJob: "1", contactId: result.id as string });
        if (servicePrefRef.current.frequency)
          params.set("frequency", servicePrefRef.current.frequency);
        if (servicePrefRef.current.serviceDay)
          params.set("serviceDay", servicePrefRef.current.serviceDay);
        navigate(`/scheduling?${params.toString()}`);
      } else {
        setCreatedContact({ id: result.id as string, firstName: result.firstName as string });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error creating customer",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    form.reset();
    setStep(1);
    setCreatedContact(null);
    setSendingPortalInvite(false);
    setAddressCoords(null);
    setSuggestedDay(null);
    setSuppressNotifications(false);
    onOpenChange(false);
  };

  const handleNavigateAction = (path: string) => {
    handleClose();
    navigate(path);
  };

  const handleSendPortalInvite = async () => {
    if (!createdContact) return;
    setSendingPortalInvite(true);
    try {
      await apiRequest("POST", "/api/contacts/bulk/send-portal-link", {
        contactIds: [createdContact.id],
      });
      toast({
        title: "Portal invite sent",
        description: `Invite sent to ${createdContact.firstName}.`,
      });
      handleClose();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setSendingPortalInvite(false);
    }
  };

  const goToStep2 = async () => {
    const fieldsToValidate: (keyof ContactFormValues)[] = ["firstName", "email"];
    if (form.getValues("contactType") === "commercial") fieldsToValidate.push("companyName");
    const valid = await form.trigger(fieldsToValidate);
    if (!valid) return;
    setStep(2);
    if (addressCoords) {
      setIsFetchingSuggestion(true);
      try {
        const res = await apiRequest(
          "GET",
          `/api/routes/suggest-day?lat=${addressCoords.lat}&lng=${addressCoords.lng}`
        );
        const data = await res.json();
        if (data?.day) {
          setSuggestedDay(data.day);
          if (!form.getValues("serviceDay")) {
            form.setValue("serviceDay", data.day);
          }
        }
      } catch {
        /* suggestion is best-effort */
      } finally {
        setIsFetchingSuggestion(false);
      }
    }
  };

  const submitGuardRef = useRef(false);
  const submit = async (scheduleNow: boolean) => {
    if (submitGuardRef.current || createMutation.isPending) return;
    const fieldsToValidate: (keyof ContactFormValues)[] = ["firstName", "email"];
    if (form.getValues("contactType") === "commercial") fieldsToValidate.push("companyName");
    const valid = await form.trigger(fieldsToValidate);
    if (!valid) {
      setStep(1);
      return;
    }
    submitGuardRef.current = true;
    scheduleNowRef.current = scheduleNow;
    const values = form.getValues();
    servicePrefRef.current = {
      frequency: values.serviceFrequency || "",
      serviceDay: values.serviceDay || "",
    };
    createMutation.mutate(
      { ...values, suppressNotifications },
      { onSettled: () => { submitGuardRef.current = false; } }
    );
  };

  const frequency = form.watch("serviceFrequency") || "";
  const serviceDay = form.watch("serviceDay") || "";
  const dogs = form.watch("numberOfDogs") ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleClose();
        else onOpenChange(isOpen);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Customer</DialogTitle>
        </DialogHeader>

        {createdContact ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <p className="font-medium" data-testid="text-customer-created-success">
                {createdContact.firstName} was added successfully!
              </p>
            </div>
            <p className="text-sm text-muted-foreground">What would you like to do next?</p>
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                data-testid="button-next-schedule-service"
                onClick={() =>
                  handleNavigateAction(`/scheduling?addJob=1&contactId=${createdContact.id}`)
                }
              >
                <CalendarDays className="h-4 w-4 text-blue-600" />
                Schedule a Service
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                data-testid="button-next-create-quote"
                onClick={() =>
                  handleNavigateAction(`/quotes?create=true&contactId=${createdContact.id}`)
                }
              >
                <FileText className="h-4 w-4 text-green-600" />
                Create a Quote
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                data-testid="button-next-send-portal"
                disabled={sendingPortalInvite}
                onClick={handleSendPortalInvite}
              >
                <Send className="h-4 w-4 text-purple-600" />
                {sendingPortalInvite ? "Sending..." : "Send Portal Invite"}
              </Button>
            </div>
            <Button
              variant="ghost"
              className="w-full"
              data-testid="button-next-done"
              onClick={handleClose}
            >
              Done
            </Button>
          </div>
        ) : (
          <Form {...form}>
            <form className="space-y-5">
              <StepIndicator current={step} />

              {step === 1 ? (
                <Step1
                  form={form}
                  isPending={createMutation.isPending}
                  suppressNotifications={suppressNotifications}
                  onSuppressChange={setSuppressNotifications}
                  onContinue={goToStep2}
                  onSaveAndFinish={() => submit(false)}
                  onAddressSelect={(lat, lng) => {
                    setAddressCoords({ lat, lng });
                    setSuggestedDay(null);
                  }}
                />
              ) : (
                <Step2
                  form={form}
                  frequency={frequency}
                  serviceDay={serviceDay}
                  dogs={dogs}
                  isPending={createMutation.isPending}
                  suggestedDay={suggestedDay}
                  isFetchingSuggestion={isFetchingSuggestion}
                  suppressNotifications={suppressNotifications}
                  onSuppressChange={setSuppressNotifications}
                  onBack={() => setStep(1)}
                  onCreateAndSchedule={() => submit(true)}
                  onCreateOnly={() => submit(false)}
                />
              )}
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StepIndicator({ current }: { current: 1 | 2 }) {
  return (
    <div className="flex items-center gap-2" aria-label="Step indicator">
      <div
        className={cn(
          "flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold",
          current === 1 ? "bg-primary text-primary-foreground" : "bg-primary/20 text-primary"
        )}
      >
        1
      </div>
      <div className="flex-1 h-px bg-border" />
      <div
        className={cn(
          "flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold",
          current === 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        2
      </div>
      <span className="text-xs text-muted-foreground ml-1">
        {current === 1 ? "Customer info" : "Service setup"}
      </span>
    </div>
  );
}

function Step1({
  form,
  isPending,
  suppressNotifications,
  onSuppressChange,
  onContinue,
  onSaveAndFinish,
  onAddressSelect,
}: {
  form: ReturnType<typeof useForm<ContactFormValues>>;
  isPending: boolean;
  suppressNotifications: boolean;
  onSuppressChange: (val: boolean) => void;
  onContinue: () => void;
  onSaveAndFinish: () => void;
  onAddressSelect: (lat: string, lng: string) => void;
}) {
  const contactType = form.watch("contactType");

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Customer type</p>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="toggle-type-residential"
            onClick={() => form.setValue("contactType", "residential")}
            className={cn(
              "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              contactType === "residential"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-foreground hover:bg-muted"
            )}
          >
            Residential
          </button>
          <button
            type="button"
            data-testid="toggle-type-commercial"
            onClick={() => form.setValue("contactType", "commercial")}
            className={cn(
              "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              contactType === "commercial"
                ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                : "border-border bg-background text-foreground hover:bg-muted"
            )}
          >
            Commercial
          </button>
        </div>
      </div>

      <FormField
        control={form.control}
        name="companyName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Company / Business name
              {contactType === "commercial" && <span className="text-destructive ml-1">*</span>}
            </FormLabel>
            <FormControl>
              <Input
                {...field}
                data-testid="input-company-name"
                placeholder="Acme Property Management"
                className="h-11"
                onChange={(e) => {
                  field.onChange(e);
                  const val = e.target.value.trim();
                  if (val) {
                    form.setValue("contactType", "commercial");
                  } else {
                    form.setValue("contactType", "residential");
                  }
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-2 gap-3">
        <FormField
          control={form.control}
          name="firstName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                First name <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  data-testid="input-first-name"
                  autoFocus
                  placeholder="Jane"
                  className="h-11"
                />
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
              <FormLabel>Last name</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  data-testid="input-last-name"
                  placeholder="Smith"
                  className="h-11"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="phone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Phone</FormLabel>
            <FormControl>
              <Input
                {...field}
                type="tel"
                inputMode="tel"
                data-testid="input-phone"
                placeholder="(555) 555-5555"
                className="h-11"
                onChange={(e) => field.onChange(formatPhone(e.target.value))}
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
            <FormLabel>Email</FormLabel>
            <FormControl>
              <Input
                {...field}
                type="email"
                inputMode="email"
                data-testid="input-email"
                placeholder="jane@example.com"
                className="h-11"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="streetAddress"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-base font-medium">Service address</FormLabel>
            <FormControl>
              <AddressAutocomplete
                value={field.value || ""}
                onChange={field.onChange}
                onSelect={(addr) => {
                  form.setValue("streetAddress", addr.streetAddress);
                  form.setValue("city", addr.city);
                  form.setValue("state", addr.state);
                  form.setValue("zipCode", addr.zipCode);
                  if (addr.latitude && addr.longitude) {
                    onAddressSelect(addr.latitude, addr.longitude);
                  }
                }}
                placeholder="Start typing an address..."
                data-testid="input-street-address"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="address2"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <Input
                {...field}
                data-testid="input-address2"
                placeholder="Apt, Suite, Unit (optional)"
                className="h-11"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="flex items-center gap-2 py-1 border-t pt-3 mt-1">
        <Switch
          id="suppress-notifications-step1"
          checked={suppressNotifications}
          onCheckedChange={onSuppressChange}
          data-testid="switch-suppress-notifications"
        />
        <Label
          htmlFor="suppress-notifications-step1"
          className="text-sm text-muted-foreground cursor-pointer"
        >
          Suppress notifications
        </Label>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          className="w-full h-11"
          onClick={onContinue}
          data-testid="button-continue-to-step2"
        >
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
          onClick={onSaveAndFinish}
          disabled={isPending}
          data-testid="button-save-and-finish-later"
        >
          {isPending ? "Saving..." : "Save & finish later"}
        </button>
      </div>
    </div>
  );
}

function Step2({
  form,
  frequency,
  serviceDay,
  dogs,
  isPending,
  suggestedDay,
  isFetchingSuggestion,
  suppressNotifications,
  onSuppressChange,
  onBack,
  onCreateAndSchedule,
  onCreateOnly,
}: {
  form: ReturnType<typeof useForm<ContactFormValues>>;
  frequency: string;
  serviceDay: string;
  dogs: number;
  isPending: boolean;
  suggestedDay: string | null;
  isFetchingSuggestion: boolean;
  suppressNotifications: boolean;
  onSuppressChange: (val: boolean) => void;
  onBack: () => void;
  onCreateAndSchedule: () => void;
  onCreateOnly: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">Service frequency</p>
        <div className="grid grid-cols-2 gap-2">
          {FREQUENCIES.map((f) => (
            <button
              key={f.value}
              type="button"
              data-testid={`pill-frequency-${f.value}`}
              onClick={() =>
                form.setValue("serviceFrequency", frequency === f.value ? "" : f.value)
              }
              className={cn(
                "rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors text-center",
                frequency === f.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-foreground hover:bg-muted"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Preferred service day</p>
          {isFetchingSuggestion && (
            <span className="text-xs text-muted-foreground animate-pulse">Finding best day…</span>
          )}
          {!isFetchingSuggestion && suggestedDay && (
            <span className="flex items-center gap-1 text-xs text-primary font-medium">
              <Sparkles className="h-3 w-3" />
              Suggested for your area
            </span>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {DAYS.map((d) => (
            <button
              key={d.value}
              type="button"
              data-testid={`pill-day-${d.value}`}
              onClick={() => form.setValue("serviceDay", serviceDay === d.value ? "" : d.value)}
              className={cn(
                "w-9 h-9 rounded-full border text-sm font-medium transition-colors",
                serviceDay === d.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-foreground hover:bg-muted",
                suggestedDay === d.value && serviceDay !== d.value && "ring-2 ring-primary/30"
              )}
            >
              {d.label}
            </button>
          ))}
          <button
            type="button"
            data-testid="pill-day-tbd"
            onClick={() => form.setValue("serviceDay", serviceDay === "tbd" ? "" : "tbd")}
            className={cn(
              "h-9 px-3 rounded-full border text-xs font-medium transition-colors",
              serviceDay === "tbd"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:bg-muted"
            )}
          >
            TBD
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Number of dogs</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-testid="button-dogs-decrement"
            onClick={() => form.setValue("numberOfDogs", Math.max(0, dogs - 1))}
            className="w-9 h-9 rounded-full border flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-40"
            disabled={dogs <= 0}
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-8 text-center text-lg font-semibold" data-testid="text-dogs-count">
            {dogs}
          </span>
          <button
            type="button"
            data-testid="button-dogs-increment"
            onClick={() => form.setValue("numberOfDogs", dogs + 1)}
            className="w-9 h-9 rounded-full border flex items-center justify-center hover:bg-muted transition-colors"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <FormField
        control={form.control}
        name="notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Notes <span className="text-muted-foreground font-normal">(optional)</span>
            </FormLabel>
            <FormControl>
              <Textarea
                {...field}
                data-testid="input-notes"
                placeholder="Anything the team should know about this customer or property..."
                className="resize-none"
                rows={3}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="flex items-center gap-2 py-1 border-t pt-3 mt-1">
        <Switch
          id="suppress-notifications-step2"
          checked={suppressNotifications}
          onCheckedChange={onSuppressChange}
          data-testid="switch-suppress-notifications"
        />
        <Label
          htmlFor="suppress-notifications-step2"
          className="text-sm text-muted-foreground cursor-pointer"
        >
          Suppress notifications
        </Label>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          className="w-full h-11"
          disabled={isPending}
          onClick={onCreateAndSchedule}
          data-testid="button-create-and-schedule"
        >
          {isPending ? "Creating..." : "Create & Schedule"}
          <CalendarDays className="ml-2 h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          disabled={isPending}
          onClick={onCreateOnly}
          data-testid="button-create-customer-only"
        >
          Create Customer
        </Button>
        <button
          type="button"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors py-1 justify-center"
          onClick={onBack}
          data-testid="button-back-to-step1"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
      </div>
    </div>
  );
}
