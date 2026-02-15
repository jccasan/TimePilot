import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Play, CheckCircle, Camera, ChevronDown, ChevronUp, ImageIcon, Loader2 } from "lucide-react";

type TodayVisit = {
  id: string;
  scheduledDate: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  technicianNotes: string | null;
  proofOfServicePhoto: string | null;
  property?: {
    streetAddress: string;
    city: string;
    state: string;
    gateCode: string | null;
    specialInstructions: string | null;
  };
  contact?: {
    firstName: string;
    lastName: string;
  };
};

const visitStatusColors: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  in_progress: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  skipped: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function TechMobile() {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [uploadingVisitId, setUploadingVisitId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingVisitIdRef = useRef<string | null>(null);

  const { data: visits, isLoading } = useQuery<TodayVisit[]>({
    queryKey: ["/api/visits/today"],
  });

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

  const completeMutation = useMutation({
    mutationFn: async (visitId: string) => {
      await apiRequest("PATCH", `/api/visits/${visitId}`, {
        completedAt: new Date().toISOString(),
        status: "completed",
        technicianNotes: notes[visitId] || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/visits/today"] });
      toast({ title: "Visit completed" });
    },
  });

  const handlePhotoClick = (visitId: string) => {
    pendingVisitIdRef.current = visitId;
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const visitId = pendingVisitIdRef.current;
    if (!file || !visitId) return;

    e.target.value = "";

    setUploadingVisitId(visitId);

    try {
      const urlRes = await fetch("/api/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type,
        }),
      });

      if (!urlRes.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = await urlRes.json();

      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!uploadRes.ok) throw new Error("Failed to upload photo");

      await apiRequest("PATCH", `/api/visits/${visitId}`, {
        proofOfServicePhoto: objectPath,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/visits/today"] });
      toast({ title: "Photo uploaded", description: "Proof of service photo saved." });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploadingVisitId(null);
      pendingVisitIdRef.current = null;
    }
  };

  return (
    <div className="p-4 space-y-4 overflow-auto h-full max-w-lg mx-auto">
      <h1 className="text-2xl font-bold" data-testid="text-tech-heading">Today's Visits</h1>

      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={fileInputRef}
        className="hidden"
        onChange={handleFileSelected}
        data-testid="input-photo-file"
      />

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : visits && visits.length > 0 ? (
        <div className="space-y-4">
          {visits.map((visit) => {
            const isExpanded = expandedId === visit.id;
            const isUploading = uploadingVisitId === visit.id;
            return (
              <Card key={visit.id} data-testid={`card-visit-${visit.id}`}>
                <CardHeader
                  className="p-4 pb-2 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : visit.id)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-base" data-testid={`text-visit-address-${visit.id}`}>
                        {visit.property?.streetAddress || "Unknown address"}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground" data-testid={`text-visit-contact-${visit.id}`}>
                        {visit.contact ? `${visit.contact.firstName} ${visit.contact.lastName}` : "Unknown"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {visit.proofOfServicePhoto && (
                        <ImageIcon className="h-4 w-4 text-green-600" />
                      )}
                      <Badge variant="secondary" className={visitStatusColors[visit.status] || ""} data-testid={`badge-visit-status-${visit.id}`}>
                        {visit.status.replace("_", " ")}
                      </Badge>
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </div>
                </CardHeader>
                {isExpanded && (
                  <CardContent className="p-4 pt-0 space-y-3">
                    {visit.property?.gateCode && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Gate Code</p>
                        <p className="text-sm font-mono" data-testid={`text-gate-code-${visit.id}`}>{visit.property.gateCode}</p>
                      </div>
                    )}
                    {visit.property?.specialInstructions && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Instructions</p>
                        <p className="text-sm" data-testid={`text-instructions-${visit.id}`}>{visit.property.specialInstructions}</p>
                      </div>
                    )}

                    {visit.proofOfServicePhoto && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Proof of Service</p>
                        <img
                          src={visit.proofOfServicePhoto}
                          alt="Proof of service"
                          className="rounded-md max-h-48 object-cover"
                          data-testid={`img-proof-${visit.id}`}
                        />
                      </div>
                    )}

                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                      <Textarea
                        value={notes[visit.id] || visit.technicianNotes || ""}
                        onChange={(e) => setNotes({ ...notes, [visit.id]: e.target.value })}
                        placeholder="Add notes..."
                        className="text-sm"
                        data-testid={`input-notes-${visit.id}`}
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {visit.status === "scheduled" && (
                        <Button
                          onClick={() => startMutation.mutate(visit.id)}
                          disabled={startMutation.isPending}
                          className="flex-1"
                          data-testid={`button-start-${visit.id}`}
                        >
                          <Play className="mr-1 h-4 w-4" /> Start
                        </Button>
                      )}
                      {(visit.status === "scheduled" || visit.status === "in_progress") && (
                        <Button
                          onClick={() => completeMutation.mutate(visit.id)}
                          disabled={completeMutation.isPending}
                          variant="outline"
                          className="flex-1"
                          data-testid={`button-complete-${visit.id}`}
                        >
                          <CheckCircle className="mr-1 h-4 w-4" /> Complete
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handlePhotoClick(visit.id)}
                        disabled={isUploading}
                        data-testid={`button-photo-${visit.id}`}
                      >
                        {isUploading ? <Loader2 className="animate-spin" /> : <Camera />}
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-no-visits">
            No visits scheduled for today.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
