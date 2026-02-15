import { Switch, Route } from "wouter";
import { queryClient, apiRequest } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Moon, Sun, LogOut } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useState } from "react";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import Dashboard from "@/pages/dashboard";
import Contacts from "@/pages/contacts";
import ContactDetail from "@/pages/contact-detail";
import Scheduling from "@/pages/scheduling";
import RoutesPage from "@/pages/routes-page";
import TechMobile from "@/pages/tech-mobile";
import Invoices from "@/pages/invoices";
import Billing from "@/pages/billing";
import Automation from "@/pages/automation";
import ApiKeysPage from "@/pages/api-keys";
import WebhooksPage from "@/pages/webhooks-page";
import Portal from "@/pages/portal";
import PortalLogin from "@/pages/portal-login";
import PortalClient from "@/pages/portal-client";
import Pricing from "@/pages/pricing";
import Communications from "@/pages/communications";
import Reports from "@/pages/reports";

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
      <Route path="/m/today" component={TechMobile} />
      <Route path="/invoices" component={Invoices} />
      <Route path="/billing" component={Billing} />
      <Route path="/automation" component={Automation} />
      <Route path="/api-keys" component={ApiKeysPage} />
      <Route path="/webhooks" component={WebhooksPage} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/communications" component={Communications} />
      <Route path="/reports" component={Reports} />
      <Route path="/portal" component={Portal} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedLayout() {
  const { logout, isLoggingOut } = useAuth();
  const [setupState, setSetupState] = useState<"loading" | "ready" | "error">("loading");

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
    setupMutation.mutate();
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

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 p-2 border-b sticky top-0 z-50 bg-background">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
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
            <Router />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function PortalRouter() {
  return (
    <Switch>
      <Route path="/portal/login" component={PortalLogin} />
      <Route path="/portal/client" component={PortalClient} />
      <Route>{() => { window.location.href = "/portal/login"; return null; }}</Route>
    </Switch>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();
  const isPortalPath = typeof window !== "undefined" && (
    window.location.pathname.startsWith("/portal/login") ||
    window.location.pathname.startsWith("/portal/client")
  );

  if (isPortalPath) {
    return <PortalRouter />;
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

  return <AuthenticatedLayout />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AppContent />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
