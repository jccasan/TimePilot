import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Building2,
  Search,
  ChevronRight,
  Plus,
  Trash2,
  AlertTriangle,
  MessageSquare,
  Phone,
  Clock,
  CheckCircle,
  XCircle,
  ExternalLink,
  Globe,
  RotateCcw,
  Hourglass,
} from "lucide-react";
import { TIER_CONFIG, type Company } from "@shared/schema";
import { useState, useMemo } from "react";

interface EnrichedCompany extends Company {
  userCount: number;
  activeUserCount: number;
  maxUsers: number;
  nearUserLimit: boolean;
  contactCount: number;
  smsSegments: number;
  voiceMinutes: number;
}

interface PendingApprovalCompany {
  id: string;
  name: string;
  email: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  signupCountry: string | null;
  verificationUrl: string | null;
  createdAt: string | null;
}

import { adminFetchFn, adminRequest } from "@/lib/adminApi";

const tierColors: Record<string, string> = {
  free_trial: "bg-emerald-100 text-emerald-800 dark:bg-emerald-800 dark:text-emerald-200",
  tier_1: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  tier_1_3: "bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-200",
  tier_3_5: "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-200",
  tier_6_10: "bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-200",
  tier_10_plus: "bg-orange-100 text-orange-800 dark:bg-orange-800 dark:text-orange-200",
};

function formatCountdown(deletedAt: string | null): string {
  if (!deletedAt) return "";
  const deleteTime = new Date(deletedAt).getTime() + 24 * 60 * 60 * 1000;
  const remaining = deleteTime - Date.now();
  if (remaining <= 0) return "Deleting soon...";
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / 60000);
  return `${hours}h ${minutes}m remaining`;
}

