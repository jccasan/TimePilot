import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Building2, Search, ChevronRight, Plus, Trash2, AlertTriangle, MessageSquare, Phone } from "lucide-react";
import { TIER_CONFIG, type Company } from "@shared/schema";
import { useState, useMemo } from "react";
import { adminFetchFn, adminRequest } from "@/lib/adminApi";

const tierColors: Record<string, string> = {
  free_trial: "bg-emerald-100 text-emerald-800 dark:bg-emerald-800 dark:text-emerald-200",
  tier_1: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  tier_1_3: "bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-200",
  tier_3_5: "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-200",
  tier_6_10: "bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-200",
  tier_10_plus: "bg-orange-100 text-orange-800 dark:bg-orange-800 dark:text-orange-200",
};

export default function AdminTenants() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerFirstName, setOwnerFirstName] = useState("");
  const [ownerLastName, setOwnerLastName] = useState("");
  const [selectedTier, setSelectedTier] = useState("free_trial");
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
      toast({ title: "Tenant created", description: `${data.name} has been created. Login credentials were sent to ${data.ownerEmail}.` });
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
      toast({ title: "Failed to create tenant", description: error.message, variant: "destructive" });
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
      toast({ title: "Tenant removed", description: `${data.deletedCompany} has been permanently deleted.` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setDeleteOpen(false);
      setDeleteTarget(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete tenant", description: error.message, variant: "destructive" });
    },
  });

  const { data: companies, isLoading: companiesLoading } = useQuery<Company[]>({
    queryKey: ["/api/admin/companies"],
    queryFn: adminFetchFn("/api/admin/companies"),
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

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="admin-tenants">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-tenants-title">Tenant Management</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {companies ? `${companies.length} tenant${companies.length !== 1 ? "s" : ""}` : "Loading..."}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-add-tenant">
          <Plus className="h-4 w-4 mr-1" />
          Add Tenant
        </Button>
      </div>

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
                    <Link href={`/admin/companies/${c.id}`} className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
                      <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium truncate" data-testid={`text-company-name-${c.id}`}>{c.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.id}</p>
                      </div>
                    </Link>
                    <div className="flex items-center gap-3 flex-wrap">
                      <Badge className={tierColors[c.subscriptionTier] || ""} data-testid={`badge-tier-${c.id}`}>
                        {tierConfig?.name || c.subscriptionTier}
                      </Badge>
                      <Badge variant="outline" data-testid={`badge-status-${c.id}`}>
                        {c.subscriptionStatus}
                      </Badge>
                      {(c as any).nearUserLimit && (
                        <Badge variant="destructive" className="text-xs flex items-center gap-1" data-testid={`badge-user-warning-${c.id}`}>
                          <AlertTriangle className="h-3 w-3" />
                          Near user limit
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground" data-testid={`text-users-${c.id}`}>
                        {(c as any).activeUserCount ?? c.userCount}/{(c as any).maxUsers ?? "?"} users
                      </span>
                      <span className="text-xs text-muted-foreground">{c.contactCount} contacts</span>
                      {((c as any).smsSegments > 0 || (c as any).voiceMinutes > 0) && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {(c as any).smsSegments > 0 && (
                            <span className="flex items-center gap-0.5" data-testid={`text-sms-${c.id}`}>
                              <MessageSquare className="h-3 w-3" />{(c as any).smsSegments}
                            </span>
                          )}
                          {(c as any).voiceMinutes > 0 && (
                            <span className="flex items-center gap-0.5" data-testid={`text-voice-${c.id}`}>
                              <Phone className="h-3 w-3" />{(c as any).voiceMinutes}m
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
            <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-create">
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

      <Dialog open={deleteOpen} onOpenChange={(open) => { setDeleteOpen(open); if (!open) setDeleteTarget(null); }}>
        <DialogContent data-testid="dialog-delete-tenant">
          <DialogHeader>
            <DialogTitle>Remove Tenant</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong> and all of its data including contacts, jobs, invoices, and user accounts that belong only to this company. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteOpen(false); setDeleteTarget(null); }} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-tenant"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
