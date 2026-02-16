import { useState, useMemo, useCallback } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Trash2, Users, MapPin, Pencil, GripVertical, ArrowRight, Route as RouteIcon, Loader2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";

const daysOfWeek = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const UNASSIGNED_ID = "__unassigned__";

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

interface MoveOption {
  id: string;
  label: string;
  color?: string;
}

function DraggablePlanCard({
  plan,
  contactName,
  propertyAddress,
  moveOptions,
  onMove,
  stopNumber,
}: {
  plan: ServicePlan;
  contactName: string;
  propertyAddress: string;
  moveOptions: MoveOption[];
  onMove: (planId: string, targetRouteId: string | null) => void;
  stopNumber?: number;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: plan.id,
    data: { plan },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 text-sm border rounded-md p-2 bg-background transition-opacity ${isDragging ? "opacity-30" : ""}`}
      data-testid={`draggable-plan-${plan.id}`}
    >
      <div className="cursor-grab active:cursor-grabbing touch-none" {...listeners} {...attributes}>
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </div>
      {stopNumber ? (
        <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0" data-testid={`badge-stop-number-${plan.id}`}>
          {stopNumber}
        </span>
      ) : (
        <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{contactName}</p>
        <p className="text-muted-foreground text-xs truncate">{propertyAddress}</p>
      </div>
      <Badge variant="outline" className="capitalize shrink-0">{plan.frequency}</Badge>
      <span className="font-medium text-xs shrink-0 whitespace-nowrap">${plan.pricePerVisit}/visit</span>
      {moveOptions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0" data-testid={`button-move-plan-${plan.id}`}>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {moveOptions.map((opt) => (
              <DropdownMenuItem
                key={opt.id}
                onClick={() => onMove(plan.id, opt.id === UNASSIGNED_ID ? null : opt.id)}
                data-testid={`menu-move-${plan.id}-to-${opt.id}`}
              >
                {opt.color && (
                  <div className="w-2.5 h-2.5 rounded-full shrink-0 mr-1.5" style={{ backgroundColor: opt.color }} />
                )}
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function DroppableContainer({
  id,
  children,
  isOver,
  label,
}: {
  id: string;
  children: React.ReactNode;
  isOver: boolean;
  label?: string;
}) {
  const { setNodeRef } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[60px] rounded-md p-2 space-y-1.5 transition-colors ${isOver ? "bg-primary/10 ring-2 ring-primary/30" : ""}`}
      data-testid={`drop-zone-${id}`}
    >
      {children}
    </div>
  );
}

