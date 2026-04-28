import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AutomationRule, Route } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
import { Plus, Zap } from "lucide-react";

const triggers = [
  { value: "lead_created", label: "Lead Created" },
  { value: "quote_created", label: "Quote Created" },
  { value: "service_completed", label: "Service Completed" },
  { value: "payment_failed", label: "Payment Failed" },
  { value: "invoice_created", label: "Invoice Created" },
];

const actionTypes = [
  { value: "create_task", label: "Create Task" },
  { value: "send_email", label: "Send Email" },
  { value: "send_webhook", label: "Send Webhook" },
  { value: "run_skill", label: "Run Skill" },
];

const availableSkills = [
  { value: "optimize_route", label: "Optimize Route" },
  { value: "generate_invoice", label: "Generate Invoice" },
];

const ruleFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  trigger: z.enum(["lead_created", "quote_created", "service_completed", "payment_failed", "invoice_created"]),
  actionType: z.string().min(1, "Action type is required"),
  skillName: z.string().optional(),
  skillRouteId: z.string().optional(),
  description: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.actionType === "run_skill" && !data.skillName) {
    ctx.addIssue({ code: "custom", path: ["skillName"], message: "Skill is required" });
  }
  if (data.actionType === "run_skill" && data.skillName === "optimize_route" && !data.skillRouteId) {
    ctx.addIssue({ code: "custom", path: ["skillRouteId"], message: "Route is required for optimize_route" });
  }
});

type RuleFormValues = z.infer<typeof ruleFormSchema>;

type RouteItem = { id: string; name: string };

function getActionLabel(rule: AutomationRule): string {
  const config = rule.actionConfig;
  if (!config?.type) return "unknown";
  if (config.type === "run_skill") {
    const skill = config.params?.skillName;
    if (typeof skill === "string") {
      let label = `run skill: ${skill.replace(/_/g, " ")}`;
      if (skill === "optimize_route" && config.params?.routeId) {
        label += config.params.routeId === "__all__" ? " (all routes)" : " (specific route)";
      }
      return label;
    }
    return "run skill";
  }
  return config.type.replace(/_/g, " ");
}

export default function Automation() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: rules, isLoading } = useQuery<AutomationRule[]>({
    queryKey: ["/api/automation-rules"],
  });

  const { data: routes } = useQuery<Route[], Error, RouteItem[]>({
    queryKey: ["/api/routes"],
    select: (data) => data.map((r) => ({ id: r.id, name: r.name })),
  });

  const form = useForm<RuleFormValues>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: {
      name: "",
      trigger: "lead_created",
      actionType: "create_task",
      skillName: "",
      skillRouteId: "",
      description: "",
    },
  });

  const watchedActionType = form.watch("actionType");
  const watchedSkillName = form.watch("skillName");

  const createMutation = useMutation({
    mutationFn: async (data: RuleFormValues) => {
      const params: Record<string, unknown> = {};
      if (data.actionType === "run_skill" && data.skillName) {
        params.skillName = data.skillName;
        if (data.skillName === "optimize_route" && data.skillRouteId) {
          params.routeId = data.skillRouteId;
        }
        if (data.skillName === "generate_invoice") {
          params.allPending = true;
        }
      }
      await apiRequest("POST", "/api/automation-rules", {
        name: data.name,
        trigger: data.trigger,
        description: data.description,
        actionConfig: { type: data.actionType, params },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-rules"] });
      toast({ title: "Rule created", description: "Automation rule added." });
      setDialogOpen(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/automation-rules/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-rules"] });
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-automation-heading">Automation</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-rule">
              <Plus className="mr-1 h-4 w-4" /> Create Rule
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Automation Rule</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rule Name</FormLabel>
                    <FormControl><Input {...field} data-testid="input-rule-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (optional)</FormLabel>
                    <FormControl><Input {...field} data-testid="input-rule-description" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="trigger" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Trigger</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-trigger"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {triggers.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="actionType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Action</FormLabel>
                    <Select onValueChange={(v) => { field.onChange(v); form.setValue("skillName", ""); form.setValue("skillRouteId", ""); }} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-action"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {actionTypes.map((a) => (
                          <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                {watchedActionType === "run_skill" && (
                  <FormField control={form.control} name="skillName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Skill</FormLabel>
                      <Select onValueChange={(v) => { field.onChange(v); form.setValue("skillRouteId", ""); }} value={field.value ?? ""}>
                        <FormControl><SelectTrigger data-testid="select-skill-name"><SelectValue placeholder="Select a skill" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {availableSkills.map((s) => (
                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
                {watchedActionType === "run_skill" && watchedSkillName === "optimize_route" && (
                  <FormField control={form.control} name="skillRouteId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Route to optimize</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl><SelectTrigger data-testid="select-skill-route-id"><SelectValue placeholder="Select a route" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="__all__">All active routes</SelectItem>
                          {(routes ?? []).map((r) => (
                            <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-rule">
                  {createMutation.isPending ? "Creating..." : "Create Rule"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : rules && rules.length > 0 ? (
        <div className="space-y-3">
          {rules.map((rule) => (
            <Card key={rule.id} data-testid={`card-rule-${rule.id}`}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div className="flex items-center gap-3">
                  <Zap className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="font-medium" data-testid={`text-rule-name-${rule.id}`}>{rule.name}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <Badge variant="outline" data-testid={`badge-trigger-${rule.id}`}>
                        {rule.trigger.replace(/_/g, " ")}
                      </Badge>
                      <Badge variant="outline" data-testid={`badge-action-${rule.id}`}>
                        {getActionLabel(rule)}
                      </Badge>
                    </div>
                  </div>
                </div>
                <Switch
                  checked={rule.isActive}
                  onCheckedChange={(checked) => toggleMutation.mutate({ id: rule.id, isActive: checked })}
                  data-testid={`switch-rule-${rule.id}`}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-no-rules">
            No automation rules. Create one to automate your workflows.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
