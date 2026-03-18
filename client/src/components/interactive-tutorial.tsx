import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { X, ChevronRight, ChevronLeft, GraduationCap, RotateCcw } from "lucide-react";
import { useLocation } from "wouter";

export type TutorialStepAction =
  | "click"
  | "input"
  | "select"
  | "observe"
  | "navigate";

export type TutorialStep = {
  target: string;
  title: string;
  content: string;
  action: TutorialStepAction;
  actionTarget?: string;
  navigateTo?: string;
  placement?: "top" | "bottom" | "left" | "right";
  highlightPadding?: number;
  waitForElement?: boolean;
};

export type TutorialDefinition = {
  id: string;
  version: string;
  title: string;
  description: string;
  steps: TutorialStep[];
  requiredPage?: string;
};

const ROUTE_BUILDER_TUTORIAL: TutorialDefinition = {
  id: "tutorial_route_builder",
  version: "1.0",
  title: "Route Builder",
  description: "Learn how to create routes, add stops, reorder them, and optimize your daily schedule.",
  requiredPage: "/routes",
  steps: [
    {
      target: '[data-testid="button-create-route"]',
      title: "Create a New Route",
      content: "Start by clicking here to create a new route. Routes organize your stops by day and help you plan efficient schedules.",
      action: "click",
    },
    {
      target: '[data-testid="input-route-name"]',
      title: "Name Your Route",
      content: "Give your route a descriptive name, like 'Monday - North Side' or 'Thursday PM'. This helps you and your team stay organized.",
      action: "input",
    },
    {
      target: '[data-testid="select-route-day"]',
      title: "Pick a Day",
      content: "Select which day of the week this route runs. Jobs assigned to this day will appear as available stops.",
      action: "select",
    },
    {
      target: '[data-testid="button-save-route"]',
      title: "Save Your Route",
      content: "Click Save to create the route. You can always edit the name, day, or color later.",
      action: "click",
    },
    {
      target: '[data-testid="card-unassigned"]',
      title: "Unassigned Stops",
      content: "Jobs that match this day but aren't on a route yet appear here. Drag them onto your route to add them as stops.",
      action: "observe",
      waitForElement: true,
    },
    {
      target: '[data-testid="button-toggle-view"]',
      title: "Map View",
      content: "Switch to map view to see your stops on a map. This shows driving distances between stops and the overall route shape.",
      action: "observe",
    },
  ],
};

const INVOICE_CREATION_TUTORIAL: TutorialDefinition = {
  id: "tutorial_invoice_creation",
  version: "1.0",
  title: "Creating Invoices",
  description: "Learn how to create, customize, and send invoices to your customers.",
  requiredPage: "/invoices",
  steps: [
    {
      target: '[data-testid="button-create-invoice"]',
      title: "Create a New Invoice",
      content: "Click here to start creating an invoice. You can bill for individual visits, monthly service, or custom amounts.",
      action: "click",
    },
    {
      target: '[data-testid="select-invoice-contact"]',
      title: "Select a Customer",
      content: "Choose which customer to bill. The invoice will be linked to their account and they can view it in the client portal.",
      action: "select",
    },
    {
      target: '[data-testid="button-add-custom-item"]',
      title: "Add a Line Item",
      content: "Click 'Add Custom Charge' to create a line item on the invoice. Each line item represents a service or product you're billing for.",
      action: "click",
      waitForElement: true,
    },
    {
      target: '[data-testid="input-line-desc-0"]',
      title: "Describe the Charge",
      content: "Enter a description for this line item. Be specific so customers know exactly what they're paying for.",
      action: "input",
      waitForElement: true,
    },
    {
      target: '[data-testid="input-line-price-0"]',
      title: "Set the Price",
      content: "Enter the price for this line item. You can add multiple line items for different services on the same invoice.",
      action: "input",
    },
    {
      target: '[data-testid="button-submit-invoice"]',
      title: "Create the Invoice",
      content: "Click to create the invoice as a draft. You can review it, make edits, and then send it to the customer when ready.",
      action: "observe",
    },
  ],
};

