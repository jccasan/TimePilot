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
import { Truck, Plus, AlertTriangle, BarChart3, ChevronRight, Star } from "lucide-react";
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

type FleetAccess = {
  enabled: boolean;
  trialActive: boolean;
  trialEndsAt: string | null;
  daysLeftInTrial: number | null;
  hasAccess: boolean;
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
    mutationFn: (data: AddVehicleForm) => apiRequest("POST", "/api/vehicles", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      setAddOpen(false);
      form.reset();
      toast({ title: "Vehicle added" });
    },
    onError: () => toast({ title: "Failed to add vehicle", variant: "destructive" }),
  });

  const checkoutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/vehicles/fleet-checkout", {}),
    onSuccess: async (res) => {
      const data = await res.json();
      window.location.href = data.url;
    },
    onError: () => toast({ title: "Could not start checkout", variant: "destructive" }),
  });

  function onSubmit(data: AddVehicleForm) {
    createMutation.mutate(data);
  }

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
      <div className="p-6 max-w-2xl mx-auto" data-testid="fleet-upsell">
        <div className="flex items-center gap-3 mb-6">
          <Truck className="h-8 w-8 text-green-600" />
          <div>
            <h1 className="text-2xl font-bold">FleetPilot</h1>
            <p className="text-muted-foreground text-sm">Vehicle tracking and fleet management</p>
          </div>
        </div>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-start gap-3">
              <Star className="h-5 w-5 text-amber-500 mt-0.5" />
              <div>
                <h3 className="font-semibold">Track all your vehicles in one place</h3>
                <p className="text-sm text-muted-foreground">
                  Odometer, maintenance, fuel, repairs, and compliance documents — all organized by
                  vehicle.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <BarChart3 className="h-5 w-5 text-blue-500 mt-0.5" />
              <div>
                <h3 className="font-semibold">Fleet cost summaries</h3>
                <p className="text-sm text-muted-foreground">
                  Per-vehicle and fleet-wide cost breakdowns, cost-per-mile, and MPG calculations.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5" />
              <div>
                <h3 className="font-semibold">Expiry alerts</h3>
                <p className="text-sm text-muted-foreground">
                  Get notified before insurance, registration, maintenance, and documents expire.
                </p>
              </div>
            </div>
            <div className="pt-4 border-t">
              <p className="text-lg font-semibold mb-1">$19/month add-on</p>
              <p className="text-sm text-muted-foreground mb-4">14-day free trial included</p>
              {isAdmin ? (
                <Button
                  onClick={() => checkoutMutation.mutate()}
                  disabled={checkoutMutation.isPending}
                  data-testid="button-fleet-subscribe"
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {checkoutMutation.isPending ? "Redirecting..." : "Start Free Trial"}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Ask your account owner to activate FleetPilot.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="fleet-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Truck className="h-6 w-6 text-green-600" />
          <h1 className="text-2xl font-bold">Fleet</h1>
          {access.trialActive && access.daysLeftInTrial !== null && (
            <Badge
              variant="outline"
              className="text-xs border-amber-400 text-amber-700 dark:text-amber-400"
            >
              Trial: {access.daysLeftInTrial}d left
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
    </div>
  );
}
