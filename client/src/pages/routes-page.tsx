import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Route, ServicePlan, Contact, Property } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  MapPin, Dog, GripVertical, Plus, Pencil, Trash2, Route as RouteIcon,
  Navigation, AlertCircle, User, Search, Loader2, Send, Coins, TrendingDown,
  Clock, ShoppingCart
} from "lucide-react";
import {
  DndContext, DragOverlay, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, useDroppable, useDraggable,
  type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from "@dnd-kit/core";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type DayOfWeek = typeof DAYS[number];
const DAY_LABELS: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday",
  friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};
const DAY_SHORT: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
};
const UNASSIGNED_DROP = "__unassigned__";
const ROUTE_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#14b8a6",
];

type TeamMember = {
  id: string; role: string; firstName: string; lastName: string;
  email: string; profileImageUrl: string | null;
};

type OptimizeResult = {
  optimized: boolean; totalDistance: number; originalDistance: number;
  milesSaved: number; minutesSaved: number; stopCount: number;
  creditsUsed: number; creditsRemaining: number; message?: string;
};

function DraggableStop({ stop, contacts, properties }: {
  stop: ServicePlan; contacts: Contact[]; properties: Property[];
}) {
  const contact = contacts.find(c => c.id === stop.contactId);
  const property = properties.find(p => p.id === stop.propertyId);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: stop.id, data: { stop },
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  return (
    <div ref={setNodeRef} style={style}
      className={`border rounded-md p-2.5 bg-background transition-opacity ${isDragging ? "opacity-30" : ""}`}
      data-testid={`draggable-stop-${stop.id}`}
    >
      <div className="flex items-start gap-2">
        <div className="cursor-grab active:cursor-grabbing touch-none pt-0.5 shrink-0" {...listeners} {...attributes}>
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between gap-1">
            <span className="font-medium text-sm truncate" data-testid={`text-stop-name-${stop.id}`}>
              {contact ? `${contact.firstName} ${contact.lastName}` : "Unknown"}
            </span>
            {stop.stopOrder > 0 && (
              <Badge variant="outline" className="text-[10px] shrink-0" data-testid={`badge-stop-order-${stop.id}`}>
                #{stop.stopOrder}
              </Badge>
            )}
          </div>
          {property && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{property.streetAddress}{property.city ? `, ${property.city}` : ""}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {contact?.numberOfDogs != null && contact.numberOfDogs > 0 && (
              <span className="flex items-center gap-0.5"><Dog className="h-3 w-3" />{contact.numberOfDogs}</span>
            )}
            <span>${Number(stop.pricePerVisit).toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StopOverlay({ stop, contacts, properties }: {
  stop: ServicePlan; contacts: Contact[]; properties: Property[];
}) {
  const contact = contacts.find(c => c.id === stop.contactId);
  const property = properties.find(p => p.id === stop.propertyId);
  return (
    <div className="border rounded-md p-2.5 bg-background shadow-lg opacity-90 max-w-xs space-y-1">
      <p className="font-medium text-sm">{contact ? `${contact.firstName} ${contact.lastName}` : "Unknown"}</p>
      {property?.streetAddress && <p className="text-xs text-muted-foreground truncate">{property.streetAddress}</p>}
    </div>
  );
}

function DroppableZone({ id, children, isOver, className = "" }: {
  id: string; children: React.ReactNode; isOver: boolean; className?: string;
}) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef}
      className={`min-h-[80px] rounded-md p-2 space-y-2 transition-colors ${isOver ? "bg-primary/10 ring-2 ring-primary/30" : ""} ${className}`}
      data-testid={`drop-zone-${id}`}
    >{children}</div>
  );
}

function RouteCard({ route, stops, contacts, properties, team, isOverThis, credits,
  onEdit, onDelete, onOptimize, onDispatch, isOptimizing, isDispatching }: {
  route: Route; stops: ServicePlan[]; contacts: Contact[]; properties: Property[];
  team: TeamMember[]; isOverThis: boolean; credits: number;
  onEdit: (route: Route) => void; onDelete: (route: Route) => void;
  onOptimize: (routeId: string, stopCount: number) => void;
  onDispatch: (routeId: string) => void;
  isOptimizing: boolean; isDispatching: boolean;
}) {
  const tech = team.find(t => t.id === route.technicianId);
  const sortedStops = [...stops].sort((a, b) => a.stopOrder - b.stopOrder);
  const totalRevenue = stops.reduce((sum, s) => sum + Number(s.pricePerVisit), 0);
  const stopCount = stops.length;
  const creditsNeeded = stopCount <= 30 ? 1 : 2;
  const isOverLimit = stopCount > 30;
  const isOverMax = stopCount > 60;

  return (
    <Card className="flex flex-col" data-testid={`card-route-${route.id}`}>
      <CardHeader className="p-3 pb-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: route.color || "#3b82f6" }} />
            <CardTitle className="text-sm font-semibold truncate" data-testid={`text-route-name-${route.id}`}>
              {route.name}
            </CardTitle>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" onClick={() => onEdit(route)} data-testid={`button-edit-route-${route.id}`}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onDelete(route)} disabled={stops.length > 0} data-testid={`button-delete-route-${route.id}`}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {tech && (
            <span className="flex items-center gap-1" data-testid={`text-route-tech-${route.id}`}>
              <User className="h-3 w-3" />{tech.firstName} {tech.lastName}
            </span>
          )}
          <span>${totalRevenue.toFixed(2)}</span>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={isOverMax ? "destructive" : isOverLimit ? "secondary" : "outline"}
            className={isOverLimit && !isOverMax ? "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" : ""}
            data-testid={`badge-stop-counter-${route.id}`}
          >
            Stops: {stopCount} / {stopCount <= 30 ? 30 : 60}
          </Badge>
          {isOverMax && <span className="text-xs text-destructive">Max 60 stops</span>}
        </div>

        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs"
            onClick={() => onOptimize(route.id, stopCount)}
            disabled={isOptimizing || stopCount < 2 || isOverMax || credits < creditsNeeded}
            data-testid={`button-optimize-${route.id}`}
          >
            {isOptimizing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Navigation className="h-3 w-3 mr-1" />}
            Optimize ({creditsNeeded} {creditsNeeded === 1 ? "Credit" : "Credits"})
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs"
            onClick={() => onDispatch(route.id)}
            disabled={isDispatching || stopCount === 0 || !route.technicianId}
            data-testid={`button-dispatch-${route.id}`}
          >
            {isDispatching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
            Dispatch to Tech
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-2 pt-0 flex-1">
        <DroppableZone id={`route-${route.id}`} isOver={isOverThis}>
          {sortedStops.length > 0 ? (
            sortedStops.map(stop => (
              <DraggableStop key={stop.id} stop={stop} contacts={contacts} properties={properties} />
            ))
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">Drag stops here</p>
          )}
        </DroppableZone>
      </CardContent>
    </Card>
  );
}

