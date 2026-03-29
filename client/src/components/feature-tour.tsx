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
  version: "1.0",
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
      content: "Manage all your clients here. Add contacts, track properties, and view service history.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-jobs"]',
      title: "Jobs",
      content: "Create and manage service jobs -- both one-time cleanups and recurring schedules. Set pricing, assign to routes, and track completion.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-scheduling"]',
      title: "Scheduling",
      content: "View and manage your service calendar. See upcoming visits, plan your week, and keep your team on schedule.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-routes"]',
      title: "Routes",
      content: "Build efficient routes with drag-and-drop. See driving distances, assign techs, and optimize your daily schedule.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-invoices"]',
      title: "Invoices",
      content: "Create, send, and track invoices. Connect Stripe for online payments and set up automatic billing.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-field-view"]',
      title: "Field View",
      content: "The mobile tech interface. Your crew uses this to see their route, complete visits, take proof-of-service photos, and auto-notify customers.",
      placement: "right",
      disableBeacon: true,
    },
    {
      target: '[data-testid="link-price-calculator"]',
      title: "Price Calculator",
      content: "Measure yards and calculate accurate pricing based on your actual costs. No more guessing -- know your margins on every job.",
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
      target: '[data-testid="link-settings"]',
      title: "Settings",
      content: "Configure your company profile, connect Stripe, manage your team, set up service zones, and customize your experience.",
      placement: "right",
      disableBeacon: true,
    },
  ],
};

const WHATS_NEW_TOURS: TourDefinition[] = [
  {
    id: "whats_new_v1",
    version: "1.0",
    title: "New Features",
    steps: [
      {
        target: '[data-testid="link-jobs"]',
        title: "Jobs System",
        content: "Jobs replace service plans with more control. Create one-time or recurring jobs, set time windows, assign team members, and track completion with end conditions.",
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
