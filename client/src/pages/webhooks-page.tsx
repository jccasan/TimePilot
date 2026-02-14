import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Webhook } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Plus, Webhook as WebhookIcon, Trash2 } from "lucide-react";

const availableEvents = [
  "contact.created",
  "contact.updated",
  "visit.completed",
  "invoice.created",
  "invoice.paid",
  "payment.failed",
];

const webhookFormSchema = z.object({
  url: z.string().url("Must be a valid URL"),
  events: z.array(z.string()).min(1, "Select at least one event"),
  isActive: z.boolean().default(true),
});

type WebhookFormValues = z.infer<typeof webhookFormSchema>;

export default function WebhooksPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: webhooks, isLoading } = useQuery<Webhook[]>({
    queryKey: ["/api/webhooks"],
  });

  const form = useForm<WebhookFormValues>({
    resolver: zodResolver(webhookFormSchema),
    defaultValues: {
      url: "",
      events: [],
      isActive: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: WebhookFormValues) => {
      await apiRequest("POST", "/api/webhooks", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks"] });
      toast({ title: "Webhook created", description: "New webhook endpoint added." });
      setDialogOpen(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/webhooks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks"] });
      toast({ title: "Deleted", description: "Webhook removed." });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/webhooks/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks"] });
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-webhooks-heading">Webhooks</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-webhook">
              <Plus className="mr-1 h-4 w-4" /> Create Webhook
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Webhook</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
                <FormField control={form.control} name="url" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Endpoint URL</FormLabel>
                    <FormControl><Input type="url" placeholder="https://..." {...field} data-testid="input-webhook-url" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="events" render={() => (
                  <FormItem>
                    <FormLabel>Events</FormLabel>
                    <div className="space-y-2">
                      {availableEvents.map((event) => (
                        <FormField
                          key={event}
                          control={form.control}
                          name="events"
                          render={({ field }) => (
                            <FormItem className="flex items-center gap-2 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(event)}
                                  onCheckedChange={(checked) => {
                                    const current = field.value || [];
                                    if (checked) {
                                      field.onChange([...current, event]);
                                    } else {
                                      field.onChange(current.filter((e: string) => e !== event));
                                    }
                                  }}
                                  data-testid={`checkbox-event-${event}`}
                                />
                              </FormControl>
                              <span className="text-sm font-mono">{event}</span>
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="isActive" render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-webhook-active" />
                    </FormControl>
                    <FormLabel>Active</FormLabel>
                  </FormItem>
                )} />
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-webhook">
                  {createMutation.isPending ? "Creating..." : "Create Webhook"}
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
      ) : webhooks && webhooks.length > 0 ? (
        <div className="space-y-3">
          {webhooks.map((webhook) => (
            <Card key={webhook.id} data-testid={`card-webhook-${webhook.id}`}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div className="flex items-center gap-3">
                  <WebhookIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="font-medium text-sm break-all" data-testid={`text-webhook-url-${webhook.id}`}>
                      {webhook.url}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(webhook.events as string[])?.map((event) => (
                        <Badge key={event} variant="outline">
                          {event}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={webhook.isActive}
                    onCheckedChange={(checked) => toggleMutation.mutate({ id: webhook.id, isActive: checked })}
                    data-testid={`switch-webhook-${webhook.id}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteMutation.mutate(webhook.id)}
                    data-testid={`button-delete-webhook-${webhook.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-no-webhooks">
            No webhooks configured. Create one to receive event notifications.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
