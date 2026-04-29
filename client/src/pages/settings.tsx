import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { getDismissedKey } from "@/components/rover-chatbot";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Building2, Users, Mail, Phone, MapPin, Save, Shield, Wrench, Crown, Upload, Image, Download, FileSpreadsheet, FileDown, Plus, X, AlertTriangle, CheckCircle2, Info, KeyRound, CalendarClock, Bell, CreditCard, ExternalLink, Unlink, Loader2, RefreshCw, BookOpen, RotateCcw, GripVertical, Rocket, Zap, PlayCircle, DollarSign, Star, PhoneCall } from "lucide-react";
import { ResponsiveGridLayout, useContainerWidth } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { TIER_CONFIG } from "@shared/schema";
import { useUpload } from "@/hooks/use-upload";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { LearnHowButton } from "@/components/interactive-tutorial";
import { useTutorialContext } from "@/hooks/use-tutorials";
import { Globe, Copy, Check, Link2, Send, MessageSquare, Code2, Webhook, Database, ChevronRight as ChevronRightIcon } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";

const companyFormSchema = z.object({
  name: z.string().min(1, "Company name is required"),
  email: z.string().email("Invalid email").or(z.literal("")).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  startAddress: z.string().optional(),
  startLatitude: z.string().optional(),
  startLongitude: z.string().optional(),
});

type CompanyFormValues = z.infer<typeof companyFormSchema>;

type Company = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  startAddress: string | null;
  startLatitude: string | null;
  startLongitude: string | null;
  logoUrl: string | null;
  slug: string | null;
  leadWebhookSmsTemplate: string | null;
  quoteAutoFollowUpEnabled: boolean;
  quoteFollowUpSmsTemplate: string | null;
  quoteFollowUpEmailEnabled: boolean;
  quoteFollowUpEmailSubject: string | null;
  quoteFollowUpEmailBody: string | null;
  quoteFormLayout: string;
  subscriptionTier: string;
  subscriptionStatus: string;
  autoVisitsEnabled: boolean;
  remindersEnabled: boolean;
  roverAiEnabled: boolean;
  timezone: string;
  smsProvider: string;
  telnyxApiKey: string | null;
  telnyxPhoneNumber: string | null;
  telnyxMessagingProfileId: string | null;
  telnyxApiKeySet?: boolean;
  venmoHandle: string | null;
  billingCadence: string;
  billingTrigger: string;
  defaultPaymentBehavior: string;
  settingsLayout?: any;
  reviewRequestEnabled?: boolean;
  googleReviewUrl?: string | null;
  reviewRequestAfterVisits?: number;
  reviewRequestCustomMessage?: string | null;
  clientNotificationsSuppressed?: boolean;
  onboardingCompleteSentAt?: string | null;
  voicePlanStatus?: string | null;
  voicePlanTier?: string | null;
  retellAgentId?: string | null;
};

type SettingsLayoutItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
};