export default function RoutesPage() {
  const { toast } = useToast();
  const [selectedDay, setSelectedDay] = useState("monday");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overContainerId, setOverContainerId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

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
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
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
    },
    onError: (error: Error) => {
      toast({ title: "Error moving client", description: error.message, variant: "destructive" });
    },
  });

  const optimizeMutation = useMutation({
    mutationFn: async (routeId: string) => {
      const res = await apiRequest("POST", `/api/routes/${routeId}/optimize`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
      if (data.optimized) {
        const startInfo = data.hasStartPoint ? " from home base" : "";
        toast({ title: "Route optimized", description: `${data.stopCount} stops reordered${startInfo}. Estimated distance: ${data.totalDistance} mi` });
      } else {
        toast({ title: "Could not optimize", description: data.message, variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const getPlansForRoute = useCallback((routeId: string) => {
    return (servicePlans?.filter(sp => sp.routeId === routeId && sp.isActive) || [])
      .sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0));
  }, [servicePlans]);

  const unassignedPlans = useMemo(() => {
    return servicePlans?.filter(sp => !sp.routeId && sp.isActive) || [];
  }, [servicePlans]);

  const getContactName = useCallback((contactId: string) => {
    const c = contacts?.find(ct => ct.id === contactId);
    return c ? `${c.firstName} ${c.lastName}`.trim() : "Unknown";
  }, [contacts]);

  const getPropertyAddress = useCallback((propertyId: string) => {
    const p = properties?.find(pr => pr.id === propertyId);
    return p ? `${p.streetAddress}` : "Unknown";
  }, [properties]);

  const getTechName = useCallback((techId: string | null) => {
    if (!techId || !team) return null;
    const t = team.find(m => m.id === techId);
    return t ? `${t.firstName} ${t.lastName}`.trim() : null;
  }, [team]);

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

  const handleMovePlan = useCallback((planId: string, targetRouteId: string | null) => {
    assignPlanMutation.mutate({ planId, routeId: targetRouteId });
  }, [assignPlanMutation]);

  const getMoveOptions = useCallback((currentRouteId: string | null): MoveOption[] => {
    const options: MoveOption[] = [];
    if (currentRouteId) {
      options.push({ id: UNASSIGNED_ID, label: "Unassigned" });
    }
    routes?.forEach((r) => {
      if (r.id !== currentRouteId) {
        options.push({ id: r.id, label: r.name, color: r.color || "#3b82f6" });
      }
    });
    return options;
  }, [routes]);

  const activePlan = useMemo(() => {
    if (!activeDragId || !servicePlans) return null;
    return servicePlans.find(sp => sp.id === activeDragId) || null;
  }, [activeDragId, servicePlans]);

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(event.active.id as string);
  }

  function handleDragOver(event: DragOverEvent) {
    const overId = event.over?.id as string | null;
    setOverContainerId(overId);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    setOverContainerId(null);

    const { active, over } = event;
    if (!over) return;

    const planId = active.id as string;
    const targetContainer = over.id as string;

    const plan = servicePlans?.find(sp => sp.id === planId);
    if (!plan) return;

    const currentRouteId = plan.routeId || UNASSIGNED_ID;
    if (currentRouteId === targetContainer) return;

    const newRouteId = targetContainer === UNASSIGNED_ID ? null : targetContainer;
    assignPlanMutation.mutate({ planId, routeId: newRouteId });
  }

  function handleDragCancel() {
    setActiveDragId(null);
    setOverContainerId(null);
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
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
            <div className="space-y-3">
              {routes && routes.length > 0 ? (
                routes.map((route) => {
                  const plans = getPlansForRoute(route.id);
                  const techName = getTechName(route.technicianId);
                  const isOverThis = overContainerId === route.id;
                  return (
                    <Card key={route.id} data-testid={`card-route-${route.id}`}>
                      <CardContent className="p-4 space-y-2">
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
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => optimizeMutation.mutate(route.id)}
                                  disabled={plans.length < 2 || optimizeMutation.isPending}
                                  data-testid={`button-optimize-route-${route.id}`}
                                >
                                  {optimizeMutation.isPending && optimizeMutation.variables === route.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <RouteIcon className="h-4 w-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Optimize stop order</TooltipContent>
                            </Tooltip>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(route)}
                              data-testid={`button-edit-route-${route.id}`}
                              title="Edit route"
                            >
                              <Pencil className="h-4 w-4" />
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

                        <DroppableContainer id={route.id} isOver={isOverThis}>
                          {plans.length > 0 ? (
                            plans.map((plan, idx) => (
                              <DraggablePlanCard
                                key={plan.id}
                                plan={plan}
                                contactName={getContactName(plan.contactId)}
                                propertyAddress={getPropertyAddress(plan.propertyId)}
                                moveOptions={getMoveOptions(route.id)}
                                onMove={handleMovePlan}
                                stopNumber={plan.stopOrder > 0 ? plan.stopOrder : undefined}
                              />
                            ))
                          ) : (
                            <p className="text-xs text-muted-foreground text-center py-3">
                              Drag clients here to add stops
                            </p>
                          )}
                        </DroppableContainer>
                      </CardContent>
                    </Card>
                  );
                })
              ) : (
                <Card>
                  <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-no-routes">
                    No routes for {selectedDay}. Create one to get started.
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="lg:sticky lg:top-0">
              <Card>
                <CardContent className="p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-sm" data-testid="text-unassigned-heading">Unassigned Clients</p>
                    <Badge variant="secondary">{unassignedPlans.length}</Badge>
                  </div>
                  <DroppableContainer id={UNASSIGNED_ID} isOver={overContainerId === UNASSIGNED_ID}>
                    {unassignedPlans.length > 0 ? (
                      unassignedPlans.map((plan) => (
                        <DraggablePlanCard
                          key={plan.id}
                          plan={plan}
                          contactName={getContactName(plan.contactId)}
                          propertyAddress={getPropertyAddress(plan.propertyId)}
                          moveOptions={getMoveOptions(null)}
                          onMove={handleMovePlan}
                        />
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground text-center py-3" data-testid="text-no-unassigned-plans">
                        All active service plans are assigned to routes.
                      </p>
                    )}
                  </DroppableContainer>
                </CardContent>
              </Card>
            </div>
          </div>

          <DragOverlay>
            {activePlan ? (
              <div className="flex items-center gap-2 text-sm border rounded-md p-2 bg-background shadow-lg opacity-90 max-w-sm">
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{getContactName(activePlan.contactId)}</p>
                  <p className="text-muted-foreground text-xs truncate">{getPropertyAddress(activePlan.propertyId)}</p>
                </div>
                <Badge variant="outline" className="capitalize shrink-0">{activePlan.frequency}</Badge>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
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
    </div>
  );
}
