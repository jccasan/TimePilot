import { useState, useEffect, useCallback } from "react";
import Joyride, { type Step, type CallBackProps, STATUS, ACTIONS, EVENTS } from "react-joyride";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

export type TourDefinition = {
  id: string;
  version: string;
  title: string;
  steps: Step[];
};

const WELCOME_TOUR: TourDefinition = {
  id: "welcome",
  version: "2.1",
  title: "Welcome Tour",
  steps: [
    {
      target: '[data-testid="button-sidebar-toggle"]',
      title: "Navigation",
      content: "Open the sidebar to access all sections of ScooPilot. Your customers, routes, invoices, and more are just a click away.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-dashboard"]',
      title: "Dashboard",
      content: "Your command center. See today's visits, revenue, pending invoices, and client requests all in one place.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-contacts"]',
      title: "Contacts",
      content: "Manage all your clients here. Add contacts, set service statuses, track properties, and view full service history.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-pipeline"]',
      title: "Pipeline",
      content: "Track your leads through every stage — from first contact to signed client — on a visual Kanban board.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-quotes---proposals"]',
      title: "Quotes & Proposals",
      content: "Create professional service quotes and send them to prospects. When they accept, convert the quote directly into an active job.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-messages"]',
      title: "Messages",
      content: "All your SMS and email conversations in one inbox. Reply to clients, view automated messages, and see full conversation history.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-scheduling"]',
      title: "Scheduling",
      content: "Your all-in-one scheduling hub. Create one-time or recurring jobs, assign team members, set time windows, and manage your service calendar. Visits are generated automatically when you add a job.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-routes"]',
      title: "Routes",
      content: "Build efficient routes with drag-and-drop. See driving distances, assign techs, optimize stop order, and complete visits with proof photos or the No Gate option.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-invoices"]',
      title: "Invoices",
      content: "Create, send, and track invoices with a live revenue dashboard. Use the Generate button to bill clients for completed visits, batch-send or charge all outstanding invoices at once, and monitor autopay health from the Billing Health tab.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-live-field-map"]',
      title: "Live Field Map",
      content: "See your technicians' live locations and stop statuses on a map in real time. Great for dispatching and monitoring your crew throughout the day.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-reports---analytics"]',
      title: "Reports & Analytics",
      content: "Dig into service reports, revenue trends, visit history, and team performance. Export data or view charts to understand your business at a glance.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-profitability"]',
      title: "Profitability",
      content: "See which customers and routes are making you money and which ones are costing you. Make data-driven pricing decisions.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-route-profit-maps"]',
      title: "Route Profit Maps",
      content: "Visualize profitability on a map. See which neighborhoods are worth growing and where you should raise prices.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-pricing-tools"]',
      title: "Pricing Tools",
      content: "Calculate accurate prices based on your real costs and test pricing changes before rolling them out. Know your margins on every job.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-settings"]',
      title: "Settings",
      content: "Configure your company profile, connect Stripe, manage your team, set up automation rules, configure service zones, and manage API keys and webhooks.",
      placement: "right",
      disableBeacon: true,
    },
  ],
};

const WHATS_NEW_TOURS: TourDefinition[] = [
  {
    id: "whats_new_v2",
    version: "2.0",
    title: "What's New",
    steps: [
      {
        target: '[data-testid="link-scheduling"]',
        title: "Unified Scheduling",
        content: "Jobs and scheduling are now combined in one place. Create jobs directly from the Scheduling page -- visits are generated automatically. No extra steps needed.",
        placement: "right",
        disableBeacon: true,
      },
      {
        target: '[data-testid="link-route-profit-maps"]',
        title: "Route Profit Maps",
        content: "Visualize which neighborhoods are profitable on a map. Identify areas where you should grow or raise prices.",
        placement: "right",
        disableBeacon: true,
      },
      {
        target: '[data-testid="link-pricing-simulator"]',
        title: "Pricing Simulator",
        content: "Test pricing changes before you make them. See how adjustments affect your revenue and margins across your entire customer base.",
        placement: "right",
        disableBeacon: true,
      },
      {
        target: '[data-testid="button-rover-open"]',
        title: "Meet Rover",
        content: "Look for the green 'Ask Rover' button. Rover is your AI assistant -- ask about any feature, look up business data, or submit trouble tickets. Drag the button to reposition it.",
        placement: "left",
        disableBeacon: true,
      },
    ],
  },
  {
    id: "whats_new_v3",
    version: "3.0",
    title: "What's New",
    steps: [
      {
        target: '[data-testid="link-invoices"]',
        title: "Invoice Revenue Dashboard",
        content: "The Invoices page now has a live revenue dashboard at the top — see This Week's revenue, Outstanding, Overdue, and Collected totals at a glance. Invoices are grouped into sections (Overdue, Unpaid, Draft, Paid) for faster scanning.",
        placement: "right",
        disableBeacon: true,
      },
      {
        target: '[data-testid="link-invoices"]',
        title: "Batch Invoice Actions",
        content: "No more clicking into each invoice one by one. Select multiple invoices and use Send All, Charge All (autopay), or Mark Paid to process your whole outstanding list in seconds.",
        placement: "right",
        disableBeacon: true,
      },
      {
        target: '[data-testid="link-routes"]',
        title: "No Gate Visit Completion",
        content: "When completing a visit, check 'No gate' to mark it done without a proof photo — perfect for properties without a gate or for logging past visits. The customer notification is adjusted automatically.",
        placement: "right",
        disableBeacon: true,
      },
      {
        target: '[data-testid="link-command-center"]',
        title: "Command Center",
        content: "Admins now have a real-time Command Center showing all active routes, technician locations, and today's visit status across the entire team. Available under Operations in the sidebar.",
        placement: "right",
        disableBeacon: true,
      },
    ],
  },
  {
    id: "whats_new_v4",
    version: "4.0",
    title: "What's New",
    steps: [
      {
        target: '[data-testid="link-invoices"]',
        title: "Generate Invoices from Completed Work",
        content: "The new Generate button on the Invoices page lets you bill any client for their completed, uninvoiced visits in seconds. Filter by date range — this month, last month, or a custom window — pick which visits to include, and create the invoice with one click. Use the Uninvoiced tab to quickly spot clients ready to bill.",
        placement: "right",
        disableBeacon: true,
      },
      {
        target: '[data-testid="link-invoices"]',
        title: "Billing Health Dashboard",
        content: "The new Billing Health tab on the Invoices page shows your full autopay picture in one place: which clients are enrolled, who's missing a payment method, upcoming scheduled charges, and any failed payments — all with quick-action buttons to fix issues immediately.",
        placement: "right",
        disableBeacon: true,
      },
      {
        target: '[data-testid="link-profitability"]',
        title: "Calculation Workbook — See Your Math",
        content: "Every property on the Profitability page now shows a full Calculation Workbook: a step-by-step breakdown of exactly how the price was derived — service time, travel time, labor cost, travel cost, supplies, and overhead per visit. Know your true margin on every job.",
        placement: "right",
        disableBeacon: true,
      },
    ],
  },
];

