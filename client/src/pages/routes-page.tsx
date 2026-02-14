import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Route } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Plus, MapPin } from "lucide-react";

const daysOfWeek = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const routeFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  dayOfWeek: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
  technicianId: z.string().optional(),
  color: z.string().default("#3b82f6"),
});

type RouteFormValues = z.infer<typeof routeFormSchema>;

export default function RoutesPage() {
  const { toast } = useToast();
  const [selectedDay, setSelectedDay] = useState("monday");
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: routes, isLoading } = useQuery<Route[]>({
    queryKey: [`/api/routes?dayOfWeek=${selectedDay}`],
  });

  const form = useForm<RouteFormValues>({
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
      await apiRequest("POST", "/api/routes", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      toast({ title: "Route created", description: "New route added successfully." });
      setDialogOpen(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-routes-heading">Routes</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-route">
              <Plus className="mr-1 h-4 w-4" /> Create Route
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Route</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
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
                <FormField control={form.control} name="color" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Color</FormLabel>
                    <FormControl><Input type="color" {...field} data-testid="input-route-color" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
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
          {routes.map((route) => (
            <Card key={route.id} data-testid={`card-route-${route.id}`}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{ backgroundColor: route.color || "#3b82f6" }}
                  />
                  <div>
                    <p className="font-medium" data-testid={`text-route-name-${route.id}`}>{route.name}</p>
                    <p className="text-sm text-muted-foreground capitalize">{route.dayOfWeek}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="secondary" data-testid={`badge-route-tech-${route.id}`}>
                    {route.technicianId ? "Assigned" : "Unassigned"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-no-routes">
            No routes for {selectedDay}. Create one to get started.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
