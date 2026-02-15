import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar,
  FileText,
  CreditCard,
  LogOut,
  Pause,
  Play,
  ExternalLink,
} from "lucide-react";

interface PortalProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
}

interface ScheduleData {
  servicePlans: Array<{
    id: string;
    frequency: string;
    dayOfWeek: string;
    pricePerVisit: string;
    isActive: boolean;
  }>;
  upcomingVisits: Array<{
    id: string;
    scheduledDate: string;
    status: string;
    propertyAddress: string;
  }>;
}

interface PortalInvoice {
  id: string;
  invoiceNumber: string;
  dueDate: string;
  total: string;
  status: string;
  createdAt: string;
}

function usePortalApi() {
  const [, navigate] = useLocation();
  const token = sessionStorage.getItem("portalToken");

  const portalFetch = useCallback(async (url: string, options?: RequestInit) => {
    if (!token) {
      navigate("/portal/login");
      throw new Error("Not authenticated");
    }
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options?.headers || {}),
      },
    });
    if (res.status === 401) {
      sessionStorage.removeItem("portalToken");
      sessionStorage.removeItem("portalContactId");
      navigate("/portal/login");
      throw new Error("Session expired");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Request failed");
    }
    return res.json();
  }, [token, navigate]);

  return { portalFetch, token };
}

const statusColors: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  skipped: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const invoiceStatusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  pending: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function PortalClient() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { portalFetch, token } = usePortalApi();
  const [profile, setProfile] = useState<PortalProfile | null>(null);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);

  useEffect(() => {
    if (!token) {
      navigate("/portal/login");
      return;
    }

    const loadData = async () => {
      try {
        const [profileData, scheduleData, invoicesData] = await Promise.all([
          portalFetch("/api/portal/me"),
          portalFetch("/api/portal/schedule"),
          portalFetch("/api/portal/invoices"),
        ]);
        setProfile(profileData);
        setSchedule(scheduleData);
        setInvoices(invoicesData);
      } catch (err: any) {
        if (err.message !== "Not authenticated" && err.message !== "Session expired") {
          toast({ title: "Error", description: err.message, variant: "destructive" });
        }
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [token]);

  const handleLogout = async () => {
    try {
      await portalFetch("/api/portal/logout", { method: "POST" });
    } catch {
    } finally {
      sessionStorage.removeItem("portalToken");
      sessionStorage.removeItem("portalContactId");
      navigate("/portal/login");
    }
  };

  const handlePauseResume = async (action: "pause" | "resume") => {
    setActionPending(true);
    try {
      await portalFetch(`/api/portal/${action}`, { method: "POST" });
      toast({
        title: action === "pause" ? "Service paused" : "Service resumed",
        description: action === "pause"
          ? "Your service has been paused. You can resume anytime."
          : "Your service has been resumed.",
      });
      const [scheduleData] = await Promise.all([
        portalFetch("/api/portal/schedule"),
      ]);
      setSchedule(scheduleData);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setActionPending(false);
    }
  };

  const handlePayInvoice = async (invoiceId: string) => {
    setActionPending(true);
    try {
      const result = await portalFetch(`/api/portal/invoices/${invoiceId}/pay`, { method: "POST" });
      if (result.url) {
        window.open(result.url, "_blank");
      }
    } catch (err: any) {
      toast({ title: "Payment error", description: err.message, variant: "destructive" });
    } finally {
      setActionPending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="space-y-4 w-full max-w-2xl p-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  const hasActivePlans = schedule?.servicePlans.some((p) => p.isActive);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 z-50 bg-background">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2 p-3">
          <div>
            <h1 className="font-semibold text-lg" data-testid="text-portal-welcome">
              {profile?.companyName || "Client Portal"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {profile?.firstName} {profile?.lastName}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="button-portal-logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5" /> Service Schedule
            </CardTitle>
            {hasActivePlans ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handlePauseResume("pause")}
                disabled={actionPending}
                data-testid="button-portal-pause"
              >
                <Pause className="mr-1 h-4 w-4" /> Pause Service
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => handlePauseResume("resume")}
                disabled={actionPending}
                data-testid="button-portal-resume"
              >
                <Play className="mr-1 h-4 w-4" /> Resume Service
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {schedule?.servicePlans && schedule.servicePlans.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Your Plans</p>
                {schedule.servicePlans.map((plan) => (
                  <div key={plan.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border rounded-md p-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium capitalize">{plan.frequency}</span>
                      {plan.dayOfWeek && (
                        <span className="text-muted-foreground capitalize">{plan.dayOfWeek}s</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span>${Number(plan.pricePerVisit).toFixed(2)}/visit</span>
                      <Badge variant="secondary" className={plan.isActive ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"}>
                        {plan.isActive ? "Active" : "Paused"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="text-no-plans">No service plans found.</p>
            )}

            {schedule?.upcomingVisits && schedule.upcomingVisits.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Upcoming Visits</p>
                {schedule.upcomingVisits.slice(0, 10).map((visit) => (
                  <div key={visit.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border rounded-md p-2">
                    <div>
                      <span className="font-medium">{visit.scheduledDate}</span>
                      {visit.propertyAddress && (
                        <span className="text-muted-foreground ml-2">{visit.propertyAddress}</span>
                      )}
                    </div>
                    <Badge variant="secondary" className={statusColors[visit.status] || ""}>
                      {visit.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="text-no-visits">No upcoming visits scheduled.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" /> Invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            {invoices.length > 0 ? (
              <div className="space-y-2">
                {invoices.map((inv) => (
                  <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-md p-3" data-testid={`card-portal-invoice-${inv.id}`}>
                    <div>
                      <p className="font-medium text-sm">{inv.invoiceNumber}</p>
                      <p className="text-xs text-muted-foreground">Due: {inv.dueDate}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">${Number(inv.total).toFixed(2)}</span>
                      <Badge variant="secondary" className={invoiceStatusColors[inv.status] || ""}>
                        {inv.status}
                      </Badge>
                      {inv.status !== "paid" && (
                        <Button
                          size="sm"
                          onClick={() => handlePayInvoice(inv.id)}
                          disabled={actionPending}
                          data-testid={`button-portal-pay-${inv.id}`}
                        >
                          <CreditCard className="mr-1 h-3 w-3" /> Pay
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-invoices">
                No invoices found.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