const SETTINGS_BLOCK_DEFS: { id: string; label: string; defaultW: number; defaultH: number; minW: number; minH: number }[] = [
  { id: "company_logo", label: "Company Logo", defaultW: 6, defaultH: 3, minW: 4, minH: 3 },
  { id: "company_info", label: "Company Information", defaultW: 6, defaultH: 8, minW: 4, minH: 6 },
  { id: "reminder_settings", label: "Reminder Settings", defaultW: 6, defaultH: 6, minW: 4, minH: 4 },
  { id: "team_members", label: "Team Members", defaultW: 6, defaultH: 5, minW: 4, minH: 4 },
  { id: "change_password", label: "Change Password", defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
  { id: "data_import_export", label: "Data Import / Export", defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
  { id: "subscription", label: "Subscription", defaultW: 6, defaultH: 3, minW: 4, minH: 2 },
  { id: "stripe_connect", label: "Stripe Connect", defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
  { id: "venmo", label: "Venmo", defaultW: 6, defaultH: 3, minW: 4, minH: 2 },
  { id: "quickbooks", label: "QuickBooks", defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
  { id: "voice_api_docs", label: "Voice API Docs", defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
  { id: "signup_widget", label: "Signup Widget", defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
  { id: "webhook_lead", label: "Webhook Lead", defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
  { id: "sms_quote_template", label: "SMS Quote Template", defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
  { id: "quote_auto_follow_up", label: "Quote Auto-Follow-Up", defaultW: 6, defaultH: 5, minW: 4, minH: 3 },
  { id: "google_reviews", label: "Google Reviews", defaultW: 6, defaultH: 5, minW: 4, minH: 3 },
  { id: "auto_visit_generation", label: "Auto Visit Generation", defaultW: 6, defaultH: 3, minW: 4, minH: 2 },
  { id: "lead_sources", label: "Lead Sources", defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
  { id: "audit_log", label: "Audit Log", defaultW: 12, defaultH: 5, minW: 6, minH: 4 },
  { id: "developer_tools", label: "Developer Tools", defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
  { id: "demo_mode", label: "Demo Mode", defaultW: 6, defaultH: 7, minW: 4, minH: 5 },
  { id: "billing_defaults", label: "Billing Defaults", defaultW: 6, defaultH: 5, minW: 4, minH: 4 },
  { id: "call_tracking", label: "Call Tracking", defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
  { id: "client_notifications", label: "Client Notifications", defaultW: 6, defaultH: 5, minW: 4, minH: 4 },
  { id: "voice_agent", label: "Voice Agent", defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
];

const DEFAULT_SETTINGS_BLOCK_IDS = [
  "company_logo", "subscription",
  "company_info", "stripe_connect",
  "reminder_settings", "venmo",
  "team_members", "quickbooks",
  "change_password", "voice_api_docs",
  "data_import_export", "signup_widget",
  "webhook_lead", "sms_quote_template",
  "quote_auto_follow_up", "google_reviews",
  "auto_visit_generation",
  "lead_sources", "developer_tools",
  "audit_log", "demo_mode",
  "billing_defaults", "call_tracking",
  "client_notifications", "voice_agent",
];

function generateDefaultSettingsLayout(): SettingsLayoutItem[] {
  const items: SettingsLayoutItem[] = [];
  let x = 0;
  let y = 0;
  for (const id of DEFAULT_SETTINGS_BLOCK_IDS) {
    const def = SETTINGS_BLOCK_DEFS.find(b => b.id === id);
    if (!def) continue;
    if (x + def.defaultW > 12) {
      x = 0;
      y += 2;
    }
    items.push({
      i: id,
      x,
      y,
      w: def.defaultW,
      h: def.defaultH,
      minW: def.minW,
      minH: def.minH,
    });
    x += def.defaultW;
    if (x >= 12) {
      x = 0;
      y += def.defaultH;
    }
  }
  return items;
}

type TeamMember = {
  id: string;
  companyUserId: string;
  role: string;
  firstName: string;
  lastName: string;
  email: string;
  profileImageUrl: string | null;
};

const roleIcons: Record<string, typeof Crown> = {
  owner: Crown,
  admin: Shield,
  tech: Wrench,
};

const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  tech: "Technician",
};

type ImportRow = Record<string, string>;
type ColumnMapping = { csvHeader: string; mappedField: string };


const CONTACT_FIELDS = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "streetAddress", label: "Street Address" },
  { key: "address2", label: "Address 2" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zipCode", label: "Zip Code" },
  { key: "numberOfDogs", label: "# Dogs" },
  { key: "yardSize", label: "Yard Size" },
  { key: "serviceFrequency", label: "Frequency" },
  { key: "serviceDay", label: "Service Day" },
  { key: "leadSource", label: "Lead Source" },
  { key: "referralSource", label: "Referral Source" },
  { key: "status", label: "Status" },
  { key: "notes", label: "Notes" },
];

type AuditEntry = {
  id: string;
  companyId: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changes: { old?: Record<string, any>; new?: Record<string, any> } | null;
  ipAddress: string | null;
  createdAt: string;
};

const ENTITY_TYPES = [
  { value: "contact", label: "Contact" },
  { value: "invoice", label: "Invoice" },
  { value: "route", label: "Route" },
  { value: "service_plan", label: "Job" },
  { value: "company", label: "Company" },
];

function StripeConnectSection() {
  const { toast } = useToast();
  const { startTutorial, isTutorialCompleted } = useTutorialContext();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stripeConnect = params.get("stripe_connect");
    if (stripeConnect === "return") {
      toast({ title: "Stripe setup complete", description: "Checking your connection status..." });
      queryClient.invalidateQueries({ queryKey: ["/api/stripe-connect/status"] });
      const url = new URL(window.location.href);
      url.searchParams.delete("stripe_connect");
      window.history.replaceState({}, "", url.toString());
    } else if (stripeConnect === "refresh") {
      toast({ title: "Setup incomplete", description: "Please continue your Stripe account setup.", variant: "destructive" });
      const url = new URL(window.location.href);
      url.searchParams.delete("stripe_connect");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const { data: currentUser } = useQuery<{ id: string; role?: string }>({
    queryKey: ["/api/auth/user"],
  });

  const canManageStripeConnect = currentUser?.role === "owner" || currentUser?.role === "admin";
  const userRoleLoaded = !!currentUser?.role;

  const { data: connectStatus, isLoading: loadingStatus } = useQuery<{
    status: "not_started" | "pending" | "connected";
    accountId?: string;
    chargesEnabled?: boolean;
    detailsSubmitted?: boolean;
  }>({
    queryKey: ["/api/stripe-connect/status"],
  });

  const onboardMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe-connect/onboard");
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      window.location.href = data.url;
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to start Stripe onboarding.", variant: "destructive" });
    },
  });

  const dashboardMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/stripe-connect/dashboard-link");
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      window.open(data.url, "_blank");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to get dashboard link.", variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe-connect/disconnect");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stripe-connect/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: "Stripe disconnected", description: "Your Stripe account has been disconnected." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to disconnect.", variant: "destructive" });
    },
  });

  const status = connectStatus?.status || "not_started";

  return (
    <Card data-testid="card-payment-processing">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Payment Processing
        </CardTitle>
        <div className="flex items-center justify-between gap-2">
          <CardDescription>Connect your Stripe account to receive payments directly from your customers</CardDescription>
          <LearnHowButton
            tutorialId="tutorial_stripe_connect"
            onStart={startTutorial}
            isCompleted={isTutorialCompleted("tutorial_stripe_connect")}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadingStatus ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-8 w-48" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Status:</span>
                {status === "connected" && (
                  <Badge variant="default" data-testid="badge-stripe-status">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Connected
                  </Badge>
                )}
                {status === "pending" && (
                  <Badge variant="secondary" data-testid="badge-stripe-status">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Pending Onboarding
                  </Badge>
                )}
                {status === "not_started" && (
                  <Badge variant="secondary" data-testid="badge-stripe-status">
                    Not Connected
                  </Badge>
                )}
              </div>
            </div>

            {userRoleLoaded && !canManageStripeConnect && (
              <p className="text-sm text-muted-foreground" data-testid="text-stripe-permission-notice">
                Only owners and admins can manage Stripe Connect.
              </p>
            )}

            {canManageStripeConnect && status === "not_started" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Connect your Stripe account to receive payments directly from your customers. Funds will be deposited into your bank account automatically.
                </p>
                <Button
                  onClick={() => onboardMutation.mutate()}
                  disabled={onboardMutation.isPending}
                  data-testid="button-connect-stripe"
                >
                  {onboardMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Setting up...
                    </>
                  ) : (
                    <>
                      <CreditCard className="h-4 w-4 mr-2" />
                      Connect Stripe Account
                    </>
                  )}
                </Button>
              </div>
            )}

            {canManageStripeConnect && status === "pending" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Your Stripe account setup is not yet complete. Please finish onboarding to start receiving payments.
                </p>
                <Button
                  onClick={() => onboardMutation.mutate()}
                  disabled={onboardMutation.isPending}
                  data-testid="button-continue-stripe-setup"
                >
                  {onboardMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Continue Setup
                    </>
                  )}
                </Button>
              </div>
            )}

            {canManageStripeConnect && status === "connected" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Your Stripe account is connected. Payments from your customers will be deposited directly into your bank account.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => dashboardMutation.mutate()}
                    disabled={dashboardMutation.isPending}
                    data-testid="button-stripe-dashboard"
                  >
                    {dashboardMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <ExternalLink className="h-4 w-4 mr-2" />
                    )}
                    View Stripe Dashboard
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => disconnectMutation.mutate()}
                    disabled={disconnectMutation.isPending}
                    data-testid="button-disconnect-stripe"
                  >
                    {disconnectMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Unlink className="h-4 w-4 mr-2" />
                    )}
                    Disconnect
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function VenmoSection({ company }: { company: Company | null | undefined }) {
  const { toast } = useToast();
  const [venmoHandle, setVenmoHandle] = useState(company?.venmoHandle || "");

  useEffect(() => {
    setVenmoHandle(company?.venmoHandle || "");
  }, [company?.venmoHandle]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cleanHandle = venmoHandle.trim().replace(/^@+/, "");
      const res = await apiRequest("PATCH", "/api/company", { venmoHandle: cleanHandle });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save Venmo handle");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: "Venmo handle saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid="card-venmo">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Payment Options
        </CardTitle>
        <CardDescription>Add your Venmo handle so customers can pay invoices via Venmo</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="venmo-handle">Venmo Handle</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">@</span>
                <Input
                  id="venmo-handle"
                  value={venmoHandle.replace(/^@+/, "")}
                  onChange={(e) => setVenmoHandle(e.target.value.replace(/^@+/, ""))}
                  placeholder="your-venmo-handle"
                  className="pl-7"
                  data-testid="input-venmo-handle"
                />
              </div>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                data-testid="button-save-venmo"
              >
                <Save className="h-4 w-4 mr-2" />
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              When set, customers will see a Venmo payment option on invoices and in emails.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QuickBooksSection() {
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qboParam = params.get("qbo");
    if (qboParam === "connected") {
      toast({ title: "QuickBooks connected", description: "Your QuickBooks Online account has been linked successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/qbo/status"] });
      const url = new URL(window.location.href);
      url.searchParams.delete("qbo");
      window.history.replaceState({}, "", url.toString());
    } else if (qboParam === "error") {
      const msg = params.get("msg") || "Connection failed";
      toast({ title: "QuickBooks connection error", description: msg, variant: "destructive" });
      const url = new URL(window.location.href);
      url.searchParams.delete("qbo");
      url.searchParams.delete("msg");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const { data: qboStatus, isLoading } = useQuery<{
    configured: boolean;
    connected: boolean;
    realmId: string | null;
    connectedAt: string | null;
    lastSync: string | null;
    totalSynced: number;
    totalErrors: number;
    feeAccountRef: string | null;
    recentLogs: { id: string; entityType: string; entityId: string; action: string; status: string; errorMessage: string | null; syncedAt: string | null; createdAt: string }[];
  }>({
    queryKey: ["/api/qbo/status"],
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/qbo/connect");
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      window.location.href = data.url;
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to start QuickBooks connection.", variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/qbo/disconnect");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qbo/status"] });
      toast({ title: "QuickBooks disconnected", description: "Your QuickBooks account has been disconnected." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to disconnect.", variant: "destructive" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/qbo/sync");
      return res.json();
    },
    onSuccess: (data: { contactsSynced: number; invoicesSynced: number; errors: string[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/qbo/status"] });
      if (data.errors.length > 0) {
        toast({
          title: "Sync completed with errors",
          description: `${data.contactsSynced} contacts, ${data.invoicesSynced} invoices synced. ${data.errors.length} error(s).`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Sync complete",
          description: `${data.contactsSynced} contacts and ${data.invoicesSynced} invoices synced to QuickBooks.`,
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Sync failed", description: err.message || "Full sync failed.", variant: "destructive" });
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (logId: string) => {
      const res = await apiRequest("POST", `/api/qbo/retry/${logId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qbo/status"] });
      toast({ title: "Retry successful", description: "The record was synced to QuickBooks." });
    },
    onError: (err: any) => {
      toast({ title: "Retry failed", description: err.message || "Failed to retry sync.", variant: "destructive" });
    },
  });

  const { data: expenseAccounts, isLoading: loadingAccounts } = useQuery<{ id: string; name: string; accountSubType: string }[]>({
    queryKey: ["/api/qbo/expense-accounts"],
    enabled: !!qboStatus?.connected,
  });

  const feeAccountMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const res = await apiRequest("POST", "/api/qbo/fee-account", { accountId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qbo/status"] });
      toast({ title: "Fee account saved", description: "Stripe fees will be posted to this account in QuickBooks." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to save fee account.", variant: "destructive" });
    },
  });

  const [showLogs, setShowLogs] = useState(false);

  return (
    <Card data-testid="card-quickbooks">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          QuickBooks Online
        </CardTitle>
        <CardDescription>Sync your contacts and invoices to QuickBooks Online for seamless accounting</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-8 w-48" />
          </div>
        ) : !qboStatus?.configured ? (
          <div className="space-y-3">
            <div className="bg-muted/50 rounded-lg p-4 border">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium mb-1">QuickBooks integration not configured</p>
                  <p className="text-sm text-muted-foreground">
                    To enable QuickBooks Online sync, add your QBO_CLIENT_ID and QBO_CLIENT_SECRET environment variables. You can obtain these from the Intuit Developer Portal.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Status:</span>
                {qboStatus.connected ? (
                  <Badge variant="default" data-testid="badge-qbo-status">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="secondary" data-testid="badge-qbo-status">
                    Not Connected
                  </Badge>
                )}
              </div>
              {qboStatus.connected && qboStatus.lastSync && (
                <span className="text-xs text-muted-foreground" data-testid="text-qbo-last-sync">
                  Last sync: {new Date(qboStatus.lastSync).toLocaleString()}
                </span>
              )}
            </div>

            {!qboStatus.connected ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Connect your QuickBooks Online account to automatically sync contacts and invoices. Payments marked as paid in Scoopilot will also be recorded in QuickBooks.
                </p>
                <Button
                  onClick={() => connectMutation.mutate()}
                  disabled={connectMutation.isPending}
                  data-testid="button-connect-qbo"
                >
                  {connectMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <BookOpen className="h-4 w-4 mr-2" />
                      Connect QuickBooks
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold" data-testid="text-qbo-total-synced">{qboStatus.totalSynced}</p>
                    <p className="text-xs text-muted-foreground">Records Synced</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-destructive" data-testid="text-qbo-total-errors">{qboStatus.totalErrors}</p>
                    <p className="text-xs text-muted-foreground">Errors</p>
                  </div>
                  {qboStatus.connectedAt && (
                    <div className="bg-muted/50 rounded-lg p-3 text-center col-span-2">
                      <p className="text-sm font-medium" data-testid="text-qbo-connected-at">
                        {new Date(qboStatus.connectedAt).toLocaleDateString()}
                      </p>
                      <p className="text-xs text-muted-foreground">Connected Since</p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => syncMutation.mutate()}
                    disabled={syncMutation.isPending}
                    data-testid="button-qbo-full-sync"
                  >
                    {syncMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Full Re-Sync
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => disconnectMutation.mutate()}
                    disabled={disconnectMutation.isPending}
                    data-testid="button-disconnect-qbo"
                  >
                    {disconnectMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Unlink className="h-4 w-4 mr-2" />
                    )}
                    Disconnect
                  </Button>
                </div>

                <div className="border-t pt-3 space-y-2">
                  <Label htmlFor="qbo-fee-account" className="text-sm font-medium">Stripe Fee Expense Account</Label>
                  <p className="text-xs text-muted-foreground">
                    Select the QuickBooks expense account where Stripe processing fees will be recorded.
                  </p>
                  {loadingAccounts ? (
                    <Skeleton className="h-9 w-full" />
                  ) : (
                    <Select
                      value={qboStatus?.feeAccountRef || ""}
                      onValueChange={(val) => feeAccountMutation.mutate(val)}
                      disabled={feeAccountMutation.isPending}
                    >
                      <SelectTrigger id="qbo-fee-account" data-testid="select-qbo-fee-account">
                        <SelectValue placeholder="Auto-detect or select an account" />
                      </SelectTrigger>
                      <SelectContent>
                        {expenseAccounts?.map((acct) => (
                          <SelectItem key={acct.id} value={acct.id} data-testid={`option-qbo-account-${acct.id}`}>
                            {acct.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {qboStatus.recentLogs.length > 0 && (
                  <Collapsible open={showLogs} onOpenChange={setShowLogs}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full justify-between" data-testid="button-toggle-qbo-logs">
                        <span>Recent Sync Activity ({qboStatus.recentLogs.length})</span>
                        <ChevronDown className={`h-4 w-4 transition-transform ${showLogs ? "rotate-180" : ""}`} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                        {qboStatus.recentLogs.map((log) => (
                          <div
                            key={log.id}
                            className="flex items-center justify-between gap-2 text-sm p-2 rounded border"
                            data-testid={`row-qbo-log-${log.id}`}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {log.status === "synced" ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                              ) : log.status === "error" ? (
                                <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                              ) : (
                                <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />
                              )}
                              <span className="capitalize">{log.entityType}</span>
                              <Badge variant="secondary" className="text-xs capitalize">{log.action}</Badge>
                              {log.errorMessage && (
                                <span className="text-xs text-destructive truncate" title={log.errorMessage}>
                                  {log.errorMessage.substring(0, 60)}{log.errorMessage.length > 60 ? "..." : ""}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-muted-foreground">
                                {new Date(log.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                              </span>
                              {log.status === "error" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2"
                                  onClick={() => retryMutation.mutate(log.id)}
                                  disabled={retryMutation.isPending}
                                  data-testid={`button-retry-qbo-${log.id}`}
                                >
                                  <RotateCcw className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

type RetellWebhookStatus = {
  configured: boolean;
  reason?: string;
  agentId?: string;
  registered?: boolean;
  currentUrl?: string | null;
  expectedUrl?: string | null;
};

function useRetellWebhook() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const statusQuery = useQuery<RetellWebhookStatus>({
    queryKey: ["/api/settings/retell-webhook-status"],
  });
  const reregisterMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/settings/retell-register-webhook"),
    onSuccess: () => {
      toast({ title: "Webhook registered", description: "The Retell webhook has been successfully re-registered." });
      qc.invalidateQueries({ queryKey: ["/api/settings/retell-webhook-status"] });
      qc.invalidateQueries({ queryKey: ["/api/settings/retell-webhook-repairs"] });
    },
    onError: (err: any) => {
      toast({ title: "Registration failed", description: err?.message || "Could not re-register the webhook.", variant: "destructive" });
    },
  });
  return { statusQuery, reregisterMutation, status: statusQuery.data };
}

function VoiceApiDocsSection() {
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);
  const { statusQuery: webhookStatusQuery, reregisterMutation, status: webhookStatus } = useRetellWebhook();

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEndpoint(label);
    setTimeout(() => setCopiedEndpoint(null), 2000);
  };

  const baseUrl = window.location.origin;

  const endpoints = [
    {
      label: "Caller Lookup",
      method: "GET",
      path: "/api/voice/lookup?phone=5551234567",
      description: "Look up a customer by phone number. Returns contact details, service plans, properties, upcoming visits, and active vacation holds.",
      curl: `curl -H "x-api-key: YOUR_API_KEY" "${baseUrl}/api/voice/lookup?phone=5551234567"`,
      response: `{
  "found": true,
  "contact": { "id": "...", "firstName": "Jane", "lastName": "Doe", "phone": "555-123-4567", "email": "jane@example.com", "status": "active" },
  "properties": [{ "id": "...", "streetAddress": "123 Main St", "city": "Richmond", "state": "VA", "zipCode": "23220", "numberOfDogs": 2 }],
  "servicePlans": [{ "id": "...", "frequency": "weekly", "dayOfWeek": "tuesday", "pricePerVisit": "35.00" }],
  "upcomingVisits": [{ "scheduledDate": "2026-03-24", "status": "scheduled", "servicePlanName": "Weekly Cleanup", "propertyAddress": "123 Main St" }],
  "activeHolds": []
}`,
    },
    {
      label: "Check Availability",
      method: "GET",
      path: "/api/voice/availability",
      description: "Check which days have route capacity for new customers. Filter by zip code to see only days that serve that area. Optionally filter by a specific day.",
      curl: `curl -H "x-api-key: YOUR_API_KEY" "${baseUrl}/api/voice/availability?zipCode=23220&dayOfWeek=monday"`,
      response: `{
  "available_days": ["monday"],
  "availability": [
    { "dayOfWeek": "monday", "routeCount": 2, "currentStops": 18, "openSlots": 42, "available": true }
  ]
}`,
    },
    {
      label: "Book New Service",
      method: "POST",
      path: "/api/voice/book",
      description: "Create a new customer with contact, property, and service plan in one call. Auto-assigns to best-fit route.",
      curl: `curl -X POST -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d '{"firstName":"Jane","lastName":"Doe","phone":"555-123-4567","email":"jane@example.com","streetAddress":"123 Main St","city":"Richmond","state":"VA","zipCode":"23220","numberOfDogs":2,"frequency":"weekly","dayOfWeek":"tuesday"}' "${baseUrl}/api/voice/book"`,
      response: `{
  "success": true,
  "contactId": "...",
  "propertyId": "...",
  "servicePlanId": "...",
  "routeAssigned": true,
  "summary": "Booked weekly service for Jane Doe at 123 Main St, Richmond on tuesdays"
}`,
    },
    {
      label: "Pause Service",
      method: "POST",
      path: "/api/voice/pause",
      description: "Create a vacation hold on a customer's service. Provide contactId (pauses all plans) or a specific servicePlanId.",
      curl: `curl -X POST -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d '{"contactId":"CONTACT_ID","startDate":"2026-04-01","endDate":"2026-04-15","reason":"Vacation"}' "${baseUrl}/api/voice/pause"`,
      response: `{
  "success": true,
  "holdsCreated": 1,
  "startDate": "2026-04-01",
  "endDate": "2026-04-15",
  "summary": "Service paused from 2026-04-01 to 2026-04-15"
}`,
    },
    {
      label: "Resume Service",
      method: "POST",
      path: "/api/voice/resume",
      description: "Remove active vacation holds to resume service immediately. Provide contactId or servicePlanId.",
      curl: `curl -X POST -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d '{"contactId":"CONTACT_ID"}' "${baseUrl}/api/voice/resume"`,
      response: `{
  "success": true,
  "holdsRemoved": 1,
  "summary": "Removed 1 vacation hold(s). Service resumed."
}`,
    },
    {
      label: "Reschedule Service",
      method: "POST",
      path: "/api/voice/reschedule",
      description: "Change the service day for a customer. Auto-assigns to best-fit route for the new day.",
      curl: `curl -X POST -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d '{"contactId":"CONTACT_ID","newDayOfWeek":"thursday"}' "${baseUrl}/api/voice/reschedule"`,
      response: `{
  "success": true,
  "plansUpdated": 1,
  "newDayOfWeek": "thursday",
  "routeAssigned": true,
  "summary": "Rescheduled 1 plan(s) to thursdays"
}`,
    },
    {
      label: "Cancel Service",
      method: "POST",
      path: "/api/voice/cancel",
      description: "Cancel a customer's service. Deactivates all active service plans and sets contact status to cancelled.",
      curl: `curl -X POST -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" -d '{"contactId":"CONTACT_ID","reason":"Moving out of area"}' "${baseUrl}/api/voice/cancel"`,
      response: `{
  "success": true,
  "plansDeactivated": 1,
  "summary": "Service cancelled for Jane Doe. 1 plan(s) deactivated."
}`,
    },
  ];

  return (
    <Card data-testid="card-voice-api-docs">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-5 w-5" />
          Voice Agent API
        </CardTitle>
        <CardDescription>
          Connect your AI voice agent (Vapi, Retell, Bland, or custom) to handle customer calls. Use these endpoints with your existing API key.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5" data-testid="div-voice-webhook-status-banner">
          <div className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium">Call Tracking</span>
            {webhookStatusQuery.isLoading ? (
              <Skeleton className="h-5 w-20" />
            ) : webhookStatus ? (
              <Badge
                variant={!webhookStatus.configured ? "secondary" : webhookStatus.registered ? "default" : "destructive"}
                className={webhookStatus.registered ? "bg-green-600 hover:bg-green-700 text-white" : ""}
                data-testid="badge-voice-webhook-status"
              >
                {!webhookStatus.configured ? "Not configured" : webhookStatus.registered ? "Registered" : "Not registered"}
              </Badge>
            ) : null}
          </div>
          {webhookStatus?.configured && (
            <Button
              variant={webhookStatus.registered ? "outline" : "default"}
              size="sm"
              onClick={() => reregisterMutation.mutate()}
              disabled={reregisterMutation.isPending}
              data-testid="button-voice-reregister-webhook"
            >
              {reregisterMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Registering…</>
              ) : (
                <><RefreshCw className="h-3.5 w-3.5 mr-1" /> Re-register</>
              )}
            </Button>
          )}
        </div>

        <div className="bg-muted/50 rounded-lg p-4 border">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium mb-1">Authentication</p>
              <p className="text-sm text-muted-foreground">
                All endpoints require the <code className="bg-muted px-1 py-0.5 rounded text-xs">x-api-key</code> header. Create an API key in the section below if you haven't already.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {endpoints.map((ep) => (
            <Collapsible key={ep.label}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <Badge variant={ep.method === "GET" ? "secondary" : "default"} className="font-mono text-xs" data-testid={`badge-method-${ep.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    {ep.method}
                  </Badge>
                  <span className="text-sm font-medium" data-testid={`text-endpoint-${ep.label.toLowerCase().replace(/\s+/g, "-")}`}>{ep.label}</span>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 pb-1 px-3">
                <p className="text-sm text-muted-foreground mb-3">{ep.description}</p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground uppercase">curl example</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => copyToClipboard(ep.curl, ep.label + "-curl")}
                      data-testid={`button-copy-curl-${ep.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {copiedEndpoint === ep.label + "-curl" ? (
                        <><Check className="h-3 w-3 mr-1" /> Copied</>
                      ) : (
                        <><Copy className="h-3 w-3 mr-1" /> Copy curl</>
                      )}
                    </Button>
                  </div>
                  <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono" data-testid={`code-curl-${ep.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    {ep.curl}
                  </pre>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground uppercase">example response</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => copyToClipboard(ep.response, ep.label + "-response")}
                      data-testid={`button-copy-response-${ep.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {copiedEndpoint === ep.label + "-response" ? (
                        <><Check className="h-3 w-3 mr-1" /> Copied</>
                      ) : (
                        <><Copy className="h-3 w-3 mr-1" /> Copy</>
                      )}
                    </Button>
                  </div>
                  <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto whitespace-pre-wrap font-mono" data-testid={`code-response-${ep.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    {ep.response}
                  </pre>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

type RetellWebhookRepair = {
  id: string;
  companyId: string | null;
  agentId: string;
  oldUrl: string | null;
  newUrl: string;
  triggeredBy: "auto" | "manual";
  repairedAt: string;
};

function CallTrackingSection() {
  const { statusQuery, reregisterMutation, status } = useRetellWebhook();
  const repairsQuery = useQuery<RetellWebhookRepair[]>({
    queryKey: ["/api/settings/retell-webhook-repairs"],
  });

  return (
    <Card data-testid="card-call-tracking">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Webhook className="h-5 w-5" />
          Call Tracking
        </CardTitle>
        <CardDescription>
          Status of the Retell AI webhook that records inbound calls and links them to contacts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-6 w-3/4" />
          </div>
        ) : status ? (
          <>
            <div className="flex items-start gap-3 rounded-lg border p-4">
              {!status.configured ? (
                <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
              ) : status.registered ? (
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-500 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
              )}
              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Webhook Status</span>
                  <Badge
                    variant={!status.configured ? "secondary" : status.registered ? "default" : "destructive"}
                    className={status.registered ? "bg-green-600 hover:bg-green-700 text-white" : ""}
                    data-testid="badge-webhook-status"
                  >
                    {!status.configured ? "Not configured" : status.registered ? "Registered" : "Not registered"}
                  </Badge>
                </div>
                {status.reason && (
                  <p className="text-xs text-muted-foreground" data-testid="text-webhook-reason">{status.reason}</p>
                )}
                {status.configured && status.expectedUrl && (
                  <div className="space-y-1 pt-1">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Expected URL: </span>
                      <code className="bg-muted px-1 py-0.5 rounded break-all" data-testid="text-expected-url">{status.expectedUrl}</code>
                    </p>
                    {status.currentUrl && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium">Registered URL: </span>
                        <code className={`px-1 py-0.5 rounded break-all ${status.registered ? "bg-muted" : "bg-destructive/10 text-destructive"}`} data-testid="text-current-url">{status.currentUrl}</code>
                      </p>
                    )}
                    {!status.registered && !status.currentUrl && (
                      <p className="text-xs text-muted-foreground" data-testid="text-no-webhook">No webhook URL is currently set on the agent.</p>
                    )}
                  </div>
                )}
                {status.agentId && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Agent ID: <code className="bg-muted px-1 py-0.5 rounded" data-testid="text-agent-id">{status.agentId}</code>
                  </p>
                )}
              </div>
            </div>

            {status.configured && (
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Re-register Webhook</p>
                  <p className="text-xs text-muted-foreground">
                    {status.registered
                      ? "Webhook is active. Click to force re-registration if calls aren't being tracked."
                      : "The webhook is missing. Click to register it now so call tracking works."}
                  </p>
                </div>
                <Button
                  variant={status.registered ? "outline" : "default"}
                  size="sm"
                  onClick={() => reregisterMutation.mutate()}
                  disabled={reregisterMutation.isPending}
                  data-testid="button-reregister-webhook"
                >
                  {reregisterMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Registering…</>
                  ) : (
                    <><RefreshCw className="h-4 w-4 mr-1" /> Re-register Webhook</>
                  )}
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Unable to load webhook status.</p>
        )}

        <Separator />

        <div className="space-y-2">
          <p className="text-sm font-medium">Repair History</p>
          <p className="text-xs text-muted-foreground">A log of every time the webhook URL was fixed, either automatically by the daily check or manually by staff.</p>
          {repairsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : repairsQuery.data && repairsQuery.data.length > 0 ? (
            <div className="rounded-md border overflow-hidden" data-testid="table-repair-history">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">When</TableHead>
                    <TableHead className="text-xs">Trigger</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">Previous URL</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">New URL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {repairsQuery.data.map((repair) => (
                    <TableRow key={repair.id} data-testid={`row-repair-${repair.id}`}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(repair.repairedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant={repair.triggeredBy === "auto" ? "secondary" : "outline"} className="text-xs">
                          {repair.triggeredBy === "auto" ? "Auto" : "Manual"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs hidden sm:table-cell max-w-[200px]">
                        <code className="bg-muted px-1 py-0.5 rounded text-xs break-all">{repair.oldUrl ?? "—"}</code>
                      </TableCell>
                      <TableCell className="text-xs hidden sm:table-cell max-w-[200px]">
                        <code className="bg-muted px-1 py-0.5 rounded text-xs break-all">{repair.newUrl}</code>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic" data-testid="text-no-repairs">No repair events recorded yet. This log will fill in the next time the webhook is re-registered.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type VoiceWebhookStatus = {
  configured: boolean;
  reason?: string;
  agentId?: string;
  registered?: boolean;
  currentUrl?: string | null;
  expectedUrl?: string | null;
};

function VoiceAgentSection({ company }: { company: Company | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const hasActiveVoicePlan = company?.voicePlanStatus === "active";

  const statusQuery = useQuery<VoiceWebhookStatus>({
    queryKey: ["/api/voice/webhook-status"],
    enabled: hasActiveVoicePlan,
  });

  const reregisterMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/voice/register-webhook"),
    onSuccess: () => {
      toast({ title: "Webhook registered", description: "The voice agent webhook has been successfully re-registered." });
      qc.invalidateQueries({ queryKey: ["/api/voice/webhook-status"] });
    },
    onError: (err: any) => {
      toast({ title: "Registration failed", description: err?.message || "Could not re-register the webhook.", variant: "destructive" });
    },
  });

  if (!hasActiveVoicePlan) return null;

  const status = statusQuery.data;

  return (
    <Card className="h-full overflow-auto" data-testid="card-voice-agent">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PhoneCall className="h-5 w-5" />
          Voice Agent
        </CardTitle>
        <CardDescription>
          Webhook registration status for the Retell AI voice agent. Keep this registered so call events are recorded correctly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-6 w-3/4" />
          </div>
        ) : status ? (
          <>
            <div className="flex items-start gap-3 rounded-lg border p-4">
              {!status.configured ? (
                <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
              ) : status.registered ? (
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-500 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
              )}
              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Webhook Status</span>
                  <Badge
                    variant={!status.configured ? "secondary" : status.registered ? "default" : "destructive"}
                    className={status.registered ? "bg-green-600 hover:bg-green-700 text-white" : ""}
                    data-testid="badge-voice-webhook-status"
                  >
                    {!status.configured ? "Unknown" : status.registered ? "Registered" : "Not Registered"}
                  </Badge>
                </div>
                {status.reason && (
                  <p className="text-xs text-muted-foreground" data-testid="text-voice-webhook-reason">{status.reason}</p>
                )}
                {status.configured && status.expectedUrl && (
                  <div className="space-y-1 pt-1">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Expected URL: </span>
                      <code className="bg-muted px-1 py-0.5 rounded break-all" data-testid="text-voice-expected-url">{status.expectedUrl}</code>
                    </p>
                    {status.currentUrl ? (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium">Registered URL: </span>
                        <code
                          className={`px-1 py-0.5 rounded break-all ${status.registered ? "bg-muted" : "bg-destructive/10 text-destructive"}`}
                          data-testid="text-voice-current-url"
                        >
                          {status.currentUrl}
                        </code>
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground" data-testid="text-voice-no-webhook">No webhook URL is currently set on the agent.</p>
                    )}
                  </div>
                )}
                {status.agentId && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Agent ID: <code className="bg-muted px-1 py-0.5 rounded" data-testid="text-voice-agent-id">{status.agentId}</code>
                  </p>
                )}
              </div>
            </div>

            {status.configured && (
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Re-register Webhook</p>
                  <p className="text-xs text-muted-foreground">
                    {status.registered
                      ? "Webhook is active. Click to force re-registration if calls aren't being recorded."
                      : "The webhook is missing or mismatched. Click to register it now."}
                  </p>
                </div>
                <Button
                  variant={status.registered ? "outline" : "default"}
                  size="sm"
                  onClick={() => reregisterMutation.mutate()}
                  disabled={reregisterMutation.isPending}
                  data-testid="button-voice-reregister-webhook"
                >
                  {reregisterMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Registering…</>
                  ) : (
                    <><RefreshCw className="h-4 w-4 mr-1" /> Re-register Webhook</>
                  )}
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Unable to load webhook status.</p>
        )}
      </CardContent>
    </Card>
  );
}

function AuditLogSection() {
  const [entityTypeFilter, setEntityTypeFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const queryParams = new URLSearchParams();
  if (entityTypeFilter) queryParams.set("entityType", entityTypeFilter);
  if (startDate) queryParams.set("startDate", startDate);
  if (endDate) queryParams.set("endDate", endDate);
  const queryString = queryParams.toString();

  const auditUrl = queryString ? `/api/audit-trail?${queryString}` : "/api/audit-trail";
  const { data: auditEntries = [], isLoading: loadingAudit } = useQuery<AuditEntry[]>({
    queryKey: [auditUrl],
  });

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card data-testid="card-audit-log">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Audit Log
        </CardTitle>
        <CardDescription>Track all changes made to your company data</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 mb-4">
          <Select value={entityTypeFilter} onValueChange={(val) => setEntityTypeFilter(val === "all" ? "" : val)}>
            <SelectTrigger className="w-[180px]" data-testid="select-audit-entity-type">
              <SelectValue placeholder="All Entity Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Entity Types</SelectItem>
              {ENTITY_TYPES.map((et) => (
                <SelectItem key={et.value} value={et.value}>{et.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-[160px]"
            data-testid="input-audit-start-date"
          />
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-[160px]"
            data-testid="input-audit-end-date"
          />
          {(entityTypeFilter || startDate || endDate) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setEntityTypeFilter(""); setStartDate(""); setEndDate(""); }}
              data-testid="button-clear-audit-filters"
            >
              Clear Filters
            </Button>
          )}
        </div>

        {loadingAudit ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : auditEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-audit-empty">
            No audit log entries found.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-md border">
          <Table data-testid="table-audit-log">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Entity Type</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity ID</TableHead>
                <TableHead>Changes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditEntries.map((entry) => (
                <TableRow key={entry.id} data-testid={`row-audit-${entry.id}`}>
                  <TableCell className="whitespace-nowrap text-sm" data-testid={`text-audit-date-${entry.id}`}>
                    {new Date(entry.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-sm" data-testid={`text-audit-user-${entry.id}`}>
                    {entry.userId || "System"}
                  </TableCell>
                  <TableCell data-testid={`text-audit-entity-type-${entry.id}`}>
                    <Badge variant="secondary" className="capitalize">{entry.entityType.replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell data-testid={`text-audit-action-${entry.id}`}>
                    <Badge
                      variant={entry.action === "delete" ? "destructive" : entry.action === "create" ? "default" : "secondary"}
                      className="capitalize"
                    >
                      {entry.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm font-mono truncate max-w-[120px]" data-testid={`text-audit-entity-id-${entry.id}`}>
                    {entry.entityId}
                  </TableCell>
                  <TableCell>
                    {entry.changes ? (
                      <Collapsible open={expandedRows.has(entry.id)} onOpenChange={() => toggleRow(entry.id)}>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" data-testid={`button-toggle-changes-${entry.id}`}>
                            <ChevronDown className={`h-4 w-4 transition-transform ${expandedRows.has(entry.id) ? "rotate-180" : ""}`} />
                            View
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="mt-2 space-y-1 text-xs" data-testid={`content-audit-changes-${entry.id}`}>
                            {entry.changes.old && Object.keys(entry.changes.old).length > 0 && (
                              <div>
                                <span className="font-medium text-muted-foreground">Old:</span>
                                <pre className="bg-muted/50 rounded p-2 mt-0.5 overflow-x-auto">{JSON.stringify(entry.changes.old, null, 2)}</pre>
                              </div>
                            )}
                            {entry.changes.new && Object.keys(entry.changes.new).length > 0 && (
                              <div>
                                <span className="font-medium text-muted-foreground">New:</span>
                                <pre className="bg-muted/50 rounded p-2 mt-0.5 overflow-x-auto">{JSON.stringify(entry.changes.new, null, 2)}</pre>
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SignupWidgetSection({ company }: { company: { slug: string | null; name: string; quoteFormLayout: string } | null }) {
  const { toast } = useToast();
  const [slugInput, setSlugInput] = useState(company?.slug || "");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (company?.slug) setSlugInput(company.slug);
  }, [company?.slug]);

  const slugMutation = useMutation({
    mutationFn: async (newSlug: string) => {
      const res = await apiRequest("PATCH", "/api/company", { slug: newSlug });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update slug");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: "Signup link updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const layoutMutation = useMutation({
    mutationFn: async (layout: string) => {
      const res = await apiRequest("PATCH", "/api/company", { quoteFormLayout: layout });
      if (!res.ok) throw new Error("Failed to update layout");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: "Form layout updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const baseUrl = window.location.origin;
  const signupUrl = company?.slug ? `${baseUrl}/signup/${company.slug}` : "";
  const embedUrl = company?.slug ? `${baseUrl}/signup/${company.slug}?embed=true` : "";
  const iframeSnippet = company?.slug
    ? `<div style="max-width:500px;margin:0 auto;"><iframe src="${embedUrl}" width="100%" height="700" frameborder="0" style="border:none;width:100%;min-height:700px;" allow="clipboard-write"></iframe></div>`
    : "";

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
    toast({ title: `${label} copied to clipboard` });
  };

  return (
    <Card data-testid="card-signup-widget">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Client Signup Widget
        </CardTitle>
        <CardDescription>
          Let potential clients request a quote and sign up from your website
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Your Signup URL Slug</Label>
          <div className="flex gap-2">
            <div className="flex items-center gap-1 text-sm text-muted-foreground shrink-0">
              {baseUrl}/signup/
            </div>
            <Input
              value={slugInput}
              onChange={(e) => setSlugInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="your-company"
              className="max-w-[200px]"
              data-testid="input-company-slug"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!slugInput || slugInput === company?.slug || slugMutation.isPending}
              onClick={() => slugMutation.mutate(slugInput)}
              data-testid="button-save-slug"
            >
              {slugMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Use lowercase letters, numbers, and hyphens. Minimum 3 characters.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Form Layout</Label>
          <div className="flex gap-2">
            <Button
              variant={company?.quoteFormLayout === "stepper" || !company?.quoteFormLayout ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => layoutMutation.mutate("stepper")}
              disabled={layoutMutation.isPending}
              data-testid="button-layout-stepper"
            >
              Step-by-Step
            </Button>
            <Button
              variant={company?.quoteFormLayout === "single" ? "default" : "outline"}
              size="sm"
              className="flex-1"
              onClick={() => layoutMutation.mutate("single")}
              disabled={layoutMutation.isPending}
              data-testid="button-layout-single"
            >
              All at Once
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {company?.quoteFormLayout === "single"
              ? "All form sections are shown on a single page."
              : "The form is divided into steps that prospects complete one at a time."}
          </p>
        </div>

        {company?.slug && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Direct Link</Label>
              <div className="flex gap-2">
                <Input value={signupUrl} readOnly className="text-sm font-mono" data-testid="input-signup-url" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(signupUrl, "Link")}
                  data-testid="button-copy-signup-url"
                >
                  {copied === "Link" ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Embed Code</Label>
              <div className="relative">
                <textarea
                  value={iframeSnippet}
                  readOnly
                  rows={3}
                  className="w-full text-xs font-mono bg-muted/50 border rounded-md p-3 pr-12 resize-none"
                  data-testid="input-embed-code"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute top-2 right-2 h-8 w-8"
                  onClick={() => copyToClipboard(iframeSnippet, "Embed code")}
                  data-testid="button-copy-embed-code"
                >
                  {copied === "Embed code" ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Paste this HTML into your website (WordPress, Wix, Squarespace, etc.) to embed the quote form. The widget will adapt to your container width.
              </p>
            </div>

            <Button variant="outline" size="sm" asChild data-testid="button-preview-signup">
              <a href={`${signupUrl}?preview=true`} target="_blank" rel="noopener noreferrer">
                <Link2 className="h-4 w-4 mr-2" />
                Preview Quote Form
              </a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type ApiKeyData = {
  id: string;
  name: string;
  keyPrefix: string;
  maskedKey: string;
  scopes: string[];
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
};

function WebhookLeadSection() {
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [newRawKey, setNewRawKey] = useState<string | null>(null);

  const { data: apiKeys = [], isLoading: loadingKeys } = useQuery<ApiKeyData[]>({
    queryKey: ["/api/api-keys"],
  });

  const createKeyMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/api-keys", { name, scopes: ["leads:write"] });
      return res.json();
    },
    onSuccess: (data: ApiKeyData & { rawKey: string }) => {
      setNewRawKey(data.rawKey);
      setKeyName("");
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({ title: "API key created", description: "Copy your key now - it won't be shown again." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/api-keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({ title: "API key deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const baseUrl = window.location.origin;
  const webhookUrl = `${baseUrl}/api/webhooks/leads`;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
    toast({ title: `${label} copied to clipboard` });
  };

  const exampleCurl = `curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -d '{
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "jane@example.com",
    "phone": "+15551234567",
    "streetAddress": "123 Main St",
    "city": "Austin",
    "state": "TX",
    "zipCode": "78701",
    "numberOfDogs": 2,
    "yardSize": "medium",
    "serviceFrequency": "weekly",
    "source": "facebook_ads"
  }'`;

  return (
    <Card data-testid="card-webhook-leads">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Lead Webhook Integration
        </CardTitle>
        <CardDescription>
          Automatically capture leads from Facebook Ads, Google Ads, or any platform that supports webhooks
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Webhook URL</Label>
          <div className="flex gap-2">
            <Input value={webhookUrl} readOnly className="text-sm font-mono" data-testid="input-webhook-url" />
            <Button
              variant="outline"
              size="icon"
              onClick={() => copyToClipboard(webhookUrl, "Webhook URL")}
              data-testid="button-copy-webhook-url"
            >
              {copied === "Webhook URL" ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Send a POST request to this URL with an <code className="bg-muted px-1 rounded">x-api-key</code> header.
          </p>
        </div>

        <div className="space-y-3">
          <Label>API Keys</Label>
          {loadingKeys ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <>
              {apiKeys.length > 0 && (
                <div className="space-y-2">
                  {apiKeys.map((key) => (
                    <div key={key.id} className="flex items-center justify-between gap-2 p-2 border rounded-md" data-testid={`row-api-key-${key.id}`}>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{key.name}</span>
                        <span className="text-xs text-muted-foreground ml-2 font-mono">{key.maskedKey}</span>
                        {key.lastUsedAt && (
                          <span className="text-xs text-muted-foreground ml-2">
                            Last used: {new Date(key.lastUsedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => deleteKeyMutation.mutate(key.id)}
                        disabled={deleteKeyMutation.isPending}
                        data-testid={`button-delete-api-key-${key.id}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {newRawKey && (
                <div className="p-3 border border-green-300 bg-green-50 dark:bg-green-950 dark:border-green-800 rounded-md space-y-2" data-testid="container-new-api-key">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium">New API Key (copy now - shown only once)</span>
                  </div>
                  <div className="flex gap-2">
                    <Input value={newRawKey} readOnly className="text-sm font-mono" data-testid="input-new-api-key" />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => copyToClipboard(newRawKey, "API Key")}
                      data-testid="button-copy-new-api-key"
                    >
                      {copied === "API Key" ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setNewRawKey(null)} data-testid="button-dismiss-api-key">
                    Dismiss
                  </Button>
                </div>
              )}

              {showCreateKey ? (
                <div className="flex gap-2">
                  <Input
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="Key name (e.g., Facebook Leads)"
                    className="max-w-[250px]"
                    data-testid="input-api-key-name"
                  />
                  <Button
                    size="sm"
                    disabled={!keyName.trim() || createKeyMutation.isPending}
                    onClick={() => createKeyMutation.mutate(keyName.trim())}
                    data-testid="button-create-api-key"
                  >
                    {createKeyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setShowCreateKey(false); setKeyName(""); }} data-testid="button-cancel-create-key">
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setShowCreateKey(true)} data-testid="button-add-api-key">
                  <Plus className="h-4 w-4 mr-1" />
                  Create API Key
                </Button>
              )}
            </>
          )}
        </div>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="flex items-center gap-1" data-testid="button-toggle-webhook-docs">
              <Info className="h-4 w-4" />
              Payload Schema & Example
              <ChevronDown className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Expected JSON Payload</Label>
                <div className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre" data-testid="text-webhook-schema">
{`{
  "firstName": "string (required)",
  "lastName": "string",
  "email": "string (valid email)",
  "phone": "string (for auto-quote SMS)",
  "streetAddress": "string",
  "city": "string",
  "state": "string",
  "zipCode": "string",
  "numberOfDogs": "number (1-20, default: 1)",
  "yardSize": "small | medium | large | extra-large",
  "serviceFrequency": "weekly | biweekly | monthly | onetime",
  "serviceDay": "monday - sunday",
  "source": "string (lead source label, default: webhook)",
  "notes": "string (up to 2000 chars)"
}`}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Example cURL</Label>
                <div className="relative">
                  <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre" data-testid="text-webhook-curl">
                    {exampleCurl}
                  </pre>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-1 right-1 h-6 w-6"
                    onClick={() => copyToClipboard(exampleCurl, "cURL")}
                    data-testid="button-copy-curl"
                  >
                    {copied === "cURL" ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>If the lead includes a phone number and SMS is configured, an auto-quote SMS will be sent immediately using your SMS template.</p>
                <p>The response includes the created contact ID, calculated price quote, and whether an SMS was sent.</p>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function SmsQuoteTemplateSection({ company }: { company: Company | null }) {
  const { toast } = useToast();
  const defaultTemplate = "Hi {firstName}! Thanks for your interest in our pet waste removal service. Based on {dogs} dog(s) with {frequency} service, your estimated price is ${price}/visit. Reply YES to get started!";
  const [template, setTemplate] = useState(company?.leadWebhookSmsTemplate || defaultTemplate);

  useEffect(() => {
    if (company?.leadWebhookSmsTemplate) {
      setTemplate(company.leadWebhookSmsTemplate);
    }
  }, [company?.leadWebhookSmsTemplate]);

  const saveMutation = useMutation({
    mutationFn: async (tmpl: string) => {
      const res = await apiRequest("PATCH", "/api/company", { leadWebhookSmsTemplate: tmpl });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save template");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: "SMS quote template saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const previewText = template
    .replace(/\{firstName\}/g, "Jane")
    .replace(/\{dogs\}/g, "2")
    .replace(/\{frequency\}/g, "weekly")
    .replace(/\{price\}/g, "$29.00/visit");

  return (
    <Card data-testid="card-sms-quote-template">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Auto-Quote SMS Template
        </CardTitle>
        <CardDescription>
          Customize the automatic quote text sent to leads who provide a phone number
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Message Template</Label>
          <Textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={4}
            className="font-mono text-sm"
            data-testid="textarea-sms-template"
          />
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() => setTemplate(t => t + "{firstName}")} data-testid="badge-merge-firstName">
              {"{firstName}"}
            </Badge>
            <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() => setTemplate(t => t + "{dogs}")} data-testid="badge-merge-dogs">
              {"{dogs}"}
            </Badge>
            <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() => setTemplate(t => t + "{frequency}")} data-testid="badge-merge-frequency">
              {"{frequency}"}
            </Badge>
            <Badge variant="secondary" className="text-xs cursor-pointer" onClick={() => setTemplate(t => t + "{price}")} data-testid="badge-merge-price">
              {"{price}"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Click a merge field above to insert it. These will be replaced with actual values when the SMS is sent.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Preview</Label>
          <div className="bg-muted rounded-md p-3 text-sm" data-testid="text-sms-preview">
            {previewText}
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => saveMutation.mutate(template)}
            disabled={saveMutation.isPending || template === (company?.leadWebhookSmsTemplate || defaultTemplate)}
            data-testid="button-save-sms-template"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save Template
          </Button>
          <Button
            variant="ghost"
            onClick={() => setTemplate(defaultTemplate)}
            disabled={template === defaultTemplate}
            data-testid="button-reset-sms-template"
          >
            Reset to Default
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EmailTemplateEditor({ company }: { company: Company | null }) {
  const { toast } = useToast();
  const defaultSubject = "Your Quote from {companyName}";
  const defaultBody = "Hi {firstName},\n\nThank you for requesting a quote from {companyName}!\n\nYour estimated price for {frequency} service with {dogs} dog(s) is ${price}/visit.\n\nWe'll follow up shortly to confirm your schedule.\n\nBest regards,\n{companyName}";

  const [emailSubject, setEmailSubject] = useState(company?.quoteFollowUpEmailSubject || defaultSubject);
  const [emailBody, setEmailBody] = useState(company?.quoteFollowUpEmailBody || defaultBody);

  useEffect(() => {
    if (company?.quoteFollowUpEmailSubject) setEmailSubject(company.quoteFollowUpEmailSubject);
    if (company?.quoteFollowUpEmailBody) setEmailBody(company.quoteFollowUpEmailBody);
  }, [company?.quoteFollowUpEmailSubject, company?.quoteFollowUpEmailBody]);

  const saveEmailMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/company", { quoteFollowUpEmailSubject: emailSubject, quoteFollowUpEmailBody: emailBody });
      if (!res.ok) throw new Error("Failed to save email template");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: "Email template saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const previewSubject = emailSubject
    .replace(/\{firstName\}/g, "Jane")
    .replace(/\{companyName\}/g, company?.name || "Your Company")
    .replace(/\{price\}/g, "$29.00/visit")
    .replace(/\{frequency\}/g, "weekly")
    .replace(/\{dogs\}/g, "2");
  const previewBody = emailBody
    .replace(/\{firstName\}/g, "Jane")
    .replace(/\{companyName\}/g, company?.name || "Your Company")
    .replace(/\{price\}/g, "$29.00/visit")
    .replace(/\{frequency\}/g, "weekly")
    .replace(/\{dogs\}/g, "2");

  const hasChanges = emailSubject !== (company?.quoteFollowUpEmailSubject || defaultSubject)
    || emailBody !== (company?.quoteFollowUpEmailBody || defaultBody);

  return (
    <div className="space-y-3 pl-6 border-l-2 border-muted">
      <div className="space-y-2">
        <Label className="text-sm">Email Subject</Label>
        <Input
          value={emailSubject}
          onChange={(e) => setEmailSubject(e.target.value)}
          className="font-mono text-sm"
          data-testid="input-followup-email-subject"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-sm">Email Body</Label>
        <Textarea
          value={emailBody}
          onChange={(e) => setEmailBody(e.target.value)}
          rows={6}
          className="font-mono text-sm"
          data-testid="textarea-followup-email-body"
        />
        <div className="flex flex-wrap gap-1.5">
          {["{firstName}", "{companyName}", "{price}", "{frequency}", "{dogs}"].map((field) => (
            <Badge key={field} variant="secondary" className="text-xs cursor-pointer" onClick={() => setEmailBody(t => t + field)} data-testid={`badge-email-${field.replace(/[{}]/g, "")}`}>
              {field}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          The email body is wrapped in a branded HTML template with your company logo, estimate details table, and initial cleanup info.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Preview</Label>
        <div className="bg-muted rounded-md p-3 text-sm space-y-1" data-testid="text-followup-email-preview">
          <p className="font-semibold text-xs text-muted-foreground">Subject: {previewSubject}</p>
          <p className="whitespace-pre-wrap">{previewBody}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => saveEmailMutation.mutate()}
          disabled={saveEmailMutation.isPending || !hasChanges}
          data-testid="button-save-followup-email"
        >
          {saveEmailMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save Email Template
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setEmailSubject(defaultSubject); setEmailBody(defaultBody); }}
          disabled={emailSubject === defaultSubject && emailBody === defaultBody}
          data-testid="button-reset-followup-email"
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

function QuoteAutoFollowUpSection({ company }: { company: Company | null }) {
  const { toast } = useToast();
  const defaultSmsTemplate = "Thanks {firstName}! Your estimated quote from {companyName} is {price} for {frequency} service. We'll be in touch to confirm your schedule!";
  const [smsTemplate, setSmsTemplate] = useState(company?.quoteFollowUpSmsTemplate || defaultSmsTemplate);

  useEffect(() => {
    if (company?.quoteFollowUpSmsTemplate) {
      setSmsTemplate(company.quoteFollowUpSmsTemplate);
    }
  }, [company?.quoteFollowUpSmsTemplate]);

  const toggleMutation = useMutation({
    mutationFn: async (updates: Partial<{ quoteAutoFollowUpEnabled: boolean; quoteFollowUpEmailEnabled: boolean }>) => {
      const res = await apiRequest("PATCH", "/api/company", updates);
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveTemplateMutation = useMutation({
    mutationFn: async (tmpl: string) => {
      const res = await apiRequest("PATCH", "/api/company", { quoteFollowUpSmsTemplate: tmpl });
      if (!res.ok) throw new Error("Failed to save template");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: "Follow-up SMS template saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const previewText = smsTemplate
    .replace(/\{firstName\}/g, "Jane")
    .replace(/\{dogs\}/g, "2")
    .replace(/\{frequency\}/g, "weekly")
    .replace(/\{price\}/g, "$29.00/visit")
    .replace(/\{companyName\}/g, company?.name || "Your Company");

  const isEnabled = company?.quoteAutoFollowUpEnabled ?? false;
  const emailEnabled = company?.quoteFollowUpEmailEnabled ?? false;

  return (
    <Card data-testid="card-quote-auto-follow-up">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Quote Form Auto-Follow-Up
            </CardTitle>
            <CardDescription>
              Automatically send a confirmation message to prospects after they submit the quote form
            </CardDescription>
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={(checked) => toggleMutation.mutate({ quoteAutoFollowUpEnabled: checked })}
            data-testid="switch-quote-follow-up-enabled"
          />
        </div>
      </CardHeader>
      {isEnabled && (
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <Label className="font-medium">SMS Follow-Up</Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Sent immediately when a prospect provides a phone number. Requires SMS to be configured.
            </p>
            <div className="space-y-2">
              <Label className="text-sm">Message Template</Label>
              <Textarea
                value={smsTemplate}
                onChange={(e) => setSmsTemplate(e.target.value)}
                rows={3}
                className="font-mono text-sm"
                data-testid="textarea-quote-followup-sms"
              />
              <div className="flex flex-wrap gap-1.5">
                {["{firstName}", "{companyName}", "{price}", "{frequency}", "{dogs}"].map((field) => (
                  <Badge key={field} variant="secondary" className="text-xs cursor-pointer" onClick={() => setSmsTemplate(t => t + field)} data-testid={`badge-followup-${field.replace(/[{}]/g, "")}`}>
                    {field}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Preview</Label>
              <div className="bg-muted rounded-md p-3 text-sm" data-testid="text-followup-sms-preview">
                {previewText}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => saveTemplateMutation.mutate(smsTemplate)}
                disabled={saveTemplateMutation.isPending || smsTemplate === (company?.quoteFollowUpSmsTemplate || defaultSmsTemplate)}
                data-testid="button-save-followup-sms"
              >
                {saveTemplateMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save Template
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSmsTemplate(defaultSmsTemplate)}
                disabled={smsTemplate === defaultSmsTemplate}
                data-testid="button-reset-followup-sms"
              >
                Reset
              </Button>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <Label className="font-medium">Email Follow-Up</Label>
              </div>
              <Switch
                checked={emailEnabled}
                onCheckedChange={(checked) => toggleMutation.mutate({ quoteFollowUpEmailEnabled: checked })}
                data-testid="switch-quote-followup-email"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Send a branded confirmation email with the estimate details when a prospect provides an email address. Includes your company logo and green-branded template.
            </p>
            {emailEnabled && <EmailTemplateEditor company={company} />}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function GoogleReviewsSection({ company }: { company: Company | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: stats } = useQuery<{ totalSent: number; sentThisMonth: number; totalReviewsLeft: number }>({
    queryKey: ["/api/company/review-request-stats"],
  });

  const [reviewUrl, setReviewUrl] = useState(company?.googleReviewUrl || "");
  const [afterVisits, setAfterVisits] = useState(company?.reviewRequestAfterVisits ?? 3);
  const [customMsg, setCustomMsg] = useState(company?.reviewRequestCustomMessage || "");

  useEffect(() => {
    if (company?.googleReviewUrl) setReviewUrl(company.googleReviewUrl);
    if (company?.reviewRequestAfterVisits) setAfterVisits(company.reviewRequestAfterVisits);
    if (company?.reviewRequestCustomMessage) setCustomMsg(company.reviewRequestCustomMessage);
  }, [company?.googleReviewUrl, company?.reviewRequestAfterVisits, company?.reviewRequestCustomMessage]);

  const toggleMutation = useMutation({
    mutationFn: (checked: boolean) => apiRequest("PATCH", "/api/company", { reviewRequestEnabled: checked }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/company"] }); },
    onError: () => toast({ title: "Error", description: "Could not update setting", variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: (data: { googleReviewUrl?: string; reviewRequestAfterVisits?: number; reviewRequestCustomMessage?: string }) =>
      apiRequest("PATCH", "/api/company", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: "Saved", description: "Google Reviews settings saved" });
    },
    onError: () => toast({ title: "Error", description: "Could not save settings", variant: "destructive" }),
  });

  const isEnabled = company?.reviewRequestEnabled ?? false;
  const defaultMsg = `Hi {firstName}! We'd love to hear about your experience with {companyName}. Would you mind leaving us a quick Google review? It really helps! {reviewLink}`;
  const previewMsg = (customMsg || defaultMsg)
    .replace(/\{firstName\}/g, "Alex")
    .replace(/\{companyName\}/g, company?.name || "Your Company")
    .replace(/\{reviewLink\}/g, reviewUrl || "https://g.page/r/your-review-link");

  const hasChanges =
    reviewUrl !== (company?.googleReviewUrl || "") ||
    afterVisits !== (company?.reviewRequestAfterVisits ?? 3) ||
    customMsg !== (company?.reviewRequestCustomMessage || "");

  return (
    <Card data-testid="card-google-reviews">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-500" />
              Google Reviews Automation
            </CardTitle>
            <CardDescription>
              Automatically ask satisfied customers for a Google review after a set number of completed visits
            </CardDescription>
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={(checked) => toggleMutation.mutate(checked)}
            data-testid="switch-review-request-enabled"
          />
        </div>
      </CardHeader>
      {isEnabled && (
        <CardContent className="space-y-6">
          {stats && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted rounded-lg p-3 text-center">
                <p className="text-2xl font-bold" data-testid="stat-review-sent-month">{stats.sentThisMonth}</p>
                <p className="text-xs text-muted-foreground">Sent this month</p>
              </div>
              <div className="bg-muted rounded-lg p-3 text-center">
                <p className="text-2xl font-bold" data-testid="stat-review-total-sent">{stats.totalSent}</p>
                <p className="text-xs text-muted-foreground">Total sent</p>
              </div>
              <Link href="/contacts?filter=reviewed">
                <div className="bg-muted rounded-lg p-3 text-center cursor-pointer hover:bg-muted/70 transition-colors" data-testid="stat-review-left">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.totalReviewsLeft}</p>
                  <p className="text-xs text-muted-foreground">Customers reviewed</p>
                </div>
              </Link>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="google-review-url">Google Review Link</Label>
            <Input
              id="google-review-url"
              placeholder="https://g.page/r/..."
              value={reviewUrl}
              onChange={(e) => setReviewUrl(e.target.value)}
              data-testid="input-google-review-url"
            />
            <p className="text-xs text-muted-foreground">
              Find your link in Google Business Profile → Get more reviews → Share review form
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="after-visits">Send request after every</Label>
            <div className="flex items-center gap-2">
              <Input
                id="after-visits"
                type="number"
                min={1}
                max={20}
                value={afterVisits}
                onChange={(e) => setAfterVisits(parseInt(e.target.value) || 1)}
                className="w-24"
                data-testid="input-review-after-visits"
              />
              <span className="text-sm text-muted-foreground">completed visits</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Each customer's visit count resets after a review request is sent
            </p>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <Label className="font-medium">SMS Message Template</Label>
            </div>
            <p className="text-xs text-muted-foreground">Leave blank to use the default message</p>
            <Textarea
              placeholder={defaultMsg}
              value={customMsg}
              onChange={(e) => setCustomMsg(e.target.value)}
              rows={3}
              className="font-mono text-sm"
              data-testid="textarea-review-custom-message"
            />
            <div className="flex flex-wrap gap-1.5">
              {["{firstName}", "{companyName}", "{reviewLink}"].map((field) => (
                <Badge
                  key={field}
                  variant="secondary"
                  className="text-xs cursor-pointer"
                  onClick={() => setCustomMsg((m) => (m || defaultMsg) + field)}
                  data-testid={`badge-review-${field.replace(/[{}]/g, "")}`}
                >
                  {field}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Preview</Label>
            <div className="bg-muted rounded-md p-3 text-sm" data-testid="text-review-preview">
              {previewMsg}
            </div>
          </div>

          <Button
            onClick={() => saveMutation.mutate({ googleReviewUrl: reviewUrl, reviewRequestAfterVisits: afterVisits, reviewRequestCustomMessage: customMsg || undefined })}
            disabled={saveMutation.isPending || !hasChanges}
            data-testid="button-save-review-settings"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save Settings
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

type ReminderRule = {
  id: string;
  timing: "24h_before" | "2h_before" | "morning_of" | "custom";
  customHours?: number;
  channel: "sms" | "email" | "both";
  template: string;
  isActive: boolean;
};

type InvoiceReminderSettings = {
  preDueDays: number[];
  overdueIntervalDays: number;
  maxReminders: number;
};

type ReminderLog = {
  id: string;
  contactId: string;
  contactName: string;
  visitId: string | null;
  invoiceId: string | null;
  ruleId: string | null;
  reminderType: string;
  channel: string;
  messagePreview: string | null;
  deliveryStatus: string;
  sentAt: string;
};

const TIMING_OPTIONS = [
  { value: "24h_before", label: "24 hours before" },
  { value: "2h_before", label: "2 hours before" },
  { value: "morning_of", label: "Morning of service" },
  { value: "custom", label: "Custom hours" },
];

const CHANNEL_OPTIONS = [
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "both", label: "Both" },
];

const DEFAULT_TEMPLATE = "Hi {firstName}, your service with {companyName} is scheduled for tomorrow at {propertyAddress}. Thank you!";

function ReminderSettingsSection({ company, toast }: { company: Company | null; toast: ReturnType<typeof useToast>["toast"] }) {
  const { user } = useAuth();
  const [roverVisible, setRoverVisible] = useState(() => {
    if (typeof window === "undefined" || !user) return true;
    return localStorage.getItem(getDismissedKey(user.id.toString())) !== "true";
  });

  useEffect(() => {
    if (!user) return;
    const stored = localStorage.getItem(getDismissedKey(user.id.toString()));
    setRoverVisible(stored !== "true");
  }, [user]);

  const handleRoverVisibleChange = (checked: boolean) => {
    if (!user) return;
    if (checked) {
      localStorage.removeItem(getDismissedKey(user.id.toString()));
    } else {
      localStorage.setItem(getDismissedKey(user.id.toString()), "true");
    }
    setRoverVisible(checked);
    window.dispatchEvent(new Event("rover-dismissed-change"));
    toast({
      title: checked ? "Rover restored" : "Rover hidden",
      description: checked
        ? "The Rover assistant button is visible again."
        : "The Rover button has been hidden. You can re-enable it here anytime.",
    });
  };

  const [rules, setRules] = useState<ReminderRule[]>([]);
  const [invoiceSettings, setInvoiceSettings] = useState<InvoiceReminderSettings>({
    preDueDays: [7, 2, 1, 0], overdueIntervalDays: 2, maxReminders: 10
  });
  const [saving, setSaving] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<ReminderLog[]>([]);
  const [logPage, setLogPage] = useState(1);
  const [logTotal, setLogTotal] = useState(0);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [editingRule, setEditingRule] = useState<ReminderRule | null>(null);
  const [showRuleDialog, setShowRuleDialog] = useState(false);
  const [preDueDaysInput, setPreDueDaysInput] = useState("");

  const { data: settingsData } = useQuery<{
    reminderSettings: ReminderRule[];
    invoiceReminderSettings: InvoiceReminderSettings;
    remindersEnabled: boolean;
  }>({
    queryKey: ["/api/company/reminder-settings"],
  });

  useEffect(() => {
    if (settingsData) {
      setRules(settingsData.reminderSettings || []);
      const invSettings = settingsData.invoiceReminderSettings;
      if (invSettings) {
        setInvoiceSettings(invSettings);
        setPreDueDaysInput((invSettings.preDueDays || []).join(", "));
      }
    }
  }, [settingsData]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const parsedDays = preDueDaysInput.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 0);
      const updatedInvoiceSettings = { ...invoiceSettings, preDueDays: parsedDays };
      await apiRequest("PATCH", "/api/company", {
        reminderSettings: rules,
        invoiceReminderSettings: updatedInvoiceSettings,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/reminder-settings"] });
      toast({ title: "Reminder settings saved" });
    } catch {
      toast({ title: "Error", description: "Failed to save reminder settings.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const loadLogs = async (page = 1) => {
    setLoadingLogs(true);
    try {
      const res = await fetch(`/api/company/reminder-logs?page=${page}&limit=20`, { credentials: "include" });
      const data = await res.json();
      setLogs(data.logs || []);
      setLogTotal(data.total || 0);
      setLogPage(page);
    } catch {
      toast({ title: "Error", description: "Failed to load reminder logs.", variant: "destructive" });
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleAddRule = () => {
    setEditingRule({
      id: `rule_${Date.now()}`,
      timing: "24h_before",
      channel: "sms",
      template: DEFAULT_TEMPLATE,
      isActive: true,
    });
    setShowRuleDialog(true);
  };

  const handleEditRule = (rule: ReminderRule) => {
    setEditingRule({ ...rule });
    setShowRuleDialog(true);
  };

  const handleSaveRule = () => {
    if (!editingRule) return;
    setRules(prev => {
      const idx = prev.findIndex(r => r.id === editingRule.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = editingRule;
        return updated;
      }
      return [...prev, editingRule];
    });
    setShowRuleDialog(false);
    setEditingRule(null);
  };

  const handleDeleteRule = (ruleId: string) => {
    setRules(prev => prev.filter(r => r.id !== ruleId));
  };

  const toggleRuleActive = (ruleId: string) => {
    setRules(prev => prev.map(r => r.id === ruleId ? { ...r, isActive: !r.isActive } : r));
  };

  const timingLabel = (timing: string) => TIMING_OPTIONS.find(t => t.value === timing)?.label || timing;
  const channelLabel = (channel: string) => CHANNEL_OPTIONS.find(c => c.value === channel)?.label || channel;

  const reminderTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      service_24h_before: "Service (24h)",
      service_2h_before: "Service (2h)",
      service_morning_of: "Service (Morning)",
      service_custom: "Service (Custom)",
      invoice_upcoming: "Invoice Due",
      invoice_overdue: "Invoice Overdue",
    };
    return labels[type] || type;
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Automated Reminders
          </CardTitle>
          <CardDescription>Configure when and how clients receive service and invoice reminders</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Enable Automated Reminders</p>
                <p className="text-xs text-muted-foreground">
                  When enabled, clients receive reminders based on the rules below
                </p>
              </div>
              <Switch
                checked={company?.remindersEnabled ?? false}
                onCheckedChange={(checked) => {
                  apiRequest("PATCH", "/api/company", { remindersEnabled: checked })
                    .then(() => {
                      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
                      toast({
                        title: checked ? "Reminders enabled" : "Reminders disabled",
                        description: checked
                          ? "Your clients will receive automated reminders."
                          : "Automated reminders have been turned off.",
                      });
                    })
                    .catch(() => {
                      toast({ title: "Error", description: "Failed to update reminder settings.", variant: "destructive" });
                    });
                }}
                data-testid="switch-reminders-enabled"
              />
            </div>

            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <div>
                <p className="text-sm font-medium">Rover AI Assistant</p>
                <p className="text-xs text-muted-foreground">
                  When enabled, Rover uses AI to answer questions and query your business data
                </p>
              </div>
              <Switch
                checked={company?.roverAiEnabled ?? true}
                onCheckedChange={(checked) => {
                  apiRequest("PATCH", "/api/company", { roverAiEnabled: checked })
                    .then(() => {
                      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
                      toast({
                        title: checked ? "Rover AI enabled" : "Rover AI disabled",
                        description: checked
                          ? "Rover will use AI to answer your questions."
                          : "Rover will use basic keyword matching.",
                      });
                    })
                    .catch(() => {
                      toast({ title: "Error", description: "Failed to update Rover AI settings.", variant: "destructive" });
                    });
                }}
                data-testid="switch-rover-ai-enabled"
              />
            </div>

            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <div>
                <p className="text-sm font-medium">Show Rover Button</p>
                <p className="text-xs text-muted-foreground">
                  Show or hide the Rover assistant button on screen. Toggle back on anytime to bring it back.
                </p>
              </div>
              <Switch
                checked={roverVisible}
                onCheckedChange={handleRoverVisibleChange}
                data-testid="switch-rover-visible"
              />
            </div>

            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <div>
                <p className="text-sm font-medium">Company Timezone</p>
                <p className="text-xs text-muted-foreground">
                  Controls when reminders are sent and quiet hours enforcement
                </p>
              </div>
              <select
                className="border rounded px-2 py-1 text-sm bg-background"
                value={company?.timezone ?? "America/New_York"}
                onChange={(e) => {
                  apiRequest("PATCH", "/api/company", { timezone: e.target.value })
                    .then(() => {
                      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
                      toast({ title: "Timezone updated" });
                    })
                    .catch(() => {
                      toast({ title: "Error", description: "Failed to update timezone.", variant: "destructive" });
                    });
                }}
                data-testid="select-timezone"
              >
                <option value="America/New_York">Eastern (ET)</option>
                <option value="America/Chicago">Central (CT)</option>
                <option value="America/Denver">Mountain (MT)</option>
                <option value="America/Los_Angeles">Pacific (PT)</option>
                <option value="America/Anchorage">Alaska (AKT)</option>
                <option value="Pacific/Honolulu">Hawaii (HT)</option>
              </select>
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium">Service Reminder Rules</p>
                  <p className="text-xs text-muted-foreground">Add multiple rules with different timing and channels</p>
                </div>
                <Button variant="outline" size="sm" onClick={handleAddRule} data-testid="button-add-reminder-rule">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Rule
                </Button>
              </div>

              {rules.length === 0 ? (
                <div className="text-center py-6 border rounded-lg bg-muted/30">
                  <Bell className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">No reminder rules configured</p>
                  <p className="text-xs text-muted-foreground mt-1">Add a rule to start sending service reminders</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {rules.map((rule) => (
                    <div key={rule.id} className={`flex items-center justify-between p-3 border rounded-lg ${rule.isActive ? "" : "opacity-50"}`} data-testid={`reminder-rule-${rule.id}`}>
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Switch
                          checked={rule.isActive}
                          onCheckedChange={() => toggleRuleActive(rule.id)}
                          data-testid={`switch-rule-active-${rule.id}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="secondary" className="text-xs">{timingLabel(rule.timing)}</Badge>
                            {rule.timing === "custom" && rule.customHours && (
                              <Badge variant="outline" className="text-xs">{rule.customHours}h</Badge>
                            )}
                            <Badge variant="outline" className="text-xs">{channelLabel(rule.channel)}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 truncate">{rule.template}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-2 shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEditRule(rule)} data-testid={`button-edit-rule-${rule.id}`}>
                          <Wrench className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteRule(rule.id)} data-testid={`button-delete-rule-${rule.id}`}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium border-t pt-4 w-full">
                <ChevronDown className="h-4 w-4" />
                Invoice Reminder Settings
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3 space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Days before due to remind</label>
                  <Input
                    value={preDueDaysInput}
                    onChange={(e) => setPreDueDaysInput(e.target.value)}
                    placeholder="7, 2, 1, 0"
                    className="mt-1"
                    data-testid="input-pre-due-days"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Comma-separated days (e.g., 7, 2, 1, 0 means reminders 7 days, 2 days, 1 day, and day of due date)</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Overdue interval (days)</label>
                    <Input
                      type="number"
                      min={1}
                      max={30}
                      value={invoiceSettings.overdueIntervalDays}
                      onChange={(e) => setInvoiceSettings(prev => ({ ...prev, overdueIntervalDays: parseInt(e.target.value) || 2 }))}
                      className="mt-1"
                      data-testid="input-overdue-interval"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Max reminders per invoice</label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={invoiceSettings.maxReminders}
                      onChange={(e) => setInvoiceSettings(prev => ({ ...prev, maxReminders: parseInt(e.target.value) || 10 }))}
                      className="mt-1"
                      data-testid="input-max-reminders"
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <div className="flex items-center justify-between border-t pt-4">
              <Button variant="outline" size="sm" onClick={() => { setShowLogs(true); loadLogs(1); }} data-testid="button-view-reminder-logs">
                <CalendarClock className="h-3.5 w-3.5 mr-1.5" /> View Reminder Log
              </Button>
              <Button onClick={saveSettings} disabled={saving} data-testid="button-save-reminder-settings">
                <Save className="h-3.5 w-3.5 mr-1.5" />
                {saving ? "Saving..." : "Save Settings"}
              </Button>
            </div>

            <div className="text-xs text-muted-foreground space-y-1 border-t pt-3">
              <p className="flex items-center gap-1"><Info className="h-3 w-3" /> Quiet hours: SMS is not sent before 8 AM or after 8 PM in your timezone.</p>
              <p className="flex items-center gap-1"><Info className="h-3 w-3" /> Morning-of reminders include technician name and arrival window when a route is assigned.</p>
              <p className="flex items-center gap-1"><Info className="h-3 w-3" /> Clients can override their preferred channel and opt out from their portal.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showRuleDialog} onOpenChange={setShowRuleDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRule && rules.some(r => r.id === editingRule.id) ? "Edit" : "Add"} Reminder Rule</DialogTitle>
          </DialogHeader>
          {editingRule && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Timing</label>
                <Select value={editingRule.timing} onValueChange={(v) => setEditingRule({ ...editingRule, timing: v as ReminderRule["timing"] })}>
                  <SelectTrigger className="mt-1" data-testid="select-rule-timing">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMING_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {editingRule.timing === "custom" && (
                <div>
                  <label className="text-sm font-medium">Hours before service</label>
                  <Input
                    type="number"
                    min={1}
                    max={168}
                    value={editingRule.customHours || 24}
                    onChange={(e) => setEditingRule({ ...editingRule, customHours: parseInt(e.target.value) || 24 })}
                    className="mt-1"
                    data-testid="input-rule-custom-hours"
                  />
                </div>
              )}
              <div>
                <label className="text-sm font-medium">Channel</label>
                <Select value={editingRule.channel} onValueChange={(v) => setEditingRule({ ...editingRule, channel: v as ReminderRule["channel"] })}>
                  <SelectTrigger className="mt-1" data-testid="select-rule-channel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNEL_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Message Template</label>
                <Textarea
                  value={editingRule.template}
                  onChange={(e) => setEditingRule({ ...editingRule, template: e.target.value })}
                  rows={3}
                  className="mt-1"
                  data-testid="textarea-rule-template"
                />
                <div className="flex flex-wrap gap-1 mt-2">
                  {["{firstName}", "{lastName}", "{companyName}", "{propertyAddress}", "{serviceDate}", "{serviceTime}", "{technicianName}", "{arrivalWindow}"].map(tag => (
                    <Badge key={tag} variant="outline" className="text-xs cursor-pointer hover:bg-primary/10"
                      onClick={() => setEditingRule({ ...editingRule, template: editingRule.template + " " + tag })}
                    >{tag}</Badge>
                  ))}
                </div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">Preview</p>
                <p className="text-sm">
                  {editingRule.template
                    .replace("{firstName}", "John")
                    .replace("{lastName}", "Smith")
                    .replace("{companyName}", company?.name || "Your Company")
                    .replace("{propertyAddress}", "123 Main St")
                    .replace("{serviceDate}", "2025-03-20")
                    .replace("{serviceTime}", "9:00 AM - 9:30 AM")
                    .replace("{technicianName}", "Mike Johnson")
                    .replace("{arrivalWindow}", "9:00 AM - 9:30 AM")}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRuleDialog(false)} data-testid="button-cancel-rule">Cancel</Button>
            <Button onClick={handleSaveRule} data-testid="button-save-rule">Save Rule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLogs} onOpenChange={setShowLogs}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reminder Log</DialogTitle>
          </DialogHeader>
          {loadingLogs ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8">
              <Bell className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No reminders sent yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sent</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map(log => (
                    <TableRow key={log.id} data-testid={`reminder-log-${log.id}`}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(log.sentAt).toLocaleDateString()}{" "}
                        {new Date(log.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell className="text-sm">{log.contactName}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">{reminderTypeLabel(log.reminderType)}</Badge>
                      </TableCell>
                      <TableCell className="text-xs capitalize">{log.channel}</TableCell>
                      <TableCell>
                        <Badge variant={log.deliveryStatus === "sent" ? "default" : "destructive"} className="text-xs">
                          {log.deliveryStatus}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {logTotal > 20 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-muted-foreground">{logTotal} total entries</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={logPage <= 1} onClick={() => loadLogs(logPage - 1)} data-testid="button-log-prev">Previous</Button>
                    <Button variant="outline" size="sm" disabled={logPage * 20 >= logTotal} onClick={() => loadLogs(logPage + 1)} data-testid="button-log-next">Next</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

type DemoSettings = {
  unlimitedCredits: boolean;
  bypassLimits: boolean;
  autoCompleteToday: boolean;
  autoPayInvoices: boolean;
  livePlaybackEnabled: boolean;
};

function DemoModeSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: demoStatus, isLoading } = useQuery<{ isDemo: boolean; settings?: DemoSettings }>({
    queryKey: ["/api/demo/status"],
  });

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<DemoSettings>) =>
      apiRequest("PATCH", "/api/demo/settings", updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/demo/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const autoCompleteMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/demo/run-auto-complete"),
    onSuccess: () => {
      toast({ title: "Auto-complete ran", description: "Today's visits have been marked complete." });
      queryClient.invalidateQueries({ queryKey: ["/api/visits/range"] });
    },
    onError: () => toast({ title: "Failed to run auto-complete", variant: "destructive" }),
  });

  const autoPayMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/demo/run-auto-pay"),
    onSuccess: () => {
      toast({ title: "Auto-pay ran", description: "~90% of invoices marked paid, 10% set overdue." });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: () => toast({ title: "Failed to run auto-pay", variant: "destructive" }),
  });

  if (isLoading) return <div className="flex items-center justify-center h-full"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!demoStatus?.isDemo) return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-4">
      <Zap className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">Available on the demo@scoopilot.com account only</p>
    </div>
  );

  const settings = demoStatus.settings!;

  const toggles: { key: keyof DemoSettings; icon: React.ElementType; label: string; description: string; actionLabel?: string; onAction?: () => void; actionPending?: boolean }[] = [
    {
      key: "unlimitedCredits",
      icon: Zap,
      label: "Unlimited Route Credits",
      description: "Skip credit deduction when optimizing routes",
    },
    {
      key: "bypassLimits",
      icon: Shield,
      label: "Bypass Feature Limits",
      description: "Treat this account as the highest plan tier",
    },
    {
      key: "autoCompleteToday",
      icon: CheckCircle2,
      label: "Auto-Complete Today's Visits",
      description: "Automatically mark all of today's visits as complete (hourly)",
      actionLabel: "Run now",
      onAction: () => autoCompleteMutation.mutate(),
      actionPending: autoCompleteMutation.isPending,
    },
    {
      key: "autoPayInvoices",
      icon: DollarSign,
      label: "Auto-Pay Invoices",
      description: "Pay ~90% of outstanding invoices; leave 10% overdue (daily)",
      actionLabel: "Run now",
      onAction: () => autoPayMutation.mutate(),
      actionPending: autoPayMutation.isPending,
    },
    {
      key: "livePlaybackEnabled",
      icon: PlayCircle,
      label: "Live Route Playback",
      description: "Show a playback overlay on the Routes page to simulate a tech completing stops",
    },
  ];

  return (
    <div className="space-y-2">
      {toggles.map(({ key, icon: Icon, label, description, actionLabel, onAction, actionPending }) => (
        <div key={key} className="flex items-start justify-between gap-3 p-3 rounded-lg border bg-muted/20">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Icon className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium leading-tight" data-testid={`text-demo-label-${key}`}>{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 mt-0.5">
            {actionLabel && onAction && settings[key] && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-2"
                onClick={onAction}
                disabled={actionPending}
                data-testid={`button-demo-action-${key}`}
              >
                {actionPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : actionLabel}
              </Button>
            )}
            <Switch
              checked={settings[key]}
              onCheckedChange={(val) => updateMutation.mutate({ [key]: val })}
              disabled={updateMutation.isPending}
              data-testid={`switch-demo-${key}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

const BILLING_CADENCE_OPTIONS = [
  { value: "per_visit", label: "Per Visit" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "manual", label: "Manual" },
];

const BILLING_TRIGGER_OPTIONS = [
  { value: "after_job", label: "After Job / Per Visit" },
  { value: "end_of_week", label: "End of Week" },
  { value: "end_of_month", label: "End of Month" },
  { value: "manual", label: "Manual Only" },
];

const PAYMENT_BEHAVIOR_OPTIONS = [
  { value: "autopay_immediate", label: "Autopay Immediately on Generation" },
  { value: "autopay_scheduled", label: "Autopay on Billing Date" },
  { value: "send_invoice", label: "Generate and Send Invoice" },
  { value: "review_only", label: "Generate for Review Only" },
];

function BillingDefaultsSection({ company }: { company: Company | null | undefined }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [cadence, setCadence] = useState(company?.billingCadence || "per_visit");
  const [trigger, setTrigger] = useState(company?.billingTrigger || "after_job");
  const [paymentBehavior, setPaymentBehavior] = useState(company?.defaultPaymentBehavior || "send_invoice");

  useEffect(() => {
    if (company) {
      setCadence(company.billingCadence || "per_visit");
      setTrigger(company.billingTrigger || "after_job");
      setPaymentBehavior(company.defaultPaymentBehavior || "send_invoice");
    }
  }, [company?.billingCadence, company?.billingTrigger, company?.defaultPaymentBehavior]);

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/company", {
      billingCadence: cadence,
      billingTrigger: trigger,
      defaultPaymentBehavior: paymentBehavior,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: "Billing defaults saved" });
    },
    onError: () => toast({ title: "Failed to save billing defaults", variant: "destructive" }),
  });

  const hasChanges =
    cadence !== (company?.billingCadence || "per_visit") ||
    trigger !== (company?.billingTrigger || "after_job") ||
    paymentBehavior !== (company?.defaultPaymentBehavior || "send_invoice");

  return (
    <div className="space-y-4" data-testid="section-billing-defaults">
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Default Billing Cadence</Label>
        <Select value={cadence} onValueChange={setCadence}>
          <SelectTrigger data-testid="select-billing-cadence">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BILLING_CADENCE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">How frequently billing cycles occur by default</p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Default Invoice Trigger</Label>
        <Select value={trigger} onValueChange={setTrigger}>
          <SelectTrigger data-testid="select-billing-trigger">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BILLING_TRIGGER_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">When invoices are generated by default</p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Default Payment Behavior</Label>
        <Select value={paymentBehavior} onValueChange={setPaymentBehavior}>
          <SelectTrigger data-testid="select-payment-behavior">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_BEHAVIOR_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">What happens when an invoice is generated by default</p>
      </div>

      {hasChanges && (
        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-billing-defaults">
          <Save className="mr-1 h-4 w-4" />
          {saveMutation.isPending ? "Saving..." : "Save Billing Defaults"}
        </Button>
      )}
    </div>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [newLeadSourceName, setNewLeadSourceName] = useState("");
  const [importStep, setImportStep] = useState<"idle" | "mapping" | "review">("idle");
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  const [inviteRole, setInviteRole] = useState("tech");
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [resetPasswordMember, setResetPasswordMember] = useState<TeamMember | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [rawCsvRows, setRawCsvRows] = useState<string[][]>([]);
  const [settingsColumnMapping, setSettingsColumnMapping] = useState<ColumnMapping[]>([]);
  const [settingsNewLeadSources, setSettingsNewLeadSources] = useState<string[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [localSettingsLayout, setLocalSettingsLayout] = useState<SettingsLayoutItem[] | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const settingsInitializedRef = useRef(false);
  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsUserInteractedRef = useRef(false);
  const { width: gridWidth, containerRef: gridContainerRef } = useContainerWidth();

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const { data: currentUser } = useQuery<{ id: string; role?: string }>({
    queryKey: ["/api/auth/user"],
  });

  const { data: company, isLoading: loadingCompany } = useQuery<Company>({
    queryKey: ["/api/company"],
  });

  const { data: team, isLoading: loadingTeam } = useQuery<TeamMember[]>({
    queryKey: ["/api/company/team"],
  });

  const { data: leadSources = [], isLoading: loadingLeadSources } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/lead-sources"],
  });

  const addLeadSourceMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/lead-sources", { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-sources"] });
      setNewLeadSourceName("");
      toast({ title: "Lead source added" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add lead source.", variant: "destructive" });
    },
  });

  const geocodeAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/properties/geocode-all");
      return res.json() as Promise<{ total: number; needsGeocode: number; geocoded: number }>;
    },
    onSuccess: (data) => {
      if (data.needsGeocode === 0) {
        toast({ title: "All addresses already geocoded", description: "No properties were missing coordinates." });
      } else {
        toast({
          title: "Geocoding complete",
          description: `Successfully geocoded ${data.geocoded} of ${data.needsGeocode} properties missing coordinates.`,
        });
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to re-geocode addresses.", variant: "destructive" });
    },
  });

  const geocodeUsageQuery = useQuery<{
    today: number;
    thisWeek: number;
    dailyThreshold: number;
    isOverThreshold: boolean;
    breakdown: { metric: string; today: number; thisWeek: number }[];
  }>({
    queryKey: ["/api/geocode/usage"],
    refetchInterval: 60_000,
  });

  const inviteMutation = useMutation({
    mutationFn: async (data: { email: string; firstName: string; lastName: string; role: string }) => {
      const res = await apiRequest("POST", "/api/company/invite", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/team"] });
      setInviteDialogOpen(false);
      setInviteEmail("");
      setInviteFirstName("");
      setInviteLastName("");
      setInviteRole("tech");
      toast({ title: "Team member invited", description: "An email with login credentials has been sent." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to invite", description: err.message || "Something went wrong", variant: "destructive" });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("DELETE", `/api/company/team/${userId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/team"] });
      setRemovingMemberId(null);
      toast({ title: "Team member removed" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to remove", description: err.message || "Something went wrong", variant: "destructive" });
    },
  });

  const resetMemberPasswordMutation = useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
      const res = await apiRequest("POST", `/api/company/team/${userId}/reset-password`, { newPassword });
      return res.json();
    },
    onSuccess: () => {
      setResetPasswordMember(null);
      setResetNewPassword("");
      setResetConfirmPassword("");
      toast({ title: "Password updated", description: "The team member's password has been changed." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to reset password", description: err.message || "Something went wrong", variant: "destructive" });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/change-password", { newPassword });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to change password");
      }
      return res.json();
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      toast({ title: "Password updated", description: "Your password has been changed successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteLeadSourceMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/lead-sources/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-sources"] });
      toast({ title: "Lead source removed" });
    },
  });

  const toggleAutoVisitsMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("PATCH", "/api/company", { autoVisitsEnabled: enabled });
      return res.json();
    },
    onSuccess: (_, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: enabled ? "Auto visit generation enabled" : "Auto visit generation disabled" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update setting.", variant: "destructive" });
    },
  });

  // Client Notifications (Import Mode + Onboarding Complete)
  const [showOnboardingDialog, setShowOnboardingDialog] = useState(false);
  const [onboardingResults, setOnboardingResults] = useState<{ sent: number; skipped: number; total: number; results: { name: string; email: string; status: string }[] } | null>(null);

  const toggleImportModeMutation = useMutation({
    mutationFn: async (suppressed: boolean) => {
      const res = await apiRequest("PATCH", "/api/company", { clientNotificationsSuppressed: suppressed });
      return res.json();
    },
    onSuccess: (_, suppressed) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: suppressed ? "Import Mode enabled — client emails suppressed" : "Import Mode disabled — client emails active" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update import mode.", variant: "destructive" });
    },
  });

  const onboardingPreviewQuery = useQuery<{ contacts: { id: string; name: string; email: string }[]; count: number }>({
    queryKey: ["/api/company/onboarding-welcome-preview"],
    enabled: showOnboardingDialog,
  });

  const sendOnboardingWelcomeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/company/send-onboarding-welcome", {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to send onboarding emails");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      setOnboardingResults(data);
      toast({ title: `Welcome emails sent to ${data.sent} client${data.sent !== 1 ? "s" : ""}`, description: data.skipped > 0 ? `${data.skipped} skipped due to errors.` : "Import Mode has been turned off." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to send onboarding emails.", variant: "destructive" });
    },
  });

  const savedSettingsLayout = useMemo<SettingsLayoutItem[] | null>(() => {
    if (!company) return null;
    const raw = company.settingsLayout;
    if (raw === null || raw === undefined) return null;
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object" && "i" in raw[0]) {
      const existing = raw as SettingsLayoutItem[];
      const existingIds = new Set(existing.map((item) => item.i));
      const missing: SettingsLayoutItem[] = [];
      let maxY = existing.reduce((m, item) => Math.max(m, item.y + item.h), 0);
      for (const id of DEFAULT_SETTINGS_BLOCK_IDS) {
        if (!existingIds.has(id)) {
          const def = SETTINGS_BLOCK_DEFS.find((b) => b.id === id);
          if (def) {
            missing.push({ i: id, x: 0, y: maxY, w: def.defaultW, h: def.defaultH, minW: def.minW, minH: def.minH });
            maxY += def.defaultH;
          }
        }
      }
      return missing.length > 0 ? [...existing, ...missing] : existing;
    }
    return null;
  }, [company]);

  useEffect(() => {
    if (savedSettingsLayout && !settingsInitializedRef.current) {
      setLocalSettingsLayout(savedSettingsLayout);
      settingsInitializedRef.current = true;
    } else if (savedSettingsLayout && settingsInitializedRef.current && !settingsUserInteractedRef.current) {
      setLocalSettingsLayout(savedSettingsLayout);
    }
  }, [savedSettingsLayout]);

  const currentSettingsLayout = useMemo<SettingsLayoutItem[]>(() => {
    if (localSettingsLayout !== null) return localSettingsLayout;
    if (savedSettingsLayout !== null) return savedSettingsLayout;
    return generateDefaultSettingsLayout();
  }, [localSettingsLayout, savedSettingsLayout]);

  const settingsGridLayouts = useMemo(() => ({ lg: currentSettingsLayout }), [currentSettingsLayout]);

  const saveSettingsLayoutMutation = useMutation({
    mutationFn: async (layout: SettingsLayoutItem[]) => {
      await apiRequest("PATCH", "/api/company", { settingsLayout: layout });
    },
    onSuccess: () => {
      settingsUserInteractedRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save layout", description: err.message, variant: "destructive" });
    },
  });

  const debouncedSaveSettingsLayout = useCallback((layout: SettingsLayoutItem[]) => {
    if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);
    settingsSaveTimerRef.current = setTimeout(() => {
      saveSettingsLayoutMutation.mutate(layout);
    }, 800);
  }, [saveSettingsLayoutMutation]);

  const handleSettingsLayoutChange = useCallback((_current: any, allLayouts: { [key: string]: any[] }) => {
    if (!settingsUserInteractedRef.current) return;
    const lgLayout = allLayouts.lg;
    if (!lgLayout || lgLayout.length === 0) return;
    const cleaned: SettingsLayoutItem[] = lgLayout.map((item: any) => ({
      i: item.i,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      minW: SETTINGS_BLOCK_DEFS.find(b => b.id === item.i)?.minW,
      minH: SETTINGS_BLOCK_DEFS.find(b => b.id === item.i)?.minH,
    }));
    const OWNER_ONLY_BLOCKS = ["audit_log"];
    const hiddenBlocks = currentSettingsLayout.filter(item =>
      OWNER_ONLY_BLOCKS.includes(item.i) && !cleaned.find(c => c.i === item.i)
    );
    const merged = [...cleaned, ...hiddenBlocks];
    setLocalSettingsLayout(merged);
    debouncedSaveSettingsLayout(merged);
  }, [debouncedSaveSettingsLayout, currentSettingsLayout]);

  const handleSettingsDragStart = useCallback(() => {
    settingsUserInteractedRef.current = true;
  }, []);

  const handleSettingsResizeStart = useCallback(() => {
    settingsUserInteractedRef.current = true;
  }, []);

  const handleResetSettingsLayout = useCallback(() => {
    const defaultLayout = generateDefaultSettingsLayout();
    setLocalSettingsLayout(defaultLayout);
    settingsUserInteractedRef.current = true;
    saveSettingsLayoutMutation.mutate(defaultLayout);
    toast({ title: "Settings reset to default layout" });
  }, [saveSettingsLayoutMutation]);

  const { uploadFile, isUploading } = useUpload({
    onSuccess: async (response) => {
      await apiRequest("PATCH", "/api/company", { logoUrl: response.objectPath });
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: "Logo uploaded", description: "Your company logo has been updated." });
    },
    onError: (error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companyFormSchema),
    values: {
      name: company?.name || "",
      email: company?.email || "",
      phone: company?.phone || "",
      address: company?.address || "",
      startAddress: company?.startAddress || "",
      startLatitude: company?.startLatitude || "",
      startLongitude: company?.startLongitude || "",
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: CompanyFormValues) => {
      const res = await apiRequest("PATCH", "/api/company", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: "Company updated", description: "Your company information has been saved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update company information.", variant: "destructive" });
    },
  });

  const MAX_LOGO_SIZE = 2 * 1024 * 1024;

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image file (PNG or JPG).", variant: "destructive" });
      return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      toast({ title: "File too large", description: "Logo must be under 2 MB. Please resize your image and try again.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
    await uploadFile(file);
  };

  const currentTier = company?.subscriptionTier as keyof typeof TIER_CONFIG | undefined;
  const tierInfo = currentTier ? TIER_CONFIG[currentTier] : null;

  const displayLogo = logoPreview || (company?.logoUrl ? company.logoUrl : null);

  const renderSettingsBlock = (blockId: string) => {
    switch (blockId) {
      case "company_logo":
        return (
          <Card className="h-full overflow-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Image className="h-5 w-5" />
                Company Logo
              </CardTitle>
              <CardDescription>Upload a logo to display on invoices and your portal</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-lg border-2 border-dashed border-muted-foreground/25 flex items-center justify-center overflow-hidden bg-muted/50">
                  {displayLogo ? (
                    <img src={displayLogo} alt="Company logo" className="w-full h-full object-cover rounded-lg" data-testid="img-company-logo" />
                  ) : (
                    <Building2 className="h-8 w-8 text-muted-foreground/50" />
                  )}
                </div>
                <div className="space-y-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    data-testid="button-upload-logo"
                  >
                    <Upload className="mr-1 h-4 w-4" />
                    {isUploading ? "Uploading..." : "Upload Logo"}
                  </Button>
                  <p className="text-xs text-muted-foreground">Recommended: 200x200px, PNG or JPG, max 2 MB</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      case "company_info":
        return (
          <Card className="h-full overflow-auto">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    Company Information
                  </CardTitle>
                  <CardDescription>Update your business details</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await apiRequest("POST", "/api/onboarding/business-step", { step: 0, data: null, resetWizard: true });
                    queryClient.invalidateQueries({ queryKey: ["/api/onboarding/business-status"] });
                    window.location.href = "/";
                  }}
                  data-testid="button-rerun-setup-wizard"
                >
                  <Rocket className="h-4 w-4 mr-1" />
                  Re-run Setup Wizard
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingCompany ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : (
                <Form {...form}>
                  <form onSubmit={form.handleSubmit((data) => updateMutation.mutate(data))} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Company Name</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input {...field} className="pl-10" data-testid="input-company-name" />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input {...field} type="email" className="pl-10" data-testid="input-company-email" />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input {...field} className="pl-10" data-testid="input-company-phone" />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Business Address</FormLabel>
                          <FormControl>
                            <Textarea {...field} rows={3} data-testid="input-company-address" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="pt-2 border-t">
                      <p className="text-sm font-medium mb-1">Route Starting Point</p>
                      <p className="text-xs text-muted-foreground mb-3">
                        Enter your home base address for route optimization. Routes will be ordered starting from this location.
                      </p>
                      <FormField
                        control={form.control}
                        name="startAddress"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Starting Address</FormLabel>
                            <FormControl>
                              <AddressAutocomplete
                                value={field.value || ""}
                                onChange={field.onChange}
                                onSelect={(addr) => {
                                  form.setValue("startAddress", `${addr.streetAddress}, ${addr.city}, ${addr.state} ${addr.zipCode}`);
                                  if (addr.latitude) form.setValue("startLatitude", String(addr.latitude));
                                  if (addr.longitude) form.setValue("startLongitude", String(addr.longitude));
                                }}
                                data-testid="input-start-address"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      {(form.watch("startLatitude") || form.watch("startLongitude")) && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Coordinates: {form.watch("startLatitude") || "—"}, {form.watch("startLongitude") || "—"}
                        </p>
                      )}
                    </div>
                    <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save-company">
                      <Save className="h-4 w-4 mr-2" />
                      {updateMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </form>
                </Form>
              )}
            </CardContent>
          </Card>
        );
      case "reminder_settings":
        return <div className="h-full overflow-auto"><ReminderSettingsSection company={company ?? null} toast={toast} /></div>;
      case "team_members":
        return (
          <Card className="h-full overflow-auto">
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Team Members
                  </CardTitle>
                  <CardDescription>
                    {team?.length || 0} / {tierInfo?.maxUsers || 1} seats used
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  onClick={() => setInviteDialogOpen(true)}
                  data-testid="button-invite-team-member"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Invite Team Member
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingTeam ? (
                <div className="space-y-3">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : (
                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {team?.map((member) => {
                    const RoleIcon = roleIcons[member.role] || Wrench;
                    const isCurrentUser = member.id === currentUser?.id;
                    const canRemove = !isCurrentUser && member.role !== "owner";
                    const canResetPassword = !isCurrentUser && member.role !== "owner" && (currentUser?.role === "owner" || (currentUser?.role === "admin" && member.role !== "admin"));
                    return (
                      <div
                        key={member.companyUserId}
                        className="flex items-center gap-3 p-3 rounded-md border"
                        data-testid={`card-team-member-${member.id}`}
                      >
                        <Avatar>
                          <AvatarImage src={member.profileImageUrl || undefined} />
                          <AvatarFallback>
                            {(member.firstName?.[0] || "").toUpperCase()}
                            {(member.lastName?.[0] || "").toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate" data-testid={`text-member-name-${member.id}`}>
                            {member.firstName} {member.lastName}
                          </p>
                          <p className="text-sm text-muted-foreground truncate">
                            {member.email}
                          </p>
                        </div>
                        <Badge variant="secondary" className="flex items-center gap-1" data-testid={`badge-member-role-${member.id}`}>
                          <RoleIcon className="h-3 w-3" />
                          {roleLabels[member.role] || member.role}
                        </Badge>
                        {canResetPassword && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                            onClick={() => setResetPasswordMember(member)}
                            title="Reset password"
                            data-testid={`button-reset-password-${member.id}`}
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                        )}
                        {canRemove && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setRemovingMemberId(member.id)}
                            data-testid={`button-remove-member-${member.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {(!team || team.length === 0) && (
                    <p className="text-sm text-muted-foreground text-center py-4">No team members yet</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      case "change_password":
        return (
          <Card className="h-full overflow-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Change Password
              </CardTitle>
              <CardDescription>Update your login password</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newPassword.length < 8) {
                    toast({ title: "Error", description: "Password must be at least 8 characters", variant: "destructive" });
                    return;
                  }
                  if (newPassword !== confirmNewPassword) {
                    toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
                    return;
                  }
                  changePasswordMutation.mutate();
                }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <label htmlFor="newPassword" className="text-sm font-medium">New Password</label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    minLength={8}
                    required
                    data-testid="input-new-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="confirmNewPassword" className="text-sm font-medium">Confirm New Password</label>
                  <Input
                    id="confirmNewPassword"
                    type="password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Confirm your new password"
                    minLength={8}
                    required
                    data-testid="input-confirm-new-password"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={changePasswordMutation.isPending || !newPassword || !confirmNewPassword}
                  data-testid="button-change-password"
                >
                  {changePasswordMutation.isPending ? "Updating..." : "Update Password"}
                </Button>
              </form>
            </CardContent>
          </Card>
        );
      case "data_import_export":
        return (
          <Card className="h-full overflow-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                Data Import / Export
              </CardTitle>
              <CardDescription>Import or export your contacts as a CSV file. The CSV should include columns for name, address, and service details.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open("/api/contacts/export/csv", "_blank")}
                  data-testid="button-export-csv"
                >
                  <Download className="mr-1 h-4 w-4" />
                  Export Contacts
                </Button>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setIsValidating(true);
                    try {
                      const text = await file.text();
                      const res = await apiRequest("POST", "/api/contacts/validate-csv", { csv: text });
                      const validation = await res.json();
                      setSettingsColumnMapping(validation.columnMapping);
                      setSettingsNewLeadSources(validation.newLeadSources);
                      setRawCsvRows(validation.rawRows);
                      setImportRows(validation.rows);
                      setImportStep("mapping");
                    } catch (err: any) {
                      toast({ title: "Validation failed", description: err.message, variant: "destructive" });
                    } finally {
                      setIsValidating(false);
                      if (csvInputRef.current) csvInputRef.current.value = "";
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => csvInputRef.current?.click()}
                  disabled={isValidating}
                  data-testid="button-import-csv"
                >
                  <Upload className="mr-1 h-4 w-4" />
                  {isValidating ? "Validating..." : "Import Contacts"}
                </Button>
              </div>
              <div className="border-t pt-3">
                <p className="text-sm text-muted-foreground mb-2">Need a template? Download an import template with the correct column headers and example data.</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open("/api/contacts/sample-csv", "_blank")}
                  data-testid="button-download-sample-csv"
                >
                  <FileDown className="mr-1 h-4 w-4" />
                  Download Import Template
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      case "subscription":
        return (
          <Card className="h-full overflow-auto">
            <CardHeader>
              <CardTitle className="text-base">Subscription</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingCompany ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="font-semibold" data-testid="text-settings-tier">{tierInfo?.name || "Unknown"}</p>
                    <p className="text-sm text-muted-foreground">${tierInfo?.price?.toFixed(2) || "0.00"}/month</p>
                  </div>
                  <Badge
                    variant={company?.subscriptionStatus === "active" ? "default" : "secondary"}
                    data-testid="badge-subscription-status"
                  >
                    {company?.subscriptionStatus || "unknown"}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        );
      case "stripe_connect":
        return <div className="h-full overflow-auto"><StripeConnectSection /></div>;
      case "venmo":
        return <div className="h-full overflow-auto"><VenmoSection company={company} /></div>;
      case "quickbooks":
        return <div className="h-full overflow-auto"><QuickBooksSection /></div>;
      case "voice_api_docs":
        return <div className="h-full overflow-auto"><VoiceApiDocsSection /></div>;
      case "call_tracking":
        return <div className="h-full overflow-auto"><CallTrackingSection /></div>;
      case "voice_agent":
        return <VoiceAgentSection company={company ?? null} />;
      case "signup_widget":
        return <div className="h-full overflow-auto"><SignupWidgetSection company={company ? { slug: company.slug, name: company.name, quoteFormLayout: company.quoteFormLayout || "stepper" } : null} /></div>;
      case "webhook_lead":
        return <div className="h-full overflow-auto"><WebhookLeadSection /></div>;
      case "sms_quote_template":
        return <div className="h-full overflow-auto"><SmsQuoteTemplateSection company={company ?? null} /></div>;
      case "quote_auto_follow_up":
        return <div className="h-full overflow-auto"><QuoteAutoFollowUpSection company={company ?? null} /></div>;
      case "google_reviews":
        return <div className="h-full overflow-auto"><GoogleReviewsSection company={company ?? null} /></div>;
      case "auto_visit_generation":
        return (
          <Card className="h-full overflow-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5" />
                Auto Visit Generation
              </CardTitle>
              <CardDescription>Automatically generate visits for the next 7 days based on active jobs. Runs daily.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Enable auto visit generation</p>
                  <p className="text-xs text-muted-foreground">
                    When enabled, visits will be created automatically each day for the upcoming week based on your active jobs.
                  </p>
                </div>
                <Switch
                  checked={company?.autoVisitsEnabled ?? false}
                  onCheckedChange={(checked) => toggleAutoVisitsMutation.mutate(checked)}
                  disabled={toggleAutoVisitsMutation.isPending}
                  data-testid="switch-auto-visits"
                />
              </div>
            </CardContent>
          </Card>
        );
      case "lead_sources":
        return (
          <Card className="h-full overflow-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5" />
                Lead Sources
              </CardTitle>
              <CardDescription>Manage the lead sources available in contact forms. These are used to track where your clients come from.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingLeadSources ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto pr-1">
                    {leadSources.map((source) => (
                      <Badge key={source.id} variant="secondary" className="flex items-center gap-1 pr-1" data-testid={`badge-lead-source-${source.id}`}>
                        {source.name}
                        <button
                          onClick={() => deleteLeadSourceMutation.mutate(source.id)}
                          className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                          data-testid={`button-delete-lead-source-${source.id}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                    {leadSources.length === 0 && (
                      <p className="text-sm text-muted-foreground">No lead sources configured.</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={newLeadSourceName}
                      onChange={(e) => setNewLeadSourceName(e.target.value)}
                      placeholder="Add a lead source..."
                      className="flex-1"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newLeadSourceName.trim()) {
                          e.preventDefault();
                          addLeadSourceMutation.mutate(newLeadSourceName.trim());
                        }
                      }}
                      data-testid="input-new-lead-source"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => newLeadSourceName.trim() && addLeadSourceMutation.mutate(newLeadSourceName.trim())}
                      disabled={!newLeadSourceName.trim() || addLeadSourceMutation.isPending}
                      data-testid="button-add-lead-source"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        );
      case "developer_tools":
        return (
          <Card className="h-full overflow-auto">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Code2 className="h-5 w-5" />
                Developer Tools
              </CardTitle>
              <CardDescription>API access, webhooks, and data migration tools.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { href: "/api-keys", icon: KeyRound, label: "API Keys", description: "Manage API keys for external integrations" },
                { href: "/webhooks", icon: Webhook, label: "Webhooks", description: "Configure event webhook endpoints" },
                { href: "/migration", icon: Database, label: "Data Migration", description: "Import data from other services" },
              ].map(({ href, icon: Icon, label, description }) => (
                <Link key={href} href={href}>
                  <div className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer" data-testid={`link-dev-${label.toLowerCase().replace(/\s/g, "-")}`}>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium leading-none">{label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                      </div>
                    </div>
                    <ChevronRightIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                </Link>
              ))}
              {(currentUser?.role === "owner" || currentUser?.role === "admin") && (
                <>
                  <div className="rounded-lg border p-3 space-y-2" data-testid="card-geocode-usage">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-medium leading-none">Geocode API Usage</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Mapbox calls used today and this week</p>
                        </div>
                      </div>
                      {geocodeUsageQuery.data?.isOverThreshold && (
                        <Badge variant="destructive" className="shrink-0 gap-1" data-testid="badge-geocode-over-threshold">
                          <AlertTriangle className="h-3 w-3" />
                          Over limit
                        </Badge>
                      )}
                    </div>
                    {geocodeUsageQuery.isLoading ? (
                      <div className="flex gap-4 pt-1">
                        <Skeleton className="h-8 w-24" />
                        <Skeleton className="h-8 w-24" />
                      </div>
                    ) : geocodeUsageQuery.data ? (
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className={`rounded-md p-2 text-center ${geocodeUsageQuery.data.isOverThreshold ? "bg-destructive/10 border border-destructive/30" : "bg-muted/50"}`} data-testid="stat-geocode-today">
                          <p className={`text-lg font-semibold tabular-nums ${geocodeUsageQuery.data.isOverThreshold ? "text-destructive" : ""}`}>
                            {geocodeUsageQuery.data.today.toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground">Today</p>
                          <p className="text-xs text-muted-foreground">
                            of {geocodeUsageQuery.data.dailyThreshold.toLocaleString()} limit
                          </p>
                        </div>
                        <div className="rounded-md bg-muted/50 p-2 text-center" data-testid="stat-geocode-week">
                          <p className="text-lg font-semibold tabular-nums">{geocodeUsageQuery.data.thisWeek.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">This week</p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium leading-none">Re-geocode Missing Addresses</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Retry geocoding for properties that could not be located</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => geocodeAllMutation.mutate()}
                      disabled={geocodeAllMutation.isPending}
                      data-testid="button-regeocode-addresses"
                    >
                      {geocodeAllMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      <span className="ml-1.5">{geocodeAllMutation.isPending ? "Running..." : "Run"}</span>
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        );
      case "audit_log":
        return currentUser?.role === "owner"
          ? <div className="h-full overflow-auto"><AuditLogSection /></div>
          : null;
      case "demo_mode":
        return (
          <Card className="h-full overflow-auto">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Demo Mode
              </CardTitle>
              <CardDescription>Automation tools for the demo@scoopilot.com account</CardDescription>
            </CardHeader>
            <CardContent>
              <DemoModeSection />
            </CardContent>
          </Card>
        );
      case "billing_defaults":
        return (
          <Card className="h-full overflow-auto">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Billing Defaults
              </CardTitle>
              <CardDescription>Set system-wide defaults for billing cadence, invoice trigger, and payment behavior. These apply to all services unless overridden at the service or customer level.</CardDescription>
            </CardHeader>
            <CardContent>
              <BillingDefaultsSection company={company} />
            </CardContent>
          </Card>
        );
      case "client_notifications":
        return (
          <Card className="h-full overflow-auto">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Client Notifications
              </CardTitle>
              <CardDescription>Control when emails are sent to your clients.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Import Mode toggle */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Import Mode</p>
                    <p className="text-xs text-muted-foreground">
                      Suppress all client emails (portal invites, invoices, reminders) while you're entering your existing clients. Turn this off when you're ready to go live.
                    </p>
                  </div>
                  <Switch
                    checked={company?.clientNotificationsSuppressed ?? false}
                    onCheckedChange={(checked) => toggleImportModeMutation.mutate(checked)}
                    disabled={toggleImportModeMutation.isPending}
                    data-testid="switch-import-mode"
                  />
                </div>
                {company?.clientNotificationsSuppressed && (
                  <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Import Mode is ON — no emails are being sent to clients
                  </div>
                )}
              </div>

              {/* Onboarding Complete */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="space-y-1">
                  <p className="text-sm font-semibold">Onboarding Complete</p>
                  <p className="text-xs text-muted-foreground">
                    When you're done importing clients, send each active client a consolidated welcome email with their portal credentials, service day, frequency, price per visit, and next scheduled visit. This can only be sent once and will also disable Import Mode.
                  </p>
                </div>
                {company?.onboardingCompleteSentAt ? (
                  <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md px-3 py-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    Welcome emails sent on {new Date(company.onboardingCompleteSentAt).toLocaleDateString()}
                  </div>
                ) : (
                  <Button
                    onClick={() => { setOnboardingResults(null); setShowOnboardingDialog(true); }}
                    variant="outline"
                    size="sm"
                    className="w-full"
                    data-testid="button-onboarding-complete"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Send Welcome Emails to All Active Clients
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      default:
        return null;
    }
  };

  return (
    <div className="p-4 md:p-6 overflow-auto h-full">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-settings-heading">Settings</h1>
          {!isMobile && (
            <span className="text-xs text-muted-foreground">Drag to reorder, resize from corners</span>
          )}
        </div>
        {!isMobile && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetSettingsLayout}
            data-testid="button-reset-settings-layout"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reset to Default Layout
          </Button>
        )}
      </div>

      {isMobile ? (
        <div className="space-y-4">
          {DEFAULT_SETTINGS_BLOCK_IDS
            .filter(id => id !== "audit_log" || currentUser?.role === "owner")
            .map(id => {
              const content = renderSettingsBlock(id);
              if (!content) return null;
              return <div key={id}>{content}</div>;
            })}
        </div>
      ) : (
        <div ref={gridContainerRef as any}>
          {gridWidth > 0 && (
            <ResponsiveGridLayout
              className="layout"
              layouts={settingsGridLayouts}
              breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
              cols={{ lg: 12, md: 12, sm: 6, xs: 1 }}
              rowHeight={60}
              width={gridWidth}
              dragConfig={{ enabled: true, handle: ".settings-drag-handle" }}
              resizeConfig={{ enabled: true }}
              onLayoutChange={handleSettingsLayoutChange as any}
              onDragStart={handleSettingsDragStart}
              onResizeStart={handleSettingsResizeStart}
              margin={[16, 16]}
            >
              {currentSettingsLayout
                .filter(item => item.i !== "audit_log" || currentUser?.role === "owner")
                .map(item => {
                  const content = renderSettingsBlock(item.i);
                  if (!content) return null;
                  return (
                    <div key={item.i} className="relative group" data-testid={`settings-block-${item.i}`}>
                      <div className="settings-drag-handle absolute top-1 left-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing p-1 rounded bg-background/80 backdrop-blur-sm border shadow-sm">
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      {content}
                    </div>
                  );
                })}
            </ResponsiveGridLayout>
          )}
        </div>
      )}


      {/* Onboarding Welcome Email Preview / Results Dialog */}
      <Dialog open={showOnboardingDialog} onOpenChange={(open) => { if (!open) { setShowOnboardingDialog(false); setOnboardingResults(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{onboardingResults ? "Welcome Emails Sent" : "Send Welcome Emails"}</DialogTitle>
          </DialogHeader>
          {onboardingResults ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md px-3 py-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Sent to {onboardingResults.sent} of {onboardingResults.total} clients.{onboardingResults.skipped > 0 ? ` ${onboardingResults.skipped} skipped.` : ""} Import Mode is now off.
              </div>
              {onboardingResults.results.length > 0 && (
                <div className="max-h-56 overflow-y-auto border rounded-md divide-y text-sm">
                  {onboardingResults.results.map((r, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 gap-2">
                      <div>
                        <p className="font-medium">{r.name}</p>
                        <p className="text-xs text-muted-foreground">{r.email}</p>
                      </div>
                      <span className={r.status === "sent" ? "text-xs text-green-600" : "text-xs text-muted-foreground"}>{r.status}</span>
                    </div>
                  ))}
                </div>
              )}
              <DialogFooter>
                <Button onClick={() => { setShowOnboardingDialog(false); setOnboardingResults(null); }} data-testid="button-onboarding-done">Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This will send a one-time welcome email to every active client with an email address, including their portal login, service day, frequency, price per visit, and next scheduled visit. Import Mode will be turned off after sending.
              </p>
              {onboardingPreviewQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : onboardingPreviewQuery.data ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{onboardingPreviewQuery.data.count} client{onboardingPreviewQuery.data.count !== 1 ? "s" : ""} will receive an email:</p>
                  {onboardingPreviewQuery.data.count === 0 ? (
                    <p className="text-xs text-muted-foreground">No active clients with email addresses found.</p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto border rounded-md divide-y text-sm">
                      {onboardingPreviewQuery.data.contacts.map(c => (
                        <div key={c.id} className="flex items-center justify-between px-3 py-2 gap-2">
                          <span className="font-medium">{c.name}</span>
                          <span className="text-xs text-muted-foreground truncate">{c.email}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
              <DialogFooter className="flex gap-2">
                <Button variant="outline" onClick={() => setShowOnboardingDialog(false)} data-testid="button-onboarding-cancel">Cancel</Button>
                <Button
                  onClick={() => sendOnboardingWelcomeMutation.mutate()}
                  disabled={sendOnboardingWelcomeMutation.isPending || onboardingPreviewQuery.data?.count === 0}
                  data-testid="button-onboarding-confirm"
                >
                  {sendOnboardingWelcomeMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending...</> : <><Send className="h-4 w-4 mr-2" />Send Welcome Emails</>}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={importStep !== "idle"} onOpenChange={(open) => { if (!open) { setImportStep("idle"); setImportRows([]); setRawCsvRows([]); setSettingsColumnMapping([]); setSettingsNewLeadSources([]); } }}>
        <DialogContent className="max-w-[95vw] w-[900px] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {importStep === "mapping" ? "Map Columns" : "Review & Edit Contacts"}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              {importStep === "mapping"
                ? "Verify how your CSV columns map to contact fields. Adjust any mismatched mappings."
                : `${importRows.length} contact${importRows.length !== 1 ? "s" : ""} ready to import. Edit any field, or remove rows you don't want.`}
            </p>
          </DialogHeader>

          {importStep === "mapping" && (
            <div className="space-y-4 overflow-y-auto flex-1">
              <div className="grid gap-2">
                {settingsColumnMapping.map((col, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-2 rounded-md bg-muted/30">
                    <div className="w-[200px] text-sm font-medium truncate" title={col.csvHeader}>
                      {col.csvHeader}
                    </div>
                    <span className="text-muted-foreground text-sm">-&gt;</span>
                    <Select
                      value={col.mappedField || "__skip__"}
                      onValueChange={(v) => {
                        const updated = [...settingsColumnMapping];
                        updated[idx] = { ...updated[idx], mappedField: v === "__skip__" ? "" : v };
                        setSettingsColumnMapping(updated);
                      }}
                    >
                      <SelectTrigger className="w-[200px]" data-testid={`select-mapping-${idx}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">-- Skip this column --</SelectItem>
                        {CONTACT_FIELDS.map(f => (
                          <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {col.mappedField ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                  </div>
                ))}
              </div>

              {settingsNewLeadSources.length > 0 && (
                <div className="border rounded-md p-3 space-y-1 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">New Lead Sources</p>
                  <p className="text-xs text-muted-foreground">These will be added to your lead sources list:</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {settingsNewLeadSources.map((s) => (
                      <Badge key={s} variant="outline" className="text-amber-700 dark:text-amber-400 border-amber-300">{s}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {importStep === "review" && (
            <div className="flex-1 overflow-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="p-2 text-left font-medium w-8">#</th>
                    {CONTACT_FIELDS.filter(f => importRows.some(r => r[f.key])).map(f => (
                      <th key={f.key} className="p-2 text-left font-medium whitespace-nowrap">{f.label}</th>
                    ))}
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {importRows.map((row, rowIdx) => {
                    const hasName = row.firstName && row.lastName;
                    const visibleFields = CONTACT_FIELDS.filter(f => importRows.some(r => r[f.key]));
                    return (
                      <tr
                        key={rowIdx}
                        className={`border-t ${!hasName ? "bg-destructive/5" : ""}`}
                      >
                        <td className="p-2 text-muted-foreground">{rowIdx + 1}</td>
                        {visibleFields.map(f => (
                          <td key={f.key} className="p-1">
                            <Input
                              value={row[f.key] || ""}
                              onChange={(e) => {
                                const updated = [...importRows];
                                updated[rowIdx] = { ...updated[rowIdx], [f.key]: e.target.value };
                                setImportRows(updated);
                              }}
                              className={`h-8 text-xs ${(f.key === "firstName" || f.key === "lastName") && !row[f.key] ? "border-destructive" : ""}`}
                            />
                          </td>
                        ))}
                        <td className="p-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            onClick={() => setImportRows(importRows.filter((_, i) => i !== rowIdx))}
                          >
                            X
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {importRows.length === 0 && (
                <div className="p-8 text-center text-muted-foreground">
                  All rows have been removed. Cancel to start over.
                </div>
              )}
            </div>
          )}

          {importStep === "review" && (() => {
            const missingNames = importRows.filter(r => !r.firstName || !r.lastName);
            return missingNames.length > 0 ? (
              <div className="border rounded-md p-3 space-y-1 border-destructive/50 bg-destructive/5 flex-shrink-0">
                <p className="text-sm font-medium text-destructive">{missingNames.length} row{missingNames.length !== 1 ? "s" : ""} missing required fields</p>
                <p className="text-xs text-muted-foreground">Rows without a first and last name will be skipped. Edit them above or remove them.</p>
              </div>
            ) : null;
          })()}

          <DialogFooter className="gap-2 flex-shrink-0">
            <Button variant="outline" onClick={() => { setImportStep("idle"); setImportRows([]); setRawCsvRows([]); setSettingsColumnMapping([]); setSettingsNewLeadSources([]); }} data-testid="button-cancel-import">
              Cancel
            </Button>
            {importStep === "mapping" && (
              <Button
                onClick={() => {
                  const remapped = rawCsvRows.map(values => {
                    const row: ImportRow = {};
                    settingsColumnMapping.forEach((col, idx) => {
                      if (col.mappedField) {
                        row[col.mappedField] = values[idx] || "";
                      }
                    });
                    return row;
                  });
                  setImportRows(remapped);
                  setImportStep("review");
                }}
                data-testid="button-continue-to-review"
              >
                Continue to Review
              </Button>
            )}
            {importStep === "review" && (
              <>
                <Button variant="outline" onClick={() => setImportStep("mapping")}>
                  Back
                </Button>
                <Button
                  disabled={isImporting || importRows.filter(r => r.firstName && r.lastName).length === 0}
                  onClick={async () => {
                    setIsImporting(true);
                    try {
                      const validRows = importRows.filter(r => r.firstName && r.lastName);
                      const res = await apiRequest("POST", "/api/contacts/import/json", { rows: validRows });
                      const result = await res.json();
                      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
                      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
                      queryClient.invalidateQueries({ queryKey: ["/api/lead-sources"] });
                      let description = `${result.imported} contact${result.imported !== 1 ? "s" : ""} imported successfully.`;
                      if (result.addedLeadSources?.length) {
                        description += ` ${result.addedLeadSources.length} new lead source${result.addedLeadSources.length !== 1 ? "s" : ""} added.`;
                      }
                      if (result.errors?.length) {
                        description += ` ${result.errors.length} row(s) had issues.`;
                      }
                      toast({ title: "Import complete", description });
                      setImportStep("idle");
                      setImportRows([]);
                      setRawCsvRows([]);
                      setSettingsColumnMapping([]);
                      setSettingsNewLeadSources([]);
                    } catch (err: any) {
                      toast({ title: "Import failed", description: err.message, variant: "destructive" });
                    } finally {
                      setIsImporting(false);
                    }
                  }}
                  data-testid="button-confirm-import"
                >
                  {isImporting ? "Importing..." : `Import ${importRows.filter(r => r.firstName && r.lastName).length} Contacts`}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">First Name</label>
                <Input
                  value={inviteFirstName}
                  onChange={(e) => setInviteFirstName(e.target.value)}
                  placeholder="First name"
                  data-testid="input-invite-first-name"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Last Name</label>
                <Input
                  value={inviteLastName}
                  onChange={(e) => setInviteLastName(e.target.value)}
                  placeholder="Last name"
                  data-testid="input-invite-last-name"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@example.com"
                data-testid="input-invite-email"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Role</label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger data-testid="select-invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tech">Technician</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!inviteEmail || !inviteFirstName || inviteMutation.isPending}
              onClick={() => inviteMutation.mutate({ email: inviteEmail, firstName: inviteFirstName, lastName: inviteLastName, role: inviteRole })}
              data-testid="button-confirm-invite"
            >
              {inviteMutation.isPending ? "Sending..." : "Send Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removingMemberId} onOpenChange={(open) => !open && setRemovingMemberId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Team Member</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to remove this team member? They will lose access to the company and be unassigned from any routes.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemovingMemberId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={removeMemberMutation.isPending}
              onClick={() => removingMemberId && removeMemberMutation.mutate(removingMemberId)}
              data-testid="button-confirm-remove-member"
            >
              {removeMemberMutation.isPending ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetPasswordMember} onOpenChange={(open) => { if (!open) { setResetPasswordMember(null); setResetNewPassword(""); setResetConfirmPassword(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Set a new password for {resetPasswordMember?.firstName} {resetPasswordMember?.lastName} ({resetPasswordMember?.email}).
          </p>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">New Password</label>
              <Input
                type="password"
                value={resetNewPassword}
                onChange={(e) => setResetNewPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                data-testid="input-reset-new-password"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Confirm Password</label>
              <Input
                type="password"
                value={resetConfirmPassword}
                onChange={(e) => setResetConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                data-testid="input-reset-confirm-password"
              />
            </div>
            {resetNewPassword && resetConfirmPassword && resetNewPassword !== resetConfirmPassword && (
              <p className="text-sm text-destructive">Passwords do not match</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetPasswordMember(null); setResetNewPassword(""); setResetConfirmPassword(""); }}>Cancel</Button>
            <Button
              disabled={!resetNewPassword || resetNewPassword.length < 8 || resetNewPassword !== resetConfirmPassword || resetMemberPasswordMutation.isPending}
              onClick={() => resetPasswordMember && resetMemberPasswordMutation.mutate({ userId: resetPasswordMember.id, newPassword: resetNewPassword })}
              data-testid="button-confirm-reset-password"
            >
              {resetMemberPasswordMutation.isPending ? "Updating..." : "Update Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

