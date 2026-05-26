/* eslint-disable @typescript-eslint/no-explicit-any */
import { Switch, Route, Redirect, useLocation, Link as WouterLink } from "wouter";
import { queryClient, apiRequest } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/hooks/use-auth";
import { useFeatureTour, FeatureTourOverlay } from "@/components/feature-tour";
import { TutorialProvider } from "@/hooks/use-tutorials";
import { AdminAuthProvider, useAdminAuth } from "@/hooks/use-admin-auth";
import { Button } from "@/components/ui/button";
import {
  Moon,
  Sun,
  LogOut,
  BarChart3,
  Building2,
  Home,
  MapPin,
  Users,
  Shield,
  CreditCard,
  Loader2,
  MessageSquare,
  Bug,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Component, lazy, Suspense, useEffect, useState, useRef, useCallback } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { adminFetchFn } from "@/lib/adminApi";
import RoverChatbot, { type RoverChatbotHandle } from "@/components/rover-chatbot";
import BusinessOnboarding from "@/components/business-onboarding";
import { ImportModePopup } from "@/components/import-mode-popup";
import { ImportModeBanner } from "@/components/import-mode-banner";
import { PostOnboardingImportPrompt } from "@/components/post-onboarding-import-prompt";
import { SubscriptionGate } from "@/components/subscription-gate";