function RouteFormDialog({ open, onOpenChange, editingRoute, team, onSubmit, isSubmitting }: {
  open: boolean; onOpenChange: (open: boolean) => void; editingRoute: Route | null;
  team: TeamMember[]; onSubmit: (data: { name: string; dayOfWeek: string; technicianId: string | null; color: string }) => void;
  isSubmitting: boolean;
}) {
  const [name, setName] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState<string>("monday");
  const [technicianId, setTechnicianId] = useState<string>("");
  const [color, setColor] = useState(ROUTE_COLORS[0]);

  useEffect(() => {
    if (open) {
      if (editingRoute) {
        setName(editingRoute.name); setDayOfWeek(editingRoute.dayOfWeek);
        setTechnicianId(editingRoute.technicianId || ""); setColor(editingRoute.color || ROUTE_COLORS[0]);
      } else {
        setName(""); setDayOfWeek("monday"); setTechnicianId("");
        setColor(ROUTE_COLORS[Math.floor(Math.random() * ROUTE_COLORS.length)]);
      }
    }
  }, [open, editingRoute]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-route-form">
        <DialogHeader>
          <DialogTitle>{editingRoute ? "Edit Route" : "Create Route"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="route-name">Route Name</Label>
            <Input id="route-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. North Side AM" data-testid="input-route-name" />
          </div>
          <div className="space-y-2">
            <Label>Day of Week</Label>
            <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
              <SelectTrigger data-testid="select-route-day"><SelectValue /></SelectTrigger>
              <SelectContent>{DAYS.map(d => <SelectItem key={d} value={d}>{DAY_LABELS[d]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Assigned Technician</Label>
            <Select value={technicianId || "none"} onValueChange={v => setTechnicianId(v === "none" ? "" : v)}>
              <SelectTrigger data-testid="select-route-tech"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {team.map(t => <SelectItem key={t.id} value={t.id}>{t.firstName} {t.lastName} ({t.role})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex items-center gap-2 flex-wrap">
              {ROUTE_COLORS.map(c => (
                <button key={c} type="button"
                  className={`w-7 h-7 rounded-full border-2 transition-all ${color === c ? "border-foreground scale-110" : "border-transparent"}`}
                  style={{ backgroundColor: c }} onClick={() => setColor(c)} data-testid={`button-color-${c.replace("#", "")}`} />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-route">Cancel</Button>
          <Button disabled={!name.trim() || isSubmitting}
            onClick={() => onSubmit({ name: name.trim(), dayOfWeek, technicianId: technicianId || null, color })}
            data-testid="button-save-route"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {editingRoute ? "Save Changes" : "Create Route"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SavingsSummaryDialog({ open, onOpenChange, result }: {
  open: boolean; onOpenChange: (open: boolean) => void; result: OptimizeResult | null;
}) {
  if (!result) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="dialog-savings-summary">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-primary" />
            Optimization Results
          </DialogTitle>
          <DialogDescription>Route has been optimized for minimum travel time.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-primary" data-testid="text-miles-saved">{result.milesSaved}</p>
                <p className="text-xs text-muted-foreground">Miles Saved</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-primary" data-testid="text-minutes-saved">{result.minutesSaved}</p>
                <p className="text-xs text-muted-foreground">Minutes Saved</p>
              </CardContent>
            </Card>
          </div>
          <div className="text-sm space-y-1 text-muted-foreground">
            <div className="flex justify-between">
              <span>Original distance:</span>
              <span className="font-medium text-foreground">{result.originalDistance.toFixed(1)} mi</span>
            </div>
            <div className="flex justify-between">
              <span>Optimized distance:</span>
              <span className="font-medium text-foreground">{result.totalDistance.toFixed(1)} mi</span>
            </div>
            <div className="flex justify-between">
              <span>Stops optimized:</span>
              <span className="font-medium text-foreground">{result.stopCount}</span>
            </div>
            <div className="flex justify-between">
              <span>Credits used:</span>
              <span className="font-medium text-foreground">{result.creditsUsed}</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} data-testid="button-close-savings">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PurchaseCreditsDialog({ open, onOpenChange, onPurchase, isPurchasing }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  onPurchase: (amount: number) => void; isPurchasing: boolean;
}) {
  const [amount, setAmount] = useState(10);
  const packs = [
    { credits: 5, label: "5 Credits" },
    { credits: 10, label: "10 Credits" },
    { credits: 25, label: "25 Credits" },
    { credits: 50, label: "50 Credits" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="dialog-purchase-credits">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Purchase Route Credits
          </DialogTitle>
          <DialogDescription>
            Each credit optimizes one route of up to 30 stops. Routes with 31-60 stops require 2 credits.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {packs.map(p => (
            <Button key={p.credits} variant={amount === p.credits ? "default" : "outline"}
              onClick={() => setAmount(p.credits)} className="flex flex-col h-auto py-3"
              data-testid={`button-pack-${p.credits}`}
            >
              <span className="text-lg font-bold">{p.credits}</span>
              <span className="text-xs">credits</span>
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onPurchase(amount)} disabled={isPurchasing} data-testid="button-confirm-purchase">
            {isPurchasing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Add {amount} Credits
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RoutesPage() {
  const { toast } = useToast();
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(() => {
    const today = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase() as DayOfWeek;
    return DAYS.includes(today) ? today : "monday";
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overContainerId, setOverContainerId] = useState<string | null>(null);
  const [optimizingRouteId, setOptimizingRouteId] = useState<string | null>(null);
  const [dispatchingRouteId, setDispatchingRouteId] = useState<string | null>(null);
  const [unassignedSearch, setUnassignedSearch] = useState("");
  const [confirmOptimize, setConfirmOptimize] = useState<{ routeId: string; stopCount: number } | null>(null);
  const [savingsResult, setSavingsResult] = useState<OptimizeResult | null>(null);
  const [showSavings, setShowSavings] = useState(false);
  const [showPurchase, setShowPurchase] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const { data: allRoutes = [], isLoading: routesLoading } = useQuery<Route[]>({ queryKey: ["/api/routes"] });
  const { data: servicePlans = [], isLoading: plansLoading } = useQuery<ServicePlan[]>({ queryKey: ["/api/service-plans?isActive=true"] });
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: properties = [] } = useQuery<Property[]>({ queryKey: ["/api/properties"] });
  const { data: team = [] } = useQuery<TeamMember[]>({ queryKey: ["/api/company/team"] });
  const { data: creditData } = useQuery<{ credits: number }>({ queryKey: ["/api/route-credits"] });
  const credits = creditData?.credits ?? 0;

  const isLoading = routesLoading || plansLoading;

  const routesForDay = useMemo(() => allRoutes.filter(r => r.dayOfWeek === selectedDay), [allRoutes, selectedDay]);

  const routeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of DAYS) counts[d] = allRoutes.filter(r => r.dayOfWeek === d).length;
    return counts;
  }, [allRoutes]);

  const stopsByRoute = useMemo(() => {
    const map: Record<string, ServicePlan[]> = {};
    for (const r of allRoutes) map[r.id] = [];
    for (const sp of servicePlans) {
      if (sp.routeId && map[sp.routeId]) map[sp.routeId].push(sp);
    }
    return map;
  }, [allRoutes, servicePlans]);

  const unassignedPlans = useMemo(() => {
    return servicePlans.filter(sp => !sp.routeId).filter(sp => {
      if (!unassignedSearch) return true;
      const contact = contacts.find(c => c.id === sp.contactId);
      const property = properties.find(p => p.id === sp.propertyId);
      const search = unassignedSearch.toLowerCase();
      return (
        (contact && `${contact.firstName} ${contact.lastName}`.toLowerCase().includes(search)) ||
        (property && property.streetAddress?.toLowerCase().includes(search))
      );
    });
  }, [servicePlans, unassignedSearch, contacts, properties]);

  const activeDragStop = useMemo(() => {
    if (!activeDragId) return null;
    return servicePlans.find(sp => sp.id === activeDragId) || null;
  }, [activeDragId, servicePlans]);

  const dayStopCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of DAYS) {
      const dayRouteIds = new Set(allRoutes.filter(r => r.dayOfWeek === d).map(r => r.id));
      counts[d] = servicePlans.filter(sp => sp.routeId && dayRouteIds.has(sp.routeId)).length;
    }
    return counts;
  }, [allRoutes, servicePlans]);

  const createRouteMutation = useMutation({
    mutationFn: async (data: { name: string; dayOfWeek: string; technicianId: string | null; color: string }) => {
      const res = await apiRequest("POST", "/api/routes", data); return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/routes"] }); setDialogOpen(false); toast({ title: "Route created" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateRouteMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name: string; dayOfWeek: string; technicianId: string | null; color: string }) => {
      const res = await apiRequest("PATCH", `/api/routes/${id}`, data); return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/routes"] }); setDialogOpen(false); toast({ title: "Route updated" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteRouteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/routes/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/routes"] }); toast({ title: "Route deleted" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const assignStopMutation = useMutation({
    mutationFn: async ({ stopId, routeId }: { stopId: string; routeId: string | null }) => {
      await apiRequest("PATCH", `/api/service-plans/${stopId}`, { routeId });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/service-plans?isActive=true"] }); },
    onError: (err: Error) => toast({ title: "Error moving stop", description: err.message, variant: "destructive" }),
  });

  const optimizeRouteMutation = useMutation({
    mutationFn: async (routeId: string) => {
      setOptimizingRouteId(routeId);
      const res = await apiRequest("POST", `/api/routes/${routeId}/optimize`);
      return res.json() as Promise<OptimizeResult>;
    },
    onSuccess: (data) => {
      setOptimizingRouteId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans?isActive=true"] });
      queryClient.invalidateQueries({ queryKey: ["/api/route-credits"] });
      if (data.optimized) {
        setSavingsResult(data);
        setShowSavings(true);
      } else {
        toast({ title: "Could not optimize", description: data.message });
      }
    },
    onError: (err: Error) => {
      setOptimizingRouteId(null);
      if (err.message.includes("Insufficient")) {
        setShowPurchase(true);
      } else {
        toast({ title: "Optimization failed", description: err.message, variant: "destructive" });
      }
    },
  });

  const dispatchMutation = useMutation({
    mutationFn: async (routeId: string) => {
      setDispatchingRouteId(routeId);
      const res = await apiRequest("POST", `/api/routes/${routeId}/dispatch`, { date: new Date().toISOString().split("T")[0] });
      return res.json();
    },
    onSuccess: (data: any) => {
      setDispatchingRouteId(null);
      toast({ title: "Route dispatched", description: `${data.visitsCreated} visits created for ${data.date}${data.visitsSkipped > 0 ? ` (${data.visitsSkipped} already existed)` : ""}` });
    },
    onError: (err: Error) => {
      setDispatchingRouteId(null);
      toast({ title: "Dispatch failed", description: err.message, variant: "destructive" });
    },
  });

  const purchaseCreditsMutation = useMutation({
    mutationFn: async (amount: number) => {
      const res = await apiRequest("POST", "/api/route-credits/add", { amount }); return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/route-credits"] });
      setShowPurchase(false);
      toast({ title: "Credits added", description: `You now have ${data.credits} route credits.` });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const resolveDropTarget = useCallback((overId: string): string | null => {
    if (overId === UNASSIGNED_DROP) return UNASSIGNED_DROP;
    if (overId.startsWith("route-")) return overId;
    const plan = servicePlans.find(sp => sp.id === overId);
    if (plan) return plan.routeId ? `route-${plan.routeId}` : UNASSIGNED_DROP;
    return null;
  }, [servicePlans]);

  function handleDragStart(event: DragStartEvent) { setActiveDragId(event.active.id as string); }
  function handleDragOver(event: DragOverEvent) {
    const overId = event.over?.id as string | null;
    setOverContainerId(overId ? resolveDropTarget(overId) : null);
  }
  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null); setOverContainerId(null);
    const { active, over } = event;
    if (!over) return;
    const stopId = active.id as string;
    const target = resolveDropTarget(over.id as string);
    if (!target) return;
    const plan = servicePlans.find(sp => sp.id === stopId);
    if (!plan) return;
    const currentContainer = plan.routeId ? `route-${plan.routeId}` : UNASSIGNED_DROP;
    if (currentContainer === target) return;
    const newRouteId = target === UNASSIGNED_DROP ? null : target.replace("route-", "");
    assignStopMutation.mutate({ stopId, routeId: newRouteId });
  }
  function handleDragCancel() { setActiveDragId(null); setOverContainerId(null); }

  function handleRouteFormSubmit(data: { name: string; dayOfWeek: string; technicianId: string | null; color: string }) {
    if (editingRoute) updateRouteMutation.mutate({ id: editingRoute.id, ...data });
    else createRouteMutation.mutate(data);
  }

  function handleOptimizeClick(routeId: string, stopCount: number) {
    if (credits < (stopCount <= 30 ? 1 : 2)) {
      setShowPurchase(true);
      return;
    }
    setConfirmOptimize({ routeId, stopCount });
  }

  function handleConfirmOptimize() {
    if (!confirmOptimize) return;
    optimizeRouteMutation.mutate(confirmOptimize.routeId);
    setConfirmOptimize(null);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 md:p-6 pb-0 space-y-4 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold" data-testid="text-routes-heading">Route Builder</h1>
            <Badge variant="outline" className="flex items-center gap-1.5 text-sm px-3 py-1" data-testid="badge-credits">
              <Coins className="h-4 w-4" />
              Available Credits: {credits}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowPurchase(true)} data-testid="button-buy-credits">
              <ShoppingCart className="h-4 w-4 mr-1" /> Buy Credits
            </Button>
            <Button size="sm" onClick={() => { setEditingRoute(null); setDialogOpen(true); }} data-testid="button-create-route">
              <Plus className="h-4 w-4 mr-1" /> New Route
            </Button>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto pb-1">
          {DAYS.map(day => (
            <Button key={day} variant={selectedDay === day ? "default" : "secondary"}
              onClick={() => setSelectedDay(day)}
              className="flex flex-col items-center px-3 py-2 h-auto whitespace-nowrap"
              data-testid={`button-day-${day}`}
            >
              <span className="text-xs">{DAY_SHORT[day]}</span>
              <span className="text-lg font-bold leading-tight">{routeCounts[day] || 0}</span>
              <span className="text-[10px] opacity-70">{dayStopCounts[day] || 0} stops</span>
            </Button>
          ))}
        </div>
      </div>

      <Separator className="shrink-0" />

      {isLoading ? (
        <div className="p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-60 w-full" />)}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter}
          onDragStart={handleDragStart} onDragOver={handleDragOver}
          onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}
        >
          <div className="flex-1 overflow-auto p-4 md:p-6 pt-4">
            <div className="flex flex-col lg:flex-row gap-4 h-full">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold flex items-center gap-2" data-testid="text-day-heading">
                    <RouteIcon className="h-5 w-5" />{DAY_LABELS[selectedDay]} Routes
                  </h2>
                  <span className="text-sm text-muted-foreground">
                    {routesForDay.length} {routesForDay.length === 1 ? "route" : "routes"}
                  </span>
                </div>

                {routesForDay.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="p-8 text-center">
                      <RouteIcon className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                      <p className="text-muted-foreground mb-3">No routes for {DAY_LABELS[selectedDay]}</p>
                      <Button variant="outline" onClick={() => { setEditingRoute(null); setDialogOpen(true); }} data-testid="button-create-route-empty">
                        <Plus className="h-4 w-4 mr-1" /> Create a Route
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {routesForDay.map(route => (
                      <RouteCard key={route.id} route={route}
                        stops={stopsByRoute[route.id] || []}
                        contacts={contacts} properties={properties} team={team}
                        isOverThis={overContainerId === `route-${route.id}`}
                        credits={credits}
                        onEdit={(r) => { setEditingRoute(r); setDialogOpen(true); }}
                        onDelete={(r) => {
                          if ((stopsByRoute[r.id]?.length || 0) > 0) {
                            toast({ title: "Cannot delete", description: "Remove all stops first.", variant: "destructive" });
                          } else { deleteRouteMutation.mutate(r.id); }
                        }}
                        onOptimize={handleOptimizeClick}
                        onDispatch={(id) => dispatchMutation.mutate(id)}
                        isOptimizing={optimizingRouteId === route.id}
                        isDispatching={dispatchingRouteId === route.id}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="lg:w-80 xl:w-96 shrink-0">
                <Card className="h-full max-h-[calc(100vh-280px)] flex flex-col" data-testid="card-unassigned">
                  <CardHeader className="p-3 pb-2 space-y-2 shrink-0">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-orange-500" />
                        Unassigned Jobs
                        <Badge variant="secondary" data-testid="badge-unassigned-count">{unassignedPlans.length}</Badge>
                      </CardTitle>
                    </div>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input placeholder="Search by name or address..." className="pl-8 h-8 text-sm"
                        value={unassignedSearch} onChange={e => setUnassignedSearch(e.target.value)}
                        data-testid="input-unassigned-search" />
                    </div>
                  </CardHeader>
                  <CardContent className="p-2 pt-0 flex-1 overflow-hidden">
                    <ScrollArea className="h-full">
                      <DroppableZone id={UNASSIGNED_DROP} isOver={overContainerId === UNASSIGNED_DROP}>
                        {unassignedPlans.length > 0 ? (
                          unassignedPlans.map(stop => (
                            <DraggableStop key={stop.id} stop={stop} contacts={contacts} properties={properties} />
                          ))
                        ) : (
                          <p className="text-xs text-muted-foreground text-center py-6">
                            {servicePlans.length === 0 ? "No service plans yet" : "All jobs assigned"}
                          </p>
                        )}
                      </DroppableZone>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>

          <DragOverlay>
            {activeDragStop ? <StopOverlay stop={activeDragStop} contacts={contacts} properties={properties} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      <RouteFormDialog open={dialogOpen} onOpenChange={setDialogOpen}
        editingRoute={editingRoute} team={team} onSubmit={handleRouteFormSubmit}
        isSubmitting={createRouteMutation.isPending || updateRouteMutation.isPending} />

      <AlertDialog open={!!confirmOptimize} onOpenChange={(open) => { if (!open) setConfirmOptimize(null); }}>
        <AlertDialogContent data-testid="dialog-confirm-optimize">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Route Optimization</AlertDialogTitle>
            <AlertDialogDescription>
              This will use {confirmOptimize && confirmOptimize.stopCount <= 30 ? "1 Route Credit" : "2 Route Credits"} to optimize this route.
              You currently have {credits} credits available. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-optimize">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmOptimize} data-testid="button-confirm-optimize">
              Use {confirmOptimize && confirmOptimize.stopCount <= 30 ? "1 Credit" : "2 Credits"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SavingsSummaryDialog open={showSavings} onOpenChange={setShowSavings} result={savingsResult} />
      <PurchaseCreditsDialog open={showPurchase} onOpenChange={setShowPurchase}
        onPurchase={(amount) => purchaseCreditsMutation.mutate(amount)}
        isPurchasing={purchaseCreditsMutation.isPending} />
    </div>
  );
}
