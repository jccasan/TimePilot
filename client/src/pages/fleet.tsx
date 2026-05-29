import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Truck, Plus, AlertTriangle, BarChart3, ChevronRight, Star, ArrowUp } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { insertVehicleSchema } from "@shared/vehicle-schema";
import { z } from "zod";

const FLEET_PLANS = [
  { priceId: "price_1TcYUBGVMaTr43jXnkkXNEOo", vehicleLimit: 1, label: "1 Vehicle", price: 9 },
  { priceId: "price_1TcYVOGVMaTr43jXOVgaNvb0", vehicleLimit: 2, label: "2 Vehicles", price: 18 },
  { priceId: "price_1TcYX3GVMaTr43jXALdTVpP1", vehicleLimit: 3, label: "3 Vehicles", price: 27 },
  {
    priceId: "price_1TcYXZGVMaTr43jXzdiwib6E",
    vehicleLimit: null,
    label: "Unlimited Vehicles",
    price: 29,
  },
] as const;

type FleetAccess = {
  enabled: boolean;
  hasAccess: boolean;
  vehicleLimit: number | null;
  vehicleCount: number;
  isDemo: boolean;
};

type FleetAlert = {
  vehicleId: string;
  vehicleName: string;
  type: string;
  message: string;
  urgency: "high" | "medium" | "low";
  dueDate?: string;
};

type Vehicle = {
  id: string;
  make: string;
  model: string;
  year: number;
  vin: string | null;
  licensePlate: string | null;
  color: string | null;
  status: string;
  currentMileage: number;
  pendingAlertCount: number;
  insuranceExpiresAt: string | null;
  registrationExpiresAt: string | null;
  notes: string | null;
};

const addVehicleSchema = insertVehicleSchema.omit({ companyId: true }).extend({
  year: z.coerce
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear() + 2),
  currentMileage: z.coerce.number().int().min(0).optional(),
});

type AddVehicleForm = z.infer<typeof addVehicleSchema>;

