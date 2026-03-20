import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Building2, Users, Mail, Phone, MapPin, Save, Shield, Wrench, Crown, Upload, Image, Download, FileSpreadsheet, FileDown, Plus, X, AlertTriangle, CheckCircle2, Info, KeyRound, CalendarClock, Bell, CreditCard, ExternalLink, Unlink, Loader2 } from "lucide-react";
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
import { Globe, Copy, Check, Link2 } from "lucide-react";

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
  subscriptionTier: string;
  subscriptionStatus: string;
  autoVisitsEnabled: boolean;
  remindersEnabled: boolean;
  roverAiEnabled: boolean;
  timezone: string;
};

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

type ValidationResult = {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  issues: { row: number; field: string; message: string }[];
  newLeadSources: string[];
  headers: string[];
  columnMapping: ColumnMapping[];
  rows: ImportRow[];
};

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

            {status === "not_started" && (
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

            {status === "pending" && (
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

            {status === "connected" && (
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
        )}
      </CardContent>
    </Card>
  );
}

function SignupWidgetSection({ company }: { company: { slug: string | null; name: string } | null }) {
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

  const baseUrl = window.location.origin;
  const signupUrl = company?.slug ? `${baseUrl}/signup/${company.slug}` : "";
  const iframeSnippet = company?.slug
    ? `<iframe src="${signupUrl}" width="100%" height="700" frameborder="0" style="border:none;max-width:500px;"></iframe>`
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
              <div className="flex gap-2">
                <Input value={iframeSnippet} readOnly className="text-sm font-mono" data-testid="input-embed-code" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(iframeSnippet, "Embed code")}
                  data-testid="button-copy-embed-code"
                >
                  {copied === "Embed code" ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Paste this HTML into your website to embed the signup form.
              </p>
            </div>

            <Button variant="outline" size="sm" asChild data-testid="button-preview-signup">
              <a href={signupUrl} target="_blank" rel="noopener noreferrer">
                <Link2 className="h-4 w-4 mr-2" />
                Preview Signup Page
              </a>
            </Button>
          </div>
        )}
      </CardContent>
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [rawCsvRows, setRawCsvRows] = useState<string[][]>([]);
  const [settingsColumnMapping, setSettingsColumnMapping] = useState<ColumnMapping[]>([]);
  const [settingsNewLeadSources, setSettingsNewLeadSources] = useState<string[]>([]);
  const [isValidating, setIsValidating] = useState(false);

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

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
      <h1 className="text-2xl font-bold" data-testid="text-settings-heading">Settings</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Company Information
              </CardTitle>
              <CardDescription>Update your business details</CardDescription>
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

          <ReminderSettingsSection company={company} toast={toast} />

        </div>

        <div className="space-y-6">
          <Card>
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
                <div className="space-y-3">
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

          <Card>
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

          <StripeConnectSection />

          <SignupWidgetSection company={company ? { slug: company.slug, name: company.name } : null} />

          <Card>
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

          <Card>
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

          <Card>
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

          <Card>
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
                  <div className="flex flex-wrap gap-2">
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
        </div>
      </div>

      {currentUser?.role === "owner" && <AuditLogSection />}

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

