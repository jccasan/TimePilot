import { Switch, Route, useLocation, Link as WouterLink } from "wouter";
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
import { Moon, Sun, LogOut, BarChart3, Building2, Home, MapPin, Users, Shield, CreditCard } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useState } from "react";
import RoverChatbot from "@/components/rover-chatbot";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import Dashboard from "@/pages/dashboard";
import Contacts from "@/pages/contacts";
import ContactDetail from "@/pages/contact-detail";
import Scheduling from "@/pages/scheduling";
import RoutesPage from "@/pages/routes-page";
import TechMobile from "@/pages/tech-mobile";
import TechRoutes from "@/pages/tech-routes";
import TechClients from "@/pages/tech-clients";
import Invoices from "@/pages/invoices";
import Billing from "@/pages/billing";
import Automation from "@/pages/automation";
import ApiKeysPage from "@/pages/api-keys";
import WebhooksPage from "@/pages/webhooks-page";
import Portal from "@/pages/portal";
import PortalLogin from "@/pages/portal-login";
import PortalResetPassword from "@/pages/portal-reset-password";
import PortalVerifyEmail from "@/pages/portal-verify-email";
import PortalClient from "@/pages/portal-client";
import Pricing from "@/pages/pricing";
import Communications from "@/pages/communications";
import Reports from "@/pages/reports";
import Analytics from "@/pages/analytics";
import AdminDashboard from "@/pages/admin-dashboard";
import AdminTenants from "@/pages/admin-tenants";
import AdminCompanyDetail from "@/pages/admin-company-detail";
import AdminAnalytics from "@/pages/admin-analytics";
import AdminLogin from "@/pages/admin-login";
import AdminChangePassword from "@/pages/admin-change-password";
import AdminSecurity from "@/pages/admin-security";
import AdminSubscriptionPricing from "@/pages/admin-subscription-pricing";
import Settings from "@/pages/settings";
import PricingCalculator from "@/pages/pricing-calculator";
import Profitability from "@/pages/profitability";
import ProfitabilityDetail from "@/pages/profitability-detail";
import RouteProfitMaps from "@/pages/route-profit-maps";
import AIPricingOptimizer from "@/pages/ai-pricing-optimizer";
import OverheadCosts from "@/pages/overhead-costs";
import MigrationPage from "@/pages/migration-page";
import ResetPassword from "@/pages/reset-password";
import Jobs from "@/pages/jobs";
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
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/contacts" component={Contacts} />
      <Route path="/contacts/:id" component={ContactDetail} />
      <Route path="/scheduling" component={Scheduling} />
      <Route path="/routes" component={RoutesPage} />
      <Route path="/jobs" component={Jobs} />
      <Route path="/m/today" component={TechMobile} />
      <Route path="/invoices" component={Invoices} />
      <Route path="/billing" component={Billing} />
      <Route path="/automation" component={Automation} />
      <Route path="/api-keys" component={ApiKeysPage} />
      <Route path="/webhooks" component={WebhooksPage} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/pricing-calculator" component={PricingCalculator} />
      <Route path="/profitability" component={Profitability} />
      <Route path="/profitability/:contactId" component={ProfitabilityDetail} />
      <Route path="/route-profit-maps" component={RouteProfitMaps} />
      <Route path="/ai-pricing-optimizer" component={AIPricingOptimizer} />
      <Route path="/overhead-costs" component={OverheadCosts} />
      <Route path="/communications" component={Communications} />
      <Route path="/reports" component={Reports} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/portal" component={Portal} />
      <Route path="/settings" component={Settings} />
      <Route path="/migration" component={MigrationPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedLayout() {
  const { logout, isLoggingOut, user } = useAuth();
  const [setupState, setSetupState] = useState<"loading" | "ready" | "error">(
    (user as any)?.setupDone ? "ready" : "loading"
  );
  const { activeTour, isRunning, startTour, handleCallback, hasCompletedWelcome, getUnseenTours, isTourStatusLoaded } = useFeatureTour();
  const [autoTourChecked, setAutoTourChecked] = useState(false);
  const { data: onboardingStatus } = useQuery<{ isComplete: boolean }>({
    queryKey: ["/api/onboarding/status"],
    enabled: setupState === "ready",
  });
  const [setupDismissed, setSetupDismissed] = useState(() => localStorage.getItem("scoopilot_setup_dismissed") === "true");
  useEffect(() => {
    const handler = () => setSetupDismissed(true);
    window.addEventListener("scoopilot:setup-dismissed", handler);
    return () => window.removeEventListener("scoopilot:setup-dismissed", handler);
  }, []);
  const isSetupDoneOrDismissed = onboardingStatus?.isComplete || setupDismissed;

  const setupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/setup");
      return res.json();
    },
    onSuccess: () => {
      setSetupState("ready");
    },
    onError: () => {
      setSetupState("error");
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
        const welcomeUnseen = unseen.find(t => t.id === "welcome");
        const whatsNewUnseen = unseen.find(t => t.id !== "welcome");
        if (welcomeUnseen) {
          startTour(welcomeUnseen.id);
        } else if (whatsNewUnseen) {
          startTour(whatsNewUnseen.id);
        }
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [setupState, autoTourChecked, isRunning, isTourStatusLoaded, isSetupDoneOrDismissed, getUnseenTours, startTour]);

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
        <Button onClick={() => { setSetupState("loading"); setupMutation.mutate(); }} data-testid="button-retry-setup">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <TutorialProvider>
      <SidebarProvider>
        <div className="flex h-screen w-full">
          <AppSidebar onStartTour={startTour} />
          <div className="flex flex-col flex-1 min-w-0">
            <header className="flex items-center justify-between gap-2 p-2 border-b sticky top-0 z-50 bg-background">
              <div className="flex items-center gap-2">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
                <img src={logoSquare} alt="ScooPilot" className="h-6 w-6 rounded object-cover" data-testid="img-platform-logo" />
                <span className="text-sm font-semibold text-muted-foreground hidden sm:inline" data-testid="text-platform-name">ScooPilot</span>
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
                >
                  <LogOut />
                </Button>
              </div>
            </header>
            <main className="flex-1 overflow-hidden">
              <Router />
            </main>
          </div>
        </div>
        <FeatureTourOverlay tour={activeTour} isRunning={isRunning} onCallback={handleCallback} />
      </SidebarProvider>
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
        <Button onClick={() => { setSetupState("loading"); setupMutation.mutate(); }} data-testid="button-retry-setup">
          Retry
        </Button>
      </div>
    );
  }

  const techTabs = [
    { label: "Overview", href: "/", icon: MapPin },
    { label: "Clients", href: "/clients", icon: Users },
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
      <main className="flex-1 overflow-hidden">
        <Switch>
          <Route path="/" component={TechRoutes} />
          <Route path="/clients" component={TechClients} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function AdminSidebarLink({ href, icon: Icon, label, location }: { href: string; icon: any; label: string; location: string }) {
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
      {label}
    </WouterLink>
  );
}