export default function FleetPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "sold">("all");
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [selectedUpgradePlan, setSelectedUpgradePlan] = useState<string | null>(null);
  const isAdmin = user?.role === "owner" || user?.role === "admin";

  const { data: access, isLoading: accessLoading } = useQuery<FleetAccess>({
    queryKey: ["/api/vehicles/access"],
  });

  const { data: vehicles, isLoading: vehiclesLoading } = useQuery<Vehicle[]>({
    queryKey: ["/api/vehicles"],
    enabled: access?.hasAccess ?? false,
  });

  const { data: alerts, isLoading: alertsLoading } = useQuery<FleetAlert[]>({
    queryKey: ["/api/vehicles/fleet-alerts"],
    enabled: access?.hasAccess ?? false,
  });

  const form = useForm<AddVehicleForm>({
    resolver: zodResolver(addVehicleSchema),
    defaultValues: {
      make: "",
      model: "",
      year: new Date().getFullYear(),
      status: "active",
      currentMileage: 0,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: AddVehicleForm) => {
      const res = await apiRequest("POST", "/api/vehicles", data);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw body;
      }
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/access"] });
      setAddOpen(false);
      form.reset();
      toast({ title: "Vehicle added" });
    },
    onError: (err: unknown) => {
      const e = err as { limitReached?: boolean };
      if (e?.limitReached) {
        setAddOpen(false);
        setSelectedUpgradePlan(null);
        setUpsellOpen(true);
      } else {
        toast({ title: "Failed to add vehicle", variant: "destructive" });
      }
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: (priceId: string) =>
      apiRequest("POST", "/api/vehicles/fleet-checkout", { priceId }),
    onSuccess: async (res) => {
      const data = await res.json();
      window.location.href = data.url;
    },
    onError: () => toast({ title: "Could not start checkout", variant: "destructive" }),
  });

  const upgradeMutation = useMutation({
    mutationFn: (priceId: string) =>
      apiRequest("POST", "/api/vehicles/fleet-upgrade", { priceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/access"] });
      setUpsellOpen(false);
      setSelectedUpgradePlan(null);
      toast({ title: "Plan updated" });
    },
    onError: () => toast({ title: "Could not update plan", variant: "destructive" }),
  });

  function onSubmit(data: AddVehicleForm) {
    createMutation.mutate(data);
  }

  const upgradePlans = FLEET_PLANS.filter((p) => {
    if (access?.vehicleLimit === null) return false;
    if (p.vehicleLimit === null) return true;
    return p.vehicleLimit > (access?.vehicleLimit ?? 0);
  });

  if (accessLoading) {
    return (
      <div className="p-6 space-y-4" data-testid="fleet-loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!access?.hasAccess) {
    return (
      <div className="p-6 max-w-3xl mx-auto" data-testid="fleet-upsell">
        <div className="flex items-center gap-3 mb-6">
          <Truck className="h-8 w-8 text-green-600" />
          <div>
            <h1 className="text-2xl font-bold">FleetPilot</h1>
            <p className="text-muted-foreground text-sm">Vehicle tracking and fleet management</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="flex items-start gap-3">
            <Star className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-semibold text-sm">Track all your vehicles</h3>
              <p className="text-xs text-muted-foreground">
                Odometer, maintenance, fuel, repairs, and compliance documents — all in one place.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <BarChart3 className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-semibold text-sm">Fleet cost summaries</h3>
              <p className="text-xs text-muted-foreground">
                Per-vehicle and fleet-wide cost breakdowns, cost-per-mile, and MPG calculations.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-semibold text-sm">Expiry alerts</h3>
              <p className="text-xs text-muted-foreground">
                Get notified before insurance, registration, and maintenance expire.
              </p>
            </div>
          </div>
        </div>

        {isAdmin ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="fleet-plan-picker">
            {FLEET_PLANS.map((plan) => (
              <Card
                key={plan.priceId}
                className={`border-2 transition-colors ${plan.vehicleLimit === null ? "border-green-500" : "border-border"}`}
                data-testid={`plan-card-${plan.priceId}`}
              >
                <CardContent className="pt-4 pb-4 text-center">
                  <p className="font-semibold text-sm mb-1">{plan.label}</p>
                  <p className="text-2xl font-bold text-green-700 dark:text-green-400 mb-3">
                    ${plan.price}
                    <span className="text-xs font-normal text-muted-foreground">/mo</span>
                  </p>
                  <Button
                    size="sm"
                    className="w-full bg-green-600 hover:bg-green-700 text-white"
                    disabled={checkoutMutation.isPending}
                    onClick={() => checkoutMutation.mutate(plan.priceId)}
                    data-testid={`button-subscribe-${plan.priceId}`}
                  >
                    {checkoutMutation.isPending ? "..." : "Subscribe"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ask your account owner to activate FleetPilot.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="fleet-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Truck className="h-6 w-6 text-green-600" />
          <h1 className="text-2xl font-bold">Fleet</h1>
          {access.vehicleLimit !== null && (
            <Badge variant="outline" className="text-xs" data-testid="vehicle-count-badge">
              {access.vehicleCount} / {access.vehicleLimit} vehicles
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild data-testid="button-fleet-summary">
            <Link href="/fleet/summary">
              <BarChart3 className="h-4 w-4 mr-1" />
              Summary
            </Link>
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => setAddOpen(true)} data-testid="button-add-vehicle">
              <Plus className="h-4 w-4 mr-1" />
              Add Vehicle
            </Button>
          )}
        </div>
      </div>

      {/* Alerts */}
      {!alertsLoading && (alerts?.length ?? 0) > 0 && (
        <Card className="border-red-200 dark:border-red-900" data-testid="fleet-alerts-card">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-medium">Fleet Alerts ({alerts?.length ?? 0})</span>
            </div>
            <div className="space-y-2">
              {alerts?.slice(0, 5).map((alert, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-sm p-2 rounded-md bg-muted/50"
                  data-testid={`alert-row-${i}`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2 h-2 rounded-full ${alert.urgency === "high" ? "bg-red-500" : "bg-amber-400"}`}
                    />
                    <span className="font-medium">{alert.vehicleName}</span>
                    <span className="text-muted-foreground">— {alert.message}</span>
                  </div>
                  {alert.dueDate && (
                    <span className="text-xs text-muted-foreground">{alert.dueDate}</span>
                  )}
                </div>
              ))}
              {(alerts?.length ?? 0) > 5 && (
                <p className="text-xs text-muted-foreground pl-4">
                  +{(alerts?.length ?? 0) - 5} more alerts
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap" data-testid="status-filter">
        {(["all", "active", "inactive", "sold"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
            onClick={() => setStatusFilter(s)}
            className="capitalize"
            data-testid={`filter-${s}`}
          >
            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      {/* Vehicle list */}
      <div data-testid="vehicle-list">
        {vehiclesLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !vehicles?.length ? (
          <Card data-testid="fleet-empty">
            <CardContent className="pt-8 pb-8 text-center">
              <Truck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium mb-1">No vehicles yet</p>
              <p className="text-sm text-muted-foreground mb-4">
                Add your first vehicle to start tracking.
              </p>
              {isAdmin && (
                <Button onClick={() => setAddOpen(true)} data-testid="button-add-first-vehicle">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Vehicle
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {(statusFilter === "all"
              ? vehicles
              : vehicles.filter((v) => v.status === statusFilter)
            ).map((v) => (
              <Link key={v.id} href={`/fleet/${v.id}`}>
                <Card
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  data-testid={`vehicle-card-${v.id}`}
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-green-50 dark:bg-green-950">
                          <Truck className="h-5 w-5 text-green-600" />
                        </div>
                        <div>
                          <div className="font-semibold" data-testid={`vehicle-name-${v.id}`}>
                            {v.year} {v.make} {v.model}
                          </div>
                          <div className="text-sm text-muted-foreground flex items-center gap-3">
                            {v.licensePlate && <span>{v.licensePlate}</span>}
                            {v.vin && <span className="font-mono text-xs">{v.vin.slice(-8)}</span>}
                            <span>{v.currentMileage.toLocaleString()} mi</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {v.pendingAlertCount > 0 && (
                          <Badge
                            variant="destructive"
                            className="text-xs"
                            data-testid={`vehicle-alerts-${v.id}`}
                          >
                            {v.pendingAlertCount} alerts
                          </Badge>
                        )}
                        <Badge
                          variant="secondary"
                          className={`text-xs capitalize ${v.status === "active" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : ""}`}
                          data-testid={`vehicle-status-${v.id}`}
                        >
                          {v.status}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Add Vehicle Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent data-testid="dialog-add-vehicle">
          <DialogHeader>
            <DialogTitle>Add Vehicle</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="make"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Make</FormLabel>
                      <FormControl>
                        <Input placeholder="Ford" {...field} data-testid="input-vehicle-make" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model</FormLabel>
                      <FormControl>
                        <Input placeholder="F-150" {...field} data-testid="input-vehicle-model" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="year"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Year</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="2022"
                          {...field}
                          data-testid="input-vehicle-year"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="currentMileage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current Mileage</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="0"
                          {...field}
                          data-testid="input-vehicle-mileage"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="licensePlate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>License Plate</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="ABC-1234"
                          {...field}
                          value={field.value ?? ""}
                          data-testid="input-vehicle-plate"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="color"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Color</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="White"
                          {...field}
                          value={field.value ?? ""}
                          data-testid="input-vehicle-color"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="vin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>VIN (optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="1FTFW1E50NFC00000"
                        {...field}
                        value={field.value ?? ""}
                        data-testid="input-vehicle-vin"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-vehicle-status">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="sold">Sold</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAddOpen(false)}
                  data-testid="button-cancel-add-vehicle"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  data-testid="button-save-vehicle"
                >
                  {createMutation.isPending ? "Saving..." : "Add Vehicle"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Upgrade plan dialog — shown when vehicle limit is reached */}
      <Dialog open={upsellOpen} onOpenChange={setUpsellOpen}>
        <DialogContent data-testid="dialog-upgrade-plan">
          <DialogHeader>
            <DialogTitle>Upgrade Your FleetPilot Plan</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            You've reached your {access.vehicleLimit}-vehicle limit. Choose a larger plan to add
            more vehicles. The unused portion of your current billing period will be prorated.
          </p>
          <div className="space-y-2 py-2">
            {upgradePlans.map((plan) => (
              <button
                key={plan.priceId}
                type="button"
                className={`w-full flex items-center justify-between p-3 rounded-lg border-2 text-left transition-colors ${
                  selectedUpgradePlan === plan.priceId
                    ? "border-green-500 bg-green-50 dark:bg-green-950"
                    : "border-border hover:border-green-400"
                }`}
                onClick={() => setSelectedUpgradePlan(plan.priceId)}
                data-testid={`upgrade-plan-${plan.priceId}`}
              >
                <span className="font-medium text-sm">{plan.label}</span>
                <span className="text-green-700 dark:text-green-400 font-semibold">
                  ${plan.price}/mo
                </span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpsellOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!selectedUpgradePlan || upgradeMutation.isPending}
              onClick={() => selectedUpgradePlan && upgradeMutation.mutate(selectedUpgradePlan)}
              className="bg-green-600 hover:bg-green-700 text-white"
              data-testid="button-confirm-upgrade"
            >
              <ArrowUp className="h-4 w-4 mr-1" />
              {upgradeMutation.isPending ? "Upgrading..." : "Upgrade Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
