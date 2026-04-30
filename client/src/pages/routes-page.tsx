import { useState, useMemo, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import { LiveRoutePlayback } from "@/components/live-route-playback";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toLocalDateString } from "@/lib/utils";
import { useCompanyTimezone } from "@/hooks/use-company-timezone";
import { useToast } from "@/hooks/use-toast";
import type { Route, ServicePlan, Contact, Property, Visit } from "@shared/schema";
type RouteWithOptStatus = Route & { isOptimizedCurrent?: boolean };
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
  Clock, ShoppingCart, RotateCcw, Map as MapIcon, List, Save,
  CheckCircle, XCircle, SkipForward, MoreVertical, Car, Ban, CalendarCheck,
  CalendarDays, DollarSign, Play, ArrowUpDown, ShieldAlert, Lock, Unlock,
  Sparkles, X,
  Camera, DoorClosed, ChevronLeft, ChevronRight, Info
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { WeeklyOptimizerPanel } from "@/components/WeeklyOptimizerPanel";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { LearnHowButton } from "@/components/interactive-tutorial";
import { useTutorialContext } from "@/hooks/use-tutorials";
import type { RouteStop } from "@/components/route-map-view";
import type { ZoneEntry } from "@/components/service-zone-map";
const RouteMapView = lazy(() => import("@/components/route-map-view"));
const ServiceZoneMap = lazy(() => import("@/components/service-zone-map"));
import {
  DndContext, DragOverlay, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, useDroppable, useDraggable,
  type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from "@dnd-kit/core";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "stripe-pricing-table": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        "pricing-table-id"?: string;
        "publishable-key"?: string;
        "client-reference-id"?: string;
        "customer-session-client-secret"?: string;
      };
    }
  }
}

const STRIPE_PRICING_TABLE_ID = "prctbl_1TRXCrGVMaTr43jX0eJZMaLt";
const STRIPE_PUBLISHABLE_KEY = "pk_live_51T15sMGVMaTr43jX4fB9ug4zBSlaiVqyszuuCW6wbIqHxFMXfizszb9g938KPPAspd1PpjyrAqlJdVh3LC7cqWil00ZtXS9t6F";

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

type FailedStop = {
  servicePlanId: string;
  contactId: string;
  propertyId: string;
  name: string;
  address: string;
};

