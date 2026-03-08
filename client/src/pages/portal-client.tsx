import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar,
  FileText,
  CreditCard,
  LogOut,
  Pause,
  Play,
  Clock,
  Mail,
  Send,
  Sparkles,
  Home,
  Dog,
  Save,
  Camera,
  Gift,
  Copy,
  Check,
  Bell,
  ArrowRightLeft,
  Download,
  X,
  ChevronLeft,
  ChevronRight,
  Image,
  Trash2,
  Plus,
} from "lucide-react";

interface PortalProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
  numberOfDogs?: number;
}

interface PortalProperty {
  id: string;
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  gateCode: string | null;
  specialInstructions: string | null;
  numberOfDogs: number | null;
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

interface PastVisit {
  id: string;
  scheduledDate: string;
  status: string;
  propertyAddress: string;
  completedAt: string | null;
  proofOfServicePhoto: string | null;
  proofOfServicePhotoBefore: string | null;
}

interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

interface Estimate {
  id: string;
  description: string;
  items: Array<{ description: string; quantity: number; unitPrice: string; total: string }>;
  totalCents: number;
  status: string;
  sentAt: string | null;
  respondedAt: string | null;
  responseNote: string | null;
  createdAt: string;
}

interface ServiceChangeRequest {
  id: string;
  requestType: string;
  currentValue: string | null;
  requestedValue: string | null;
  note: string | null;
  status: string;
  adminNote: string | null;
  createdAt: string;
  respondedAt: string | null;
}

interface GalleryPhoto {
  id: string;
  scheduledDate: string;
  propertyAddress: string;
  proofOfServicePhoto: string | null;
  proofOfServicePhotoBefore: string | null;
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
    const contentType = res.headers.get("content-type");
    if (contentType?.includes("application/pdf")) {
      return res.blob();
    }
    return res.json();
  }, [token, navigate]);

  const portalDownload = useCallback(async (url: string, filename: string) => {
    if (!token) return;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [token]);

  return { portalFetch, portalDownload, token };
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
  voided: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

const frequencyLabels: Record<string, string> = {
  weekly: "Weekly",
  "1_per_week": "Weekly",
  twice_weekly: "Twice Weekly",
  "2_per_week": "Twice Weekly",
  biweekly: "Bi-Weekly",
  monthly: "Monthly",
  as_needed: "As Needed",
};

const changeRequestTypeLabels: Record<string, string> = {
  frequency_change: "Change Frequency",
  day_change: "Change Service Day",
  cancel: "Cancel Service",
  other: "Other",
};

const changeRequestStatusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  denied: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function PortalClient() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { portalFetch, portalDownload, token } = usePortalApi();
  const [profile, setProfile] = useState<PortalProfile | null>(null);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [pastVisits, setPastVisits] = useState<PastVisit[]>([]);
  const [pastVisitsTotal, setPastVisitsTotal] = useState(0);
  const [pastVisitsPage, setPastVisitsPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [contactSubject, setContactSubject] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [cleanupDate, setCleanupDate] = useState("");
  const [cleanupNotes, setCleanupNotes] = useState("");
  const [cleanupPending, setCleanupPending] = useState(false);
  const [properties, setProperties] = useState<PortalProperty[]>([]);
  const [propertyEdits, setPropertyEdits] = useState<Record<string, { gateCode: string; specialInstructions: string }>>({});
  const [savingProperties, setSavingProperties] = useState(false);
  const [numberOfDogs, setNumberOfDogs] = useState<number>(0);
  const [savingDogs, setSavingDogs] = useState(false);

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [autoPayEnabled, setAutoPayEnabled] = useState(false);
  const [addingCard, setAddingCard] = useState(false);

  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralCount, setReferralCount] = useState(0);
  const [copiedReferral, setCopiedReferral] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);

  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [estimateNote, setEstimateNote] = useState<Record<string, string>>({});

  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({
    email: true, sms: false,
    serviceReminder: true, serviceCompleted: true,
    invoiceReady: true, invoiceDueReminder: true, paymentConfirmation: true,
  });
  const [savingNotifs, setSavingNotifs] = useState(false);

  const [changeRequests, setChangeRequests] = useState<ServiceChangeRequest[]>([]);
  const [changeType, setChangeType] = useState("");
  const [changePlanId, setChangePlanId] = useState("");
  const [changeValue, setChangeValue] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [submittingChange, setSubmittingChange] = useState(false);

  const [galleryPhotos, setGalleryPhotos] = useState<GalleryPhoto[]>([]);
  const [photoModalIndex, setPhotoModalIndex] = useState<number | null>(null);

  const [visitPhotoModal, setVisitPhotoModal] = useState<PastVisit | null>(null);

  const [billingStartDate, setBillingStartDate] = useState("");
  const [billingEndDate, setBillingEndDate] = useState("");
  const [downloadingStatement, setDownloadingStatement] = useState(false);

  const loadVisitHistory = useCallback(async (page: number) => {
    try {
      const data = await portalFetch(`/api/portal/visits/history?page=${page}&limit=20`);
      setPastVisits(data.visits || []);
      setPastVisitsTotal(data.total || 0);
      setPastVisitsPage(data.page || 1);
    } catch {}
  }, [portalFetch]);

  useEffect(() => {
    if (!token) {
      navigate("/portal/login");
      return;
    }

    const loadData = async () => {
      try {
        const [profileData, scheduleData, invoicesData, propertiesData] = await Promise.all([
          portalFetch("/api/portal/me"),
          portalFetch("/api/portal/schedule"),
          portalFetch("/api/portal/invoices"),
          portalFetch("/api/portal/properties").catch(() => []),
        ]);
        setProfile(profileData);
        setSchedule(scheduleData);
        setInvoices(invoicesData);
        setProperties(propertiesData);
        if (profileData.numberOfDogs != null) {
          setNumberOfDogs(profileData.numberOfDogs);
        }
        const edits: Record<string, { gateCode: string; specialInstructions: string }> = {};
        for (const p of propertiesData) {
          edits[p.id] = { gateCode: p.gateCode || "", specialInstructions: p.specialInstructions || "" };
        }
        setPropertyEdits(edits);

        await loadVisitHistory(1);

        const [pmData, referralData, estimatesData, notifsData, changesData, photosData] = await Promise.all([
          portalFetch("/api/portal/payment-methods").catch(() => ({ methods: [], autoPayEnabled: false })),
          portalFetch("/api/portal/referral").catch(() => ({ referralCode: null, referralCount: 0 })),
          portalFetch("/api/portal/estimates").catch(() => []),
          portalFetch("/api/portal/notifications").catch(() => ({ email: true, sms: false })),
          portalFetch("/api/portal/service-changes").catch(() => []),
          portalFetch("/api/portal/photos").catch(() => []),
        ]);

        setPaymentMethods(pmData.methods || []);
        setAutoPayEnabled(pmData.autoPayEnabled || false);
        setReferralCode(referralData.referralCode || null);
        setReferralCount(referralData.referralCount || 0);
        setEstimates(estimatesData);
        setNotifPrefs({
          email: notifsData.email ?? true,
          sms: notifsData.sms ?? false,
          serviceReminder: notifsData.serviceReminder ?? true,
          serviceCompleted: notifsData.serviceCompleted ?? true,
          invoiceReady: notifsData.invoiceReady ?? true,
          invoiceDueReminder: notifsData.invoiceDueReminder ?? true,
          paymentConfirmation: notifsData.paymentConfirmation ?? true,
        });
        setChangeRequests(changesData);
        setGalleryPhotos(photosData);
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
      const scheduleData = await portalFetch("/api/portal/schedule");
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

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactMessage.trim()) {
      toast({ title: "Required", description: "Please enter a message.", variant: "destructive" });
      return;
    }
    setSendingMessage(true);
    try {
      await portalFetch("/api/portal/contact-us", {
        method: "POST",
        body: JSON.stringify({ subject: contactSubject, message: contactMessage }),
      });
      toast({ title: "Message sent", description: "Your message has been sent to the service provider." });
      setContactSubject("");
      setContactMessage("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSendingMessage(false);
    }
  };

  const handleRequestCleanup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleanupDate) {
      toast({ title: "Required", description: "Please select a preferred date.", variant: "destructive" });
      return;
    }
    setCleanupPending(true);
    try {
      await portalFetch("/api/portal/request-cleanup", {
        method: "POST",
        body: JSON.stringify({ preferredDate: cleanupDate, notes: cleanupNotes }),
      });
      toast({ title: "Request submitted", description: "Your one-time cleanup request has been sent." });
      setCleanupDate("");
      setCleanupNotes("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setCleanupPending(false);
    }
  };

  const handleSaveProperties = async () => {
    setSavingProperties(true);
    try {
      const propertyUpdates = Object.entries(propertyEdits).map(([id, vals]) => ({
        id,
        gateCode: vals.gateCode,
        specialInstructions: vals.specialInstructions,
      }));
      await portalFetch("/api/portal/profile", {
        method: "PATCH",
        body: JSON.stringify({ properties: propertyUpdates }),
      });
      toast({ title: "Saved", description: "Property details have been updated." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingProperties(false);
    }
  };

  const handleSaveDogs = async () => {
    setSavingDogs(true);
    try {
      await portalFetch("/api/portal/profile", {
        method: "PATCH",
        body: JSON.stringify({ numberOfDogs }),
      });
      toast({ title: "Saved", description: "Pet count has been updated." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingDogs(false);
    }
  };

  const handleAddCard = async () => {
    setAddingCard(true);
    try {
      const result = await portalFetch("/api/portal/setup-intent", { method: "POST" });
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setAddingCard(false);
    }
  };

  const handleRemoveCard = async (methodId: string) => {
    try {
      await portalFetch(`/api/portal/payment-methods/${methodId}`, { method: "DELETE" });
      setPaymentMethods((prev) => prev.filter((m) => m.id !== methodId));
      toast({ title: "Card removed", description: "Payment method has been removed." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleToggleAutoPay = async (enabled: boolean) => {
    try {
      await portalFetch("/api/portal/auto-pay", {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      setAutoPayEnabled(enabled);
      toast({ title: enabled ? "Auto-pay enabled" : "Auto-pay disabled" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleGenerateReferral = async () => {
    setGeneratingCode(true);
    try {
      const result = await portalFetch("/api/portal/referral/generate", { method: "POST" });
      setReferralCode(result.referralCode);
      toast({ title: "Referral code generated" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleCopyReferral = () => {
    if (!referralCode) return;
    const link = `${window.location.origin}/portal/login?ref=${referralCode}`;
    navigator.clipboard.writeText(link);
    setCopiedReferral(true);
    setTimeout(() => setCopiedReferral(false), 2000);
  };

  const handleEstimateAction = async (estimateId: string, action: "approve" | "decline") => {
    try {
      const note = estimateNote[estimateId] || "";
      await portalFetch(`/api/portal/estimates/${estimateId}/${action}`, {
        method: "POST",
        body: JSON.stringify(action === "approve" ? { note } : { reason: note }),
      });
      setEstimates((prev) =>
        prev.map((e) => e.id === estimateId ? { ...e, status: action === "approve" ? "approved" : "declined", respondedAt: new Date().toISOString() } : e)
      );
      toast({ title: `Estimate ${action}d`, description: `The estimate has been ${action}d.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleSaveNotifPrefs = async () => {
    setSavingNotifs(true);
    try {
      await portalFetch("/api/portal/notifications", {
        method: "PATCH",
        body: JSON.stringify(notifPrefs),
      });
      toast({ title: "Saved", description: "Notification preferences updated." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingNotifs(false);
    }
  };

  const handleSubmitChangeRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changeType) {
      toast({ title: "Required", description: "Please select a request type.", variant: "destructive" });
      return;
    }
    setSubmittingChange(true);
    try {
      await portalFetch("/api/portal/service-change", {
        method: "POST",
        body: JSON.stringify({
          servicePlanId: changePlanId || null,
          requestType: changeType,
          requestedValue: changeValue || null,
          note: changeNote || null,
        }),
      });
      toast({ title: "Request submitted", description: "Your service change request has been sent." });
      setChangeType("");
      setChangePlanId("");
      setChangeValue("");
      setChangeNote("");
      const updated = await portalFetch("/api/portal/service-changes").catch(() => []);
      setChangeRequests(updated);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSubmittingChange(false);
    }
  };

  const handleDownloadInvoicePdf = async (invoiceId: string, invoiceNumber: string) => {
    try {
      await portalDownload(`/api/portal/invoices/${invoiceId}/pdf`, `invoice-${invoiceNumber}.pdf`);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDownloadStatement = async () => {
    if (!billingStartDate || !billingEndDate) {
      toast({ title: "Required", description: "Please select a date range.", variant: "destructive" });
      return;
    }
    setDownloadingStatement(true);
    try {
      await portalDownload(
        `/api/portal/billing-statement?startDate=${billingStartDate}&endDate=${billingEndDate}`,
        `billing-statement-${billingStartDate}-to-${billingEndDate}.pdf`
      );
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDownloadingStatement(false);
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
  const activeInvoices = invoices.filter((inv) => inv.status !== "voided");
  const pendingEstimates = estimates.filter((e) => e.status === "pending");
  const pastEstimates = estimates.filter((e) => e.status !== "pending");
  const totalPages = Math.ceil(pastVisitsTotal / 20);

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
        {/* Service Schedule */}
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
                      <span className="font-medium">{frequencyLabels[plan.frequency] || plan.frequency}</span>
                      {plan.dayOfWeek && (
                        <span className="text-muted-foreground capitalize">- {plan.dayOfWeek}s</span>
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

        {/* Past Visits (T002) */}
        {pastVisits.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5" /> Past Visits
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {pastVisits.map((visit) => (
                  <div key={visit.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border rounded-md p-2" data-testid={`card-past-visit-${visit.id}`}>
                    <div className="flex items-center gap-2">
                      <div>
                        <span className="font-medium">{visit.scheduledDate}</span>
                        {visit.propertyAddress && (
                          <span className="text-muted-foreground ml-2">{visit.propertyAddress}</span>
                        )}
                      </div>
                      {(visit.proofOfServicePhoto || visit.proofOfServicePhotoBefore) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => setVisitPhotoModal(visit)}
                          data-testid={`button-view-photos-${visit.id}`}
                        >
                          <Camera className="h-3 w-3 mr-1" /> Photos
                        </Button>
                      )}
                    </div>
                    <Badge variant="secondary" className={statusColors[visit.status] || ""}>
                      {visit.status}
                    </Badge>
                  </div>
                ))}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pastVisitsPage <= 1}
                    onClick={() => loadVisitHistory(pastVisitsPage - 1)}
                    data-testid="button-prev-visits"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {pastVisitsPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pastVisitsPage >= totalPages}
                    onClick={() => loadVisitHistory(pastVisitsPage + 1)}
                    data-testid="button-next-visits"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Invoices + PDF Downloads (T008) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" /> Invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeInvoices.length > 0 ? (
              <div className="space-y-2">
                {activeInvoices.map((inv) => (
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
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDownloadInvoicePdf(inv.id, inv.invoiceNumber)}
                        data-testid={`button-download-invoice-${inv.id}`}
                      >
                        <Download className="h-3 w-3" />
                      </Button>
                      {inv.status !== "paid" && inv.status !== "voided" && (
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

            <div className="border-t mt-4 pt-4">
              <p className="text-sm font-medium text-muted-foreground mb-3">Download Billing Statement</p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label htmlFor="billing-start">Start Date</Label>
                  <Input
                    id="billing-start"
                    type="date"
                    value={billingStartDate}
                    onChange={(e) => setBillingStartDate(e.target.value)}
                    data-testid="input-billing-start"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="billing-end">End Date</Label>
                  <Input
                    id="billing-end"
                    type="date"
                    value={billingEndDate}
                    onChange={(e) => setBillingEndDate(e.target.value)}
                    data-testid="input-billing-end"
                  />
                </div>
                <Button
                  onClick={handleDownloadStatement}
                  disabled={downloadingStatement}
                  data-testid="button-download-statement"
                >
                  <Download className="mr-1 h-4 w-4" />
                  {downloadingStatement ? "Downloading..." : "Download PDF"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Estimates (T004) */}
        {estimates.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5" /> Estimates
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {pendingEstimates.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-muted-foreground">Pending Review</p>
                  {pendingEstimates.map((est) => (
                    <div key={est.id} className="border rounded-md p-3 space-y-3" data-testid={`card-estimate-${est.id}`}>
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-sm">{est.description}</p>
                        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">Pending</Badge>
                      </div>
                      {est.items && est.items.length > 0 && (
                        <div className="text-xs space-y-1 bg-muted/50 rounded p-2">
                          {est.items.map((item, idx) => (
                            <div key={idx} className="flex justify-between">
                              <span>{item.description} x{item.quantity}</span>
                              <span>${Number(item.total).toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-lg font-semibold">Total: ${(est.totalCents / 100).toFixed(2)}</p>
                      <div className="space-y-2">
                        <Textarea
                          placeholder="Optional note..."
                          value={estimateNote[est.id] || ""}
                          onChange={(e) => setEstimateNote((prev) => ({ ...prev, [est.id]: e.target.value }))}
                          rows={2}
                          data-testid={`input-estimate-note-${est.id}`}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleEstimateAction(est.id, "approve")}
                            data-testid={`button-approve-estimate-${est.id}`}
                          >
                            <Check className="mr-1 h-3 w-3" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEstimateAction(est.id, "decline")}
                            data-testid={`button-decline-estimate-${est.id}`}
                          >
                            <X className="mr-1 h-3 w-3" /> Decline
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {pastEstimates.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Past Estimates</p>
                  {pastEstimates.map((est) => (
                    <div key={est.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border rounded-md p-2" data-testid={`card-estimate-past-${est.id}`}>
                      <div>
                        <p className="font-medium">{est.description}</p>
                        <p className="text-xs text-muted-foreground">${(est.totalCents / 100).toFixed(2)}</p>
                      </div>
                      <Badge className={est.status === "approved" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"}>
                        {est.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Payment Methods (T001) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CreditCard className="h-5 w-5" /> Payment Methods
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {paymentMethods.length > 0 ? (
              <div className="space-y-2">
                {paymentMethods.map((pm) => (
                  <div key={pm.id} className="flex items-center justify-between border rounded-md p-3" data-testid={`card-payment-method-${pm.id}`}>
                    <div className="flex items-center gap-3">
                      <CreditCard className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium capitalize">{pm.brand} **** {pm.last4}</p>
                        <p className="text-xs text-muted-foreground">Expires {pm.expMonth}/{pm.expYear}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveCard(pm.id)}
                      data-testid={`button-remove-card-${pm.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No payment methods on file.</p>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleAddCard}
              disabled={addingCard}
              data-testid="button-add-card"
            >
              <Plus className="mr-1 h-4 w-4" /> {addingCard ? "Setting up..." : "Add Card"}
            </Button>

            <div className="flex items-center justify-between border-t pt-3">
              <div>
                <p className="text-sm font-medium">Auto-Pay</p>
                <p className="text-xs text-muted-foreground">Automatically pay invoices with your card on file</p>
              </div>
              <Switch
                checked={autoPayEnabled}
                onCheckedChange={handleToggleAutoPay}
                data-testid="switch-auto-pay"
              />
            </div>
          </CardContent>
        </Card>

        {/* Service Gallery (T007) */}
        {galleryPhotos.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Image className="h-5 w-5" /> Service Gallery
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {galleryPhotos.map((photo, idx) => (
                  <button
                    key={photo.id}
                    className="relative aspect-square rounded-md overflow-hidden border hover:ring-2 hover:ring-primary transition-all cursor-pointer bg-muted"
                    onClick={() => setPhotoModalIndex(idx)}
                    data-testid={`button-gallery-photo-${photo.id}`}
                  >
                    <img
                      src={photo.proofOfServicePhoto || photo.proofOfServicePhotoBefore || ""}
                      alt={`Service on ${photo.scheduledDate}`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1.5">
                      {photo.scheduledDate}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Request One-Time Cleanup */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5" /> Request One-Time Cleanup
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRequestCleanup} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="cleanup-date">Preferred Date</Label>
                <Input
                  id="cleanup-date"
                  type="date"
                  value={cleanupDate}
                  onChange={(e) => setCleanupDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  data-testid="input-cleanup-date"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cleanup-notes">Notes (optional)</Label>
                <Textarea
                  id="cleanup-notes"
                  value={cleanupNotes}
                  onChange={(e) => setCleanupNotes(e.target.value)}
                  placeholder="Any special requests or details..."
                  rows={3}
                  data-testid="input-cleanup-notes"
                />
              </div>
              <Button type="submit" disabled={cleanupPending} data-testid="button-submit-cleanup">
                <Send className="mr-1 h-4 w-4" />
                {cleanupPending ? "Submitting..." : "Submit Request"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Service Change Requests (T006) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" /> Request Service Change
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmitChangeRequest} className="space-y-3">
              {schedule?.servicePlans && schedule.servicePlans.length > 1 && (
                <div className="space-y-1">
                  <Label>Service Plan (optional)</Label>
                  <Select value={changePlanId} onValueChange={setChangePlanId}>
                    <SelectTrigger data-testid="select-change-plan">
                      <SelectValue placeholder="Select a plan..." />
                    </SelectTrigger>
                    <SelectContent>
                      {schedule.servicePlans.map((plan) => (
                        <SelectItem key={plan.id} value={plan.id}>
                          {frequencyLabels[plan.frequency] || plan.frequency} {plan.dayOfWeek ? `- ${plan.dayOfWeek}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <Label>Change Type</Label>
                <Select value={changeType} onValueChange={setChangeType}>
                  <SelectTrigger data-testid="select-change-type">
                    <SelectValue placeholder="What would you like to change?" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="frequency_change">Change Frequency</SelectItem>
                    <SelectItem value="day_change">Change Service Day</SelectItem>
                    <SelectItem value="cancel">Cancel Service</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(changeType === "frequency_change" || changeType === "day_change") && (
                <div className="space-y-1">
                  <Label>Preferred {changeType === "frequency_change" ? "Frequency" : "Day"}</Label>
                  {changeType === "frequency_change" ? (
                    <Select value={changeValue} onValueChange={setChangeValue}>
                      <SelectTrigger data-testid="select-change-value">
                        <SelectValue placeholder="Select new frequency..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="biweekly">Bi-Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select value={changeValue} onValueChange={setChangeValue}>
                      <SelectTrigger data-testid="select-change-value">
                        <SelectValue placeholder="Select new day..." />
                      </SelectTrigger>
                      <SelectContent>
                        {["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => (
                          <SelectItem key={day} value={day}>{day.charAt(0).toUpperCase() + day.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="change-note">Details (optional)</Label>
                <Textarea
                  id="change-note"
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  placeholder="Any additional details..."
                  rows={2}
                  data-testid="input-change-note"
                />
              </div>
              <Button type="submit" disabled={submittingChange} data-testid="button-submit-change">
                <Send className="mr-1 h-4 w-4" />
                {submittingChange ? "Submitting..." : "Submit Request"}
              </Button>
            </form>

            {changeRequests.length > 0 && (
              <div className="border-t pt-3 space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Your Requests</p>
                {changeRequests.map((cr) => (
                  <div key={cr.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border rounded-md p-2" data-testid={`card-change-request-${cr.id}`}>
                    <div>
                      <p className="font-medium">{changeRequestTypeLabels[cr.requestType] || cr.requestType}</p>
                      {cr.requestedValue && <p className="text-xs text-muted-foreground">Requested: {cr.requestedValue}</p>}
                      {cr.note && <p className="text-xs text-muted-foreground">{cr.note}</p>}
                      {cr.adminNote && <p className="text-xs">Admin: {cr.adminNote}</p>}
                    </div>
                    <Badge variant="secondary" className={changeRequestStatusColors[cr.status] || ""}>
                      {cr.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Referral Program (T003) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Gift className="h-5 w-5" /> Refer a Friend
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {referralCode ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-muted rounded-md px-3 py-2 text-sm font-mono" data-testid="text-referral-code">
                    {referralCode}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyReferral}
                    data-testid="button-copy-referral"
                  >
                    {copiedReferral ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Share this link with friends to refer them to the service.
                </p>
                <p className="text-sm" data-testid="text-referral-count">
                  Successful referrals: <span className="font-semibold">{referralCount}</span>
                </p>
              </>
            ) : (
              <div>
                <p className="text-sm text-muted-foreground mb-3">
                  Generate your unique referral code to share with friends.
                </p>
                <Button
                  onClick={handleGenerateReferral}
                  disabled={generatingCode}
                  data-testid="button-generate-referral"
                >
                  <Gift className="mr-1 h-4 w-4" />
                  {generatingCode ? "Generating..." : "Get My Referral Code"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notification Preferences (T005) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="h-5 w-5" /> Notification Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <p className="text-sm font-medium">Receive Email Notifications</p>
                <Switch
                  checked={notifPrefs.email}
                  onCheckedChange={(v) => setNotifPrefs((p) => ({ ...p, email: v }))}
                  data-testid="switch-notif-email-global"
                />
              </div>
              <div className="flex items-center justify-between border-b pb-2">
                <p className="text-sm font-medium">Receive SMS Notifications</p>
                <Switch
                  checked={notifPrefs.sms}
                  onCheckedChange={(v) => setNotifPrefs((p) => ({ ...p, sms: v }))}
                  data-testid="switch-notif-sms-global"
                />
              </div>
              <p className="text-xs text-muted-foreground pt-1">Notification Types</p>
              {[
                { key: "serviceReminder", label: "Service Reminders" },
                { key: "serviceCompleted", label: "Service Completed" },
                { key: "invoiceReady", label: "Invoice Ready" },
                { key: "invoiceDueReminder", label: "Invoice Due Reminder" },
                { key: "paymentConfirmation", label: "Payment Confirmation" },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between">
                  <p className="text-sm">{label}</p>
                  <Switch
                    checked={notifPrefs[key] ?? true}
                    onCheckedChange={(v) => setNotifPrefs((p) => ({ ...p, [key]: v }))}
                    data-testid={`switch-notif-${key}`}
                  />
                </div>
              ))}
            </div>

            <Button onClick={handleSaveNotifPrefs} disabled={savingNotifs} data-testid="button-save-notifications">
              <Save className="mr-1 h-4 w-4" />
              {savingNotifs ? "Saving..." : "Save Preferences"}
            </Button>
          </CardContent>
        </Card>

        {/* Pet Count */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Dog className="h-5 w-5" /> Pet Count
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="number-of-dogs">Number of Dogs</Label>
                <Input
                  id="number-of-dogs"
                  type="number"
                  min={0}
                  value={numberOfDogs}
                  onChange={(e) => setNumberOfDogs(parseInt(e.target.value) || 0)}
                  className="w-24"
                  data-testid="input-number-of-dogs"
                />
              </div>
              <Button onClick={handleSaveDogs} disabled={savingDogs} data-testid="button-save-dogs">
                <Save className="mr-1 h-4 w-4" />
                {savingDogs ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Properties */}
        {properties.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-lg flex items-center gap-2">
                <Home className="h-5 w-5" /> My Properties
              </CardTitle>
              <Button
                size="sm"
                onClick={handleSaveProperties}
                disabled={savingProperties}
                data-testid="button-save-properties"
              >
                <Save className="mr-1 h-4 w-4" />
                {savingProperties ? "Saving..." : "Save Changes"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {properties.map((prop) => (
                <div key={prop.id} className="border rounded-md p-3 space-y-3" data-testid={`card-property-${prop.id}`}>
                  <p className="font-medium text-sm" data-testid={`text-property-address-${prop.id}`}>
                    {prop.streetAddress}, {prop.city}, {prop.state} {prop.zipCode}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor={`gate-code-${prop.id}`}>Gate Code</Label>
                      <Input
                        id={`gate-code-${prop.id}`}
                        value={propertyEdits[prop.id]?.gateCode || ""}
                        onChange={(e) =>
                          setPropertyEdits((prev) => ({
                            ...prev,
                            [prop.id]: { ...prev[prop.id], gateCode: e.target.value },
                          }))
                        }
                        placeholder="Gate code"
                        data-testid={`input-gate-code-${prop.id}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`special-${prop.id}`}>Special Instructions</Label>
                      <Input
                        id={`special-${prop.id}`}
                        value={propertyEdits[prop.id]?.specialInstructions || ""}
                        onChange={(e) =>
                          setPropertyEdits((prev) => ({
                            ...prev,
                            [prop.id]: { ...prev[prop.id], specialInstructions: e.target.value },
                          }))
                        }
                        placeholder="Special instructions"
                        data-testid={`input-special-instructions-${prop.id}`}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Contact Us */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Mail className="h-5 w-5" /> Contact Us
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSendMessage} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="contact-subject">Subject (optional)</Label>
                <Input
                  id="contact-subject"
                  value={contactSubject}
                  onChange={(e) => setContactSubject(e.target.value)}
                  placeholder="Subject"
                  data-testid="input-contact-subject"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="contact-message">Message</Label>
                <Textarea
                  id="contact-message"
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  placeholder="How can we help?"
                  rows={4}
                  data-testid="input-contact-message"
                />
              </div>
              <Button type="submit" disabled={sendingMessage} data-testid="button-send-message">
                <Send className="mr-1 h-4 w-4" />
                {sendingMessage ? "Sending..." : "Send Message"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>

      {/* Visit Photo Modal */}
      {visitPhotoModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setVisitPhotoModal(null)}>
          <div className="bg-background rounded-lg max-w-3xl w-full max-h-[90vh] overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Service Photos - {visitPhotoModal.scheduledDate}</h3>
              <Button variant="ghost" size="icon" onClick={() => setVisitPhotoModal(null)} data-testid="button-close-photo-modal">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {visitPhotoModal.proofOfServicePhotoBefore && (
                <div>
                  <p className="text-sm font-medium mb-2 text-muted-foreground">Before</p>
                  <img
                    src={visitPhotoModal.proofOfServicePhotoBefore}
                    alt="Before service"
                    className="w-full rounded-md"
                    data-testid="img-visit-before"
                  />
                </div>
              )}
              {visitPhotoModal.proofOfServicePhoto && (
                <div>
                  <p className="text-sm font-medium mb-2 text-muted-foreground">After</p>
                  <img
                    src={visitPhotoModal.proofOfServicePhoto}
                    alt="After service"
                    className="w-full rounded-md"
                    data-testid="img-visit-after"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Gallery Photo Modal */}
      {photoModalIndex !== null && galleryPhotos[photoModalIndex] && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setPhotoModalIndex(null)}>
          <div className="bg-background rounded-lg max-w-3xl w-full max-h-[90vh] overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold">
                  {galleryPhotos[photoModalIndex].scheduledDate}
                </h3>
                <p className="text-sm text-muted-foreground">{galleryPhotos[photoModalIndex].propertyAddress}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={photoModalIndex <= 0}
                  onClick={() => setPhotoModalIndex((prev) => (prev !== null ? prev - 1 : null))}
                  data-testid="button-gallery-prev"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">{photoModalIndex + 1} / {galleryPhotos.length}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={photoModalIndex >= galleryPhotos.length - 1}
                  onClick={() => setPhotoModalIndex((prev) => (prev !== null ? prev + 1 : null))}
                  data-testid="button-gallery-next"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setPhotoModalIndex(null)} data-testid="button-close-gallery">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {galleryPhotos[photoModalIndex].proofOfServicePhotoBefore && (
                <div>
                  <p className="text-sm font-medium mb-2 text-muted-foreground">Before</p>
                  <img
                    src={galleryPhotos[photoModalIndex].proofOfServicePhotoBefore!}
                    alt="Before service"
                    className="w-full rounded-md"
                    data-testid="img-gallery-before"
                  />
                </div>
              )}
              {galleryPhotos[photoModalIndex].proofOfServicePhoto && (
                <div>
                  <p className="text-sm font-medium mb-2 text-muted-foreground">After</p>
                  <img
                    src={galleryPhotos[photoModalIndex].proofOfServicePhoto!}
                    alt="After service"
                    className="w-full rounded-md"
                    data-testid="img-gallery-after"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