function AdminLayout() {
  const { isAuthenticated, isLoading, mustChangePassword, logout } = useAdminAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [location] = useLocation();

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
      <aside className={`${sidebarOpen ? "w-56" : "w-0 overflow-hidden"} transition-all duration-200 border-r bg-background flex flex-col shrink-0`}>
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
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">Platform</p>
            <div className="space-y-1">
              <AdminSidebarLink href="/admin" icon={Home} label="Overview" location={location} />
              <AdminSidebarLink href="/admin/analytics" icon={BarChart3} label="Analytics" location={location} />
            </div>
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">Management</p>
            <div className="space-y-1">
              <AdminSidebarLink href="/admin/tenants" icon={Building2} label="Tenants" location={location} />
              <AdminSidebarLink href="/admin/pricing" icon={CreditCard} label="Pricing" location={location} />
            </div>
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">System</p>
            <div className="space-y-1">
              <AdminSidebarLink href="/admin/security" icon={Shield} label="Security" location={location} />
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
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </Button>
          <div className="flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <Switch>
            <Route path="/admin" component={AdminDashboard} />
            <Route path="/admin/tenants" component={AdminTenants} />
            <Route path="/admin/analytics" component={AdminAnalytics} />
            <Route path="/admin/security" component={AdminSecurity} />
            <Route path="/admin/pricing" component={AdminSubscriptionPricing} />
            <Route path="/admin/companies/:id" component={AdminCompanyDetail} />
            <Route path="/admin/login">{() => { window.location.href = "/admin"; return null; }}</Route>
            <Route component={NotFound} />
          </Switch>
        </main>
      </div>
    </div>
  );
}

function PortalRouter() {
  return (
    <Switch>
      <Route path="/portal/login" component={PortalLogin} />
      <Route path="/portal/reset-password" component={PortalResetPassword} />
      <Route path="/portal/verify-email" component={PortalVerifyEmail} />
      <Route path="/portal/client" component={PortalClient} />
      <Route>{() => { window.location.href = "/portal/login"; return null; }}</Route>
    </Switch>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const isPortalPath = typeof window !== "undefined" &&
    window.location.pathname.startsWith("/portal/");
  const isAdminPath = typeof window !== "undefined" &&
    window.location.pathname.startsWith("/admin");
  const isResetPasswordPath = typeof window !== "undefined" &&
    window.location.pathname === "/reset-password";

  if (isResetPasswordPath) {
    return <ResetPassword />;
  }

  if (isPortalPath) {
    return <PortalRouter />;
  }

  if (isAdminPath) {
    return (
      <AdminAuthProvider>
        <AdminLayout />
      </AdminAuthProvider>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Skeleton className="h-12 w-48" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthPage />;
  }

  if (user?.mustChangePassword) {
    return <AuthPage />;
  }

  if (user?.role === "tech") {
    return <TechnicianLayout />;
  }

  return <AuthenticatedLayout />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AppContent />
          <Toaster />
          <PwaInstallPrompt />
          <RoverChatbot />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
