import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ChevronLeft,
  ChevronRight,
  Navigation,
  Play,
  CheckCircle2,
  ShieldAlert,
  Dog,
  Key,
  Camera,
  X,
  Loader2,
  MapPin,
  Route,
  ImageIcon,
} from "lucide-react";
import { compressImage } from "@/lib/compress-image";

type TodayVisit = {
  id: string;
  scheduledDate: string;
  status: string;
  enRouteAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  technicianNotes: string | null;
  servicePlanId: string;
  propertyId: string;
  routeId: string | null;
  stopOrder: number;
  routeName: string | null;
  property?: {
    streetAddress: string;
    city: string;
    state: string;
    gateCode: string | null;
    specialInstructions: string | null;
    numberOfDogs: number | null;
    hasDangerousDog: boolean | null;
    dangerousDogNotes: string | null;
  } | null;
  contact?: {
    firstName: string;
    lastName: string;
  } | null;
};

async function uploadFileDirect(file: File): Promise<string> {
  const token = localStorage.getItem("sessionToken");
  const hdrs: Record<string, string> = {};
  if (token) hdrs["Authorization"] = `Bearer ${token}`;
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/uploads/direct", {
    method: "POST",
    credentials: "include",
    headers: hdrs,
    body: fd,
  });
  if (!res.ok) throw new Error("Photo upload failed");
  const data = await res.json();
  return data.objectPath as string;
}

function isIncomplete(v: TodayVisit): boolean {
  return v.status !== "completed" && v.status !== "skipped" && v.status !== "cancelled";
}

type ActionState = "on_my_way" | "start" | "complete" | "done";

function getActionState(v: TodayVisit): ActionState {
  if (!isIncomplete(v)) return "done";
  if (v.status === "in_progress") return "complete";
  if (v.enRouteAt) return "start";
  return "on_my_way";
}