const ALL_TOURS = [WELCOME_TOUR, ...WHATS_NEW_TOURS];

const tourStyles = {
  options: {
    arrowColor: "hsl(var(--card))",
    backgroundColor: "hsl(var(--card))",
    overlayColor: "rgba(0, 0, 0, 0.5)",
    primaryColor: "hsl(var(--primary))",
    textColor: "hsl(var(--card-foreground))",
    zIndex: 10000,
  },
  tooltipContainer: {
    textAlign: "left" as const,
  },
  buttonNext: {
    backgroundColor: "hsl(var(--primary))",
    color: "hsl(var(--primary-foreground))",
    borderRadius: "6px",
    padding: "8px 16px",
    fontSize: "14px",
    fontWeight: 500,
  },
  buttonBack: {
    color: "hsl(var(--muted-foreground))",
    marginRight: "8px",
    fontSize: "14px",
  },
  buttonSkip: {
    color: "hsl(var(--muted-foreground))",
    fontSize: "13px",
  },
  tooltip: {
    borderRadius: "8px",
    padding: "16px",
    maxWidth: "340px",
  },
  tooltipTitle: {
    fontSize: "16px",
    fontWeight: 600,
    marginBottom: "4px",
  },
  tooltipContent: {
    fontSize: "14px",
    lineHeight: "1.5",
  },
};

export function useFeatureTour() {
  const { user } = useAuth();
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const { data: tourStatus, isSuccess: isTourStatusLoaded } = useQuery<{ completions: Record<string, string> }>({
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

  const startTour = useCallback((tourId: string) => {
    const sidebar = document.querySelector('[data-sidebar="sidebar"]');
    if (sidebar) {
      const isCollapsed = sidebar.getAttribute("data-state") === "collapsed";
      if (isCollapsed) {
        const trigger = document.querySelector('[data-testid="button-sidebar-toggle"]') as HTMLElement;
        if (trigger) trigger.click();
      }
    }
    setActiveTourId(tourId);
    setIsRunning(true);
  }, []);

  const getUnseenTours = useCallback((): TourDefinition[] => {
    return ALL_TOURS.filter(t => {
      const completed = completions[t.id];
      if (!completed) return true;
      const completedVersion = completions[`${t.id}_version`];
      return completedVersion !== t.version;
    });
  }, [completions]);

  const hasCompletedWelcome = !!completions["welcome"];

  const handleCallback = useCallback((data: CallBackProps) => {
    const { status, action, type } = data;
    if (type === EVENTS.TARGET_NOT_FOUND) {
      const sidebar = document.querySelector('[data-sidebar="sidebar"]');
      const isCollapsed = sidebar?.getAttribute("data-state") === "collapsed";
      if (isCollapsed) {
        const sidebarTrigger = document.querySelector('[data-testid="button-sidebar-toggle"]') as HTMLElement;
        if (sidebarTrigger) sidebarTrigger.click();
      }
    }
    const isFinished = status === STATUS.FINISHED || status === STATUS.SKIPPED || action === ACTIONS.CLOSE;
    if (isFinished) {
      setIsRunning(false);
      if (activeTourId) {
        const tour = ALL_TOURS.find(t => t.id === activeTourId);
        completeMutation.mutate({ tourId: activeTourId, version: tour?.version || "1.0" });
      }
      setActiveTourId(null);
    }
  }, [activeTourId, completeMutation]);

  const activeTour = ALL_TOURS.find(t => t.id === activeTourId);

  return {
    activeTour,
    isRunning,
    startTour,
    handleCallback,
    completions,
    hasCompletedWelcome,
    getUnseenTours,
    isTourStatusLoaded,
    allTours: ALL_TOURS,
  };
}

export function FeatureTourOverlay({
  tour,
  isRunning,
  onCallback,
}: {
  tour: TourDefinition | undefined;
  isRunning: boolean;
  onCallback: (data: CallBackProps) => void;
}) {
  if (!tour || !isRunning) return null;

  return (
    <Joyride
      steps={tour.steps}
      run={isRunning}
      continuous
      showSkipButton
      showProgress
      scrollToFirstStep
      disableOverlayClose
      callback={onCallback}
      locale={{
        back: "Back",
        close: "Close",
        last: "Done",
        next: "Next",
        skip: "Skip tour",
      }}
      styles={tourStyles}
    />
  );
}

export function getAvailableTours(): TourDefinition[] {
  return ALL_TOURS;
}
