import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Users,
  MapPin,
  Calendar,
  FileText,
  DollarSign,
  SlidersHorizontal,
  ArrowRight,
  ArrowLeft,
  X,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import logoSquare from "@assets/ScooPilot_Square_text_1771089502024.png";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: typeof Users;
  highlight: string;
}

const STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    title: "Welcome to ScooPilot",
    description: "Your all-in-one platform for managing your pet waste removal business. Let's take a quick tour of the key features so you know where everything is.",
    icon: Sparkles,
    highlight: "Let's get started",
  },
  {
    id: "clients",
    title: "Manage Your Clients",
    description: "The Contacts page is your CRM. Add clients, track their properties, yard sizes, dog counts, and service preferences. You can add clients one-by-one or import them in bulk from a CSV file.",
    icon: Users,
    highlight: "Contacts",
  },
  {
    id: "routes",
    title: "Build Your Routes",
    description: "Create routes for each day of the week, assign stops, and optimize your driving order. The route builder includes drag-and-drop reordering and map-based visualization.",
    icon: MapPin,
    highlight: "Routes",
  },
  {
    id: "scheduling",
    title: "Set Up Service Plans",
    description: "Create recurring service plans for each client -- weekly, biweekly, or monthly. Plans automatically generate visits on your schedule so nothing falls through the cracks.",
    icon: Calendar,
    highlight: "Scheduling",
  },
  {
    id: "invoicing",
    title: "Invoicing and Payments",
    description: "Send invoices, track payments, and connect Stripe for automatic billing. Invoices can be generated per-visit, weekly, or monthly based on each client's preference.",
    icon: FileText,
    highlight: "Invoices",
  },
  {
    id: "pricing",
    title: "Pricing Tools",
    description: "Use the Price Calculator to find the right price for every yard. Track overhead costs, analyze customer profitability, and run pricing simulations to maximize your margins.",
    icon: DollarSign,
    highlight: "Business tools",
  },
  {
    id: "ready",
    title: "You're All Set",
    description: "Your dashboard has a Getting Started checklist to track your setup progress. Start by adding your first client, then create a route and set up a service plan. You can always find help from Rover (the chat button in the bottom right).",
    icon: CheckCircle2,
    highlight: "Let's go",
  },
];

export default function OnboardingWizard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [visible, setVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (!user) return;
    const key = `onboarding_wizard_seen_${user.id}`;
    const seen = localStorage.getItem(key);
    if (!seen) {
      setVisible(true);
      localStorage.setItem(`rover_intro_seen_${user.id}`, "true");
    }
  }, [user]);

  const dismiss = () => {
    if (user) {
      localStorage.setItem(`onboarding_wizard_seen_${user.id}`, "true");
    }
    setVisible(false);
  };

  const next = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      dismiss();
      navigate("/contacts");
    }
  };

  const prev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const goToDashboard = () => {
    dismiss();
    navigate("/");
  };

  if (!visible) return null;

  const step = STEPS[currentStep];
  const StepIcon = step.icon;
  const progress = ((currentStep + 1) / STEPS.length) * 100;
  const isLast = currentStep === STEPS.length - 1;
  const isFirst = currentStep === 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" data-testid="onboarding-wizard">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={dismiss} />
      <div className="relative bg-background rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden border" data-testid="onboarding-wizard-card">
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors z-10"
          data-testid="button-dismiss-onboarding"
          aria-label="Skip onboarding"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-6 pt-6 pb-0">
          <Progress value={progress} className="h-1.5" data-testid="progress-onboarding" />
          <p className="text-xs text-muted-foreground mt-2" data-testid="text-step-counter">
            Step {currentStep + 1} of {STEPS.length}
          </p>
        </div>

        <div className="px-6 py-8 text-center space-y-4 min-h-[280px] flex flex-col items-center justify-center">
          {isFirst ? (
            <img
              src={logoSquare}
              alt="ScooPilot"
              className="h-16 w-16 rounded-xl object-cover mx-auto"
              data-testid="img-onboarding-logo"
            />
          ) : (
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <StepIcon className="h-7 w-7 text-primary" />
            </div>
          )}

          <h2 className="text-xl font-bold" data-testid="text-onboarding-title">{step.title}</h2>
          <p className="text-muted-foreground text-sm leading-relaxed max-w-md" data-testid="text-onboarding-description">
            {step.description}
          </p>
        </div>

        <div className="px-6 pb-6 flex items-center justify-between gap-3">
          <div>
            {!isFirst && (
              <Button
                variant="ghost"
                size="sm"
                onClick={prev}
                className="gap-1"
                data-testid="button-onboarding-back"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
            )}
            {isFirst && (
              <Button
                variant="ghost"
                size="sm"
                onClick={dismiss}
                className="text-muted-foreground"
                data-testid="button-skip-onboarding"
              >
                Skip tour
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isLast ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goToDashboard}
                  data-testid="button-goto-dashboard"
                >
                  Go to Dashboard
                </Button>
                <Button
                  size="sm"
                  onClick={() => { dismiss(); navigate("/contacts"); }}
                  className="gap-1"
                  data-testid="button-add-first-client"
                >
                  Add First Client
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={next}
                className="gap-1"
                data-testid="button-onboarding-next"
              >
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex justify-center gap-1.5 pb-4">
          {STEPS.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentStep(idx)}
              className={`h-1.5 rounded-full transition-all ${
                idx === currentStep
                  ? "w-6 bg-primary"
                  : idx < currentStep
                    ? "w-1.5 bg-primary/40"
                    : "w-1.5 bg-muted"
              }`}
              data-testid={`dot-step-${idx}`}
              aria-label={`Go to step ${idx + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