export default function FieldView() {
  const { toast } = useToast();

  const { data: rawVisits, isLoading } = useQuery<TodayVisit[]>({
    queryKey: ["/api/visits/today"],
  });

  const visits = useMemo(() => {
    if (!rawVisits) return rawVisits;
    return [...rawVisits].sort((a, b) => (a.stopOrder ?? 999) - (b.stopOrder ?? 999));
  }, [rawVisits]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [gateExpanded, setGateExpanded] = useState<Record<string, boolean>>({});

  const [completionVisitId, setCompletionVisitId] = useState<string | null>(null);
  const [gatePhoto, setGatePhoto] = useState<File | null>(null);
  const [gatePhotoPreview, setGatePhotoPreview] = useState<string | null>(null);
  const [extraFiles, setExtraFiles] = useState<{ file: File; preview: string }[]>([]);
  const [noGate, setNoGate] = useState(false);
  const [techNotes, setTechNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [onMyWaySending, setOnMyWaySending] = useState<string | null>(null);
  const [onMyWayCooldowns, setOnMyWayCooldowns] = useState<Record<string, number>>({});
  const [startingId, setStartingId] = useState<string | null>(null);

  const gateInputRef = useRef<HTMLInputElement>(null);
  const extraInputRef = useRef<HTMLInputElement>(null);
  const pendingAdvanceRef = useRef<string | null>(null);
  const initialIndexSet = useRef(false);

  useEffect(() => {
    if (initialIndexSet.current || !visits || visits.length === 0) return;
    initialIndexSet.current = true;
    const idx = visits.findIndex(isIncomplete);
    if (idx >= 0) setActiveIndex(idx);
  }, [visits]);

  useEffect(() => {
    if (!visits || !pendingAdvanceRef.current) return;
    const completedId = pendingAdvanceRef.current;
    const completedIdx = visits.findIndex((v) => v.id === completedId);
    if (completedIdx < 0) return;
    if (isIncomplete(visits[completedIdx])) return;
    pendingAdvanceRef.current = null;
    const nextIdx = visits.findIndex((v, i) => i > completedIdx && isIncomplete(v));
    if (nextIdx >= 0) setActiveIndex(nextIdx);
  }, [visits]);

  const handleOnMyWay = (visit: TodayVisit) => {
    if (onMyWayCooldowns[visit.id] && Date.now() < onMyWayCooldowns[visit.id]) {
      toast({ title: "SMS already sent", description: "Please wait before sending another." });
      return;
    }
    setOnMyWaySending(visit.id);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await apiRequest("POST", `/api/visits/${visit.id}/on-my-way`, {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          const data = await res.json();
          setOnMyWayCooldowns((prev) => ({ ...prev, [visit.id]: Date.now() + 5 * 60 * 1000 }));
          queryClient.invalidateQueries({ queryKey: ["/api/visits/today"] });
          toast({
            title: "On-my-way SMS sent",
            description: `${data.contactName} notified — ETA ~${data.etaMinutes} min`,
          });
        } catch (err) {
          toast({
            title: "Failed to send SMS",
            description: err instanceof Error ? err.message : "Unknown error",
            variant: "destructive",
          });
        } finally {
          setOnMyWaySending(null);
        }
      },
      (geoErr) => {
        setOnMyWaySending(null);
        toast({
          title: "Location unavailable",
          description: geoErr.message || "Could not get your location",
          variant: "destructive",
        });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleStartVisit = async (visit: TodayVisit) => {
    setStartingId(visit.id);
    try {
      await apiRequest("POST", `/api/visits/${visit.id}/start`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/visits/today"] });
      toast({ title: "Visit started" });
    } catch (err) {
      toast({
        title: "Failed to start visit",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setStartingId(null);
    }
  };

  const openCompletion = (visitId: string) => {
    setCompletionVisitId(visitId);
    setGatePhoto(null);
    setGatePhotoPreview(null);
    setExtraFiles([]);
    setNoGate(false);
    setTechNotes("");
    setIsSubmitting(false);
  };

  const handleGatePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const compressed = await compressImage(file);
    setGatePhoto(compressed);
    const reader = new FileReader();
    reader.onload = () => setGatePhotoPreview(reader.result as string);
    reader.readAsDataURL(compressed);
  };

  const handleExtraPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || extraFiles.length >= 3) return;
    e.target.value = "";
    const compressed = await compressImage(file);
    const reader = new FileReader();
    reader.onload = () => {
      setExtraFiles((prev) => [...prev, { file: compressed, preview: reader.result as string }]);
    };
    reader.readAsDataURL(compressed);
  };

  const handleSubmitComplete = async () => {
    if (!completionVisitId) return;
    if (!noGate && !gatePhoto) {
      toast({
        title: "Photo required",
        description: "Add a gate closed photo or check 'No Gate'.",
        variant: "destructive",
      });
      return;
    }
    setIsSubmitting(true);
    try {
      let gatePath: string | undefined;
      if (gatePhoto && !noGate) {
        gatePath = await uploadFileDirect(gatePhoto);
      }
      const extraPaths: string[] = [];
      for (const ef of extraFiles) {
        const p = await uploadFileDirect(ef.file);
        extraPaths.push(p);
      }
      await apiRequest("POST", `/api/visits/${completionVisitId}/complete-notify`, {
        gateClosedPhoto: gatePath,
        extraPhotos: extraPaths.length > 0 ? extraPaths : undefined,
        technicianNotes: techNotes.trim() || undefined,
        noGate,
      });
      pendingAdvanceRef.current = completionVisitId;
      queryClient.invalidateQueries({ queryKey: ["/api/visits/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/uninvoiced-summary"] });
      setCompletionVisitId(null);
      toast({ title: "Visit completed", description: "Customer has been notified." });
    } catch (err) {
      toast({
        title: "Completion failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-4 space-y-3" data-testid="field-view-loading">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  if (!visits || visits.length === 0) return null;

  const totalStops = visits.length;
  const completedCount = visits.filter((v) => !isIncomplete(v)).length;
  const allDone = completedCount === totalStops;
  const clampedIndex = Math.min(activeIndex, visits.length - 1);
  const current = visits[clampedIndex];
  const prop = current?.property;
  const contact = current?.contact;
  const actionState = current ? getActionState(current) : "done";
  const hasGateInfo = prop && (prop.gateCode || prop.specialInstructions);
  const gateOpen = current ? (gateExpanded[current.id] ?? false) : false;
  const completionVisit = visits.find((v) => v.id === completionVisitId) ?? null;

  return (
    <>
      <div className="rounded-xl border bg-card overflow-hidden" data-testid="field-view">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-primary/10 border-b">
          <div className="flex items-center gap-2">
            <Route className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-semibold text-primary">
              Today&apos;s Route &mdash; {totalStops} stop{totalStops !== 1 ? "s" : ""}
            </span>
          </div>
          <span
            className="text-xs text-muted-foreground font-medium"
            data-testid="text-route-progress"
          >
            {allDone ? "Route complete" : `${completedCount} of ${totalStops} done`}
          </span>
        </div>

        {allDone ? (
          <div
            className="flex flex-col items-center gap-2 py-10 text-center px-4"
            data-testid="field-view-complete"
          >
            <CheckCircle2 className="h-10 w-10 text-green-600" />
            <p className="font-semibold text-lg">Route complete</p>
            <p className="text-sm text-muted-foreground">
              All {totalStops} stop{totalStops !== 1 ? "s" : ""} finished for today.
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {/* Carousel nav */}
            <div className="flex items-center justify-between">
              <button
                className="h-10 w-10 flex items-center justify-center rounded-full border bg-background hover:bg-muted disabled:opacity-30 transition-colors"
                onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                disabled={clampedIndex === 0}
                aria-label="Previous stop"
                data-testid="button-prev-stop"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span
                className="text-sm font-medium text-muted-foreground"
                data-testid="text-stop-index"
              >
                Stop {clampedIndex + 1} of {totalStops}
              </span>
              <button
                className="h-10 w-10 flex items-center justify-center rounded-full border bg-background hover:bg-muted disabled:opacity-30 transition-colors"
                onClick={() => setActiveIndex((i) => Math.min(visits.length - 1, i + 1))}
                disabled={clampedIndex >= visits.length - 1}
                aria-label="Next stop"
                data-testid="button-next-stop"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {current && (
              <div className="space-y-3" data-testid={`stop-card-${current.id}`}>
                {/* Status badge + dangerous dog indicator */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <Badge
                    variant="secondary"
                    className={
                      current.status === "completed"
                        ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                        : current.status === "in_progress"
                          ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                          : current.status === "skipped"
                            ? "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
                            : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                    }
                    data-testid={`badge-status-${current.id}`}
                  >
                    {current.status === "in_progress"
                      ? "In Progress"
                      : current.status === "completed"
                        ? "Completed"
                        : current.status === "skipped"
                          ? "Skipped"
                          : "Scheduled"}
                  </Badge>
                  {prop?.hasDangerousDog && (
                    <div
                      className="flex items-center gap-1 text-red-600"
                      data-testid={`alert-dangerous-dog-${current.id}`}
                    >
                      <ShieldAlert className="h-4 w-4" />
                      <span className="text-xs font-semibold">Dangerous Dog</span>
                    </div>
                  )}
                </div>

                {/* Client name + address — large readable text */}
                <div>
                  <p
                    className="text-2xl font-bold leading-tight"
                    data-testid={`text-client-name-${current.id}`}
                  >
                    {contact ? `${contact.firstName} ${contact.lastName}` : "Unknown Client"}
                  </p>
                  {prop && (
                    <div className="flex items-start gap-1.5 mt-1">
                      <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <p
                        className="text-base text-muted-foreground leading-snug"
                        data-testid={`text-address-${current.id}`}
                      >
                        {prop.streetAddress}, {prop.city}, {prop.state}
                      </p>
                    </div>
                  )}
                </div>

                {/* Dog count */}
                {prop?.numberOfDogs != null && (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Dog className="h-4 w-4 shrink-0" />
                    <span data-testid={`text-dogs-${current.id}`}>
                      {prop.numberOfDogs} {prop.numberOfDogs === 1 ? "dog" : "dogs"}
                    </span>
                  </div>
                )}

                {/* Dangerous dog notes */}
                {prop?.hasDangerousDog && prop.dangerousDogNotes && (
                  <div
                    className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2"
                    data-testid={`alert-dog-notes-${current.id}`}
                  >
                    <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide mb-0.5">
                      Dangerous Dog
                    </p>
                    <p className="text-sm text-red-700 dark:text-red-300">
                      {prop.dangerousDogNotes}
                    </p>
                  </div>
                )}

                {/* Gate info — collapsed by default, one tap to expand */}
                {hasGateInfo && (
                  <div>
                    <button
                      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
                      onClick={() =>
                        setGateExpanded((prev) => ({ ...prev, [current.id]: !gateOpen }))
                      }
                      data-testid={`button-gate-toggle-${current.id}`}
                    >
                      <Key className="h-3.5 w-3.5" />
                      {gateOpen ? "Hide gate info" : "Show gate info"}
                      <ChevronRight
                        className={`h-3.5 w-3.5 transition-transform ${gateOpen ? "rotate-90" : ""}`}
                      />
                    </button>
                    {gateOpen && (
                      <div
                        className="mt-1.5 rounded-lg border bg-muted/40 px-3 py-2.5 space-y-2"
                        data-testid={`panel-gate-${current.id}`}
                      >
                        {prop?.gateCode && (
                          <div>
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                              Gate Code
                            </p>
                            <p
                              className="text-2xl font-mono font-bold tracking-wider mt-0.5"
                              data-testid={`text-gate-code-${current.id}`}
                            >
                              {prop.gateCode}
                            </p>
                          </div>
                        )}
                        {prop?.specialInstructions && (
                          <div>
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                              Instructions
                            </p>
                            <p
                              className="text-sm mt-0.5"
                              data-testid={`text-special-instructions-${current.id}`}
                            >
                              {prop.specialInstructions}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Status-driven action button */}
                <div className="pt-1">
                  {actionState === "on_my_way" && (
                    <Button
                      className="w-full h-12 text-base gap-2"
                      onClick={() => handleOnMyWay(current)}
                      disabled={onMyWaySending === current.id}
                      data-testid={`button-on-my-way-${current.id}`}
                    >
                      {onMyWaySending === current.id ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Navigation className="h-5 w-5" />
                      )}
                      {onMyWaySending === current.id ? "Sending SMS…" : "On My Way"}
                    </Button>
                  )}

                  {actionState === "start" && (
                    <Button
                      className="w-full h-12 text-base gap-2"
                      onClick={() => handleStartVisit(current)}
                      disabled={startingId === current.id}
                      data-testid={`button-start-visit-${current.id}`}
                    >
                      {startingId === current.id ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Play className="h-5 w-5" />
                      )}
                      {startingId === current.id ? "Starting…" : "Start Visit"}
                    </Button>
                  )}

                  {actionState === "complete" && (
                    <Button
                      className="w-full h-12 text-base gap-2 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600"
                      onClick={() => openCompletion(current.id)}
                      data-testid={`button-complete-visit-${current.id}`}
                    >
                      <CheckCircle2 className="h-5 w-5" />
                      Complete Visit
                    </Button>
                  )}

                  {actionState === "done" && (
                    <div
                      className="flex items-center justify-center gap-2 h-12 text-sm text-green-600 font-medium"
                      data-testid={`indicator-done-${current.id}`}
                    >
                      <CheckCircle2 className="h-5 w-5" />
                      Done
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Inline completion dialog — opens directly from the Complete button */}
      <Dialog
        open={completionVisitId !== null}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) setCompletionVisitId(null);
        }}
      >
        <DialogContent className="max-w-sm w-full sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Complete Visit</DialogTitle>
            <DialogDescription>
              {completionVisit?.contact
                ? `${completionVisit.contact.firstName} ${completionVisit.contact.lastName}`
                : "Visit"}
              {completionVisit?.property ? ` — ${completionVisit.property.streetAddress}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Gate closed photo */}
            <div>
              <p className="text-sm font-medium mb-2">Gate closed photo</p>
              {gatePhotoPreview ? (
                <div className="relative">
                  <img
                    src={gatePhotoPreview}
                    alt="Gate closed"
                    className="w-full h-36 object-cover rounded-lg border"
                    data-testid="img-gate-preview"
                  />
                  <button
                    className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1 text-white hover:bg-black/80 transition-colors"
                    onClick={() => {
                      setGatePhoto(null);
                      setGatePhotoPreview(null);
                    }}
                    aria-label="Remove photo"
                    data-testid="button-remove-gate-photo"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                !noGate && (
                  <button
                    className="w-full h-28 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1.5 hover:border-primary/50 hover:bg-muted/30 transition-colors"
                    onClick={() => gateInputRef.current?.click()}
                    data-testid="button-add-gate-photo"
                  >
                    <Camera className="h-6 w-6 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Take or choose photo</span>
                  </button>
                )
              )}
              <input
                ref={gateInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleGatePhoto}
                data-testid="input-gate-photo"
              />
              <div className="flex items-center gap-2 mt-2">
                <Checkbox
                  id="fv-no-gate"
                  checked={noGate}
                  onCheckedChange={(v) => {
                    setNoGate(!!v);
                    if (v) {
                      setGatePhoto(null);
                      setGatePhotoPreview(null);
                    }
                  }}
                  data-testid="checkbox-no-gate"
                />
                <Label htmlFor="fv-no-gate" className="text-sm cursor-pointer select-none">
                  No gate — photo not needed
                </Label>
              </div>
            </div>

            {/* Extra photos */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">Extra photos</p>
                <span className="text-xs text-muted-foreground">{extraFiles.length} / 3</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {extraFiles.map((ef, i) => (
                  <div key={i} className="relative">
                    <img
                      src={ef.preview}
                      alt={`Extra ${i + 1}`}
                      className="h-16 w-16 object-cover rounded-lg border"
                      data-testid={`img-extra-${i}`}
                    />
                    <button
                      className="absolute -top-1 -right-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80 transition-colors"
                      onClick={() => setExtraFiles((prev) => prev.filter((_, j) => j !== i))}
                      aria-label="Remove extra photo"
                      data-testid={`button-remove-extra-${i}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {extraFiles.length < 3 && (
                  <button
                    className="h-16 w-16 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center hover:border-primary/50 hover:bg-muted/30 transition-colors"
                    onClick={() => extraInputRef.current?.click()}
                    data-testid="button-add-extra-photo"
                  >
                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                  </button>
                )}
              </div>
              <input
                ref={extraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleExtraPhoto}
                data-testid="input-extra-photo"
              />
            </div>

            {/* Technician notes */}
            <div>
              <p className="text-sm font-medium mb-2">Notes (optional)</p>
              <Textarea
                placeholder="Leave a note for the customer or your team…"
                value={techNotes}
                onChange={(e) => setTechNotes(e.target.value)}
                rows={2}
                className="resize-none"
                data-testid="textarea-tech-notes"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setCompletionVisitId(null)}
              disabled={isSubmitting}
              data-testid="button-cancel-complete"
            >
              Cancel
            </Button>
            <Button
              className="w-full sm:w-auto bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 gap-1.5"
              onClick={handleSubmitComplete}
              disabled={isSubmitting || (!noGate && !gatePhoto)}
              data-testid="button-submit-complete"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {isSubmitting ? "Completing…" : "Mark Complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
