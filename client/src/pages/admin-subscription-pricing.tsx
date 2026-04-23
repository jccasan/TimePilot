import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { CreditCard, Pencil, Users, DollarSign } from "lucide-react";
import { adminFetchFn, adminRequest } from "@/lib/adminApi";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

interface SubscriptionTier {
  id: string;
  tierKey: string;
  name: string;
  maxUsers: number;
  price: string;
  isActive: boolean;
  updatedAt: string;
}


const tierColors: Record<string, string> = {
  free_trial: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  tier_1: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  tier_1_3: "bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-200",
  tier_3_5: "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-200",
  tier_6_10: "bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-200",
  tier_10_plus: "bg-orange-100 text-orange-800 dark:bg-orange-800 dark:text-orange-200",
};

export default function AdminSubscriptionPricing() {
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<SubscriptionTier | null>(null);
  const [form, setForm] = useState({ name: "", maxUsers: "", price: "" });

  const { data: tiers, isLoading } = useQuery<SubscriptionTier[]>({
    queryKey: ["/api/admin/subscription-tiers"],
    queryFn: adminFetchFn("/api/admin/subscription-tiers"),
  });

  const updateTier = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await adminRequest("PATCH", `/api/admin/subscription-tiers/${id}`, updates);
      if (!res.ok) throw new Error("Failed to update tier");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscription-tiers"] });
      setEditOpen(false);
      setEditingTier(null);
      toast({ title: "Tier updated" });
    },
    onError: () => {
      toast({ title: "Failed to update tier", variant: "destructive" });
    },
  });

  function openEdit(tier: SubscriptionTier) {
    setEditingTier(tier);
    setForm({ name: tier.name, maxUsers: String(tier.maxUsers), price: tier.price });
    setEditOpen(true);
  }

  function handleSave() {
    if (!editingTier) return;
    const priceNum = parseFloat(form.price);
    const usersNum = parseInt(form.maxUsers);
    if (!form.name.trim() || isNaN(priceNum) || priceNum < 0 || isNaN(usersNum) || usersNum < 1) {
      toast({ title: "Please fill all fields with valid values", variant: "destructive" });
      return;
    }
    updateTier.mutate({
      id: editingTier.id,
      updates: { name: form.name.trim(), maxUsers: usersNum, price: priceNum },
    });
  }

  function handleToggleActive(tier: SubscriptionTier) {
    updateTier.mutate({
      id: tier.id,
      updates: { isActive: !tier.isActive },
    });
  }

  const activeTiers = tiers?.filter(t => t.isActive) || [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" data-testid="admin-subscription-pricing-page">
      <div className="flex items-center gap-3">
        <CreditCard className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="heading-subscription-pricing">Subscription Pricing</h1>
          <p className="text-sm text-muted-foreground">Manage platform subscription tiers and pricing</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Total Tiers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold" data-testid="text-total-tiers">{tiers?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Highest Tier
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold" data-testid="text-highest-tier">
              ${activeTiers.length ? Math.max(...activeTiers.map(t => parseFloat(t.price))).toFixed(2) : "0.00"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">per month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" />
              Max Users (Top Tier)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold" data-testid="text-max-users-top">
              {activeTiers.length ? Math.max(...activeTiers.map(t => t.maxUsers)) : 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-tiers-list">
        <CardHeader>
          <CardTitle className="text-base">Subscription Tiers</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : !tiers?.length ? (
            <p className="text-sm text-muted-foreground">No tiers configured</p>
          ) : (
            <div className="space-y-3">
              {tiers.map(tier => (
                <div
                  key={tier.id}
                  className={`flex items-center justify-between border rounded-lg px-4 py-4 ${!tier.isActive ? "opacity-50" : ""}`}
                  data-testid={`tier-row-${tier.tierKey}`}
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <Badge className={tierColors[tier.tierKey] || "bg-gray-100 text-gray-800"} variant="secondary">
                      {tier.tierKey}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm" data-testid={`text-tier-name-${tier.tierKey}`}>{tier.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Up to {tier.maxUsers === 999 ? "unlimited" : tier.maxUsers} user{tier.maxUsers !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold" data-testid={`text-tier-price-${tier.tierKey}`}>
                        ${parseFloat(tier.price).toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground">/month</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Switch
                      checked={tier.isActive}
                      onCheckedChange={() => handleToggleActive(tier)}
                      data-testid={`switch-active-${tier.tierKey}`}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(tier)}
                      data-testid={`button-edit-${tier.tierKey}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent data-testid="dialog-edit-tier">
          <DialogHeader>
            <DialogTitle>Edit Tier: {editingTier?.tierKey}</DialogTitle>
            <DialogDescription>Update the name, user limit, and pricing for this subscription tier.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="tierName">Display Name</Label>
              <Input
                id="tierName"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                data-testid="input-tier-name"
              />
            </div>
            <div>
              <Label htmlFor="tierMaxUsers">Max Users</Label>
              <Input
                id="tierMaxUsers"
                type="number"
                min={1}
                value={form.maxUsers}
                onChange={e => setForm(f => ({ ...f, maxUsers: e.target.value }))}
                data-testid="input-tier-max-users"
              />
            </div>
            <div>
              <Label htmlFor="tierPrice">Price ($/month)</Label>
              <Input
                id="tierPrice"
                type="number"
                min={0}
                step="0.01"
                value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                data-testid="input-tier-price"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} data-testid="button-cancel-edit">Cancel</Button>
            <Button onClick={handleSave} disabled={updateTier.isPending} data-testid="button-save-tier">
              {updateTier.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}