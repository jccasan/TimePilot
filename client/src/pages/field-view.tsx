/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toLocalDateString } from "@/lib/utils";
import { useCompanyTimezone } from "@/hooks/use-company-timezone";
import {
  RefreshCw,
  MapPin,
  CheckCircle,
  Clock,
  User,
  AlertCircle,
  Info,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Route } from "@shared/schema";
import "mapbox-gl/dist/mapbox-gl.css";

type EnrichedVisit = {
  id: string;
  status: string;
  stopOrder: number;
  routeId: string | null;
  routeName: string | null;
  routeColor: string | null;
  scheduledDate: string;
  startTime: string | null;
  contact: { id: string; firstName: string; lastName: string; phone: string | null } | null;
  property: {
    streetAddress: string;
    city: string | null;
    state: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
};

type TeamMember = {
  id: string;
  role: string;
  firstName: string;
  lastName: string;
};

type RouteGroup = {
  routeId: string | null;
  routeName: string;
  routeColor: string;
  techName: string | null;
  visits: EnrichedVisit[];
  completedCount: number;
  totalCount: number;
  nextStop: EnrichedVisit | null;
  overdueIds: Set<string>;
};

function getPinColor(visit: EnrichedVisit, isNext: boolean, isOverdue: boolean): string {
  if (visit.status === "completed" || visit.status === "skipped" || visit.status === "cancelled") {
    return "#9ca3af";
  }
  if (visit.status === "in_progress") {
    return "#3b82f6";
  }
  if (isOverdue) {
    return "#ef4444";
  }
  if (isNext) {
    return "#22c55e";
  }
  return "#f59e0b";
}

const ROUTE_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#6366f1",
  "#14b8a6",
];

