import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toLocalDateString } from "@/lib/utils";
import { useCompanyTimezone } from "@/hooks/use-company-timezone";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MapPin,
  Dog,
  Phone,
  CheckCircle,
  Clock,
  XCircle,
  ChevronDown,
  ChevronUp,
  Satellite,
  Play,
  SkipForward,
  Navigation,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { StreetViewImage } from "@/components/street-view-image";
import { SatelliteImage } from "@/components/satellite-image";
import { useOffline } from "@/hooks/use-offline";
import { OfflineStatusBar } from "@/components/offline-status-bar";
import { cacheRouteData, getCachedRouteData, addPendingMutation } from "@/lib/offline-store";
import { isNetworkError } from "@/lib/offline-sync";

const daysOfWeek = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const dayFullLabels: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

type VisitStatus = "scheduled" | "in_progress" | "completed" | "skipped" | "cancelled";

const visitStatusConfig: Record<VisitStatus, { label: string; color: string; icon: typeof Clock }> =
  {
    scheduled: {
      label: "Scheduled",
      color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
      icon: Clock,
    },
    in_progress: {
      label: "In Progress",
      color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
      icon: Play,
    },
    completed: {
      label: "Completed",
      color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
      icon: CheckCircle,
    },
    skipped: {
      label: "Skipped",
      color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
      icon: SkipForward,
    },
    cancelled: {
      label: "Cancelled",
      color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
      icon: XCircle,
    },
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
    hasDangerousDog: boolean | null;
    dangerousDogNotes: string | null;
  } | null;
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
  } | null;
};

type RouteGroup = {
  routeId: string;
  routeName: string;
  routeColor: string | null;
  visits: EnrichedVisit[];
  completedCount: number;
  totalCount: number;
};

function getDateForDay(dayName: string, timezone?: string): string {
  const today = new Date();
  const todayDayIndex = today.getDay();
  const daysMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const targetDayIndex = daysMap[dayName] ?? todayDayIndex;
  const diff = targetDayIndex - todayDayIndex;
  const target = new Date(today);
  target.setDate(today.getDate() + diff);
  return toLocalDateString(target, timezone);
}

function getTodayDayName(): string {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days[new Date().getDay()];
}

