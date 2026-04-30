import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Webhook, WebhookDelivery } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Plus,
  Webhook as WebhookIcon,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  RotateCcw,
} from "lucide-react";

const availableEvents = [
  "contact.created",
  "contact.updated",
  "quote.created",
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

function DeliveryStatusBadge({ status }: { status: string }) {
  if (status === "success") {
    return (
      <Badge variant="default" className="bg-green-600 text-white">
        <CheckCircle className="mr-1 h-3 w-3" />
        Success
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive">
        <XCircle className="mr-1 h-3 w-3" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <Clock className="mr-1 h-3 w-3" />
      Pending
    </Badge>
  );
}

function formatDate(dateStr: string | Date | null) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function DeliveryLogSection({ webhookId }: { webhookId?: string }) {
  const queryKey = webhookId
    ? ["/api/webhooks", webhookId, "deliveries"]
    : ["/api/webhooks/deliveries"];
  const url = webhookId ? `/api/webhooks/${webhookId}/deliveries` : "/api/webhooks/deliveries";

  const { data: deliveries, isLoading } = useQuery<WebhookDelivery[]>({
    queryKey,
    queryFn: () => fetch(url, { credentials: "include" }).then((r) => r.json()),
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!deliveries || deliveries.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-6" data-testid="text-no-deliveries">
        No delivery attempts yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {deliveries.map((delivery) => (
        <Collapsible key={delivery.id}>
          <Card data-testid={`card-delivery-${delivery.id}`}>
            <CollapsibleTrigger asChild>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 cursor-pointer hover-elevate">
                <div className="flex items-center gap-3 flex-wrap">
                  <DeliveryStatusBadge status={delivery.status} />
                  <Badge variant="outline">{delivery.event}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(delivery.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {delivery.responseCode && (
                    <span
                      className="text-xs font-mono text-muted-foreground"
                      data-testid={`text-response-code-${delivery.id}`}
                    >
                      HTTP {delivery.responseCode}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {delivery.attempts}/{5} attempts
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardContent>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 px-3 pb-3">
                <div className="rounded-md bg-muted p-3 space-y-2 text-xs">
                  <div className="flex flex-wrap gap-4">
                    <div>
                      <span className="font-medium text-muted-foreground">Last Attempt:</span>{" "}
                      {formatDate(delivery.lastAttempt)}
                    </div>
                    {delivery.nextRetry && (
                      <div className="flex items-center gap-1">
                        <RotateCcw className="h-3 w-3 text-muted-foreground" />
                        <span className="font-medium text-muted-foreground">Next Retry:</span>{" "}
                        {formatDate(delivery.nextRetry)}
                      </div>
                    )}
                  </div>
                  {delivery.responseBody && (
                    <div>
                      <span className="font-medium text-muted-foreground">Response:</span>
                      <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-xs bg-background rounded p-2 max-h-32 overflow-auto">
                        {delivery.responseBody}
                      </pre>
                    </div>
                  )}
                  <div>
                    <span className="font-medium text-muted-foreground">Payload:</span>
                    <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-xs bg-background rounded p-2 max-h-32 overflow-auto">
                      {JSON.stringify(delivery.payload, null, 2)}
                    </pre>
                  </div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      ))}
    </div>
  );
}

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
        <h1 className="text-2xl font-bold" data-testid="text-webhooks-heading">
          Webhooks
        </h1>
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
              <form
                onSubmit={form.handleSubmit((v) => createMutation.mutate(v))}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Endpoint URL</FormLabel>
                      <FormControl>
                        <Input
                          type="url"
                          placeholder="https://..."
                          {...field}
                          data-testid="input-webhook-url"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="events"
                  render={() => (
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
                  )}
                />
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-webhook-active"
                        />
                      </FormControl>
                      <FormLabel>Active</FormLabel>
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  data-testid="button-submit-webhook"
                >
                  {createMutation.isPending ? "Creating..." : "Create Webhook"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="endpoints" data-testid="tabs-webhooks">
        <TabsList>
          <TabsTrigger value="endpoints" data-testid="tab-endpoints">
            Endpoints
          </TabsTrigger>
          <TabsTrigger value="deliveries" data-testid="tab-deliveries">
            Delivery Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="endpoints" className="space-y-3 mt-4">
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
                        <p
                          className="font-medium text-sm break-all"
                          data-testid={`text-webhook-url-${webhook.id}`}
                        >
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
                        onCheckedChange={(checked) =>
                          toggleMutation.mutate({ id: webhook.id, isActive: checked })
                        }
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
              <CardContent
                className="p-6 text-center text-muted-foreground"
                data-testid="text-no-webhooks"
              >
                No webhooks configured. Create one to receive event notifications.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="deliveries" className="mt-4">
          <DeliveryLogSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