type OptimizeResult = {
  optimized: boolean; totalDistance: number; originalDistance: number;
  milesSaved: number; minutesSaved: number; stopCount: number;
  creditsUsed: number; creditsRemaining: number; message?: string;
  geocodeFailure?: boolean;
  failedStops?: FailedStop[];
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

function DraggableStop({ stop, contacts, properties, visit, onVisitStatusChange, updatingVisitId, updatingVisitStatus, onStopClick, onOnMyWay, onMyWaySendingId, onSelectStop, isSelected, isHighlighted }: {
  stop: ServicePlan; contacts: Contact[]; properties: Property[];
  visit?: Visit | null; onVisitStatusChange?: (visitId: string, status: string) => void;
  updatingVisitId?: string | null;
  updatingVisitStatus?: string | null;
  onStopClick?: (stop: ServicePlan, visit: Visit) => void;
  onOnMyWay?: (visitId: string) => void;
  onMyWaySendingId?: string | null;
  onSelectStop?: (stopId: string) => void;
  isSelected?: boolean;
  isHighlighted?: boolean;
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
      className={`border rounded-md p-2.5 bg-background transition-all ${isDragging ? "opacity-30" : ""} ${isHighlighted ? "ring-2 ring-orange-400 border-orange-400 bg-orange-50 dark:bg-orange-950/20" : isSelected ? "ring-2 ring-amber-400 border-amber-300" : ""} ${isCompleted ? "border-green-300 dark:border-green-800 opacity-70" : ""} ${isSkipped ? "border-orange-300 dark:border-orange-800 opacity-60" : ""} ${isCancelled ? "border-red-300 dark:border-red-800 opacity-50" : ""}`}
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
              {onSelectStop && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSelectStop(stop.id); }}
                  className={`p-0.5 rounded transition-colors ${isSelected ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                  title={isSelected ? "Deselect on map" : "Highlight on map"}
                  data-testid={`button-select-stop-${stop.id}`}
                >
                  <MapPin className="h-3 w-3" />
                </button>
              )}
              {visit && onVisitStatusChange && (visit.status === "scheduled" || visit.status === "in_progress") && (
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
                      {updatingVisitId === visit?.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <MoreVertical className="h-3 w-3" />}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(visit.status === "scheduled" || visit.status === "in_progress") && (
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
                    {onOnMyWay && visit.status !== "completed" && visit.status !== "cancelled" && (
                      <DropdownMenuItem onClick={() => onOnMyWay(visit.id)} disabled={onMyWaySendingId === visit.id} data-testid={`menu-on-my-way-${stop.id}`}>
                        {onMyWaySendingId === visit.id ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Navigation className="h-3.5 w-3.5 mr-2 text-emerald-600" />} On My Way SMS
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
            {property?.hasDangerousDog && (
              <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400" title={property.dangerousDogNotes || "Dangerous dog"} data-testid={`icon-dangerous-dog-${stop.id}`}>
                <ShieldAlert className="h-3 w-3" />
              </span>
            )}
            {contact?.numberOfDogs != null && contact.numberOfDogs > 0 && (
              <span className="flex items-center gap-0.5"><Dog className="h-3 w-3" />{contact.numberOfDogs}</span>
            )}
            <span>${(Number(stop.pricePerVisit) || 0).toFixed(2)}</span>
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
  onEdit, onDelete, onOptimize, onReverse, onDispatch, onUnassignAll, onLock, onMoveToDay, isOptimizing, isReversing, isDispatching, isUnassigning, isLocking,
  visitsByPlan, onVisitStatusChange, updatingVisitId, updatingVisitStatus, metrics, metricsLoading, onStopClick, onOnMyWay, onMyWaySendingId, onSelectStop, selectedStopId, highlightedStopIds }: {
  route: RouteWithOptStatus; stops: ServicePlan[]; contacts: Contact[]; properties: Property[];
  team: TeamMember[]; isOverThis: boolean; credits: number;
  onEdit: (route: Route) => void; onDelete: (route: Route) => void;
  onOptimize: (routeId: string, stopCount: number) => void;
  onReverse: (routeId: string) => void;
  onDispatch: (routeId: string) => void;
  onUnassignAll: (routeId: string) => void;
  onLock: (routeId: string) => void;
  onMoveToDay: (routeId: string) => void;
  isOptimizing: boolean; isReversing: boolean; isDispatching: boolean; isUnassigning: boolean; isLocking: boolean;
  visitsByPlan?: Record<string, Visit>;
  onVisitStatusChange?: (visitId: string, status: string) => void;
  updatingVisitId?: string | null;
  updatingVisitStatus?: string | null;
  metrics?: RouteMetrics | null;
  metricsLoading?: boolean;
  onStopClick?: (stop: ServicePlan, visit: Visit) => void;
  onOnMyWay?: (visitId: string) => void;
  onMyWaySendingId?: string | null;
  onSelectStop?: (stopId: string) => void;
  selectedStopId?: string | null;
  highlightedStopIds?: Set<string>;
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
  const isOptimized = route.isOptimizedCurrent ?? !!(route.lastOptimizedAt && route.optimizedStopHash);
  const optimizedDate = isOptimized && route.lastOptimizedAt
    ? new Date(route.lastOptimizedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  return (
    <Card className="flex flex-col" data-testid={`card-route-${route.id}`}>
      <CardHeader className="p-3 pb-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: route.color || "#3b82f6" }} />
            <CardTitle className="text-sm font-semibold truncate" data-testid={`text-route-name-${route.id}`}>
              {route.name}
            </CardTitle>
            {route.isLocked && <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" data-testid={`icon-locked-${route.id}`} />}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onLock(route.id)}
              disabled={isLocking}
              title={route.isLocked ? "Unlock route" : "Lock route"}
              data-testid={`button-lock-${route.id}`}
            >
              {isLocking ? <Loader2 className="h-4 w-4 animate-spin" /> : route.isLocked ? <Lock className="h-4 w-4 text-amber-500" /> : <Unlock className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onEdit(route)} data-testid={`button-edit-route-${route.id}`}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onDelete(route)} disabled={stops.length > 0} data-testid={`button-delete-route-${route.id}`}>
              <Trash2 className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid={`button-route-more-${route.id}`}>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onMoveToDay(route.id)} data-testid={`menu-move-to-day-${route.id}`}>
                  <CalendarDays className="h-4 w-4 mr-2 text-blue-600" />
                  Move to another day
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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

        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={isOverMax ? "destructive" : isOverLimit ? "secondary" : "outline"}
            className={isOverLimit && !isOverMax ? "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" : ""}
            data-testid={`badge-stop-counter-${route.id}`}
          >
            {stopCount} stops
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
          {isOptimized && !isOptimizing ? (
            <div
              className="flex-1 flex items-center justify-center gap-1.5 rounded-md border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 text-xs px-2 py-1.5 cursor-default"
              data-testid={`badge-optimized-${route.id}`}
              title={`Optimized on ${optimizedDate}`}
            >
              <CheckCircle className="h-3 w-3 shrink-0" />
              <span>Optimized {optimizedDate}</span>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className={`flex-1 text-xs ${route.isLocked ? "opacity-50" : ""}`}
              onClick={() => onOptimize(route.id, stopCount)}
              disabled={isOptimizing || stopCount < 2 || isOverMax || (credits < 999999 && credits < creditsNeeded)}
              data-testid={`button-optimize-${route.id}`}
            >
              {isOptimizing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : route.isLocked ? <Lock className="h-3 w-3 mr-1 text-amber-500" /> : <Navigation className="h-3 w-3 mr-1" />}
              Optimize ({creditsNeeded} {creditsNeeded === 1 ? "Credit" : "Credits"})
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className={`text-xs ${route.isLocked ? "opacity-50" : ""}`}
            onClick={() => onReverse(route.id)}
            disabled={isReversing || stopCount < 2}
            title={route.isLocked ? "Route is locked" : "Reverse route order"}
            data-testid={`button-reverse-${route.id}`}
          >
            {isReversing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowUpDown className="h-3 w-3" />}
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
                    onOnMyWay={onOnMyWay}
                    onMyWaySendingId={onMyWaySendingId}
                    onSelectStop={onSelectStop}
                    isSelected={selectedStopId === stop.id}
                    isHighlighted={highlightedStopIds?.has(stop.id)}
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
  visit, servicePlan, open, onOpenChange, contacts, properties, routes, selectedDayDate, onRequestComplete,
}: {
  visit: Visit | null;
  servicePlan: ServicePlan | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: Contact[];
  properties: Property[];
  routes: Route[];
  selectedDayDate: string;
  onRequestComplete?: (visitId: string, contactName: string, address: string) => void;
}) {
  const { toast } = useToast();
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [enRouteSending, setEnRouteSending] = useState(false);

  const handleSendEnRoute = () => {
    if (!visit) return;
    setEnRouteSending(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await apiRequest("POST", `/api/visits/${visit.id}/on-my-way`, {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          const data = await res.json();
          queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
          queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
          toast({ title: "En-route SMS sent", description: `${data.contactName} notified — ETA ~${data.etaMinutes} min` });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Failed to send SMS";
          toast({ title: "Failed to send SMS", description: msg, variant: "destructive" });
        } finally {
          setEnRouteSending(false);
        }
      },
      (err) => {
        setEnRouteSending(false);
        toast({ title: "Location unavailable", description: err.message || "Could not get your current location", variant: "destructive" });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

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
      label: "Start",
      icon: Play,
      color: "text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800",
      show: visit.status === "scheduled",
    },
    {
      status: "completed",
      label: "Mark Complete",
      icon: CheckCircle,
      color: "text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30 border-green-200 dark:border-green-800",
      show: visit.status === "scheduled" || visit.status === "in_progress",
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
              {(visit.status === "scheduled" || visit.status === "in_progress") && (
                <Button
                  variant="outline"
                  className="justify-start gap-2 text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/30 border-teal-200 dark:border-teal-800"
                  onClick={handleSendEnRoute}
                  disabled={enRouteSending}
                  data-testid="button-route-action-en_route"
                >
                  {enRouteSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
                  Send En-Route
                </Button>
              )}
              {statusActions.filter(a => a.show).map((action) => {
                const Icon = action.icon;
                const isUpdating = updatingStatus === action.status;
                return (
                  <Button
                    key={action.status}
                    variant="outline"
                    className={`justify-start gap-2 ${action.color}`}
                    onClick={() => {
                      if (action.status === "completed" && onRequestComplete) {
                        const c = contacts.find((ct) => ct.id === servicePlan?.contactId);
                        const p = properties.find((pr) => pr.id === visit.propertyId);
                        onRequestComplete(visit.id, c ? `${c.firstName} ${c.lastName}` : "", p?.streetAddress || "");
                        onOpenChange(false);
                      } else {
                        statusMutation.mutate({ visitId: visit.id, status: action.status });
                      }
                    }}
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
        setName(editingRoute.name); setDayOfWeek(editingRoute.dayOfWeek ?? "monday");
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

function StripePricingTableDialog({ open, onOpenChange, companyId, topUpNeeded = 0, initialCredits = 0 }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  companyId: string | null | undefined;
  topUpNeeded?: number; initialCredits?: number;
}) {
  const { toast } = useToast();
  const [customerSecret, setCustomerSecret] = useState<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const creditsAtOpenRef = useRef(initialCredits);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (document.querySelector('script[src*="pricing-table"]')) { setScriptLoaded(true); return; }
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/pricing-table.js";
    script.async = true;
    script.onload = () => setScriptLoaded(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!open) { setCustomerSecret(null); creditsAtOpenRef.current = initialCredits; return; }
    creditsAtOpenRef.current = initialCredits;
    apiRequest("POST", "/api/route-credits/customer-session")
      .then(r => r.json())
      .then(data => setCustomerSecret(data.clientSecret ?? null))
      .catch(() => setCustomerSecret(null));
  }, [open, initialCredits]);

  const { data: pollData } = useQuery<{ credits: number; monthlyAllowance: number }>({
    queryKey: ["/api/route-credits"],
    refetchInterval: open ? 5000 : false,
    enabled: open,
  });

  useEffect(() => {
    if (!open || pollData === undefined) return;
    const current = pollData.credits ?? 0;
    const baseline = creditsAtOpenRef.current;
    if (current > baseline && baseline >= 0) {
      const added = current - baseline;
      queryClient.invalidateQueries({ queryKey: ["/api/route-credits"] });
      toast({ title: "Credits added!", description: `${added} route credit${added !== 1 ? "s" : ""} added to your account.` });
      onOpenChange(false);
    }
  }, [pollData?.credits, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="dialog-purchase-credits">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Purchase Route Credits
          </DialogTitle>
          <DialogDescription>
            {topUpNeeded > 0
              ? `The Weekly Optimizer costs 1 credit per route. You need ${topUpNeeded} more credit${topUpNeeded !== 1 ? "s" : ""} to proceed.`
              : "Each credit optimizes one route of up to 30 stops. Routes with 31-60 stops require 2 credits."
            }
          </DialogDescription>
        </DialogHeader>
        {topUpNeeded > 0 && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-200" data-testid="text-topup-notice">
            Top up at least <span className="font-semibold">{topUpNeeded} credit{topUpNeeded !== 1 ? "s" : ""}</span> to unlock the Weekly Optimizer.
          </div>
        )}
        <div className="min-h-[300px] flex items-center justify-center">
          {!scriptLoaded ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : (
            <stripe-pricing-table
              pricing-table-id={STRIPE_PRICING_TABLE_ID}
              publishable-key={STRIPE_PUBLISHABLE_KEY}
              client-reference-id={companyId ?? undefined}
              customer-session-client-secret={customerSecret ?? undefined}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-purchase">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RoutesPage() {
  const tz = useCompanyTimezone();
  const { toast } = useToast();
  const { user } = useAuth();
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
  const [reversingRouteId, setReversingRouteId] = useState<string | null>(null);
  const [dispatchingRouteId, setDispatchingRouteId] = useState<string | null>(null);
  const [lockingRouteId, setLockingRouteId] = useState<string | null>(null);
  const [unassignedSearch, setUnassignedSearch] = useState("");
  const [confirmOptimize, setConfirmOptimize] = useState<{ routeId: string; stopCount: number } | null>(null);
  const [savingsResult, setSavingsResult] = useState<OptimizeResult | null>(null);
  const [showSavings, setShowSavings] = useState(false);
  const [showPurchase, setShowPurchase] = useState(false);
  const [purchaseTopUpNeeded, setPurchaseTopUpNeeded] = useState(0);
  const [unassigningRouteId, setUnassigningRouteId] = useState<string | null>(null);
  const [confirmUnassignAll, setConfirmUnassignAll] = useState<string | null>(null);
  const [moveToDayRouteId, setMoveToDayRouteId] = useState<string | null>(null);
  const [moveToDayDate, setMoveToDayDate] = useState<string>("");
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [highlightedStopIds, setHighlightedStopIds] = useState<Set<string>>(new Set());
  const [geocodeAlert, setGeocodeAlert] = useState<{ routeId: string; stops: FailedStop[] } | null>(null);
  const [showZones, setShowZones] = useState(false);
  const [showWeeklyOptimizer, setShowWeeklyOptimizer] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showLivePlayback, setShowLivePlayback] = useState(false);

  const { data: demoStatus } = useQuery<{ isDemo: boolean; settings?: { livePlaybackEnabled?: boolean } }>({
    queryKey: ["/api/demo/status"],
  });
  const isLivePlaybackEnabled = !!(demoStatus?.isDemo && demoStatus?.settings?.livePlaybackEnabled);

  const [completeDialogVisitId, setCompleteDialogVisitId] = useState<string | null>(null);
  const [completeDialogContactName, setCompleteDialogContactName] = useState<string>("");
  const [completeDialogAddress, setCompleteDialogAddress] = useState<string>("");
  const [gatePhoto, setGatePhoto] = useState<File | null>(null);
  const [gatePhotoPreview, setGatePhotoPreview] = useState<string | null>(null);
  const [extraFiles, setExtraFiles] = useState<{ file: File; preview: string }[]>([]);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionNotes, setCompletionNotes] = useState("");
  const [noGate, setNoGate] = useState(false);
  const gateFileInputRef = useRef<HTMLInputElement>(null);
  const extraFileInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 8 } }),
  );

  const { data: allRoutes = [], isLoading: routesLoading } = useQuery<RouteWithOptStatus[]>({ queryKey: ["/api/routes"] });
  const { data: servicePlans = [], isLoading: plansLoading } = useQuery<ServicePlan[]>({ queryKey: ["/api/service-plans?isActive=true"] });
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: properties = [] } = useQuery<Property[]>({ queryKey: ["/api/properties"] });
  const { data: team = [] } = useQuery<TeamMember[]>({ queryKey: ["/api/company/team"] });
  const { data: creditData } = useQuery<{ credits: number; monthlyAllowance: number }>({ queryKey: ["/api/route-credits"] });
  const credits = creditData?.credits ?? 0;
  const monthlyAllowance = creditData?.monthlyAllowance ?? 20;
  const { data: company } = useQuery<{ name: string; maxStopsPerRoute?: number | null; startLatitude?: string | null; startLongitude?: string | null }>({ queryKey: ["/api/company"] });
  const [maxStopsInput, setMaxStopsInput] = useState<string>("");
  const [isApplyingSplit, setIsApplyingSplit] = useState(false);

  useEffect(() => {
    if (company?.maxStopsPerRoute != null) {
      setMaxStopsInput(String(company.maxStopsPerRoute));
    }
  }, [company?.maxStopsPerRoute]);

  const handleApplyMaxStops = async () => {
    const val = maxStopsInput.trim();
    const maxStops = val === "" ? null : parseInt(val, 10);

    if (val !== "" && (isNaN(maxStops!) || maxStops! < 2)) {
      toast({ title: "Invalid value", description: "Max stops must be 2 or greater.", variant: "destructive" });
      return;
    }

    setIsApplyingSplit(true);
    try {
      const res = await apiRequest("POST", "/api/routes/apply-max-stops", { maxStops: maxStops ?? null });
      const data = await res.json();

      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["/api/routes"] }),
        queryClient.refetchQueries({ queryKey: ["/api/service-plans?isActive=true"] }),
        queryClient.refetchQueries({ queryKey: ["/api/company"] }),
      ]);

      if (data.cleared) {
        toast({ title: "Stop limit cleared", description: "Routes will no longer be checked against a max stops limit." });
      } else if (data.routesSplit === 0 && (data.errors?.length || 0) === 0) {
        toast({ title: `All routes within the ${maxStops}-stop limit`, description: "No routes needed splitting." });
      } else if ((data.errors?.length || 0) > 0 && data.routesSplit === 0) {
        toast({ title: "Could not split routes", description: `Failed: ${data.errors.join(", ")}`, variant: "destructive" });
      } else if ((data.errors?.length || 0) > 0) {
        toast({
          title: `${data.routesSplit} route${data.routesSplit !== 1 ? "s" : ""} split into ${data.routesSplit + data.subRoutesCreated} sub-routes`,
          description: `Some routes could not be split: ${data.errors.join(", ")}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: `${data.routesSplit} route${data.routesSplit !== 1 ? "s" : ""} split into ${data.routesSplit + data.subRoutesCreated} sub-routes`,
          description: "Each sub-route has been optimized and visits regenerated.",
        });
      }
    } catch (err: any) {
      toast({ title: "Failed to apply", description: err?.message || "Could not save settings.", variant: "destructive" });
    } finally {
      setIsApplyingSplit(false);
    }
  };

  const selectedDayDate = useMemo(() => {
    const now = new Date();
    const todayIdx = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - todayIdx + weekOffset * 7);
    monday.setHours(0, 0, 0, 0);
    const targetIdx = DAYS.indexOf(selectedDay);
    const target = new Date(monday);
    target.setDate(monday.getDate() + targetIdx);
    return toLocalDateString(target, tz);
  }, [selectedDay, weekOffset, tz]);

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
    if (status === "completed") {
      const visit = dayVisits.find(v => v.id === visitId);
      if (visit) {
        const plan = servicePlans.find(sp => sp.id === visit.servicePlanId);
        const contact = plan ? contacts.find(c => c.id === plan.contactId) : null;
        const property = plan ? properties.find(p => p.id === plan.propertyId) : null;
        setCompleteDialogVisitId(visitId);
        setCompleteDialogContactName(contact ? `${contact.firstName} ${contact.lastName}` : "");
        setCompleteDialogAddress(property ? `${property.streetAddress}${property.city ? `, ${property.city}` : ""}` : "");
        setGatePhoto(null);
        setGatePhotoPreview(null);
        setExtraFiles([]);
        setIsCompleting(false);
        setCompletionNotes("");
        return;
      }
    }
    visitStatusMutation.mutate({ visitId, status });
  }, [visitStatusMutation, dayVisits, servicePlans, contacts, properties]);

  const completionContactFirstName = useMemo(() => {
    if (!completeDialogVisitId) return "";
    const visit = dayVisits.find(v => v.id === completeDialogVisitId);
    if (!visit) return "";
    const plan = servicePlans.find(sp => sp.id === visit.servicePlanId);
    if (!plan) return "";
    const contact = contacts.find(c => c.id === plan.contactId);
    return contact?.firstName || "";
  }, [completeDialogVisitId, dayVisits, servicePlans, contacts]);

  const completionMessage = completeDialogVisitId && completionContactFirstName
    ? `Hi ${completionContactFirstName}. ${company?.name || "Our team"} just finished your poop scoop service. Here is your gate closed image. Let us know if there is anything we can do.`
    : "";

  const handleGatePhotoCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setGatePhoto(file);
    const reader = new FileReader();
    reader.onload = () => setGatePhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleExtraPhotoCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = () => {
      setExtraFiles(prev => [...prev, { file, preview: reader.result as string }]);
    };
    reader.readAsDataURL(file);
  }, []);

  const removeExtraPhoto = useCallback((index: number) => {
    setExtraFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleCompleteAndSend = useCallback(async () => {
    if (!completeDialogVisitId || (!gatePhoto && !noGate)) return;
    setIsCompleting(true);

    try {
      const currentVisit = dayVisits.find(v => v.id === completeDialogVisitId);
      if (currentVisit && currentVisit.status === "scheduled") {
        await apiRequest("PATCH", `/api/visits/${completeDialogVisitId}`, {
          status: "in_progress",
          startedAt: new Date().toISOString(),
        });
      }

      let gateClosedPath: string | undefined;
      const extraPaths: string[] = [];

      if (!noGate && gatePhoto) {
        const token = localStorage.getItem("sessionToken");
        const hdrs: Record<string, string> = {};
        if (token) hdrs["Authorization"] = `Bearer ${token}`;

        const formData = new FormData();
        formData.append("file", gatePhoto);
        const uploadRes = await fetch("/api/uploads/direct", {
          method: "POST",
          credentials: "include",
          headers: hdrs,
          body: formData,
        });
        if (!uploadRes.ok) throw new Error("Failed to upload photo");
        const uploadData = await uploadRes.json();
        gateClosedPath = uploadData.objectPath;

        for (const extra of extraFiles) {
          const extraForm = new FormData();
          extraForm.append("file", extra.file);
          const extraRes = await fetch("/api/uploads/direct", {
            method: "POST",
            credentials: "include",
            headers: hdrs,
            body: extraForm,
          });
          if (!extraRes.ok) throw new Error("Failed to upload extra photo");
          const extraData = await extraRes.json();
          extraPaths.push(extraData.objectPath);
        }
      }

      await apiRequest("POST", `/api/visits/${completeDialogVisitId}/complete-notify`, {
        gateClosedPhoto: gateClosedPath,
        extraPhotos: extraPaths.length > 0 ? extraPaths : undefined,
        technicianNotes: completionNotes || undefined,
        noGate: noGate || undefined,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/visits/range", selectedDayDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/uninvoiced-summary"] });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey.includes("uninvoiced-visits") });
      setCompleteDialogVisitId(null);
      toast({ title: "Visit completed", description: "Customer has been notified." });
    } catch (err: any) {
      toast({ title: "Completion failed", description: err.message, variant: "destructive" });
    } finally {
      setIsCompleting(false);
    }
  }, [completeDialogVisitId, gatePhoto, noGate, extraFiles, completionNotes, selectedDayDate, toast, dayVisits]);

  const [onMyWaySending, setOnMyWaySending] = useState<string | null>(null);
  const [onMyWayCooldowns, setOnMyWayCooldowns] = useState<Record<string, number>>({});

  const handleOnMyWay = useCallback((visitId: string) => {
    if (onMyWayCooldowns[visitId] && Date.now() < onMyWayCooldowns[visitId]) {
      toast({ title: "SMS already sent", description: "Please wait before sending another on-my-way message." });
      return;
    }
    setOnMyWaySending(visitId);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await apiRequest("POST", `/api/visits/${visitId}/on-my-way`, {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          const data = await res.json();
          setOnMyWayCooldowns(prev => ({ ...prev, [visitId]: Date.now() + 5 * 60 * 1000 }));
          queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
          queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
          toast({ title: "On-my-way SMS sent", description: `${data.contactName} notified — ETA ~${data.etaMinutes} min` });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Failed to send SMS";
          toast({ title: "Failed to send SMS", description: msg, variant: "destructive" });
        } finally {
          setOnMyWaySending(null);
        }
      },
      (err) => {
        setOnMyWaySending(null);
        toast({ title: "Location unavailable", description: err.message || "Could not get your current location", variant: "destructive" });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [onMyWayCooldowns, toast]);

  const [routeMetrics, setRouteMetrics] = useState<Record<string, RouteMetrics>>({});
  const [metricsLoadingRoutes, setMetricsLoadingRoutes] = useState<Set<string>>(new Set());

  const isLoading = routesLoading || plansLoading;

  const currentWeekRange = useMemo(() => {
    const now = new Date();
    const dayIdx = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayIdx + weekOffset * 7);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday, end: sunday };
  }, [weekOffset]);

  const routesForDay = useMemo(() => {
    const forDay = allRoutes.filter(r => r.dayOfWeek === selectedDay);
    const dateSpecific = forDay.filter(r => {
      if (!r.date) return false;
      const rd = new Date(r.date + "T12:00:00");
      return rd >= currentWeekRange.start && rd <= currentWeekRange.end;
    });
    const dateSpecificWithVisits = dateSpecific.filter(r =>
      dayVisits.some(v => v.routeId === r.id)
    );
    if (dateSpecificWithVisits.length > 0) return dateSpecific;
    return forDay.filter(r => !r.date);
  }, [allRoutes, selectedDay, currentWeekRange, dayVisits]);

  const weekStartStr = useMemo(() => toLocalDateString(currentWeekRange.start, tz), [currentWeekRange, tz]);
  const weekEndStr = useMemo(() => toLocalDateString(currentWeekRange.end, tz), [currentWeekRange, tz]);

  const weekRangeLabel = useMemo(() => {
    const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const start = fmt(currentWeekRange.start);
    const endFull = currentWeekRange.end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const startYear = currentWeekRange.start.getFullYear();
    const endYear = currentWeekRange.end.getFullYear();
    return startYear === endYear ? `${start} – ${endFull}` : `${start}, ${startYear} – ${endFull}`;
  }, [currentWeekRange]);

  const { data: weekVisits = [] } = useQuery<Visit[]>({
    queryKey: ["/api/visits/range", weekStartStr, weekEndStr],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/visits/range?start=${weekStartStr}&end=${weekEndStr}`);
      return res.json();
    },
  });

  const dayPlanIds = useMemo(() => {
    const ids = new Set<string>();
    for (const v of dayVisits) {
      if (v.servicePlanId) ids.add(v.servicePlanId);
    }
    return ids;
  }, [dayVisits]);

  const visiblePlans = useMemo(() => servicePlans.filter(sp => {
    if (dayPlanIds.has(sp.id)) return true;
    if (sp.frequency === "onetime") {
      if (!sp.startDate) return false;
      const d = new Date(sp.startDate + "T12:00:00");
      return d >= currentWeekRange.start && d <= currentWeekRange.end;
    }
    return false;
  }), [servicePlans, dayPlanIds, currentWeekRange]);

  const stopsByRoute = useMemo(() => {
    const map: Record<string, ServicePlan[]> = {};
    for (const r of allRoutes) map[r.id] = [];
    // Only assign stops to routes that actually run on the selected day
    const dayRouteIds = new Set(routesForDay.map(r => r.id));
    // Build plan → today's visit route lookup so date-specific routes take priority
    const planToVisitRoute = new Map<string, string>();
    for (const v of dayVisits) {
      if (v.servicePlanId && v.routeId) planToVisitRoute.set(v.servicePlanId, v.routeId);
    }
    for (const sp of visiblePlans) {
      const visitRouteId = planToVisitRoute.get(sp.id);
      // Only use visit's routeId if that route runs today; fall back to plan's route if it runs today
      const routeId = (visitRouteId && dayRouteIds.has(visitRouteId))
        ? visitRouteId
        : (sp.routeId && dayRouteIds.has(sp.routeId)) ? sp.routeId : null;
      if (!routeId || !(routeId in map)) continue;
      map[routeId].push(sp);
    }
    return map;
  }, [allRoutes, visiblePlans, dayVisits, routesForDay]);

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
    const dayRouteIds = new Set(routesForDay.map(r => r.id));
    // Only treat as "routed via visit" when the visit's route actually runs today
    const routedViaVisit = new Set(
      dayVisits.filter(v => v.routeId && v.servicePlanId && dayRouteIds.has(v.routeId)).map(v => v.servicePlanId as string)
    );
    return visiblePlans.filter(sp => {
      // Already properly assigned via a today-visit's route
      if (routedViaVisit.has(sp.id)) return false;
      // Plan's own route runs today — it belongs in stopsByRoute, not unassigned
      if (sp.routeId && dayRouteIds.has(sp.routeId)) return false;
      // No today-route (either no route, or route is for a different day) → show as unassigned
      if (!unassignedSearch) return true;
      const contact = contacts.find(c => c.id === sp.contactId);
      const property = properties.find(p => p.id === sp.propertyId);
      const search = unassignedSearch.toLowerCase();
      return (
        (contact && `${contact.firstName} ${contact.lastName}`.toLowerCase().includes(search)) ||
        (property && property.streetAddress?.toLowerCase().includes(search))
      );
    });
  }, [visiblePlans, dayVisits, routesForDay, unassignedSearch, contacts, properties]);

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
            id: sp.id,
            stopNumber: idx + 1,
            contactName: contact ? `${contact.firstName} ${contact.lastName}` : "Unknown",
            streetAddress: property.streetAddress || "",
            latitude: Number(property.latitude),
            longitude: Number(property.longitude),
            routeColor: route.color || "#22c55e",
          });
        }
      });
    }
    return allDayStops;
  }, [routesForDay, stopsByRoute, properties, contacts]);

  const dayStopCounts = useMemo(() => {
    const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const buckets: Record<string, Set<string>> = {};
    for (const d of DAYS) buckets[d] = new Set();
    const routeMap = new Map(allRoutes.map(r => [r.id, r]));
    for (const visit of weekVisits) {
      if (!visit.routeId) continue;
      const route = routeMap.get(visit.routeId);
      if (!route) continue;
      let dow = route.dayOfWeek;
      if (route.date) {
        const rd = new Date(route.date + "T12:00:00");
        if (rd < currentWeekRange.start || rd > currentWeekRange.end) continue;
        dow = DAY_NAMES[rd.getDay()] as typeof DAYS[number];
      }
      if (!dow || !buckets[dow]) continue;
      buckets[dow].add(visit.servicePlanId ?? visit.id);
    }
    return Object.fromEntries(DAYS.map(d => [d, buckets[d].size]));
  }, [allRoutes, weekVisits, currentWeekRange]);

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
      queryClient.invalidateQueries({ queryKey: ["/api/visits/range"] });
      setRouteMetrics({});
    },
    onError: (err: Error) => toast({ title: "Error moving stop", description: err.message, variant: "destructive" }),
  });

  const reorderStopsMutation = useMutation({
    mutationFn: async ({ routeId, orderedIds }: { routeId: string; orderedIds: string[] }) => {
      await apiRequest("POST", `/api/routes/${routeId}/reorder-stops`, { orderedIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans?isActive=true"] });
      queryClient.invalidateQueries({ queryKey: ["/api/visits/range"] });
      setRouteMetrics({});
    },
    onError: (err: Error) => toast({ title: "Error reordering stops", description: err.message, variant: "destructive" }),
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
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      setRouteMetrics(prev => { const next = { ...prev }; delete next[routeId]; return next; });
      if (data.optimized) {
        setSavingsResult(data);
        setShowSavings(true);
        setGeocodeAlert(null);
        setHighlightedStopIds(new Set());
      } else if (data.geocodeFailure && data.failedStops && data.failedStops.length > 0) {
        setGeocodeAlert({ routeId, stops: data.failedStops });
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

  const retryGeocodeMutation = useMutation({
    mutationFn: async (routeId: string) => {
      await apiRequest("POST", "/api/properties/geocode-all");
      const res = await apiRequest("POST", `/api/routes/${routeId}/optimize`);
      return res.json() as Promise<OptimizeResult>;
    },
    onSuccess: (data, routeId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans?isActive=true"] });
      queryClient.invalidateQueries({ queryKey: ["/api/route-credits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      setRouteMetrics(prev => { const next = { ...prev }; delete next[routeId]; return next; });
      if (data.optimized) {
        setGeocodeAlert(null);
        setHighlightedStopIds(new Set());
        setSavingsResult(data);
        setShowSavings(true);
      } else if (data.geocodeFailure && data.failedStops && data.failedStops.length > 0) {
        setGeocodeAlert({ routeId, stops: data.failedStops });
        toast({ title: "Some stops still ungeocoded", description: `${data.failedStops.length} stop${data.failedStops.length !== 1 ? "s" : ""} could not be geocoded. Check their addresses.`, variant: "destructive" });
      } else {
        setGeocodeAlert(null);
        toast({ title: "Could not optimize", description: data.message });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
    },
  });

  const reverseRouteMutation = useMutation({
    mutationFn: async (routeId: string) => {
      setReversingRouteId(routeId);
      const res = await apiRequest("POST", `/api/routes/${routeId}/reverse`);
      return res.json() as Promise<{ reversed: boolean; message?: string; stopCount?: number }>;
    },
    onSuccess: (data, routeId) => {
      setReversingRouteId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans?isActive=true"] });
      setRouteMetrics(prev => { const next = { ...prev }; delete next[routeId]; return next; });
      if (data.reversed) {
        toast({ title: "Route reversed", description: `${data.stopCount} stops reordered` });
      } else {
        toast({ title: "Could not reverse", description: data.message });
      }
    },
    onError: (err: Error) => {
      setReversingRouteId(null);
      toast({ title: "Reverse failed", description: err.message, variant: "destructive" });
    },
  });

  const lockRouteMutation = useMutation({
    mutationFn: async (routeId: string) => {
      setLockingRouteId(routeId);
      const res = await apiRequest("PATCH", `/api/routes/${routeId}/lock`);
      return res.json() as Promise<Route>;
    },
    onSuccess: (data) => {
      setLockingRouteId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      toast({ title: data.isLocked ? "Route locked" : "Route unlocked", description: data.isLocked ? "Optimize and reverse are now blocked for this route." : "Route can now be optimized and reversed." });
    },
    onError: (err: Error) => {
      setLockingRouteId(null);
      toast({ title: "Lock toggle failed", description: err.message, variant: "destructive" });
    },
  });

  const dispatchMutation = useMutation({
    mutationFn: async (routeId: string) => {
      setDispatchingRouteId(routeId);
      const res = await apiRequest("POST", `/api/routes/${routeId}/dispatch`, { date: toLocalDateString(new Date(), tz) });
      return res.json();
    },
    onSuccess: (data: any) => {
      setDispatchingRouteId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/visits/range"] });
      toast({ title: "Route dispatched", description: `${data.visitsCreated} visits created for ${data.date}${data.visitsSkipped > 0 ? ` (${data.visitsSkipped} already existed)` : ""}` });
    },
    onError: (err: Error) => {
      setDispatchingRouteId(null);
      toast({ title: "Dispatch failed", description: err.message, variant: "destructive" });
    },
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

  const moveToDayMutation = useMutation({
    mutationFn: async ({ routeId, targetDate }: { routeId: string; targetDate: string }) => {
      const res = await apiRequest("POST", `/api/routes/${routeId}/move-day`, { targetDate });
      return res.json() as Promise<{ movedCount: number; targetRouteId: string }>;
    },
    onSuccess: (data) => {
      setMoveToDayRouteId(null);
      setMoveToDayDate("");
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/visits/range"] });
      toast({ title: "Route moved", description: `${data.movedCount} visit${data.movedCount === 1 ? "" : "s"} moved to the selected day.` });
    },
    onError: (err: Error) => {
      toast({ title: "Move failed", description: err.message, variant: "destructive" });
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

    if (currentContainer === target) {
      if (target === UNASSIGNED_DROP) return;
      const routeId = target.replace("route-", "");
      const routeStops = servicePlans
        .filter(sp => sp.routeId === routeId)
        .sort((a, b) => a.stopOrder - b.stopOrder);
      const draggedIndex = routeStops.findIndex(sp => sp.id === stopId);
      const overId = over.id as string;
      const overIndex = routeStops.findIndex(sp => sp.id === overId);
      if (draggedIndex === -1 || overIndex === -1 || draggedIndex === overIndex) return;
      const reordered = [...routeStops];
      const [removed] = reordered.splice(draggedIndex, 1);
      reordered.splice(overIndex, 0, removed);
      reorderStopsMutation.mutate({ routeId, orderedIds: reordered.map(sp => sp.id) });
      return;
    }

    const newRouteId = target === UNASSIGNED_DROP ? null : target.replace("route-", "");
    const targetRoute = newRouteId ? allRoutes.find(r => r.id === newRouteId) : null;
    const dayOfWeek = targetRoute ? targetRoute.dayOfWeek : undefined;
    assignStopMutation.mutate({ stopId, routeId: newRouteId, dayOfWeek: dayOfWeek ?? undefined });
  }
  function handleDragCancel() { setActiveDragId(null); setOverContainerId(null); }

  function handleRouteFormSubmit(data: { name: string; dayOfWeek: string; technicianId: string | null; color: string }) {
    if (editingRoute) updateRouteMutation.mutate({ id: editingRoute.id, ...data });
    else createRouteMutation.mutate(data);
  }

  function handleOptimizeClick(routeId: string, stopCount: number) {
    const route = allRoutes.find(r => r.id === routeId);
    if (route?.isLocked) {
      toast({ title: "Route is locked", description: "Unlock this route before optimizing.", variant: "destructive" });
      return;
    }
    const hasUnlimited = credits >= 999999;
    if (!hasUnlimited && credits < (stopCount <= 30 ? 1 : 2)) {
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
              Available Credits: {credits >= 999999 ? "∞" : credits}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5" title="Set a maximum stops per route and split all oversized routes at once">
              <Label htmlFor="max-stops-input" className="text-xs text-muted-foreground whitespace-nowrap">Max stops</Label>
              <Input
                id="max-stops-input"
                type="number"
                min={2}
                placeholder="50"
                value={maxStopsInput}
                onChange={e => setMaxStopsInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleApplyMaxStops(); }}
                className="w-16 h-8 text-xs"
                data-testid="input-max-stops"
                disabled={isApplyingSplit}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs px-2"
                onClick={handleApplyMaxStops}
                disabled={isApplyingSplit}
                data-testid="button-apply-max-stops"
              >
                {isApplyingSplit ? <Loader2 className="h-3 w-3 animate-spin" /> : "Apply"}
              </Button>
            </div>
            <Button
              variant={viewMode === "map" ? "default" : "outline"}
              size="sm"
              className="xl:hidden"
              onClick={() => setViewMode(viewMode === "list" ? "map" : "list")}
              data-testid="button-toggle-view"
            >
              {viewMode === "list" ? <MapIcon className="h-4 w-4 mr-1" /> : <List className="h-4 w-4 mr-1" />}
              {viewMode === "list" ? "Map" : "Routes"}
            </Button>
            <Button
              variant={showZones ? "default" : "outline"}
              size="sm"
              onClick={() => setShowZones(!showZones)}
              data-testid="button-toggle-zones"
            >
              <MapPin className="h-4 w-4 mr-1" /> {showZones ? "Hide Zones" : "Manage Zones"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowWeeklyOptimizer(true)}
              data-testid="button-weekly-optimizer"
            >
              <Sparkles className="h-4 w-4 mr-1" /> Optimize Week
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowPurchase(true)} data-testid="button-buy-credits">
              <ShoppingCart className="h-4 w-4 mr-1" /> Buy Credits
            </Button>
            {isLivePlaybackEnabled && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowLivePlayback(true)}
                data-testid="button-open-live-playback"
                className="text-primary border-primary/50 hover:bg-primary/10"
              >
                <Play className="h-4 w-4 mr-1" /> Live Playback
              </Button>
            )}
            <Button size="sm" onClick={() => { setEditingRoute(null); setDialogOpen(true); }} data-testid="button-create-route">
              <Plus className="h-4 w-4 mr-1" /> New Route
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-1 mb-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setWeekOffset(o => o - 1)}
            data-testid="button-prev-week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium tabular-nums text-muted-foreground min-w-[160px] text-center" data-testid="text-week-range">
            {weekRangeLabel}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setWeekOffset(o => o + 1)}
            data-testid="button-next-week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {weekOffset !== 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-primary ml-1"
              onClick={() => setWeekOffset(0)}
              data-testid="button-today-week"
            >
              Today
            </Button>
          )}
        </div>

        <div className="flex gap-1 overflow-x-auto pb-1">
          {DAYS.map((day, idx) => {
            const mondayDate = new Date(currentWeekRange.start);
            const dayDate = new Date(mondayDate);
            dayDate.setDate(mondayDate.getDate() + idx);
            const dateNum = dayDate.getDate();
            return (
              <Button key={day} variant={selectedDay === day ? "default" : "secondary"}
                onClick={() => setSelectedDay(day)}
                className="relative flex flex-col items-center px-3 py-2 h-auto whitespace-nowrap"
                data-testid={`button-day-${day}`}
              >
                <span className="text-xs">{DAY_SHORT[day]}</span>
                <span className="text-lg font-bold leading-tight">{dateNum}</span>
                <span className="text-[10px] opacity-70">{dayStopCounts[day] || 0} stops</span>
              </Button>
            );
          })}
        </div>

        {showZones && <ServiceZonesPanel />}
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
          <div className="flex-1 flex overflow-hidden">
            {/* Left panel: routes + unassigned — hidden on small screens when map view is active */}
            <div className={`flex-1 flex-col overflow-auto p-4 md:p-6 pt-4 ${viewMode === "map" ? "hidden xl:flex" : "flex"}`}>
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

                  {weekOffset > 0 && dayVisits.length === 0 && routesForDay.length > 0 && (
                    <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 px-3 py-2 mb-3 text-sm text-blue-700 dark:text-blue-300" data-testid="banner-no-visits-yet">
                      <Info className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>Visits for this week haven't been generated yet — check back later or adjust your auto-visit window.</span>
                    </div>
                  )}

                  {geocodeAlert && routesForDay.some(r => r.id === geocodeAlert.routeId) && (
                    <div className="rounded-lg border border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30 p-4 mb-3 space-y-3" data-testid="banner-geocode-alert">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="h-5 w-5 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-sm font-semibold text-orange-800 dark:text-orange-200">
                              {geocodeAlert.stops.length} stop{geocodeAlert.stops.length !== 1 ? "s" : ""} could not be geocoded
                            </p>
                            <p className="text-xs text-orange-700 dark:text-orange-300 mt-0.5">
                              These stops are missing map coordinates and were excluded from the optimization. Check their addresses and retry.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setGeocodeAlert(null); setHighlightedStopIds(new Set()); }}
                          className="text-orange-500 hover:text-orange-700 dark:hover:text-orange-300 shrink-0"
                          data-testid="button-dismiss-geocode-alert"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <ul className="space-y-1 ml-7" data-testid="list-geocode-failed-stops">
                        {geocodeAlert.stops.map((stop) => (
                          <li key={stop.servicePlanId} className="flex items-start gap-2 text-xs text-orange-800 dark:text-orange-200">
                            <MapPin className="h-3 w-3 shrink-0 mt-0.5 text-orange-500" />
                            <span>
                              <span className="font-medium">{stop.name}</span>
                              {stop.address && stop.address !== "No address" && (
                                <span className="text-orange-600 dark:text-orange-400"> — {stop.address}</span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="flex items-center gap-2 ml-7">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950/50"
                          onClick={() => {
                            const ids = new Set(geocodeAlert.stops.map(s => s.servicePlanId));
                            setHighlightedStopIds(ids);
                            const firstId = geocodeAlert.stops[0]?.servicePlanId;
                            if (firstId) {
                              requestAnimationFrame(() => {
                                const el = document.querySelector(`[data-testid="draggable-stop-${firstId}"]`);
                                el?.scrollIntoView({ behavior: "smooth", block: "center" });
                              });
                            }
                          }}
                          data-testid="button-show-ungeocoded-stops"
                        >
                          <MapPin className="h-3 w-3 mr-1" />
                          Show stops
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950/50"
                          onClick={() => retryGeocodeMutation.mutate(geocodeAlert.routeId)}
                          disabled={retryGeocodeMutation.isPending}
                          data-testid="button-retry-geocoding"
                        >
                          {retryGeocodeMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <RotateCcw className="h-3 w-3 mr-1" />
                          )}
                          Retry geocoding
                        </Button>
                      </div>
                    </div>
                  )}

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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                          onReverse={(id) => {
                            const r = allRoutes.find(rt => rt.id === id);
                            if (r?.isLocked) {
                              toast({ title: "Route is locked", description: "Unlock this route before reversing.", variant: "destructive" });
                              return;
                            }
                            reverseRouteMutation.mutate(id);
                          }}
                          onDispatch={(id) => dispatchMutation.mutate(id)}
                          onUnassignAll={(id) => setConfirmUnassignAll(id)}
                          onLock={(id) => lockRouteMutation.mutate(id)}
                          onMoveToDay={(id) => { setMoveToDayRouteId(id); setMoveToDayDate(""); }}
                          isOptimizing={optimizingRouteId === route.id}
                          isReversing={reversingRouteId === route.id}
                          isDispatching={dispatchingRouteId === route.id}
                          isLocking={lockingRouteId === route.id}
                          visitsByPlan={visitsByPlan}
                          onVisitStatusChange={handleVisitStatusChange}
                          updatingVisitId={updatingVisitId}
                          updatingVisitStatus={updatingVisitStatus}
                          metrics={routeMetrics[route.id] || null}
                          metricsLoading={metricsLoadingRoutes.has(route.id)}
                          isUnassigning={unassigningRouteId === route.id}
                          onStopClick={handleStopClick}
                          onOnMyWay={handleOnMyWay}
                          onMyWaySendingId={onMyWaySending}
                          onSelectStop={(id) => setSelectedStopId(prev => prev === id ? null : id)}
                          selectedStopId={selectedStopId}
                          highlightedStopIds={highlightedStopIds}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="lg:w-64 xl:w-72 shrink-0">
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

            {/* Right panel: map — always visible on xl+, full-width on smaller screens when viewMode=map */}
            <div
              className={`border-l flex-col overflow-hidden ${viewMode === "map" ? "flex flex-1 xl:w-[340px] xl:flex-none xl:shrink-0" : "hidden xl:flex xl:w-[340px] xl:shrink-0"}`}
              data-testid="route-map-view-wrapper"
            >
              <Suspense fallback={<Skeleton className="h-full w-full" />}>
                <RouteMapView
                  stops={mapStops}
                  routeName={`${DAY_LABELS[selectedDay]} Routes`}
                  selectedStopId={selectedStopId}
                  onStopClick={(id) => setSelectedStopId(prev => prev === id ? null : id)}
                />
              </Suspense>
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
          {(!company?.startLatitude || !company?.startLongitude) && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300" data-testid="warning-no-start-address">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                No start address is configured. Optimization quality will be reduced because the first stop cannot be anchored by drive time.{" "}
                <Link href="/settings" className="underline font-medium">Add one in Settings</Link> for better results.
              </span>
            </div>
          )}
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

      <Dialog open={!!moveToDayRouteId} onOpenChange={(open) => { if (!open) { setMoveToDayRouteId(null); setMoveToDayDate(""); } }}>
        <DialogContent data-testid="dialog-move-to-day">
          <DialogHeader>
            <DialogTitle>Move Route to Another Day</DialogTitle>
            <DialogDescription>
              All scheduled visits in this route will be moved to the selected date. Visits that are already in progress, completed, skipped, or cancelled will remain unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="move-to-day-date">Target Date</Label>
              <Input
                id="move-to-day-date"
                type="date"
                value={moveToDayDate}
                onChange={(e) => setMoveToDayDate(e.target.value)}
                data-testid="input-move-to-day-date"
              />
              {moveToDayDate && moveToDayRouteId && allRoutes.find(r => r.id === moveToDayRouteId)?.date === moveToDayDate && (
                <p className="text-xs text-destructive" data-testid="text-same-date-error">
                  Target date must be different from the route's current date.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMoveToDayRouteId(null); setMoveToDayDate(""); }} data-testid="button-cancel-move-to-day">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (moveToDayRouteId && moveToDayDate) {
                  moveToDayMutation.mutate({ routeId: moveToDayRouteId, targetDate: moveToDayDate });
                }
              }}
              disabled={
                !moveToDayDate ||
                moveToDayMutation.isPending ||
                (moveToDayRouteId ? allRoutes.find(r => r.id === moveToDayRouteId)?.date === moveToDayDate : false)
              }
              data-testid="button-confirm-move-to-day"
            >
              {moveToDayMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SavingsSummaryDialog open={showSavings} onOpenChange={setShowSavings} result={savingsResult} />
      <StripePricingTableDialog open={showPurchase} onOpenChange={setShowPurchase}
        companyId={user?.companyId}
        topUpNeeded={purchaseTopUpNeeded}
        initialCredits={credits} />

      <RouteVisitDetailSheet
        visit={detailVisit}
        servicePlan={detailPlan}
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        contacts={contacts}
        properties={properties}
        routes={allRoutes}
        selectedDayDate={selectedDayDate}
        onRequestComplete={(visitId, contactName, address) => {
          setCompleteDialogVisitId(visitId);
          setCompleteDialogContactName(contactName);
          setCompleteDialogAddress(address);
          setGatePhoto(null);
          setGatePhotoPreview(null);
          setExtraFiles([]);
          setCompletionNotes("");
          setIsCompleting(false);
        }}
      />

      {showWeeklyOptimizer && (
        <WeeklyOptimizerPanel
          open={showWeeklyOptimizer}
          onOpenChange={setShowWeeklyOptimizer}
          credits={credits}
          monthlyAllowance={monthlyAllowance}
          onNeedCredits={(topUpNeeded) => { setPurchaseTopUpNeeded(topUpNeeded); setShowPurchase(true); }}
        />
      )}

      <Dialog open={!!completeDialogVisitId} onOpenChange={(open) => {
        if (!open) {
          setCompleteDialogVisitId(null);
          setNoGate(false);
          setGatePhoto(null);
          setGatePhotoPreview(null);
          setExtraFiles([]);
          setCompletionNotes("");
        }
      }}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto" data-testid="dialog-complete-visit">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DoorClosed className="h-5 w-5" />
              Complete Visit
            </DialogTitle>
            <DialogDescription>
              {completeDialogAddress} - {completeDialogContactName}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* No gate checkbox */}
            <label className="flex items-center gap-3 p-3 rounded-md border cursor-pointer hover:bg-muted/50" data-testid="label-no-gate">
              <input
                type="checkbox"
                checked={noGate}
                onChange={e => {
                  setNoGate(e.target.checked);
                  if (e.target.checked) {
                    setGatePhoto(null);
                    setGatePhotoPreview(null);
                    setExtraFiles([]);
                  }
                }}
                className="h-4 w-4 accent-primary"
                data-testid="checkbox-no-gate"
              />
              <div>
                <p className="text-sm font-medium">No gate</p>
                <p className="text-xs text-muted-foreground">Photo not required for this yard</p>
              </div>
            </label>

            {!noGate && (
              <>
                <div>
                  <p className="text-sm font-medium mb-1">Proof Photo (required)</p>
                  <p className="text-xs text-muted-foreground mb-2">Take a photo showing the service area is clean and secure</p>
                  <input
                    type="file"
                    accept="image/*"
                    ref={gateFileInputRef}
                    className="hidden"
                    onChange={handleGatePhotoCapture}
                    data-testid="input-gate-photo"
                  />
                  {gatePhotoPreview ? (
                    <div className="relative">
                      <img
                        src={gatePhotoPreview}
                        alt="Gate closed"
                        className="rounded-md max-h-32 sm:max-h-48 w-full object-cover"
                        data-testid="img-gate-preview"
                      />
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={() => { setGatePhoto(null); setGatePhotoPreview(null); }}
                        data-testid="button-remove-gate-photo"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full h-24 border-dashed"
                      onClick={() => gateFileInputRef.current?.click()}
                      data-testid="button-capture-gate-photo"
                    >
                      <Camera className="mr-2 h-5 w-5" />
                      Take Photo or Choose from Library
                    </Button>
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">Additional Photos (optional)</p>
                  <input
                    type="file"
                    accept="image/*"
                    ref={extraFileInputRef}
                    className="hidden"
                    onChange={handleExtraPhotoCapture}
                    data-testid="input-extra-photo"
                  />
                  {extraFiles.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      {extraFiles.map((ef, i) => (
                        <div key={i} className="relative">
                          <img
                            src={ef.preview}
                            alt={`Extra ${i + 1}`}
                            className="rounded-md h-20 w-full object-cover"
                            data-testid={`img-extra-preview-${i}`}
                          />
                          <Button
                            variant="destructive"
                            size="icon"
                            className="absolute top-0.5 right-0.5 h-5 w-5"
                            onClick={() => removeExtraPhoto(i)}
                            data-testid={`button-remove-extra-${i}`}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => extraFileInputRef.current?.click()}
                    data-testid="button-add-extra-photo"
                  >
                    <Plus className="mr-1 h-4 w-4" /> Add Photo
                  </Button>
                </div>
              </>
            )}

            <div>
              <p className="text-sm font-medium mb-1">Notes (optional)</p>
              <Textarea
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value)}
                placeholder="Add notes..."
                className="text-sm"
                data-testid="input-completion-notes"
              />
            </div>

            <div className="rounded-md bg-muted p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Text to customer:</p>
              <p className="text-sm" data-testid="text-completion-sms-preview">
                {noGate
                  ? completionMessage.replace("Here is your gate closed image. ", "")
                  : completionMessage}
              </p>
              {(() => {
                const visitDate = dayVisits.find(v => v.id === completeDialogVisitId)?.scheduledDate;
                const isToday = visitDate === new Date().toISOString().split("T")[0];
                if (!isToday) {
                  return <p className="text-xs text-muted-foreground mt-1 italic">No message will be sent (past visit)</p>;
                }
                return null;
              })()}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCompleteDialogVisitId(null);
                setNoGate(false);
                setGatePhoto(null);
                setGatePhotoPreview(null);
                setExtraFiles([]);
                setCompletionNotes("");
              }}
              disabled={isCompleting}
              data-testid="button-cancel-complete"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCompleteAndSend}
              disabled={(!gatePhoto && !noGate) || isCompleting}
              data-testid="button-send-complete"
            >
              {isCompleting ? (
                <Loader2 className="animate-spin mr-2 h-4 w-4" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {isCompleting ? "Completing..." : "Complete & Notify"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showLivePlayback && (
        <LiveRoutePlayback
          visits={dayVisits as any}
          onClose={() => setShowLivePlayback(false)}
        />
      )}
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
        priceSurchargePercent: z.priceSurchargePercent ?? 0,
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
            if (existing && (existing.dayOfWeek !== zone.dayOfWeek || (existing.priceSurchargePercent ?? 0) !== (zone.priceSurchargePercent ?? 0))) {
              await fetch(`/api/service-zones/${zone.id}`, {
                method: "PATCH",
                credentials: "include",
                headers: authHeaders,
                body: JSON.stringify({ dayOfWeek: zone.dayOfWeek, priceSurchargePercent: zone.priceSurchargePercent ?? 0 }),
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
        <CardDescription className="text-xs">Define which zip codes you service, what day you work each area, and any price surcharge by zone</CardDescription>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {isLoading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : (
          <>
            <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
              <ServiceZoneMap
                zones={zones}
                onZonesChange={handleZonesChange}
                compact
              />
            </Suspense>
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
