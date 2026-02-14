import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Visit, Contact, Property, Route } from "@shared/schema";
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
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

const visitStatusColors: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  in_progress: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  skipped: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const daysOfWeek = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  const [weekOffset, setWeekOffset] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);

  const weekStart = useMemo(() => {
    const now = new Date();
    const start = getWeekStart(now);
    start.setDate(start.getDate() + weekOffset * 7);
    return start;
  }, [weekOffset]);

  const weekEnd = useMemo(() => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    return end;
  }, [weekStart]);

  const startStr = formatDate(weekStart);
  const endStr = formatDate(weekEnd);

  const { data: visits, isLoading } = useQuery<Visit[]>({
    queryKey: [`/api/visits/range?start=${startStr}&end=${endStr}`],
  });

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const { data: properties } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const { data: routes } = useQuery<Route[]>({
    queryKey: ["/api/routes"],
  });

  const form = useForm<ServicePlanFormValues>({
    resolver: zodResolver(servicePlanSchema),
    defaultValues: {
      contactId: "",
      propertyId: "",
      frequency: "weekly",
      dayOfWeek: "monday",
      pricePerVisit: "",
      startDate: formatDate(new Date()),
      routeId: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: ServicePlanFormValues) => {
      await apiRequest("POST", "/api/service-plans", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/visits"] });
      toast({ title: "Service plan created", description: "New service plan added successfully." });
      setDialogOpen(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const visitsByDay = useMemo(() => {
    const map: Record<string, Visit[]> = {};
    weekDays.forEach((d) => {
      map[formatDate(d)] = [];
    });
    visits?.forEach((v) => {
      const key = v.scheduledDate;
      if (map[key]) {
        map[key].push(v);
      }
    });
    return map;
  }, [visits, weekDays]);

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-scheduling-heading">Scheduling</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-service-plan">
              <Plus className="mr-1 h-4 w-4" /> Create Service Plan
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Service Plan</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
                <FormField control={form.control} name="contactId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-contact"><SelectValue placeholder="Select contact" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {contacts?.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="propertyId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Property</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-property"><SelectValue placeholder="Select property" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {properties?.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.streetAddress}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                      <SelectContent>
                        {daysOfWeek.map((d) => (
                          <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
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
                      <SelectContent>
                        {routes?.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
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

      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setWeekOffset((o) => o - 1)} data-testid="button-prev-week">
          <ChevronLeft />
        </Button>
        <span className="text-sm font-medium" data-testid="text-week-range">
          {weekStart.toLocaleDateString()} - {weekEnd.toLocaleDateString()}
        </span>
        <Button variant="outline" size="icon" onClick={() => setWeekOffset((o) => o + 1)} data-testid="button-next-week">
          <ChevronRight />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)} data-testid="button-today">
          Today
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
          {weekDays.map((day, i) => {
            const dateKey = formatDate(day);
            const dayVisits = visitsByDay[dateKey] || [];
            return (
              <Card key={dateKey} data-testid={`card-day-${dayLabels[i]}`}>
                <CardHeader className="p-3 pb-1">
                  <CardTitle className="text-sm">
                    {dayLabels[i]} {day.getDate()}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0 space-y-1">
                  {dayVisits.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No visits</p>
                  ) : (
                    dayVisits.map((v) => (
                      <div key={v.id} className="text-xs border rounded-md p-1.5" data-testid={`text-visit-${v.id}`}>
                        <Badge variant="secondary" className={visitStatusColors[v.status] || ""}>
                          {v.status}
                        </Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
