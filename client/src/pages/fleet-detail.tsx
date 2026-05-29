import { useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/use-currency";
import { ChevronLeft, Fuel, FileText, Plus, Trash2, Gauge } from "lucide-react";
import { format } from "date-fns";

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

type OdometerLog = {
  id: string;
  odometer: number;
  readingDate: string;
  source: string;
  notes: string | null;
};

type MaintenanceLog = {
  id: string;
  maintenanceType: string;
  performedDate: string;
  mileageAtService: number | null;
  nextDueDate: string | null;
  nextDueMiles: number | null;
  cost: string | null;
  provider: string | null;
  notes: string | null;
};

type FuelLog = {
  id: string;
  fuelDate: string;
  gallons: string;
  pricePerGallon: string | null;
  totalCost: string | null;
  odometer: number | null;
  isFullFillup: boolean;
  stationName: string | null;
  notes: string | null;
};

type RepairLog = {
  id: string;
  description: string;
  performedDate: string;
  mileageAtRepair: number | null;
  laborCost: string | null;
  partsCost: string | null;
  totalCost: string | null;
  provider: string | null;
  isDowntime: boolean;
  downtimeDays: number | null;
  notes: string | null;
};

type VehicleDocument = {
  id: string;
  name: string;
  documentType: string;
  filePath: string;
  fileSize: number | null;
  mimeType: string | null;
  expiresAt: string | null;
  notes: string | null;
  downloadUrl: string | null;
};

type FuelResponse = {
  logs: FuelLog[];
  mpg: { perFillup: Array<{ id: string; mpg: number | null }>; rollingAverage: number | null };
};

function DateDisplay({ date }: { date: string | null }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  try {
    return <span>{format(new Date(date), "MMM d, yyyy")}</span>;
  } catch {
    return <span>{date}</span>;
  }
}

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
  hasAccess: boolean;
  vehicleLimit: number | null;
  vehicleCount: number;
  isDemo: boolean;
};

