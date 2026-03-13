import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Visit, Contact, Property, Route, ServicePricingItem } from "@shared/schema";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { ChevronLeft, ChevronRight, Plus, Wand2, Calendar, CalendarDays, CalendarRange } from "lucide-react";
import { ClientInfoPopover } from "@/components/client-info-popover";

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
  const { data: pricingItems } = useQuery<ServicePricingItem[]>({ queryKey: ["/api/pricing"] });

  const recurringPricing = useMemo(() => {
    if (!pricingItems) return [];
    return pricingItems.filter((p) => p.category === "recurring_service" && p.isActive);
  }, [pricingItems]);

  const form = useForm<ServicePlanFormValues>({
    resolver: zodResolver(servicePlanSchema),
    defaultValues: {
      contactId: "", propertyId: "", frequency: "weekly", dayOfWeek: "monday",
      pricePerVisit: "", startDate: formatDate(new Date()), routeId: "",
    },
  });

  const selectedContactId = form.watch("contactId");

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

  useEffect(() => {
    if (dialogOpen && recurringPricing.length > 0 && !form.getValues("pricePerVisit")) {
      form.setValue("pricePerVisit", recurringPricing[0].basePrice);
    }
  }, [dialogOpen, recurringPricing, form]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/visits/generate", { startDate: startStr, endDate: endStr });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/visits/range?start=${startStr}&end=${endStr}`] });
      toast({ title: `${data.generated} visit${data.generated === 1 ? "" : "s"} generated`, description: data.generated > 0 ? "Visits created from active service plans." : "No new visits needed." });
    },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const createMutation = useMutation({
    mutationFn: async (data: ServicePlanFormValues) => { await apiRequest("POST", "/api/service-plans", data); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/visits"] });
      toast({ title: "Service plan created", description: "New service plan added successfully." });
      setDialogOpen(false);
      form.reset();
    },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const visitsByDate = useMemo(() => {
    const map: Record<string, Visit[]> = {};
    visits?.forEach((v) => {
      if (!map[v.scheduledDate]) map[v.scheduledDate] = [];
      map[v.scheduledDate].push(v);
    });
    return map;
  }, [visits]);

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
                  This will create visits for all active service plans in the selected date range ({dateRange.start.toLocaleDateString()} - {dateRange.end.toLocaleDateString()}). Existing visits won't be duplicated.
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
              <Button data-testid="button-create-service-plan"><Plus className="mr-1 h-4 w-4" /> Create Service Plan</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Create Service Plan</DialogTitle></DialogHeader>
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
                  {recurringPricing.length > 0 && (
                    <div>
                      <Label className="text-sm">Use Pricing Template</Label>
                      <Select onValueChange={(v) => { const item = pricingItems?.find((p) => p.id === v); if (item) form.setValue("pricePerVisit", item.basePrice); }}>
                        <SelectTrigger data-testid="select-pricing-template"><SelectValue placeholder="Select pricing template" /></SelectTrigger>
                        <SelectContent>{recurringPricing.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name} - ${p.basePrice}</SelectItem>))}</SelectContent>
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
                    {createMutation.isPending ? "Creating..." : "Create Service Plan"}
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
            />
          )}

          {viewMode === "week" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
              {weekDays.map((day, i) => {
                const dateKey = formatDate(day);
                const dayVisits = visitsByDate[dateKey] || [];
                const isToday = dateKey === todayStr;
                return (
                  <Card key={dateKey} className={isToday ? "ring-2 ring-primary" : ""} data-testid={`card-day-${dayLabels[i]}`}>
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
                          <VisitChip key={v.id} visit={v} contacts={contacts} properties={properties} routes={routes} compact />
                        ))
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {viewMode === "month" && (
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
                    <div
                      key={dateKey}
                      className={`min-h-[100px] border-b border-r p-1.5 ${!isCurrentMonth ? "bg-muted/30" : ""} ${isToday ? "bg-primary/5" : ""}`}
                      data-testid={`cell-month-${dateKey}`}
                    >
                      <div className={`text-xs font-medium mb-1 ${isToday ? "bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center" : isCurrentMonth ? "text-foreground" : "text-muted-foreground"}`}>
                        {day.getDate()}
                      </div>
                      <div className="space-y-0.5">
                        {dayVisits.slice(0, 3).map((v) => (
                          <VisitChip key={v.id} visit={v} contacts={contacts} properties={properties} routes={routes} compact />
                        ))}
                        {dayVisits.length > 3 && (
                          <p className="text-[10px] text-muted-foreground text-center">+{dayVisits.length - 3} more</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VisitChip({ visit, contacts, properties, routes, compact }: {
  visit: Visit;
  contacts?: Contact[];
  properties?: Property[];
  routes?: Route[];
  compact?: boolean;
}) {
  const contact = contacts?.find((c) => c.id === visit.contactId);
  const property = properties?.find((p) => p.id === visit.propertyId);
  const route = routes?.find((r) => r.id === visit.routeId);

  if (compact) {
    return (
      <div className="text-xs border rounded-md p-1.5 space-y-0.5" data-testid={`text-visit-${visit.id}`}>
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
          <ClientInfoPopover contactId={contact.id}>
            <p className="truncate text-[11px] font-medium">{contact.firstName} {contact.lastName}</p>
          </ClientInfoPopover>
        )}
        {property && <p className="truncate text-[10px] text-muted-foreground">{property.streetAddress}</p>}
      </div>
    );
  }

  return (
    <Card className="mb-2" data-testid={`card-visit-${visit.id}`}>
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
          <ClientInfoPopover contactId={contact.id}>
            <p className="text-sm font-medium">{contact.firstName} {contact.lastName}</p>
          </ClientInfoPopover>
        )}
        {property && <p className="text-xs text-muted-foreground">{property.streetAddress}{property.city ? `, ${property.city}` : ""}</p>}
        {visit.notes && <p className="text-xs text-muted-foreground italic">{visit.notes}</p>}
      </CardContent>
    </Card>
  );
}

function DayView({ date, visits, contacts, properties, routes }: {
  date: Date;
  visits: Visit[];
  contacts?: Contact[];
  properties?: Property[];
  routes?: Route[];
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
                  <VisitChip key={v.id} visit={v} contacts={contacts} properties={properties} routes={routes} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
