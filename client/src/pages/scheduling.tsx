import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Visit, Contact, Property, Route, ServicePricingItem, ServicePlan } from "@shared/schema";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ChevronLeft, ChevronRight, Plus, Wand2, Calendar, CalendarDays, CalendarRange,
  CheckCircle, XCircle, Ban, Clock, MapPin, DollarSign, User, CalendarCheck, Loader2, GripVertical,
} from "lucide-react";
import { Link } from "wouter";
import { ClientInfoPopover } from "@/components/client-info-popover";
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

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
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

const servicePlanSchema = z.object({
  contactId: z.string().min(1, "Contact is required"),
  propertyId: z.string().min(1, "Property is required"),
  frequency: z.enum(["weekly", "biweekly", "monthly", "onetime"]),
  dayOfWeek: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]).optional(),
  pricePerVisit: z.string().min(1, "Price is required"),
  startDate: z.string().min(1, "Start date is required"),
  routeId: z.string().optional(),
});

type ServicePlanFormValues = z.infer<typeof servicePlanSchema>;

export default function Scheduling() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dialogOpen, setDialogOpen] = useState(false);

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

  const startStr = formatDate(dateRange.start);
  const endStr = formatDate(dateRange.end);

  const { data: visits, isLoading } = useQuery<Visit[]>({
    queryKey: [`/api/visits/range?start=${startStr}&end=${endStr}`],
  });

  const { data: contacts } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: properties } = useQuery<Property[]>({ queryKey: ["/api/properties"] });
  const { data: routes } = useQuery<Route[]>({ queryKey: ["/api/routes"] });
  const { data: servicePlans } = useQuery<ServicePlan[]>({ queryKey: ["/api/service-plans"] });
  const { data: pricingItems } = useQuery<ServicePricingItem[]>({ queryKey: ["/api/pricing"] });

  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);

  const recurringPricing = useMemo(() => {
    if (!pricingItems) return [];
    return pricingItems.filter((p) => p.category === "recurring_service" && p.isActive);
  }, [pricingItems]);

  const oneTimePricing = useMemo(() => {
    if (!pricingItems) return [];
    return pricingItems.filter((p) => p.category === "one_time_service" && p.isActive);
  }, [pricingItems]);

  const form = useForm<ServicePlanFormValues>({
    resolver: zodResolver(servicePlanSchema),
    defaultValues: {
      contactId: "", propertyId: "", frequency: "weekly", dayOfWeek: "monday",
      pricePerVisit: "", startDate: formatDate(new Date()), routeId: "",
    },
  });

  const selectedContactId = form.watch("contactId");
  const selectedFrequency = form.watch("frequency");

  const templatePricing = useMemo(() => {
    return selectedFrequency === "monthly" || selectedFrequency === "onetime"
      ? oneTimePricing
      : recurringPricing;
  }, [selectedFrequency, oneTimePricing, recurringPricing]);

  const contactProperties = useMemo(() => {
    if (!selectedContactId || !properties) return [];
    return properties.filter((p) => p.contactId === selectedContactId);
  }, [selectedContactId, properties]);

  useEffect(() => {
    if (!selectedContactId) { form.setValue("propertyId", ""); return; }
    if (contactProperties.length === 1) {
      form.setValue("propertyId", contactProperties[0].id);
    } else {
      const cur = form.getValues("propertyId");
      if (cur && !contactProperties.some((p) => p.id === cur)) form.setValue("propertyId", "");
    }
  }, [selectedContactId, contactProperties, form]);

  const prevFrequencyRef = useRef(selectedFrequency);
  useEffect(() => {
    if (!dialogOpen) return;
    const frequencyChanged = prevFrequencyRef.current !== selectedFrequency;
    prevFrequencyRef.current = selectedFrequency;
    if (frequencyChanged) {
      const defaultPrice = templatePricing.length > 0 ? templatePricing[0].basePrice : "";
      form.setValue("pricePerVisit", defaultPrice);
    } else if (templatePricing.length > 0 && !form.getValues("pricePerVisit")) {
      form.setValue("pricePerVisit", templatePricing[0].basePrice);
    }
  }, [dialogOpen, selectedFrequency, templatePricing, form]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/visits/generate", { startDate: startStr, endDate: endStr });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/visits/range?start=${startStr}&end=${endStr}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/visits/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      toast({ title: `${data.generated} visit${data.generated === 1 ? "" : "s"} generated`, description: data.generated > 0 ? "Visits created from active jobs." : "No new visits needed." });
    },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const createMutation = useMutation({
    mutationFn: async (data: ServicePlanFormValues) => { await apiRequest("POST", "/api/service-plans", data); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/visits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && (query.queryKey[0] as string)?.startsWith("/api/service-plans?contactId=") });
      toast({ title: "Job created", description: "New job added successfully." });
      setDialogOpen(false);
      form.reset();
    },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

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

  const visitsByDate = useMemo(() => {
    const map: Record<string, Visit[]> = {};
    visits?.forEach((v) => {
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
  }, [visits, servicePlans]);

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

  const todayStr = formatDate(new Date());
  const currentMonth = currentDate.getMonth();

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-scheduling-heading">Scheduling</h1>
        <div className="flex items-center gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={generateMutation.isPending} data-testid="button-generate-visits">
                <Wand2 className="mr-1 h-4 w-4" />
                {generateMutation.isPending ? "Creating..." : "Create Visits"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Create Visits</AlertDialogTitle>
                <AlertDialogDescription>
                  This will create visits for all active jobs in the selected date range ({dateRange.start.toLocaleDateString()} - {dateRange.end.toLocaleDateString()}). Existing visits won't be duplicated.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => generateMutation.mutate()} data-testid="button-confirm-generate">Generate</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-service-plan"><Plus className="mr-1 h-4 w-4" /> Add Job</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Add Job</DialogTitle></DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
                  <FormField control={form.control} name="contactId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger data-testid="select-contact"><SelectValue placeholder="Select contact" /></SelectTrigger></FormControl>
                        <SelectContent>{contacts?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>))}</SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="propertyId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Property</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger data-testid="select-property"><SelectValue placeholder={selectedContactId ? (contactProperties.length === 0 ? "No properties for this contact" : "Select property") : "Select a contact first"} /></SelectTrigger></FormControl>
                        <SelectContent>{contactProperties.map((p) => (<SelectItem key={p.id} value={p.id}>{p.streetAddress}, {p.city}</SelectItem>))}</SelectContent>
                      </Select>
                      {selectedContactId && contactProperties.length === 0 && (<p className="text-sm text-muted-foreground">This contact has no properties. Add one from their contact detail page first.</p>)}
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="frequency" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Frequency</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger data-testid="select-frequency"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="biweekly">Biweekly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                          <SelectItem value="onetime">One-time</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="dayOfWeek" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Day of Week</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger data-testid="select-day"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>{daysOfWeek.map((d) => (<SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>))}</SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  {templatePricing.length > 0 && (
                    <div>
                      <Label className="text-sm">Use Pricing Template</Label>
                      <Select onValueChange={(v) => { const item = pricingItems?.find((p) => p.id === v); if (item) form.setValue("pricePerVisit", item.basePrice); }}>
                        <SelectTrigger data-testid="select-pricing-template"><SelectValue placeholder="Select pricing template" /></SelectTrigger>
                        <SelectContent>{templatePricing.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name} - ${p.basePrice}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                  )}
                  <FormField control={form.control} name="pricePerVisit" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Price Per Visit ($)</FormLabel>
                      <FormControl><Input type="number" step="0.01" {...field} data-testid="input-price" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="startDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Date</FormLabel>
                      <FormControl><Input type="date" {...field} data-testid="input-start-date" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="routeId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Route (optional)</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger data-testid="select-route"><SelectValue placeholder="No route" /></SelectTrigger></FormControl>
                        <SelectContent>{routes?.map((r) => (<SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>))}</SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-service-plan">
                    {createMutation.isPending ? "Creating..." : "Create Job"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
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
              visits={visitsByDate[formatDate(currentDate)] || []}
              contacts={contacts}
              properties={properties}
              routes={routes}
              servicePlans={servicePlans}
              onVisitClick={setSelectedVisit}
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
                  const dateKey = formatDate(day);
                  const dayVisits = visitsByDate[dateKey] || [];
                  const isToday = dateKey === todayStr;
                  return (
                    <DroppableDayCell key={dateKey} dateKey={dateKey} isOver={overDateKey === dateKey}>
                      <Card className={`h-full ${isToday ? "ring-2 ring-primary" : ""}`} data-testid={`card-day-${dayLabels[i]}`}>
                        <CardHeader className="p-3 pb-1">
                          <CardTitle className={`text-sm ${isToday ? "text-primary" : ""}`}>
                            {dayLabels[i]} {day.getDate()}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-3 pt-0 space-y-1">
                          {dayVisits.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No visits</p>
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
                    const dateKey = formatDate(day);
                    const dayVisits = visitsByDate[dateKey] || [];
                    const isToday = dateKey === todayStr;
                    const isCurrentMonth = day.getMonth() === currentMonth;
                    return (
                      <DroppableDayCell key={dateKey} dateKey={dateKey} isOver={overDateKey === dateKey}>
                        <div
                          className={`min-h-[100px] border-b border-r p-1.5 h-full ${!isCurrentMonth ? "bg-muted/30" : ""} ${isToday ? "bg-primary/5" : ""}`}
                          data-testid={`cell-month-${dateKey}`}
                        >
                          <div className={`text-xs font-medium mb-1 ${isToday ? "bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center" : isCurrentMonth ? "text-foreground" : "text-muted-foreground"}`}>
                            {day.getDate()}
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
      />
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
}) {
  const { toast } = useToast();
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/visits/range?start=${startStr}&end=${endStr}`] });
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

  if (!visit) return null;

  const plan = servicePlans?.find((sp) => sp.id === visit.servicePlanId);
  const contact = plan ? contacts?.find((c) => c.id === plan.contactId) : undefined;
  const property = properties?.find((p) => p.id === visit.propertyId);
  const route = routes?.find((r) => r.id === visit.routeId);
  const frequencyLabel = plan ? plan.frequency.charAt(0).toUpperCase() + plan.frequency.slice(1) : "";
  const pricePerVisit = plan ? parseFloat(plan.pricePerVisit) || 0 : 0;

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
    <Sheet open={open} onOpenChange={onOpenChange}>
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
            {visit.status === "completed" && !visit.invoiceId && (
              <Badge variant="outline" className="text-orange-600 border-orange-300 dark:border-orange-700" data-testid="badge-needs-invoice">
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
                  <p className="text-xs text-muted-foreground">Service</p>
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
        </div>
      </SheetContent>
    </Sheet>
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
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-30" : ""}>
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

function DayView({ date, visits, contacts, properties, routes, servicePlans, onVisitClick }: {
  date: Date;
  visits: Visit[];
  contacts?: Contact[];
  properties?: Property[];
  routes?: Route[];
  servicePlans?: ServicePlan[];
  onVisitClick?: (visit: Visit) => void;
}) {
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
        <div>
          <p className="text-sm font-medium">{date.toLocaleDateString(undefined, { weekday: "long" })}</p>
          <p className="text-xs text-muted-foreground">{visits.length} visit{visits.length !== 1 ? "s" : ""}</p>
        </div>
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