export default function FieldView() {
  const tz = useCompanyTimezone();
  const today = toLocalDateString(new Date(), tz);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedDate, setSelectedDate] = useState(today);

  const {
    data: visits,
    isLoading,
    isFetching,
    refetch,
  } = useQuery<EnrichedVisit[]>({
    queryKey: [`/api/visits/today?date=${selectedDate}`],
    refetchInterval: 30000,
  });

  const { data: routes } = useQuery<Route[]>({
    queryKey: ["/api/routes"],
  });

  const { data: team } = useQuery<TeamMember[]>({
    queryKey: ["/api/company/team"],
  });

  const { data: tokenData, isLoading: tokenLoading } = useQuery<{ token: string }>({
    queryKey: ["/api/mapbox-token"],
  });

  const routeGroups = useMemo<RouteGroup[]>(() => {
    if (!visits) return [];

    const groupMap = new Map<string, EnrichedVisit[]>();
    for (const v of visits) {
      const key = v.routeId ?? "__unassigned__";
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(v);
    }

    const groups: RouteGroup[] = [];
    let colorIdx = 0;

    groupMap.forEach((groupVisits, key) => {
      const sorted = [...groupVisits].sort((a, b) => (a.stopOrder ?? 999) - (b.stopOrder ?? 999));
      const routeColor = sorted[0]?.routeColor || ROUTE_COLORS[colorIdx % ROUTE_COLORS.length];
      colorIdx++;

      const routeId = key === "__unassigned__" ? null : key;
      const routeRecord = routeId ? routes?.find((r) => r.id === routeId) : null;
      const tech = routeRecord?.technicianId
        ? team?.find((t) => t.id === routeRecord.technicianId)
        : null;
      const techName = tech ? `${tech.firstName} ${tech.lastName}` : null;

      const completedCount = sorted.filter(
        (v) => v.status === "completed" || v.status === "skipped" || v.status === "cancelled"
      ).length;

      const maxDoneOrder = Math.max(
        0,
        ...sorted
          .filter((v) => v.status === "completed" || v.status === "in_progress")
          .map((v) => v.stopOrder ?? 0)
      );

      const overdueIds = new Set(
        sorted
          .filter((v) => v.status === "scheduled" && (v.stopOrder ?? 999) <= maxDoneOrder)
          .map((v) => v.id)
      );

      const nextStop =
        sorted.find(
          (v) => (v.status === "scheduled" || v.status === "in_progress") && !overdueIds.has(v.id)
        ) ?? null;

      groups.push({
        routeId,
        routeName: sorted[0]?.routeName || "Unassigned",
        routeColor,
        techName,
        visits: sorted,
        completedCount,
        totalCount: sorted.length,
        nextStop,
        overdueIds,
      });
    });

    return groups.sort((a, b) => a.routeName.localeCompare(b.routeName));
  }, [visits, routes, team]);

  const validVisits = useMemo(() => {
    if (!visits) return [];
    return visits.filter(
      (v) =>
        v.property?.latitude != null &&
        v.property?.longitude != null &&
        !isNaN(v.property.latitude) &&
        !isNaN(v.property.longitude)
    );
  }, [visits]);

  const nextStopIds = useMemo(
    () => new Set(routeGroups.map((g) => g.nextStop?.id).filter(Boolean) as string[]),
    [routeGroups]
  );
  const overdueIdSet = useMemo(() => {
    const s = new Set<string>();
    routeGroups.forEach((g) => g.overdueIds.forEach((id) => s.add(id)));
    return s;
  }, [routeGroups]);
  const techByRouteId = useMemo(() => {
    const m = new Map<string | null, string | null>();
    routeGroups.forEach((g) => m.set(g.routeId, g.techName));
    return m;
  }, [routeGroups]);

  useEffect(() => {
    if (!tokenData?.token || !mapContainerRef.current) return;

    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !mapContainerRef.current) return;
      const container = mapContainerRef.current;

      mapboxgl.accessToken = tokenData.token;

      if (!mapRef.current) {
        const center: [number, number] =
          validVisits.length > 0
            ? [validVisits[0].property!.longitude!, validVisits[0].property!.latitude!]
            : [-98.5795, 39.8283];

        const map = new mapboxgl.Map({
          container,
          style: "mapbox://styles/mapbox/streets-v12",
          center,
          zoom: validVisits.length > 0 ? 11 : 4,
        });

        mapRef.current = map;

        map.on("load", () => {
          if (cancelled) return;
          setMapLoaded(true);
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tokenData?.token]);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;

      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      for (const visit of validVisits) {
        const lat = visit.property!.latitude!;
        const lng = visit.property!.longitude!;
        const isNext = nextStopIds.has(visit.id);
        const isOverdue = overdueIdSet.has(visit.id);
        const pinColor = getPinColor(visit, isNext, isOverdue);
        const techName = techByRouteId.get(visit.routeId ?? null);

        const el = document.createElement("div");
        el.style.width = "30px";
        el.style.height = "30px";
        el.style.borderRadius = "50%";
        el.style.backgroundColor = pinColor;
        el.style.color = "white";
        el.style.display = "flex";
        el.style.alignItems = "center";
        el.style.justifyContent = "center";
        el.style.fontSize = "11px";
        el.style.fontWeight = "bold";
        el.style.border = "2.5px solid white";
        el.style.boxShadow = "0 2px 6px rgba(0,0,0,0.35)";
        el.style.cursor = "pointer";
        el.setAttribute("data-testid", `map-pin-${visit.id}`);
        el.textContent = String(visit.stopOrder > 0 ? visit.stopOrder : "");

        const contactName = visit.contact
          ? `${visit.contact.firstName} ${visit.contact.lastName}`
          : "Unknown";
        const address = visit.property?.streetAddress ?? "";
        const city = visit.property?.city ? `, ${visit.property.city}` : "";
        const routeLabel = visit.routeName ? `Route: ${visit.routeName}` : "Unassigned";
        const techLabel = techName ? `Tech: ${techName}` : "";
        const statusLabel = visit.status.replace(/_/g, " ");
        const statusColor = pinColor;

        const popupEl = document.createElement("div");
        popupEl.dataset.testid = `popup-visit-${visit.id}`;
        Object.assign(popupEl.style, { padding: "6px 4px", fontFamily: "sans-serif" });
        const titleEl = document.createElement("div");
        Object.assign(titleEl.style, { fontWeight: "600", fontSize: "13px", marginBottom: "2px" });
        titleEl.textContent = `Stop #${visit.stopOrder} — ${contactName}`;
        const addrEl = document.createElement("div");
        Object.assign(addrEl.style, { fontSize: "12px", color: "#555", marginBottom: "4px" });
        addrEl.textContent = `${address}${city}`;
        popupEl.append(titleEl, addrEl);
        if (techLabel) {
          const techEl = document.createElement("div");
          Object.assign(techEl.style, { fontSize: "11px", color: "#444", marginBottom: "2px" });
          techEl.textContent = techLabel;
          popupEl.append(techEl);
        }
        const routeEl = document.createElement("div");
        Object.assign(routeEl.style, { fontSize: "11px", color: "#888", marginBottom: "3px" });
        routeEl.textContent = routeLabel;
        const statusEl = document.createElement("span");
        Object.assign(statusEl.style, {
          background: statusColor,
          color: "white",
          padding: "1px 6px",
          borderRadius: "10px",
          fontSize: "10px",
        });
        statusEl.textContent = statusLabel;
        popupEl.append(routeEl, statusEl);
        const popup = new mapboxgl.Popup({ offset: 20, maxWidth: "240px" }).setDOMContent(popupEl);

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(mapRef.current);

        markersRef.current.push(marker);
      }

      if (validVisits.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        validVisits.forEach((v) => {
          bounds.extend([v.property!.longitude!, v.property!.latitude!]);
        });
        mapRef.current.fitBounds(bounds, { padding: 60 });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mapLoaded, validVisits, nextStopIds, overdueIdSet, techByRouteId]);

  useEffect(() => {
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  const totalStops = visits?.length ?? 0;
  const completedStops =
    visits?.filter((v) => v.status === "completed" || v.status === "skipped").length ?? 0;
  const inProgressStops = visits?.filter((v) => v.status === "in_progress").length ?? 0;
  const overdueCount = overdueIdSet.size;

  return (
    <div className="flex h-full overflow-hidden" data-testid="field-view-page">
      {sidebarOpen && (
        <div
          className="w-72 shrink-0 border-r flex flex-col bg-background"
          data-testid="field-view-sidebar"
        >
          <div className="p-3 border-b flex items-center justify-between gap-2">
            <div>
              <h1 className="font-semibold text-base" data-testid="field-view-title">
                Live Field Map
              </h1>
              <p className="text-xs text-muted-foreground">All routes for today</p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => refetch()}
                disabled={isFetching}
                title="Refresh"
                data-testid="button-refresh-field-view"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setSidebarOpen(false)}
                data-testid="button-collapse-sidebar"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="p-3 border-b">
            <div className="flex items-center gap-2 mb-2">
              <label className="text-xs text-muted-foreground">Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="flex-1 text-xs border rounded px-2 py-1 bg-background"
                data-testid="input-field-view-date"
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5 text-center">
              <div className="rounded-md bg-muted/50 p-1.5" data-testid="stat-total-stops">
                <p className="text-base font-bold">{totalStops}</p>
                <p className="text-[10px] text-muted-foreground">Total</p>
              </div>
              <div
                className="rounded-md bg-green-50 dark:bg-green-950/30 p-1.5"
                data-testid="stat-completed-stops"
              >
                <p className="text-base font-bold text-green-700 dark:text-green-400">
                  {completedStops}
                </p>
                <p className="text-[10px] text-muted-foreground">Done</p>
              </div>
              <div
                className="rounded-md bg-blue-50 dark:bg-blue-950/30 p-1.5"
                data-testid="stat-inprogress-stops"
              >
                <p className="text-base font-bold text-blue-700 dark:text-blue-400">
                  {inProgressStops}
                </p>
                <p className="text-[10px] text-muted-foreground">Active</p>
              </div>
              <div
                className="rounded-md bg-red-50 dark:bg-red-950/30 p-1.5"
                data-testid="stat-overdue-stops"
              >
                <p className="text-base font-bold text-red-700 dark:text-red-400">{overdueCount}</p>
                <p className="text-[10px] text-muted-foreground">Overdue</p>
              </div>
            </div>
          </div>

          <div className="p-3 pb-1 border-b">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
              Legend
            </p>
            <div className="space-y-1" data-testid="map-legend">
              <div className="flex items-center gap-2 text-xs">
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0"
                  style={{ background: "#22c55e" }}
                />
                <span>Next stop</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0"
                  style={{ background: "#3b82f6" }}
                />
                <span>In progress</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0"
                  style={{ background: "#f59e0b" }}
                />
                <span>Upcoming</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0"
                  style={{ background: "#ef4444" }}
                />
                <span>Overdue</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0"
                  style={{ background: "#9ca3af" }}
                />
                <span>Completed / skipped</span>
              </div>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-2">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-md" />
                ))
              ) : routeGroups.length === 0 ? (
                <div
                  className="text-center py-8 text-muted-foreground text-sm"
                  data-testid="no-routes-message"
                >
                  <MapPin className="h-6 w-6 mx-auto mb-2 opacity-40" />
                  No visits scheduled for this date.
                </div>
              ) : (
                routeGroups.map((group) => (
                  <Card
                    key={group.routeId ?? "unassigned"}
                    className="p-0"
                    data-testid={`route-card-${group.routeId ?? "unassigned"}`}
                  >
                    <CardContent className="p-2.5 space-y-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ background: group.routeColor }}
                          data-testid={`route-color-dot-${group.routeId}`}
                        />
                        <div className="flex-1 min-w-0">
                          <p
                            className="font-semibold text-sm truncate"
                            data-testid={`route-name-${group.routeId}`}
                          >
                            {group.routeName}
                          </p>
                          {group.techName && (
                            <p
                              className="text-xs text-muted-foreground flex items-center gap-1 truncate"
                              data-testid={`route-tech-${group.routeId}`}
                            >
                              <User className="h-2.5 w-2.5" />
                              {group.techName}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-0.5 shrink-0">
                          <Badge
                            variant="outline"
                            className="text-[10px]"
                            data-testid={`route-progress-${group.routeId}`}
                          >
                            {group.completedCount}/{group.totalCount}
                          </Badge>
                          {group.overdueIds.size > 0 && (
                            <Badge
                              variant="destructive"
                              className="text-[10px]"
                              data-testid={`route-overdue-${group.routeId}`}
                            >
                              {group.overdueIds.size} overdue
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div
                        className="w-full bg-muted rounded-full h-1.5 overflow-hidden"
                        data-testid={`progress-bar-${group.routeId}`}
                      >
                        <div
                          className="h-full bg-green-500 transition-all"
                          style={{
                            width:
                              group.totalCount > 0
                                ? `${(group.completedCount / group.totalCount) * 100}%`
                                : "0%",
                          }}
                        />
                      </div>

                      {group.nextStop && (
                        <div
                          className="text-xs space-y-0.5"
                          data-testid={`next-stop-${group.routeId}`}
                        >
                          <p className="text-muted-foreground font-medium flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Next stop
                          </p>
                          <p className="font-medium truncate">
                            {group.nextStop.contact
                              ? `${group.nextStop.contact.firstName} ${group.nextStop.contact.lastName}`
                              : "Unknown"}
                          </p>
                          <p className="text-muted-foreground truncate">
                            {group.nextStop.property?.streetAddress ?? ""}
                          </p>
                        </div>
                      )}

                      {!group.nextStop && group.totalCount > 0 && (
                        <div
                          className="text-xs flex items-center gap-1 text-green-600 dark:text-green-400"
                          data-testid={`all-done-${group.routeId}`}
                        >
                          <CheckCircle className="h-3 w-3" />
                          All stops complete
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      <div className="flex-1 relative min-w-0">
        {!sidebarOpen && (
          <Button
            variant="secondary"
            size="icon"
            className="absolute top-3 left-3 z-30 h-8 w-8 shadow"
            onClick={() => setSidebarOpen(true)}
            data-testid="button-expand-sidebar"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}

        {(tokenLoading || isLoading) && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-background z-10"
            data-testid="map-loading-overlay"
          >
            <div className="text-center">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading field map…</p>
            </div>
          </div>
        )}

        {!tokenLoading && !tokenData?.token && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-background z-10"
            data-testid="map-no-token"
          >
            <div className="text-center text-muted-foreground max-w-xs px-6">
              <AlertCircle className="h-8 w-8 mx-auto mb-3" />
              <p className="text-sm">
                Map unavailable. Configure{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">MAPBOX_PUBLIC_TOKEN</code> to
                enable the live field map.
              </p>
            </div>
          </div>
        )}

        {!tokenLoading && tokenData?.token && validVisits.length === 0 && !isLoading && (
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none"
            data-testid="map-no-coords-notice"
          >
            <div className="bg-background/90 border rounded-lg px-4 py-3 shadow text-center max-w-xs">
              <Info className="h-5 w-5 mx-auto mb-1.5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {visits && visits.length > 0
                  ? "Visits found but no map coordinates available. Geocode properties to see pins."
                  : "No visits scheduled for this date."}
              </p>
            </div>
          </div>
        )}

        <div
          ref={mapContainerRef}
          className="w-full h-full"
          data-testid="field-map-canvas"
          style={{ display: tokenData?.token ? "block" : "none" }}
        />
      </div>
    </div>
  );
}
