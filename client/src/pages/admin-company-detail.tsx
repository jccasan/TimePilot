import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ArrowLeft, Building2, Users, Contact2, FileText, StickyNote, Trash2, KeyRound, Copy, Eye, EyeOff, Mail, Send, Pencil, Check, X, MessageSquare, Phone, Activity, Download, Clock, Filter, Database, FlaskConical, XCircle } from "lucide-react";
import { TIER_CONFIG } from "@shared/schema";
import { useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { adminFetchFn, adminRequest } from "@/lib/adminApi";
import { useToast } from "@/hooks/use-toast";

interface UsageData {
  periodStart: string;
  smsSegments: number;
  voiceMinutes: number;
  activeUsers: number;
  maxUsers: number;
  apiCalls: number;
  messagesSent: number;
  totalContacts: number;
  totalVisits: number;
}

interface AuditLogEntry {
  id: string;
  userId: string | null;
  userEmail: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changes: any;
  ipAddress: string | null;
  createdAt: string;
}

const entityTypeLabels: Record<string, string> = {
  invoice: "Invoice",
  service_plan: "Service Plan",
  api_key: "API Key",
  webhook: "Webhook",
  contact: "Contact",
  company: "Company",
  user: "User",
};

const actionLabels: Record<string, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  void: "Voided",
};