function VisitRow({
  visit,
  onStatusChange,
  isUpdating,
  isExpanded,
  onToggleExpand,
  onOnMyWay,
  onMyWaySendingId,
  onMyWayCooldowns,
}: {
  visit: EnrichedVisit;
  onStatusChange: (visitId: string, status: VisitStatus) => void;
  isUpdating: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOnMyWay?: (visitId: string) => void;
  onMyWaySendingId?: string | null;
  onMyWayCooldowns?: Record<string, number>;
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
              <p
                className="text-xs text-muted-foreground mt-0.5"
                data-testid={`text-tech-plan-${visit.id}`}
              >
                {visit.servicePlanName}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge
              className={`text-xs ${config.color}`}
              data-testid={`badge-tech-status-${visit.id}`}
            >
              <StatusIcon className="h-3 w-3 mr-1" />
              {config.label}
            </Badge>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {visit.property?.hasDangerousDog && (
          <div
            className="flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2"
            data-testid={`alert-dangerous-dog-${visit.id}`}
          >
            <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-red-700 dark:text-red-300">
                Dangerous Dog Warning
              </p>
              {visit.property.dangerousDogNotes && (
                <p
                  className="text-xs text-red-600 dark:text-red-400 mt-0.5"
                  data-testid={`text-dangerous-dog-notes-${visit.id}`}
                >
                  {visit.property.dangerousDogNotes}
                </p>
              )}
            </div>
          </div>
        )}

        {isExpanded && (
          <div className="space-y-3 pt-2 border-t">
            {address && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs gap-1 px-2 min-h-[44px]"
                    onClick={() => setShowSatellite(!showSatellite)}
                    data-testid={`button-toggle-route-view-${visit.id}`}
                  >
                    <Satellite className="h-3 w-3" />
                    {showSatellite ? "Street" : "Aerial"}
                  </Button>
                </div>
                {showSatellite ? (
                  <SatelliteImage
                    address={address}
                    className="h-[120px]"
                    size="400x200"
                    zoom={19}
                  />
                ) : (
                  <StreetViewImage address={address} className="h-[120px]" size="400x200" />
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-xs">
              {visit.property?.numberOfDogs != null && visit.property.numberOfDogs > 0 && (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Dog className="h-3 w-3" />
                  <span>
                    {visit.property.numberOfDogs}{" "}
                    {visit.property.numberOfDogs === 1 ? "dog" : "dogs"}
                  </span>
                </div>
              )}
              {visit.contact?.phone && (
                <div className="flex items-center gap-1 text-muted-foreground col-span-2">
                  <Phone className="h-3 w-3" />
                  <a
                    href={`tel:${visit.contact.phone}`}
                    className="hover:underline"
                    data-testid={`link-tech-phone-${visit.id}`}
                  >
                    {visit.contact.phone}
                  </a>
                </div>
              )}
            </div>

            {visit.property?.specialInstructions && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-0.5">Notes</p>
                <p className="text-xs break-words" data-testid={`text-tech-notes-${visit.id}`}>
                  {visit.property.specialInstructions}
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {onOnMyWay && !isTerminal && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOnMyWay(visit.id);
                  }}
                  disabled={
                    onMyWaySendingId === visit.id ||
                    !!(
                      onMyWayCooldowns &&
                      onMyWayCooldowns[visit.id] &&
                      Date.now() < onMyWayCooldowns[visit.id]
                    )
                  }
                  className="min-h-[44px]"
                  data-testid={`button-on-my-way-${visit.id}`}
                >
                  {onMyWaySendingId === visit.id ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Navigation className="h-3.5 w-3.5 mr-1" />
                  )}
                  On My Way
                </Button>
              )}
              {status === "scheduled" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStatusChange(visit.id, "in_progress");
                  }}
                  disabled={isUpdating}
                  className="min-h-[44px]"
                  data-testid={`button-mark-in-progress-${visit.id}`}
                >
                  <Play className="h-3.5 w-3.5 mr-1" />
                  Start
                </Button>
              )}
              {status === "in_progress" && (
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStatusChange(visit.id, "completed");
                  }}
                  disabled={isUpdating}
                  className="min-h-[44px]"
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
                  onClick={(e) => {
                    e.stopPropagation();
                    onStatusChange(visit.id, "skipped");
                  }}
                  disabled={isUpdating}
                  className="min-h-[44px]"
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
                  onClick={(e) => {
                    e.stopPropagation();
                    onStatusChange(visit.id, "cancelled");
                  }}
                  disabled={isUpdating}
                  className="min-h-[44px]"
                  data-testid={`button-mark-cancel-${visit.id}`}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  Cancel
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
  const tz = useCompanyTimezone();
  const { toast } = useToast();
  const offline = useOffline();
  const [selectedDay, setSelectedDay] = useState<string>(getTodayDayName());
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingAdvanceAfter, setPendingAdvanceAfter] = useState<string | null>(null);
  const [cachedVisits, setCachedVisits] = useState<EnrichedVisit[] | null>(null);

  const selectedDate = useMemo(() => getDateForDay(selectedDay, tz), [selectedDay, tz]);
  const cacheKey = `visits-routes-${selectedDate}`;

  const {
    data: fetchedVisits,
    isLoading: fetchLoading,
    isError: fetchError,
  } = useQuery<EnrichedVisit[]>({
    queryKey: ["/api/visits/today", selectedDate],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/visits/today?date=${selectedDate}`);
      return res.json();
    },
  });

  useEffect(() => {
    if (fetchedVisits) {
      cacheRouteData(cacheKey, fetchedVisits);
      setCachedVisits(null);
    }
  }, [fetchedVisits, cacheKey]);

  useEffect(() => {
    if (fetchError && !fetchedVisits) {
      getCachedRouteData<EnrichedVisit[]>(cacheKey).then((cached) => {
        if (cached) {
          setCachedVisits(cached);
          toast({
            title: "Using cached data",
            description: "Showing your last loaded route data while offline.",
          });
        }
      });
    }
  }, [fetchError, fetchedVisits, cacheKey, toast]);

  const visits = fetchedVisits ?? cachedVisits;
  const isLoading = fetchLoading && !cachedVisits;

  const routeGroups = useMemo<RouteGroup[]>(() => {
    if (!visits) return [];
    const groups = new Map<string, RouteGroup>();
    for (const visit of visits) {
      const key = visit.routeId || "unassigned";
      if (!groups.has(key)) {
        groups.set(key, {
          routeId: key,
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
      if (
        visit.status === "completed" ||
        visit.status === "skipped" ||
        visit.status === "cancelled"
      ) {
        group.completedCount++;
      }
    }
    return Array.from(groups.values());
  }, [visits]);

  useEffect(() => {
    if (pendingAdvanceAfter && visits) {
      const allVisitsList = routeGroups.flatMap((g) => g.visits);
      const completedIdx = allVisitsList.findIndex((v) => v.id === pendingAdvanceAfter);
      if (completedIdx >= 0) {
        const nextIncomplete = allVisitsList
          .slice(completedIdx + 1)
          .find((v) => v.status === "scheduled" || v.status === "in_progress");
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
      try {
        await apiRequest("PATCH", `/api/visits/${visitId}`, body);
      } catch (err) {
        if (isNetworkError(err)) {
          await addPendingMutation({ method: "PATCH", url: `/api/visits/${visitId}`, body });
          offline.refreshPendingCount();
          if (visits) {
            const updated = visits.map((v) =>
              v.id === visitId
                ? {
                    ...v,
                    status,
                    ...(body.startedAt ? { startedAt: body.startedAt as string } : {}),
                    ...(body.completedAt ? { completedAt: body.completedAt as string } : {}),
                  }
                : v
            );
            cacheRouteData(cacheKey, updated);
            setCachedVisits(updated);
            queryClient.setQueryData<EnrichedVisit[]>(["/api/visits/today", selectedDate], updated);
          }
          toast({
            title: "Visit updated (offline)",
            description: "Will sync when connection returns.",
          });
          return { visitId, status, queuedOffline: true };
        }
        throw err;
      }
      return { visitId, status, queuedOffline: false };
    },
    onSuccess: (data) => {
      if (data?.queuedOffline) return;
      if (data && (data.status === "completed" || data.status === "skipped")) {
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

  const [onMyWaySending, setOnMyWaySending] = useState<string | null>(null);
  const [onMyWayCooldowns, setOnMyWayCooldowns] = useState<Record<string, number>>({});

  const handleOnMyWay = useCallback(
    (visitId: string) => {
      if (onMyWayCooldowns[visitId] && Date.now() < onMyWayCooldowns[visitId]) {
        toast({
          title: "SMS already sent",
          description: "Please wait before sending another on-my-way message.",
        });
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
            setOnMyWayCooldowns((prev) => ({ ...prev, [visitId]: Date.now() + 5 * 60 * 1000 }));
            queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
            queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
            toast({
              title: "On-my-way SMS sent",
              description: `${data.contactName} notified — ETA ~${data.etaMinutes} min`,
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Failed to send SMS";
            toast({ title: "Failed to send SMS", description: msg, variant: "destructive" });
          } finally {
            setOnMyWaySending(null);
          }
        },
        (geoErr) => {
          setOnMyWaySending(null);
          toast({
            title: "Location unavailable",
            description: geoErr.message || "Could not get your current location",
            variant: "destructive",
          });
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    },
    [onMyWayCooldowns, toast]
  );

  const completedCount = visits?.filter((v) => v.status === "completed").length ?? 0;
  const totalCount = visits?.length ?? 0;

  return (
    <div className="p-4 space-y-4 overflow-auto h-full max-w-2xl mx-auto">
      <OfflineStatusBar
        isOnline={offline.isOnline}
        pendingCount={offline.pendingCount}
        isSyncing={offline.isSyncing}
        lastSyncResult={offline.lastSyncResult}
        onRetrySync={offline.performSync}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold" data-testid="text-tech-routes-heading">
            Route Overview
          </h1>
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
              className="shrink-0 relative min-h-[44px]"
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
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : visits && visits.length > 0 ? (
        <div className="space-y-4">
          {routeGroups.map((group) => (
            <div key={group.routeId} className="space-y-2">
              <div
                className="flex items-center justify-between"
                data-testid={`text-route-group-${group.routeName}`}
              >
                <div className="flex items-center gap-2">
                  {group.routeColor && (
                    <span
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: group.routeColor }}
                    />
                  )}
                  <h2 className="text-sm font-semibold">{group.routeName}</h2>
                </div>
                <span
                  className="text-xs text-muted-foreground"
                  data-testid={`text-route-progress-${group.routeName}`}
                >
                  {group.completedCount} of {group.totalCount} done
                </span>
              </div>
              {group.visits.map((visit) => (
                <VisitRow
                  key={visit.id}
                  visit={visit}
                  onStatusChange={handleStatusChange}
                  isUpdating={updatingId === visit.id}
                  isExpanded={expandedId === visit.id}
                  onToggleExpand={() => setExpandedId(expandedId === visit.id ? null : visit.id)}
                  onOnMyWay={handleOnMyWay}
                  onMyWaySendingId={onMyWaySending}
                  onMyWayCooldowns={onMyWayCooldowns}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent
            className="p-8 text-center text-muted-foreground"
            data-testid="text-tech-no-visits"
          >
            No visits scheduled for {dayFullLabels[selectedDay]}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
