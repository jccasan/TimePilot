import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Route, ServicePlan, Contact, Property, Visit } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  MapPin, Dog, GripVertical, Plus, Pencil, Trash2, Route as RouteIcon,
  Navigation, AlertCircle, User, Search, Loader2, Send, Coins, TrendingDown,
  Clock, ShoppingCart, RotateCcw, Map, List, Save, ChevronDown, ChevronUp,
  CheckCircle, XCircle, SkipForward, MoreVertical, Car, Ban, CalendarCheck,
  CalendarDays, DollarSign, Play
} from "lucide-react";
import { Link } from "wouter";
import { ClientInfoPopover } from "@/components/client-info-popover";
import { LearnHowButton } from "@/components/interactive-tutorial";
import { useTutorialContext } from "@/hooks/use-tutorials";
import RouteMapView, { type RouteStop } from "@/components/route-map-view";
import { ServiceZoneMap, type ZoneEntry } from "@/components/service-zone-map";
import {
  DndContext, DragOverlay, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, useDroppable, useDraggable,
  type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from "@dnd-kit/core";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type DayOfWeek = typeof DAYS[number];
const DAY_LABELS: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday",
  friday: "Friday", saturday: "Saturday", sunday: "Sunday", tbd: "TBD",
};
const DAY_SHORT: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun", tbd: "TBD",
};
const UNASSIGNED_DROP = "__unassigned__";

const visitStatusColors: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  in_progress: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  skipped: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const visitStatusLabels: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
  skipped: "Skipped",
  cancelled: "Cancelled",
};
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

type RouteMetrics = {
  totalDistance: number;
  totalDuration: number;
  legs: { fromId: string | null; toId: string; distance: number; duration: number }[];
  stopCount: number;
  missingCoords?: string[];
  error?: string;
};

function LegSeparator({ distance, duration }: { distance: number; duration: number }) {
  return (
    <div className="flex items-center gap-1.5 py-0.5 px-2 text-[10px] text-muted-foreground" data-testid="leg-separator">
      <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
      <Car className="h-2.5 w-2.5" />
      <span>{distance < 0.1 ? "<0.1" : distance.toFixed(1)} mi</span>
      <span className="text-muted-foreground/50">|</span>
      <span>{duration < 1 ? "<1" : Math.round(duration)} min</span>
      <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
    </div>
  );
}

