import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  Dog,
  Home,
  Phone,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  Loader2,
  ClipboardList,
} from "lucide-react";

type OnboardingData = {
  contact: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  };
  property: {
    id: string;
    streetAddress: string;
    city: string;
    state: string;
    zipCode: string;
    numberOfDogs: number | null;
    gateCode: string | null;
    specialInstructions: string | null;
    hasDangerousDog: boolean | null;
    dangerousDogNotes: string | null;
    dogNames: string | null;
    dogBreeds: string | null;
  };
  company: {
    name: string;
    logoUrl: string | null;
    primaryColor: string | null;
  };
  alreadyCompleted: boolean;
};

type FormState = {
  dogNames: string;
  dogBreeds: string;
  hasDangerousDog: boolean;
  dangerousDogNotes: string;
  gateCode: string;
  specialInstructions: string;
  techInstructions: string;
  preferredContactMethod: "phone" | "email" | "text" | "";
  bestContactTime: string;
};

const TOTAL_STEPS = 3;

function StepIndicator({ currentStep, accentColor }: { currentStep: number; accentColor: string }) {
  const steps = [
    { label: "Dog Details", icon: Dog },
    { label: "Property Access", icon: Home },
    { label: "Contact Preferences", icon: Phone },
  ];
  return (
    <div
      className="flex items-center justify-center gap-1 py-4 px-2"
      data-testid="onboarding-step-indicator"
    >
      {steps.map((step, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === currentStep;
        const isCompleted = stepNum < currentStep;
        const Icon = step.icon;
        return (
          <div key={stepNum} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className="w-8 h-0.5 rounded-full"
                style={{ backgroundColor: isCompleted ? accentColor : "#e5e7eb" }}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
                style={{
                  backgroundColor: isActive || isCompleted ? accentColor : "#f3f4f6",
                  color: isActive || isCompleted ? "white" : "#9ca3af",
                }}
                data-testid={`onboarding-step-dot-${stepNum}`}
              >
                {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <span
                className="text-[10px] font-medium whitespace-nowrap hidden sm:block"
                style={{ color: isActive ? accentColor : "#9ca3af" }}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DogDetailsStep({
  form,
  setForm,
  numberOfDogs,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  numberOfDogs: number;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground mb-4">
          Tell us about your {numberOfDogs > 1 ? "dogs" : "dog"} so our technicians know what to
          expect on every visit.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dog-names">Dog Name{numberOfDogs > 1 ? "s" : ""}</Label>
        <Input
          id="dog-names"
          placeholder={numberOfDogs > 1 ? "e.g. Buddy, Max, Bella" : "e.g. Buddy"}
          value={form.dogNames}
          onChange={(e) => setForm({ ...form, dogNames: e.target.value })}
          data-testid="input-dog-names"
        />
        <p className="text-xs text-muted-foreground">
          {numberOfDogs > 1 ? "Separate multiple names with commas" : "Your dog's name"}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dog-breeds">Breed{numberOfDogs > 1 ? "s" : ""}</Label>
        <Input
          id="dog-breeds"
          placeholder={
            numberOfDogs > 1 ? "e.g. Labrador, German Shepherd, Poodle" : "e.g. Labrador"
          }
          value={form.dogBreeds}
          onChange={(e) => setForm({ ...form, dogBreeds: e.target.value })}
          data-testid="input-dog-breeds"
        />
      </div>
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border">
          <div>
            <Label className="text-sm font-medium text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" />
              Dangerous or Aggressive Dog
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Required for technician safety — please be honest
            </p>
          </div>
          <Switch
            checked={form.hasDangerousDog}
            onCheckedChange={(v) => setForm({ ...form, hasDangerousDog: v })}
            data-testid="switch-dangerous-dog"
          />
        </div>
        {form.hasDangerousDog && (
          <div className="space-y-1.5">
            <Label htmlFor="dangerous-dog-notes">Safety Notes</Label>
            <Textarea
              id="dangerous-dog-notes"
              placeholder="Describe the behavior, what triggers it, and any precautions the technician should take..."
              value={form.dangerousDogNotes}
              onChange={(e) => setForm({ ...form, dangerousDogNotes: e.target.value })}
              rows={3}
              data-testid="input-dangerous-dog-notes"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PropertyAccessStep({
  form,
  setForm,
  property,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  property: OnboardingData["property"];
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Service Address</p>
        <p className="text-sm">
          {property.streetAddress}, {property.city}, {property.state} {property.zipCode}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="gate-code">Gate Code / Entry Code</Label>
        <Input
          id="gate-code"
          placeholder="e.g. #1234 or leave blank if no gate"
          value={form.gateCode}
          onChange={(e) => setForm({ ...form, gateCode: e.target.value })}
          data-testid="input-gate-code"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="special-instructions">Access Instructions</Label>
        <Textarea
          id="special-instructions"
          placeholder="e.g. Enter through the side gate on the left, close gate behind you..."
          value={form.specialInstructions}
          onChange={(e) => setForm({ ...form, specialInstructions: e.target.value })}
          rows={3}
          data-testid="input-special-instructions"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tech-instructions">Special Instructions for Technician</Label>
        <Textarea
          id="tech-instructions"
          placeholder="e.g. Bags are in the blue bin by the back door, please stack near the patio when done..."
          value={form.techInstructions}
          onChange={(e) => setForm({ ...form, techInstructions: e.target.value })}
          rows={3}
          data-testid="input-tech-instructions"
        />
      </div>
    </div>
  );
}

const CONTACT_METHODS = [
  { value: "phone", label: "Phone Call" },
  { value: "text", label: "Text / SMS" },
  { value: "email", label: "Email" },
];

const CONTACT_TIMES = [
  { value: "morning", label: "Morning (8am – 12pm)" },
  { value: "afternoon", label: "Afternoon (12pm – 5pm)" },
  { value: "evening", label: "Evening (5pm – 8pm)" },
  { value: "anytime", label: "Anytime" },
];

function ContactPreferencesStep({
  form,
  setForm,
  accentColor,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  accentColor: string;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        How would you like us to reach you if we have questions about your service?
      </p>
      <div className="space-y-1.5">
        <Label>Preferred Contact Method</Label>
        <div className="grid grid-cols-1 gap-2">
          {CONTACT_METHODS.map((m) => {
            const isSelected = form.preferredContactMethod === m.value;
            return (
              <button
                key={m.value}
                type="button"
                className={`flex items-center gap-3 p-3 rounded-lg border text-left cursor-pointer transition-all text-sm ${
                  isSelected ? "border-2 bg-white shadow-sm" : "border-gray-200 hover:bg-gray-50"
                }`}
                style={isSelected ? { borderColor: accentColor } : {}}
                onClick={() =>
                  setForm({
                    ...form,
                    preferredContactMethod: m.value as FormState["preferredContactMethod"],
                  })
                }
                data-testid={`option-contact-method-${m.value}`}
              >
                <div
                  className="w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                  style={{
                    borderColor: isSelected ? accentColor : "#d1d5db",
                    backgroundColor: isSelected ? accentColor : "transparent",
                  }}
                >
                  {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
                {m.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Best Time to Reach You</Label>
        <div className="grid grid-cols-1 gap-2">
          {CONTACT_TIMES.map((t) => {
            const isSelected = form.bestContactTime === t.value;
            return (
              <button
                key={t.value}
                type="button"
                className={`flex items-center gap-3 p-3 rounded-lg border text-left cursor-pointer transition-all text-sm ${
                  isSelected ? "border-2 bg-white shadow-sm" : "border-gray-200 hover:bg-gray-50"
                }`}
                style={isSelected ? { borderColor: accentColor } : {}}
                onClick={() => setForm({ ...form, bestContactTime: t.value })}
                data-testid={`option-contact-time-${t.value}`}
              >
                <div
                  className="w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                  style={{
                    borderColor: isSelected ? accentColor : "#d1d5db",
                    backgroundColor: isSelected ? accentColor : "transparent",
                  }}
                >
                  {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function OnboardingForm() {
  const [, params] = useRoute("/onboarding/:token");
  const token = params?.token || "";

  const [currentStep, setCurrentStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading, error } = useQuery<OnboardingData>({
    queryKey: ["/api/public/onboarding", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/onboarding/${token}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Invalid or expired link");
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  const [form, setForm] = useState<FormState>({
    dogNames: "",
    dogBreeds: "",
    hasDangerousDog: false,
    dangerousDogNotes: "",
    gateCode: "",
    specialInstructions: "",
    techInstructions: "",
    preferredContactMethod: "",
    bestContactTime: "",
  });

  useEffect(() => {
    if (data) {
      setForm({
        dogNames: data.property.dogNames || "",
        dogBreeds: data.property.dogBreeds || "",
        hasDangerousDog: data.property.hasDangerousDog || false,
        dangerousDogNotes: data.property.dangerousDogNotes || "",
        gateCode: data.property.gateCode || "",
        specialInstructions: data.property.specialInstructions || "",
        techInstructions: "",
        preferredContactMethod: "",
        bestContactTime: "",
      });
    }
  }, [data]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/public/onboarding/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to submit form");
      }
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
    },
  });

  const accentColor = data?.company?.primaryColor || "#15803d";

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="p-6 text-center space-y-3">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
            <h2 className="text-lg font-semibold">Link Not Found</h2>
            <p className="text-sm text-muted-foreground">
              This onboarding link is invalid or has already been used. Please contact your service
              provider for a new link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data.alreadyCompleted || submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="p-8 text-center space-y-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
              style={{ backgroundColor: accentColor }}
            >
              <CheckCircle2 className="h-8 w-8 text-white" />
            </div>
            <h2 className="text-xl font-bold">
              {submitted ? "Thanks, you're all set!" : "Onboarding Already Complete"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {submitted
                ? `We've saved your information for ${data.contact.firstName}. Our technicians will have everything they need before your first visit.`
                : `Your onboarding information has already been submitted. Contact ${data.company.name} if you need to make changes.`}
            </p>
            <p className="text-xs text-muted-foreground mt-2">Powered by {data.company.name}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const numberOfDogs = data.property.numberOfDogs || 1;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="py-4 px-6 text-white" style={{ backgroundColor: accentColor }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          {data.company.logoUrl ? (
            <img
              src={data.company.logoUrl}
              alt={data.company.name}
              className="h-8 w-8 rounded object-cover"
            />
          ) : (
            <ClipboardList className="h-6 w-6" />
          )}
          <div>
            <h1 className="font-bold text-base leading-tight">{data.company.name}</h1>
            <p className="text-xs opacity-80">New Customer Onboarding</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto w-full flex-1 p-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Welcome,{" "}
                <span className="font-medium text-foreground">{data.contact.firstName}</span>! Just
                a few questions to help our technicians serve you better.
              </p>
            </div>
            <StepIndicator currentStep={currentStep} accentColor={accentColor} />
            <div className="text-center">
              <p className="text-xs text-muted-foreground">
                Step {currentStep} of {TOTAL_STEPS}
              </p>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {currentStep === 1 && (
              <DogDetailsStep form={form} setForm={setForm} numberOfDogs={numberOfDogs} />
            )}
            {currentStep === 2 && (
              <PropertyAccessStep form={form} setForm={setForm} property={data.property} />
            )}
            {currentStep === 3 && (
              <ContactPreferencesStep form={form} setForm={setForm} accentColor={accentColor} />
            )}

            <div className="flex justify-between pt-6 gap-3">
              {currentStep > 1 ? (
                <Button
                  variant="outline"
                  onClick={() => setCurrentStep((s) => s - 1)}
                  data-testid="button-onboarding-back"
                >
                  <ChevronLeft className="mr-1 h-4 w-4" /> Back
                </Button>
              ) : (
                <div />
              )}
              {currentStep < TOTAL_STEPS ? (
                <Button
                  onClick={() => setCurrentStep((s) => s + 1)}
                  style={{ backgroundColor: accentColor, borderColor: accentColor }}
                  data-testid="button-onboarding-next"
                >
                  Next <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={() => submitMutation.mutate()}
                  disabled={submitMutation.isPending}
                  style={{ backgroundColor: accentColor, borderColor: accentColor }}
                  data-testid="button-onboarding-submit"
                >
                  {submitMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" /> Submit
                    </>
                  )}
                </Button>
              )}
            </div>
            {submitMutation.isError && (
              <p
                className="text-sm text-destructive mt-2 text-center"
                data-testid="text-onboarding-error"
              >
                {submitMutation.error?.message || "Something went wrong. Please try again."}
              </p>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Your information is kept private and used only to provide your service.
        </p>
      </div>
    </div>
  );
}
