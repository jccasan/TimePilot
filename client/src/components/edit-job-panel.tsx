import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ServicePlan, Property, Contact, Visit, ServicePricingItem } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Loader2 } from "lucide-react";

type TeamMember = { id: string; firstName: string; lastName: string; role: string };

interface EditJobPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  servicePlan: (ServicePlan & { addOns?: unknown[] }) | null;
  property: Property | null;
  contact?: Pick<Contact, "id" | "dogTemperament" | "yardAccess"> | null;
  contactId?: string | null;
  visit?: Visit | null;
  team?: TeamMember[];
  onSaved?: () => void;
  extraInvalidateKeys?: unknown[][];
}

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export function EditJobPanel({
  open,
  onOpenChange,
  servicePlan,
  property,
  contact,
  contactId,
  visit,
  team,
  onSaved,
  extraInvalidateKeys,
}: EditJobPanelProps) {
  const { toast } = useToast();

  const [serviceName, setServiceName] = useState("");
  const [frequency, setFrequency] = useState("weekly");
  const [dayOfWeek, setDayOfWeek] = useState("unassigned");
  const [pricePerVisit, setPricePerVisit] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [visitInstructions, setVisitInstructions] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("none");
  const [timeWindowType, setTimeWindowType] = useState<"anytime" | "morning" | "afternoon" | "specific">("anytime");
  const [scheduledTimeStart, setScheduledTimeStart] = useState("");
  const [scheduledTimeEnd, setScheduledTimeEnd] = useState("");
  const [selectedAddOnIds, setSelectedAddOnIds] = useState<string[]>([]);

  const { data: pricingItems = [] } = useQuery<ServicePricingItem[]>({
    queryKey: ["/api/pricing"],
  });

  const addOnPricing = useMemo(
    () => pricingItems.filter((p) => p.category === "add_on" && p.isActive),
    [pricingItems]
  );

  const [numberOfDogs, setNumberOfDogs] = useState("");
  const [dogNames, setDogNames] = useState("");
  const [dogBreeds, setDogBreeds] = useState("");
  const [dogTemperament, setDogTemperament] = useState("friendly");
  const [yardAccess, setYardAccess] = useState("");
  const [hasDangerousDog, setHasDangerousDog] = useState(false);
  const [dangerousDogNotes, setDangerousDogNotes] = useState("");
  const [gateCode, setGateCode] = useState("");
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [yardSize, setYardSize] = useState("");
  const [yardDifficulty, setYardDifficulty] = useState("flat");

  useEffect(() => {
    if (servicePlan && open) {
      setServiceName(servicePlan.serviceName || "");
      setFrequency(servicePlan.frequency || "weekly");
      setDayOfWeek(servicePlan.dayOfWeek || "unassigned");
      setPricePerVisit(servicePlan.pricePerVisit || "");
      setStartDate(servicePlan.startDate || "");
      setEndDate(servicePlan.endDate || "");
      setVisitInstructions(servicePlan.visitInstructions || "");
      setAssignedUserId(servicePlan.assignedUserId || "none");
      setSelectedAddOnIds(
        (servicePlan.addOns as { servicePricingId: string }[] | undefined)?.map(
          (a) => a.servicePricingId
        ) ?? []
      );
    }
  }, [servicePlan, open]);

  useEffect(() => {
    if (property && open) {
      setNumberOfDogs(property.numberOfDogs != null ? String(property.numberOfDogs) : "");
      setDogNames(property.dogNames || "");
      setDogBreeds(property.dogBreeds || "");
      setHasDangerousDog(property.hasDangerousDog || false);
      setDangerousDogNotes(property.dangerousDogNotes || "");
      setGateCode(property.gateCode || "");
      setSpecialInstructions(property.specialInstructions || "");
      setYardSize(property.yardSize || "");
      setYardDifficulty(property.yardDifficulty || "flat");
    }
  }, [property, open]);

  useEffect(() => {
    if (contact && open) {
      setDogTemperament(contact.dogTemperament || "friendly");
      setYardAccess(contact.yardAccess || "");
    }
  }, [contact, open]);

  useEffect(() => {
    if (visit && open) {
      setTimeWindowType((visit.timeWindowType as "anytime" | "morning" | "afternoon" | "specific") || "anytime");
      setScheduledTimeStart(visit.scheduledTimeStart || "");
      setScheduledTimeEnd(visit.scheduledTimeEnd || "");
    }
  }, [visit, open]);

  const invalidateAll = () => {
    if (contactId) {
      queryClient.invalidateQueries({
        queryKey: ["/api/service-plans" + `?contactId=${contactId}`],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/properties?contactId=${contactId}`],
      });
    }
    if (servicePlan?.id) {
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans", servicePlan.id] });
    }
    if (property?.id) {
      queryClient.invalidateQueries({ queryKey: ["/api/properties", property.id] });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
    queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
    queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    if (contactId) {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
    }
    queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) && (query.queryKey[0] as string)?.startsWith("/api/visits"),
    });
    extraInvalidateKeys?.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!servicePlan?.id) throw new Error("No service plan");
      const addOnsPayload = selectedAddOnIds.map((id) => {
        const item = addOnPricing.find((p) => p.id === id);
        return { servicePricingId: id, name: item?.name || "", price: item?.basePrice || "0" };
      });
      await apiRequest("PATCH", `/api/service-plans/${servicePlan.id}`, {
        serviceName: serviceName || null,
        frequency,
        dayOfWeek: dayOfWeek === "unassigned" ? null : dayOfWeek,
        pricePerVisit,
        startDate: startDate || null,
        endDate: endDate || null,
        visitInstructions: visitInstructions || null,
        assignedUserId: assignedUserId !== "none" ? assignedUserId : null,
        addOns: addOnsPayload,
      });
      if (property?.id) {
        await apiRequest("PATCH", `/api/properties/${property.id}`, {
          numberOfDogs: numberOfDogs !== "" ? parseInt(numberOfDogs) : null,
          dogNames: dogNames || null,
          dogBreeds: dogBreeds || null,
          hasDangerousDog,
          dangerousDogNotes: dangerousDogNotes || null,
          gateCode: gateCode || null,
          specialInstructions: specialInstructions || null,
          yardSize: yardSize || null,
          yardDifficulty: yardDifficulty || "flat",
        });
      }
      if (contact?.id) {
        await apiRequest("PATCH", `/api/contacts/${contact.id}`, {
          dogTemperament: dogTemperament || null,
          yardAccess: yardAccess || null,
        });
      }
      if (visit?.id) {
        await apiRequest("PATCH", `/api/visits/${visit.id}`, {
          timeWindowType,
          scheduledTimeStart: timeWindowType === "specific" ? (scheduledTimeStart || null) : null,
          scheduledTimeEnd: timeWindowType === "specific" ? (scheduledTimeEnd || null) : null,
        });
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Job updated", description: "Service and property details saved." });
      onOpenChange(false);
      onSaved?.();
    },
    onError: (err: Error) => {
      toast({ title: "Error saving", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Job</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Service
            </h3>

            <div className="space-y-1.5">
              <Label>Service Name (optional)</Label>
              <Input
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                placeholder="e.g. Yard Cleanup"
                data-testid="input-edit-job-service-name"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Frequency</Label>
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger data-testid="select-edit-job-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Biweekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="onetime">One-time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Day of Week</Label>
                <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                  <SelectTrigger data-testid="select-edit-job-day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {DAYS.map((d) => (
                      <SelectItem key={d} value={d} className="capitalize">
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Price per Visit ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={pricePerVisit}
                onChange={(e) => setPricePerVisit(e.target.value)}
                data-testid="input-edit-job-price"
              />
            </div>

            {addOnPricing.length > 0 && (
              <div className="space-y-1.5">
                <Label>Add-On Services</Label>
                <div className="border rounded-md divide-y">
                  {addOnPricing.map((addon) => {
                    const checked = selectedAddOnIds.includes(addon.id);
                    return (
                      <label
                        key={addon.id}
                        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40"
                        data-testid={`addon-toggle-${addon.id}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedAddOnIds(
                              checked
                                ? selectedAddOnIds.filter((id) => id !== addon.id)
                                : [...selectedAddOnIds, addon.id]
                            )
                          }
                          className="accent-primary"
                        />
                        <span className="text-sm flex-1">{addon.name}</span>
                        <span className="text-sm text-muted-foreground">+${addon.basePrice}</span>
                      </label>
                    );
                  })}
                </div>
                {selectedAddOnIds.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Total per visit: $
                    {(
                      parseFloat(pricePerVisit || "0") +
                      selectedAddOnIds.reduce((sum, id) => {
                        const item = addOnPricing.find((p) => p.id === id);
                        return sum + parseFloat(item?.basePrice || "0");
                      }, 0)
                    ).toFixed(2)}
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  data-testid="input-edit-job-start-date"
                />
              </div>
              <div className="space-y-1.5">
                <Label>End Date (optional)</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  data-testid="input-edit-job-end-date"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Assigned Technician</Label>
              <Select value={assignedUserId} onValueChange={setAssignedUserId}>
                <SelectTrigger data-testid="select-edit-job-tech">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {team?.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.firstName} {m.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Arrival Window</Label>
              <Select
                value={timeWindowType}
                onValueChange={(v) => setTimeWindowType(v as typeof timeWindowType)}
              >
                <SelectTrigger data-testid="select-edit-job-time-window">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anytime">Anytime</SelectItem>
                  <SelectItem value="morning">Morning (before noon)</SelectItem>
                  <SelectItem value="afternoon">Afternoon (noon–5pm)</SelectItem>
                  <SelectItem value="specific">Specific time range</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {timeWindowType === "specific" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Start Time</Label>
                  <Input
                    type="time"
                    value={scheduledTimeStart}
                    onChange={(e) => setScheduledTimeStart(e.target.value)}
                    data-testid="input-edit-job-time-start"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>End Time</Label>
                  <Input
                    type="time"
                    value={scheduledTimeEnd}
                    onChange={(e) => setScheduledTimeEnd(e.target.value)}
                    data-testid="input-edit-job-time-end"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Visit Instructions</Label>
              <Textarea
                value={visitInstructions}
                onChange={(e) => setVisitInstructions(e.target.value)}
                placeholder="Instructions for the technician..."
                rows={3}
                data-testid="textarea-edit-job-instructions"
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pet & Property Details
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Number of Dogs</Label>
                <Input
                  type="number"
                  min="0"
                  value={numberOfDogs}
                  onChange={(e) => setNumberOfDogs(e.target.value)}
                  data-testid="input-edit-job-dog-count"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Gate Code</Label>
                <Input
                  value={gateCode}
                  onChange={(e) => setGateCode(e.target.value)}
                  placeholder="e.g. 1234#"
                  data-testid="input-edit-job-gate-code"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Dog Names</Label>
              <Input
                value={dogNames}
                onChange={(e) => setDogNames(e.target.value)}
                placeholder="e.g. Buddy, Max"
                data-testid="input-edit-job-dog-names"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Dog Breeds</Label>
              <Input
                value={dogBreeds}
                onChange={(e) => setDogBreeds(e.target.value)}
                placeholder="e.g. Labrador, Poodle"
                data-testid="input-edit-job-dog-breeds"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Dog Temperament</Label>
                <Select value={dogTemperament} onValueChange={setDogTemperament}>
                  <SelectTrigger data-testid="select-edit-job-dog-temperament">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friendly">Friendly</SelectItem>
                    <SelectItem value="anxious">Anxious</SelectItem>
                    <SelectItem value="unpredictable">Unpredictable</SelectItem>
                    <SelectItem value="aggressive">Aggressive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Yard Access</Label>
                <Input
                  value={yardAccess}
                  onChange={(e) => setYardAccess(e.target.value)}
                  placeholder="e.g. side gate, back door"
                  data-testid="input-edit-job-yard-access"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Dangerous Dog</p>
                <p className="text-xs text-muted-foreground">
                  Flag this property as having an aggressive animal
                </p>
              </div>
              <Switch
                checked={hasDangerousDog}
                onCheckedChange={setHasDangerousDog}
                data-testid="switch-edit-job-dangerous-dog"
              />
            </div>

            {hasDangerousDog && (
              <div className="space-y-1.5">
                <Label>Dangerous Dog Notes</Label>
                <Textarea
                  value={dangerousDogNotes}
                  onChange={(e) => setDangerousDogNotes(e.target.value)}
                  placeholder="Describe the risk and any precautions..."
                  rows={2}
                  data-testid="textarea-edit-job-dangerous-dog-notes"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Yard Size</Label>
                <Input
                  value={yardSize}
                  onChange={(e) => setYardSize(e.target.value)}
                  placeholder="e.g. 0.25 acres"
                  data-testid="input-edit-job-yard-size"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Yard Difficulty</Label>
                <Select value={yardDifficulty} onValueChange={setYardDifficulty}>
                  <SelectTrigger data-testid="select-edit-job-yard-difficulty">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flat">Flat</SelectItem>
                    <SelectItem value="moderate">Moderate</SelectItem>
                    <SelectItem value="difficult">Difficult</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Special Instructions</Label>
              <Textarea
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
                placeholder="Access notes, care requirements..."
                rows={2}
                data-testid="textarea-edit-job-special-instructions"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saveMutation.isPending}
            data-testid="button-edit-job-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            data-testid="button-edit-job-save"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