const actionColors: Record<string, string> = {
  create: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  update: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  delete: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  void: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

export default function AdminCompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [noteText, setNoteText] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ userId: string; email: string; name: string } | null>(null);
  const [customPassword, setCustomPassword] = useState("");
  const [useCustomPassword, setUseCustomPassword] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [editingCompany, setEditingCompany] = useState(false);
  const [companyForm, setCompanyForm] = useState({ name: "", email: "", phone: "", address: "" });

  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editUserTarget, setEditUserTarget] = useState<{ userId: string; firstName: string; lastName: string; email: string; role: string } | null>(null);

  const [auditPage, setAuditPage] = useState(0);
  const [auditFilter, setAuditFilter] = useState<string>("");
  const auditPageSize = 20;

  const [activeTab, setActiveTab] = useState<"overview" | "audit">("overview");

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const [customTrialOpen, setCustomTrialOpen] = useState(false);
  const defaultTrialDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().split("T")[0];
  };
  const [trialForm, setTrialForm] = useState({
    tier: "tier_10_plus",
    subscriptionStatus: "trialing",
    trialEndsAt: defaultTrialDate(),
    customMaxUsers: "3",
  });

  const { data: company, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/companies", id],
    queryFn: adminFetchFn(`/api/admin/companies/${id}`),
  });

  const { data: usage } = useQuery<UsageData>({
    queryKey: ["/api/admin/companies", id, "usage"],
    queryFn: adminFetchFn(`/api/admin/companies/${id}/usage`),
    enabled: !!id,
  });

  const { data: voiceCalls } = useQuery<any[]>({
    queryKey: ["/api/admin/companies", id, "voice-calls"],
    queryFn: adminFetchFn(`/api/admin/companies/${id}/voice-calls?limit=20`),
    enabled: !!id,
  });

  const { data: auditData, isLoading: auditLoading } = useQuery<{ logs: AuditLogEntry[]; total: number }>({
    queryKey: ["/api/admin/companies", id, "audit-logs", auditPage, auditFilter],
    queryFn: adminFetchFn(`/api/admin/companies/${id}/audit-logs?limit=${auditPageSize}&offset=${auditPage * auditPageSize}${auditFilter ? `&entityType=${auditFilter}` : ""}`),
    enabled: activeTab === "audit",
  });

  const tierMutation = useMutation({
    mutationFn: async (tier: string) => {
      return adminRequest("PATCH", `/api/admin/companies/${id}/subscription`, { tier });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Subscription updated" });
    },
  });

  const customTrialMutation = useMutation({
    mutationFn: async (form: typeof trialForm) => {
      const seats = parseInt(form.customMaxUsers);
      return adminRequest("PATCH", `/api/admin/companies/${id}/subscription`, {
        tier: form.tier,
        subscriptionStatus: form.subscriptionStatus,
        trialEndsAt: form.trialEndsAt ? new Date(form.trialEndsAt).toISOString() : null,
        customMaxUsers: isNaN(seats) ? null : seats,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setCustomTrialOpen(false);
      toast({ title: "Custom trial plan applied" });
    },
    onError: () => toast({ title: "Failed to apply trial plan", variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (reason: string) => {
      return adminRequest("POST", `/api/admin/companies/${id}/cancel`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setCancelOpen(false);
      setCancelReason("");
      toast({ title: "Account cancelled", description: "Subscription has been cancelled and Stripe notified." });
    },
    onError: (err: any) => toast({ title: "Cancel failed", description: err.message, variant: "destructive" }),
  });

  const addNoteMutation = useMutation({
    mutationFn: async (content: string) => {
      return adminRequest("POST", `/api/admin/companies/${id}/notes`, { content });
    },
    onSuccess: () => {
      setNoteText("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies", id] });
      toast({ title: "Note added" });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      return adminRequest("DELETE", `/api/admin/notes/${noteId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies", id] });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: string; newPassword?: string }) => {
      const res = await adminRequest("POST", `/api/admin/companies/${id}/users/${userId}/reset-password`, {
        newPassword: newPassword || undefined,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to reset password");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedPassword(data.tempPassword);
      toast({ title: "Password updated", description: `New password set for ${data.email}. They will be prompted to change it on next login.` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to reset password", description: error.message, variant: "destructive" });
    },
  });

  const sendResetEmailMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await adminRequest("POST", `/api/admin/companies/${id}/users/${userId}/send-reset-email`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send reset email");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Password reset email sent", description: `Reset link sent to ${data.email}` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send email", description: error.message, variant: "destructive" });
    },
  });

  const sendCredentialsMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await adminRequest("POST", `/api/admin/companies/${id}/users/${userId}/send-credentials`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send credentials");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Credentials sent", description: `Login credentials emailed to ${data.email}` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send credentials", description: error.message, variant: "destructive" });
    },
  });

  const updateCompanyMutation = useMutation({
    mutationFn: async (updates: Record<string, string>) => {
      const res = await adminRequest("PATCH", `/api/admin/companies/${id}`, updates);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update company");
      }
      return res.json();
    },
    onSuccess: () => {
      setEditingCompany(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      toast({ title: "Company updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update company", description: error.message, variant: "destructive" });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, updates }: { userId: string; updates: Record<string, string> }) => {
      const res = await adminRequest("PATCH", `/api/admin/companies/${id}/users/${userId}`, updates);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update user");
      }
      return res.json();
    },
    onSuccess: () => {
      setEditUserOpen(false);
      setEditUserTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies", id] });
      toast({ title: "User updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update user", description: error.message, variant: "destructive" });
    },
  });

  const handleResetPassword = () => {
    if (!resetTarget) return;
    resetPasswordMutation.mutate({
      userId: resetTarget.userId,
      newPassword: useCustomPassword && customPassword.length >= 8 ? customPassword : undefined,
    });
  };

  const handleCloseResetDialog = () => {
    setResetOpen(false);
    setResetTarget(null);
    setCustomPassword("");
    setUseCustomPassword(false);
    setGeneratedPassword(null);
    setShowPassword(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const startEditingCompany = () => {
    setCompanyForm({
      name: company?.name || "",
      email: company?.email || "",
      phone: company?.phone || "",
      address: company?.address || "",
    });
    setEditingCompany(true);
  };

  const handleSaveCompany = () => {
    const updates: Record<string, string> = {};
    if (companyForm.name !== (company?.name || "")) updates.name = companyForm.name;
    if (companyForm.email !== (company?.email || "")) updates.email = companyForm.email;
    if (companyForm.phone !== (company?.phone || "")) updates.phone = companyForm.phone;
    if (companyForm.address !== (company?.address || "")) updates.address = companyForm.address;
    if (Object.keys(updates).length === 0) {
      setEditingCompany(false);
      return;
    }
    updateCompanyMutation.mutate(updates);
  };

  const openEditUser = (u: any) => {
    setEditUserTarget({
      userId: u.userId,
      firstName: u.firstName || "",
      lastName: u.lastName || "",
      email: u.email || "",
      role: u.role || "owner",
    });
    setEditUserOpen(true);
  };

  const handleSaveUser = () => {
    if (!editUserTarget) return;
    const original = company?.users?.find((u: any) => u.userId === editUserTarget.userId);
    const updates: Record<string, string> = {};
    if (editUserTarget.firstName !== (original?.firstName || "")) updates.firstName = editUserTarget.firstName;
    if (editUserTarget.lastName !== (original?.lastName || "")) updates.lastName = editUserTarget.lastName;
    if (editUserTarget.email !== (original?.email || "")) updates.email = editUserTarget.email;
    if (editUserTarget.role !== (original?.role || "")) updates.role = editUserTarget.role;
    if (Object.keys(updates).length === 0) {
      setEditUserOpen(false);
      setEditUserTarget(null);
      return;
    }
    updateUserMutation.mutate({ userId: editUserTarget.userId, updates });
  };

  const handleExport = async () => {
    try {
      const token = localStorage.getItem("admin_token");
      const res = await fetch(`/api/admin/companies/${id}/export`, {
        headers: { "x-admin-token": token || "" },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tenant-export-${id}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export downloaded" });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  };

  if (isLoading) {
    return <div className="p-6 text-center text-muted-foreground">Loading...</div>;
  }

  if (!company) {
    return <div className="p-6 text-center text-muted-foreground">Company not found</div>;
  }

  const totalAuditPages = auditData ? Math.ceil(auditData.total / auditPageSize) : 0;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid="admin-company-detail">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/admin">
            <Button variant="ghost" size="icon" data-testid="button-back-admin">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-company-name">{company.name}</h1>
            <p className="text-sm text-muted-foreground">{company.id}</p>
          </div>
        </div>
        <Button variant="outline" onClick={handleExport} data-testid="button-export-data">
          <Download className="h-4 w-4 mr-1.5" />
          Export Data
        </Button>
      </div>

      <div className="flex gap-2 border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "overview" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => setActiveTab("overview")}
          data-testid="tab-overview"
        >
          Overview
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "audit" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => { setActiveTab("audit"); setAuditPage(0); }}
          data-testid="tab-audit"
        >
          Audit Log
        </button>
      </div>

      {activeTab === "overview" && (
        <>
          {usage && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="usage-dashboard">
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">SMS Segments</span>
                  </div>
                  <p className="text-2xl font-bold" data-testid="text-usage-sms">{usage.smsSegments}</p>
                  <p className="text-xs text-muted-foreground">This month</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Phone className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">Voice Minutes</span>
                  </div>
                  <p className="text-2xl font-bold" data-testid="text-usage-voice">{usage.voiceMinutes}</p>
                  <p className="text-xs text-muted-foreground">This month</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Users className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">Active Users</span>
                  </div>
                  <p className="text-2xl font-bold" data-testid="text-usage-users">
                    {usage.activeUsers}
                    <span className="text-sm font-normal text-muted-foreground"> / {usage.maxUsers}</span>
                  </p>
                  {usage.activeUsers >= Math.ceil(usage.maxUsers * 0.8) && (
                    <Badge variant="destructive" className="text-xs mt-1" data-testid="badge-user-limit-warning">Near limit</Badge>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Activity className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">API Calls</span>
                  </div>
                  <p className="text-2xl font-bold" data-testid="text-usage-api-calls">{usage.apiCalls}</p>
                  <p className="text-xs text-muted-foreground">This month</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Database className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">Data Storage</span>
                  </div>
                  <p className="text-lg font-bold" data-testid="text-usage-storage">
                    {usage.totalContacts} contacts / {usage.totalVisits} visits
                  </p>
                  <p className="text-xs text-muted-foreground">{usage.messagesSent} messages this month</p>
                </CardContent>
              </Card>
            </div>
          )}

          {voiceCalls && voiceCalls.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Phone className="h-4 w-4" /> Voice Call Log
                  </span>
                  <span className="text-xs font-normal text-muted-foreground" data-testid="text-voice-summary">
                    {voiceCalls.length} call{voiceCalls.length !== 1 ? "s" : ""} / {voiceCalls.reduce((sum: number, c: any) => sum + (c.durationMinutes || 0), 0)} min total
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-voice-calls">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-3">Date</th>
                        <th className="py-2 pr-3">Caller</th>
                        <th className="py-2 pr-3">Duration</th>
                        <th className="py-2 pr-3">Outcome</th>
                        <th className="py-2">Summary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {voiceCalls.map((call: any) => (
                        <tr key={call.id} className="border-b last:border-0" data-testid={`row-voice-call-${call.id}`}>
                          <td className="py-2 pr-3 whitespace-nowrap">{new Date(call.createdAt).toLocaleDateString()}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{call.callerPhone || "Unknown"}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {call.durationMinutes} min ({call.durationSeconds}s)
                          </td>
                          <td className="py-2 pr-3">
                            <Badge variant={call.outcome === "successful" ? "default" : "secondary"} data-testid={`badge-outcome-${call.id}`}>
                              {call.outcome || "unknown"}
                            </Badge>
                          </td>
                          <td className="py-2 text-xs text-muted-foreground max-w-[200px] truncate" title={call.summary || ""}>
                            {call.summary || "--"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" /> Account Info
                  </span>
                  {!editingCompany ? (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={startEditingCompany} data-testid="button-edit-company">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSaveCompany} disabled={updateCompanyMutation.isPending} data-testid="button-save-company">
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingCompany(false)} data-testid="button-cancel-edit-company">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {editingCompany ? (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Company Name</Label>
                      <Input value={companyForm.name} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} data-testid="input-company-name" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Email</Label>
                      <Input value={companyForm.email} onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })} data-testid="input-company-email" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Phone</Label>
                      <Input value={companyForm.phone} onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })} data-testid="input-company-phone" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Address</Label>
                      <Input value={companyForm.address} onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })} data-testid="input-company-address" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-sm text-muted-foreground">Subscription</span>
                      <div className="flex items-center gap-2">
                        <Select
                          value={company.subscriptionTier}
                          onValueChange={(v) => tierMutation.mutate(v)}
                          disabled={tierMutation.isPending}
                        >
                          <SelectTrigger className="w-40" data-testid="select-tier">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(TIER_CONFIG).map(([key, config]) => (
                              <SelectItem key={key} value={key}>
                                {config.name} {config.price > 0 ? `($${config.price}/mo)` : "(Free)"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">Status</span>
                      <Badge variant="outline" data-testid="badge-subscription-status">{company.subscriptionStatus}</Badge>
                    </div>
                    {company.trialEndsAt && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-muted-foreground">Trial Ends</span>
                        <span className="text-sm" data-testid="text-trial-ends-at">
                          {new Date(company.trialEndsAt).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                    {company.customMaxUsers != null && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-muted-foreground">Seat Limit</span>
                        <Badge variant="secondary" data-testid="badge-custom-max-users">Custom: {company.customMaxUsers} users</Badge>
                      </div>
                    )}
                    <div className="pt-1 space-y-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-1.5 text-xs"
                        data-testid="button-custom-trial-plan"
                        onClick={() => {
                          setTrialForm({
                            tier: company.subscriptionTier || "tier_10_plus",
                            subscriptionStatus: company.subscriptionStatus === "trialing" ? "trialing" : "trialing",
                            trialEndsAt: company.trialEndsAt
                              ? new Date(company.trialEndsAt).toISOString().split("T")[0]
                              : defaultTrialDate(),
                            customMaxUsers: company.customMaxUsers != null ? String(company.customMaxUsers) : "3",
                          });
                          setCustomTrialOpen(true);
                        }}
                      >
                        <FlaskConical className="h-3.5 w-3.5" />
                        Custom Trial Plan
                      </Button>
                      {company.subscriptionStatus !== "cancelled" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full gap-1.5 text-xs text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60"
                          data-testid="button-cancel-account"
                          onClick={() => { setCancelReason(""); setCancelOpen(true); }}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Cancel Account
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">Created</span>
                      <span className="text-sm">{new Date(company.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">Phone</span>
                      <span className="text-sm">{company.phone || "-"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">Email</span>
                      <span className="text-sm">{company.email || "-"}</span>
                    </div>
                    {company.address && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-muted-foreground">Address</span>
                        <span className="text-sm text-right max-w-[200px]">{company.address}</span>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" /> Team ({company.users?.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {company.users?.length > 0 ? (
                  <div className="space-y-2">
                    {company.users.map((u: any) => (
                      <div key={u.id} className="flex items-center justify-between gap-2 py-1.5 border-b last:border-b-0" data-testid={`row-user-${u.userId}`}>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate" data-testid={`text-user-name-${u.userId}`}>
                            {u.firstName || u.lastName ? `${u.firstName} ${u.lastName}`.trim() : "Unnamed"}
                          </p>
                          <p className="text-xs text-muted-foreground truncate" data-testid={`text-user-email-${u.userId}`}>{u.email}</p>
                          <p className="text-xs text-muted-foreground" data-testid={`text-user-last-login-${u.userId}`}>
                            {u.lastLoginAt
                              ? `Last login: ${new Date(u.lastLoginAt).toLocaleDateString()} ${new Date(u.lastLoginAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                              : "Never logged in"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge variant="outline">{u.role}</Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Edit user"
                            onClick={() => openEditUser(u)}
                            data-testid={`button-edit-user-${u.userId}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Set/Reset Password"
                            onClick={() => {
                              setResetTarget({ userId: u.userId, email: u.email, name: `${u.firstName} ${u.lastName}`.trim() || u.email });
                              setResetOpen(true);
                            }}
                            data-testid={`button-reset-password-${u.userId}`}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Send password reset email"
                            onClick={() => sendResetEmailMutation.mutate(u.userId)}
                            disabled={sendResetEmailMutation.isPending}
                            data-testid={`button-send-reset-${u.userId}`}
                          >
                            <Mail className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Send login credentials"
                            onClick={() => sendCredentialsMutation.mutate(u.userId)}
                            disabled={sendCredentialsMutation.isPending}
                            data-testid={`button-send-credentials-${u.userId}`}
                          >
                            <Send className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No users</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Contact2 className="h-4 w-4" /> Contacts ({company.contacts?.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {company.contacts?.length > 0 ? (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {company.contacts.slice(0, 20).map((c: any) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 py-1">
                        <span className="text-sm truncate">{c.firstName} {c.lastName}</span>
                        <Badge variant="outline">{c.status}</Badge>
                      </div>
                    ))}
                    {company.contacts.length > 20 && (
                      <p className="text-xs text-muted-foreground">... and {company.contacts.length - 20} more</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No contacts</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Invoices ({company.invoices?.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {company.invoices?.length > 0 ? (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {company.invoices.slice(0, 15).map((inv: any) => (
                      <div key={inv.id} className="flex items-center justify-between gap-2 py-1">
                        <span className="text-sm truncate">{inv.invoiceNumber || inv.id}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">${(inv.total / 100).toFixed(2)}</span>
                          <Badge variant="outline">{inv.status}</Badge>
                        </div>
                      </div>
                    ))}
                    {company.invoices.length > 15 && (
                      <p className="text-xs text-muted-foreground">... and {company.invoices.length - 15} more</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No invoices</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <StickyNote className="h-4 w-4" /> Admin Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Textarea
                  placeholder="Add a note about this account..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  className="min-h-[60px]"
                  data-testid="textarea-admin-note"
                />
                <Button
                  onClick={() => noteText.trim() && addNoteMutation.mutate(noteText.trim())}
                  disabled={!noteText.trim() || addNoteMutation.isPending}
                  data-testid="button-add-note"
                >
                  Add
                </Button>
              </div>
              {company.notes?.length > 0 ? (
                <div className="space-y-2">
                  {company.notes.map((n: any) => (
                    <div key={n.id} className="flex items-start justify-between gap-2 p-2 rounded border">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm whitespace-pre-wrap" data-testid={`text-note-${n.id}`}>{n.content}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(n.createdAt).toLocaleString()} by {n.createdBy}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteNoteMutation.mutate(n.id)}
                        disabled={deleteNoteMutation.isPending}
                        data-testid={`button-delete-note-${n.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No notes yet</p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === "audit" && (
        <Card data-testid="card-tenant-audit-log">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" /> Tenant Audit Log
                {auditData && <span className="text-sm font-normal text-muted-foreground">({auditData.total} events)</span>}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <Select value={auditFilter} onValueChange={(v) => { setAuditFilter(v === "all" ? "" : v); setAuditPage(0); }}>
                  <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-audit-filter">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="invoice">Invoice</SelectItem>
                    <SelectItem value="service_plan">Service Plan</SelectItem>
                    <SelectItem value="contact">Contact</SelectItem>
                    <SelectItem value="api_key">API Key</SelectItem>
                    <SelectItem value="webhook">Webhook</SelectItem>
                    <SelectItem value="company">Company</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {auditLoading ? (
              <p className="text-sm text-muted-foreground">Loading audit log...</p>
            ) : !auditData?.logs?.length ? (
              <p className="text-sm text-muted-foreground">No audit events for this tenant</p>
            ) : (
              <>
                <div className="space-y-2">
                  {auditData.logs.map((log) => (
                    <div key={log.id} className="flex items-start justify-between border rounded-lg px-3 py-2.5" data-testid={`audit-entry-${log.id}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={actionColors[log.action] || "bg-gray-100 text-gray-800"} variant="secondary">
                            {actionLabels[log.action] || log.action}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {entityTypeLabels[log.entityType] || log.entityType}
                          </Badge>
                          {log.userEmail && (
                            <span className="text-xs text-muted-foreground">{log.userEmail}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>{new Date(log.createdAt).toLocaleString()}</span>
                          {log.ipAddress && <span>IP: {log.ipAddress}</span>}
                          <span className="font-mono">{log.entityId.slice(0, 12)}...</span>
                        </div>
                        {log.changes && Object.keys(log.changes).length > 0 && (
                          <p className="text-xs text-muted-foreground mt-1 font-mono truncate max-w-lg">
                            {JSON.stringify(log.changes)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {totalAuditPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={auditPage === 0}
                      onClick={() => setAuditPage(p => p - 1)}
                      data-testid="button-audit-prev"
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {auditPage + 1} of {totalAuditPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={auditPage >= totalAuditPages - 1}
                      onClick={() => setAuditPage(p => p + 1)}
                      data-testid="button-audit-next"
                    >
                      Next
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={customTrialOpen} onOpenChange={setCustomTrialOpen}>
        <DialogContent data-testid="dialog-custom-trial">
          <DialogHeader>
            <DialogTitle>Custom Trial Plan</DialogTitle>
            <DialogDescription>
              Configure a tailored trial with specific tier, seat limit, and end date.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Plan Tier</Label>
              <Select value={trialForm.tier} onValueChange={(v) => setTrialForm({ ...trialForm, tier: v })}>
                <SelectTrigger data-testid="select-trial-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIER_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key}>
                      {cfg.name} {cfg.price > 0 ? `($${cfg.price}/mo)` : "(Free)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Status</Label>
              <Select value={trialForm.subscriptionStatus} onValueChange={(v) => setTrialForm({ ...trialForm, subscriptionStatus: v })}>
                <SelectTrigger data-testid="select-trial-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trialing">Trialing</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Trial End Date</Label>
              <Input
                type="date"
                value={trialForm.trialEndsAt}
                onChange={(e) => setTrialForm({ ...trialForm, trialEndsAt: e.target.value })}
                data-testid="input-trial-ends-at"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">User Seat Limit <span className="text-muted-foreground">(overrides tier default)</span></Label>
              <Input
                type="number"
                min="1"
                max="999"
                value={trialForm.customMaxUsers}
                onChange={(e) => setTrialForm({ ...trialForm, customMaxUsers: e.target.value })}
                placeholder="Leave blank to use tier default"
                data-testid="input-custom-max-users"
              />
              <p className="text-xs text-muted-foreground">
                {TIER_CONFIG[trialForm.tier as keyof typeof TIER_CONFIG]?.name ?? trialForm.tier} default: {TIER_CONFIG[trialForm.tier as keyof typeof TIER_CONFIG]?.maxUsers ?? "—"} users
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomTrialOpen(false)}>Cancel</Button>
            <Button
              onClick={() => customTrialMutation.mutate(trialForm)}
              disabled={customTrialMutation.isPending}
              data-testid="button-apply-custom-trial"
            >
              {customTrialMutation.isPending ? "Applying…" : "Apply Trial Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent data-testid="dialog-cancel-account">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              Cancel Account
            </DialogTitle>
            <DialogDescription>
              This will immediately cancel <strong>{company?.name}</strong>'s subscription. Their Stripe subscription will be terminated and their account status set to cancelled. This cannot be undone without manually reactivating.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Label className="text-sm">Cancellation reason (optional)</Label>
            <Textarea
              placeholder="e.g. Customer requested cancellation, non-payment, churned..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              data-testid="input-cancel-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)} data-testid="button-cancel-dialog-close">
              Keep Account
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelMutation.mutate(cancelReason)}
              disabled={cancelMutation.isPending}
              data-testid="button-confirm-cancel-account"
            >
              {cancelMutation.isPending ? "Cancelling…" : "Yes, Cancel Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetOpen} onOpenChange={(open) => { if (!open) handleCloseResetDialog(); else setResetOpen(open); }}>
        <DialogContent data-testid="dialog-reset-password">
          <DialogHeader>
            <DialogTitle>Set Password</DialogTitle>
            <DialogDescription>
              Set a new password for <strong>{resetTarget?.name}</strong> ({resetTarget?.email}). They will be required to change it on their next login.
            </DialogDescription>
          </DialogHeader>

          {generatedPassword ? (
            <div className="space-y-3 py-2">
              <p className="text-sm font-medium">New password has been set:</p>
              <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                <code className="flex-1 text-sm font-mono" data-testid="text-generated-password">
                  {showPassword ? generatedPassword : "••••••••••"}
                </code>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowPassword(!showPassword)} data-testid="button-toggle-password-visibility">
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyToClipboard(generatedPassword)} data-testid="button-copy-password">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Share this password with the user. They will be asked to create a new one when they log in.</p>
              <DialogFooter>
                <Button onClick={handleCloseResetDialog} data-testid="button-close-reset-dialog">Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="useCustomPassword"
                  checked={useCustomPassword}
                  onChange={(e) => setUseCustomPassword(e.target.checked)}
                  className="rounded"
                  data-testid="checkbox-custom-password"
                />
                <Label htmlFor="useCustomPassword" className="text-sm cursor-pointer">Set a specific password</Label>
              </div>
              {useCustomPassword && (
                <div className="space-y-1.5">
                  <Label htmlFor="customPassword">Password (min 8 characters)</Label>
                  <Input
                    id="customPassword"
                    type="text"
                    value={customPassword}
                    onChange={(e) => setCustomPassword(e.target.value)}
                    placeholder="Enter password..."
                    minLength={8}
                    data-testid="input-custom-password"
                  />
                </div>
              )}
              {!useCustomPassword && (
                <p className="text-sm text-muted-foreground">A secure random password will be generated automatically.</p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={handleCloseResetDialog} data-testid="button-cancel-reset">Cancel</Button>
                <Button
                  onClick={handleResetPassword}
                  disabled={resetPasswordMutation.isPending || (useCustomPassword && customPassword.length < 8)}
                  data-testid="button-confirm-reset-password"
                >
                  {resetPasswordMutation.isPending ? "Setting..." : "Set Password"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editUserOpen} onOpenChange={(open) => { if (!open) { setEditUserOpen(false); setEditUserTarget(null); } else setEditUserOpen(open); }}>
        <DialogContent data-testid="dialog-edit-user">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update details for this user.
            </DialogDescription>
          </DialogHeader>
          {editUserTarget && (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>First Name</Label>
                <Input
                  value={editUserTarget.firstName}
                  onChange={(e) => setEditUserTarget({ ...editUserTarget, firstName: e.target.value })}
                  data-testid="input-edit-user-firstname"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Last Name</Label>
                <Input
                  value={editUserTarget.lastName}
                  onChange={(e) => setEditUserTarget({ ...editUserTarget, lastName: e.target.value })}
                  data-testid="input-edit-user-lastname"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={editUserTarget.email}
                  onChange={(e) => setEditUserTarget({ ...editUserTarget, email: e.target.value })}
                  data-testid="input-edit-user-email"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={editUserTarget.role} onValueChange={(v) => setEditUserTarget({ ...editUserTarget, role: v })}>
                  <SelectTrigger data-testid="select-edit-user-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="tech">Technician</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setEditUserOpen(false); setEditUserTarget(null); }} data-testid="button-cancel-edit-user">Cancel</Button>
                <Button onClick={handleSaveUser} disabled={updateUserMutation.isPending} data-testid="button-save-user">
                  {updateUserMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
