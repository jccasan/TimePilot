/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useMemo, useEffect, useCallback, lazy, Suspense } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Play,
  CheckCircle,
  Camera,
  ChevronDown,
  ChevronUp,
  ImageIcon,
  Loader2,
  Satellite,
  X,
  Send,
  DoorClosed,
  Navigation,
  ShieldAlert,
  Dog,
  Map as MapIcon,
  MapPin,
  Clock,
  ArrowRight,
  Flag,
  BarChart2,
  Home,
  ChevronRight,
} from "lucide-react";
import { StreetViewImage } from "@/components/street-view-image";
const RouteMapView = lazy(() => import("@/components/route-map-view"));
import { SatelliteImage } from "@/components/satellite-image";
import { getYardCategory, formatArea } from "@/components/yard-measure-tool";
import { useOffline } from "@/hooks/use-offline";
import { OfflineStatusBar } from "@/components/offline-status-bar";
import { PendingPhotosIndicator } from "@/components/pending-photos-indicator";
import {
  cacheRouteData,
  getCachedRouteData,
  addPendingMutation,
  addPendingPhoto,
  saveDepot,
  getCachedDepot,
  type CachedDepot,
} from "@/lib/offline-store";
import { isNetworkError } from "@/lib/offline-sync";
import { compressImage } from "@/lib/compress-image";
import { AddressAutocomplete } from "@/components/address-autocomplete";

type TodayVisit = {
  id: string;
  scheduledDate: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  technicianNotes: string | null;
  proofOfServicePhoto: string | null;
  proofOfServicePhotoBefore: string | null;
  gateClosedPhoto: string | null;
  servicePlanId: string;
  propertyId: string;
  routeId: string | null;
  stopOrder: number;
  routeName: string | null;
  routeColor: string | null;
  servicePlanName?: string | null;
  addOns?: { name: string; price: string }[];
  property?: {
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
    latitude: number | null;
    longitude: number | null;
  };
  contact?: {
    firstName: string;
    lastName: string;
  };
};

type PropertyGroup = {
  propertyKey: string;
  visits: TodayVisit[];
  address: string;
  contact: TodayVisit["contact"];
  property: TodayVisit["property"];
};

function haversineDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const chord = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord));
}

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

type PhotoUploadType = "before" | "after";

function PropertyImageSection({ visit }: { visit: TodayVisit }) {
  const [showSatellite, setShowSatellite] = useState(false);
  const prop = visit.property!;
  const addr = `${prop.streetAddress}, ${prop.city}, ${prop.state}`;
  const yardCat = prop.measuredYardSqft ? getYardCategory(prop.measuredYardSqft) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="h-10 min-h-[44px] text-xs gap-1 px-2"
          onClick={() => setShowSatellite(!showSatellite)}
          data-testid={`button-toggle-view-${visit.id}`}
        >
          <Satellite className="h-3.5 w-3.5" />
          {showSatellite ? "Street View" : "Aerial View"}
        </Button>
        {yardCat && prop.measuredYardSqft && (
          <Badge className={`text-xs ${yardCat.color}`} data-testid={`badge-tech-yard-${visit.id}`}>
            {yardCat.label} - {formatArea(prop.measuredYardSqft)}
          </Badge>
        )}
      </div>
      {showSatellite ? (
        <SatelliteImage address={addr} className="h-[150px]" size="600x300" zoom={19} />
      ) : (
        <StreetViewImage address={addr} className="h-[150px]" size="600x300" />
      )}
    </div>
  );
}

async function uploadFileDirect(file: File): Promise<string> {
  const token = localStorage.getItem("sessionToken");
  const hdrs: Record<string, string> = {};
  if (token) hdrs["Authorization"] = `Bearer ${token}`;

  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/uploads/direct", {
    method: "POST",
    credentials: "include",
    headers: hdrs,
    body: formData,
  });

  if (!response.ok) throw new Error("Failed to upload photo");
  const data = await response.json();
  return data.objectPath;
}

type RouteGroup = {
  routeId: string;
  routeName: string;
  routeColor: string | null;
  groups: PropertyGroup[];
  completedCount: number;
  totalCount: number;
};