const NotFound = lazy(() => import("@/pages/not-found"));
const AuthPage = lazy(() => import("@/pages/auth-page"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Contacts = lazy(() => import("@/pages/contacts"));
const ContactDetail = lazy(() => import("@/pages/contact-detail"));
const Scheduling = lazy(() => import("@/pages/scheduling"));
const RoutesPage = lazy(() => import("@/pages/routes-page"));
const TechMobile = lazy(() => import("@/pages/tech-mobile"));
const TechRoutes = lazy(() => import("@/pages/tech-routes"));
const TechCustomers = lazy(() => import("@/pages/tech-customers"));
const Invoices = lazy(() => import("@/pages/invoices"));
const Quotes = lazy(() => import("@/pages/quotes"));
const Billing = lazy(() => import("@/pages/billing"));
const Automation = lazy(() => import("@/pages/automation"));
const ApiKeysPage = lazy(() => import("@/pages/api-keys"));
const WebhooksPage = lazy(() => import("@/pages/webhooks-page"));
const Portal = lazy(() => import("@/pages/portal"));
const PortalLogin = lazy(() => import("@/pages/portal-login"));
const PortalResetPassword = lazy(() => import("@/pages/portal-reset-password"));
const PortalVerifyEmail = lazy(() => import("@/pages/portal-verify-email"));
const PortalCustomer = lazy(() => import("@/pages/portal-customer"));
const PortalQuoteView = lazy(() => import("@/pages/portal-quote-view"));
const InvoicePayPage = lazy(() => import("@/pages/invoice-pay"));
const Pricing = lazy(() => import("@/pages/pricing"));
const UnifiedPricingEngine = lazy(() => import("@/pages/unified-pricing-engine"));
const Communications = lazy(() => import("@/pages/communications"));
const Reports = lazy(() => import("@/pages/reports"));
const AdminDashboard = lazy(() => import("@/pages/admin-dashboard"));
const AdminTenants = lazy(() => import("@/pages/admin-tenants"));
const AdminCompanyDetail = lazy(() => import("@/pages/admin-company-detail"));
const AdminAnalytics = lazy(() => import("@/pages/admin-analytics"));
const AdminLogin = lazy(() => import("@/pages/admin-login"));
const AdminChangePassword = lazy(() => import("@/pages/admin-change-password"));
const AdminSecurity = lazy(() => import("@/pages/admin-security"));
const AdminSubscriptionPricing = lazy(() => import("@/pages/admin-subscription-pricing"));
const AdminMessaging = lazy(() => import("@/pages/admin-messaging"));
const AdminErrors = lazy(() => import("@/pages/admin-errors"));
const Settings = lazy(() => import("@/pages/settings"));
const Profitability = lazy(() => import("@/pages/profitability"));
const ProfitabilityDetail = lazy(() => import("@/pages/profitability-detail"));
const RouteProfitMaps = lazy(() => import("@/pages/route-profit-maps"));
const FieldView = lazy(() => import("@/pages/field-view"));
const MigrationPage = lazy(() => import("@/pages/migration-page"));
const GrowthTools = lazy(() => import("@/pages/growth-tools"));
const CommandCenter = lazy(() => import("@/pages/command-center"));
const ResetPassword = lazy(() => import("@/pages/reset-password"));
const SignupWidget = lazy(() => import("@/pages/signup-widget"));
const SignupWidgetThankYou = lazy(() => import("@/pages/signup-widget-thank-you"));
const VoiceSignup = lazy(() => import("@/pages/voice-signup"));
const PrivacyPolicy = lazy(() => import("@/pages/privacy-policy"));
const SmsTerms = lazy(() => import("@/pages/sms-terms"));
const Pipeline = lazy(() => import("@/pages/pipeline"));
const BusinessOverview = lazy(() => import("@/pages/business-overview"));
const OnboardingForm = lazy(() => import("@/pages/onboarding-form"));
const PendingApproval = lazy(() => import("@/pages/pending-approval"));
const ReviewRouter = lazy(() => import("@/pages/review-router"));
const ImportResolverPage = lazy(() => import("@/pages/import-resolver-page"));
const CrmRouter = lazy(() => import("@/pages/crm/index"));
const VoiceChatAgentPage = lazy(() => import("@/pages/crm/voice-agent"));
const SpeedToLeadPage = lazy(() => import("@/pages/crm/speed-to-lead"));
const SignDocumentsPage = lazy(() => import("@/pages/sign-documents-page"));
const LeadResponseRegisterPage = lazy(() => import("@/pages/lead-response-register"));
const UnmatchedEmails = lazy(() => import("@/pages/unmatched-emails"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
import { NotificationBell } from "@/components/notification-bell";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import logoSquare from "@assets/ScooPilot_Square_text_1771089502024.png";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggleTheme} data-testid="button-theme-toggle">
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/contacts">
          <SubscriptionGate featureName="Customers">
            <Contacts />
          </SubscriptionGate>
        </Route>
        <Route path="/contacts/:id">
          <SubscriptionGate featureName="Customers">
            <ContactDetail />
          </SubscriptionGate>
        </Route>
        <Route path="/scheduling">
          <SubscriptionGate featureName="Schedule">
            <Scheduling />
          </SubscriptionGate>
        </Route>
        <Route path="/routes">
          <SubscriptionGate featureName="Routes">
            <RoutesPage />
          </SubscriptionGate>
        </Route>
        <Route path="/jobs">
          <Redirect to="/scheduling" />
        </Route>
        <Route path="/pipeline" component={Pipeline} />
        <Route path="/m/today" component={TechMobile} />
        <Route path="/quotes" component={Quotes} />
        <Route path="/invoices">
          <SubscriptionGate featureName="Invoices">
            <Invoices />
          </SubscriptionGate>
        </Route>
        <Route path="/billing" component={Billing} />
        <Route path="/automation">
          <SubscriptionGate featureName="Automations">
            <Automation />
          </SubscriptionGate>
        </Route>
        <Route path="/api-keys" component={ApiKeysPage} />
        <Route path="/webhooks" component={WebhooksPage} />
        <Route path="/pricing">
          <SubscriptionGate featureName="Pricing">
            <UnifiedPricingEngine />
          </SubscriptionGate>
        </Route>
        <Route path="/pricing/catalog" component={Pricing} />
        <Route path="/pricing-calculator">
          <Redirect to="/pricing" />
        </Route>
        <Route path="/business-overview">
          <SubscriptionGate featureName="Business Overview">
            <BusinessOverview />
          </SubscriptionGate>
        </Route>
        <Route path="/profitability">
          <SubscriptionGate featureName="Profitability">
            <Profitability />
          </SubscriptionGate>
        </Route>
        <Route path="/profitability/:contactId">
          <SubscriptionGate featureName="Profitability">
            <ProfitabilityDetail />
          </SubscriptionGate>
        </Route>
        <Route path="/route-profit-maps">
          <SubscriptionGate featureName="Route Profit Maps">
            <RouteProfitMaps />
          </SubscriptionGate>
        </Route>
        <Route path="/growth-tools">
          <SubscriptionGate featureName="Growth Tools">
            <GrowthTools />
          </SubscriptionGate>
        </Route>
        <Route path="/field-view">
          <SubscriptionGate featureName="Field Map">
            <FieldView />
          </SubscriptionGate>
        </Route>
        <Route path="/ai-pricing-optimizer">
          <Redirect to="/pricing?tab=simulator" />
        </Route>
        <Route path="/overhead-costs">
          <Redirect to="/pricing" />
        </Route>
        <Route path="/communications">
          <SubscriptionGate featureName="Messages">
            <Communications />
          </SubscriptionGate>
        </Route>
        <Route path="/reports">
          <SubscriptionGate featureName="Reports">
            <Reports />
          </SubscriptionGate>
        </Route>
        <Route path="/analytics">
          <Redirect to="/reports?tab=analytics" />
        </Route>
        <Route path="/portal" component={Portal} />
        <Route path="/settings" component={Settings} />
        <Route path="/integrations">
          <Redirect to="/settings" />
        </Route>
        <Route path="/migration">
          <SubscriptionGate featureName="Import Data">
            <MigrationPage />
          </SubscriptionGate>
        </Route>
        <Route path="/import/:batchId/resolve">
          <SubscriptionGate featureName="Import Data">
            <ImportResolverPage />
          </SubscriptionGate>
        </Route>
        <Route path="/command-center" component={CommandCenter} />
        <Route path="/crm/voice-agent">
          <SubscriptionGate type="voice" featureName="Voice/Chat Agent">
            <VoiceChatAgentPage />
          </SubscriptionGate>
        </Route>
        <Route path="/crm/speed-to-lead">
          <SubscriptionGate featureName="Speed to Lead">
            <SpeedToLeadPage />
          </SubscriptionGate>
        </Route>
        <Route path="/crm/:rest*">
          <SubscriptionGate featureName="CRM" excludedTiers={["tier_starter"]}>
            <CrmRouter />
          </SubscriptionGate>
        </Route>
        <Route path="/crm">
          <SubscriptionGate featureName="CRM" excludedTiers={["tier_starter"]}>
            <CrmRouter />
          </SubscriptionGate>
        </Route>
        <Route path="/lead-response">
          <Redirect to="/crm/speed-to-lead" />
        </Route>
        <Route path="/unmatched-emails" component={UnmatchedEmails} />
        {/* Platform admin pages — accessible to isPlatformAdmin regular users */}
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/tenants" component={AdminTenants} />
        <Route path="/admin/analytics" component={AdminAnalytics} />
        <Route path="/admin/security" component={AdminSecurity} />
        <Route path="/admin/pricing" component={AdminSubscriptionPricing} />
        <Route path="/admin/messaging" component={AdminMessaging} />
        <Route path="/admin/errors" component={AdminErrors} />
        <Route path="/admin/companies/:id" component={AdminCompanyDetail} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AuthenticatedLayout() {
  const { logout, isLoggingOut, user } = useAuth();
  const roverRef = useRef<RoverChatbotHandle>(null);
  const openRover = useCallback(() => {
    roverRef.current?.open();
  }, []);
  const [setupState, setSetupState] = useState<"loading" | "ready" | "error" | "pending_approval">(
    (user as any)?.setupDone ? "ready" : "loading"
  );

  const isOwnerOrAdmin = user?.role === "owner" || user?.role === "admin";
  const [importModeActive, setImportModeActive] = useState<boolean>(() => {
    return !!user?.importMode && isOwnerOrAdmin;
  });
  const [importModePopupOpen, setImportModePopupOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!user || !isOwnerOrAdmin) return;
    const serverImportMode = !!user.importMode;
    if (serverImportMode !== importModeActive) {
      setImportModeActive(serverImportMode);
    }
    if (serverImportMode) {
      const popupKey = `importModePopupSeen_${user.id}`;
      if (!localStorage.getItem(popupKey)) {
        localStorage.setItem(popupKey, "true");
        setImportModePopupOpen(true);
      }
    }
  }, [user?.importMode, user?.id]);

  const handleImportModeEvent = useCallback(() => {
    if (!user || !isOwnerOrAdmin) return;
    setImportModeActive(true);
    const popupKey = `importModePopupSeen_${user.id}`;
    if (!localStorage.getItem(popupKey)) {
      localStorage.setItem(popupKey, "true");
    }
    setImportModePopupOpen(true);
  }, [user, isOwnerOrAdmin]);

  useEffect(() => {
    window.addEventListener("scoopilot:import-mode-activated", handleImportModeEvent);
    return () =>
      window.removeEventListener("scoopilot:import-mode-activated", handleImportModeEvent);
  }, [handleImportModeEvent]);
  const { activeTour, isRunning, startTour, handleCallback, getUnseenTours, isTourStatusLoaded } =
    useFeatureTour();
  const [autoTourChecked, setAutoTourChecked] = useState(false);
  const { data: onboardingStatus } = useQuery<{ isComplete: boolean }>({
    queryKey: ["/api/onboarding/status"],
    enabled: setupState === "ready",
  });
  const {
    data: businessOnboarding,
    isLoading: businessOnboardingLoading,
    isError: businessOnboardingError,
  } = useQuery<{ isComplete: boolean; isDemo?: boolean; hasCompletedContactImport: boolean }>({
    queryKey: ["/api/onboarding/business-status"],
    enabled: setupState === "ready",
    retry: 2,
  });
  const [businessOnboardingDone, setBusinessOnboardingDone] = useState(
    () => sessionStorage.getItem("scoopilot_onboarding_dismissed") === "true"
  );
  const [showImportPrompt, setShowImportPrompt] = useState(false);
  const [setupDismissed, setSetupDismissed] = useState(
    () => localStorage.getItem("scoopilot_setup_dismissed") === "true"
  );
  useEffect(() => {
    if (businessOnboarding?.isDemo) {
      localStorage.removeItem("scoopilot_setup_dismissed");
      setSetupDismissed(false);
      setBusinessOnboardingDone(false);
    }
  }, [businessOnboarding?.isDemo]);
  useEffect(() => {
    if (businessOnboarding?.hasCompletedContactImport) {
      setShowImportPrompt(false);
    }
  }, [businessOnboarding?.hasCompletedContactImport]);
  useEffect(() => {
    const handler = () => setSetupDismissed(true);
    window.addEventListener("scoopilot:setup-dismissed", handler);
    return () => window.removeEventListener("scoopilot:setup-dismissed", handler);
  }, []);
  const isSetupDoneOrDismissed = onboardingStatus?.isComplete || setupDismissed;

  const setupMutation = useMutation<
    { companyId: string; alreadySetup: boolean; isDemo: boolean },
    Error
  >({
    mutationFn: async () => {
      const { getAuthHeaders } = await import("@/lib/queryClient");
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { ...getAuthHeaders() },
        credentials: "include",
      });
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (data.subscriptionStatus === "pending_approval") {
          const err = new Error("pending_approval") as any;
          err.subscriptionStatus = "pending_approval";
          throw err;
        }
      }
      if (!res.ok) throw new Error(`Setup failed: ${res.status}`);
      return res.json();
    },
    onSuccess: (data: { companyId: string; alreadySetup: boolean; isDemo: boolean }) => {
      if (data?.isDemo) {
        localStorage.removeItem("scoopilot_setup_dismissed");
        setSetupDismissed(false);
      }
      setSetupState("ready");
    },
    onError: (err: any) => {
      if (err.subscriptionStatus === "pending_approval") {
        setSetupState("pending_approval");
      } else {
        setSetupState("error");
      }
    },
  });

  useEffect(() => {
    if (setupState === "loading") {
      setupMutation.mutate();
    }
  }, []);

  useEffect(() => {
    if (setupState !== "ready" || isRunning || !isTourStatusLoaded) return;
    if (!isSetupDoneOrDismissed) return;
    if (autoTourChecked) return;
    setAutoTourChecked(true);
    const timer = setTimeout(() => {
      const unseen = getUnseenTours();
      if (unseen.length > 0) {
        const welcomeUnseen = unseen.find((t) => t.id === "welcome");
        const whatsNewUnseen = unseen.find((t) => t.id !== "welcome");
        if (welcomeUnseen) {
          startTour(welcomeUnseen.id);
        } else if (whatsNewUnseen) {
          startTour(whatsNewUnseen.id);
        }
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [
    setupState,
    autoTourChecked,
    isRunning,
    isTourStatusLoaded,
    isSetupDoneOrDismissed,
    getUnseenTours,
    startTour,
  ]);

  if (setupState === "loading") {
    return (
      <div className="flex items-center justify-center h-screen">
        <Skeleton className="h-12 w-48" />
      </div>
    );
  }

  if (setupState === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted-foreground">Failed to set up your account. Please try again.</p>
        <Button
          onClick={() => {
            setSetupState("loading");
            setupMutation.mutate();
          }}
          data-testid="button-retry-setup"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (setupState === "pending_approval") {
    return (
      <Suspense fallback={<PageLoader />}>
        <PendingApproval />
      </Suspense>
    );
  }

  if (
    !businessOnboardingDone &&
    !businessOnboardingError &&
    (businessOnboardingLoading || !businessOnboarding || !businessOnboarding.isComplete)
  ) {
    if (businessOnboardingLoading || !businessOnboarding) {
      return (
        <div className="flex items-center justify-center h-screen bg-background">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="mt-3 text-muted-foreground">Loading your workspace...</p>
          </div>
        </div>
      );
    }
    return (
      <BusinessOnboarding
        onComplete={() => {
          sessionStorage.removeItem("scoopilot_onboarding_dismissed");
          setBusinessOnboardingDone(true);
          queryClient.invalidateQueries({ queryKey: ["/api/onboarding/business-status"] });
          if (!businessOnboarding?.hasCompletedContactImport) {
            setShowImportPrompt(true);
          }
        }}
        onDismiss={() => {
          sessionStorage.setItem("scoopilot_onboarding_dismissed", "true");
          setBusinessOnboardingDone(true);
        }}
      />
    );
  }

  return (
    <TutorialProvider>
      <SidebarProvider>
        <div className="flex h-screen w-full">
          <AppSidebar
            onStartTour={startTour}
            logout={logout}
            isLoggingOut={isLoggingOut}
            onOpenRover={openRover}
          />
          <div className="flex flex-col flex-1 min-w-0">
            <header className="flex items-center justify-between gap-2 p-2 border-b sticky top-0 z-50 bg-background">
              <div className="flex items-center gap-2">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
                <img
                  src={logoSquare}
                  alt="ScooPilot"
                  className="h-6 w-6 rounded object-cover"
                  data-testid="img-platform-logo"
                />
                <span
                  className="text-sm font-semibold text-muted-foreground hidden sm:inline"
                  data-testid="text-platform-name"
                >
                  ScooPilot
                </span>
              </div>
              <div className="flex items-center gap-1">
                <NotificationBell />
                <ThemeToggle />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => logout()}
                  disabled={isLoggingOut}
                  data-testid="button-logout"
                  className="hidden sm:inline-flex"
                >
                  <LogOut />
                </Button>
              </div>
            </header>
            {importModeActive && isOwnerOrAdmin && (
              <ImportModeBanner onTurnOff={() => setImportModeActive(false)} />
            )}
            <main className="flex-1 overflow-y-auto">
              <Router />
            </main>
          </div>
        </div>
        <FeatureTourOverlay tour={activeTour} isRunning={isRunning} onCallback={handleCallback} />
      </SidebarProvider>
      <RoverChatbot ref={roverRef} />
      <ImportModePopup open={importModePopupOpen} onClose={() => setImportModePopupOpen(false)} />
      <PostOnboardingImportPrompt
        open={showImportPrompt && !businessOnboarding?.hasCompletedContactImport}
        onDismiss={() => setShowImportPrompt(false)}
      />
    </TutorialProvider>
  );
}

function TechnicianLayout() {
  const { logout, isLoggingOut, user } = useAuth();
  const [location] = useLocation();
  const [setupState, setSetupState] = useState<"loading" | "ready" | "error">(
    (user as any)?.setupDone ? "ready" : "loading"
  );

  const setupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/setup");
      return res.json();
    },
    onSuccess: () => setSetupState("ready"),
    onError: () => setSetupState("error"),
  });

  useEffect(() => {
    if (setupState === "loading") {
      setupMutation.mutate();
    }
  }, []);

  if (setupState === "loading") {
    return (
      <div className="flex items-center justify-center h-screen">
        <Skeleton className="h-12 w-48" />
      </div>
    );
  }

  if (setupState === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted-foreground">Failed to set up your account. Please try again.</p>
        <Button
          onClick={() => {
            setSetupState("loading");
            setupMutation.mutate();
          }}
          data-testid="button-retry-setup"
        >
          Retry
        </Button>
      </div>
    );
  }

  const techTabs = [
    { label: "Overview", href: "/", icon: MapPin },
    { label: "Customers", href: "/customers", icon: Users },
  ];

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center justify-between gap-2 p-2 border-b sticky top-0 z-50 bg-background">
        <div className="flex items-center gap-2">
          <img src={logoSquare} alt="ScooPilot" className="h-7 w-7 rounded-md object-cover" />
          <span className="text-sm font-bold hidden sm:inline">ScooPilot</span>
        </div>
        <div className="flex items-center gap-1">
          {techTabs.map((tab) => (
            <WouterLink
              key={tab.href}
              href={tab.href}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                location === tab.href ? "bg-muted font-medium" : "text-muted-foreground"
              }`}
              data-testid={`link-tech-${tab.label.toLowerCase()}`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </WouterLink>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => logout()}
            disabled={isLoggingOut}
            data-testid="button-logout"
          >
            <LogOut />
          </Button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">
        <Suspense fallback={<PageLoader />}>
          <Switch>
            <Route path="/" component={TechRoutes} />
            <Route path="/customers" component={TechCustomers} />
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </main>
      <RoverChatbot />
    </div>
  );
}

function AdminSidebarLink({
  href,
  icon: Icon,
  label,
  location,
  badge,
}: {
  href: string;
  icon: any;
  label: string;
  location: string;
  badge?: number;
}) {
  const isActive = location === href || (href !== "/admin" && location.startsWith(href));
  return (
    <WouterLink
      href={href}
      className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
        isActive
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
      data-testid={`link-admin-${label.toLowerCase().replace(/\s/g, "-")}`}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1">{label}</span>
      {badge != null && badge > 0 && (
        <span
          className="ml-auto text-[10px] font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none"
          data-testid={`badge-${label.toLowerCase()}`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </WouterLink>
  );
}

function AdminLayout() {
  const { isAuthenticated, isLoading, mustChangePassword, logout } = useAdminAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [location] = useLocation();

  const { data: errorStats } = useQuery<{ openCount: number; latestTimestamp: string | null }>({
    queryKey: ["/api/admin/error-reports/stats"],
    queryFn: adminFetchFn("/api/admin/error-reports/stats"),
    enabled: isAuthenticated && !isLoading,
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Skeleton className="h-12 w-48" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AdminLogin />;
  }

  if (mustChangePassword) {
    return <AdminChangePassword />;
  }

  return (
    <div className="flex h-screen">
      <aside
        className={`${sidebarOpen ? "w-56" : "w-0 overflow-hidden"} transition-all duration-200 border-r bg-background flex flex-col shrink-0`}
      >
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <img src={logoSquare} alt="ScooPilot" className="h-7 w-7 rounded" />
            <div>
              <p className="font-semibold text-sm leading-tight">ScooPilot</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Administration</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-6 overflow-y-auto">
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">
              Platform
            </p>
            <div className="space-y-1">
              <AdminSidebarLink href="/admin" icon={Home} label="Overview" location={location} />
              <AdminSidebarLink
                href="/admin/analytics"
                icon={BarChart3}
                label="Analytics"
                location={location}
              />
            </div>
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">
              Management
            </p>
            <div className="space-y-1">
              <AdminSidebarLink
                href="/admin/tenants"
                icon={Building2}
                label="Tenants"
                location={location}
              />
              <AdminSidebarLink
                href="/admin/pricing"
                icon={CreditCard}
                label="Pricing"
                location={location}
              />
            </div>
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">
              System
            </p>
            <div className="space-y-1">
              <AdminSidebarLink
                href="/admin/messaging"
                icon={MessageSquare}
                label="Messaging"
                location={location}
              />
              <AdminSidebarLink
                href="/admin/errors"
                icon={Bug}
                label="Errors"
                location={location}
                badge={errorStats?.openCount}
              />
              <AdminSidebarLink
                href="/admin/security"
                icon={Shield}
                label="Security"
                location={location}
              />
            </div>
          </div>
        </nav>

        <div className="p-3 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => logout()}
            data-testid="button-admin-logout"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Log Out
          </Button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between gap-2 px-4 py-2 border-b sticky top-0 z-50 bg-background">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            data-testid="button-admin-sidebar-toggle"
            aria-label="Toggle sidebar"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </Button>
          <div className="flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <Suspense fallback={<PageLoader />}>
            <Switch>
              <Route path="/admin" component={AdminDashboard} />
              <Route path="/admin/tenants" component={AdminTenants} />
              <Route path="/admin/analytics" component={AdminAnalytics} />
              <Route path="/admin/security" component={AdminSecurity} />
              <Route path="/admin/pricing" component={AdminSubscriptionPricing} />
              <Route path="/admin/messaging" component={AdminMessaging} />
              <Route path="/admin/errors" component={AdminErrors} />
              <Route path="/admin/companies/:id" component={AdminCompanyDetail} />
              <Route path="/admin/login">
                {() => {
                  window.location.href = "/admin";
                  return null;
                }}
              </Route>
              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function PortalRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/portal/login" component={PortalLogin} />
        <Route path="/portal/reset-password" component={PortalResetPassword} />
        <Route path="/portal/verify-email" component={PortalVerifyEmail} />
        <Route path="/portal/customer" component={PortalCustomer} />
        <Route path="/portal/client">
          <Redirect to="/portal/customer" />
        </Route>
        <Route path="/portal/:slug/quotes/:quoteId">
          {(params: any) => {
            const searchParams = new URLSearchParams(window.location.search);
            const token = searchParams.get("token") || "";
            return <PortalQuoteView quoteId={params.quoteId} token={token} />;
          }}
        </Route>
        <Route>
          {() => {
            window.location.href = "/portal/login";
            return null;
          }}
        </Route>
      </Switch>
    </Suspense>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const isPortalPath =
    typeof window !== "undefined" && window.location.pathname.startsWith("/portal/");
  const isAdminPath =
    typeof window !== "undefined" && window.location.pathname.startsWith("/admin");
  const isResetPasswordPath =
    typeof window !== "undefined" && window.location.pathname === "/reset-password";

  const isSignupThankYouPath =
    typeof window !== "undefined" && /^\/signup\/[^/]+\/thank-you$/.test(window.location.pathname);

  const isSignupPath =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/signup/") &&
    !isSignupThankYouPath;

  const isOnboardingPath =
    typeof window !== "undefined" && window.location.pathname.startsWith("/onboarding/");

  const isVoiceSignupPath =
    typeof window !== "undefined" && window.location.pathname.startsWith("/voice-signup/");

  const isInvoicePayPath =
    typeof window !== "undefined" && /^\/invoice\/[^/]+\/pay$/.test(window.location.pathname);

  const isPrivacyPolicyPath =
    typeof window !== "undefined" && window.location.pathname === "/privacy-policy";

  const isSmsTermsPath = typeof window !== "undefined" && window.location.pathname === "/sms-terms";

  const isSignPath = typeof window !== "undefined" && window.location.pathname.startsWith("/sign/");

  const isReviewPath =
    typeof window !== "undefined" && window.location.pathname.startsWith("/review/");

  const isRegisterPath = typeof window !== "undefined" && window.location.pathname === "/register";

  if (isRegisterPath) {
    return (
      <Suspense fallback={<PageLoader />}>
        <LeadResponseRegisterPage />
      </Suspense>
    );
  }

  if (isSignPath) {
    return (
      <Suspense fallback={<PageLoader />}>
        <SignDocumentsPage />
      </Suspense>
    );
  }

  if (isReviewPath) {
    return (
      <Suspense fallback={<PageLoader />}>
        <ReviewRouter />
      </Suspense>
    );
  }

  if (isPrivacyPolicyPath) {
    return (
      <Suspense fallback={<PageLoader />}>
        <PrivacyPolicy />
      </Suspense>
    );
  }

  if (isSmsTermsPath) {
    return (
      <Suspense fallback={<PageLoader />}>
        <SmsTerms />
      </Suspense>
    );
  }

  if (isResetPasswordPath) {
    return (
      <Suspense fallback={<PageLoader />}>
        <ResetPassword />
      </Suspense>
    );
  }

  if (isSignupThankYouPath) {
    return (
      <Suspense fallback={<PageLoader />}>
        <SignupWidgetThankYou />
      </Suspense>
    );
  }

  if (isSignupPath) {
    return (
      <Suspense fallback={<PageLoader />}>
        <SignupWidget />
      </Suspense>
    );
  }

  if (isOnboardingPath) {
    return (
      <Suspense fallback={<PageLoader />}>
        <OnboardingForm />
      </Suspense>
    );
  }

  if (isVoiceSignupPath) {
    return (
      <Suspense fallback={<PageLoader />}>
        <VoiceSignup />
      </Suspense>
    );
  }

  if (isInvoicePayPath) {
    return (
      <Suspense fallback={<PageLoader />}>
        <InvoicePayPage />
      </Suspense>
    );
  }

  if (isPortalPath) {
    return <PortalRouter />;
  }

  if (isAdminPath) {
    // Platform admin using regular session: skip the standalone AdminLayout and
    // let them fall through to AuthenticatedLayout so AppSidebar (with CRM) is
    // always visible. Admin routes are registered in the main Router above.
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-screen">
          <Skeleton className="h-12 w-48" />
        </div>
      );
    }
    if (!(isAuthenticated && user?.isPlatformAdmin)) {
      return (
        <AdminAuthProvider>
          <AdminLayout />
        </AdminAuthProvider>
      );
    }
    // isPlatformAdmin — fall through to the regular authenticated layout below
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Skeleton className="h-12 w-48" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<PageLoader />}>
        <AuthPage />
      </Suspense>
    );
  }

  if (user?.mustChangePassword) {
    return (
      <Suspense fallback={<PageLoader />}>
        <AuthPage />
      </Suspense>
    );
  }

  if (user?.role === "tech") {
    return <TechnicianLayout />;
  }

  return <AuthenticatedLayout />;
}

function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  return (
    error.message?.includes("Failed to fetch dynamically imported module") ||
    error.message?.includes("error loading dynamically imported module") ||
    error.message?.includes("Importing a module script failed") ||
    error.message?.includes("Loading chunk") ||
    error.message?.includes("is not a valid JavaScript MIME type") ||
    error.name === "ChunkLoadError"
  );
}

function ServerReconnectBanner() {
  const [offline, setOffline] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const failCount = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/health", { credentials: "include" });
        if (res.ok) {
          failCount.current = 0;
          if (!cancelled) {
            setOffline(false);
            setReconnecting(false);
          }
          timerRef.current = setTimeout(check, 30000);
          return;
        }
      } catch {
        // network error
      }
      if (cancelled) return;
      failCount.current += 1;
      if (failCount.current >= 2) {
        setOffline(true);
        setReconnecting(true);
      }
      timerRef.current = setTimeout(check, 5000);
    }

    timerRef.current = setTimeout(check, 10000);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      data-testid="server-reconnect-banner"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-700 shadow-lg px-4 py-3 text-sm"
      style={{ maxWidth: "calc(100vw - 2rem)" }}
    >
      {reconnecting && (
        <Loader2 className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400 shrink-0" />
      )}
      <span className="text-amber-800 dark:text-amber-200 font-medium">
        {reconnecting
          ? "Server is starting up — reconnecting automatically…"
          : "Connection lost. Retrying…"}
      </span>
    </div>
  );
}

function UpdateBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = () => setVisible(true);
    window.addEventListener("app:update-available", handler);
    return () => window.removeEventListener("app:update-available", handler);
  }, []);

  if (!visible) return null;

  return (
    <div
      data-testid="update-banner"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border bg-background shadow-lg px-4 py-3 text-sm"
      style={{ maxWidth: "calc(100vw - 2rem)" }}
    >
      <span className="text-foreground font-medium">A new version is available.</span>
      <button
        data-testid="update-banner-reload"
        onClick={() => window.location.reload()}
        className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
      >
        Reload
      </button>
      <button
        data-testid="update-banner-dismiss"
        onClick={() => setVisible(false)}
        className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
    if (!isChunkLoadError(error)) {
      import("./lib/errorReporter")
        .then(({ reportError }) => {
          reportError(
            error.message || "React error boundary catch",
            (error.stack || "") + "\n\nComponent Stack:\n" + (errorInfo.componentStack || ""),
            "react"
          );
        })
        .catch(() => {});
    }
    if (isChunkLoadError(error)) {
      window.dispatchEvent(new Event("app:update-available"));
    }
  }

  render() {
    if (this.state.hasError) {
      if (isChunkLoadError(this.state.error)) {
        return (
          <div className="flex min-h-screen items-center justify-center bg-background p-8">
            <div className="max-w-md text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <svg
                  className="h-6 w-6 text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
              <h1 className="text-xl font-semibold text-foreground">A new version is available</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                The app has been updated. Reload to get the latest version.
              </p>
              <button
                data-testid="chunk-error-reload"
                onClick={() => window.location.reload()}
                className="mt-6 rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Reload now
              </button>
            </div>
          </div>
        );
      }
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-8">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <svg
                className="h-6 w-6 text-destructive"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <button
              data-testid="generic-error-reload"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <AppContent />
            <Toaster />
            <PwaInstallPrompt />
            <UpdateBanner />
            <ServerReconnectBanner />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