function DraggableStop({ stop, contacts, properties, visit, onVisitStatusChange, updatingVisitId, updatingVisitStatus, onStopClick }: {
  stop: ServicePlan; contacts: Contact[]; properties: Property[];
  visit?: Visit | null; onVisitStatusChange?: (visitId: string, status: string) => void;
  updatingVisitId?: string | null;
  updatingVisitStatus?: string | null;
  onStopClick?: (stop: ServicePlan, visit: Visit) => void;
}) {
  const contact = contacts.find(c => c.id === stop.contactId);
  const property = properties.find(p => p.id === stop.propertyId);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: stop.id, data: { stop },
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const isCompleted = visit?.status === "completed";
  const isSkipped = visit?.status === "skipped";
  const isCancelled = visit?.status === "cancelled";
  const isDone = isCompleted || isSkipped || isCancelled;

  return (
    <div ref={setNodeRef} style={style}
      className={`border rounded-md p-2.5 bg-background transition-all ${isDragging ? "opacity-30" : ""} ${isCompleted ? "border-green-300 dark:border-green-800 opacity-70" : ""} ${isSkipped ? "border-orange-300 dark:border-orange-800 opacity-60" : ""} ${isCancelled ? "border-red-300 dark:border-red-800 opacity-50" : ""}`}
      data-testid={`draggable-stop-${stop.id}`}
    >
      <div className="flex items-start gap-2">
        <div className="cursor-grab active:cursor-grabbing touch-none pt-0.5 shrink-0" {...listeners} {...attributes}>
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between gap-1">
            {contact ? (
              <span
                className={`font-medium text-sm truncate ${isDone ? "line-through text-muted-foreground" : ""} ${visit && onStopClick ? "cursor-pointer hover:underline" : ""}`}
                role={visit && onStopClick ? "button" : undefined}
                tabIndex={visit && onStopClick ? 0 : undefined}
                onClick={() => { if (visit && onStopClick) onStopClick(stop, visit); }}
                onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && visit && onStopClick) { e.preventDefault(); onStopClick(stop, visit); } }}
                data-testid={`text-stop-name-${stop.id}`}
              >
                {contact.firstName} {contact.lastName}
              </span>
            ) : (
              <span className="font-medium text-sm truncate text-muted-foreground" data-testid={`text-stop-name-${stop.id}`}>Unknown</span>
            )}
            <div className="flex items-center gap-1 shrink-0">
              {visit && (
                <Badge variant="secondary" className={`text-[10px] px-1 py-0 ${visitStatusColors[visit.status] || ""}`} data-testid={`badge-visit-status-${stop.id}`}>
                  {isCompleted && <CheckCircle className="h-2.5 w-2.5 mr-0.5" />}
                  {visitStatusLabels[visit.status] || visit.status}
                </Badge>
              )}
              {stop.frequency === "onetime" && (
                <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" data-testid={`badge-onetime-${stop.id}`}>
                  One-Time
                </Badge>
              )}
              {stop.stopOrder > 0 && (
                <Badge variant="outline" className="text-[10px]" data-testid={`badge-stop-order-${stop.id}`}>
                  #{stop.stopOrder}
                </Badge>
              )}
              {visit && onVisitStatusChange && visit.status !== "completed" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30 hover:text-green-700"
                  onClick={(e) => { e.stopPropagation(); onVisitStatusChange(visit.id, "completed"); }}
                  disabled={updatingVisitId === visit.id}
                  data-testid={`button-complete-${stop.id}`}
                  title="Mark Completed"
                >
                  {updatingVisitId === visit.id && updatingVisitStatus === "completed" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                </Button>
              )}
              {visit && onVisitStatusChange && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-5 w-5" disabled={updatingVisitId === visit?.id} data-testid={`button-visit-menu-${stop.id}`}>
                      {updatingVisitId === visit?.id && updatingVisitStatus !== "completed" ? <Loader2 className="h-3 w-3 animate-spin" /> : <MoreVertical className="h-3 w-3" />}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {visit.status !== "completed" && (
                      <DropdownMenuItem onClick={() => onVisitStatusChange(visit.id, "completed")} disabled={updatingVisitId === visit.id} data-testid={`menu-complete-${stop.id}`}>
                        {updatingVisitId === visit.id && updatingVisitStatus === "completed" ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5 mr-2 text-green-600" />} Mark Completed
                      </DropdownMenuItem>
                    )}
                    {visit.status !== "skipped" && (
                      <DropdownMenuItem onClick={() => onVisitStatusChange(visit.id, "skipped")} disabled={updatingVisitId === visit.id} data-testid={`menu-skip-${stop.id}`}>
                        {updatingVisitId === visit.id && updatingVisitStatus === "skipped" ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <SkipForward className="h-3.5 w-3.5 mr-2 text-orange-600" />} Mark Skipped
                      </DropdownMenuItem>
                    )}
                    {visit.status !== "cancelled" && (
                      <DropdownMenuItem onClick={() => onVisitStatusChange(visit.id, "cancelled")} disabled={updatingVisitId === visit.id} data-testid={`menu-cancel-${stop.id}`}>
                        {updatingVisitId === visit.id && updatingVisitStatus === "cancelled" ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <XCircle className="h-3.5 w-3.5 mr-2 text-red-600" />} Mark Cancelled
                      </DropdownMenuItem>
                    )}
                    {visit.status !== "scheduled" && (
                      <DropdownMenuItem onClick={() => onVisitStatusChange(visit.id, "scheduled")} disabled={updatingVisitId === visit.id} data-testid={`menu-revert-${stop.id}`}>
                        {updatingVisitId === visit.id && updatingVisitStatus === "scheduled" ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Clock className="h-3.5 w-3.5 mr-2 text-blue-600" />} Revert to Scheduled
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          {property && (
            <div
              className={`flex items-center gap-1 text-xs text-muted-foreground ${visit && onStopClick ? "cursor-pointer hover:text-foreground" : ""}`}
              role={visit && onStopClick ? "button" : undefined}
              tabIndex={visit && onStopClick ? 0 : undefined}
              onClick={() => { if (visit && onStopClick) onStopClick(stop, visit); }}
              onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && visit && onStopClick) { e.preventDefault(); onStopClick(stop, visit); } }}
              data-testid={`clickable-address-${stop.id}`}
            >
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
      <div className="flex items-center gap-2">
        <p className="font-medium text-sm">{contact ? `${contact.firstName} ${contact.lastName}` : "Unknown"}</p>
        {stop.frequency === "onetime" && (
          <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">One-Time</Badge>
        )}
      </div>
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
  onEdit, onDelete, onOptimize, onDispatch, onUnassignAll, isOptimizing, isDispatching, isUnassigning,
  visitsByPlan, onVisitStatusChange, updatingVisitId, updatingVisitStatus, metrics, metricsLoading, onStopClick }: {
  route: Route; stops: ServicePlan[]; contacts: Contact[]; properties: Property[];
  team: TeamMember[]; isOverThis: boolean; credits: number;
  onEdit: (route: Route) => void; onDelete: (route: Route) => void;
  onOptimize: (routeId: string, stopCount: number) => void;
  onDispatch: (routeId: string) => void;
  onUnassignAll: (routeId: string) => void;
  isOptimizing: boolean; isDispatching: boolean; isUnassigning: boolean;
  visitsByPlan?: Record<string, Visit>;
  onVisitStatusChange?: (visitId: string, status: string) => void;
  updatingVisitId?: string | null;
  updatingVisitStatus?: string | null;
  metrics?: RouteMetrics | null;
  metricsLoading?: boolean;
  onStopClick?: (stop: ServicePlan, visit: Visit) => void;
}) {
  const tech = team.find(t => t.id === route.technicianId);
  const sortedStops = [...stops].sort((a, b) => a.stopOrder - b.stopOrder);
  const totalRevenue = stops.reduce((sum, s) => sum + Number(s.pricePerVisit), 0);
  const stopCount = stops.length;
  const routeVisitCount = visitsByPlan ? sortedStops.filter(s => visitsByPlan[s.id]).length : 0;
  const processedCount = visitsByPlan ? sortedStops.filter(s => {
    const st = visitsByPlan[s.id]?.status;
    return st === "completed" || st === "skipped" || st === "cancelled";
  }).length : 0;
  const hasVisits = routeVisitCount > 0;
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
          {metricsLoading && <Loader2 className="h-3 w-3 animate-spin" />}
          {metrics && metrics.totalDistance > 0 && (
            <span className="flex items-center gap-1" data-testid={`text-route-metrics-${route.id}`}>
              <Car className="h-3 w-3" />
              {metrics.totalDistance} mi
              <span className="text-muted-foreground/50">|</span>
              {metrics.totalDuration >= 60
                ? `${Math.floor(metrics.totalDuration / 60)}h ${metrics.totalDuration % 60}m`
                : `${metrics.totalDuration} min`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={isOverMax ? "destructive" : isOverLimit ? "secondary" : "outline"}
            className={isOverLimit && !isOverMax ? "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" : ""}
            data-testid={`badge-stop-counter-${route.id}`}
          >
            {stopCount} of {stopCount <= 30 ? 30 : 60} stops
          </Badge>
          {isOverMax && <span className="text-xs text-destructive">Max 60 stops</span>}
          {hasVisits && routeVisitCount > 0 && (
            <Badge variant="outline" className={`text-[10px] ${processedCount === routeVisitCount ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : ""}`} data-testid={`badge-completion-${route.id}`}>
              <CheckCircle className="h-2.5 w-2.5 mr-0.5" />
              {processedCount} of {routeVisitCount} processed
            </Badge>
          )}
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
            Send to Tech
          </Button>
        </div>

        {stopCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="w-full text-xs text-destructive"
            onClick={() => onUnassignAll(route.id)}
            disabled={isUnassigning}
            data-testid={`button-unassign-all-${route.id}`}
          >
            {isUnassigning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RotateCcw className="h-3 w-3 mr-1" />}
            Unassign All Stops
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-2 pt-0 flex-1">
        <DroppableZone id={`route-${route.id}`} isOver={isOverThis}>
          {sortedStops.length > 0 ? (
            sortedStops.map((stop, idx) => {
              const leg = metrics?.legs?.find(l => l.toId === stop.id);
              return (
                <div key={stop.id}>
                  {idx > 0 && leg && (
                    <LegSeparator distance={leg.distance} duration={leg.duration} />
                  )}
                  {idx === 0 && metrics?.legs?.[0]?.fromId === null && metrics.legs[0]?.toId === stop.id && (
                    <LegSeparator distance={metrics.legs[0].distance} duration={metrics.legs[0].duration} />
                  )}
                  <DraggableStop stop={stop} contacts={contacts} properties={properties}
                    visit={visitsByPlan?.[stop.id] || null}
                    onVisitStatusChange={onVisitStatusChange}
                    updatingVisitId={updatingVisitId}
                    updatingVisitStatus={updatingVisitStatus}
                    onStopClick={onStopClick}
                  />
                </div>
              );
            })
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">Drag stops here</p>
          )}
        </DroppableZone>
      </CardContent>
    </Card>
  );
}

function RouteVisitDetailSheet({
  visit, servicePlan, open, onOpenChange, contacts, properties, routes, selectedDayDate,
}: {
  visit: Visit | null;
  servicePlan: ServicePlan | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: Contact[];
  properties: Property[];
  routes: Route[];
  selectedDayDate: string;
}) {
  const { toast } = useToast();
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

  const statusMutation = useMutation({
    mutationFn: async ({ visitId, status }: { visitId: string; status: string }) => {
      setUpdatingStatus(status);
      const body: Record<string, unknown> = { status };
      if (status === "in_progress") body.startedAt = new Date().toISOString();
      if (status === "completed") body.completedAt = new Date().toISOString();
      if (status === "scheduled") {
        body.completedAt = null;
        body.startedAt = null;
      }
      await apiRequest("PATCH", `/api/visits/${visitId}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/visits/range", selectedDayDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/uninvoiced-summary"] });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey.includes("uninvoiced-visits") });
      toast({ title: "Visit updated" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
    onSettled: () => setUpdatingStatus(null),
  });

  if (!visit || !servicePlan) return null;

  const contact = contacts.find((c) => c.id === servicePlan.contactId);
  const property = properties.find((p) => p.id === visit.propertyId);
  const route = routes.find((r) => r.id === visit.routeId);
  const frequencyLabel = servicePlan.frequency.charAt(0).toUpperCase() + servicePlan.frequency.slice(1);
  const pricePerVisit = parseFloat(servicePlan.pricePerVisit) || 0;

  const statusActions: { status: string; label: string; icon: typeof CheckCircle; color: string; show: boolean }[] = [
    {
      status: "in_progress",
      label: "Mark In Progress",
      icon: Play,
      color: "text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800",
      show: visit.status === "scheduled",
    },
    {
      status: "completed",
      label: "Mark Complete",
      icon: CheckCircle,
      color: "text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30 border-green-200 dark:border-green-800",
      show: visit.status !== "completed",
    },
    {
      status: "skipped",
      label: "Skip Visit",
      icon: XCircle,
      color: "text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 border-amber-200 dark:border-amber-800",
      show: visit.status !== "skipped" && visit.status !== "completed",
    },
    {
      status: "cancelled",
      label: "Cancel Visit",
      icon: Ban,
      color: "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 border-red-200 dark:border-red-800",
      show: visit.status !== "cancelled" && visit.status !== "completed",
    },
    {
      status: "scheduled",
      label: "Revert to Scheduled",
      icon: Clock,
      color: "text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 border-blue-200 dark:border-blue-800",
      show: visit.status !== "scheduled",
    },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" data-testid="sheet-route-visit-detail">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-lg" data-testid="text-route-sheet-title">Visit Details</SheetTitle>
          <SheetDescription>
            {visit.scheduledDate ? new Date(visit.scheduledDate + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <Badge className={`${visitStatusColors[visit.status] || ""}`} data-testid="badge-route-visit-status">
              {visitStatusLabels[visit.status] || visit.status}
            </Badge>
            {visit.status === "completed" && !visit.invoiceId && (
              <Badge variant="outline" className="text-orange-600 border-orange-300 dark:border-orange-700" data-testid="badge-route-needs-invoice">
                <DollarSign className="h-3 w-3 mr-0.5" />Needs Invoice
              </Badge>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            {contact && (
              <div className="flex items-start gap-3">
                <User className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Client</p>
                  <Link href={`/contacts/${contact.id}`}>
                    <span className="text-sm font-medium hover:underline cursor-pointer" data-testid="link-route-visit-contact">
                      {contact.firstName} {contact.lastName}
                    </span>
                  </Link>
                </div>
              </div>
            )}

            {property && (
              <div className="flex items-start gap-3">
                <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Property</p>
                  <p className="text-sm" data-testid="text-route-visit-address">
                    {property.streetAddress}
                    {property.city ? `, ${property.city}` : ""}
                    {property.state ? ` ${property.state}` : ""}
                    {property.zipCode ? ` ${property.zipCode}` : ""}
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3">
              <CalendarCheck className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Service</p>
                <p className="text-sm" data-testid="text-route-visit-service">{frequencyLabel} Cleanup</p>
              </div>
            </div>

            {route && (
              <div className="flex items-start gap-3">
                <RouteIcon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Route</p>
                  <p className="text-sm" data-testid="text-route-visit-route">{route.name}</p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3">
              <DollarSign className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Amount</p>
                <p className="text-sm font-medium" data-testid="text-route-visit-amount">${pricePerVisit.toFixed(2)}</p>
              </div>
            </div>

            {visit.startedAt && (
              <div className="flex items-start gap-3">
                <Clock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Started</p>
                  <p className="text-sm">{new Date(visit.startedAt).toLocaleString()}</p>
                </div>
              </div>
            )}

            {visit.completedAt && (
              <div className="flex items-start gap-3">
                <CheckCircle className="h-4 w-4 mt-0.5 text-green-600 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Completed</p>
                  <p className="text-sm">{new Date(visit.completedAt).toLocaleString()}</p>
                </div>
              </div>
            )}

            {visit.technicianNotes && (
              <div className="flex items-start gap-3">
                <CalendarDays className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Technician Notes</p>
                  <p className="text-sm italic" data-testid="text-route-visit-notes">{visit.technicianNotes}</p>
                </div>
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</p>
            <div className="grid grid-cols-1 gap-2">
              {statusActions.filter(a => a.show).map((action) => {
                const Icon = action.icon;
                const isUpdating = updatingStatus === action.status;
                return (
                  <Button
                    key={action.status}
                    variant="outline"
                    className={`justify-start gap-2 ${action.color}`}
                    onClick={() => statusMutation.mutate({ visitId: visit.id, status: action.status })}
                    disabled={statusMutation.isPending}
                    data-testid={`button-route-action-${action.status}`}
                  >
                    {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                    {action.label}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
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
  const { startTutorial, isTutorialCompleted } = useTutorialContext();
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
  const [unassigningRouteId, setUnassigningRouteId] = useState<string | null>(null);
  const [confirmUnassignAll, setConfirmUnassignAll] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [showZones, setShowZones] = useState(false);

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

  const selectedDayDate = useMemo(() => {
    const now = new Date();
    const todayIdx = (now.getDay() + 6) % 7;
    const targetIdx = DAYS.indexOf(selectedDay);
    const diff = targetIdx - todayIdx;
    const target = new Date(now);
    target.setDate(now.getDate() + diff);
    return target.toISOString().split("T")[0];
  }, [selectedDay]);

  const { data: dayVisits = [] } = useQuery<Visit[]>({
    queryKey: ["/api/visits/range", selectedDayDate],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/visits/range?start=${selectedDayDate}&end=${selectedDayDate}`);
      return res.json();
    },
  });

  const visitsByPlan = useMemo(() => {
    const map: Record<string, Visit> = {};
    for (const v of dayVisits) {
      if (v.servicePlanId) map[v.servicePlanId] = v;
    }
    return map;
  }, [dayVisits]);

  const [updatingVisitId, setUpdatingVisitId] = useState<string | null>(null);
  const [updatingVisitStatus, setUpdatingVisitStatus] = useState<string | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [detailVisit, setDetailVisit] = useState<Visit | null>(null);
  const [detailPlan, setDetailPlan] = useState<ServicePlan | null>(null);

  const handleStopClick = useCallback((stop: ServicePlan, visit: Visit) => {
    setDetailPlan(stop);
    setDetailVisit(visit);
    setDetailSheetOpen(true);
  }, []);
  const visitStatusMutation = useMutation({
    mutationFn: async ({ visitId, status }: { visitId: string; status: string }) => {
      setUpdatingVisitId(visitId);
      setUpdatingVisitStatus(status);
      const body: { status: string; completedAt?: string | null; startedAt?: string | null } = { status };
      if (status === "in_progress") {
        body.startedAt = new Date().toISOString();
      } else if (status === "completed") {
        body.completedAt = new Date().toISOString();
      } else if (status === "scheduled") {
        body.completedAt = null;
        body.startedAt = null;
      }
      const res = await apiRequest("PATCH", `/api/visits/${visitId}`, body);
      return res.json();
    },
    onSuccess: () => {
      setUpdatingVisitId(null);
      setUpdatingVisitStatus(null);
      queryClient.invalidateQueries({ queryKey: ["/api/visits/range", selectedDayDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/uninvoiced-summary"] });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey.includes("uninvoiced-visits") });
    },
    onError: (err: Error) => {
      setUpdatingVisitId(null);
      setUpdatingVisitStatus(null);
      toast({ title: "Error updating visit", description: err.message, variant: "destructive" });
    },
  });

  const handleVisitStatusChange = useCallback((visitId: string, status: string) => {
    visitStatusMutation.mutate({ visitId, status });
  }, [visitStatusMutation]);

  const [routeMetrics, setRouteMetrics] = useState<Record<string, RouteMetrics>>({});
  const [metricsLoadingRoutes, setMetricsLoadingRoutes] = useState<Set<string>>(new Set());

  const isLoading = routesLoading || plansLoading;

  const routesForDay = useMemo(() => allRoutes.filter(r => r.dayOfWeek === selectedDay), [allRoutes, selectedDay]);

  const routeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of DAYS) counts[d] = allRoutes.filter(r => r.dayOfWeek === d).length;
    return counts;
  }, [allRoutes]);

  const currentWeekRange = useMemo(() => {
    const now = new Date();
    const dayIdx = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayIdx);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday, end: sunday };
  }, []);

  const isOnetimeInCurrentWeek = useCallback((sp: ServicePlan) => {
    if (sp.frequency !== "onetime") return true;
    if (!sp.startDate) return false;
    const d = new Date(sp.startDate + "T12:00:00");
    return d >= currentWeekRange.start && d <= currentWeekRange.end;
  }, [currentWeekRange]);

  const visiblePlans = useMemo(() => servicePlans.filter(isOnetimeInCurrentWeek), [servicePlans, isOnetimeInCurrentWeek]);

  const stopsByRoute = useMemo(() => {
    const map: Record<string, ServicePlan[]> = {};
    for (const r of allRoutes) map[r.id] = [];
    for (const sp of visiblePlans) {
      if (sp.routeId && map[sp.routeId]) map[sp.routeId].push(sp);
    }
    return map;
  }, [allRoutes, visiblePlans]);

  const fetchRouteMetrics = useCallback(async (routeId: string) => {
    try {
      setMetricsLoadingRoutes(prev => new Set(prev).add(routeId));
      const res = await apiRequest("GET", `/api/routes/${routeId}/metrics`);
      const data: RouteMetrics = await res.json();
      setRouteMetrics(prev => ({ ...prev, [routeId]: data }));
    } catch {
      setRouteMetrics(prev => ({ ...prev, [routeId]: { totalDistance: 0, totalDuration: 0, legs: [], stopCount: 0, error: "Failed to load" } }));
    } finally {
      setMetricsLoadingRoutes(prev => { const s = new Set(prev); s.delete(routeId); return s; });
    }
  }, []);

  useEffect(() => {
    for (const route of routesForDay) {
      const stops = stopsByRoute[route.id] || [];
      if (stops.length >= 2 && !routeMetrics[route.id]) {
        fetchRouteMetrics(route.id);
      }
    }
  }, [routesForDay, stopsByRoute, routeMetrics, fetchRouteMetrics]);

  const unassignedPlans = useMemo(() => {
    return visiblePlans.filter(sp => !sp.routeId).filter(sp => {
      if (!unassignedSearch) return true;
      const contact = contacts.find(c => c.id === sp.contactId);
      const property = properties.find(p => p.id === sp.propertyId);
      const search = unassignedSearch.toLowerCase();
      return (
        (contact && `${contact.firstName} ${contact.lastName}`.toLowerCase().includes(search)) ||
        (property && property.streetAddress?.toLowerCase().includes(search))
      );
    });
  }, [visiblePlans, unassignedSearch, contacts, properties]);

  const activeDragStop = useMemo(() => {
    if (!activeDragId) return null;
    return servicePlans.find(sp => sp.id === activeDragId) || null;
  }, [activeDragId, servicePlans]);

  const mapStops = useMemo((): RouteStop[] => {
    const allDayStops: RouteStop[] = [];
    for (const route of routesForDay) {
      const routeStops = (stopsByRoute[route.id] || [])
        .sort((a, b) => a.stopOrder - b.stopOrder);
      routeStops.forEach((sp, idx) => {
        const property = properties.find(p => p.id === sp.propertyId);
        const contact = contacts.find(c => c.id === sp.contactId);
        if (property?.latitude && property?.longitude) {
          allDayStops.push({
            stopNumber: idx + 1,
            contactName: contact ? `${contact.firstName} ${contact.lastName}` : "Unknown",
            streetAddress: property.streetAddress || "",
            latitude: Number(property.latitude),
            longitude: Number(property.longitude),
          });
        }
      });
    }
    return allDayStops;
  }, [routesForDay, stopsByRoute, properties, contacts]);

  const dayStopCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of DAYS) {
      const dayRouteIds = new Set(allRoutes.filter(r => r.dayOfWeek === d).map(r => r.id));
      counts[d] = visiblePlans.filter(sp => sp.routeId && dayRouteIds.has(sp.routeId)).length;
    }
    return counts;
  }, [allRoutes, visiblePlans]);

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
    mutationFn: async ({ stopId, routeId, dayOfWeek }: { stopId: string; routeId: string | null; dayOfWeek?: string }) => {
      const body: Record<string, any> = { routeId };
      if (dayOfWeek) body.dayOfWeek = dayOfWeek;
      await apiRequest("PATCH", `/api/service-plans/${stopId}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans?isActive=true"] });
      setRouteMetrics({});
    },
    onError: (err: Error) => toast({ title: "Error moving stop", description: err.message, variant: "destructive" }),
  });

  const optimizeRouteMutation = useMutation({
    mutationFn: async (routeId: string) => {
      setOptimizingRouteId(routeId);
      const res = await apiRequest("POST", `/api/routes/${routeId}/optimize`);
      return res.json() as Promise<OptimizeResult>;
    },
    onSuccess: (data, routeId) => {
      setOptimizingRouteId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans?isActive=true"] });
      queryClient.invalidateQueries({ queryKey: ["/api/route-credits"] });
      setRouteMetrics(prev => { const next = { ...prev }; delete next[routeId]; return next; });
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

  const unassignAllMutation = useMutation({
    mutationFn: async (routeId: string) => {
      setUnassigningRouteId(routeId);
      const res = await apiRequest("POST", `/api/routes/${routeId}/unassign-all`);
      return res.json();
    },
    onSuccess: (data: any) => {
      setUnassigningRouteId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans?isActive=true"] });
      toast({ title: "Stops unassigned", description: `${data.unassignedCount} stop${data.unassignedCount === 1 ? "" : "s"} moved to unassigned pool.` });
    },
    onError: (err: Error) => {
      setUnassigningRouteId(null);
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
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
    const targetRoute = newRouteId ? allRoutes.find(r => r.id === newRouteId) : null;
    const dayOfWeek = targetRoute ? targetRoute.dayOfWeek : undefined;
    assignStopMutation.mutate({ stopId, routeId: newRouteId, dayOfWeek });
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
            <LearnHowButton
              tutorialId="tutorial_route_builder"
              onStart={startTutorial}
              isCompleted={isTutorialCompleted("tutorial_route_builder")}
            />
            <Badge variant="outline" className="flex items-center gap-1.5 text-sm px-3 py-1" data-testid="badge-credits">
              <Coins className="h-4 w-4" />
              Available Credits: {credits}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewMode(viewMode === "list" ? "map" : "list")}
              data-testid="button-toggle-view"
            >
              {viewMode === "list" ? <Map className="h-4 w-4 mr-1" /> : <List className="h-4 w-4 mr-1" />}
              {viewMode === "list" ? "Map" : "List"}
            </Button>
            <Button
              variant={showZones ? "default" : "outline"}
              size="sm"
              onClick={() => setShowZones(!showZones)}
              data-testid="button-toggle-zones"
            >
              <MapPin className="h-4 w-4 mr-1" /> {showZones ? "Hide Zones" : "Manage Zones"}
            </Button>
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

        {showZones && <ServiceZonesPanel />}
      </div>

      <Separator className="shrink-0" />

      {isLoading ? (
        <div className="p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-60 w-full" />)}
        </div>
      ) : viewMode === "map" ? (
        <div className="flex-1 overflow-hidden" data-testid="route-map-view-wrapper">
          <RouteMapView
            stops={mapStops}
            routeName={`${DAY_LABELS[selectedDay]} Routes`}
          />
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
                        onUnassignAll={(id) => setConfirmUnassignAll(id)}
                        isOptimizing={optimizingRouteId === route.id}
                        isDispatching={dispatchingRouteId === route.id}
                        visitsByPlan={visitsByPlan}
                        onVisitStatusChange={handleVisitStatusChange}
                        updatingVisitId={updatingVisitId}
                        updatingVisitStatus={updatingVisitStatus}
                        metrics={routeMetrics[route.id] || null}
                        metricsLoading={metricsLoadingRoutes.has(route.id)}
                        isUnassigning={unassigningRouteId === route.id}
                        onStopClick={handleStopClick}
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
                        Unassigned Stops
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
                            {servicePlans.length === 0 ? "No unassigned stops" : "All stops assigned"}
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

      <AlertDialog open={!!confirmUnassignAll} onOpenChange={(open) => { if (!open) setConfirmUnassignAll(null); }}>
        <AlertDialogContent data-testid="dialog-confirm-unassign-all">
          <AlertDialogHeader>
            <AlertDialogTitle>Unassign All Stops</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to unassign all stops from this route? They will be moved back to the unassigned pool.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-unassign-all">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmUnassignAll) unassignAllMutation.mutate(confirmUnassignAll);
                setConfirmUnassignAll(null);
              }}
              data-testid="button-confirm-unassign-all"
            >
              Unassign All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SavingsSummaryDialog open={showSavings} onOpenChange={setShowSavings} result={savingsResult} />
      <PurchaseCreditsDialog open={showPurchase} onOpenChange={setShowPurchase}
        onPurchase={(amount) => purchaseCreditsMutation.mutate(amount)}
        isPurchasing={purchaseCreditsMutation.isPending} />

      <RouteVisitDetailSheet
        visit={detailVisit}
        servicePlan={detailPlan}
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        contacts={contacts}
        properties={properties}
        routes={allRoutes}
        selectedDayDate={selectedDayDate}
      />
    </div>
  );
}

function ServiceZonesPanel() {
  const { toast } = useToast();
  const [zones, setZones] = useState<ZoneEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: existingZones, isLoading } = useQuery<any[]>({
    queryKey: ["/api/service-zones"],
  });

  useEffect(() => {
    if (existingZones) {
      setZones(existingZones.map((z: any) => ({
        id: z.id,
        zipCode: z.zipCode,
        dayOfWeek: z.dayOfWeek,
        label: z.label,
        latitude: z.latitude ? parseFloat(z.latitude) : undefined,
        longitude: z.longitude ? parseFloat(z.longitude) : undefined,
      })));
      setHasChanges(false);
    }
  }, [existingZones]);

  const handleZonesChange = (newZones: ZoneEntry[]) => {
    setZones(newZones);
    setHasChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem("sessionToken");
      const authHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (token) authHeaders["Authorization"] = `Bearer ${token}`;

      if (existingZones) {
        for (const existing of existingZones) {
          if (!zones.some(z => z.id === existing.id)) {
            await fetch(`/api/service-zones/${existing.id}`, {
              method: "DELETE",
              credentials: "include",
              headers: authHeaders,
            });
          }
        }
        for (const zone of zones) {
          if (zone.id) {
            const existing = existingZones.find((e: any) => e.id === zone.id);
            if (existing && existing.dayOfWeek !== zone.dayOfWeek) {
              await fetch(`/api/service-zones/${zone.id}`, {
                method: "PATCH",
                credentials: "include",
                headers: authHeaders,
                body: JSON.stringify({ dayOfWeek: zone.dayOfWeek }),
              });
            }
          } else {
            await fetch("/api/service-zones", {
              method: "POST",
              credentials: "include",
              headers: authHeaders,
              body: JSON.stringify(zone),
            });
          }
        }
      } else {
        await fetch("/api/service-zones/bulk", {
          method: "POST",
          credentials: "include",
          headers: authHeaders,
          body: JSON.stringify({ zones }),
        });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/service-zones"] });
      setHasChanges(false);
      toast({ title: "Service zones saved" });
    } catch (err: any) {
      toast({ title: "Error saving zones", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card data-testid="panel-service-zones">
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          Service Zones
        </CardTitle>
        <CardDescription className="text-xs">Define which zip codes you service and what day you work each area</CardDescription>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {isLoading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : (
          <>
            <ServiceZoneMap
              zones={zones}
              onZonesChange={handleZonesChange}
              compact
            />
            {hasChanges && (
              <Button
                className="w-full mt-3"
                size="sm"
                onClick={handleSave}
                disabled={saving}
                data-testid="button-save-service-zones"
              >
                <Save className="h-4 w-4 mr-2" />
                {saving ? "Saving..." : "Save Service Zones"}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
