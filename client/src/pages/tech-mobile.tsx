import { useState, useRef, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Play, CheckCircle, Camera, ChevronDown, ChevronUp, ImageIcon, Loader2, Satellite, Plus, X, Send, DoorClosed, Navigation, ShieldAlert, Dog } from "lucide-react";
import { StreetViewImage } from "@/components/street-view-image";
import { SatelliteImage } from "@/components/satellite-image";
import { getYardCategory, formatArea } from "@/components/yard-measure-tool";

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [uploadingVisitId, setUploadingVisitId] = useState<string | null>(null);
  const [uploadingType, setUploadingType] = useState<PhotoUploadType | null>(null);
  const beforeFileInputRef = useRef<HTMLInputElement>(null);
  const afterFileInputRef = useRef<HTMLInputElement>(null);
  const pendingVisitIdRef = useRef<string | null>(null);
  const pendingUploadTypeRef = useRef<PhotoUploadType | null>(null);
  const [pendingAdvanceAfter, setPendingAdvanceAfter] = useState<string | null>(null);

  const [completeDialogVisit, setCompleteDialogVisit] = useState<TodayVisit | null>(null);
  const [completeDialogGroupVisits, setCompleteDialogGroupVisits] = useState<TodayVisit[]>([]);
  const [gatePhoto, setGatePhoto] = useState<File | null>(null);
  const [gatePhotoPreview, setGatePhotoPreview] = useState<string | null>(null);
  const [extraFiles, setExtraFiles] = useState<{ file: File; preview: string }[]>([]);
  const [isCompleting, setIsCompleting] = useState(false);
  const gateFileInputRef = useRef<HTMLInputElement>(null);
  const extraFileInputRef = useRef<HTMLInputElement>(null);

  const [onMyWaySending, setOnMyWaySending] = useState<string | null>(null);
  const [onMyWayCooldowns, setOnMyWayCooldowns] = useState<Record<string, number>>({});

  const handleOnMyWay = (visitId: string) => {
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
      (geoErr) => {
        setOnMyWaySending(null);
        toast({ title: "Location unavailable", description: geoErr.message || "Could not get your current location", variant: "destructive" });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const { data: company } = useQuery<{ name: string }>({ queryKey: ["/api/company"] });

  const { data: visits, isLoading } = useQuery<TodayVisit[]>({
    queryKey: ["/api/visits/today"],
  });

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
      if (visit.status === "completed" || visit.status === "skipped" || visit.status === "cancelled") {
        rg.completedCount++;
      }

      const key = visit.propertyId || visit.id;
      let propGroup = rg.groups.find(g => g.propertyKey === key);
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
    if (pendingAdvanceAfter && visits) {
      const completedIdx = allVisitsFlat.findIndex(v => v.id === pendingAdvanceAfter);
      if (completedIdx >= 0) {
        const nextIncomplete = allVisitsFlat.slice(completedIdx + 1).find(
          v => v.status === "scheduled" || v.status === "in_progress"
        );
        if (nextIncomplete) {
          setExpandedId(nextIncomplete.id);
        }
      }
      setPendingAdvanceAfter(null);
    }
  }, [visits, pendingAdvanceAfter, allVisitsFlat]);

  const startMutation = useMutation({
    mutationFn: async (visitId: string) => {
      await apiRequest("PATCH", `/api/visits/${visitId}`, {
        startedAt: new Date().toISOString(),
        status: "in_progress",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/visits/today"] });
      toast({ title: "Visit started" });
    },
  });

  const handlePhotoClick = (visitId: string, type: PhotoUploadType) => {
    pendingVisitIdRef.current = visitId;
    pendingUploadTypeRef.current = type;
    if (type === "before") {
      beforeFileInputRef.current?.click();
    } else {
      afterFileInputRef.current?.click();
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

    try {
      const objectPath = await uploadFileDirect(file);
      const patchField = photoType === "before" ? "proofOfServicePhotoBefore" : "proofOfServicePhoto";
      await apiRequest("PATCH", `/api/visits/${visitId}`, { [patchField]: objectPath });

      queryClient.invalidateQueries({ queryKey: ["/api/visits/today"] });
      const label = photoType === "before" ? "Before" : "After";
      toast({ title: `${label} photo uploaded`, description: "Photo saved successfully." });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploadingVisitId(null);
      setUploadingType(null);
      pendingVisitIdRef.current = null;
      pendingUploadTypeRef.current = null;
    }
  };

  const openCompleteDialog = (visit: TodayVisit) => {
    const propertyKey = visit.propertyId || visit.id;
    const allGroupVisits = (visits || []).filter(v =>
      (v.propertyId || v.id) === propertyKey &&
      (v.status === "in_progress" || v.status === "scheduled")
    );
    setCompleteDialogVisit(visit);
    setCompleteDialogGroupVisits(allGroupVisits.length > 1 ? allGroupVisits : []);
    setGatePhoto(null);
    setGatePhotoPreview(null);
    setExtraFiles([]);
    setIsCompleting(false);
  };

  const handleGatePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setGatePhoto(file);
    const reader = new FileReader();
    reader.onload = () => setGatePhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleExtraPhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = () => {
      setExtraFiles(prev => [...prev, { file, preview: reader.result as string }]);
    };
    reader.readAsDataURL(file);
  };

  const removeExtraPhoto = (index: number) => {
    setExtraFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleCompleteAndSend = async () => {
    if (!completeDialogVisit || !gatePhoto) return;
    setIsCompleting(true);

    try {
      const gateClosedPath = await uploadFileDirect(gatePhoto);

      const extraPaths: string[] = [];
      for (const extra of extraFiles) {
        const path = await uploadFileDirect(extra.file);
        extraPaths.push(path);
      }

      await apiRequest("POST", `/api/visits/${completeDialogVisit.id}/complete-notify`, {
        gateClosedPhoto: gateClosedPath,
        extraPhotos: extraPaths.length > 0 ? extraPaths : undefined,
        technicianNotes: notes[completeDialogVisit.id] || undefined,
      });

      let completedCount = 1;
      let failedCount = 0;
      for (const groupVisit of completeDialogGroupVisits) {
        if (groupVisit.id !== completeDialogVisit.id && (groupVisit.status === "in_progress" || groupVisit.status === "scheduled")) {
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
            });
            completedCount++;
          } catch (groupErr: any) {
            failedCount++;
            console.error(`Failed to complete grouped visit ${groupVisit.id}:`, groupErr);
          }
        }
      }

      setPendingAdvanceAfter(completeDialogVisit.id);
      queryClient.invalidateQueries({ queryKey: ["/api/visits/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/uninvoiced-summary"] });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey.includes("uninvoiced-visits") });
      setCompleteDialogVisit(null);
      setCompleteDialogGroupVisits([]);
      if (failedCount > 0) {
        toast({
          title: `${completedCount} of ${completedCount + failedCount} visits completed`,
          description: `${failedCount} visit${failedCount !== 1 ? "s" : ""} failed to complete. Check the remaining visits.`,
          variant: "destructive",
        });
      } else {
        toast({ title: completedCount > 1 ? `${completedCount} visits completed` : "Visit completed", description: "Customer has been notified." });
      }
    } catch (err: any) {
      toast({ title: "Completion failed", description: err.message, variant: "destructive" });
    } finally {
      setIsCompleting(false);
    }
  };

  const completionMessage = completeDialogVisit?.contact
    ? `Hi ${completeDialogVisit.contact.firstName}. ${company?.name || "Our team"} just finished your poop scoop service. Here is your gate closed image. Let us know if there is anything we can do.`
    : "";

  return (
    <div className="p-4 space-y-4 overflow-auto h-full max-w-lg mx-auto">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-tech-heading">Active Service</h1>
        <p className="text-sm text-muted-foreground">Complete visits and capture proof of service</p>
      </div>

      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={beforeFileInputRef}
        className="hidden"
        onChange={handleFileSelected}
        data-testid="input-photo-file-before"
      />
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={afterFileInputRef}
        className="hidden"
        onChange={handleFileSelected}
        data-testid="input-photo-file-after"
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
              <div className="flex items-center justify-between px-1" data-testid={`text-mobile-route-group-${routeGroup.routeName}`}>
                <div className="flex items-center gap-2">
                  {routeGroup.routeColor && (
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: routeGroup.routeColor }} />
                  )}
                  <h2 className="text-sm font-semibold">{routeGroup.routeName}</h2>
                </div>
                <span className="text-xs text-muted-foreground" data-testid={`text-mobile-route-progress-${routeGroup.routeName}`}>
                  {routeGroup.completedCount} of {routeGroup.totalCount} done
                </span>
              </div>
          {routeGroup.groups.map((group) => {
            const primaryVisit = group.visits[0];
            const isMulti = group.visits.length > 1;
            const groupKey = group.propertyKey;
            const isExpanded = expandedId === groupKey;
            const anyScheduled = group.visits.some(v => v.status === "scheduled");
            const anyInProgress = group.visits.some(v => v.status === "in_progress");
            const allCompleted = group.visits.every(v => v.status === "completed" || v.status === "skipped" || v.status === "cancelled");
            const groupStatus = allCompleted ? "completed" : anyInProgress ? "in_progress" : anyScheduled ? "scheduled" : primaryVisit.status;
            const hasAnyPhotos = group.visits.some(v => v.proofOfServicePhotoBefore || v.proofOfServicePhoto || v.gateClosedPhoto);
            const canUploadGroup = anyScheduled || anyInProgress;

            return (
              <Card key={groupKey} data-testid={`card-visit-${primaryVisit.id}`}>
                <CardHeader
                  className="p-4 pb-2 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : groupKey)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base truncate" data-testid={`text-visit-address-${primaryVisit.id}`}>
                        {primaryVisit.property?.streetAddress || "Unknown address"}
                        {isMulti && <span className="text-xs font-normal text-muted-foreground ml-2">({group.visits.length} services)</span>}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground truncate" data-testid={`text-visit-contact-${primaryVisit.id}`}>
                        {primaryVisit.contact ? `${primaryVisit.contact.firstName} ${primaryVisit.contact.lastName}` : "Unknown"}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {group.visits.map((visit) => (
                          <span key={visit.id} className="contents">
                            {visit.servicePlanName && (
                              <Badge variant="outline" className="text-xs capitalize" data-testid={`badge-service-type-${visit.id}`}>
                                {visit.servicePlanName}
                              </Badge>
                            )}
                            {visit.addOns?.map((a, i) => (
                              <Badge key={i} variant="outline" className="text-xs bg-muted" data-testid={`badge-addon-${visit.id}-${i}`}>
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
                      <Badge variant="secondary" className={`text-xs ${visitStatusColors[groupStatus] || ""}`} data-testid={`badge-visit-status-${primaryVisit.id}`}>
                        {visitStatusLabels[groupStatus] || groupStatus}
                      </Badge>
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </div>
                  {primaryVisit.property?.hasDangerousDog && (
                    <div className="mt-2 flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2" data-testid={`alert-dangerous-dog-${primaryVisit.id}`}>
                      <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-red-700 dark:text-red-300">Dangerous Dog Warning</p>
                        {primaryVisit.property.dangerousDogNotes && (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-0.5" data-testid={`text-dangerous-dog-notes-${primaryVisit.id}`}>{primaryVisit.property.dangerousDogNotes}</p>
                        )}
                      </div>
                    </div>
                  )}
                </CardHeader>
                {isExpanded && (
                  <CardContent className="p-4 pt-0 space-y-3">
                    {primaryVisit.property && (
                      <PropertyImageSection visit={primaryVisit} />
                    )}
                    {primaryVisit.property?.numberOfDogs != null && primaryVisit.property.numberOfDogs > 0 && (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid={`text-dog-count-${primaryVisit.id}`}>
                        <Dog className="h-4 w-4" />
                        <span>{primaryVisit.property.numberOfDogs} {primaryVisit.property.numberOfDogs === 1 ? "dog" : "dogs"}</span>
                      </div>
                    )}
                    {primaryVisit.property?.gateCode && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Gate Code</p>
                        <p className="text-sm font-mono" data-testid={`text-gate-code-${primaryVisit.id}`}>{primaryVisit.property.gateCode}</p>
                      </div>
                    )}
                    {primaryVisit.property?.specialInstructions && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Instructions</p>
                        <p className="text-sm" data-testid={`text-instructions-${primaryVisit.id}`}>{primaryVisit.property.specialInstructions}</p>
                      </div>
                    )}

                    {group.visits.some(v => v.proofOfServicePhotoBefore || v.proofOfServicePhoto || v.gateClosedPhoto) && (
                      <div data-testid={`photos-container-${primaryVisit.id}`}>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Proof of Service</p>
                        <div className="grid gap-2 grid-cols-2">
                          {group.visits.map(v => (
                            <span key={v.id} className="contents">
                              {v.proofOfServicePhotoBefore && (
                                <div data-testid={`photo-before-container-${v.id}`}>
                                  <p className="text-xs font-medium text-center mb-1" data-testid={`text-label-before-${v.id}`}>Before</p>
                                  <img src={v.proofOfServicePhotoBefore!} alt="Before service" className="rounded-md max-h-32 sm:max-h-48 w-full object-cover" data-testid={`img-proof-before-${v.id}`} />
                                </div>
                              )}
                              {v.proofOfServicePhoto && (
                                <div data-testid={`photo-after-container-${v.id}`}>
                                  <p className="text-xs font-medium text-center mb-1" data-testid={`text-label-after-${v.id}`}>After</p>
                                  <img src={v.proofOfServicePhoto!} alt="After service" className="rounded-md max-h-32 sm:max-h-48 w-full object-cover" data-testid={`img-proof-after-${v.id}`} />
                                </div>
                              )}
                              {v.gateClosedPhoto && (
                                <div data-testid={`photo-gate-container-${v.id}`}>
                                  <p className="text-xs font-medium text-center mb-1">Proof Photo</p>
                                  <img src={v.gateClosedPhoto!} alt="Gate closed" className="rounded-md max-h-32 sm:max-h-48 w-full object-cover" data-testid={`img-gate-closed-${v.id}`} />
                                </div>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                      <Textarea
                        value={notes[primaryVisit.id] || primaryVisit.technicianNotes || ""}
                        onChange={(e) => setNotes({ ...notes, [primaryVisit.id]: e.target.value })}
                        placeholder="Add notes..."
                        className="text-sm"
                        data-testid={`input-notes-${primaryVisit.id}`}
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {primaryVisit.status !== "completed" && primaryVisit.status !== "cancelled" && (
                        <Button
                          variant="outline"
                          onClick={() => handleOnMyWay(primaryVisit.id)}
                          disabled={onMyWaySending === primaryVisit.id}
                          className="min-h-[44px]"
                          data-testid={`button-on-my-way-${primaryVisit.id}`}
                        >
                          {onMyWaySending === primaryVisit.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Navigation className="mr-1 h-4 w-4" />} On My Way
                        </Button>
                      )}
                      {anyScheduled && !anyInProgress && (
                        <Button
                          onClick={() => {
                            const scheduledVisits = group.visits.filter(v => v.status === "scheduled");
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
                          <CheckCircle className="mr-1 h-4 w-4" /> Complete{isMulti ? " All" : ""}
                        </Button>
                      )}
                      {canUploadGroup && (
                        <Button
                          variant="outline"
                          onClick={() => handlePhotoClick(primaryVisit.id, "before")}
                          disabled={uploadingVisitId === primaryVisit.id && uploadingType === "before"}
                          className="min-h-[44px]"
                          data-testid={`button-photo-before-${primaryVisit.id}`}
                        >
                          {uploadingVisitId === primaryVisit.id && uploadingType === "before" ? <Loader2 className="animate-spin mr-1 h-4 w-4" /> : <Camera className="mr-1 h-4 w-4" />}
                          Before
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => handlePhotoClick(primaryVisit.id, "after")}
                        disabled={uploadingVisitId === primaryVisit.id && uploadingType === "after"}
                        className="min-h-[44px]"
                        data-testid={`button-photo-after-${primaryVisit.id}`}
                      >
                        {uploadingVisitId === primaryVisit.id && uploadingType === "after" ? <Loader2 className="animate-spin mr-1 h-4 w-4" /> : <Camera className="mr-1 h-4 w-4" />}
                        After
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })
          }
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-no-visits">
            No visits scheduled for today.
          </CardContent>
        </Card>
      )}

      <Dialog open={!!completeDialogVisit} onOpenChange={(open) => { if (!open) setCompleteDialogVisit(null); }}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto" data-testid="dialog-complete-visit">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DoorClosed className="h-5 w-5" />
              Complete Visit
            </DialogTitle>
            <DialogDescription>
              {completeDialogVisit?.property?.streetAddress} - {completeDialogVisit?.contact?.firstName} {completeDialogVisit?.contact?.lastName}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-1">Proof Photo (required)</p>
              <p className="text-xs text-muted-foreground mb-2">Take a photo showing the service area is clean and secure</p>
              <input
                type="file"
                accept="image/*"
                capture="environment"
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
                  Take Proof Photo
                </Button>
              )}
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Additional Photos (optional)</p>
              <input
                type="file"
                accept="image/*"
                capture="environment"
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

            <div className="rounded-md bg-muted p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Text to customer:</p>
              <p className="text-sm" data-testid="text-completion-sms-preview">{completionMessage}</p>
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
              disabled={!gatePhoto || isCompleting}
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
    </div>
  );
}
