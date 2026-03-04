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
import { ArrowLeft, Building2, Users, Contact2, FileText, StickyNote, Trash2, KeyRound, Copy, Eye, EyeOff } from "lucide-react";
import { TIER_CONFIG } from "@shared/schema";
import { useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { adminFetchFn, adminRequest } from "@/lib/adminApi";
import { useToast } from "@/hooks/use-toast";

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

  const { data: company, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/companies", id],
    queryFn: adminFetchFn(`/api/admin/companies/${id}`),
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

  if (isLoading) {
    return <div className="p-6 text-center text-muted-foreground">Loading...</div>;
  }

  if (!company) {
    return <div className="p-6 text-center text-muted-foreground">Company not found</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid="admin-company-detail">
      <div className="flex items-center gap-3 flex-wrap">
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

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Account Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Created</span>
              <span className="text-sm">{new Date(company.createdAt).toLocaleDateString()}</span>
            </div>
            {company.phone && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Phone</span>
                <span className="text-sm">{company.phone}</span>
              </div>
            )}
            {company.email && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Email</span>
                <span className="text-sm">{company.email}</span>
              </div>
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
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline">{u.role}</Badge>
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
    </div>
  );
}