export default function FleetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const { formatMoney } = useCurrency();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "owner" || user?.role === "admin";

  const [tab, setTab] = useState("odometer");
  const [odomOpen, setOdomOpen] = useState(false);
  const [maintOpen, setMaintOpen] = useState(false);
  const [fuelOpen, setFuelOpen] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);

  const { data: vehicle, isLoading: vehicleLoading } = useQuery<Vehicle>({
    queryKey: [`/api/vehicles/${id}`],
  });

  const { data: odomLogs, isLoading: odomLoading } = useQuery<OdometerLog[]>({
    queryKey: [`/api/vehicles/${id}/odometer`],
    enabled: tab === "odometer",
  });

  const { data: maintLogs, isLoading: maintLoading } = useQuery<MaintenanceLog[]>({
    queryKey: [`/api/vehicles/${id}/maintenance`],
    enabled: tab === "maintenance",
  });

  const { data: fuelData, isLoading: fuelLoading } = useQuery<FuelResponse>({
    queryKey: [`/api/vehicles/${id}/fuel`],
    enabled: tab === "fuel",
  });

  const { data: repairs, isLoading: repairsLoading } = useQuery<RepairLog[]>({
    queryKey: [`/api/vehicles/${id}/repairs`],
    enabled: tab === "repairs",
  });

  const { data: docs, isLoading: docsLoading } = useQuery<VehicleDocument[]>({
    queryKey: [`/api/vehicles/${id}/documents`],
    enabled: tab === "documents",
  });

  const { data: access } = useQuery<FleetAccess>({ queryKey: ["/api/vehicles/access"] });
  const [, navigate] = useLocation();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [downgradeOpen, setDowngradeOpen] = useState(false);
  const [selectedDowngradePlan, setSelectedDowngradePlan] = useState<string | null>(null);

  const deleteOdom = useMutation({
    mutationFn: (logId: string) => apiRequest("DELETE", `/api/vehicles/${id}/odometer/${logId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${id}/odometer`] });
      queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${id}`] });
    },
  });

  const deleteMaint = useMutation({
    mutationFn: (logId: string) => apiRequest("DELETE", `/api/vehicles/${id}/maintenance/${logId}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${id}/maintenance`] }),
  });

  const deleteFuel = useMutation({
    mutationFn: (logId: string) => apiRequest("DELETE", `/api/vehicles/${id}/fuel/${logId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${id}/fuel`] }),
  });

  const deleteRepair = useMutation({
    mutationFn: (logId: string) => apiRequest("DELETE", `/api/vehicles/${id}/repairs/${logId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${id}/repairs`] }),
  });

  const deleteDoc = useMutation({
    mutationFn: (docId: string) => apiRequest("DELETE", `/api/vehicles/${id}/documents/${docId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${id}/documents`] }),
  });

  const deleteVehicle = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/vehicles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/access"] });
      navigate("/fleet");
    },
    onError: () => toast({ title: "Failed to remove vehicle", variant: "destructive" }),
  });

  const upgradePlan = useMutation({
    mutationFn: (priceId: string) => apiRequest("POST", "/api/vehicles/fleet-upgrade", { priceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/access"] });
      setDowngradeOpen(false);
      deleteVehicle.mutate();
    },
    onError: () => toast({ title: "Could not update plan", variant: "destructive" }),
  });

  const [odomForm, setOdomForm] = useState({
    odometer: "",
    readingDate: new Date().toISOString().split("T")[0],
    notes: "",
  });
  const [maintForm, setMaintForm] = useState({
    maintenanceType: "",
    performedDate: new Date().toISOString().split("T")[0],
    mileageAtService: "",
    cost: "",
    provider: "",
    nextDueDate: "",
    nextDueMiles: "",
    notes: "",
  });
  const [fuelForm, setFuelForm] = useState({
    fuelDate: new Date().toISOString().split("T")[0],
    gallons: "",
    pricePerGallon: "",
    totalCost: "",
    odometer: "",
    isFullFillup: "true",
    stationName: "",
    notes: "",
  });
  const [repairForm, setRepairForm] = useState({
    description: "",
    performedDate: new Date().toISOString().split("T")[0],
    mileageAtRepair: "",
    laborCost: "",
    partsCost: "",
    provider: "",
    isDowntime: "false",
    downtimeDays: "",
    notes: "",
  });

  const createOdom = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest("POST", `/api/vehicles/${id}/odometer`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${id}/odometer`] });
      queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${id}`] });
      setOdomOpen(false);
      toast({ title: "Odometer reading saved" });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const createMaint = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest("POST", `/api/vehicles/${id}/maintenance`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${id}/maintenance`] });
      setMaintOpen(false);
      toast({ title: "Maintenance log saved" });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const createFuel = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest("POST", `/api/vehicles/${id}/fuel`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${id}/fuel`] });
      setFuelOpen(false);
      toast({ title: "Fuel log saved" });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const createRepair = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest("POST", `/api/vehicles/${id}/repairs`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${id}/repairs`] });
      setRepairOpen(false);
      toast({ title: "Repair log saved" });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  if (vehicleLoading) {
    return (
      <div className="p-6 space-y-4" data-testid="fleet-detail-loading">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="p-6" data-testid="fleet-detail-not-found">
        <p className="text-muted-foreground">Vehicle not found.</p>
      </div>
    );
  }

  const fuelLogs = fuelData?.logs ?? [];
  const mpg = fuelData?.mpg;

  return (
    <div className="p-6 space-y-6" data-testid="fleet-detail-page">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild data-testid="button-back-fleet">
          <Link href="/fleet">
            <ChevronLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold" data-testid="vehicle-title">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {vehicle.licensePlate && (
              <span data-testid="vehicle-plate">{vehicle.licensePlate}</span>
            )}
            {vehicle.color && <span>{vehicle.color}</span>}
            {vehicle.vin && (
              <span className="font-mono text-xs" data-testid="vehicle-vin">
                {vehicle.vin}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {vehicle.pendingAlertCount > 0 && (
            <Badge variant="destructive" data-testid="vehicle-alert-count">
              {vehicle.pendingAlertCount} alerts
            </Badge>
          )}
          <Badge
            variant="secondary"
            className={`capitalize ${vehicle.status === "active" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : ""}`}
            data-testid="vehicle-status"
          >
            {vehicle.status}
          </Badge>
          {isAdmin && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => {
                const vehicleCountAfter = (access?.vehicleCount ?? 1) - 1;
                const currentPlan = FLEET_PLANS.find(
                  (p) => p.vehicleLimit === (access?.vehicleLimit ?? null)
                );
                if (currentPlan) {
                  const cheaper = FLEET_PLANS.slice()
                    .sort((a, b) => a.price - b.price)
                    .find(
                      (p) =>
                        p.price < currentPlan.price &&
                        (p.vehicleLimit === null || p.vehicleLimit >= vehicleCountAfter)
                    );
                  if (cheaper) {
                    setSelectedDowngradePlan(cheaper.priceId);
                    setDowngradeOpen(true);
                    return;
                  }
                }
                setDeleteOpen(true);
              }}
              data-testid="button-delete-vehicle"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Gauge className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-xs text-muted-foreground">Current Miles</span>
            </div>
            <p className="text-lg font-semibold" data-testid="current-mileage">
              {vehicle.currentMileage.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs text-muted-foreground">Insurance Exp.</span>
            </div>
            <p className="text-sm font-medium" data-testid="insurance-exp">
              <DateDisplay date={vehicle.insuranceExpiresAt} />
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs text-muted-foreground">Registration Exp.</span>
            </div>
            <p className="text-sm font-medium" data-testid="registration-exp">
              <DateDisplay date={vehicle.registrationExpiresAt} />
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Fuel className="h-3.5 w-3.5 text-green-500" />
              <span className="text-xs text-muted-foreground">Avg MPG</span>
            </div>
            <p className="text-lg font-semibold" data-testid="avg-mpg">
              {mpg?.rollingAverage !== null && mpg?.rollingAverage !== undefined
                ? `${mpg.rollingAverage}`
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} data-testid="vehicle-tabs">
        <TabsList className="grid grid-cols-6 w-full">
          <TabsTrigger value="odometer" data-testid="tab-odometer">
            Odometer
          </TabsTrigger>
          <TabsTrigger value="maintenance" data-testid="tab-maintenance">
            Maintenance
          </TabsTrigger>
          <TabsTrigger value="fuel" data-testid="tab-fuel">
            Fuel
          </TabsTrigger>
          <TabsTrigger value="repairs" data-testid="tab-repairs">
            Repairs
          </TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-documents">
            Documents
          </TabsTrigger>
          <TabsTrigger value="summary" data-testid="tab-summary">
            Summary
          </TabsTrigger>
        </TabsList>

        {/* Odometer tab */}
        <TabsContent value="odometer" data-testid="odometer-tab">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-medium">Odometer Readings</h3>
            {isAdmin && (
              <Button size="sm" onClick={() => setOdomOpen(true)} data-testid="button-add-odometer">
                <Plus className="h-4 w-4 mr-1" />
                Add Reading
              </Button>
            )}
          </div>
          {odomLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !odomLogs?.length ? (
            <Card>
              <CardContent
                className="pt-6 pb-6 text-center text-sm text-muted-foreground"
                data-testid="odometer-empty"
              >
                No odometer readings yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2" data-testid="odometer-list">
              {[...odomLogs]
                .sort((a, b) => b.odometer - a.odometer)
                .map((log, idx, sorted) => {
                  const prev = sorted[idx + 1];
                  const delta = prev ? log.odometer - prev.odometer : null;
                  return (
                    <Card key={log.id} data-testid={`odometer-row-${log.id}`}>
                      <CardContent className="pt-3 pb-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-semibold">
                              {log.odometer.toLocaleString()} mi
                            </span>
                            {delta != null && delta > 0 && (
                              <span
                                className="text-xs text-muted-foreground ml-2"
                                data-testid={`odometer-delta-${log.id}`}
                              >
                                +{delta.toLocaleString()} mi
                              </span>
                            )}
                            <span className="text-sm text-muted-foreground ml-3">
                              <DateDisplay date={log.readingDate} />
                            </span>
                            <Badge variant="outline" className="text-xs ml-2">
                              {log.source}
                            </Badge>
                            {log.notes && (
                              <p className="text-xs text-muted-foreground mt-1">{log.notes}</p>
                            )}
                          </div>
                          {isAdmin && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteOdom.mutate(log.id)}
                              data-testid={`button-delete-odometer-${log.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          )}
        </TabsContent>

        {/* Maintenance tab */}
        <TabsContent value="maintenance" data-testid="maintenance-tab">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-medium">Maintenance Log</h3>
            {isAdmin && (
              <Button
                size="sm"
                onClick={() => setMaintOpen(true)}
                data-testid="button-add-maintenance"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Entry
              </Button>
            )}
          </div>
          {maintLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !maintLogs?.length ? (
            <Card>
              <CardContent
                className="pt-6 pb-6 text-center text-sm text-muted-foreground"
                data-testid="maintenance-empty"
              >
                No maintenance records yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2" data-testid="maintenance-list">
              {maintLogs.map((log) => (
                <Card key={log.id} data-testid={`maintenance-row-${log.id}`}>
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{log.maintenanceType}</span>
                          <span className="text-sm text-muted-foreground">
                            <DateDisplay date={log.performedDate} />
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground flex gap-4 mt-1">
                          {log.mileageAtService && (
                            <span>{log.mileageAtService.toLocaleString()} mi</span>
                          )}
                          {log.cost && <span>{formatMoney(parseFloat(log.cost))}</span>}
                          {log.provider && <span>{log.provider}</span>}
                        </div>
                        {log.nextDueDate && (
                          <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                            Next due: <DateDisplay date={log.nextDueDate} />
                            {log.nextDueMiles && ` or ${log.nextDueMiles.toLocaleString()} mi`}
                          </div>
                        )}
                        {log.notes && (
                          <p className="text-xs text-muted-foreground mt-1">{log.notes}</p>
                        )}
                      </div>
                      {isAdmin && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteMaint.mutate(log.id)}
                          data-testid={`button-delete-maintenance-${log.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Fuel tab */}
        <TabsContent value="fuel" data-testid="fuel-tab">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-3">
              <h3 className="font-medium">Fuel Log</h3>
              {mpg?.rollingAverage !== null && mpg?.rollingAverage !== undefined && (
                <Badge variant="secondary" className="text-xs" data-testid="avg-mpg-badge">
                  Avg {mpg.rollingAverage} mpg
                </Badge>
              )}
            </div>
            {isAdmin && (
              <Button size="sm" onClick={() => setFuelOpen(true)} data-testid="button-add-fuel">
                <Plus className="h-4 w-4 mr-1" />
                Add Entry
              </Button>
            )}
          </div>
          {fuelLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !fuelLogs.length ? (
            <Card>
              <CardContent
                className="pt-6 pb-6 text-center text-sm text-muted-foreground"
                data-testid="fuel-empty"
              >
                No fuel logs yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2" data-testid="fuel-list">
              {fuelLogs.map((log) => {
                const mpgEntry = mpg?.perFillup.find((p) => p.id === log.id);
                return (
                  <Card key={log.id} data-testid={`fuel-row-${log.id}`}>
                    <CardContent className="pt-3 pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <span className="font-medium">
                              {parseFloat(log.gallons).toFixed(2)} gal
                            </span>
                            <span className="text-sm text-muted-foreground">
                              <DateDisplay date={log.fuelDate} />
                            </span>
                            {log.isFullFillup && (
                              <Badge variant="outline" className="text-xs">
                                Full
                              </Badge>
                            )}
                            {mpgEntry?.mpg !== null && mpgEntry?.mpg !== undefined && (
                              <Badge
                                variant="secondary"
                                className="text-xs"
                                data-testid={`mpg-${log.id}`}
                              >
                                {mpgEntry.mpg} mpg
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground flex gap-4 mt-1">
                            {log.totalCost && <span>{formatMoney(parseFloat(log.totalCost))}</span>}
                            {log.pricePerGallon && (
                              <span>${parseFloat(log.pricePerGallon).toFixed(3)}/gal</span>
                            )}
                            {log.odometer && <span>{log.odometer.toLocaleString()} mi</span>}
                            {log.stationName && <span>{log.stationName}</span>}
                          </div>
                        </div>
                        {isAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteFuel.mutate(log.id)}
                            data-testid={`button-delete-fuel-${log.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Repairs tab */}
        <TabsContent value="repairs" data-testid="repairs-tab">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-medium">Repair Log</h3>
            {isAdmin && (
              <Button size="sm" onClick={() => setRepairOpen(true)} data-testid="button-add-repair">
                <Plus className="h-4 w-4 mr-1" />
                Add Entry
              </Button>
            )}
          </div>
          {repairsLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !repairs?.length ? (
            <Card>
              <CardContent
                className="pt-6 pb-6 text-center text-sm text-muted-foreground"
                data-testid="repairs-empty"
              >
                No repair records yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2" data-testid="repairs-list">
              {repairs.map((log) => (
                <Card key={log.id} data-testid={`repair-row-${log.id}`}>
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{log.description}</span>
                          <span className="text-sm text-muted-foreground">
                            <DateDisplay date={log.performedDate} />
                          </span>
                          {log.isDowntime && (
                            <Badge variant="destructive" className="text-xs">
                              Downtime
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground flex gap-4 mt-1">
                          {log.totalCost && <span>{formatMoney(parseFloat(log.totalCost))}</span>}
                          {log.laborCost && (
                            <span>Labor: {formatMoney(parseFloat(log.laborCost))}</span>
                          )}
                          {log.partsCost && (
                            <span>Parts: {formatMoney(parseFloat(log.partsCost))}</span>
                          )}
                          {log.provider && <span>{log.provider}</span>}
                          {log.isDowntime && log.downtimeDays && (
                            <span>{log.downtimeDays}d downtime</span>
                          )}
                        </div>
                        {log.notes && (
                          <p className="text-xs text-muted-foreground mt-1">{log.notes}</p>
                        )}
                      </div>
                      {isAdmin && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteRepair.mutate(log.id)}
                          data-testid={`button-delete-repair-${log.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Documents tab */}
        <TabsContent value="documents" data-testid="documents-tab">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-medium">Documents</h3>
            {isAdmin && (
              <label htmlFor="doc-upload">
                <Button size="sm" asChild data-testid="button-upload-document">
                  <span>
                    <Plus className="h-4 w-4 mr-1" />
                    Upload
                  </span>
                </Button>
                <input
                  id="doc-upload"
                  type="file"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const formData = new FormData();
                    formData.append("file", file);
                    formData.append("name", file.name);
                    formData.append("documentType", "other");
                    try {
                      const res = await fetch(`/api/vehicles/${id}/documents`, {
                        method: "POST",
                        body: formData,
                        credentials: "include",
                      });
                      if (!res.ok) throw new Error("Upload failed");
                      queryClient.invalidateQueries({
                        queryKey: [`/api/vehicles/${id}/documents`],
                      });
                      toast({ title: "Document uploaded" });
                    } catch {
                      toast({ title: "Upload failed", variant: "destructive" });
                    }
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
          {docsLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !docs?.length ? (
            <Card>
              <CardContent
                className="pt-6 pb-6 text-center text-sm text-muted-foreground"
                data-testid="documents-empty"
              >
                No documents yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2" data-testid="documents-list">
              {docs.map((doc) => (
                <Card key={doc.id} data-testid={`document-row-${doc.id}`}>
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">{doc.name}</span>
                          <Badge variant="outline" className="text-xs capitalize">
                            {doc.documentType}
                          </Badge>
                        </div>
                        {doc.expiresAt && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                            Expires: <DateDisplay date={doc.expiresAt} />
                          </p>
                        )}
                        {doc.notes && (
                          <p className="text-xs text-muted-foreground mt-1">{doc.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {doc.downloadUrl && (
                          <Button
                            size="sm"
                            variant="outline"
                            asChild
                            data-testid={`button-download-doc-${doc.id}`}
                          >
                            <a href={doc.downloadUrl} download={doc.name}>
                              Download
                            </a>
                          </Button>
                        )}
                        {isAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteDoc.mutate(doc.id)}
                            data-testid={`button-delete-doc-${doc.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Summary tab */}
        <SummaryTab id={id!} formatMoney={formatMoney} />
      </Tabs>

      {/* Add Odometer Dialog */}
      <Dialog open={odomOpen} onOpenChange={setOdomOpen}>
        <DialogContent data-testid="dialog-add-odometer">
          <DialogHeader>
            <DialogTitle>Add Odometer Reading</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Odometer (miles)</Label>
              <Input
                type="number"
                value={odomForm.odometer}
                onChange={(e) => setOdomForm({ ...odomForm, odometer: e.target.value })}
                data-testid="input-odometer"
              />
            </div>
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={odomForm.readingDate}
                onChange={(e) => setOdomForm({ ...odomForm, readingDate: e.target.value })}
                data-testid="input-odometer-date"
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                value={odomForm.notes}
                onChange={(e) => setOdomForm({ ...odomForm, notes: e.target.value })}
                data-testid="input-odometer-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOdomOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                createOdom.mutate({
                  odometer: parseInt(odomForm.odometer),
                  readingDate: odomForm.readingDate,
                  notes: odomForm.notes || null,
                })
              }
              disabled={createOdom.isPending || !odomForm.odometer}
              data-testid="button-save-odometer"
            >
              {createOdom.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Maintenance Dialog */}
      <Dialog open={maintOpen} onOpenChange={setMaintOpen}>
        <DialogContent data-testid="dialog-add-maintenance">
          <DialogHeader>
            <DialogTitle>Add Maintenance Record</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Type</Label>
              <Input
                value={maintForm.maintenanceType}
                onChange={(e) => setMaintForm({ ...maintForm, maintenanceType: e.target.value })}
                placeholder="Oil Change, Tire Rotation, etc."
                data-testid="input-maintenance-type"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date Performed</Label>
                <Input
                  type="date"
                  value={maintForm.performedDate}
                  onChange={(e) => setMaintForm({ ...maintForm, performedDate: e.target.value })}
                  data-testid="input-maintenance-date"
                />
              </div>
              <div>
                <Label>Mileage</Label>
                <Input
                  type="number"
                  value={maintForm.mileageAtService}
                  onChange={(e) => setMaintForm({ ...maintForm, mileageAtService: e.target.value })}
                  data-testid="input-maintenance-mileage"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Cost ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={maintForm.cost}
                  onChange={(e) => setMaintForm({ ...maintForm, cost: e.target.value })}
                  data-testid="input-maintenance-cost"
                />
              </div>
              <div>
                <Label>Provider</Label>
                <Input
                  value={maintForm.provider}
                  onChange={(e) => setMaintForm({ ...maintForm, provider: e.target.value })}
                  data-testid="input-maintenance-provider"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Next Due Date</Label>
                <Input
                  type="date"
                  value={maintForm.nextDueDate}
                  onChange={(e) => setMaintForm({ ...maintForm, nextDueDate: e.target.value })}
                  data-testid="input-maintenance-next-date"
                />
              </div>
              <div>
                <Label>Next Due Miles</Label>
                <Input
                  type="number"
                  value={maintForm.nextDueMiles}
                  onChange={(e) => setMaintForm({ ...maintForm, nextDueMiles: e.target.value })}
                  data-testid="input-maintenance-next-miles"
                />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={maintForm.notes}
                onChange={(e) => setMaintForm({ ...maintForm, notes: e.target.value })}
                data-testid="input-maintenance-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMaintOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                createMaint.mutate({
                  maintenanceType: maintForm.maintenanceType,
                  performedDate: maintForm.performedDate,
                  mileageAtService: maintForm.mileageAtService
                    ? parseInt(maintForm.mileageAtService)
                    : null,
                  cost: maintForm.cost || null,
                  provider: maintForm.provider || null,
                  nextDueDate: maintForm.nextDueDate || null,
                  nextDueMiles: maintForm.nextDueMiles ? parseInt(maintForm.nextDueMiles) : null,
                  notes: maintForm.notes || null,
                })
              }
              disabled={createMaint.isPending || !maintForm.maintenanceType}
              data-testid="button-save-maintenance"
            >
              {createMaint.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Fuel Dialog */}
      <Dialog open={fuelOpen} onOpenChange={setFuelOpen}>
        <DialogContent data-testid="dialog-add-fuel">
          <DialogHeader>
            <DialogTitle>Add Fuel Log</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <Input
                  type="date"
                  value={fuelForm.fuelDate}
                  onChange={(e) => setFuelForm({ ...fuelForm, fuelDate: e.target.value })}
                  data-testid="input-fuel-date"
                />
              </div>
              <div>
                <Label>Gallons</Label>
                <Input
                  type="number"
                  step="0.001"
                  value={fuelForm.gallons}
                  onChange={(e) => setFuelForm({ ...fuelForm, gallons: e.target.value })}
                  data-testid="input-fuel-gallons"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Price/Gallon ($)</Label>
                <Input
                  type="number"
                  step="0.001"
                  value={fuelForm.pricePerGallon}
                  onChange={(e) => setFuelForm({ ...fuelForm, pricePerGallon: e.target.value })}
                  data-testid="input-fuel-price"
                />
              </div>
              <div>
                <Label>Total Cost ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={fuelForm.totalCost}
                  onChange={(e) => setFuelForm({ ...fuelForm, totalCost: e.target.value })}
                  data-testid="input-fuel-total"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Odometer</Label>
                <Input
                  type="number"
                  value={fuelForm.odometer}
                  onChange={(e) => setFuelForm({ ...fuelForm, odometer: e.target.value })}
                  data-testid="input-fuel-odometer"
                />
              </div>
              <div>
                <Label>Station</Label>
                <Input
                  value={fuelForm.stationName}
                  onChange={(e) => setFuelForm({ ...fuelForm, stationName: e.target.value })}
                  data-testid="input-fuel-station"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="full-fillup"
                checked={fuelForm.isFullFillup === "true"}
                onChange={(e) =>
                  setFuelForm({ ...fuelForm, isFullFillup: e.target.checked ? "true" : "false" })
                }
                data-testid="checkbox-full-fillup"
              />
              <Label htmlFor="full-fillup">Full fill-up (for MPG calculation)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFuelOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                createFuel.mutate({
                  fuelDate: fuelForm.fuelDate,
                  gallons: fuelForm.gallons,
                  pricePerGallon: fuelForm.pricePerGallon || null,
                  totalCost: fuelForm.totalCost || null,
                  odometer: fuelForm.odometer ? parseInt(fuelForm.odometer) : null,
                  isFullFillup: fuelForm.isFullFillup === "true",
                  stationName: fuelForm.stationName || null,
                  notes: fuelForm.notes || null,
                })
              }
              disabled={createFuel.isPending || !fuelForm.gallons}
              data-testid="button-save-fuel"
            >
              {createFuel.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Repair Dialog */}
      <Dialog open={repairOpen} onOpenChange={setRepairOpen}>
        <DialogContent data-testid="dialog-add-repair">
          <DialogHeader>
            <DialogTitle>Add Repair Record</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Description</Label>
              <Textarea
                value={repairForm.description}
                onChange={(e) => setRepairForm({ ...repairForm, description: e.target.value })}
                data-testid="input-repair-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <Input
                  type="date"
                  value={repairForm.performedDate}
                  onChange={(e) => setRepairForm({ ...repairForm, performedDate: e.target.value })}
                  data-testid="input-repair-date"
                />
              </div>
              <div>
                <Label>Mileage</Label>
                <Input
                  type="number"
                  value={repairForm.mileageAtRepair}
                  onChange={(e) =>
                    setRepairForm({ ...repairForm, mileageAtRepair: e.target.value })
                  }
                  data-testid="input-repair-mileage"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Labor Cost ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={repairForm.laborCost}
                  onChange={(e) => setRepairForm({ ...repairForm, laborCost: e.target.value })}
                  data-testid="input-repair-labor"
                />
              </div>
              <div>
                <Label>Parts Cost ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={repairForm.partsCost}
                  onChange={(e) => setRepairForm({ ...repairForm, partsCost: e.target.value })}
                  data-testid="input-repair-parts"
                />
              </div>
            </div>
            <div>
              <Label>Provider</Label>
              <Input
                value={repairForm.provider}
                onChange={(e) => setRepairForm({ ...repairForm, provider: e.target.value })}
                data-testid="input-repair-provider"
              />
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is-downtime"
                  checked={repairForm.isDowntime === "true"}
                  onChange={(e) =>
                    setRepairForm({
                      ...repairForm,
                      isDowntime: e.target.checked ? "true" : "false",
                    })
                  }
                  data-testid="checkbox-is-downtime"
                />
                <Label htmlFor="is-downtime">Vehicle downtime</Label>
              </div>
              {repairForm.isDowntime === "true" && (
                <div className="flex items-center gap-2">
                  <Label>Days</Label>
                  <Input
                    type="number"
                    className="w-20"
                    value={repairForm.downtimeDays}
                    onChange={(e) => setRepairForm({ ...repairForm, downtimeDays: e.target.value })}
                    data-testid="input-repair-downtime-days"
                  />
                </div>
              )}
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={repairForm.notes}
                onChange={(e) => setRepairForm({ ...repairForm, notes: e.target.value })}
                data-testid="input-repair-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRepairOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                createRepair.mutate({
                  description: repairForm.description,
                  performedDate: repairForm.performedDate,
                  mileageAtRepair: repairForm.mileageAtRepair
                    ? parseInt(repairForm.mileageAtRepair)
                    : null,
                  laborCost: repairForm.laborCost || null,
                  partsCost: repairForm.partsCost || null,
                  provider: repairForm.provider || null,
                  isDowntime: repairForm.isDowntime === "true",
                  downtimeDays: repairForm.downtimeDays ? parseInt(repairForm.downtimeDays) : null,
                  notes: repairForm.notes || null,
                })
              }
              disabled={createRepair.isPending || !repairForm.description}
              data-testid="button-save-repair"
            >
              {createRepair.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Vehicle Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent data-testid="dialog-delete-vehicle">
          <DialogHeader>
            <DialogTitle>Remove Vehicle</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remove {vehicle.year} {vehicle.make} {vehicle.model} from your fleet? All logs and
            documents will be preserved.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteVehicle.isPending}
              onClick={() => deleteVehicle.mutate()}
              data-testid="button-confirm-delete-vehicle"
            >
              {deleteVehicle.isPending ? "Removing..." : "Remove Vehicle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Downgrade Plan Dialog */}
      {(() => {
        const suggestedPlan = FLEET_PLANS.find((p) => p.priceId === selectedDowngradePlan);
        const currentPlan = FLEET_PLANS.find(
          (p) => p.vehicleLimit === (access?.vehicleLimit ?? null)
        );
        if (!suggestedPlan || !currentPlan) return null;
        const savings = currentPlan.price - suggestedPlan.price;
        const vehicleCountAfter = (access?.vehicleCount ?? 1) - 1;
        return (
          <Dialog
            open={downgradeOpen}
            onOpenChange={(o) => {
              setDowngradeOpen(o);
              if (!o) setDeleteOpen(true);
            }}
          >
            <DialogContent data-testid="dialog-downgrade-plan">
              <DialogHeader>
                <DialogTitle>Save ${savings}/month?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                After removing this vehicle you'll have {vehicleCountAfter}{" "}
                {vehicleCountAfter === 1 ? "vehicle" : "vehicles"}. You can downgrade to the{" "}
                {suggestedPlan.label} plan and save ${savings}/month. The unused portion of your
                current billing period will be credited to your account.
              </p>
              <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={() => {
                    setDowngradeOpen(false);
                    setDeleteOpen(true);
                  }}
                >
                  Keep current plan
                </Button>
                <Button
                  className="bg-green-600 hover:bg-green-700 text-white"
                  disabled={upgradePlan.isPending}
                  onClick={() => upgradePlan.mutate(selectedDowngradePlan!)}
                  data-testid="button-confirm-downgrade"
                >
                  {upgradePlan.isPending
                    ? "Updating..."
                    : `Downgrade to ${suggestedPlan.label} ($${suggestedPlan.price}/mo)`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );
}

type VehicleSummaryData = {
  fuelCost: number;
  maintCost: number;
  repairCost: number;
  totalCost: number;
  totalMiles: number;
  costPerMile: number | null;
  avgMpg: number | null;
  downtimeDays: number;
  fuelPct: number;
  maintPct: number;
  repairPct: number;
};

function SummaryTab({ id, formatMoney }: { id: string; formatMoney: (n: number) => string }) {
  const [preset, setPreset] = useState<number | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [applied, setApplied] = useState<{ start: string; end: string } | null>(null);

  function applyPreset(days: number) {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().split("T")[0];
    const s = fmt(start);
    const e = fmt(end);
    setPreset(days);
    setStartDate(s);
    setEndDate(e);
    setApplied({ start: s, end: e });
  }

  function applyCustom() {
    setPreset(null);
    setApplied({ start: startDate, end: endDate });
  }

  function clearFilter() {
    setPreset(null);
    setStartDate("");
    setEndDate("");
    setApplied(null);
  }

  const params = new URLSearchParams();
  if (applied?.start) params.set("startDate", applied.start);
  if (applied?.end) params.set("endDate", applied.end);
  const qs = params.toString() ? `?${params.toString()}` : "";

  const { data, isLoading } = useQuery<VehicleSummaryData>({
    queryKey: [`/api/vehicles/${id}/summary${qs}`, applied],
  });

  return (
    <TabsContent value="summary" data-testid="summary-tab">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 items-center" data-testid="summary-presets">
          {[30, 90, 180, 365].map((d) => (
            <Button
              key={d}
              size="sm"
              variant={preset === d ? "default" : "outline"}
              onClick={() => applyPreset(d)}
              data-testid={`summary-preset-${d}`}
            >
              {d}d
            </Button>
          ))}
          <span className="text-muted-foreground text-xs">or custom:</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border rounded px-2 py-1 text-sm h-8"
            data-testid="summary-start-date"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border rounded px-2 py-1 text-sm h-8"
            data-testid="summary-end-date"
          />
          <Button size="sm" onClick={applyCustom} data-testid="button-summary-apply">
            Apply
          </Button>
          {applied && (
            <Button
              size="sm"
              variant="ghost"
              onClick={clearFilter}
              data-testid="button-summary-clear"
            >
              Clear
            </Button>
          )}
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !data ? (
          <Card>
            <CardContent className="pt-6 pb-6 text-center text-sm text-muted-foreground">
              No cost data available.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4" data-testid="vehicle-summary-data">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="pt-3 pb-3">
                  <div className="text-xs text-muted-foreground mb-1">Total Cost</div>
                  <div className="text-xl font-bold" data-testid="summary-total-cost">
                    {formatMoney(data.totalCost)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-3 pb-3">
                  <div className="text-xs text-muted-foreground mb-1">Total Miles</div>
                  <div className="text-xl font-bold" data-testid="summary-total-miles">
                    {data.totalMiles.toLocaleString()}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-3 pb-3">
                  <div className="text-xs text-muted-foreground mb-1">Cost / Mile</div>
                  <div className="text-xl font-bold" data-testid="summary-cost-per-mile">
                    {data.costPerMile !== null ? `$${data.costPerMile.toFixed(2)}` : "—"}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-3 pb-3">
                  <div className="text-xs text-muted-foreground mb-1">Avg MPG</div>
                  <div className="text-xl font-bold" data-testid="summary-avg-mpg">
                    {data.avgMpg !== null ? `${data.avgMpg}` : "—"}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="pt-4 pb-4 space-y-3" data-testid="summary-breakdown">
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Fuel</span>
                    <span className="font-medium">
                      {formatMoney(data.fuelCost)} ({Math.round(data.fuelPct)}%)
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-blue-400"
                      style={{ width: `${Math.min(100, data.fuelPct)}%` }}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Maintenance</span>
                    <span className="font-medium">
                      {formatMoney(data.maintCost)} ({Math.round(data.maintPct)}%)
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-amber-400"
                      style={{ width: `${Math.min(100, data.maintPct)}%` }}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Repairs</span>
                    <span className="font-medium">
                      {formatMoney(data.repairCost)} ({Math.round(data.repairPct)}%)
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-red-400"
                      style={{ width: `${Math.min(100, data.repairPct)}%` }}
                    />
                  </div>
                </div>
                {data.downtimeDays > 0 && (
                  <div className="text-sm text-amber-600 dark:text-amber-400 pt-1">
                    {data.downtimeDays} downtime day{data.downtimeDays !== 1 ? "s" : ""} recorded
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </TabsContent>
  );
}