const IMPORT_WIZARD_TUTORIAL: TutorialDefinition = {
  id: "tutorial_import_wizard",
  version: "1.0",
  title: "Importing Contacts",
  description: "Learn how to bulk-import your customer list from a CSV spreadsheet.",
  requiredPage: "/contacts",
  steps: [
    {
      target: '[data-testid="button-import-csv"]',
      title: "Import Your Customer List",
      content: "Click this button to upload a CSV file. You can export from another CRM, Google Sheets, or Excel. The wizard will guide you through mapping columns.",
      action: "observe",
    },
    {
      target: '[data-testid="button-download-sample-csv"]',
      title: "Download a Template",
      content: "Not sure how to format your file? Download the import template to see the expected columns. Fill it in with your customer data, then upload it.",
      action: "observe",
    },
    {
      target: '[data-testid="button-add-contact"]',
      title: "Or Add One at a Time",
      content: "If you prefer, you can add contacts individually. Click here to open the form and fill in details like name, address, yard size, and service day.",
      action: "observe",
    },
    {
      target: '[data-testid="button-export-csv"]',
      title: "Export Your Data",
      content: "You can also export your current contact list as a CSV file at any time. Useful for backups or sharing data with your team.",
      action: "observe",
    },
  ],
};

const STRIPE_CONNECT_TUTORIAL: TutorialDefinition = {
  id: "tutorial_stripe_connect",
  version: "1.0",
  title: "Payment Setup",
  description: "Learn how to connect Stripe to accept online payments from your customers.",
  requiredPage: "/settings",
  steps: [
    {
      target: '[data-testid="card-payment-processing"]',
      title: "Payment Processing",
      content: "This section lets you connect your Stripe account so customers can pay invoices online. Funds go directly to your bank account.",
      action: "observe",
    },
    {
      target: '[data-testid="button-connect-stripe"]',
      title: "Connect Stripe",
      content: "Click here to start the Stripe onboarding process. You'll be redirected to Stripe to enter your business and banking details.",
      action: "observe",
    },
    {
      target: '[data-testid="badge-stripe-status"]',
      title: "Connection Status",
      content: "Once connected, this badge shows your status. When it says 'Connected', your customers can pay invoices online automatically.",
      action: "observe",
      waitForElement: true,
    },
  ],
};

const PRICING_CALCULATOR_TUTORIAL: TutorialDefinition = {
  id: "tutorial_pricing_calculator",
  version: "1.0",
  title: "Pricing Calculator",
  description: "Learn how to use the pricing calculator to set accurate, profitable prices for every job.",
  requiredPage: "/pricing-calculator",
  steps: [
    {
      target: '[data-testid="input-calc-yard-size"]',
      title: "Enter Yard Size",
      content: "Enter the yard size in acres. A typical small residential yard is about 0.1 acres (4,350 sq ft). This determines how long the job takes.",
      action: "observe",
    },
    {
      target: '[data-testid="input-calc-dog-count"]',
      title: "Enter Dog Count",
      content: "Enter how many dogs are at the property. More dogs means more cleanup time, which factors into the recommended price.",
      action: "observe",
    },
    {
      target: '[data-testid="select-calc-frequency"]',
      title: "Service Frequency",
      content: "Choose how often the service happens. Weekly service costs less per visit than biweekly or monthly because there's less buildup.",
      action: "observe",
    },
    {
      target: '[data-testid="button-calculate"]',
      title: "Calculate the Price",
      content: "Click Calculate to see your price recommendation. The calculator factors in labor, travel, supplies, and overhead to give you three price points.",
      action: "observe",
    },
    {
      target: '[data-testid="tab-settings"]',
      title: "Customize Your Settings",
      content: "Switch to the Settings tab to adjust your base costs — hourly wage, gas price, overhead, profit margins, and more. These settings affect every calculation.",
      action: "observe",
    },
  ],
};

