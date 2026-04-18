import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toLocalDateString } from "@/lib/utils";
import { useCompanyTimezone } from "@/hooks/use-company-timezone";
import { useToast } from "@/hooks/use-toast";
import type { Visit, Contact, Property, Route, ServicePricingItem, ServicePlan } from "@shared/schema";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  ChevronLeft, ChevronRight, Plus, Calendar, CalendarDays, CalendarRange,
  CheckCircle, XCircle, Ban, Clock, MapPin, DollarSign, User, CalendarCheck, Loader2, GripVertical,
  Send, MessageSquare, Trash2, Search, Eye, EyeOff, Pencil,
} from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { ClientInfoPopover } from "@/components/client-info-popover";
import { GenerateInvoiceDialog } from "@/components/generate-invoice-dialog";
import {
  DndContext, DragOverlay, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, useDroppable, useDraggable,
  type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from "@dnd-kit/core";

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

const daysOfWeek = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type ViewMode = "day" | "week" | "month";

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(date: Date, timezone?: string): string {
  return toLocalDateString(date, timezone);
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function getCalendarDays(date: Date): Date[] {
  const monthStart = getMonthStart(date);
  const monthEnd = getMonthEnd(date);
  const calStart = getWeekStart(monthStart);
  const days: Date[] = [];
  const current = new Date(calStart);
  while (current <= monthEnd || days.length % 7 !== 0) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

type TeamMember = {
  id: string;
  role: string;
  firstName: string;
  lastName: string;
  email: string;
};

interface JobFormPayload {
  contactId: string;
  propertyId: string;
  serviceName: string | null;
  jobType: string;
  frequency: string;
  dayOfWeek: string | null;
  pricePerVisit: string;
  startDate: string;
  startTime: string | null;
  endTime: string | null;
  anytime: boolean;
  visitInstructions: string | null;
  assignedUserId: string | null;
  endsAfterCount?: number | null;
  endsAfterUnit?: string | null;
  endDate?: string | null;
}

const frequencyLabels: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 Weeks",
  monthly: "Monthly",
  onetime: "One-Time",
};

const dayOfWeekLabels: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

function ScheduleJobForm({
  onSubmit,
  isPending,
  contacts,
  properties,
  team,
  services,
  initialContactId,
  initialFrequency,
  initialDayOfWeek,
}: {
  onSubmit: (data: JobFormPayload) => void;
  isPending: boolean;
  contacts: Contact[];
  properties: Property[];
  team: TeamMember[];
  services: ServicePricingItem[];
  initialContactId?: string | null;
  initialFrequency?: string | null;
  initialDayOfWeek?: string | null;
}) {
  const tz = useCompanyTimezone();
  const [jobType, setJobType] = useState<string>("recurring");
  const [contactId, setContactId] = useState(initialContactId || "");
  const [propertyId, setPropertyId] = useState("");
  const [selectedServices, setSelectedServices] = useState<Array<{ id: string; name: string; price: string }>>([]);
  const [addServiceId, setAddServiceId] = useState("");
  const [frequency, setFrequency] = useState(initialFrequency || "weekly");
  const [dayOfWeek, setDayOfWeek] = useState(initialDayOfWeek || "");
  const [pricePerVisit, setPricePerVisit] = useState("");
  const [manualServiceName, setManualServiceName] = useState("");
  const [startDate, setStartDate] = useState(toLocalDateString(new Date(), tz));
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [anytime, setAnytime] = useState(true);
  const [endsAfterMode, setEndsAfterMode] = useState<"none" | "count" | "date">("none");
  const [endsAfterCount, setEndsAfterCount] = useState("");
  const [endsAfterUnit, setEndsAfterUnit] = useState("months");
  const [endDate, setEndDate] = useState("");
  const [visitInstructions, setVisitInstructions] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");

  const activeServices = useMemo(() => services.filter(s => s.isActive), [services]);

  const filteredProperties = useMemo(() => {
    if (!contactId) return [];
    return properties.filter(p => p.contactId === contactId);
  }, [contactId, properties]);

  const totalPrice = useMemo(() => {
    if (selectedServices.length === 0) return pricePerVisit;
    const sum = selectedServices.reduce((acc, s) => acc + parseFloat(s.price || "0"), 0);
    return sum > 0 ? sum.toFixed(2) : pricePerVisit;
  }, [selectedServices, pricePerVisit]);

  const combinedServiceName = useMemo(() => {
    if (selectedServices.length === 0) return manualServiceName || null;
    return selectedServices.map(s => s.name).join(" + ");
  }, [selectedServices, manualServiceName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: JobFormPayload = {
      contactId,
      propertyId,
      serviceName: combinedServiceName,
      jobType,
      frequency: jobType === "one_off" ? "onetime" : frequency,
      dayOfWeek: dayOfWeek || null,
      pricePerVisit: totalPrice || "0",
      startDate,
      startTime: anytime ? null : (startTime || null),
      endTime: anytime ? null : (endTime || null),
      anytime,
      visitInstructions: visitInstructions || null,
      assignedUserId: (assignedUserId && assignedUserId !== "none") ? assignedUserId : null,
    };
    if (jobType === "recurring") {
      if (endsAfterMode === "count" && endsAfterCount) {
        payload.endsAfterCount = parseInt(endsAfterCount);
        payload.endsAfterUnit = endsAfterUnit;
        payload.endDate = null;
      } else if (endsAfterMode === "date" && endDate) {
        payload.endDate = endDate;
        payload.endsAfterCount = null;
        payload.endsAfterUnit = null;
      } else {
        payload.endsAfterCount = null;
        payload.endsAfterUnit = null;
        payload.endDate = null;
      }
    } else {
      payload.endsAfterCount = null;
      payload.endsAfterUnit = null;
      payload.endDate = null;
    }
    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <Label className="text-sm font-semibold">Job Type</Label>
        <div className="flex gap-2 mt-1.5">
          <Button type="button" variant={jobType === "one_off" ? "default" : "outline"} size="sm" onClick={() => { setJobType("one_off"); setFrequency("onetime"); }} data-testid="button-job-type-one-off">One-off</Button>
          <Button type="button" variant={jobType === "recurring" ? "default" : "outline"} size="sm" onClick={() => { setJobType("recurring"); setFrequency("weekly"); }} data-testid="button-job-type-recurring">Recurring</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Customer</Label>
          <Select value={contactId} onValueChange={(v) => { setContactId(v); setPropertyId(""); }}>
            <SelectTrigger data-testid="select-job-contact"><SelectValue placeholder="Select customer" /></SelectTrigger>
            <SelectContent>{contacts.map(c => (<SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>))}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Property</Label>
          <Select value={propertyId} onValueChange={setPropertyId} disabled={!contactId}>
            <SelectTrigger data-testid="select-job-property"><SelectValue placeholder={contactId ? "Select property" : "Select customer first"} /></SelectTrigger>
            <SelectContent>{filteredProperties.map(p => (<SelectItem key={p.id} value={p.id}>{p.streetAddress}</SelectItem>))}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        <Label>Services</Label>
        {selectedServices.length > 0 && (
          <div className="space-y-2">
            {selectedServices.map((svc, idx) => (
              <div key={svc.id + idx} className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2" data-testid={`service-row-${idx}`}>
                <span className="text-sm font-medium">{svc.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">${parseFloat(svc.price || "0").toFixed(2)}</span>
                  <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setSelectedServices(prev => prev.filter((_, i) => i !== idx))} data-testid={`button-remove-service-${idx}`}>
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {activeServices.length > 0 ? (
          <div className="flex gap-2">
            <Select value={addServiceId} onValueChange={setAddServiceId}>
              <SelectTrigger className="flex-1" data-testid="select-job-service"><SelectValue placeholder="Add a service..." /></SelectTrigger>
              <SelectContent>{activeServices.map(s => (<SelectItem key={s.id} value={s.id}>{s.name} — ${parseFloat(s.basePrice).toFixed(2)}</SelectItem>))}</SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" disabled={!addServiceId} onClick={() => { const svc = activeServices.find(s => s.id === addServiceId); if (svc) { setSelectedServices(prev => [...prev, { id: svc.id, name: svc.name, price: svc.basePrice }]); setAddServiceId(""); } }} data-testid="button-add-service">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Input value={manualServiceName} onChange={e => setManualServiceName(e.target.value)} placeholder="Service name (e.g. Waste Removal)" data-testid="input-job-service-name" />
            <Input type="number" min="0" step="0.01" value={pricePerVisit} onChange={e => setPricePerVisit(e.target.value)} placeholder="Price per visit (e.g. 35.00)" data-testid="input-job-price-manual" />
          </div>
        )}
        <div className="flex items-center justify-between pt-1">
          <Label className="text-sm">Total per Visit</Label>
          <span className="text-sm font-semibold" data-testid="text-total-price">${(parseFloat(totalPrice) || 0).toFixed(2)}</span>
        </div>
      </div>

      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold mb-3">Schedule</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Start Date</Label>
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} data-testid="input-job-start-date" />
          </div>
          {!anytime && (
            <>
              <div className="space-y-1.5">
                <Label>Start Time</Label>
                <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} data-testid="input-job-start-time" />
              </div>
              <div className="space-y-1.5">
                <Label>End Time</Label>
                <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} data-testid="input-job-end-time" />
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <Checkbox id="anytime" checked={anytime} onCheckedChange={(checked) => setAnytime(!!checked)} data-testid="checkbox-job-anytime" />
          <Label htmlFor="anytime" className="text-sm cursor-pointer">Anytime</Label>
        </div>
      </div>

      {jobType === "recurring" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Repeats</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger data-testid="select-job-frequency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Every 2 Weeks</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {frequency !== "monthly" && (
              <div className="space-y-1.5">
                <Label>Day of Week</Label>
                <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                  <SelectTrigger data-testid="select-job-day"><SelectValue placeholder="Select day" /></SelectTrigger>
                  <SelectContent>{Object.entries(dayOfWeekLabels).map(([val, label]) => (<SelectItem key={val} value={val}>{label}</SelectItem>))}</SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <Label className="text-sm font-semibold">End Condition</Label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="endsAfterMode" checked={endsAfterMode === "none"} onChange={() => setEndsAfterMode("none")} className="accent-primary" data-testid="radio-ends-never" />
                <span className="text-sm">No end date</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="endsAfterMode" checked={endsAfterMode === "count"} onChange={() => setEndsAfterMode("count")} className="accent-primary" data-testid="radio-ends-after" />
                <span className="text-sm">Ends after</span>
              </label>
              {endsAfterMode === "count" && (
                <div className="flex gap-2 ml-6">
                  <Input type="number" min="1" value={endsAfterCount} onChange={e => setEndsAfterCount(e.target.value)} className="w-20" data-testid="input-ends-after-count" />
                  <Select value={endsAfterUnit} onValueChange={setEndsAfterUnit}>
                    <SelectTrigger className="w-32" data-testid="select-ends-after-unit"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="days">Days</SelectItem>
                      <SelectItem value="weeks">Weeks</SelectItem>
                      <SelectItem value="months">Months</SelectItem>
                      <SelectItem value="years">Years</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="endsAfterMode" checked={endsAfterMode === "date"} onChange={() => setEndsAfterMode("date")} className="accent-primary" data-testid="radio-ends-on" />
                <span className="text-sm">Ends on</span>
              </label>
              {endsAfterMode === "date" && (
                <div className="ml-6">
                  <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} data-testid="input-ends-on-date" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Assigned Team Member</Label>
        <Select value={assignedUserId} onValueChange={setAssignedUserId}>
          <SelectTrigger data-testid="select-job-assigned"><SelectValue placeholder="Select team member (optional)" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Unassigned</SelectItem>
            {team.map(t => (<SelectItem key={t.id} value={t.id}>{t.firstName} {t.lastName}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Visit Instructions</Label>
        <Textarea value={visitInstructions} onChange={e => setVisitInstructions(e.target.value)} placeholder="Instructions for technician..." rows={3} data-testid="input-job-instructions" />
      </div>

      <DialogFooter>
        <Button type="submit" disabled={isPending || !contactId || !propertyId} data-testid="button-submit-job">
          {isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Creating...</> : "Create Job"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export default function Scheduling() {
  const tz = useCompanyTimezone();
  const { toast } = useToast();
  const { user: authUser } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("scoopilot_sched_view_mode");
    return (saved === "week" || saved === "day" || saved === "month") ? saved : "week";
  });
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prefilledContactId, setPrefilledContactId] = useState<string | null>(null);
  const [prefilledFrequency, setPrefilledFrequency] = useState<string | null>(null);
  const [prefilledDayOfWeek, setPrefilledDayOfWeek] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState("");
  const [showHiddenStatuses, setShowHiddenStatuses] = useState(() =>
    localStorage.getItem("scoopilot_sched_show_hidden") === "true"
  );
  const [pendingVisitId, setPendingVisitId] = useState<string | null>(null);
  const isAdminOrOwner = authUser?.role === "owner" || authUser?.role === "admin";

  const frequencyFromContactDialog: Record<string, string | null> = {
    "1_per_week": "weekly",
    "2_per_week": "weekly",
    "biweekly": "biweekly",
    "as_needed": null,
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("addJob") === "1") {
      const cid = params.get("contactId") || null;
      setPrefilledContactId(cid);
      const rawFreq = params.get("frequency") || "";
      const mappedFreq = frequencyFromContactDialog[rawFreq] || null;
      setPrefilledFrequency(mappedFreq);
      const day = params.get("serviceDay") || null;
      setPrefilledDayOfWeek(day);
      setDialogOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
    const vid = params.get("visitId");
    const dateParam = params.get("date");
    if (vid) {
      setPendingVisitId(vid);
      if (dateParam) {
        const parsed = new Date(dateParam + "T12:00:00");
        if (!isNaN(parsed.getTime())) {
          setCurrentDate(parsed);
          setViewMode("day");
        }
      }
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    try { localStorage.setItem("scoopilot_sched_view_mode", viewMode); } catch {}
  }, [viewMode]);

  useEffect(() => {
    try { localStorage.setItem("scoopilot_sched_show_hidden", String(showHiddenStatuses)); } catch {}
  }, [showHiddenStatuses]);

  const dateRange = useMemo(() => {
    const d = new Date(currentDate);
    d.setHours(0, 0, 0, 0);
    if (viewMode === "day") {
      return { start: d, end: d };
    } else if (viewMode === "week") {
      const ws = getWeekStart(d);
      const we = new Date(ws);
      we.setDate(we.getDate() + 6);
      return { start: ws, end: we };
    } else {
      const calDays = getCalendarDays(d);
      return { start: calDays[0], end: calDays[calDays.length - 1] };
    }
  }, [viewMode, currentDate]);

  const startStr = formatDate(dateRange.start, tz);
  const endStr = formatDate(dateRange.end, tz);

  const { data: visits, isLoading } = useQuery<Visit[]>({
    queryKey: [`/api/visits/range?start=${startStr}&end=${endStr}`],
  });

  const { data: contacts } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: properties } = useQuery<Property[]>({ queryKey: ["/api/properties"] });
  const { data: routes } = useQuery<Route[]>({ queryKey: ["/api/routes"] });
  const { data: servicePlans } = useQuery<ServicePlan[]>({ queryKey: ["/api/service-plans"] });
  const { data: pricingItems } = useQuery<ServicePricingItem[]>({ queryKey: ["/api/pricing"] });
  const { data: team } = useQuery<TeamMember[]>({ queryKey: ["/api/company/team"] });

  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [invoiceDialogContactId, setInvoiceDialogContactId] = useState<string | undefined>(undefined);
  const handleShowInvoiceDialog = useCallback((contactId?: string) => {
    setInvoiceDialogContactId(contactId);
    setShowInvoiceDialog(true);
  }, []);

  useEffect(() => {
    if (pendingVisitId && visits) {
      const found = visits.find(v => v.id === pendingVisitId);
      if (found) {
        setSelectedVisit(found);
        setPendingVisitId(null);
      }
    }
  }, [pendingVisitId, visits]);

  const [quickAddDate, setQuickAddDate] = useState<string | null>(null);
  const [quickAddPlanId, setQuickAddPlanId] = useState("");
  const [quickAddRouteId, setQuickAddRouteId] = useState("");

  const createMutation = useMutation({
    mutationFn: async (data: JobFormPayload) => { await apiRequest("POST", "/api/jobs", data); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && (query.queryKey[0] as string)?.startsWith("/api/visits") });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && (query.queryKey[0] as string)?.startsWith("/api/service-plans?contactId=") });
      toast({ title: "Job created", description: "Visits have been auto-generated." });
      setDialogOpen(false);
    },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const quickAddMutation = useMutation({
    mutationFn: async ({ servicePlanId, scheduledDate, routeId }: { servicePlanId: string; scheduledDate: string; routeId?: string }) => {
      const plan = servicePlans?.find((sp) => sp.id === servicePlanId);
      if (!plan) throw new Error("Job not found");
      const body: any = { servicePlanId, propertyId: plan.propertyId, scheduledDate, status: "scheduled" };
      if (routeId) body.routeId = routeId;
      await apiRequest("POST", "/api/visits", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/visits/range?start=${startStr}&end=${endStr}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/visits/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      toast({ title: "Visit added", description: `Visit scheduled for ${quickAddDate}.` });
      setQuickAddDate(null);
      setQuickAddPlanId("");
      setQuickAddRouteId("");
    },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const activeServicePlans = useMemo(() => {
    if (!servicePlans) return [];
    return servicePlans.filter((sp) => sp.status === "active");
  }, [servicePlans]);

  const [activeVisit, setActiveVisit] = useState<Visit | null>(null);
  const [overDateKey, setOverDateKey] = useState<string | null>(null);

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 5 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } });
  const sensors = useSensors(pointerSensor, touchSensor);

  const rescheduleMutation = useMutation({
    mutationFn: async ({ visitId, scheduledDate }: { visitId: string; scheduledDate: string }) => {
      await apiRequest("PATCH", `/api/visits/${visitId}`, { scheduledDate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/visits/range?start=${startStr}&end=${endStr}`] });
      toast({ title: "Visit rescheduled" });
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: [`/api/visits/range?start=${startStr}&end=${endStr}`] });
      toast({ title: "Error rescheduling", description: err.message, variant: "destructive" });
    },
  });

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const visit = event.active.data.current?.visit as Visit | undefined;
    if (visit) setActiveVisit(visit);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over?.id as string | undefined;
    setOverDateKey(overId && overId.startsWith("drop-day-") ? overId.replace("drop-day-", "") : null);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveVisit(null);
    setOverDateKey(null);
    const visit = event.active.data.current?.visit as Visit | undefined;
    const overId = event.over?.id as string | undefined;
    if (!visit || !overId || !overId.startsWith("drop-day-")) return;
    const newDate = overId.replace("drop-day-", "");
    if (newDate === visit.scheduledDate) return;
    queryClient.setQueryData<Visit[]>(
      [`/api/visits/range?start=${startStr}&end=${endStr}`],
      (old) => old?.map((v) => v.id === visit.id ? { ...v, scheduledDate: newDate } : v)
    );
    rescheduleMutation.mutate({ visitId: visit.id, scheduledDate: newDate });
  }, [startStr, endStr, rescheduleMutation]);

  const handleDragCancel = useCallback(() => {
    setActiveVisit(null);
    setOverDateKey(null);
  }, []);

  const hiddenStatuses = new Set(["cancelled", "skipped"]);

  const filteredVisits = useMemo(() => {
    let filtered = visits || [];
    if (!showHiddenStatuses) {
      filtered = filtered.filter((v) => !hiddenStatuses.has(v.status));
    }
    if (clientFilter.trim()) {
      const search = clientFilter.trim().toLowerCase();
      const matchingContactIds = new Set(
        (contacts || [])
          .filter((c) => `${c.firstName} ${c.lastName}`.toLowerCase().includes(search))
          .map((c) => c.id)
      );
      const matchingPlanIds = new Set(
        (servicePlans || [])
          .filter((sp) => matchingContactIds.has(sp.contactId))
          .map((sp) => sp.id)
      );
      filtered = filtered.filter((v) => matchingPlanIds.has(v.servicePlanId));
    }
    return filtered;
  }, [visits, contacts, servicePlans, clientFilter, showHiddenStatuses]);

  const hiddenCount = useMemo(() => {
    if (!visits) return 0;
    return visits.filter((v) => hiddenStatuses.has(v.status)).length;
  }, [visits]);

  const visitsByDate = useMemo(() => {
    const map: Record<string, Visit[]> = {};
    filteredVisits.forEach((v) => {
      if (!map[v.scheduledDate]) map[v.scheduledDate] = [];
      map[v.scheduledDate].push(v);
    });
    if (servicePlans) {
      const planOrderMap = new Map(servicePlans.map(sp => [sp.id, sp.stopOrder ?? 0]));
      for (const dateKey of Object.keys(map)) {
        map[dateKey].sort((a, b) => (planOrderMap.get(a.servicePlanId) ?? 0) - (planOrderMap.get(b.servicePlanId) ?? 0));
      }
    }
    return map;
  }, [filteredVisits, servicePlans]);

  const navigate = (dir: -1 | 1) => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (viewMode === "day") d.setDate(d.getDate() + dir);
      else if (viewMode === "week") d.setDate(d.getDate() + dir * 7);
      else d.setMonth(d.getMonth() + dir);
      return d;
    });
  };

  const goToday = () => setCurrentDate(new Date());

  const headerLabel = useMemo(() => {
    if (viewMode === "day") {
      return currentDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    } else if (viewMode === "week") {
      return `${dateRange.start.toLocaleDateString()} - ${dateRange.end.toLocaleDateString()}`;
    } else {
      return currentDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
  }, [viewMode, currentDate, dateRange]);

  const calendarDays = useMemo(() => {
    if (viewMode !== "month") return [];
    return getCalendarDays(currentDate);
  }, [viewMode, currentDate]);

  const weekDays = useMemo(() => {
    if (viewMode !== "week") return [];
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(dateRange.start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [viewMode, dateRange.start]);

  const todayStr = formatDate(new Date(), tz);
  const currentMonth = currentDate.getMonth();

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-scheduling-heading">Scheduling</h1>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setPrefilledContactId(null); setPrefilledFrequency(null); setPrefilledDayOfWeek(null); } }}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-service-plan"><Plus className="mr-1 h-4 w-4" /> Add Job</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Job</DialogTitle></DialogHeader>
            <ScheduleJobForm
              key={`${prefilledContactId || "none"}-${prefilledFrequency || ""}-${prefilledDayOfWeek || ""}`}
              onSubmit={(data) => createMutation.mutate(data)}
              isPending={createMutation.isPending}
              contacts={contacts || []}
              properties={properties || []}
              team={team || []}
              services={pricingItems || []}
              initialContactId={prefilledContactId}
              initialFrequency={prefilledFrequency}
              initialDayOfWeek={prefilledDayOfWeek}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center border rounded-lg overflow-hidden" data-testid="view-mode-switcher">
          {([
            { mode: "day" as ViewMode, icon: Calendar, label: "Day" },
            { mode: "week" as ViewMode, icon: CalendarDays, label: "Week" },
            { mode: "month" as ViewMode, icon: CalendarRange, label: "Month" },
          ]).map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${viewMode === mode ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              data-testid={`button-view-${mode}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="relative w-48" data-testid="filter-client-name">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter by client..."
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="pl-8 h-8 text-sm"
            data-testid="input-client-filter"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Switch
            id="show-hidden"
            checked={showHiddenStatuses}
            onCheckedChange={setShowHiddenStatuses}
            data-testid="switch-show-hidden"
          />
          <Label htmlFor="show-hidden" className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap" data-testid="label-show-hidden">
            {showHiddenStatuses ? <Eye className="h-3.5 w-3.5 inline mr-1" /> : <EyeOff className="h-3.5 w-3.5 inline mr-1" />}
            {hiddenCount > 0 ? `${hiddenCount} hidden` : "Hidden"}
          </Label>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)} data-testid="button-prev">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[140px] text-center" data-testid="text-date-range">
            {headerLabel}
          </span>
          <Button variant="outline" size="icon" onClick={() => navigate(1)} data-testid="button-next">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={goToday} data-testid="button-today">Today</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
          {Array.from({ length: viewMode === "day" ? 1 : 7 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        <>
          {viewMode === "day" && (
            <DayView
              date={currentDate}
              visits={visitsByDate[formatDate(currentDate, tz)] || []}
              contacts={contacts}
              properties={properties}
              routes={routes}
              servicePlans={servicePlans}
              onVisitClick={setSelectedVisit}
              onAddVisit={(dateKey) => { setQuickAddDate(dateKey); setQuickAddPlanId(""); setQuickAddRouteId(""); }}
            />
          )}

          {viewMode === "week" && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
                {weekDays.map((day, i) => {
                  const dateKey = formatDate(day, tz);
                  const dayVisits = visitsByDate[dateKey] || [];
                  const isToday = dateKey === todayStr;
                  return (
                    <DroppableDayCell key={dateKey} dateKey={dateKey} isOver={overDateKey === dateKey}>
                      <Card className={`h-full ${isToday ? "ring-2 ring-primary" : ""}`} data-testid={`card-day-${dayLabels[i]}`}>
                        <CardHeader className="p-3 pb-1">
                          <div className="flex items-center justify-between">
                            <CardTitle className={`text-sm ${isToday ? "text-primary" : ""}`}>
                              {dayLabels[i]} {day.getDate()}
                            </CardTitle>
                            <button
                              onClick={() => { setQuickAddDate(dateKey); setQuickAddPlanId(""); setQuickAddRouteId(""); }}
                              className="h-5 w-5 rounded-full flex items-center justify-center text-muted-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
                              data-testid={`button-quick-add-${dateKey}`}
                              title="Add visit"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </CardHeader>
                        <CardContent className="p-3 pt-0 space-y-1">
                          {dayVisits.length === 0 ? (
                            <p
                              className="text-xs text-muted-foreground cursor-pointer hover:text-primary transition-colors"
                              onClick={() => { setQuickAddDate(dateKey); setQuickAddPlanId(""); setQuickAddRouteId(""); }}
                              data-testid={`text-no-visits-${dateKey}`}
                            >
                              No visits — click to add
                            </p>
                          ) : (
                            dayVisits.map((v) => (
                              <DraggableVisitChip key={v.id} visit={v} contacts={contacts} properties={properties} routes={routes} servicePlans={servicePlans} compact onVisitClick={setSelectedVisit} />
                            ))
                          )}
                        </CardContent>
                      </Card>
                    </DroppableDayCell>
                  );
                })}
              </div>
              <DragOverlay>
                {activeVisit && (
                  <VisitDragOverlay visit={activeVisit} contacts={contacts} properties={properties} servicePlans={servicePlans} />
                )}
              </DragOverlay>
            </DndContext>
          )}

          {viewMode === "month" && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <div className="border rounded-lg overflow-hidden" data-testid="calendar-month">
                <div className="grid grid-cols-7 bg-muted/50">
                  {dayLabels.map((d) => (
                    <div key={d} className="px-2 py-2 text-xs font-medium text-muted-foreground text-center border-b">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {calendarDays.map((day) => {
                    const dateKey = formatDate(day, tz);
                    const dayVisits = visitsByDate[dateKey] || [];
                    const isToday = dateKey === todayStr;
                    const isCurrentMonth = day.getMonth() === currentMonth;
                    return (
                      <DroppableDayCell key={dateKey} dateKey={dateKey} isOver={overDateKey === dateKey}>
                        <div
                          className={`min-h-[100px] border-b border-r p-1.5 h-full group/cell cursor-pointer ${!isCurrentMonth ? "bg-muted/30" : ""} ${isToday ? "bg-primary/5" : ""}`}
                          data-testid={`cell-month-${dateKey}`}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest('[data-visit-chip]')) return;
                            setQuickAddDate(dateKey); setQuickAddPlanId(""); setQuickAddRouteId("");
                          }}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <div className={`text-xs font-medium ${isToday ? "bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center" : isCurrentMonth ? "text-foreground" : "text-muted-foreground"}`}>
                              {day.getDate()}
                            </div>
                            <div className="h-4 w-4 rounded-full flex items-center justify-center text-muted-foreground opacity-0 group-hover/cell:opacity-100 hover:bg-primary hover:text-primary-foreground transition-all">
                              <Plus className="h-3 w-3" />
                            </div>
                          </div>
                          <div className="space-y-0.5">
                            {dayVisits.slice(0, 3).map((v) => (
                              <DraggableVisitChip key={v.id} visit={v} contacts={contacts} properties={properties} routes={routes} servicePlans={servicePlans} compact onVisitClick={setSelectedVisit} />
                            ))}
                            {dayVisits.length > 3 && (
                              <OverflowVisitsPopover
                                dayVisits={dayVisits}
                                dateKey={dateKey}
                                contacts={contacts}
                                properties={properties}
                                routes={routes}
                                servicePlans={servicePlans}
                                onVisitClick={setSelectedVisit}
                              />
                            )}
                          </div>
                        </div>
                      </DroppableDayCell>
                    );
                  })}
                </div>
              </div>
              <DragOverlay>
                {activeVisit && (
                  <VisitDragOverlay visit={activeVisit} contacts={contacts} properties={properties} servicePlans={servicePlans} />
                )}
              </DragOverlay>
            </DndContext>
          )}
        </>
      )}

      <VisitDetailSheet
        visit={selectedVisit}
        open={!!selectedVisit}
        onOpenChange={(open) => { if (!open) setSelectedVisit(null); }}
        contacts={contacts}
        properties={properties}
        routes={routes}
        servicePlans={servicePlans}
        startStr={startStr}
        endStr={endStr}
        canEdit={isAdminOrOwner}
        team={team}
        onShowInvoiceDialog={handleShowInvoiceDialog}
      />
      <GenerateInvoiceDialog
        open={showInvoiceDialog}
        onOpenChange={setShowInvoiceDialog}
        contactId={invoiceDialogContactId}
      />

      <Dialog open={!!quickAddDate} onOpenChange={(open) => { if (!open) { setQuickAddDate(null); setQuickAddPlanId(""); setQuickAddRouteId(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Visit — {quickAddDate ? new Date(quickAddDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Job</Label>
              <Select value={quickAddPlanId} onValueChange={setQuickAddPlanId}>
                <SelectTrigger data-testid="select-quick-add-plan">
                  <SelectValue placeholder={activeServicePlans.length === 0 ? "No active jobs" : "Select a job"} />
                </SelectTrigger>
                <SelectContent>
                  {activeServicePlans.map((sp) => {
                    const c = contacts?.find((ct) => ct.id === sp.contactId);
                    const p = properties?.find((pr) => pr.id === sp.propertyId);
                    return (
                      <SelectItem key={sp.id} value={sp.id} data-testid={`option-plan-${sp.id}`}>
                        {c ? `${c.firstName} ${c.lastName}` : "Unknown"} — {p?.streetAddress || "No address"} ({sp.frequency})
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Route (optional)</Label>
              <Select value={quickAddRouteId} onValueChange={setQuickAddRouteId}>
                <SelectTrigger data-testid="select-quick-add-route">
                  <SelectValue placeholder="No route" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No route</SelectItem>
                  {routes?.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              disabled={!quickAddPlanId || quickAddMutation.isPending}
              onClick={() => {
                if (!quickAddPlanId || !quickAddDate) return;
                quickAddMutation.mutate({
                  servicePlanId: quickAddPlanId,
                  scheduledDate: quickAddDate,
                  routeId: quickAddRouteId && quickAddRouteId !== "none" ? quickAddRouteId : undefined,
                });
              }}
              data-testid="button-quick-add-submit"
            >
              {quickAddMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adding...</> : <><Plus className="mr-2 h-4 w-4" /> Add Visit</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VisitDetailSheet({
  visit,
  open,
  onOpenChange,
  contacts,
  properties,
  routes,
  servicePlans,
  startStr,
  endStr,
  canEdit,
  team,
  onShowInvoiceDialog,
}: {
  visit: Visit | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts?: Contact[];
  properties?: Property[];
  routes?: Route[];
  servicePlans?: ServicePlan[];
  startStr: string;
  endStr: string;
  canEdit?: boolean;
  team?: TeamMember[];
  onShowInvoiceDialog?: (contactId?: string) => void;
}) {
  const { toast } = useToast();
  const { data: sheetAuthUser } = useQuery<{ role?: string } | null>({
    queryKey: ["/api/auth/user"],
  });
  const isEditable = sheetAuthUser?.role === "owner" || sheetAuthUser?.role === "admin";
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [showSmsDialog, setShowSmsDialog] = useState(false);
  const [smsMessage, setSmsMessage] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editRouteId, setEditRouteId] = useState("");
  const [editNotes, setEditNotes] = useState("");

  useEffect(() => {
    if (visit && editing) {
      setEditDate(visit.scheduledDate || "");
      setEditRouteId(visit.routeId || "");
      setEditNotes(visit.technicianNotes || "");
    }
  }, [visit, editing]);

  const statusMutation = useMutation({
    mutationFn: async ({ visitId, status }: { visitId: string; status: string }) => {
      setUpdatingStatus(status);
      const body: Record<string, unknown> = { status };
      if (status === "completed") body.completedAt = new Date().toISOString();
      if (status === "scheduled") {
        body.completedAt = null;
        body.startedAt = null;
      }
      await apiRequest("PATCH", `/api/visits/${visitId}`, body);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/visits/range?start=${startStr}&end=${endStr}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/uninvoiced-summary"] });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey.includes("uninvoiced-visits") });
      if (variables.status === "completed" && !visit?.invoiceId && onShowInvoiceDialog) {
        const completedPlan = servicePlans?.find(sp => sp.id === visit?.servicePlanId);
        const completedContactId = completedPlan?.contactId;
        toast({ title: "Visit marked complete", description: "Open the invoice dialog to bill for this visit." });
        onOpenChange(false);
        onShowInvoiceDialog(completedContactId);
      } else {
        toast({ title: "Visit updated" });
        onOpenChange(false);
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
    onSettled: () => setUpdatingStatus(null),
  });

  const editMutation = useMutation({
    mutationFn: async ({ visitId, data }: { visitId: string; data: Record<string, unknown> }) => {
      await apiRequest("PATCH", `/api/visits/${visitId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/visits/range?start=${startStr}&end=${endStr}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      toast({ title: "Visit updated" });
      setEditing(false);
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!visit) return null;

  const plan = servicePlans?.find((sp) => sp.id === visit.servicePlanId);
  const contact = plan ? contacts?.find((c) => c.id === plan.contactId) : undefined;
  const property = properties?.find((p) => p.id === visit.propertyId);
  const route = routes?.find((r) => r.id === visit.routeId);
  const frequencyLabel = plan ? plan.frequency.charAt(0).toUpperCase() + plan.frequency.slice(1) : "";
  const pricePerVisit = plan ? parseFloat(plan.pricePerVisit) || 0 : 0;
  const contactHasPhone = !!(contact?.phone);

  const openOnMyWayDialog = () => {
    const name = contact?.firstName || "there";
    const defaultMsg = `Hi ${name}, we're on our way to your property! Please make sure your yard is accessible and any pets are inside. See you soon!`;
    setSmsMessage(defaultMsg);
    setShowSmsDialog(true);
  };

  const sendCustomSms = async () => {
    if (!visit || !smsMessage.trim()) return;
    setSmsSending(true);
    try {
      const res = await apiRequest("POST", `/api/visits/${visit.id}/send-custom-sms`, { message: smsMessage.trim() });
      const data = await res.json();
      toast({ title: "Message sent", description: `SMS sent to ${data.contactName}` });
      setShowSmsDialog(false);
      setSmsMessage("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send SMS";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setSmsSending(false);
    }
  };

  const handleSaveEdit = () => {
    const updates: Record<string, unknown> = {};
    if (editDate && editDate !== visit.scheduledDate) updates.scheduledDate = editDate;
    if (editRouteId !== (visit.routeId || "")) updates.routeId = editRouteId || null;
    if (editNotes !== (visit.technicianNotes || "")) updates.technicianNotes = editNotes;
    if (Object.keys(updates).length === 0) {
      setEditing(false);
      return;
    }
    editMutation.mutate({ visitId: visit.id, data: updates });
  };

  const statusActions: { status: string; label: string; icon: typeof CheckCircle; color: string; show: boolean }[] = [
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
    <>
    <Sheet open={open} onOpenChange={(o) => { if (!o) setEditing(false); onOpenChange(o); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" data-testid="sheet-visit-detail">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-lg" data-testid="text-sheet-title">Visit Details</SheetTitle>
          <SheetDescription>
            {visit.scheduledDate ? new Date(visit.scheduledDate + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <Badge className={`${visitStatusColors[visit.status] || ""}`} data-testid="badge-visit-status">
              {visitStatusLabels[visit.status] || visit.status}
            </Badge>
            {isEditable && !editing && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setEditing(true)}
                data-testid="button-edit-visit"
              >
                <Pencil className="h-4 w-4 mr-1" />
                Edit
              </Button>
            )}
            {visit.status === "completed" && !visit.invoiceId && (
              <Badge variant="outline" className="text-orange-600 border-orange-300 dark:border-orange-700" data-testid="badge-needs-invoice">
                <DollarSign className="h-3 w-3 mr-0.5" />Needs Invoice
              </Badge>
            )}
          </div>

          {visit.status === "completed" && !visit.invoiceId && (
            <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-3 space-y-2" data-testid="section-needs-invoice">
              <div className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
                <DollarSign className="h-4 w-4 shrink-0" />
                <span className="text-sm font-medium">This visit hasn't been invoiced yet</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {onShowInvoiceDialog && (
                  <Button
                    size="sm"
                    onClick={() => {
                      onOpenChange(false);
                      const planForBanner = servicePlans?.find(sp => sp.id === visit.servicePlanId);
                      onShowInvoiceDialog(planForBanner?.contactId);
                    }}
                    data-testid="button-generate-invoice-from-visit"
                  >
                    <DollarSign className="h-3.5 w-3.5 mr-1" />
                    Generate Invoice
                  </Button>
                )}
                {contact && (
                  <Link href={`/contacts/${contact.id}`}>
                    <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-view-contact-billing">
                      View Contact →
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          )}

          <Separator />

          {editing ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Scheduled Date</Label>
                <Input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  data-testid="input-edit-date"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Route</Label>
                <Select value={editRouteId || "none"} onValueChange={(v) => setEditRouteId(v === "none" ? "" : v)}>
                  <SelectTrigger data-testid="select-edit-route">
                    <SelectValue placeholder="No route" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No route</SelectItem>
                    {routes?.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Technician Notes</Label>
                <Textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Add notes..."
                  rows={3}
                  data-testid="textarea-edit-notes"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={handleSaveEdit}
                  disabled={editMutation.isPending}
                  data-testid="button-save-edit"
                >
                  {editMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Save Changes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setEditing(false)}
                  disabled={editMutation.isPending}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {contact && (
                  <div className="flex items-start gap-3">
                    <User className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Client</p>
                      <Link href={`/contacts/${contact.id}`}>
                        <span className="text-sm font-medium hover:underline cursor-pointer" data-testid="link-visit-contact">
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
                      <p className="text-sm" data-testid="text-visit-address">
                        {property.streetAddress}
                        {property.city ? `, ${property.city}` : ""}
                        {property.state ? ` ${property.state}` : ""}
                        {property.zipCode ? ` ${property.zipCode}` : ""}
                      </p>
                    </div>
                  </div>
                )}

                {plan && (
                  <div className="flex items-start gap-3">
                    <CalendarCheck className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Job</p>
                      <p className="text-sm" data-testid="text-visit-service">{frequencyLabel} Cleanup</p>
                    </div>
                  </div>
                )}

                {route && (
                  <div className="flex items-start gap-3">
                    <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Route</p>
                      <p className="text-sm" data-testid="text-visit-route">{route.name}</p>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3">
                  <DollarSign className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Amount</p>
                    <p className="text-sm font-medium" data-testid="text-visit-amount">${pricePerVisit.toFixed(2)}</p>
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
                      <p className="text-sm italic" data-testid="text-visit-notes">{visit.technicianNotes}</p>
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</p>
                <div className="grid grid-cols-1 gap-2">
                  <Button
                    variant="outline"
                    className="justify-start gap-2 text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/30 border-teal-200 dark:border-teal-800"
                    onClick={openOnMyWayDialog}
                    disabled={!contactHasPhone}
                    data-testid="button-on-my-way"
                  >
                    <Send className="h-4 w-4" />
                    {contactHasPhone ? "On My Way" : "On My Way (No phone)"}
                  </Button>
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
                        data-testid={`button-action-${action.status}`}
                      >
                        {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                        {action.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
    <Dialog open={showSmsDialog} onOpenChange={setShowSmsDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-teal-600" />
            Send "On My Way" Message
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">
              To: <span className="font-medium text-foreground">{contact?.firstName} {contact?.lastName}</span>
              {contact?.phone && <span className="ml-1 text-xs">({contact.phone})</span>}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sms-message" className="text-sm font-medium">Message</Label>
            <textarea
              id="sms-message"
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              value={smsMessage}
              onChange={(e) => setSmsMessage(e.target.value)}
              maxLength={1000}
              disabled={smsSending}
              data-testid="textarea-sms-message"
            />
            <p className="text-xs text-muted-foreground text-right">{smsMessage.length}/1000</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setShowSmsDialog(false)}
              disabled={smsSending}
              data-testid="button-cancel-sms"
            >
              Cancel
            </Button>
            <Button
              onClick={sendCustomSms}
              disabled={smsSending || !smsMessage.trim()}
              data-testid="button-send-sms"
            >
              {smsSending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Send Message
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

function DroppableDayCell({ dateKey, isOver, children }: {
  dateKey: string;
  isOver: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: `drop-day-${dateKey}` });
  return (
    <div
      ref={setNodeRef}
      className={`transition-all ${isOver ? "ring-2 ring-primary/50 bg-primary/5 rounded-lg" : ""}`}
      data-testid={`drop-day-${dateKey}`}
    >
      {children}
    </div>
  );
}

function DraggableVisitChip({ visit, contacts, properties, routes, servicePlans, compact, onVisitClick }: {
  visit: Visit;
  contacts?: Contact[];
  properties?: Property[];
  routes?: Route[];
  servicePlans?: ServicePlan[];
  compact?: boolean;
  onVisitClick?: (visit: Visit) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `visit-${visit.id}`,
    data: { visit },
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-30" : ""} data-visit-chip>
      <div className="flex items-start gap-0.5">
        <div
          className="cursor-grab active:cursor-grabbing touch-none pt-0.5 shrink-0 p-0.5"
          {...listeners}
          {...attributes}
          data-testid={`drag-handle-${visit.id}`}
        >
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <VisitChip visit={visit} contacts={contacts} properties={properties} routes={routes} servicePlans={servicePlans} compact={compact} onVisitClick={onVisitClick} />
        </div>
      </div>
    </div>
  );
}

function VisitDragOverlay({ visit, contacts, properties, servicePlans }: {
  visit: Visit;
  contacts?: Contact[];
  properties?: Property[];
  servicePlans?: ServicePlan[];
}) {
  const plan = servicePlans?.find((sp) => sp.id === visit.servicePlanId);
  const contact = plan ? contacts?.find((c) => c.id === plan.contactId) : undefined;
  const property = properties?.find((p) => p.id === visit.propertyId);
  return (
    <div className="border rounded-md p-2 bg-background shadow-lg opacity-90 max-w-xs space-y-0.5">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className={`text-[10px] px-1 py-0 ${visitStatusColors[visit.status] || ""}`}>
          {visitStatusLabels[visit.status] || visit.status}
        </Badge>
      </div>
      {contact && <p className="text-xs font-medium">{contact.firstName} {contact.lastName}</p>}
      {property && <p className="text-[10px] text-muted-foreground truncate">{property.streetAddress}</p>}
    </div>
  );
}

function OverflowVisitsPopover({ dayVisits, dateKey, contacts, properties, routes, servicePlans, onVisitClick }: {
  dayVisits: Visit[];
  dateKey: string;
  contacts?: Contact[];
  properties?: Property[];
  routes?: Route[];
  servicePlans?: ServicePlan[];
  onVisitClick?: (visit: Visit) => void;
}) {
  const overflowCount = dayVisits.length - 3;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="text-[10px] text-primary font-medium text-center w-full hover:underline cursor-pointer py-0.5"
          data-testid={`button-more-visits-${dateKey}`}
          data-visit-chip
          onClick={(e) => e.stopPropagation()}
        >
          +{overflowCount} more
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2 max-h-[300px] overflow-y-auto" align="start">
        <p className="text-xs font-medium text-muted-foreground mb-2">
          All visits ({dayVisits.length}) — {new Date(dateKey + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </p>
        <div className="space-y-1">
          {dayVisits.map((v) => (
            <VisitChip key={v.id} visit={v} contacts={contacts} properties={properties} routes={routes} servicePlans={servicePlans} compact onVisitClick={onVisitClick} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function VisitChip({ visit, contacts, properties, routes, servicePlans, compact, onVisitClick }: {
  visit: Visit;
  contacts?: Contact[];
  properties?: Property[];
  routes?: Route[];
  servicePlans?: ServicePlan[];
  compact?: boolean;
  onVisitClick?: (visit: Visit) => void;
}) {
  const plan = servicePlans?.find((sp) => sp.id === visit.servicePlanId);
  const contact = plan ? contacts?.find((c) => c.id === plan.contactId) : undefined;
  const property = properties?.find((p) => p.id === visit.propertyId);
  const route = routes?.find((r) => r.id === visit.routeId);

  const handleClick = () => {
    if (onVisitClick) onVisitClick(visit);
  };

  if (compact) {
    return (
      <div
        className="text-xs border rounded-md p-1.5 space-y-0.5 cursor-pointer hover:bg-muted/50 hover:shadow-sm transition-all"
        data-testid={`text-visit-${visit.id}`}
        data-visit-chip
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } }}
      >
        <div className="flex items-center justify-between gap-1">
          <Badge variant="secondary" className={`text-[10px] px-1 py-0 ${visitStatusColors[visit.status] || ""}`}>
            {visitStatusLabels[visit.status] || visit.status}
          </Badge>
          {visit.status === "completed" && !visit.invoiceId && (
            <span className="text-[10px] font-bold text-orange-600 dark:text-orange-400" title="Needs invoicing" data-testid={`indicator-needs-invoice-${visit.id}`}>$</span>
          )}
          {route && <span className="text-[10px] text-muted-foreground truncate">{route.name}</span>}
        </div>
        {contact && (
          <p className="truncate text-[11px] font-medium">{contact.firstName} {contact.lastName}</p>
        )}
        {property && <p className="truncate text-[10px] text-muted-foreground">{property.streetAddress}</p>}
      </div>
    );
  }

  return (
    <Card
      className="mb-2 cursor-pointer hover:bg-muted/30 hover:shadow-sm transition-all"
      data-testid={`card-visit-${visit.id}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } }}
    >
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="secondary" className={visitStatusColors[visit.status] || ""}>
            {visitStatusLabels[visit.status] || visit.status}
          </Badge>
          {visit.status === "completed" && !visit.invoiceId && (
            <span className="text-xs font-bold text-orange-600 dark:text-orange-400" title="Needs invoicing" data-testid={`indicator-needs-invoice-${visit.id}`}>$</span>
          )}
          {route && <span className="text-xs text-muted-foreground">{route.name}</span>}
        </div>
        {contact && (
          <p className="text-sm font-medium">{contact.firstName} {contact.lastName}</p>
        )}
        {property && <p className="text-xs text-muted-foreground">{property.streetAddress}{property.city ? `, ${property.city}` : ""}</p>}
        {visit.technicianNotes && <p className="text-xs text-muted-foreground italic">{visit.technicianNotes}</p>}
      </CardContent>
    </Card>
  );
}

function DayView({ date, visits, contacts, properties, routes, servicePlans, onVisitClick, onAddVisit }: {
  date: Date;
  visits: Visit[];
  contacts?: Contact[];
  properties?: Property[];
  routes?: Route[];
  servicePlans?: ServicePlan[];
  onVisitClick?: (visit: Visit) => void;
  onAddVisit?: (dateKey: string) => void;
}) {
  const tz = useCompanyTimezone();
  const statusGroups = useMemo(() => {
    const groups: Record<string, Visit[]> = { scheduled: [], in_progress: [], completed: [], skipped: [], cancelled: [] };
    visits.forEach((v) => {
      if (groups[v.status]) groups[v.status].push(v);
      else groups[v.status] = [v];
    });
    return groups;
  }, [visits]);

  return (
    <div className="space-y-4" data-testid="day-view">
      <div className="flex items-center gap-3">
        <div className="text-4xl font-bold text-primary" data-testid="text-day-number">{date.getDate()}</div>
        <div className="flex-1">
          <p className="text-sm font-medium">{date.toLocaleDateString(undefined, { weekday: "long" })}</p>
          <p className="text-xs text-muted-foreground">{visits.length} visit{visits.length !== 1 ? "s" : ""}</p>
        </div>
        {onAddVisit && (
          <Button variant="outline" size="sm" onClick={() => onAddVisit(formatDate(date, tz))} data-testid="button-day-add-visit">
            <Plus className="mr-1 h-4 w-4" /> Add Visit
          </Button>
        )}
      </div>

      {visits.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Calendar className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No visits scheduled for this day</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(statusGroups).map(([status, groupVisits]) => {
            if (groupVisits.length === 0) return null;
            return (
              <div key={status}>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary" className={visitStatusColors[status] || ""}>{status}</Badge>
                  <span className="text-xs text-muted-foreground">({groupVisits.length})</span>
                </div>
                {groupVisits.map((v) => (
                  <VisitChip key={v.id} visit={v} contacts={contacts} properties={properties} routes={routes} servicePlans={servicePlans} onVisitClick={onVisitClick} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
