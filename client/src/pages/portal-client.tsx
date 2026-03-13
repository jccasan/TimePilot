import { useState, useEffect, useCallback, useMemo } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
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
  DollarSign,
  CalendarCheck,
  AlertCircle,
  Settings,
  LayoutDashboard,
  Receipt,
  Wrench,
  CheckCircle2,
  Shield,
  User,
  Phone,
} from "lucide-react";

interface PortalProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  companyName: string;
  numberOfDogs?: number;
  pendingEmail?: string | null;
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
  tipAmount: string;
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
  in_progress: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
};

const statusLabels: Record<string, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  skipped: "Skipped",
  cancelled: "Cancelled",
  in_progress: "In Progress",
};

const invoiceStatusLabels: Record<string, string> = {
  draft: "Draft",
  pending: "Pending",
  paid: "Paid",
  voided: "Voided",
  failed: "Failed",
  refunded: "Refunded",
};

const changeRequestStatusLabels: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  denied: "Denied",
};

const invoiceStatusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
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
  same_day_service: "Same-Day Service",
  pause: "Pause Service",
  cancel: "Cancel Service",
  other: "Other",
};

const changeRequestStatusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  denied: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function SummaryCard({ icon: Icon, label, value, sublabel, accent }: {
  icon: any;
  label: string;
  value: string;
  sublabel?: string;
  accent?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className={`rounded-lg p-2.5 ${accent || "bg-primary/10 text-primary"}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-lg font-semibold mt-0.5 truncate" data-testid={`text-summary-${label.toLowerCase().replace(/\s/g, '-')}`}>{value}</p>
        {sublabel && <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>}
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <p className="font-medium text-muted-foreground">{title}</p>
      <p className="text-sm text-muted-foreground/70 mt-1 max-w-xs">{description}</p>
    </div>
  );
}

function SectionHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  );
}

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
  const [propertyEdits, setPropertyEdits] = useState<Record<string, { gateCode: string; specialInstructions: string; streetAddress: string; city: string; state: string; zipCode: string }>>({});
  const [savingProperties, setSavingProperties] = useState(false);
  const [numberOfDogs, setNumberOfDogs] = useState<number>(0);
  const [savingDogs, setSavingDogs] = useState(false);
  const [profileEdits, setProfileEdits] = useState({ firstName: "", lastName: "", email: "", phone: "", streetAddress: "", city: "", state: "", zipCode: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [autoPayEnabled, setAutoPayEnabled] = useState(false);
  const [addingCard, setAddingCard] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralCount, setReferralCount] = useState(0);
  const [copiedReferral, setCopiedReferral] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [tipDialogInvoice, setTipDialogInvoice] = useState<PortalInvoice | null>(null);
  const [selectedTip, setSelectedTip] = useState<number>(0);
  const [customTip, setCustomTip] = useState("");
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

  const params = new URLSearchParams(window.location.search);
  const initialTab = params.get("tab") || "overview";
  const [activeTab, setActiveTab] = useState(initialTab);

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
        setProfileEdits({
          firstName: profileData.firstName || "",
          lastName: profileData.lastName || "",
          email: profileData.email || "",
          phone: profileData.phone || "",
          streetAddress: profileData.streetAddress || "",
          city: profileData.city || "",
          state: profileData.state || "",
          zipCode: profileData.zipCode || "",
        });
        const edits: Record<string, { gateCode: string; specialInstructions: string; streetAddress: string; city: string; state: string; zipCode: string }> = {};
        for (const p of propertiesData) {
          edits[p.id] = {
            gateCode: p.gateCode || "",
            specialInstructions: p.specialInstructions || "",
            streetAddress: p.streetAddress || "",
            city: p.city || "",
            state: p.state || "",
            zipCode: p.zipCode || "",
          };
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

  const handlePayInvoice = (invoiceId: string) => {
    const inv = invoices.find(i => i.id === invoiceId);
    if (inv) {
      setTipDialogInvoice(inv);
      setSelectedTip(0);
      setCustomTip("");
    }
  };

  const handleConfirmPayWithTip = async () => {
    if (!tipDialogInvoice) return;
    const tipValue = customTip ? parseFloat(customTip) : selectedTip;
    if (isNaN(tipValue) || tipValue < 0) {
      toast({ title: "Invalid tip", description: "Please enter a valid tip amount.", variant: "destructive" });
      return;
    }
    setActionPending(true);
    try {
      const result = await portalFetch(`/api/portal/invoices/${tipDialogInvoice.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipAmount: tipValue }),
      });
      if (result.url) {
        window.open(result.url, "_blank");
      }
      setTipDialogInvoice(null);
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

  const handleSaveProfile = async () => {
    if (!profileEdits.firstName.trim()) {
      toast({ title: "Required", description: "First name is required.", variant: "destructive" });
      return;
    }
    setSavingProfile(true);
    try {
      const result = await portalFetch("/api/portal/profile", {
        method: "PATCH",
        body: JSON.stringify({
          firstName: profileEdits.firstName,
          lastName: profileEdits.lastName,
          email: profileEdits.email,
          phone: profileEdits.phone,
          streetAddress: profileEdits.streetAddress,
          city: profileEdits.city,
          state: profileEdits.state,
          zipCode: profileEdits.zipCode,
        }),
      });
      if (result.profile) {
        setProfile(result.profile);
        setProfileEdits({
          firstName: result.profile.firstName || "",
          lastName: result.profile.lastName || "",
          email: result.profile.email || "",
          phone: result.profile.phone || "",
          streetAddress: result.profile.streetAddress || "",
          city: result.profile.city || "",
          state: result.profile.state || "",
          zipCode: result.profile.zipCode || "",
        });
      }
      if (result.emailVerificationSent) {
        toast({
          title: "Verification email sent",
          description: `A verification link was sent to ${result.pendingEmail}. Your current email remains active until you verify the new one.`,
        });
      } else {
        toast({ title: "Saved", description: "Your information has been updated." });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveProperties = async () => {
    setSavingProperties(true);
    try {
      const propertyUpdates = Object.entries(propertyEdits).map(([id, vals]) => ({
        id,
        gateCode: vals.gateCode,
        specialInstructions: vals.specialInstructions,
        streetAddress: vals.streetAddress,
        city: vals.city,
        state: vals.state,
        zipCode: vals.zipCode,
      }));
      await portalFetch("/api/portal/profile", {
        method: "PATCH",
        body: JSON.stringify({ properties: propertyUpdates }),
      });
      const updatedProps = await portalFetch("/api/portal/properties").catch(() => []);
      setProperties(updatedProps);
      const newEdits: Record<string, { gateCode: string; specialInstructions: string; streetAddress: string; city: string; state: string; zipCode: string }> = {};
      for (const p of updatedProps) {
        newEdits[p.id] = {
          gateCode: p.gateCode || "",
          specialInstructions: p.specialInstructions || "",
          streetAddress: p.streetAddress || "",
          city: p.city || "",
          state: p.state || "",
          zipCode: p.zipCode || "",
        };
      }
      setPropertyEdits(newEdits);
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

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url.toString());
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const hasActivePlans = schedule?.servicePlans.some((p) => p.isActive);
  const activeInvoices = useMemo(() => invoices.filter((inv) => inv.status !== "voided"), [invoices]);
  const unpaidInvoices = useMemo(() => activeInvoices.filter((inv) => inv.status !== "paid" && inv.status !== "voided"), [activeInvoices]);
  const balanceDue = useMemo(() => unpaidInvoices.reduce((sum, inv) => sum + Number(inv.total), 0), [unpaidInvoices]);
  const pendingEstimates = useMemo(() => estimates.filter((e) => e.status === "pending"), [estimates]);
  const pastEstimates = useMemo(() => estimates.filter((e) => e.status !== "pending"), [estimates]);
  const totalPages = Math.ceil(pastVisitsTotal / 20);
  const activePlan = schedule?.servicePlans.find((p) => p.isActive);
  const nextVisit = schedule?.upcomingVisits?.[0];

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b bg-card">
          <div className="max-w-4xl mx-auto p-4">
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="max-w-4xl mx-auto p-4 space-y-4 mt-4">
          <Skeleton className="h-10 w-full" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-bold text-xl text-foreground" data-testid="text-portal-welcome">
                {profile?.companyName || "Client Portal"}
              </h1>
              <p className="text-sm text-muted-foreground">
                Welcome, {profile?.firstName} {profile?.lastName}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground" data-testid="button-portal-logout">
              <LogOut className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 pt-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <User className="h-4 w-4 text-primary" /> Your Information
              </h2>
              <Button size="sm" onClick={handleSaveProfile} disabled={savingProfile} data-testid="button-save-profile-header">
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {savingProfile ? "Saving..." : "Save"}
              </Button>
            </div>
            {profile?.pendingEmail && (
              <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-700 px-3 py-2 text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2" data-testid="banner-pending-email">
                <Mail className="h-4 w-4 flex-shrink-0" />
                <span>Verification email sent to <strong>{profile.pendingEmail}</strong> — check your inbox to confirm the change.</span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="header-first-name" className="text-xs text-muted-foreground">Your First Name</Label>
                <Input
                  id="header-first-name"
                  value={profileEdits.firstName}
                  onChange={(e) => setProfileEdits((p) => ({ ...p, firstName: e.target.value }))}
                  placeholder="First name"
                  className="h-9"
                  data-testid="input-header-first-name"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="header-last-name" className="text-xs text-muted-foreground">Your Last Name</Label>
                <Input
                  id="header-last-name"
                  value={profileEdits.lastName}
                  onChange={(e) => setProfileEdits((p) => ({ ...p, lastName: e.target.value }))}
                  placeholder="Last name"
                  className="h-9"
                  data-testid="input-header-last-name"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="header-email" className="text-xs text-muted-foreground">Your Email</Label>
                <Input
                  id="header-email"
                  type="email"
                  value={profileEdits.email}
                  onChange={(e) => setProfileEdits((p) => ({ ...p, email: e.target.value }))}
                  placeholder="Email address"
                  className="h-9"
                  data-testid="input-header-email"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="header-phone" className="text-xs text-muted-foreground">Your Phone</Label>
                <Input
                  id="header-phone"
                  type="tel"
                  value={profileEdits.phone}
                  onChange={(e) => setProfileEdits((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="Phone number"
                  className="h-9"
                  data-testid="input-header-phone"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="header-street" className="text-xs text-muted-foreground">Street Address</Label>
              <Input
                id="header-street"
                value={profileEdits.streetAddress}
                onChange={(e) => setProfileEdits((p) => ({ ...p, streetAddress: e.target.value }))}
                placeholder="Street address"
                className="h-9"
                data-testid="input-header-street-address"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1 col-span-1">
                <Label htmlFor="header-city" className="text-xs text-muted-foreground">City</Label>
                <Input
                  id="header-city"
                  value={profileEdits.city}
                  onChange={(e) => setProfileEdits((p) => ({ ...p, city: e.target.value }))}
                  placeholder="City"
                  className="h-9"
                  data-testid="input-header-city"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="header-state" className="text-xs text-muted-foreground">State</Label>
                <Input
                  id="header-state"
                  value={profileEdits.state}
                  onChange={(e) => setProfileEdits((p) => ({ ...p, state: e.target.value }))}
                  placeholder="State"
                  className="h-9"
                  data-testid="input-header-state"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="header-zip" className="text-xs text-muted-foreground">Zip Code</Label>
                <Input
                  id="header-zip"
                  value={profileEdits.zipCode}
                  onChange={(e) => setProfileEdits((p) => ({ ...p, zipCode: e.target.value }))}
                  placeholder="Zip code"
                  className="h-9"
                  data-testid="input-header-zip-code"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="w-full grid grid-cols-4 mb-6" data-testid="tabs-portal-nav">
            <TabsTrigger value="overview" className="gap-1.5" data-testid="tab-overview">
              <LayoutDashboard className="h-4 w-4 hidden sm:block" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="services" className="gap-1.5" data-testid="tab-services">
              <Wrench className="h-4 w-4 hidden sm:block" />
              Services
            </TabsTrigger>
            <TabsTrigger value="billing" className="gap-1.5 relative" data-testid="tab-billing">
              <Receipt className="h-4 w-4 hidden sm:block" />
              Billing
              {unpaidInvoices.length > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold">
                  {unpaidInvoices.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="account" className="gap-1.5" data-testid="tab-account">
              <Settings className="h-4 w-4 hidden sm:block" />
              Account
            </TabsTrigger>
          </TabsList>

          {/* ==================== OVERVIEW TAB ==================== */}
          <TabsContent value="overview" className="space-y-6">
            {pendingEstimates.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 flex items-start gap-3" data-testid="alert-pending-estimates">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    You have {pendingEstimates.length} estimate{pendingEstimates.length > 1 ? "s" : ""} awaiting your review
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Review and approve or decline from the Billing tab</p>
                </div>
                <Button size="sm" variant="outline" className="shrink-0 border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200" onClick={() => handleTabChange("billing")} data-testid="button-go-estimates">
                  Review
                </Button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <SummaryCard
                icon={CalendarCheck}
                label="Next Visit"
                value={nextVisit ? nextVisit.scheduledDate : "None scheduled"}
                sublabel={nextVisit?.propertyAddress}
                accent="bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
              />
              <SummaryCard
                icon={DollarSign}
                label="Amount Due"
                value={balanceDue > 0 ? `$${balanceDue.toFixed(2)}` : "All clear"}
                sublabel={balanceDue > 0 ? `${unpaidInvoices.length} unpaid invoice${unpaidInvoices.length > 1 ? "s" : ""}` : "No outstanding balance"}
                accent={balanceDue > 0 ? "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400" : "bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400"}
              />
              <SummaryCard
                icon={Calendar}
                label="Your Service Plan"
                value={activePlan ? (frequencyLabels[activePlan.frequency] || activePlan.frequency) : "No active plan"}
                sublabel={activePlan ? `${activePlan.dayOfWeek ? activePlan.dayOfWeek.charAt(0).toUpperCase() + activePlan.dayOfWeek.slice(1) + "s" : ""} - $${Number(activePlan.pricePerVisit).toFixed(2)}/visit` : undefined}
                accent="bg-primary/10 text-primary"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {balanceDue > 0 && (
                <Button variant="outline" className="w-full justify-start gap-2" onClick={() => handleTabChange("billing")} data-testid="button-quick-pay">
                  <CreditCard className="h-4 w-4" /> Pay Invoice
                </Button>
              )}
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => handleTabChange("services")} data-testid="button-quick-services">
                <ArrowRightLeft className="h-4 w-4" /> Manage Services
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => handleTabChange("account")} data-testid="button-quick-contact">
                <Mail className="h-4 w-4" /> Contact Us
              </Button>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary" /> Service Plans
                  </CardTitle>
                  {hasActivePlans ? (
                    <Button size="sm" variant="outline" onClick={() => handlePauseResume("pause")} disabled={actionPending} data-testid="button-portal-pause">
                      <Pause className="mr-1.5 h-3.5 w-3.5" /> Pause
                    </Button>
                  ) : schedule?.servicePlans && schedule.servicePlans.length > 0 ? (
                    <Button size="sm" onClick={() => handlePauseResume("resume")} disabled={actionPending} data-testid="button-portal-resume">
                      <Play className="mr-1.5 h-3.5 w-3.5" /> Resume
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {schedule?.servicePlans && schedule.servicePlans.length > 0 ? (
                  schedule.servicePlans.map((plan) => (
                    <div key={plan.id} className="flex items-center justify-between rounded-lg border p-3 bg-card hover:bg-accent/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className={`h-2.5 w-2.5 rounded-full ${plan.isActive ? "bg-green-500" : "bg-gray-400"}`} />
                        <div>
                          <p className="text-sm font-medium">{frequencyLabels[plan.frequency] || plan.frequency}</p>
                          {plan.dayOfWeek && <p className="text-xs text-muted-foreground capitalize">{plan.dayOfWeek}s</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">${Number(plan.pricePerVisit).toFixed(2)}/visit</span>
                        <Badge variant="secondary" className={plan.isActive ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"}>
                          {plan.isActive ? "Active" : "Paused"}
                        </Badge>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-plans">No service plans found.</p>
                )}
              </CardContent>
            </Card>

            {schedule?.upcomingVisits && schedule.upcomingVisits.length > 0 ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" /> Upcoming Visits
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5">
                    {schedule.upcomingVisits.slice(0, 5).map((visit) => (
                      <div key={visit.id} className="flex items-center justify-between rounded-lg p-2.5 hover:bg-accent/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Calendar className="h-3.5 w-3.5 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{visit.scheduledDate}</p>
                            {visit.propertyAddress && <p className="text-xs text-muted-foreground">{visit.propertyAddress}</p>}
                          </div>
                        </div>
                        <Badge variant="secondary" className={statusColors[visit.status] || ""}>
                          {statusLabels[visit.status] || visit.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  {schedule.upcomingVisits.length > 5 && (
                    <Button variant="ghost" size="sm" className="w-full mt-2 text-muted-foreground" onClick={() => handleTabChange("services")}>
                      View all {schedule.upcomingVisits.length} visits
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-visits">No upcoming visits scheduled.</p>
                </CardContent>
              </Card>
            )}

            {referralCode && (
              <Card className="border-primary/20 bg-primary/[0.02]">
                <CardContent className="pt-5">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg p-2 bg-primary/10">
                      <Gift className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">Refer a Friend</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Share your referral link and earn rewards. {referralCount > 0 && `${referralCount} successful referral${referralCount > 1 ? "s" : ""} so far.`}
                      </p>
                      <Button variant="outline" size="sm" className="mt-2 gap-1.5" onClick={handleCopyReferral} data-testid="button-copy-referral-overview">
                        {copiedReferral ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedReferral ? "Copied" : "Copy Link"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ==================== SERVICES TAB ==================== */}
          <TabsContent value="services" className="space-y-6">
            {schedule?.servicePlans && schedule.servicePlans.length > 0 && (
              <section>
                <SectionHeader
                  title="Service Plans"
                  description="Your active service plans and scheduling"
                  action={
                    hasActivePlans ? (
                      <Button size="sm" variant="outline" onClick={() => handlePauseResume("pause")} disabled={actionPending} data-testid="button-portal-pause-svc">
                        <Pause className="mr-1.5 h-3.5 w-3.5" /> Pause All
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => handlePauseResume("resume")} disabled={actionPending} data-testid="button-portal-resume-svc">
                        <Play className="mr-1.5 h-3.5 w-3.5" /> Resume All
                      </Button>
                    )
                  }
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {schedule.servicePlans.map((plan) => (
                    <Card key={plan.id} className="overflow-hidden">
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold">{frequencyLabels[plan.frequency] || plan.frequency}</p>
                            {plan.dayOfWeek && <p className="text-sm text-muted-foreground capitalize mt-0.5">{plan.dayOfWeek}s</p>}
                            <p className="text-lg font-bold text-primary mt-2">${Number(plan.pricePerVisit).toFixed(2)}<span className="text-xs font-normal text-muted-foreground">/visit</span></p>
                          </div>
                          <Badge variant="secondary" className={plan.isActive ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"}>
                            {plan.isActive ? "Active" : "Paused"}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {schedule?.upcomingVisits && schedule.upcomingVisits.length > 0 && (
              <section>
                <SectionHeader title="Upcoming Visits" description={`${schedule.upcomingVisits.length} visit${schedule.upcomingVisits.length > 1 ? "s" : ""} scheduled`} />
                <Card>
                  <CardContent className="pt-4 divide-y">
                    {schedule.upcomingVisits.slice(0, 10).map((visit) => (
                      <div key={visit.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
                            <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{visit.scheduledDate}</p>
                            {visit.propertyAddress && <p className="text-xs text-muted-foreground">{visit.propertyAddress}</p>}
                          </div>
                        </div>
                        <Badge variant="secondary" className={statusColors[visit.status] || ""}>{statusLabels[visit.status] || visit.status}</Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </section>
            )}

            {pastVisits.length > 0 && (
              <section>
                <SectionHeader title="Past Visits" description={`${pastVisitsTotal} total visit${pastVisitsTotal > 1 ? "s" : ""}`} />
                <Card>
                  <CardContent className="pt-4 divide-y">
                    {pastVisits.map((visit) => (
                      <div key={visit.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0" data-testid={`card-past-visit-${visit.id}`}>
                        <div className="flex items-center gap-3">
                          {(visit.proofOfServicePhoto || visit.proofOfServicePhotoBefore) ? (
                            <button
                              className="h-10 w-10 rounded-full overflow-hidden border-2 border-primary/20 hover:border-primary transition-colors shrink-0"
                              onClick={() => setVisitPhotoModal(visit)}
                              data-testid={`button-view-photos-${visit.id}`}
                            >
                              <img
                                src={visit.proofOfServicePhoto || visit.proofOfServicePhotoBefore || ""}
                                alt="Service"
                                className="h-full w-full object-cover"
                              />
                            </button>
                          ) : (
                            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                              <Clock className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <div>
                            <p className="text-sm font-medium">{visit.scheduledDate}</p>
                            {visit.propertyAddress && <p className="text-xs text-muted-foreground">{visit.propertyAddress}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {(visit.proofOfServicePhoto || visit.proofOfServicePhotoBefore) && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setVisitPhotoModal(visit)}>
                              <Camera className="h-3 w-3 mr-1" /> Photos
                            </Button>
                          )}
                          <Badge variant="secondary" className={statusColors[visit.status] || ""}>{statusLabels[visit.status] || visit.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 mt-4">
                    <Button variant="outline" size="sm" disabled={pastVisitsPage <= 1} onClick={() => loadVisitHistory(pastVisitsPage - 1)} data-testid="button-prev-visits">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">Page {pastVisitsPage} of {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={pastVisitsPage >= totalPages} onClick={() => loadVisitHistory(pastVisitsPage + 1)} data-testid="button-next-visits">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </section>
            )}

            {galleryPhotos.length > 0 && (
              <section>
                <SectionHeader title="Service Gallery" description="Before and after photos from recent visits" />
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {galleryPhotos.map((photo, idx) => (
                    <button
                      key={photo.id}
                      className="group relative aspect-square rounded-xl overflow-hidden border hover:ring-2 hover:ring-primary/50 transition-all cursor-pointer bg-muted"
                      onClick={() => setPhotoModalIndex(idx)}
                      data-testid={`button-gallery-photo-${photo.id}`}
                    >
                      <img
                        src={photo.proofOfServicePhoto || photo.proofOfServicePhotoBefore || ""}
                        alt={`Service on ${photo.scheduledDate}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="absolute bottom-0 left-0 right-0 p-2">
                        <p className="text-white text-xs font-medium opacity-80 group-hover:opacity-100 transition-opacity">{photo.scheduledDate}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <Separator />

            <section>
              <SectionHeader title="Request Extra Visit" description="Need an extra visit? Submit a request below." />
              <Card>
                <CardContent className="pt-4">
                  <form onSubmit={handleRequestCleanup} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
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
                      <div className="space-y-1.5">
                        <Label htmlFor="cleanup-notes">Notes (optional)</Label>
                        <Input
                          id="cleanup-notes"
                          value={cleanupNotes}
                          onChange={(e) => setCleanupNotes(e.target.value)}
                          placeholder="Any special requests..."
                          data-testid="input-cleanup-notes"
                        />
                      </div>
                    </div>
                    <Button type="submit" disabled={cleanupPending} data-testid="button-submit-cleanup">
                      <Send className="mr-1.5 h-4 w-4" />
                      {cleanupPending ? "Submitting..." : "Submit Request"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </section>

            <section>
              <SectionHeader title="Change Your Service" description="Change frequency, service day, pause, or request same-day service" />
              <Card>
                <CardContent className="pt-4">
                  <form onSubmit={handleSubmitChangeRequest} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {schedule?.servicePlans && schedule.servicePlans.length > 1 && (
                        <div className="space-y-1.5">
                          <Label>Service Plan</Label>
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
                      <div className="space-y-1.5">
                        <Label>Change Type</Label>
                        <Select value={changeType} onValueChange={setChangeType}>
                          <SelectTrigger data-testid="select-change-type">
                            <SelectValue placeholder="What would you like to change?" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="same_day_service">Request Same-Day Service</SelectItem>
                            <SelectItem value="frequency_change">Change Frequency</SelectItem>
                            <SelectItem value="day_change">Change Service Day</SelectItem>
                            <SelectItem value="pause">Pause Service</SelectItem>
                            <SelectItem value="cancel">Cancel Service</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {(changeType === "frequency_change" || changeType === "day_change") && (
                      <div className="space-y-1.5">
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
                    <div className="space-y-1.5">
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
                      <Send className="mr-1.5 h-4 w-4" />
                      {submittingChange ? "Submitting..." : "Submit Request"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {changeRequests.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Your Requests</p>
                  {changeRequests.map((cr) => (
                    <div key={cr.id} className="flex items-start justify-between gap-3 rounded-lg border p-3 bg-card" data-testid={`card-change-request-${cr.id}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{changeRequestTypeLabels[cr.requestType] || cr.requestType}</p>
                          <Badge variant="secondary" className={`text-xs ${changeRequestStatusColors[cr.status] || ""}`}>{changeRequestStatusLabels[cr.status] || cr.status}</Badge>
                        </div>
                        {cr.requestedValue && <p className="text-xs text-muted-foreground mt-1">Requested: {cr.requestedValue}</p>}
                        {cr.note && <p className="text-xs text-muted-foreground">{cr.note}</p>}
                        {cr.adminNote && <p className="text-xs text-primary mt-1">Response: {cr.adminNote}</p>}
                      </div>
                      <p className="text-xs text-muted-foreground shrink-0">{new Date(cr.createdAt).toLocaleDateString()}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </TabsContent>

          {/* ==================== BILLING TAB ==================== */}
          <TabsContent value="billing" className="space-y-6">
            {pendingEstimates.length > 0 && (
              <section>
                <SectionHeader title="Estimates Awaiting Review" />
                <div className="space-y-3">
                  {pendingEstimates.map((est) => (
                    <Card key={est.id} className="border-amber-200 dark:border-amber-800" data-testid={`card-estimate-${est.id}`}>
                      <CardContent className="pt-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold">{est.description}</p>
                            {est.sentAt && <p className="text-xs text-muted-foreground mt-0.5">Sent {new Date(est.sentAt).toLocaleDateString()}</p>}
                          </div>
                          <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">Pending</Badge>
                        </div>
                        {est.items && est.items.length > 0 && (
                          <div className="rounded-lg border overflow-hidden">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-muted/50">
                                  <th className="text-left p-2 font-medium text-muted-foreground">Item</th>
                                  <th className="text-center p-2 font-medium text-muted-foreground">Qty</th>
                                  <th className="text-right p-2 font-medium text-muted-foreground">Amount</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {est.items.map((item, idx) => (
                                  <tr key={idx}>
                                    <td className="p-2">{item.description}</td>
                                    <td className="p-2 text-center">{item.quantity}</td>
                                    <td className="p-2 text-right">${Number(item.total).toFixed(2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        <div className="flex items-center justify-between pt-2 border-t">
                          <p className="text-lg font-bold">Total: ${(est.totalCents / 100).toFixed(2)}</p>
                        </div>
                        <Textarea
                          placeholder="Add a note (optional)..."
                          value={estimateNote[est.id] || ""}
                          onChange={(e) => setEstimateNote((prev) => ({ ...prev, [est.id]: e.target.value }))}
                          rows={2}
                          className="text-sm"
                          data-testid={`input-estimate-note-${est.id}`}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleEstimateAction(est.id, "approve")} className="gap-1.5" data-testid={`button-approve-estimate-${est.id}`}>
                            <Check className="h-3.5 w-3.5" /> Approve
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleEstimateAction(est.id, "decline")} className="gap-1.5" data-testid={`button-decline-estimate-${est.id}`}>
                            <X className="h-3.5 w-3.5" /> Decline
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            <section>
              <SectionHeader
                title="Invoices"
                description={activeInvoices.length > 0 ? `${activeInvoices.length} invoice${activeInvoices.length > 1 ? "s" : ""}` : undefined}
              />
              {activeInvoices.length > 0 ? (
                <Card>
                  <CardContent className="pt-0 pb-0">
                    <div className="divide-y">
                      {activeInvoices.map((inv) => (
                        <div key={inv.id} className="flex items-center justify-between py-3 gap-3" data-testid={`card-portal-invoice-${inv.id}`}>
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${inv.status === "paid" ? "bg-green-50 dark:bg-green-950" : "bg-amber-50 dark:bg-amber-950"}`}>
                              {inv.status === "paid" ? <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" /> : <Receipt className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{inv.invoiceNumber}</p>
                              <p className="text-xs text-muted-foreground">Due {inv.dueDate}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <div className="text-right mr-1">
                              <p className="text-sm font-semibold" data-testid={`text-invoice-total-${inv.id}`}>${Number(inv.total).toFixed(2)}</p>
                              {Number(inv.tipAmount) > 0 && (
                                <p className="text-[10px] text-green-600 dark:text-green-400" data-testid={`text-invoice-tip-${inv.id}`}>+ ${Number(inv.tipAmount).toFixed(2)} tip</p>
                              )}
                              <Badge variant="secondary" className={`text-[10px] ${invoiceStatusColors[inv.status] || ""}`}>{invoiceStatusLabels[inv.status] || inv.status}</Badge>
                            </div>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDownloadInvoicePdf(inv.id, inv.invoiceNumber)} data-testid={`button-download-invoice-${inv.id}`}>
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                            {inv.status !== "paid" && inv.status !== "voided" && (
                              <Button size="sm" onClick={() => handlePayInvoice(inv.id)} disabled={actionPending} data-testid={`button-portal-pay-${inv.id}`}>
                                Pay Invoice
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="pt-4">
                    <EmptyState icon={FileText} title="No invoices yet" description="Your invoices will appear here once generated." />
                  </CardContent>
                </Card>
              )}
            </section>

            <section>
              <SectionHeader title="Billing Statement" description="Download a PDF summary for a date range" />
              <Card>
                <CardContent className="pt-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="billing-start">Start Date</Label>
                      <Input id="billing-start" type="date" value={billingStartDate} onChange={(e) => setBillingStartDate(e.target.value)} data-testid="input-billing-start" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="billing-end">End Date</Label>
                      <Input id="billing-end" type="date" value={billingEndDate} onChange={(e) => setBillingEndDate(e.target.value)} data-testid="input-billing-end" />
                    </div>
                    <Button onClick={handleDownloadStatement} disabled={downloadingStatement} className="gap-1.5" data-testid="button-download-statement">
                      <Download className="h-4 w-4" />
                      {downloadingStatement ? "Downloading..." : "Download PDF"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </section>

            <Separator />

            <section>
              <SectionHeader title="Your Payment Method" description="Manage your cards on file" />
              <Card>
                <CardContent className="pt-4 space-y-4">
                  {paymentMethods.length > 0 ? (
                    <div className="space-y-2">
                      {paymentMethods.map((pm) => (
                        <div key={pm.id} className="flex items-center justify-between rounded-lg border p-3 bg-card" data-testid={`card-payment-method-${pm.id}`}>
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                              <CreditCard className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="text-sm font-medium capitalize">{pm.brand} ending in {pm.last4}</p>
                              <p className="text-xs text-muted-foreground">Expires {pm.expMonth}/{pm.expYear}</p>
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleRemoveCard(pm.id)} data-testid={`button-remove-card-${pm.id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-2">No payment methods on file.</p>
                  )}
                  <Button variant="outline" className="w-full border-dashed gap-1.5" onClick={handleAddCard} disabled={addingCard} data-testid="button-add-card">
                    <Plus className="h-4 w-4" /> {addingCard ? "Setting up..." : "Add New Card"}
                  </Button>
                  <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                    <div className="flex items-center gap-3">
                      <Shield className="h-5 w-5 text-primary" />
                      <div>
                        <p className="text-sm font-medium">Auto-Pay</p>
                        <p className="text-xs text-muted-foreground">Automatically pay invoices when due</p>
                      </div>
                    </div>
                    <Switch checked={autoPayEnabled} onCheckedChange={handleToggleAutoPay} data-testid="switch-auto-pay" />
                  </div>
                </CardContent>
              </Card>
            </section>

            {pastEstimates.length > 0 && (
              <section>
                <SectionHeader title="Past Estimates" />
                <Card>
                  <CardContent className="pt-0 pb-0 divide-y">
                    {pastEstimates.map((est) => (
                      <div key={est.id} className="flex items-center justify-between py-3" data-testid={`card-estimate-past-${est.id}`}>
                        <div>
                          <p className="text-sm font-medium">{est.description}</p>
                          <p className="text-xs text-muted-foreground">${(est.totalCents / 100).toFixed(2)}</p>
                        </div>
                        <Badge className={est.status === "approved" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"}>
                          {est.status.charAt(0).toUpperCase() + est.status.slice(1)}
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </section>
            )}

            <Dialog open={!!tipDialogInvoice} onOpenChange={(open) => { if (!open) setTipDialogInvoice(null); }}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Pay Invoice {tipDialogInvoice?.invoiceNumber}</DialogTitle>
                  <DialogDescription>Tips are appreciated but never expected. Add a tip to show your appreciation for your technician.</DialogDescription>
                </DialogHeader>
                {tipDialogInvoice && (
                  <div className="space-y-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Invoice Total</span>
                      <span className="font-semibold" data-testid="text-tip-invoice-total">${Number(tipDialogInvoice.total).toFixed(2)}</span>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Tip Amount</Label>
                      <div className="grid grid-cols-4 gap-2">
                        {[0, 5, 10, 15].map((amt) => (
                          <Button
                            key={amt}
                            type="button"
                            variant={selectedTip === amt && !customTip ? "default" : "outline"}
                            size="sm"
                            className="w-full"
                            onClick={() => { setSelectedTip(amt); setCustomTip(""); }}
                            data-testid={`button-tip-${amt}`}
                          >
                            {amt === 0 ? "No Tip" : `$${amt}`}
                          </Button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <Label htmlFor="custom-tip" className="text-sm text-muted-foreground whitespace-nowrap">Custom:</Label>
                        <div className="relative flex-1">
                          <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            id="custom-tip"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            className="pl-7"
                            value={customTip}
                            onChange={(e) => { setCustomTip(e.target.value); setSelectedTip(0); }}
                            data-testid="input-custom-tip"
                          />
                        </div>
                      </div>
                    </div>
                    <Separator />
                    <div className="flex justify-between text-sm font-semibold">
                      <span>Total Charge</span>
                      <span data-testid="text-tip-total-charge">
                        ${(Number(tipDialogInvoice.total) + (customTip ? parseFloat(customTip) || 0 : selectedTip)).toFixed(2)}
                      </span>
                    </div>
                    <Button
                      className="w-full"
                      onClick={handleConfirmPayWithTip}
                      disabled={actionPending}
                      data-testid="button-confirm-pay-with-tip"
                    >
                      {actionPending ? "Processing..." : "Continue to Payment"}
                    </Button>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* ==================== ACCOUNT TAB ==================== */}
          <TabsContent value="account" className="space-y-6">
            <section>
              <SectionHeader title="Pet Information" />
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <Dog className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="number-of-dogs" className="text-xs text-muted-foreground">Number of Dogs</Label>
                        <Input
                          id="number-of-dogs"
                          type="number"
                          min={0}
                          value={numberOfDogs}
                          onChange={(e) => setNumberOfDogs(parseInt(e.target.value) || 0)}
                          className="w-20 h-9"
                          data-testid="input-number-of-dogs"
                        />
                      </div>
                      <Button size="sm" onClick={handleSaveDogs} disabled={savingDogs} className="mt-5" data-testid="button-save-dogs">
                        <Save className="mr-1 h-3.5 w-3.5" />
                        {savingDogs ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            {properties.length > 0 && (
              <section>
                <SectionHeader
                  title="My Properties"
                  description="Update your address, gate codes, and special instructions"
                  action={
                    <Button size="sm" onClick={handleSaveProperties} disabled={savingProperties} data-testid="button-save-properties">
                      <Save className="mr-1.5 h-3.5 w-3.5" />
                      {savingProperties ? "Saving..." : "Save Changes"}
                    </Button>
                  }
                />
                <div className="space-y-3">
                  {properties.map((prop) => (
                    <Card key={prop.id} data-testid={`card-property-${prop.id}`}>
                      <CardContent className="pt-4 space-y-3">
                        <div className="flex items-start gap-3">
                          <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                            <Home className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <p className="font-medium text-sm pt-1.5" data-testid={`text-property-address-${prop.id}`}>
                            {prop.streetAddress ? `${prop.streetAddress}, ${prop.city}, ${prop.state} ${prop.zipCode}` : "No address on file"}
                          </p>
                        </div>
                        <div className="pl-12 space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5 sm:col-span-2">
                              <Label htmlFor={`street-${prop.id}`} className="text-xs">Street Address</Label>
                              <Input
                                id={`street-${prop.id}`}
                                value={propertyEdits[prop.id]?.streetAddress || ""}
                                onChange={(e) =>
                                  setPropertyEdits((prev) => ({
                                    ...prev,
                                    [prop.id]: { ...prev[prop.id], streetAddress: e.target.value },
                                  }))
                                }
                                placeholder="Street address"
                                className="h-9"
                                data-testid={`input-street-address-${prop.id}`}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor={`city-${prop.id}`} className="text-xs">City</Label>
                              <Input
                                id={`city-${prop.id}`}
                                value={propertyEdits[prop.id]?.city || ""}
                                onChange={(e) =>
                                  setPropertyEdits((prev) => ({
                                    ...prev,
                                    [prop.id]: { ...prev[prop.id], city: e.target.value },
                                  }))
                                }
                                placeholder="City"
                                className="h-9"
                                data-testid={`input-city-${prop.id}`}
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label htmlFor={`state-${prop.id}`} className="text-xs">State</Label>
                                <Input
                                  id={`state-${prop.id}`}
                                  value={propertyEdits[prop.id]?.state || ""}
                                  onChange={(e) =>
                                    setPropertyEdits((prev) => ({
                                      ...prev,
                                      [prop.id]: { ...prev[prop.id], state: e.target.value },
                                    }))
                                  }
                                  placeholder="State"
                                  className="h-9"
                                  data-testid={`input-state-${prop.id}`}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor={`zip-${prop.id}`} className="text-xs">Zip Code</Label>
                                <Input
                                  id={`zip-${prop.id}`}
                                  value={propertyEdits[prop.id]?.zipCode || ""}
                                  onChange={(e) =>
                                    setPropertyEdits((prev) => ({
                                      ...prev,
                                      [prop.id]: { ...prev[prop.id], zipCode: e.target.value },
                                    }))
                                  }
                                  placeholder="Zip"
                                  className="h-9"
                                  data-testid={`input-zip-code-${prop.id}`}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label htmlFor={`gate-code-${prop.id}`} className="text-xs">Gate Code</Label>
                              <Input
                                id={`gate-code-${prop.id}`}
                                value={propertyEdits[prop.id]?.gateCode || ""}
                                onChange={(e) =>
                                  setPropertyEdits((prev) => ({
                                    ...prev,
                                    [prop.id]: { ...prev[prop.id], gateCode: e.target.value },
                                  }))
                                }
                                placeholder="Enter gate code"
                                className="h-9"
                                data-testid={`input-gate-code-${prop.id}`}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor={`special-${prop.id}`} className="text-xs">Special Instructions</Label>
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
                                className="h-9"
                                data-testid={`input-special-instructions-${prop.id}`}
                              />
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            <Separator />

            <section>
              <SectionHeader title="How We Reach You" description="Choose how you want to be notified" />
              <Card>
                <CardContent className="pt-4 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-2.5">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm font-medium">Email</p>
                      </div>
                      <Switch checked={notifPrefs.email} onCheckedChange={(v) => setNotifPrefs((p) => ({ ...p, email: v }))} data-testid="switch-notif-email-global" />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-2.5">
                        <Send className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm font-medium">SMS</p>
                      </div>
                      <Switch checked={notifPrefs.sms} onCheckedChange={(v) => setNotifPrefs((p) => ({ ...p, sms: v }))} data-testid="switch-notif-sms-global" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notification Types</p>
                    <div className="divide-y rounded-lg border">
                      {[
                        { key: "serviceReminder", label: "Service Reminders", desc: "Before upcoming visits" },
                        { key: "serviceCompleted", label: "Service Completed", desc: "After a visit is done" },
                        { key: "invoiceReady", label: "Invoice Ready", desc: "When a new invoice is created" },
                        { key: "invoiceDueReminder", label: "Invoice Due Reminder", desc: "Before payment is due" },
                        { key: "paymentConfirmation", label: "Payment Confirmation", desc: "After a payment is processed" },
                      ].map(({ key, label, desc }) => (
                        <div key={key} className="flex items-center justify-between p-3">
                          <div>
                            <p className="text-sm font-medium">{label}</p>
                            <p className="text-xs text-muted-foreground">{desc}</p>
                          </div>
                          <Switch checked={notifPrefs[key] ?? true} onCheckedChange={(v) => setNotifPrefs((p) => ({ ...p, [key]: v }))} data-testid={`switch-notif-${key}`} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <Button onClick={handleSaveNotifPrefs} disabled={savingNotifs} className="w-full sm:w-auto" data-testid="button-save-notifications">
                    <Save className="mr-1.5 h-4 w-4" />
                    {savingNotifs ? "Saving..." : "Save Preferences"}
                  </Button>
                </CardContent>
              </Card>
            </section>

            <section>
              <SectionHeader title="Refer a Friend" description="Share your referral link and earn rewards" />
              <Card className="border-primary/20">
                <CardContent className="pt-4">
                  {referralCode ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-muted rounded-lg px-4 py-2.5 text-sm font-mono truncate" data-testid="text-referral-code">
                          {`${window.location.origin}/portal/login?ref=${referralCode}`}
                        </div>
                        <Button variant="outline" size="icon" className="shrink-0 h-10 w-10" onClick={handleCopyReferral} data-testid="button-copy-referral">
                          {copiedReferral ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Gift className="h-4 w-4 text-primary" />
                        <span data-testid="text-referral-count">
                          <span className="font-semibold">{referralCount}</span> successful referral{referralCount !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <Gift className="h-10 w-10 text-primary mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground mb-3">
                        Generate your unique referral link to share with friends and family.
                      </p>
                      <Button onClick={handleGenerateReferral} disabled={generatingCode} className="gap-1.5" data-testid="button-generate-referral">
                        <Gift className="h-4 w-4" />
                        {generatingCode ? "Generating..." : "Get My Referral Link"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            <Separator />

            <section>
              <SectionHeader title="Contact Us" description="Send a message to your service provider" />
              <Card>
                <CardContent className="pt-4">
                  <form onSubmit={handleSendMessage} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-subject">Subject (optional)</Label>
                      <Input
                        id="contact-subject"
                        value={contactSubject}
                        onChange={(e) => setContactSubject(e.target.value)}
                        placeholder="What is this about?"
                        data-testid="input-contact-subject"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-message">Message</Label>
                      <Textarea
                        id="contact-message"
                        value={contactMessage}
                        onChange={(e) => setContactMessage(e.target.value)}
                        placeholder="Tell us how we can help..."
                        rows={4}
                        data-testid="input-contact-message"
                      />
                    </div>
                    <Button type="submit" disabled={sendingMessage} className="gap-1.5" data-testid="button-send-message">
                      <Send className="h-4 w-4" />
                      {sendingMessage ? "Sending..." : "Send Message"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </section>

            <div className="pt-4 pb-8">
              <Button variant="outline" className="w-full text-muted-foreground hover:text-destructive hover:border-destructive/50" onClick={handleLogout} data-testid="button-portal-signout">
                <LogOut className="h-4 w-4 mr-2" /> Sign Out
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Visit Photo Dialog */}
      <Dialog open={!!visitPhotoModal} onOpenChange={(open) => !open && setVisitPhotoModal(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Service Photos</DialogTitle>
            <DialogDescription>{visitPhotoModal?.scheduledDate} {visitPhotoModal?.propertyAddress && `- ${visitPhotoModal.propertyAddress}`}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {visitPhotoModal?.proofOfServicePhotoBefore && (
              <div>
                <p className="text-sm font-medium mb-2 text-muted-foreground">Before</p>
                <img
                  src={visitPhotoModal.proofOfServicePhotoBefore}
                  alt="Before service"
                  className="w-full rounded-lg border"
                  data-testid="img-visit-before"
                />
              </div>
            )}
            {visitPhotoModal?.proofOfServicePhoto && (
              <div>
                <p className="text-sm font-medium mb-2 text-muted-foreground">After</p>
                <img
                  src={visitPhotoModal.proofOfServicePhoto}
                  alt="After service"
                  className="w-full rounded-lg border"
                  data-testid="img-visit-after"
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Gallery Photo Dialog */}
      <Dialog open={photoModalIndex !== null} onOpenChange={(open) => !open && setPhotoModalIndex(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{photoModalIndex !== null && galleryPhotos[photoModalIndex]?.scheduledDate}</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={photoModalIndex === null || photoModalIndex <= 0}
                  onClick={() => setPhotoModalIndex((prev) => (prev !== null ? prev - 1 : null))}
                  data-testid="button-gallery-prev"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground font-normal min-w-[60px] text-center">
                  {photoModalIndex !== null ? photoModalIndex + 1 : 0} / {galleryPhotos.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={photoModalIndex === null || photoModalIndex >= galleryPhotos.length - 1}
                  onClick={() => setPhotoModalIndex((prev) => (prev !== null ? prev + 1 : null))}
                  data-testid="button-gallery-next"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </DialogTitle>
            <DialogDescription>
              {photoModalIndex !== null && galleryPhotos[photoModalIndex]?.propertyAddress}
            </DialogDescription>
          </DialogHeader>
          {photoModalIndex !== null && galleryPhotos[photoModalIndex] && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {galleryPhotos[photoModalIndex].proofOfServicePhotoBefore && (
                <div>
                  <p className="text-sm font-medium mb-2 text-muted-foreground">Before</p>
                  <img
                    src={galleryPhotos[photoModalIndex].proofOfServicePhotoBefore!}
                    alt="Before service"
                    className="w-full rounded-lg border"
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
                    className="w-full rounded-lg border"
                    data-testid="img-gallery-after"
                  />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