export const ALL_TUTORIALS: TutorialDefinition[] = [
  ROUTE_BUILDER_TUTORIAL,
  INVOICE_CREATION_TUTORIAL,
  IMPORT_WIZARD_TUTORIAL,
  STRIPE_CONNECT_TUTORIAL,
  PRICING_CALCULATOR_TUTORIAL,
];

export function useTutorials() {
  const { user } = useAuth();
  const [activeTutorialId, setActiveTutorialId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [, navigate] = useLocation();

  const { data: tourStatus } = useQuery<{ completions: Record<string, string> }>({
    queryKey: ["/api/tours/status"],
    enabled: !!user,
  });

  const completeMutation = useMutation({
    mutationFn: async ({ tourId, version }: { tourId: string; version: string }) => {
      await apiRequest("POST", "/api/tours/complete", { tourId, version });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tours/status"] });
    },
  });

  const completions = tourStatus?.completions || {};

  const isTutorialCompleted = useCallback((tutorialId: string) => {
    const tutorial = ALL_TUTORIALS.find(t => t.id === tutorialId);
    if (!tutorial) return false;
    const versionKey = `${tutorialId}_version`;
    return completions[tutorialId] && completions[versionKey] === tutorial.version;
  }, [completions]);

  const startTutorial = useCallback((tutorialId: string) => {
    const tutorial = ALL_TUTORIALS.find(t => t.id === tutorialId);
    if (!tutorial) return;
    if (tutorial.requiredPage) {
      navigate(tutorial.requiredPage);
    }
    setTimeout(() => {
      setActiveTutorialId(tutorialId);
      setCurrentStep(0);
    }, 300);
  }, [navigate]);

  const stopTutorial = useCallback(() => {
    setActiveTutorialId(null);
    setCurrentStep(0);
  }, []);

  const completeTutorial = useCallback((tutorialId: string) => {
    const tutorial = ALL_TUTORIALS.find(t => t.id === tutorialId);
    if (tutorial) {
      completeMutation.mutate({ tourId: tutorialId, version: tutorial.version });
    }
    stopTutorial();
  }, [completeMutation, stopTutorial]);

  const activeTutorial = activeTutorialId
    ? ALL_TUTORIALS.find(t => t.id === activeTutorialId) || null
    : null;

  return {
    activeTutorial,
    currentStep,
    setCurrentStep,
    startTutorial,
    stopTutorial,
    completeTutorial,
    isTutorialCompleted,
    allTutorials: ALL_TUTORIALS,
  };
}

function getPlacementStyle(
  targetRect: DOMRect,
  tooltipWidth: number,
  tooltipHeight: number,
  placement: string
): { top: number; left: number; arrowSide: string } {
  const gap = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = 0;
  let left = 0;
  let arrowSide = "top";

  switch (placement) {
    case "bottom":
      top = targetRect.bottom + gap;
      left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
      arrowSide = "top";
      break;
    case "top":
      top = targetRect.top - tooltipHeight - gap;
      left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
      arrowSide = "bottom";
      break;
    case "left":
      top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
      left = targetRect.left - tooltipWidth - gap;
      arrowSide = "right";
      break;
    case "right":
      top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
      left = targetRect.right + gap;
      arrowSide = "left";
      break;
    default:
      top = targetRect.bottom + gap;
      left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
      arrowSide = "top";
  }

  if (left < 8) left = 8;
  if (left + tooltipWidth > vw - 8) left = vw - tooltipWidth - 8;
  if (top < 8) {
    top = targetRect.bottom + gap;
    arrowSide = "top";
  }
  if (top + tooltipHeight > vh - 8) {
    top = targetRect.top - tooltipHeight - gap;
    arrowSide = "bottom";
  }

  return { top, left, arrowSide };
}

function bestPlacement(targetRect: DOMRect): string {
  const spaceBelow = window.innerHeight - targetRect.bottom;
  const spaceAbove = targetRect.top;
  const spaceRight = window.innerWidth - targetRect.right;
  const spaceLeft = targetRect.left;

  const spaces = [
    { dir: "bottom", space: spaceBelow },
    { dir: "top", space: spaceAbove },
    { dir: "right", space: spaceRight },
    { dir: "left", space: spaceLeft },
  ];
  spaces.sort((a, b) => b.space - a.space);
  return spaces[0].dir;
}

interface TutorialOverlayProps {
  tutorial: TutorialDefinition | null;
  currentStep: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onComplete: () => void;
  totalSteps: number;
}

export function TutorialOverlay({
  tutorial,
  currentStep,
  onNext,
  onPrev,
  onSkip,
  onComplete,
  totalSteps,
}: TutorialOverlayProps) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [tooltipSize, setTooltipSize] = useState({ width: 320, height: 200 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [actionDetected, setActionDetected] = useState(false);
  const prevStepRef = useRef(currentStep);

  const step = tutorial?.steps[currentStep];

  useEffect(() => {
    setActionDetected(false);
    prevStepRef.current = currentStep;
  }, [currentStep, tutorial?.id]);

  const scrolledRef = useRef(false);

  useEffect(() => {
    scrolledRef.current = false;
  }, [currentStep, tutorial?.id]);

  useEffect(() => {
    if (!step) return;

    const findTarget = () => {
      const el = document.querySelector(step.target) as HTMLElement | null;
      if (el) {
        const rect = el.getBoundingClientRect();
        setTargetRect(rect);
        if (!scrolledRef.current) {
          scrolledRef.current = true;
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      } else {
        setTargetRect(null);
      }
    };

    findTarget();
    const interval = setInterval(findTarget, 500);
    return () => clearInterval(interval);
  }, [step]);

  useEffect(() => {
    if (tooltipRef.current) {
      const rect = tooltipRef.current.getBoundingClientRect();
      if (rect.width !== tooltipSize.width || rect.height !== tooltipSize.height) {
        setTooltipSize({ width: rect.width, height: rect.height });
      }
    }
  }, [currentStep, targetRect]);

  useEffect(() => {
    if (!step || step.action === "observe" || step.action === "navigate" || actionDetected) return;

    const selector = step.actionTarget || step.target;
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return;

    const handler = (e: Event) => {
      if (step.action === "click") {
        setActionDetected(true);
        setTimeout(onNext, 400);
      } else if (step.action === "input") {
        const input = e.target as HTMLInputElement;
        if (input.value && input.value.length > 0) {
          setActionDetected(true);
        }
      } else if (step.action === "select") {
        setActionDetected(true);
        setTimeout(onNext, 400);
      }
    };

    if (step.action === "click") {
      el.addEventListener("click", handler, { once: true });
    } else if (step.action === "input") {
      el.addEventListener("input", handler);
    } else if (step.action === "select") {
      el.addEventListener("click", handler, { once: true });
    }

    return () => {
      el.removeEventListener("click", handler);
      el.removeEventListener("input", handler);
    };
  }, [step, actionDetected, onNext]);

  if (!tutorial || !step) return null;

  const isLastStep = currentStep === totalSteps - 1;
  const progress = ((currentStep + 1) / totalSteps) * 100;
  const placement = step.placement || (targetRect ? bestPlacement(targetRect) : "bottom");
  const pad = step.highlightPadding ?? 8;

  const tooltipPos = targetRect
    ? getPlacementStyle(targetRect, tooltipSize.width, tooltipSize.height, placement)
    : { top: window.innerHeight / 2 - 100, left: window.innerWidth / 2 - 160, arrowSide: "top" };

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none" data-testid="tutorial-overlay">
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        <defs>
          <mask id="tutorial-spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left - pad}
                y={targetRect.top - pad}
                width={targetRect.width + pad * 2}
                height={targetRect.height + pad * 2}
                rx="8"
                ry="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.55)"
          mask="url(#tutorial-spotlight-mask)"
        />
      </svg>

      {targetRect && (
        <div
          className="absolute border-2 border-primary rounded-lg pointer-events-none"
          style={{
            top: targetRect.top - pad,
            left: targetRect.left - pad,
            width: targetRect.width + pad * 2,
            height: targetRect.height + pad * 2,
            boxShadow: "0 0 0 4px hsl(var(--primary) / 0.2)",
          }}
          data-testid="tutorial-spotlight"
        />
      )}

      {targetRect && step.action !== "observe" && (
        <div
          className="absolute"
          style={{
            top: targetRect.top - pad,
            left: targetRect.left - pad,
            width: targetRect.width + pad * 2,
            height: targetRect.height + pad * 2,
            zIndex: 10000,
            pointerEvents: "none",
          }}
        />
      )}

      <div
        ref={tooltipRef}
        className="absolute bg-card border border-border rounded-xl shadow-xl p-0 w-[320px] sm:w-[360px] pointer-events-auto"
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
          zIndex: 10001,
        }}
        data-testid="tutorial-tooltip"
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium text-muted-foreground">
              {tutorial.title} - Step {currentStep + 1}/{totalSteps}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onSkip}
            data-testid="button-tutorial-close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Progress value={progress} className="h-1 mx-4 mb-2" data-testid="tutorial-progress" />

        <div className="px-4 pb-2">
          <h4 className="font-semibold text-sm mb-1" data-testid="tutorial-step-title">{step.title}</h4>
          <p className="text-sm text-muted-foreground leading-relaxed" data-testid="tutorial-step-content">
            {step.content}
          </p>
        </div>

        {step.action !== "observe" && !actionDetected && (
          <div className="px-4 pb-2">
            <span className="text-xs text-primary font-medium">
              {step.action === "click" && "Click the highlighted element to continue"}
              {step.action === "input" && "Type in the highlighted field to continue"}
              {step.action === "select" && "Make a selection to continue"}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between px-4 pb-3 pt-1 border-t mt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onPrev}
            disabled={currentStep === 0}
            className="text-xs"
            data-testid="button-tutorial-prev"
          >
            <ChevronLeft className="h-3.5 w-3.5 mr-1" />
            Back
          </Button>
          <div className="flex gap-2">
            {step.action === "observe" || actionDetected ? (
              <Button
                size="sm"
                onClick={isLastStep ? onComplete : onNext}
                className="text-xs"
                data-testid="button-tutorial-next"
              >
                {isLastStep ? "Finish" : "Next"}
                {!isLastStep && <ChevronRight className="h-3.5 w-3.5 ml-1" />}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={isLastStep ? onComplete : onNext}
                className="text-xs"
                data-testid="button-tutorial-skip-step"
              >
                Skip step
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface LearnHowButtonProps {
  tutorialId: string;
  onStart: (id: string) => void;
  isCompleted: boolean;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "icon";
  className?: string;
  label?: string;
}

export function LearnHowButton({
  tutorialId,
  onStart,
  isCompleted,
  variant = "outline",
  size = "sm",
  className = "",
  label,
}: LearnHowButtonProps) {
  const tutorial = ALL_TUTORIALS.find(t => t.id === tutorialId);
  if (!tutorial) return null;

  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => onStart(tutorialId)}
      className={`gap-1.5 ${className}`}
      data-testid={`button-learn-${tutorialId.replace("tutorial_", "")}`}
    >
      {isCompleted ? (
        <RotateCcw className="h-3.5 w-3.5" />
      ) : (
        <GraduationCap className="h-3.5 w-3.5" />
      )}
      {label || (isCompleted ? "Replay Tutorial" : "Learn How")}
    </Button>
  );
}
