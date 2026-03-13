import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Dog, Phone, CheckCircle, Clock, XCircle, ChevronDown, ChevronUp, Satellite, Play, SkipForward } from "lucide-react";
import { StreetViewImage } from "@/components/street-view-image";
import { SatelliteImage } from "@/components/satellite-image";
import { getYardCategory, formatArea } from "@/components/yard-measure-tool";
import { Link } from "wouter";

const daysOfWeek = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const dayFullLabels: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday",
  friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

type VisitStatus = "scheduled" | "in_progress" | "completed" | "skipped" | "cancelled";

const visitStatusConfig: Record<VisitStatus, { label: string; color: string; icon: typeof Clock }> = {
  scheduled: { label: "Scheduled", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", icon: Clock },
  in_progress: { label: "In Progress", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", icon: Play },
  completed: { label: "Completed", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: CheckCircle },
  skipped: { label: "Skipped", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200", icon: SkipForward },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: XCircle },
};

type EnrichedVisit = {
  id: string;
  scheduledDate: string;
  status: VisitStatus;
  startedAt: string | null;
  completedAt: string | null;
  stopOrder: number;
  routeId: string | null;
  routeName: string | null;
  routeColor: string | null;
  servicePlanName: string | null;
  property: {
    streetAddress: string;
    city: string;
    state: string;
    gateCode: string | null;
    specialInstructions: string | null;
    measuredYardSqft: number | null;
    lotSize: string | null;
    numberOfDogs: number | null;
  } | null;
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
  } | null;
};

type RouteGroup = {
  routeName: string;
  routeColor: string | null;
  visits: EnrichedVisit[];
  completedCount: number;
  totalCount: number;
};

function getDateForDay(dayName: string): string {
  const today = new Date();
  const todayDayIndex = today.getDay();
  const daysMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const targetDayIndex = daysMap[dayName] ?? todayDayIndex;
  const diff = targetDayIndex - todayDayIndex;
  const target = new Date(today);
  target.setDate(today.getDate() + diff);
  return target.toISOString().split("T")[0];
}

function getTodayDayName(): string {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days[new Date().getDay()];
}

function VisitRow({ visit, onStatusChange, isUpdating, isExpanded, onToggleExpand }: {
  visit: EnrichedVisit;
  onStatusChange: (visitId: string, status: VisitStatus) => void;
  isUpdating: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const [showSatellite, setShowSatellite] = useState(false);
  const status = visit.status as VisitStatus;
  const config = visitStatusConfig[status] || visitStatusConfig.scheduled;
  const StatusIcon = config.icon;

  const address = visit.property
    ? `${visit.property.streetAddress}${visit.property.city ? `, ${visit.property.city}` : ""}${visit.property.state ? `, ${visit.property.state}` : ""}`
    : null;

  const isTerminal = status === "completed" || status === "skipped" || status === "cancelled";

  return (
    <Card data-testid={`card-tech-visit-${visit.id}`}>
      <CardContent className="p-3 space-y-2">
        <div
          className="flex items-start justify-between gap-2 cursor-pointer"
          onClick={onToggleExpand}
          data-testid={`button-expand-${visit.id}`}
        >
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm" data-testid={`text-tech-name-${visit.id}`}>
              {visit.contact ? `${visit.contact.firstName} ${visit.contact.lastName}` : "Unknown"}
            </p>
            {address && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate" data-testid={`text-tech-address-${visit.id}`}>
                  {visit.property?.streetAddress}
                  {visit.property?.city ? `, ${visit.property.city}` : ""}
                </span>
              </div>
            )}
            {visit.servicePlanName && (
              <p className="text-[10px] text-muted-foreground mt-0.5" data-testid={`text-tech-plan-${visit.id}`}>
                {visit.servicePlanName}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={`text-[10px] ${config.color}`} data-testid={`badge-tech-status-${visit.id}`}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {config.label}
            </Badge>
            {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>

        {isExpanded && (
          <div className="space-y-3 pt-2 border-t">
            {address && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] gap-1 px-1.5"
                    onClick={() => setShowSatellite(!showSatellite)}
                    data-testid={`button-toggle-route-view-${visit.id}`}
                  >
                    <Satellite className="h-3 w-3" />
                    {showSatellite ? "Street" : "Aerial"}
                  </Button>
                </div>
                {showSatellite ? (
                  <SatelliteImage address={address} className="h-[120px]" size="400x200" zoom={19} />
                ) : (
                  <StreetViewImage address={address} className="h-[120px]" size="400x200" />
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-xs">
              {visit.property?.numberOfDogs != null && visit.property.numberOfDogs > 0 && (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Dog className="h-3 w-3" />
                  <span>{visit.property.numberOfDogs} {visit.property.numberOfDogs === 1 ? "dog" : "dogs"}</span>
                </div>
              )}
              {visit.contact?.phone && (
                <div className="flex items-center gap-1 text-muted-foreground col-span-2">
                  <Phone className="h-3 w-3" />
                  <a href={`tel:${visit.contact.phone}`} className="hover:underline" data-testid={`link-tech-phone-${visit.id}`}>
                    {visit.contact.phone}
                  </a>
                </div>
              )}
            </div>

            {visit.property?.specialInstructions && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-0.5">Notes</p>
                <p className="text-xs" data-testid={`text-tech-notes-${visit.id}`}>{visit.property.specialInstructions}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {status === "scheduled" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); onStatusChange(visit.id, "in_progress"); }}
                  disabled={isUpdating}
                  data-testid={`button-mark-in-progress-${visit.id}`}
                >
                  <Play className="h-3.5 w-3.5 mr-1" />
                  Start
                </Button>
              )}
              {(status === "scheduled" || status === "in_progress") && (
                <Button
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); onStatusChange(visit.id, "completed"); }}
                  disabled={isUpdating}
                  data-testid={`button-mark-complete-${visit.id}`}
                >
                  <CheckCircle className="h-3.5 w-3.5 mr-1" />
                  Complete
                </Button>
              )}
              {(status === "scheduled" || status === "in_progress") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); onStatusChange(visit.id, "skipped"); }}
                  disabled={isUpdating}
                  data-testid={`button-mark-skip-${visit.id}`}
                >
                  <SkipForward className="h-3.5 w-3.5 mr-1" />
                  Skip
                </Button>
              )}
              {(status === "scheduled" || status === "in_progress") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); onStatusChange(visit.id, "cancelled"); }}
                  disabled={isUpdating}
                  data-testid={`button-mark-cancel-${visit.id}`}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  Cancel
                </Button>
              )}
              {(status === "skipped" || status === "cancelled") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); onStatusChange(visit.id, "scheduled"); }}
                  disabled={isUpdating}
                  title="Return to scheduled"
                  data-testid={`button-mark-scheduled-${visit.id}`}
                >
                  <Clock className="h-3.5 w-3.5 mr-1" />
                  Undo
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function TechRoutes() {
  const { toast } = useToast();
  const [selectedDay, setSelectedDay] = useState<string>(getTodayDayName());
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingAdvanceAfter, setPendingAdvanceAfter] = useState<string | null>(null);

  const selectedDate = useMemo(() => getDateForDay(selectedDay), [selectedDay]);

  const { data: visits, isLoading } = useQuery<EnrichedVisit[]>({
    queryKey: ["/api/visits/today", selectedDate],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/visits/today?date=${selectedDate}`);
      return res.json();
    },
  });

  const routeGroups = useMemo<RouteGroup[]>(() => {
    if (!visits) return [];
    const groups = new Map<string, RouteGroup>();
    for (const visit of visits) {
      const key = visit.routeId || "unassigned";
      if (!groups.has(key)) {
        groups.set(key, {
          routeName: visit.routeName || "Unassigned",
          routeColor: visit.routeColor,
          visits: [],
          completedCount: 0,
          totalCount: 0,
        });
      }
      const group = groups.get(key)!;
      group.visits.push(visit);
      group.totalCount++;
      if (visit.status === "completed" || visit.status === "skipped" || visit.status === "cancelled") {
        group.completedCount++;
      }
    }
    return Array.from(groups.values());
  }, [visits]);

  useEffect(() => {
    if (pendingAdvanceAfter && visits) {
      const allVisitsList = routeGroups.flatMap(g => g.visits);
      const completedIdx = allVisitsList.findIndex(v => v.id === pendingAdvanceAfter);
      if (completedIdx >= 0) {
        const nextIncomplete = allVisitsList.slice(completedIdx + 1).find(
          v => v.status === "scheduled" || v.status === "in_progress"
        );
        if (nextIncomplete) {
          setExpandedId(nextIncomplete.id);
        }
      }
      setPendingAdvanceAfter(null);
    }
  }, [visits, pendingAdvanceAfter, routeGroups]);

  const statusMutation = useMutation({
    mutationFn: async ({ visitId, status }: { visitId: string; status: VisitStatus }) => {
      setUpdatingId(visitId);
      const body: Record<string, unknown> = { status };
      if (status === "in_progress") body.startedAt = new Date().toISOString();
      if (status === "completed") body.completedAt = new Date().toISOString();
      if (status === "scheduled") {
        body.completedAt = null;
        body.startedAt = null;
      }
      await apiRequest("PATCH", `/api/visits/${visitId}`, body);
      return { visitId, status };
    },
    onSuccess: (data) => {
      if (data.status === "completed" || data.status === "skipped") {
        setPendingAdvanceAfter(data.visitId);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/visits/today", selectedDate] });
      toast({ title: "Visit updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
    onSettled: () => setUpdatingId(null),
  });

  const handleStatusChange = (visitId: string, status: VisitStatus) => {
    statusMutation.mutate({ visitId, status });
  };

  const completedCount = visits?.filter(v => v.status === "completed").length ?? 0;
  const totalCount = visits?.length ?? 0;
  const hasMultipleRoutes = routeGroups.length > 1;

  return (
    <div className="p-4 space-y-4 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold" data-testid="text-tech-routes-heading">Route Overview</h1>
          <p className="text-xs text-muted-foreground">Quick reference for your daily stops</p>
        </div>
        {totalCount > 0 && (
          <span className="text-sm text-muted-foreground" data-testid="text-tech-progress">
            {completedCount} of {totalCount} completed
          </span>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {daysOfWeek.map((day) => {
          const isToday = day === getTodayDayName();
          const isSelected = day === selectedDay;
          return (
            <Button
              key={day}
              size="sm"
              variant={isSelected ? "default" : "outline"}
              onClick={() => setSelectedDay(day)}
              className="shrink-0 relative"
              data-testid={`button-tech-day-${day}`}
            >
              {dayFullLabels[day].slice(0, 3)}
              {isToday && !isSelected && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />
              )}
            </Button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : visits && visits.length > 0 ? (
        <div className="space-y-4">
          {routeGroups.map((group) => (
            <div key={group.routeName} className="space-y-2">
              {hasMultipleRoutes && (
                <div className="flex items-center justify-between" data-testid={`text-route-group-${group.routeName}`}>
                  <div className="flex items-center gap-2">
                    {group.routeColor && (
                      <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: group.routeColor }} />
                    )}
                    <h2 className="text-sm font-semibold">{group.routeName}</h2>
                  </div>
                  <span className="text-xs text-muted-foreground" data-testid={`text-route-progress-${group.routeName}`}>
                    {group.completedCount} of {group.totalCount} done
                  </span>
                </div>
              )}
              {group.visits.map((visit) => (
                <VisitRow
                  key={visit.id}
                  visit={visit}
                  onStatusChange={handleStatusChange}
                  isUpdating={updatingId === visit.id}
                  isExpanded={expandedId === visit.id}
                  onToggleExpand={() => setExpandedId(expandedId === visit.id ? null : visit.id)}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-tech-no-visits">
            No visits scheduled for {dayFullLabels[selectedDay]}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