function formatScheduledDeletion(deletedAt: string | null): string {
  if (!deletedAt) return "";
  const deleteTime = new Date(new Date(deletedAt).getTime() + 24 * 60 * 60 * 1000);
  return deleteTime.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTrialDaysRemaining(trialEndsAt: string | Date | null | undefined): string | null {
  if (!trialEndsAt) return null;
  const now = new Date();
  const end = new Date(trialEndsAt);
  // Normalize to start of local calendar day so boundary is date-based, not time-based
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const days = Math.round((endDay.getTime() - nowDay.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return `expired ${Math.abs(days)} day${Math.abs(days) !== 1 ? "s" : ""} ago`;
  if (days === 0) return "expires today";
  return `${days} day${days !== 1 ? "s" : ""} left`;
}

export default function AdminTenants() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerFirstName, setOwnerFirstName] = useState("");
  const [ownerLastName, setOwnerLastName] = useState("");
  const [selectedTier, setSelectedTier] = useState("free_trial");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<PendingApprovalCompany | null>(null);
  const [sendRejectionEmail, setSendRejectionEmail] = useState(true);
  const [rejectionNote, setRejectionNote] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await adminRequest("POST", "/api/admin/companies", {
        companyName,
        ownerEmail,
        ownerFirstName,
        ownerLastName,
        subscriptionTier: selectedTier,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create tenant");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Tenant created",
        description: `${data.name} has been created. Login credentials were sent to ${data.ownerEmail}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setCreateOpen(false);
      setCompanyName("");
      setOwnerEmail("");
      setOwnerFirstName("");
      setOwnerLastName("");
      setSelectedTier("free_trial");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create tenant",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await adminRequest("DELETE", `/api/admin/companies/${companyId}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete tenant");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Tenant queued for deletion",
        description: `${data.deletedCompany} has been removed from all listings and will be permanently deleted in 24 hours.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies-pending-deletion"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setDeleteOpen(false);
      setDeleteTarget(null);
      setDeleteConfirmName("");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete tenant",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await adminRequest("POST", `/api/admin/companies/${companyId}/restore`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to restore tenant");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Tenant restored",
        description: `${data.restoredCompany} has been restored and is fully accessible again.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies-pending-deletion"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to restore tenant",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await adminRequest("POST", `/api/admin/companies/${companyId}/approve`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to approve account");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Account approved",
        description: `${data.companyName} is now trialing. Welcome email sent.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
    },
    onError: (error: Error) => {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({
      companyId,
      sendEmail,
      note,
    }: {
      companyId: string;
      sendEmail: boolean;
      note: string;
    }) => {
      const res = await adminRequest("POST", `/api/admin/companies/${companyId}/reject`, {
        sendRejectionEmail: sendEmail,
        rejectionNote: note,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to reject account");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Account rejected", description: `${data.companyName} has been removed.` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      setRejectOpen(false);
      setRejectTarget(null);
    },
    onError: (error: Error) => {
      toast({ title: "Rejection failed", description: error.message, variant: "destructive" });
    },
  });

  const { data: companies, isLoading: companiesLoading } = useQuery<EnrichedCompany[]>({
    queryKey: ["/api/admin/companies"],
    queryFn: adminFetchFn("/api/admin/companies"),
  });

  const { data: pendingApprovals, isLoading: pendingLoading } = useQuery<PendingApprovalCompany[]>({
    queryKey: ["/api/admin/pending-approvals"],
    queryFn: adminFetchFn("/api/admin/pending-approvals"),
  });

  const { data: pendingDeletion, isLoading: pendingDeletionLoading } = useQuery<Company[]>({
    queryKey: ["/api/admin/companies-pending-deletion"],
    queryFn: adminFetchFn("/api/admin/companies-pending-deletion"),
    refetchInterval: 60000,
  });

  const filtered = useMemo(() => {
    if (!companies) return [];
    if (!search.trim()) return companies;
    const q = search.toLowerCase();
    return companies.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.id?.toLowerCase().includes(q) ||
        c.subscriptionTier?.toLowerCase().includes(q)
    );
  }, [companies, search]);

  const pendingCount = pendingApprovals?.length ?? 0;
  const pendingDeletionCount = pendingDeletion?.length ?? 0;
  const nameMatches = deleteConfirmName === deleteTarget?.name;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="admin-tenants">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-tenants-title">
            Tenant Management
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {companies
              ? `${companies.length} tenant${companies.length !== 1 ? "s" : ""}`
              : "Loading..."}
            {pendingCount > 0 && (
              <span className="ml-2 text-amber-600 dark:text-amber-400 font-medium">
                · {pendingCount} pending approval
              </span>
            )}
            {pendingDeletionCount > 0 && (
              <span className="ml-2 text-red-600 dark:text-red-400 font-medium">
                · {pendingDeletionCount} pending deletion
              </span>
            )}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-add-tenant">
          <Plus className="h-4 w-4 mr-1" />
          Add Tenant
        </Button>
      </div>

      <Tabs defaultValue={pendingCount > 0 ? "pending" : "all"} data-testid="tabs-tenants">
        <TabsList>
          <TabsTrigger value="all" data-testid="tab-all-tenants">
            All Tenants
          </TabsTrigger>
          <TabsTrigger value="pending" data-testid="tab-pending-approvals" className="relative">
            Pending Approvals
            {pendingCount > 0 && (
              <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="pending-deletion"
            data-testid="tab-pending-deletion"
            className="relative"
          >
            Pending Deletion
            {pendingDeletionCount > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
                {pendingDeletionCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4 space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, ID, or tier..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-admin-search"
            />
          </div>

          {companiesLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading tenants...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No tenants found</div>
          ) : (
            <div className="space-y-2">
              {filtered.map((c) => {
                const tierConfig = TIER_CONFIG[c.subscriptionTier as keyof typeof TIER_CONFIG];
                return (
                  <Card key={c.id} className="hover-elevate" data-testid={`card-company-${c.id}`}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <Link
                          href={`/admin/companies/${c.id}`}
                          className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                        >
                          <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p
                              className="font-medium truncate"
                              data-testid={`text-company-name-${c.id}`}
                            >
                              {c.name}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{c.id}</p>
                          </div>
                        </Link>
                        <div className="flex items-center gap-3 flex-wrap">
                          <Badge
                            className={tierColors[c.subscriptionTier] || ""}
                            data-testid={`badge-tier-${c.id}`}
                          >
                            {tierConfig?.name || c.subscriptionTier}
                          </Badge>
                          <Badge variant="outline" data-testid={`badge-status-${c.id}`}>
                            {c.subscriptionStatus}
                          </Badge>
                          {c.subscriptionStatus === "trialing" &&
                            (() => {
                              const label = formatTrialDaysRemaining(c.trialEndsAt);
                              if (!label) return null;
                              const isExpired = label.startsWith("expired");
                              return (
                                <span
                                  className={`text-xs font-medium ${isExpired ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}
                                  data-testid={`text-trial-days-${c.id}`}
                                >
                                  {label}
                                </span>
                              );
                            })()}
                          {c.nearUserLimit && (
                            <Badge
                              variant="destructive"
                              className="text-xs flex items-center gap-1"
                              data-testid={`badge-user-warning-${c.id}`}
                            >
                              <AlertTriangle className="h-3 w-3" />
                              Near user limit
                            </Badge>
                          )}
                          <span
                            className="text-xs text-muted-foreground"
                            data-testid={`text-users-${c.id}`}
                          >
                            {c.activeUserCount}/{c.maxUsers} users
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {c.contactCount} contacts
                          </span>
                          {(c.smsSegments > 0 || c.voiceMinutes > 0) && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {c.smsSegments > 0 && (
                                <span
                                  className="flex items-center gap-0.5"
                                  data-testid={`text-sms-${c.id}`}
                                >
                                  <MessageSquare className="h-3 w-3" />
                                  {c.smsSegments}
                                </span>
                              )}
                              {c.voiceMinutes > 0 && (
                                <span
                                  className="flex items-center gap-0.5"
                                  data-testid={`text-voice-${c.id}`}
                                >
                                  <Phone className="h-3 w-3" />
                                  {c.voiceMinutes}m
                                </span>
                              )}
                            </div>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDeleteTarget({ id: c.id, name: c.name });
                              setDeleteConfirmName("");
                              setDeleteOpen(true);
                            }}
                            data-testid={`button-delete-company-${c.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <Link href={`/admin/companies/${c.id}`}>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </Link>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="pending" className="mt-4">
          {pendingLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading pending approvals...
            </div>
          ) : !pendingApprovals || pendingApprovals.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-3" />
              <p className="font-medium">All caught up!</p>
              <p className="text-sm text-muted-foreground mt-1">
                No accounts are pending approval.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingApprovals.map((c) => (
                <Card
                  key={c.id}
                  className="border-amber-200 dark:border-amber-800"
                  data-testid={`card-pending-${c.id}`}
                >
                  <CardContent className="py-4 px-5">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="bg-amber-100 dark:bg-amber-900/40 p-1.5 rounded-full mt-0.5 shrink-0">
                          <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <p className="font-semibold" data-testid={`text-pending-name-${c.id}`}>
                            {c.name}
                          </p>
                          <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
                            {c.ownerEmail && (
                              <span data-testid={`text-pending-email-${c.id}`}>{c.ownerEmail}</span>
                            )}
                            {c.ownerName && <span className="text-xs">({c.ownerName})</span>}
                            {c.signupCountry && (
                              <Badge
                                variant="outline"
                                className="text-xs font-mono"
                                data-testid={`badge-pending-country-${c.id}`}
                              >
                                {c.signupCountry}
                              </Badge>
                            )}
                            {c.createdAt && (
                              <span className="text-xs">
                                {new Date(c.createdAt).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </span>
                            )}
                          </div>
                          {c.verificationUrl && (
                            <a
                              href={c.verificationUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary underline hover:opacity-80"
                              data-testid={`link-verification-url-${c.id}`}
                            >
                              <Globe className="h-3 w-3" />
                              {c.verificationUrl.length > 60
                                ? c.verificationUrl.slice(0, 60) + "…"
                                : c.verificationUrl}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {!c.verificationUrl && (
                            <p className="text-xs text-muted-foreground italic">
                              No profile URL submitted yet
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive border-destructive/30 hover:bg-destructive/10"
                          onClick={() => {
                            setRejectTarget(c);
                            setSendRejectionEmail(true);
                            setRejectionNote("");
                            setRejectOpen(true);
                          }}
                          disabled={rejectMutation.isPending}
                          data-testid={`button-reject-${c.id}`}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => approveMutation.mutate(c.id)}
                          disabled={approveMutation.isPending}
                          data-testid={`button-approve-${c.id}`}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          {approveMutation.isPending ? "Approving..." : "Approve"}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="pending-deletion" className="mt-4">
          {pendingDeletionLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading pending deletions...
            </div>
          ) : !pendingDeletion || pendingDeletion.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-3" />
              <p className="font-medium">No pending deletions</p>
              <p className="text-sm text-muted-foreground mt-1">
                No tenants are queued for deletion.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                These tenants are fully inaccessible but not yet permanently deleted. All data is
                preserved and can be restored until the countdown expires.
              </p>
              {pendingDeletion.map((c) => (
                <Card
                  key={c.id}
                  className="border-red-200 dark:border-red-800"
                  data-testid={`card-pending-deletion-${c.id}`}
                >
                  <CardContent className="py-4 px-5">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="bg-red-100 dark:bg-red-900/40 p-1.5 rounded-full mt-0.5 shrink-0">
                          <Hourglass className="h-4 w-4 text-red-600 dark:text-red-400" />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <p
                            className="font-semibold"
                            data-testid={`text-pending-deletion-name-${c.id}`}
                          >
                            {c.name}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{c.id}</p>
                          <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
                            <Badge
                              variant="outline"
                              className="border-red-300 text-red-700 dark:border-red-700 dark:text-red-300 text-xs"
                              data-testid={`badge-deletion-countdown-${c.id}`}
                            >
                              <Clock className="h-3 w-3 mr-1" />
                              {formatCountdown(c.deletedAt ? c.deletedAt.toString() : null)}
                            </Badge>
                            <span
                              className="text-xs"
                              data-testid={`text-deletion-schedule-${c.id}`}
                            >
                              Permanent deletion:{" "}
                              {formatScheduledDeletion(c.deletedAt ? c.deletedAt.toString() : null)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-700 dark:hover:bg-green-900/20"
                          onClick={() => restoreMutation.mutate(c.id)}
                          disabled={restoreMutation.isPending}
                          data-testid={`button-restore-company-${c.id}`}
                        >
                          <RotateCcw className="h-4 w-4 mr-1" />
                          {restoreMutation.isPending ? "Restoring..." : "Restore"}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="dialog-create-tenant">
          <DialogHeader>
            <DialogTitle>Create New Tenant</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="companyName">Company Name</Label>
              <Input
                id="companyName"
                placeholder="e.g. Green Scoopers LLC"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                data-testid="input-company-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ownerFirstName">Owner First Name</Label>
                <Input
                  id="ownerFirstName"
                  placeholder="Jane"
                  value={ownerFirstName}
                  onChange={(e) => setOwnerFirstName(e.target.value)}
                  data-testid="input-owner-first-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ownerLastName">Owner Last Name</Label>
                <Input
                  id="ownerLastName"
                  placeholder="Doe"
                  value={ownerLastName}
                  onChange={(e) => setOwnerLastName(e.target.value)}
                  data-testid="input-owner-last-name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ownerEmail">Owner Email</Label>
              <Input
                id="ownerEmail"
                type="email"
                placeholder="owner@example.com"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                data-testid="input-owner-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tier">Subscription Tier</Label>
              <Select value={selectedTier} onValueChange={setSelectedTier}>
                <SelectTrigger data-testid="select-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIER_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key} data-testid={`select-item-${key}`}>
                      {cfg.name} {cfg.price > 0 ? `- $${cfg.price}/mo` : "- Free"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              data-testid="button-cancel-create"
            >
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !companyName || !ownerEmail || !ownerFirstName}
              data-testid="button-submit-create-tenant"
            >
              {createMutation.isPending ? "Creating..." : "Create Tenant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) {
            setDeleteTarget(null);
            setDeleteConfirmName("");
          }
        }}
      >
        <DialogContent data-testid="dialog-delete-tenant">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Remove Tenant
            </DialogTitle>
            <DialogDescription>
              This will place <strong>{deleteTarget?.name}</strong> in a 24-hour deletion hold. The
              company will become fully inaccessible immediately, but all data will be preserved and
              can be restored by an admin until the hold expires. After 24 hours, the company and
              all of its data will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="deleteConfirmName">
              Type <strong>{deleteTarget?.name}</strong> to confirm:
            </Label>
            <Input
              id="deleteConfirmName"
              placeholder={deleteTarget?.name || "Company name"}
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              data-testid="input-delete-confirm-name"
              autoComplete="off"
            />
            {deleteConfirmName.length > 0 && !nameMatches && (
              <p className="text-xs text-destructive" data-testid="text-name-mismatch">
                Name does not match. Please type it exactly.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteOpen(false);
                setDeleteTarget(null);
                setDeleteConfirmName("");
              }}
              data-testid="button-cancel-delete"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending || !nameMatches}
              data-testid="button-confirm-delete-tenant"
            >
              {deleteMutation.isPending ? "Queuing deletion..." : "Begin 24-Hour Hold"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rejectOpen}
        onOpenChange={(open) => {
          setRejectOpen(open);
          if (!open) setRejectTarget(null);
        }}
      >
        <DialogContent data-testid="dialog-reject-tenant">
          <DialogHeader>
            <DialogTitle>Reject Account</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{rejectTarget?.name}</strong> (
              {rejectTarget?.ownerEmail}). This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="sendRejectionEmail"
                checked={sendRejectionEmail}
                onChange={(e) => setSendRejectionEmail(e.target.checked)}
                className="h-4 w-4"
                data-testid="checkbox-send-rejection-email"
              />
              <Label htmlFor="sendRejectionEmail" className="cursor-pointer">
                Send rejection email to applicant
              </Label>
            </div>
            {sendRejectionEmail && (
              <div className="space-y-2">
                <Label htmlFor="rejectionNote">Note (optional — included in rejection email)</Label>
                <Textarea
                  id="rejectionNote"
                  placeholder="We're currently focused on serving pet waste removal businesses in the US and Canada."
                  value={rejectionNote}
                  onChange={(e) => setRejectionNote(e.target.value)}
                  rows={3}
                  data-testid="textarea-rejection-note"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectOpen(false);
                setRejectTarget(null);
              }}
              data-testid="button-cancel-reject"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                rejectTarget &&
                rejectMutation.mutate({
                  companyId: rejectTarget.id,
                  sendEmail: sendRejectionEmail,
                  note: rejectionNote,
                })
              }
              disabled={rejectMutation.isPending}
              data-testid="button-confirm-reject-tenant"
            >
              {rejectMutation.isPending ? "Rejecting..." : "Reject & Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