export default function TechMobile() {
  const { toast } = useToast();
  const offline = useOffline();
  const [viewMode, setViewMode] = useState<"start-day" | "route">("start-day");
  const [showMapOverlay, setShowMapOverlay] = useState(false);
  const [techPosition, setTechPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [driveInfo, setDriveInfo] = useState<
    Map<string, { durationText: string; distanceText: string } | null>
  >(new Map());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [uploadingVisitId, setUploadingVisitId] = useState<string | null>(null);
  const [uploadingType, setUploadingType] = useState<PhotoUploadType | null>(null);
  const beforeFileInputRef = useRef<HTMLInputElement>(null);
  const beforeCaptureInputRef = useRef<HTMLInputElement>(null);
  const afterFileInputRef = useRef<HTMLInputElement>(null);
  const afterCaptureInputRef = useRef<HTMLInputElement>(null);
  const pendingVisitIdRef = useRef<string | null>(null);
  const pendingUploadTypeRef = useRef<PhotoUploadType | null>(null);
  const techPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastDriveFetchPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const allVisitsFlatRef = useRef<TodayVisit[]>([]);
  const [pendingAdvanceAfter, setPendingAdvanceAfter] = useState<string | null>(null);
  const [cachedVisits, setCachedVisits] = useState<TodayVisit[] | null>(null);

  const [completeDialogVisit, setCompleteDialogVisit] = useState<TodayVisit | null>(null);
  const [completeDialogGroupVisits, setCompleteDialogGroupVisits] = useState<TodayVisit[]>([]);
  const [gatePhoto, setGatePhoto] = useState<File | null>(null);
  const [gatePhotoPreview, setGatePhotoPreview] = useState<string | null>(null);
  const [extraFiles, setExtraFiles] = useState<{ file: File; preview: string }[]>([]);
  const [noGate, setNoGate] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const gateFileInputRef = useRef<HTMLInputElement>(null);
  const gateCaptureInputRef = useRef<HTMLInputElement>(null);
  const extraFileInputRef = useRef<HTMLInputElement>(null);
  const extraCaptureInputRef = useRef<HTMLInputElement>(null);

  const [onMyWaySending, setOnMyWaySending] = useState<string | null>(null);
  const [onMyWayCooldowns, setOnMyWayCooldowns] = useState<Record<string, number>>({});
  const [showDepotPicker, setShowDepotPicker] = useState(false);
  const [showHomeAddressDialog, setShowHomeAddressDialog] = useState(false);
  const [homeAddressInput, setHomeAddressInput] = useState("");
  const [homeAddressCoords, setHomeAddressCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );

  const handleOnMyWay = (visitId: string) => {
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
  };

  const { data: company } = useQuery<{ name: string }>({ queryKey: ["/api/company"] });

  const { data: currentUser, isSuccess: userLoaded } = useQuery<{
    id: string;
    defaultDepotId?: string | null;
    homeAddress?: string | null;
    homeLatitude?: number | null;
    homeLongitude?: number | null;
  }>({
    queryKey: ["/api/auth/user"],
  });

  type Depot = { id: string; name: string; address: string; isPrimary: boolean };
  const { data: depots = [], isSuccess: depotsLoaded } = useQuery<Depot[]>({
    queryKey: ["/api/depots"],
  });

  const activeDepot = depots.find((d) => d.id === currentUser?.defaultDepotId) ?? null;

  const [cachedDepot, setCachedDepot] = useState<CachedDepot | null>(null);

  useEffect(() => {
    getCachedDepot().then((cached) => {
      if (cached) setCachedDepot(cached);
    });
  }, []);

  useEffect(() => {
    if (userLoaded && depotsLoaded && activeDepot !== null) {
      saveDepot(activeDepot);
      setCachedDepot(activeDepot);
    }
  }, [userLoaded, depotsLoaded, activeDepot?.id]);

  const effectiveDepot = activeDepot ?? cachedDepot;

  const updateDepotMutation = useMutation({
    mutationFn: (depotId: string | null) =>
      apiRequest("PATCH", `/api/team/${currentUser?.id}/default-depot`, { depotId }).then((r) =>
        r.json()
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setShowDepotPicker(false);
      toast({ title: "Starting point updated" });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to update starting point",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const updateHomeAddressMutation = useMutation({
    mutationFn: (payload: {
      homeAddress: string | null;
      homeLatitude?: number;
      homeLongitude?: number;
    }) =>
      apiRequest("PATCH", `/api/team/${currentUser?.id}/home-address`, payload).then((r) =>
        r.json()
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setShowHomeAddressDialog(false);
      toast({
        title: "Home address saved",
        description: "Your home will be used as a route optimization candidate.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not save home address",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const {
    data: fetchedVisits,
    isLoading: fetchLoading,
    isError: fetchError,
  } = useQuery<TodayVisit[]>({
    queryKey: ["/api/visits/today"],
  });

  useEffect(() => {
    if (fetchedVisits) {
      cacheRouteData("visits-today", fetchedVisits);
      setCachedVisits(null);
    }
  }, [fetchedVisits]);

  useEffect(() => {
    if (fetchError && !fetchedVisits) {
      getCachedRouteData<TodayVisit[]>("visits-today").then((cached) => {
        if (cached) {
          setCachedVisits(cached);
          toast({
            title: "Using cached data",
            description: "Showing your last loaded route data while offline.",
          });
        }
      });
    }
  }, [fetchError, fetchedVisits, toast]);

  const visits = fetchedVisits ?? cachedVisits;
  const isLoading = fetchLoading && !cachedVisits;

  const routeGroupsWithProps = useMemo<RouteGroup[]>(() => {
    if (!visits) return [];
    const routeMap = new Map<string, RouteGroup>();
    for (const visit of visits) {
      const routeKey = visit.routeId || "unassigned";
      if (!routeMap.has(routeKey)) {
        routeMap.set(routeKey, {
          routeId: routeKey,
          routeName: visit.routeName || "Unassigned",
          routeColor: visit.routeColor,
          groups: [],
          completedCount: 0,
          totalCount: 0,
        });
      }
      const rg = routeMap.get(routeKey)!;
      rg.totalCount++;
      if (
        visit.status === "completed" ||
        visit.status === "skipped" ||
        visit.status === "cancelled"
      ) {
        rg.completedCount++;
      }

      const key = visit.propertyId || visit.id;
      let propGroup = rg.groups.find((g) => g.propertyKey === key);
      if (!propGroup) {
        propGroup = {
          propertyKey: key,
          visits: [],
          address: visit.property?.streetAddress || "Unknown address",
          contact: visit.contact,
          property: visit.property,
        };
        rg.groups.push(propGroup);
      }
      propGroup.visits.push(visit);
    }
    return Array.from(routeMap.values());
  }, [visits]);

  const allVisitsFlat = useMemo(() => visits || [], [visits]);

  useEffect(() => {
    techPositionRef.current = techPosition;
  }, [techPosition]);
  useEffect(() => {
    allVisitsFlatRef.current = allVisitsFlat;
  }, [allVisitsFlat]);

  const nextUncompletedVisit = useMemo(
    () =>
      allVisitsFlat.find(
        (v) =>
          v.status !== "completed" &&
          v.status !== "cancelled" &&
          v.status !== "skipped" &&
          v.property?.streetAddress
      ) ?? null,
    [allVisitsFlat]
  );

  const totalVisitCount = allVisitsFlat.length;
  const completedVisitCount = allVisitsFlat.filter(
    (v) => v.status === "completed" || v.status === "skipped" || v.status === "cancelled"
  ).length;
  const remainingCount = totalVisitCount - completedVisitCount;
  const estMinutesRemaining = remainingCount * 20;

  const techMapStops = useMemo(() => {
    if (!allVisitsFlat || allVisitsFlat.length === 0) return [];
    return allVisitsFlat
      .filter((v) => v.property?.latitude != null && v.property?.longitude != null)
      .map((v, idx) => ({
        stopNumber: idx + 1,
        contactName: v.contact
          ? `${v.contact.firstName ?? ""} ${v.contact.lastName ?? ""}`.trim()
          : "Unknown",
        streetAddress: v.property?.streetAddress || "Unknown",
        latitude: v.property!.latitude!,
        longitude: v.property!.longitude!,
      }));
  }, [allVisitsFlat]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        console.log("[GPS] Permission granted on mount:", pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        console.error("[GPS] Permission prompt error on mount — code:", err.code, "message:", err.message);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }, []);

  useEffect(() => {
    if (!showMapOverlay && viewMode !== "route") return;
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setTechPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        console.error("[GPS] watchPosition error — code:", err.code, "message:", err.message);
      },
      { timeout: 8000, maximumAge: 30000, enableHighAccuracy: true }
    );
    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [showMapOverlay, viewMode]);

  const fetchDriveTimes = useCallback((position: { lat: number; lng: number }) => {
    const upcomingVisits = allVisitsFlatRef.current.filter(
      (v) =>
        v.status !== "completed" &&
        v.status !== "skipped" &&
        v.status !== "cancelled" &&
        v.property?.latitude != null &&
        v.property?.longitude != null
    );
    if (upcomingVisits.length === 0) return;
    const destinations = upcomingVisits.map((v) => ({
      lat: v.property!.latitude!,
      lng: v.property!.longitude!,
    }));
    apiRequest("POST", "/api/tech/distances", {
      originLat: position.lat,
      originLng: position.lng,
      destinations,
    })
      .then((res) => res.json())
      .then(
        (data: {
          results?: (null | { durationText: string; distanceText: string })[];
          fallback?: boolean;
        }) => {
          if (!data.results) return;
          const map = new Map<string, { durationText: string; distanceText: string } | null>();
          upcomingVisits.forEach((v, i) => {
            map.set(v.id, data.results![i] ?? null);
          });
          setDriveInfo(map);
          lastDriveFetchPositionRef.current = position;
        }
      )
      .catch(() => {
        // silently fall back to haversine
      });
  }, []);

  useEffect(() => {
    const active = showMapOverlay || expandedId !== null;
    if (!active) {
      lastDriveFetchPositionRef.current = null;
      return;
    }
    const pos = techPositionRef.current;
    if (pos) {
      fetchDriveTimes(pos);
    }
    const intervalId = setInterval(
      () => {
        const currentPos = techPositionRef.current;
        if (!currentPos) return;
        const lastPos = lastDriveFetchPositionRef.current;
        if (lastPos && haversineMeters(lastPos, currentPos) < 500) return;
        fetchDriveTimes(currentPos);
      },
      2 * 60 * 1000
    );
    return () => {
      clearInterval(intervalId);
      lastDriveFetchPositionRef.current = null;
    };
  }, [showMapOverlay, expandedId, fetchDriveTimes]);

  useEffect(() => {
    const active = showMapOverlay || expandedId !== null;
    if (!active || !techPosition || lastDriveFetchPositionRef.current) return;
    fetchDriveTimes(techPosition);
  }, [showMapOverlay, expandedId, techPosition, fetchDriveTimes]);

  useEffect(() => {
    if (visits && visits.some((v) => v.status === "in_progress")) {
      setViewMode("route");
    }
  }, [visits]);

  const handleStartRoute = () => {
    setViewMode("route");
    const firstStop = allVisitsFlat.find(
      (v) => v.status === "scheduled" || v.status === "in_progress"
    );
    if (firstStop) {
      const key = firstStop.propertyId || firstStop.id;
      setExpandedId(key);
    }
  };

  const getNavigateUrl = (streetAddress: string, city: string, state: string) => {
    const address = `${streetAddress}, ${city}, ${state}`;
    const encoded = encodeURIComponent(address);
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) {
      const originParam = effectiveDepot
        ? `&saddr=${encodeURIComponent(effectiveDepot.address)}`
        : "";
      return `maps://maps.apple.com/?daddr=${encoded}${originParam}`;
    }
    if (/Android/.test(ua)) {
      const originParam = effectiveDepot
        ? `&origin=${encodeURIComponent(effectiveDepot.address)}`
        : "";
      if (originParam) {
        return `https://www.google.com/maps/dir/?api=1&destination=${encoded}${originParam}`;
      }
      return `geo:0,0?q=${encoded}`;
    }
    const originParam = effectiveDepot
      ? `&origin=${encodeURIComponent(effectiveDepot.address)}`
      : "";
    return `https://www.google.com/maps/dir/?api=1&destination=${encoded}${originParam}`;
  };

  const googleMapsDirectionsUrl = useMemo(() => {
    if (!visits || visits.length === 0) return null;
    const addrs = visits
      .filter((v) => v.property?.streetAddress)
      .map((v) => `${v.property!.streetAddress}, ${v.property!.city}, ${v.property!.state}`);
    if (addrs.length === 0) return null;
    const originParam = effectiveDepot
      ? `&origin=${encodeURIComponent(effectiveDepot.address)}`
      : "";
    if (addrs.length === 1) {
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addrs[0])}${originParam}`;
    }
    const dest = encodeURIComponent(addrs[addrs.length - 1]);
    const waypoints = addrs
      .slice(0, -1)
      .map((a) => encodeURIComponent(a))
      .join("|");
    return `https://www.google.com/maps/dir/?api=1&destination=${dest}&waypoints=${waypoints}&travelmode=driving${originParam}`;
  }, [visits, effectiveDepot]);

  useEffect(() => {
    if (pendingAdvanceAfter && visits) {
      const completedIdx = allVisitsFlat.findIndex((v) => v.id === pendingAdvanceAfter);
      if (completedIdx >= 0) {
        const nextIncomplete = allVisitsFlat
          .slice(completedIdx + 1)
          .find((v) => v.status === "scheduled" || v.status === "in_progress");
        if (nextIncomplete) {
          setExpandedId(nextIncomplete.id);
        }
      }
      setPendingAdvanceAfter(null);
    }
  }, [visits, pendingAdvanceAfter, allVisitsFlat]);

  const startMutation = useMutation({
    mutationFn: async (visitId: string): Promise<{ queuedOffline: boolean }> => {
      const body = {
        startedAt: new Date().toISOString(),
        status: "in_progress",
      };
      try {
        await apiRequest("PATCH", `/api/visits/${visitId}`, body);
      } catch (err) {
        if (isNetworkError(err)) {
          await addPendingMutation({ method: "PATCH", url: `/api/visits/${visitId}`, body });
          offline.refreshPendingCount();
          queryClient.setQueryData<TodayVisit[]>(["/api/visits/today"], (old) => {
            const updated = (old || []).map((v) =>
              v.id === visitId
                ? { ...v, status: "in_progress" as const, startedAt: body.startedAt }
                : v
            );
            cacheRouteData("visits-today", updated);
            setCachedVisits(updated);
            return updated;
          });
          toast({
            title: "Visit started (offline)",
            description: "Will sync when connection returns.",
          });
          return { queuedOffline: true };
        }
        throw err;
      }
      return { queuedOffline: false };
    },
    onSuccess: (result) => {
      if (result?.queuedOffline) return;
      queryClient.invalidateQueries({ queryKey: ["/api/visits/today"] });
      toast({ title: "Visit started" });
    },
  });

  const handlePhotoClick = (visitId: string, type: PhotoUploadType, capture = false) => {
    pendingVisitIdRef.current = visitId;
    pendingUploadTypeRef.current = type;
    if (type === "before") {
      (capture ? beforeCaptureInputRef : beforeFileInputRef).current?.click();
    } else {
      (capture ? afterCaptureInputRef : afterFileInputRef).current?.click();
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const visitId = pendingVisitIdRef.current;
    const photoType = pendingUploadTypeRef.current;
    if (!file || !visitId || !photoType) return;

    e.target.value = "";
    setUploadingVisitId(visitId);
    setUploadingType(photoType);

    const compressed = await compressImage(file);

    try {
      const objectPath = await uploadFileDirect(compressed);
      const patchField =
        photoType === "before" ? "proofOfServicePhotoBefore" : "proofOfServicePhoto";
      await apiRequest("PATCH", `/api/visits/${visitId}`, { [patchField]: objectPath });

      queryClient.invalidateQueries({ queryKey: ["/api/visits/today"] });
      const label = photoType === "before" ? "Before" : "After";
      toast({ title: `${label} photo uploaded`, description: "Photo saved successfully." });
    } catch (err: any) {
      if (isNetworkError(err)) {
        await addPendingPhoto({ visitId, photoType, blob: compressed });
        offline.refreshPendingCount();
        const label = photoType === "before" ? "Before" : "After";
        toast({
          title: `${label} photo saved offline`,
          description: "Will upload when connection returns.",
        });
      } else {
        toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      }
    } finally {
      setUploadingVisitId(null);
      setUploadingType(null);
      pendingVisitIdRef.current = null;
      pendingUploadTypeRef.current = null;
    }
  };

  const openCompleteDialog = (visit: TodayVisit) => {
    const propertyKey = visit.propertyId || visit.id;
    const allGroupVisits = (visits || []).filter(
      (v) =>
        (v.propertyId || v.id) === propertyKey &&
        (v.status === "in_progress" || v.status === "scheduled")
    );
    setCompleteDialogVisit(visit);
    setCompleteDialogGroupVisits(allGroupVisits.length > 1 ? allGroupVisits : []);
    setGatePhoto(null);
    setGatePhotoPreview(null);
    setExtraFiles([]);
    setNoGate(false);
    setIsCompleting(false);
  };

  const handleGatePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const compressed = await compressImage(file);
    setGatePhoto(compressed);
    const reader = new FileReader();
    reader.onload = () => setGatePhotoPreview(reader.result as string);
    reader.readAsDataURL(compressed);
  };

  const handleExtraPhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const compressed = await compressImage(file);
    const reader = new FileReader();
    reader.onload = () => {
      setExtraFiles((prev) => [...prev, { file: compressed, preview: reader.result as string }]);
    };
    reader.readAsDataURL(compressed);
  };

  const removeExtraPhoto = (index: number) => {
    setExtraFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const queueGroupVisitsOffline = async (gatePath: string) => {
    if (!completeDialogVisit) return;
    const groupVisits = completeDialogGroupVisits.filter(
      (v) =>
        v.id !== completeDialogVisit.id && (v.status === "in_progress" || v.status === "scheduled")
    );
    for (const gv of groupVisits) {
      if (gv.status === "scheduled") {
        await addPendingMutation({
          method: "PATCH",
          url: `/api/visits/${gv.id}`,
          body: { startedAt: new Date().toISOString(), status: "in_progress" },
        });
      }
      await addPendingMutation({
        method: "POST",
        url: `/api/visits/${gv.id}/complete-notify`,
        body: {
          gateClosedPhoto: gatePath,
          technicianNotes: notes[completeDialogVisit.id] || undefined,
        },
      });
    }
  };

  const finishCompletionOffline = () => {
    if (!completeDialogVisit) return;
    const groupVisits = completeDialogGroupVisits.filter(
      (v) =>
        v.id !== completeDialogVisit.id && (v.status === "in_progress" || v.status === "scheduled")
    );
    const allVisitIds = [completeDialogVisit.id, ...groupVisits.map((v) => v.id)];
    offline.refreshPendingCount();
    if (visits) {
      const completedIds = new Set(allVisitIds);
      const updated = visits.map((v) =>
        completedIds.has(v.id)
          ? { ...v, status: "completed", completedAt: new Date().toISOString() }
          : v
      );
      cacheRouteData("visits-today", updated);
      setCachedVisits(updated);
      queryClient.setQueryData<TodayVisit[]>(["/api/visits/today"], updated);
    }
    setPendingAdvanceAfter(completeDialogVisit.id);
    setCompleteDialogVisit(null);
    setCompleteDialogGroupVisits([]);
    toast({
      title: "Visit completed (offline)",
      description: "Photos and notification will sync when connection returns.",
    });
    setIsCompleting(false);
  };

  const handleCompleteAndSend = async () => {
    if (!completeDialogVisit || (!gatePhoto && !noGate)) return;
    setIsCompleting(true);

    try {
      let gateClosedPath: string | undefined;

      if (noGate) {
        gateClosedPath = undefined;
      } else {
        try {
          gateClosedPath = await uploadFileDirect(gatePhoto!);
        } catch (uploadErr) {
          if (isNetworkError(uploadErr)) {
            const gatePhotoId = await addPendingPhoto({
              visitId: completeDialogVisit.id,
              photoType: "gate",
              blob: gatePhoto!,
            });
            const gateRef = `__pending_photo_${gatePhotoId}__`;
            const extraPhotoRefs: string[] = [];
            for (const extra of extraFiles) {
              const extraId = await addPendingPhoto({
                visitId: completeDialogVisit.id,
                photoType: "extra",
                blob: extra.file,
              });
              extraPhotoRefs.push(`__pending_photo_${extraId}__`);
            }
            await addPendingMutation({
              method: "POST",
              url: `/api/visits/${completeDialogVisit.id}/complete-notify`,
              body: {
                gateClosedPhoto: gateRef,
                extraPhotos: extraPhotoRefs.length > 0 ? extraPhotoRefs : undefined,
                technicianNotes: notes[completeDialogVisit.id] || undefined,
                noGate: false,
              },
            });
            await queueGroupVisitsOffline(gateRef);
            finishCompletionOffline();
            return;
          }
          throw uploadErr;
        }
      }

      const extraPaths: string[] = [];
      if (!noGate) {
        try {
          for (const extra of extraFiles) {
            const path = await uploadFileDirect(extra.file);
            extraPaths.push(path);
          }
        } catch (extraUploadErr) {
          if (isNetworkError(extraUploadErr)) {
            const extraPhotoRefs: string[] = [];
            for (let i = extraPaths.length; i < extraFiles.length; i++) {
              const extraId = await addPendingPhoto({
                visitId: completeDialogVisit.id,
                photoType: "extra",
                blob: extraFiles[i].file,
              });
              extraPhotoRefs.push(`__pending_photo_${extraId}__`);
            }
            const allExtraRefs = [...extraPaths, ...extraPhotoRefs];
            await addPendingMutation({
              method: "POST",
              url: `/api/visits/${completeDialogVisit.id}/complete-notify`,
              body: {
                gateClosedPhoto: gateClosedPath,
                extraPhotos: allExtraRefs.length > 0 ? allExtraRefs : undefined,
                technicianNotes: notes[completeDialogVisit.id] || undefined,
                noGate: false,
              },
            });
            await queueGroupVisitsOffline(gateClosedPath!);
            finishCompletionOffline();
            return;
          }
          throw extraUploadErr;
        }
      }

      try {
        await apiRequest("POST", `/api/visits/${completeDialogVisit.id}/complete-notify`, {
          gateClosedPhoto: gateClosedPath,
          extraPhotos: extraPaths.length > 0 ? extraPaths : undefined,
          technicianNotes: notes[completeDialogVisit.id] || undefined,
          noGate,
        });
      } catch (notifyErr) {
        if (isNetworkError(notifyErr)) {
          await addPendingMutation({
            method: "POST",
            url: `/api/visits/${completeDialogVisit.id}/complete-notify`,
            body: {
              gateClosedPhoto: gateClosedPath,
              extraPhotos: extraPaths.length > 0 ? extraPaths : undefined,
              technicianNotes: notes[completeDialogVisit.id] || undefined,
              noGate,
            },
          });
          if (!noGate) await queueGroupVisitsOffline(gateClosedPath!);
          finishCompletionOffline();
          return;
        }
        throw notifyErr;
      }

      let completedCount = 1;
      let failedCount = 0;
      for (const groupVisit of completeDialogGroupVisits) {
        if (
          groupVisit.id !== completeDialogVisit.id &&
          (groupVisit.status === "in_progress" || groupVisit.status === "scheduled")
        ) {
          try {
            if (groupVisit.status === "scheduled") {
              await apiRequest("PATCH", `/api/visits/${groupVisit.id}`, {
                startedAt: new Date().toISOString(),
                status: "in_progress",
              });
            }
            await apiRequest("POST", `/api/visits/${groupVisit.id}/complete-notify`, {
              gateClosedPhoto: gateClosedPath,
              technicianNotes: notes[completeDialogVisit.id] || undefined,
              noGate,
            });
            completedCount++;
          } catch (groupErr: any) {
            if (isNetworkError(groupErr)) {
              if (groupVisit.status === "scheduled") {
                await addPendingMutation({
                  method: "PATCH",
                  url: `/api/visits/${groupVisit.id}`,
                  body: { startedAt: new Date().toISOString(), status: "in_progress" },
                });
              }
              await addPendingMutation({
                method: "POST",
                url: `/api/visits/${groupVisit.id}/complete-notify`,
                body: {
                  gateClosedPhoto: gateClosedPath,
                  technicianNotes: notes[completeDialogVisit.id] || undefined,
                },
              });
              offline.refreshPendingCount();
              completedCount++;
            } else {
              failedCount++;
              console.error(`Failed to complete grouped visit ${groupVisit.id}:`, groupErr);
            }
          }
        }
      }

      setPendingAdvanceAfter(completeDialogVisit.id);
      queryClient.invalidateQueries({ queryKey: ["/api/visits/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/uninvoiced-summary"] });
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey.includes("uninvoiced-visits"),
      });
      setCompleteDialogVisit(null);
      setCompleteDialogGroupVisits([]);
      if (failedCount > 0) {
        toast({
          title: `${completedCount} of ${completedCount + failedCount} visits completed`,
          description: `${failedCount} visit${failedCount !== 1 ? "s" : ""} failed to complete. Check the remaining visits.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: completedCount > 1 ? `${completedCount} visits completed` : "Visit completed",
          description: "Customer has been notified.",
        });
      }
    } catch (err: any) {
      toast({ title: "Completion failed", description: err.message, variant: "destructive" });
    } finally {
      setIsCompleting(false);
    }
  };

  const completionMessage = completeDialogVisit?.contact
    ? noGate
      ? `Hi ${completeDialogVisit.contact.firstName}. ${company?.name || "Our team"} just finished your poop scoop service. Let us know if there is anything we can do.`
      : `Hi ${completeDialogVisit.contact.firstName}. ${company?.name || "Our team"} just finished your poop scoop service. Here is your gate closed image. Let us know if there is anything we can do.`
    : "";

  return (
    <div className="flex flex-col h-full">
      {/* Start Day Overview Screen */}
      {viewMode === "start-day" && !isLoading && visits && visits.length > 0 && (
        <div
          className="flex-1 overflow-auto p-4 space-y-4 max-w-lg mx-auto w-full"
          data-testid="screen-start-day"
        >
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-start-day-heading">
                Today's Route
              </h1>
              <p className="text-sm text-muted-foreground">{company?.name}</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-primary" data-testid="text-stop-count">
                {totalVisitCount}
              </div>
              <div className="text-xs text-muted-foreground">stops</div>
            </div>
          </div>

          {/* Depot / starting point row */}
          <button
            className="w-full flex items-center gap-3 p-3 rounded-lg border bg-card text-left hover:bg-accent transition-colors"
            onClick={() => setShowDepotPicker(true)}
            data-testid="button-depot-picker"
          >
            <Home className="h-4 w-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              {effectiveDepot ? (
                <>
                  <p className="text-xs text-muted-foreground">Starting from</p>
                  <p className="text-sm font-medium truncate" data-testid="text-active-depot-name">
                    {effectiveDepot.name}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-no-depot-nudge">
                  Set your starting point for accurate directions
                </p>
              )}
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>

          {/* Home address row */}
          <button
            className="w-full flex items-center gap-3 p-3 rounded-lg border bg-card text-left hover:bg-accent transition-colors"
            onClick={() => {
              setHomeAddressInput(currentUser?.homeAddress || "");
              setShowHomeAddressDialog(true);
            }}
            data-testid="button-home-address-picker"
          >
            <MapPin className="h-4 w-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              {currentUser?.homeAddress ? (
                <>
                  <p className="text-xs text-muted-foreground">Home address</p>
                  <p className="text-sm font-medium truncate" data-testid="text-home-address">
                    {currentUser.homeAddress}
                  </p>
                </>
              ) : (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="text-no-home-address-nudge"
                >
                  Save your home address for route optimization
                </p>
              )}
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>

          {/* Route stats */}
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary shrink-0" />
                <div>
                  <div className="text-lg font-bold" data-testid="text-stats-stops">
                    {totalVisitCount}
                  </div>
                  <div className="text-xs text-muted-foreground">Stops</div>
                </div>
              </div>
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary shrink-0" />
                <div>
                  <div className="text-lg font-bold" data-testid="text-stats-time">
                    {totalVisitCount < 4
                      ? `~${totalVisitCount * 20}m`
                      : `~${Math.floor((totalVisitCount * 20) / 60)}h ${(totalVisitCount * 20) % 60}m`}
                  </div>
                  <div className="text-xs text-muted-foreground">Est. total</div>
                </div>
              </div>
            </Card>
          </div>

          {/* Route map */}
          {techMapStops.length > 0 && (
            <div
              className="rounded-lg overflow-hidden border bg-muted"
              style={{ height: 220 }}
              data-testid="container-route-map"
            >
              <Suspense fallback={<div className="h-full bg-muted animate-pulse" />}>
                <RouteMapView stops={techMapStops} routeName="My Route" />
              </Suspense>
            </div>
          )}

          {/* Ordered stop list */}
          <div className="space-y-2" data-testid="list-start-day-stops">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Stops in Order
            </h2>
            {allVisitsFlat.map((visit, i) => (
              <div
                key={visit.id}
                className="flex items-center gap-3 p-3 bg-card border rounded-lg"
                data-testid={`stop-item-${visit.id}`}
              >
                <div
                  className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0"
                  data-testid={`stop-number-${visit.id}`}
                >
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className="text-sm font-medium truncate"
                    data-testid={`stop-address-${visit.id}`}
                  >
                    {visit.property?.streetAddress || "Unknown address"}
                  </p>
                  <p
                    className="text-xs text-muted-foreground truncate"
                    data-testid={`stop-client-${visit.id}`}
                  >
                    {visit.contact
                      ? `${visit.contact.firstName} ${visit.contact.lastName}`
                      : "Unknown"}
                    {visit.servicePlanName ? ` · ${visit.servicePlanName}` : ""}
                  </p>
                </div>
                {visit.property?.hasDangerousDog && (
                  <ShieldAlert className="h-4 w-4 text-red-500 shrink-0" />
                )}
                <Badge
                  variant="secondary"
                  className={`text-xs shrink-0 ${visitStatusColors[visit.status] || ""}`}
                >
                  {visitStatusLabels[visit.status] || visit.status}
                </Badge>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="space-y-2 pb-4">
            <Button
              className="w-full h-12 text-base gap-2"
              onClick={handleStartRoute}
              data-testid="button-start-route"
            >
              <Flag className="h-5 w-5" />
              Start Route
              <ArrowRight className="h-5 w-5" />
            </Button>
            {nextUncompletedVisit?.property && (
              <Button
                variant="outline"
                className="w-full h-10 gap-2"
                asChild
                data-testid="button-navigate-first-stop"
              >
                <a
                  href={getNavigateUrl(
                    nextUncompletedVisit.property.streetAddress,
                    nextUncompletedVisit.property.city,
                    nextUncompletedVisit.property.state
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Navigation className="h-4 w-4" />
                  Navigate to First Stop
                </a>
              </Button>
            )}
            {googleMapsDirectionsUrl && (
              <Button
                variant="outline"
                className="w-full h-10 gap-2"
                asChild
                data-testid="button-open-google-maps"
              >
                <a href={googleMapsDirectionsUrl} target="_blank" rel="noopener noreferrer">
                  <MapIcon className="h-4 w-4" />
                  Open in Google Maps
                </a>
              </Button>
            )}
          </div>
        </div>
      )}

      {/* No visits / loading / route view */}
      {(viewMode === "route" || (viewMode === "start-day" && (!visits || visits.length === 0))) && (
        <div className="flex-1 overflow-auto p-4 space-y-4 max-w-lg mx-auto w-full">
          <OfflineStatusBar
            isOnline={offline.isOnline}
            pendingCount={offline.pendingCount}
            isSyncing={offline.isSyncing}
            lastSyncResult={offline.lastSyncResult}
            onRetrySync={offline.performSync}
          />
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-tech-heading">
                Active Service
              </h1>
              <p className="text-sm text-muted-foreground">
                Complete visits and capture proof of service
              </p>
            </div>
            {visits && visits.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={() => setShowMapOverlay(true)}
                data-testid="button-map-toggle"
              >
                <MapIcon className="h-4 w-4" />
                Map
              </Button>
            )}
          </div>

          <input
            type="file"
            accept="image/*"
            ref={beforeFileInputRef}
            className="hidden"
            onChange={handleFileSelected}
            data-testid="input-photo-file-before"
          />
          <input
            type="file"
            accept="image/*"
            capture="environment"
            ref={beforeCaptureInputRef}
            className="hidden"
            onChange={handleFileSelected}
            data-testid="input-photo-capture-before"
          />
          <input
            type="file"
            accept="image/*"
            ref={afterFileInputRef}
            className="hidden"
            onChange={handleFileSelected}
            data-testid="input-photo-file-after"
          />
          <input
            type="file"
            accept="image/*"
            capture="environment"
            ref={afterCaptureInputRef}
            className="hidden"
            onChange={handleFileSelected}
            data-testid="input-photo-capture-after"
          />

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : visits && visits.length > 0 ? (
            <div className="space-y-4">
              {routeGroupsWithProps.map((routeGroup) => (
                <div key={routeGroup.routeId} className="space-y-3">
                  <div
                    className="flex items-center justify-between px-1"
                    data-testid={`text-mobile-route-group-${routeGroup.routeName}`}
                  >
                    <div className="flex items-center gap-2">
                      {routeGroup.routeColor && (
                        <span
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: routeGroup.routeColor }}
                        />
                      )}
                      <h2 className="text-sm font-semibold">{routeGroup.routeName}</h2>
                    </div>
                    <span
                      className="text-xs text-muted-foreground"
                      data-testid={`text-mobile-route-progress-${routeGroup.routeName}`}
                    >
                      {routeGroup.completedCount} of {routeGroup.totalCount} done
                    </span>
                  </div>
                  {routeGroup.groups.map((group) => {
                    const primaryVisit = group.visits[0];
                    const isMulti = group.visits.length > 1;
                    const groupKey = group.propertyKey;
                    const isExpanded = expandedId === groupKey;
                    const anyScheduled = group.visits.some((v) => v.status === "scheduled");
                    const anyInProgress = group.visits.some((v) => v.status === "in_progress");
                    const allCompleted = group.visits.every(
                      (v) =>
                        v.status === "completed" ||
                        v.status === "skipped" ||
                        v.status === "cancelled"
                    );
                    const groupStatus = allCompleted
                      ? "completed"
                      : anyInProgress
                        ? "in_progress"
                        : anyScheduled
                          ? "scheduled"
                          : primaryVisit.status;
                    const hasAnyPhotos = group.visits.some(
                      (v) =>
                        v.proofOfServicePhotoBefore || v.proofOfServicePhoto || v.gateClosedPhoto
                    );
                    const canUploadGroup = anyScheduled || anyInProgress;

                    return (
                      <Card key={groupKey} data-testid={`card-visit-${primaryVisit.id}`}>
                        <CardHeader
                          className="p-4 pb-2 cursor-pointer"
                          onClick={() => setExpandedId(isExpanded ? null : groupKey)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <CardTitle
                                className="text-base truncate"
                                data-testid={`text-visit-address-${primaryVisit.id}`}
                              >
                                {primaryVisit.property?.streetAddress || "Unknown address"}
                                {isMulti && (
                                  <span className="text-xs font-normal text-muted-foreground ml-2">
                                    ({group.visits.length} services)
                                  </span>
                                )}
                              </CardTitle>
                              <p
                                className="text-sm text-muted-foreground truncate"
                                data-testid={`text-visit-contact-${primaryVisit.id}`}
                              >
                                {primaryVisit.contact
                                  ? `${primaryVisit.contact.firstName} ${primaryVisit.contact.lastName}`
                                  : "Unknown"}
                              </p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {group.visits.map((visit) => (
                                  <span key={visit.id} className="contents">
                                    {visit.servicePlanName && (
                                      <Badge
                                        variant="outline"
                                        className="text-xs capitalize"
                                        data-testid={`badge-service-type-${visit.id}`}
                                      >
                                        {visit.servicePlanName}
                                      </Badge>
                                    )}
                                    {visit.addOns?.map((a, i) => (
                                      <Badge
                                        key={i}
                                        variant="outline"
                                        className="text-xs bg-muted"
                                        data-testid={`badge-addon-${visit.id}-${i}`}
                                      >
                                        + {a.name}
                                      </Badge>
                                    ))}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {hasAnyPhotos && (
                                <ImageIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
                              )}
                              <Badge
                                variant="secondary"
                                className={`text-xs ${visitStatusColors[groupStatus] || ""}`}
                                data-testid={`badge-visit-status-${primaryVisit.id}`}
                              >
                                {visitStatusLabels[groupStatus] || groupStatus}
                              </Badge>
                              {isExpanded ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </div>
                          </div>
                          {primaryVisit.property?.hasDangerousDog && (
                            <div
                              className="mt-2 flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2"
                              data-testid={`alert-dangerous-dog-${primaryVisit.id}`}
                            >
                              <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-red-700 dark:text-red-300">
                                  Dangerous Dog Warning
                                </p>
                                {primaryVisit.property.dangerousDogNotes && (
                                  <p
                                    className="text-xs text-red-600 dark:text-red-400 mt-0.5"
                                    data-testid={`text-dangerous-dog-notes-${primaryVisit.id}`}
                                  >
                                    {primaryVisit.property.dangerousDogNotes}
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </CardHeader>
                        {isExpanded && (
                          <CardContent className="p-4 pt-0 space-y-3">
                            {!allCompleted &&
                              (() => {
                                const info =
                                  group.visits
                                    .map((v) => driveInfo.get(v.id))
                                    .find((d) => d != null) ?? null;
                                if (info) {
                                  return (
                                    <div
                                      className="flex items-center gap-1.5 text-sm text-muted-foreground"
                                      data-testid={`drive-time-stop-${primaryVisit.id}`}
                                    >
                                      <Clock className="h-4 w-4 shrink-0" />
                                      <span>
                                        {info.durationText} away · {info.distanceText}
                                      </span>
                                    </div>
                                  );
                                }
                                if (
                                  techPosition &&
                                  primaryVisit.property?.latitude != null &&
                                  primaryVisit.property?.longitude != null
                                ) {
                                  const miles = haversineDistanceMiles(
                                    techPosition.lat,
                                    techPosition.lng,
                                    primaryVisit.property.latitude,
                                    primaryVisit.property.longitude
                                  );
                                  return (
                                    <div
                                      className="flex items-center gap-1.5 text-sm text-muted-foreground"
                                      data-testid={`drive-time-stop-${primaryVisit.id}`}
                                    >
                                      <Clock className="h-4 w-4 shrink-0" />
                                      <span>
                                        {miles < 0.1 ? "<0.1 mi" : `${miles.toFixed(1)} mi`} away
                                      </span>
                                    </div>
                                  );
                                }
                                if (!techPosition) {
                                  return (
                                    <div
                                      className="flex items-center gap-1.5 text-sm text-muted-foreground"
                                      data-testid={`drive-time-unavailable-${primaryVisit.id}`}
                                    >
                                      <Clock className="h-4 w-4 shrink-0" />
                                      <span>Drive time unavailable</span>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            {primaryVisit.property && <PropertyImageSection visit={primaryVisit} />}
                            {primaryVisit.property?.numberOfDogs != null &&
                              primaryVisit.property.numberOfDogs > 0 && (
                                <div
                                  className="flex items-center gap-1.5 text-sm text-muted-foreground"
                                  data-testid={`text-dog-count-${primaryVisit.id}`}
                                >
                                  <Dog className="h-4 w-4" />
                                  <span>
                                    {primaryVisit.property.numberOfDogs}{" "}
                                    {primaryVisit.property.numberOfDogs === 1 ? "dog" : "dogs"}
                                  </span>
                                </div>
                              )}
                            {primaryVisit.property?.gateCode && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground">
                                  Gate Code
                                </p>
                                <p
                                  className="text-sm font-mono"
                                  data-testid={`text-gate-code-${primaryVisit.id}`}
                                >
                                  {primaryVisit.property.gateCode}
                                </p>
                              </div>
                            )}
                            {primaryVisit.property?.specialInstructions && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground">
                                  Instructions
                                </p>
                                <p
                                  className="text-sm"
                                  data-testid={`text-instructions-${primaryVisit.id}`}
                                >
                                  {primaryVisit.property.specialInstructions}
                                </p>
                              </div>
                            )}

                            {group.visits.some(
                              (v) =>
                                v.proofOfServicePhotoBefore ||
                                v.proofOfServicePhoto ||
                                v.gateClosedPhoto
                            ) && (
                              <div data-testid={`photos-container-${primaryVisit.id}`}>
                                <p className="text-xs font-medium text-muted-foreground mb-1">
                                  Proof of Service
                                </p>
                                <div className="grid gap-2 grid-cols-2">
                                  {group.visits.map((v) => (
                                    <span key={v.id} className="contents">
                                      {v.proofOfServicePhotoBefore && (
                                        <div data-testid={`photo-before-container-${v.id}`}>
                                          <p
                                            className="text-xs font-medium text-center mb-1"
                                            data-testid={`text-label-before-${v.id}`}
                                          >
                                            Before
                                          </p>
                                          <img
                                            src={v.proofOfServicePhotoBefore!}
                                            alt="Before service"
                                            className="rounded-md max-h-32 sm:max-h-48 w-full object-cover"
                                            data-testid={`img-proof-before-${v.id}`}
                                          />
                                        </div>
                                      )}
                                      {v.proofOfServicePhoto && (
                                        <div data-testid={`photo-after-container-${v.id}`}>
                                          <p
                                            className="text-xs font-medium text-center mb-1"
                                            data-testid={`text-label-after-${v.id}`}
                                          >
                                            After
                                          </p>
                                          <img
                                            src={v.proofOfServicePhoto!}
                                            alt="After service"
                                            className="rounded-md max-h-32 sm:max-h-48 w-full object-cover"
                                            data-testid={`img-proof-after-${v.id}`}
                                          />
                                        </div>
                                      )}
                                      {v.gateClosedPhoto && (
                                        <div data-testid={`photo-gate-container-${v.id}`}>
                                          <p className="text-xs font-medium text-center mb-1">
                                            Proof Photo
                                          </p>
                                          <img
                                            src={v.gateClosedPhoto!}
                                            alt="Gate closed"
                                            className="rounded-md max-h-32 sm:max-h-48 w-full object-cover"
                                            data-testid={`img-gate-closed-${v.id}`}
                                          />
                                        </div>
                                      )}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            <PendingPhotosIndicator
                              visitId={primaryVisit.id}
                              refreshTrigger={offline.pendingCount}
                            />

                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">
                                Notes
                              </p>
                              <Textarea
                                value={notes[primaryVisit.id] || primaryVisit.technicianNotes || ""}
                                onChange={(e) =>
                                  setNotes({ ...notes, [primaryVisit.id]: e.target.value })
                                }
                                placeholder="Add notes..."
                                className="text-sm"
                                data-testid={`input-notes-${primaryVisit.id}`}
                              />
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {nextUncompletedVisit?.property && (
                                <Button
                                  variant="outline"
                                  className="min-h-[44px]"
                                  asChild
                                  data-testid={`button-navigate-${primaryVisit.id}`}
                                >
                                  <a
                                    href={getNavigateUrl(
                                      nextUncompletedVisit.property.streetAddress,
                                      nextUncompletedVisit.property.city,
                                      nextUncompletedVisit.property.state
                                    )}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <Navigation className="mr-1 h-4 w-4" /> Navigate
                                  </a>
                                </Button>
                              )}
                              {primaryVisit.status !== "completed" &&
                                primaryVisit.status !== "cancelled" && (
                                  <Button
                                    variant="outline"
                                    onClick={() => handleOnMyWay(primaryVisit.id)}
                                    disabled={onMyWaySending === primaryVisit.id}
                                    className="min-h-[44px]"
                                    data-testid={`button-on-my-way-${primaryVisit.id}`}
                                  >
                                    {onMyWaySending === primaryVisit.id ? (
                                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                    ) : (
                                      <Navigation className="mr-1 h-4 w-4" />
                                    )}{" "}
                                    On My Way
                                  </Button>
                                )}
                              {anyScheduled && !anyInProgress && (
                                <Button
                                  onClick={() => {
                                    const scheduledVisits = group.visits.filter(
                                      (v) => v.status === "scheduled"
                                    );
                                    for (const v of scheduledVisits) {
                                      startMutation.mutate(v.id);
                                    }
                                  }}
                                  disabled={startMutation.isPending}
                                  className="flex-1 min-h-[44px]"
                                  data-testid={`button-start-${primaryVisit.id}`}
                                >
                                  <Play className="mr-1 h-4 w-4" /> Start{isMulti ? " All" : ""}
                                </Button>
                              )}
                              {anyInProgress && (
                                <Button
                                  onClick={() => openCompleteDialog(primaryVisit)}
                                  variant="outline"
                                  className="flex-1 min-h-[44px]"
                                  data-testid={`button-complete-${primaryVisit.id}`}
                                >
                                  <CheckCircle className="mr-1 h-4 w-4" /> Complete
                                  {isMulti ? " All" : ""}
                                </Button>
                              )}
                              {canUploadGroup && (
                                <div className="flex flex-col gap-1">
                                  <p className="text-xs text-muted-foreground font-medium">
                                    Before Photo
                                  </p>
                                  <div className="flex gap-1">
                                    <Button
                                      variant="outline"
                                      onClick={() =>
                                        handlePhotoClick(primaryVisit.id, "before", true)
                                      }
                                      disabled={
                                        uploadingVisitId === primaryVisit.id &&
                                        uploadingType === "before"
                                      }
                                      className="min-h-[44px] flex-1 px-2 text-xs"
                                      data-testid={`button-photo-before-camera-${primaryVisit.id}`}
                                    >
                                      {uploadingVisitId === primaryVisit.id &&
                                      uploadingType === "before" ? (
                                        <Loader2 className="animate-spin mr-1 h-3 w-3" />
                                      ) : (
                                        <Camera className="mr-1 h-3 w-3" />
                                      )}
                                      Take Photo
                                    </Button>
                                    <Button
                                      variant="outline"
                                      onClick={() =>
                                        handlePhotoClick(primaryVisit.id, "before", false)
                                      }
                                      disabled={
                                        uploadingVisitId === primaryVisit.id &&
                                        uploadingType === "before"
                                      }
                                      className="min-h-[44px] flex-1 px-2 text-xs"
                                      data-testid={`button-photo-before-gallery-${primaryVisit.id}`}
                                    >
                                      <ImageIcon className="mr-1 h-3 w-3" />
                                      Library
                                    </Button>
                                  </div>
                                </div>
                              )}
                              <div className="flex flex-col gap-1">
                                <p className="text-xs text-muted-foreground font-medium">
                                  After Photo
                                </p>
                                <div className="flex gap-1">
                                  <Button
                                    variant="outline"
                                    onClick={() => handlePhotoClick(primaryVisit.id, "after", true)}
                                    disabled={
                                      uploadingVisitId === primaryVisit.id &&
                                      uploadingType === "after"
                                    }
                                    className="min-h-[44px] flex-1 px-2 text-xs"
                                    data-testid={`button-photo-after-camera-${primaryVisit.id}`}
                                  >
                                    {uploadingVisitId === primaryVisit.id &&
                                    uploadingType === "after" ? (
                                      <Loader2 className="animate-spin mr-1 h-3 w-3" />
                                    ) : (
                                      <Camera className="mr-1 h-3 w-3" />
                                    )}
                                    Take Photo
                                  </Button>
                                  <Button
                                    variant="outline"
                                    onClick={() =>
                                      handlePhotoClick(primaryVisit.id, "after", false)
                                    }
                                    disabled={
                                      uploadingVisitId === primaryVisit.id &&
                                      uploadingType === "after"
                                    }
                                    className="min-h-[44px] flex-1 px-2 text-xs"
                                    data-testid={`button-photo-after-gallery-${primaryVisit.id}`}
                                  >
                                    <ImageIcon className="mr-1 h-3 w-3" />
                                    Library
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        )}
                      </Card>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <>
              <Card>
                <CardContent
                  className="p-6 text-center text-muted-foreground"
                  data-testid="text-no-visits"
                >
                  No visits scheduled for today.
                </CardContent>
              </Card>

              {/* Depot / starting point row — always visible so techs can manage it on quiet days */}
              <button
                className="w-full flex items-center gap-3 p-3 rounded-lg border bg-card text-left hover:bg-accent transition-colors"
                onClick={() => setShowDepotPicker(true)}
                data-testid="button-depot-picker-empty"
              >
                <Home className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  {activeDepot ? (
                    <>
                      <p className="text-xs text-muted-foreground">Starting from</p>
                      <p
                        className="text-sm font-medium truncate"
                        data-testid="text-active-depot-name-empty"
                      >
                        {activeDepot.name}
                      </p>
                    </>
                  ) : (
                    <p
                      className="text-sm text-muted-foreground"
                      data-testid="text-no-depot-nudge-empty"
                    >
                      Set your starting point for accurate directions
                    </p>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            </>
          )}

          <Dialog
            open={!!completeDialogVisit}
            onOpenChange={(open) => {
              if (!open) setCompleteDialogVisit(null);
            }}
          >
            <DialogContent
              className="sm:max-w-md max-h-[85vh] overflow-y-auto"
              data-testid="dialog-complete-visit"
            >
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <DoorClosed className="h-5 w-5" />
                  Complete Visit
                </DialogTitle>
                <DialogDescription>
                  {completeDialogVisit?.property?.streetAddress} -{" "}
                  {completeDialogVisit?.contact?.firstName} {completeDialogVisit?.contact?.lastName}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* No gate checkbox */}
                <label
                  className="flex items-center gap-3 p-3 rounded-md border cursor-pointer hover:bg-muted/50"
                  data-testid="label-no-gate"
                >
                  <input
                    type="checkbox"
                    checked={noGate}
                    onChange={(e) => {
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
                    <p className="text-xs text-muted-foreground">
                      Photo not required for this yard
                    </p>
                  </div>
                </label>

                {!noGate && (
                  <>
                    <div>
                      <p className="text-sm font-medium mb-1">Proof Photo (required)</p>
                      <p className="text-xs text-muted-foreground mb-2">
                        Take a photo showing the service area is clean and secure
                      </p>
                      <input
                        type="file"
                        accept="image/*"
                        ref={gateFileInputRef}
                        className="hidden"
                        onChange={handleGatePhotoCapture}
                        data-testid="input-gate-photo"
                      />
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        ref={gateCaptureInputRef}
                        className="hidden"
                        onChange={handleGatePhotoCapture}
                        data-testid="input-gate-photo-capture"
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
                            onClick={() => {
                              setGatePhoto(null);
                              setGatePhotoPreview(null);
                            }}
                            data-testid="button-remove-gate-photo"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            className="flex-1 h-16 border-dashed"
                            onClick={() => gateCaptureInputRef.current?.click()}
                            data-testid="button-gate-photo-camera"
                          >
                            <Camera className="mr-2 h-4 w-4" />
                            Take Photo
                          </Button>
                          <Button
                            variant="outline"
                            className="flex-1 h-16 border-dashed"
                            onClick={() => gateFileInputRef.current?.click()}
                            data-testid="button-gate-photo-gallery"
                          >
                            <ImageIcon className="mr-2 h-4 w-4" />
                            Choose from Library
                          </Button>
                        </div>
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
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        ref={extraCaptureInputRef}
                        className="hidden"
                        onChange={handleExtraPhotoCapture}
                        data-testid="input-extra-photo-capture"
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
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => extraCaptureInputRef.current?.click()}
                          data-testid="button-add-extra-photo-camera"
                        >
                          <Camera className="mr-1 h-4 w-4" /> Take Photo
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => extraFileInputRef.current?.click()}
                          data-testid="button-add-extra-photo-gallery"
                        >
                          <ImageIcon className="mr-1 h-4 w-4" /> Choose from Library
                        </Button>
                      </div>
                    </div>
                  </>
                )}

                <div className="rounded-md bg-muted p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Text to customer:
                  </p>
                  <p className="text-sm" data-testid="text-completion-sms-preview">
                    {completionMessage}
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCompleteDialogVisit(null)}
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

          {/* Persistent route progress bar */}
          {totalVisitCount > 0 && completedVisitCount > 0 && (
            <div
              className="sticky bottom-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-2.5 flex items-center gap-3"
              data-testid="bar-route-progress"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm font-medium" data-testid="text-progress-count">
                    {completedVisitCount} of {totalVisitCount} done
                  </span>
                  {remainingCount > 0 && (
                    <span className="text-xs text-muted-foreground" data-testid="text-progress-eta">
                      · ~
                      {estMinutesRemaining < 60
                        ? `${estMinutesRemaining}m`
                        : `${Math.floor(estMinutesRemaining / 60)}h ${estMinutesRemaining % 60}m`}{" "}
                      left
                    </span>
                  )}
                </div>
                <div
                  className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden"
                  data-testid="progress-bar-track"
                >
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{
                      width: `${Math.round((completedVisitCount / totalVisitCount) * 100)}%`,
                    }}
                    data-testid="progress-bar-fill"
                  />
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={() => setShowMapOverlay(true)}
                data-testid="button-progress-map"
              >
                <MapIcon className="h-4 w-4" />
                Map
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Map overview dialog */}
      <Dialog open={showMapOverlay} onOpenChange={setShowMapOverlay}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-map-overlay">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapIcon className="h-5 w-5" />
              Route Overview
            </DialogTitle>
            <DialogDescription>
              {completedVisitCount} of {totalVisitCount} stops completed
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {techMapStops.length > 0 && (
              <div
                className="rounded-lg overflow-hidden border bg-muted"
                style={{ height: 220 }}
                data-testid="container-map-overlay-img"
              >
                <Suspense fallback={<div className="h-full bg-muted animate-pulse" />}>
                  <RouteMapView stops={techMapStops} routeName="My Route" />
                </Suspense>
              </div>
            )}
            <div className="space-y-1.5 max-h-48 overflow-y-auto" data-testid="list-overlay-stops">
              {allVisitsFlat.map((visit, i) => {
                const isDone =
                  visit.status === "completed" ||
                  visit.status === "skipped" ||
                  visit.status === "cancelled";
                const isActive = visit.status === "in_progress";
                const distanceMiles =
                  !isDone &&
                  techPosition &&
                  visit.property?.latitude != null &&
                  visit.property?.longitude != null
                    ? haversineDistanceMiles(
                        techPosition.lat,
                        techPosition.lng,
                        visit.property.latitude,
                        visit.property.longitude
                      )
                    : null;
                return (
                  <div
                    key={visit.id}
                    className={`flex items-center gap-3 p-2 rounded-md text-sm ${isDone ? "opacity-50" : isActive ? "bg-primary/10 border border-primary/20" : "bg-muted/40"}`}
                    data-testid={`overlay-stop-${visit.id}`}
                  >
                    <div
                      className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isDone ? "bg-muted text-muted-foreground" : isActive ? "bg-primary text-primary-foreground animate-pulse" : "bg-primary text-primary-foreground"}`}
                    >
                      {isDone ? <CheckCircle className="h-3.5 w-3.5" /> : i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`font-medium truncate ${isDone ? "line-through" : ""}`}>
                        {visit.property?.streetAddress || "Unknown"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {visit.contact
                          ? `${visit.contact.firstName} ${visit.contact.lastName}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!isDone &&
                        (() => {
                          const drive = driveInfo.get(visit.id);
                          if (drive) {
                            return (
                              <span
                                className="text-xs text-muted-foreground"
                                data-testid={`distance-stop-${visit.id}`}
                              >
                                {drive.durationText} · {drive.distanceText}
                              </span>
                            );
                          }
                          if (distanceMiles !== null) {
                            return (
                              <span
                                className="text-xs text-muted-foreground"
                                data-testid={`distance-stop-${visit.id}`}
                              >
                                {distanceMiles < 0.1 ? "<0.1 mi" : `${distanceMiles.toFixed(1)} mi`}
                              </span>
                            );
                          }
                          return null;
                        })()}
                      {isActive && (
                        <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">
                          Active
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {googleMapsDirectionsUrl && (
              <Button
                variant="outline"
                className="w-full gap-2"
                asChild
                data-testid="button-overlay-google-maps"
              >
                <a href={googleMapsDirectionsUrl} target="_blank" rel="noopener noreferrer">
                  <Navigation className="h-4 w-4" />
                  Open in Google Maps
                </a>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Home Address Dialog */}
      <Dialog
        open={showHomeAddressDialog}
        onOpenChange={(open) => {
          setShowHomeAddressDialog(open);
          if (!open) setHomeAddressCoords(null);
        }}
      >
        <DialogContent className="max-w-sm" data-testid="dialog-home-address">
          <DialogHeader>
            <DialogTitle>Home Address</DialogTitle>
            <DialogDescription>
              Your home address is included as a candidate start when the route optimizer runs,
              helping routes begin closer to where you live.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Street address</label>
              <AddressAutocomplete
                value={homeAddressInput}
                onChange={(val) => {
                  setHomeAddressInput(val);
                  setHomeAddressCoords(null);
                }}
                onSelect={(parsed) => {
                  if (parsed.latitude && parsed.longitude) {
                    setHomeAddressCoords({
                      lat: parseFloat(parsed.latitude),
                      lng: parseFloat(parsed.longitude),
                    });
                  }
                }}
                placeholder="123 Main St, City, State 12345"
                data-testid="input-home-address"
              />
              <p className="text-xs text-muted-foreground">
                Enter your full address including city and state.
              </p>
            </div>
            {currentUser?.homeAddress && (
              <p className="text-xs text-muted-foreground">Current: {currentUser.homeAddress}</p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {currentUser?.homeAddress && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateHomeAddressMutation.mutate({ homeAddress: null })}
                disabled={updateHomeAddressMutation.isPending}
                data-testid="button-clear-home-address"
              >
                Clear
              </Button>
            )}
            <Button
              onClick={() => {
                const trimmed = homeAddressInput.trim();
                if (!trimmed) return;
                updateHomeAddressMutation.mutate({
                  homeAddress: trimmed,
                  ...(homeAddressCoords
                    ? { homeLatitude: homeAddressCoords.lat, homeLongitude: homeAddressCoords.lng }
                    : {}),
                });
              }}
              disabled={updateHomeAddressMutation.isPending || !homeAddressInput.trim()}
              data-testid="button-save-home-address"
            >
              {updateHomeAddressMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Depot Picker Dialog */}
      <Dialog open={showDepotPicker} onOpenChange={setShowDepotPicker}>
        <DialogContent className="max-w-sm" data-testid="dialog-depot-picker">
          <DialogHeader>
            <DialogTitle>Set Starting Point</DialogTitle>
            <DialogDescription>
              Choose the depot you are starting from today. This adds an accurate origin to your
              navigation links.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {/* "Use my current location" option */}
            <button
              className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${!effectiveDepot ? "border-primary bg-primary/5" : "hover:bg-accent"}`}
              onClick={() => {
                if (currentUser?.id) {
                  saveDepot(null);
                  setCachedDepot(null);
                  updateDepotMutation.mutate(null);
                }
              }}
              disabled={updateDepotMutation.isPending}
              data-testid="button-select-current-location"
            >
              <Navigation className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Use my current location</p>
                <p className="text-xs text-muted-foreground">GPS position at time of navigation</p>
              </div>
              {!effectiveDepot && <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
            </button>

            {depots.map((depot) => {
              const isSelected = effectiveDepot?.id === depot.id;
              return (
                <button
                  key={depot.id}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${isSelected ? "border-primary bg-primary/5" : "hover:bg-accent"}`}
                  onClick={() => {
                    if (currentUser?.id) {
                      saveDepot(depot);
                      setCachedDepot(depot);
                      updateDepotMutation.mutate(depot.id);
                    }
                  }}
                  disabled={updateDepotMutation.isPending}
                  data-testid={`button-select-depot-${depot.id}`}
                >
                  <Home className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{depot.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{depot.address}</p>
                  </div>
                  {isSelected && <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                </button>
              );
            })}
            {depots.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No depots configured yet. Ask your admin to add starting locations in Settings.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
