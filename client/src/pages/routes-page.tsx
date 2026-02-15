import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Route, ServicePlan, Contact, Property } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Plus, Trash2, Users, MapPin, Pencil, UserPlus, X } from "lucide-react";

const daysOfWeek = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const routeFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  dayOfWeek: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
  technicianId: z.string().optional(),
  color: z.string().default("#3b82f6"),
});

type RouteFormValues = z.infer<typeof routeFormSchema>;

interface TeamMember {
  id: string;
  companyUserId: string;
  role: string;
  firstName: string;
  lastName: string;
  email: string;
}

export default function RoutesPage() {
  const { toast } = useToast();
  const [selectedDay, setSelectedDay] = useState("monday");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assigningRouteId, setAssigningRouteId] = useState<string | null>(null);

  const { data: routes, isLoading } = useQuery<Route[]>({
    queryKey: ["/api/routes", selectedDay],
    queryFn: async () => {
      const res = await fetch(`/api/routes?dayOfWeek=${selectedDay}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  const { data: servicePlans } = useQuery<ServicePlan[]>({
    queryKey: ["/api/service-plans"],
  });

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const { data: properties } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const { data: team } = useQuery<TeamMember[]>({
    queryKey: ["/api/company/team"],
  });

  const createForm = useForm<RouteFormValues>({
    resolver: zodResolver(routeFormSchema),
    defaultValues: {
      name: "",
      dayOfWeek: selectedDay as any,
      technicianId: "",
      color: "#3b82f6",
    },
  });

  const editForm = useForm<RouteFormValues>({
    resolver: zodResolver(routeFormSchema),
    defaultValues: {
      name: "",
      dayOfWeek: "monday",
      technicianId: "",
      color: "#3b82f6",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: RouteFormValues) => {
      const payload = { ...data };
      if (!payload.technicianId) payload.technicianId = undefined;
      await apiRequest("POST", "/api/routes", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      toast({ title: "Route created" });
      setCreateDialogOpen(false);
      createForm.reset({ name: "", dayOfWeek: selectedDay, technicianId: "", color: "#3b82f6" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: RouteFormValues }) => {
      const payload: any = { ...data };
      if (!payload.technicianId || payload.technicianId === "none") payload.technicianId = null;
      await apiRequest("PATCH", `/api/routes/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      toast({ title: "Route updated" });
      setEditDialogOpen(false);
      setEditingRoute(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/routes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      toast({ title: "Route deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const assignPlanMutation = useMutation({
    mutationFn: async ({ planId, routeId }: { planId: string; routeId: string | null }) => {
      await apiRequest("PATCH", `/api/service-plans/${planId}`, { routeId });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      toast({ title: variables.routeId ? "Service plan assigned" : "Service plan unassigned" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const getPlansForRoute = (routeId: string) => {
    return servicePlans?.filter(sp => sp.routeId === routeId && sp.isActive) || [];
  };

  const unassignedPlans = useMemo(() => {
    return servicePlans?.filter(sp => !sp.routeId && sp.isActive) || [];
  }, [servicePlans]);

  const getContactName = (contactId: string) => {
    const c = contacts?.find(ct => ct.id === contactId);
    return c ? `${c.firstName} ${c.lastName}`.trim() : "Unknown";
  };

  const getPropertyAddress = (propertyId: string) => {
    const p = properties?.find(pr => pr.id === propertyId);
    return p ? `${p.street}` : "Unknown";
  };

  const getTechName = (techId: string | null) => {
    if (!techId || !team) return null;
    const t = team.find(m => m.id === techId);
    return t ? `${t.firstName} ${t.lastName}`.trim() : null;
  };

  function openEditDialog(route: Route) {
    setEditingRoute(route);
    editForm.reset({
      name: route.name,
      dayOfWeek: route.dayOfWeek as any,
      technicianId: route.technicianId || "",
      color: route.color || "#3b82f6",
    });
    setEditDialogOpen(true);
  }

  function RouteFormFields({ form, teamMembers }: { form: any; teamMembers: TeamMember[] }) {
    return (
      <>
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Route Name</FormLabel>
            <FormControl><Input {...field} data-testid="input-route-name" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="dayOfWeek" render={({ field }) => (
          <FormItem>
            <FormLabel>Day of Week</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl><SelectTrigger data-testid="select-route-day"><SelectValue /></SelectTrigger></FormControl>
              <SelectContent>
                {daysOfWeek.map((d) => (
                  <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="technicianId" render={({ field }) => (
          <FormItem>
            <FormLabel>Assigned Technician</FormLabel>
            <Select onValueChange={field.onChange} value={field.value || ""}>
              <FormControl><SelectTrigger data-testid="select-route-tech"><SelectValue placeholder="No technician assigned" /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="none">No technician assigned</SelectItem>
                {teamMembers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.firstName} {m.lastName} ({m.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="color" render={({ field }) => (
          <FormItem>
            <FormLabel>Color</FormLabel>
            <div className="flex items-center gap-2">
              <FormControl><input type="color" {...field} className="h-9 w-12 rounded-md border cursor-pointer" data-testid="input-route-color" /></FormControl>
              <Input value={field.value} onChange={field.onChange} className="font-mono text-sm" />
            </div>
            <FormMessage />
          </FormItem>
        )} />
      </>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-routes-heading">Routes</h1>
        <Dialog open={createDialogOpen} onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (open) createForm.setValue("dayOfWeek", selectedDay as any);
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-route">
              <Plus className="mr-1 h-4 w-4" /> Create Route
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Route</DialogTitle>
              <DialogDescription>Add a new route for a specific day of the week.</DialogDescription>
            </DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
                <RouteFormFields form={createForm} teamMembers={team || []} />
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-route">
                  {createMutation.isPending ? "Creating..." : "Create Route"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={selectedDay} onValueChange={setSelectedDay}>
        <TabsList className="flex-wrap">
          {daysOfWeek.map((d) => (
            <TabsTrigger key={d} value={d} className="capitalize" data-testid={`tab-${d}`}>
              {d.slice(0, 3)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : routes && routes.length > 0 ? (
        <div className="space-y-3">
          {routes.map((route) => {
            const plans = getPlansForRoute(route.id);
            const techName = getTechName(route.technicianId);
            return (
              <Card key={route.id} data-testid={`card-route-${route.id}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-4 h-4 rounded-full shrink-0"
                        style={{ backgroundColor: route.color || "#3b82f6" }}
                      />
                      <div>
                        <p className="font-medium" data-testid={`text-route-name-${route.id}`}>{route.name}</p>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                          <span className="capitalize">{route.dayOfWeek}</span>
                          {techName && (
                            <>
                              <span>-</span>
                              <span data-testid={`text-route-tech-${route.id}`}>{techName}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="secondary" data-testid={`badge-route-plans-${route.id}`}>
                        <Users className="h-3 w-3 mr-1" />
                        {plans.length} {plans.length === 1 ? "stop" : "stops"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(route)}
                        data-testid={`button-edit-route-${route.id}`}
                        title="Edit route"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setAssigningRouteId(route.id);
                          setAssignDialogOpen(true);
                        }}
                        data-testid={`button-assign-route-${route.id}`}
                        title="Assign service plans"
                      >
                        <UserPlus className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-delete-route-${route.id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Route</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete "{route.name}"? {plans.length > 0 && `This route has ${plans.length} assigned service plan(s) that will be unassigned.`}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(route.id)}
                              data-testid={`button-confirm-delete-route-${route.id}`}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>

                  {plans.length > 0 && (
                    <div className="border-t pt-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Assigned Service Plans</p>
                      {plans.map((plan) => (
                        <div key={plan.id} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid={`row-plan-${plan.id}`}>
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span>{getContactName(plan.contactId)}</span>
                            <span className="text-muted-foreground">-</span>
                            <span className="text-muted-foreground">{getPropertyAddress(plan.propertyId)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="capitalize">{plan.frequency}</Badge>
                            <span className="font-medium">${plan.pricePerVisit}/visit</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => assignPlanMutation.mutate({ planId: plan.id, routeId: null })}
                              disabled={assignPlanMutation.isPending}
                              data-testid={`button-unassign-plan-${plan.id}`}
                              title="Remove from route"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-no-routes">
            No routes for {selectedDay}. Create one to get started.
          </CardContent>
        </Card>
      )}

      <Dialog open={editDialogOpen} onOpenChange={(open) => {
        setEditDialogOpen(open);
        if (!open) setEditingRoute(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Route</DialogTitle>
            <DialogDescription>Update route details and technician assignment.</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit((v) => editingRoute && editMutation.mutate({ id: editingRoute.id, data: v }))} className="space-y-4">
              <RouteFormFields form={editForm} teamMembers={team || []} />
              <Button type="submit" disabled={editMutation.isPending} data-testid="button-submit-edit-route">
                {editMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={assignDialogOpen} onOpenChange={(open) => {
        setAssignDialogOpen(open);
        if (!open) setAssigningRouteId(null);
      }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign Service Plans</DialogTitle>
            <DialogDescription>
              Select service plans to add to this route. Only unassigned active plans are shown.
            </DialogDescription>
          </DialogHeader>
          {unassignedPlans.length > 0 ? (
            <div className="space-y-2">
              {unassignedPlans.map((plan) => (
                <div
                  key={plan.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm border rounded-md p-3"
                  data-testid={`row-unassigned-plan-${plan.id}`}
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                    <div>
                      <p className="font-medium">{getContactName(plan.contactId)}</p>
                      <p className="text-muted-foreground text-xs">{getPropertyAddress(plan.propertyId)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">{plan.frequency}</Badge>
                    {plan.dayOfWeek && (
                      <Badge variant="secondary" className="capitalize text-xs">{plan.dayOfWeek}</Badge>
                    )}
                    <span className="font-medium text-xs">${plan.pricePerVisit}/visit</span>
                    <Button
                      size="sm"
                      onClick={() => assigningRouteId && assignPlanMutation.mutate({ planId: plan.id, routeId: assigningRouteId })}
                      disabled={assignPlanMutation.isPending}
                      data-testid={`button-add-plan-${plan.id}`}
                    >
                      <Plus className="mr-1 h-3 w-3" /> Add
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-unassigned-plans">
              All active service plans are already assigned to routes.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
