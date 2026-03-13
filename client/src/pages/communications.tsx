import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Message, Contact } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { Mail, MessageSquare, Send, ArrowUpRight, ArrowDownLeft, AlertCircle, CheckCircle2 } from "lucide-react";
import { ClientInfoPopover } from "@/components/client-info-popover";

const emailFormSchema = z.object({
  contactId: z.string().optional(),
  to: z.string().email("Valid email required"),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Message body is required"),
});

const smsFormSchema = z.object({
  contactId: z.string().optional(),
  to: z.string().min(10, "Valid phone number required"),
  body: z.string().min(1, "Message is required"),
});

type EmailFormValues = z.infer<typeof emailFormSchema>;
type SmsFormValues = z.infer<typeof smsFormSchema>;

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    sent: "default",
    delivered: "default",
    received: "secondary",
    queued: "outline",
    failed: "destructive",
  };
  const icons: Record<string, any> = {
    sent: CheckCircle2,
    delivered: CheckCircle2,
    failed: AlertCircle,
  };
  const Icon = icons[status];
  return (
    <Badge variant={variants[status] || "outline"} data-testid={`badge-status-${status}`}>
      {Icon && <Icon className="h-3 w-3 mr-1" />}
      {status}
    </Badge>
  );
}

function DirectionIcon({ direction }: { direction: string }) {
  if (direction === "outbound") return <ArrowUpRight className="h-4 w-4 text-blue-500 dark:text-blue-400" />;
  return <ArrowDownLeft className="h-4 w-4 text-green-500 dark:text-green-400" />;
}

export default function Communications() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("all");
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [smsDialogOpen, setSmsDialogOpen] = useState(false);

  const channelFilter = activeTab === "all" ? undefined : activeTab;

  const { data: messages, isLoading } = useQuery<Message[]>({
    queryKey: ["/api/messages", channelFilter],
    queryFn: async () => {
      const url = channelFilter ? `/api/messages?channel=${channelFilter}` : "/api/messages";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const { data: config } = useQuery<{ email: { configured: boolean }; sms: { configured: boolean; phoneNumber: string } }>({
    queryKey: ["/api/messages/config"],
  });

  const emailForm = useForm<EmailFormValues>({
    resolver: zodResolver(emailFormSchema),
    defaultValues: { contactId: "", to: "", subject: "", body: "" },
  });

  const smsForm = useForm<SmsFormValues>({
    resolver: zodResolver(smsFormSchema),
    defaultValues: { contactId: "", to: "", body: "" },
  });

  const sendEmailMutation = useMutation({
    mutationFn: async (data: EmailFormValues) => {
      await apiRequest("POST", "/api/messages/email", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      toast({ title: "Email sent" });
      setEmailDialogOpen(false);
      emailForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send email", description: error.message, variant: "destructive" });
    },
  });

  const sendSmsMutation = useMutation({
    mutationFn: async (data: SmsFormValues) => {
      await apiRequest("POST", "/api/messages/sms", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      toast({ title: "SMS sent" });
      setSmsDialogOpen(false);
      smsForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send SMS", description: error.message, variant: "destructive" });
    },
  });

  const handleContactSelectEmail = (contactId: string) => {
    emailForm.setValue("contactId", contactId);
    const contact = contacts?.find(c => c.id === contactId);
    if (contact?.email) emailForm.setValue("to", contact.email);
  };

  const handleContactSelectSms = (contactId: string) => {
    smsForm.setValue("contactId", contactId);
    const contact = contacts?.find(c => c.id === contactId);
    if (contact?.phone) smsForm.setValue("to", contact.phone);
  };

  const getContactName = (contactId: string | null) => {
    if (!contactId) return null;
    const c = contacts?.find(ct => ct.id === contactId);
    return c ? `${c.firstName} ${c.lastName}`.trim() : null;
  };

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-communications-heading">Communications</h1>
        <div className="flex items-center gap-2">
          <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-compose-email">
                <Mail className="mr-1 h-4 w-4" /> Send Email
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Compose Email</DialogTitle>
              </DialogHeader>
              {!config?.email?.configured && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0" /> SendGrid API key not configured
                </div>
              )}
              <Form {...emailForm}>
                <form onSubmit={emailForm.handleSubmit((v) => sendEmailMutation.mutate(v))} className="space-y-4">
                  <FormField control={emailForm.control} name="contactId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact (optional)</FormLabel>
                      <Select onValueChange={(v) => { field.onChange(v); handleContactSelectEmail(v); }} value={field.value || ""}>
                        <FormControl><SelectTrigger data-testid="select-email-contact"><SelectValue placeholder="Select a contact" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {contacts?.filter(c => c.email).map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName} - {c.email}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={emailForm.control} name="to" render={({ field }) => (
                    <FormItem>
                      <FormLabel>To</FormLabel>
                      <FormControl><Input {...field} type="email" data-testid="input-email-to" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={emailForm.control} name="subject" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subject</FormLabel>
                      <FormControl><Input {...field} data-testid="input-email-subject" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={emailForm.control} name="body" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Message</FormLabel>
                      <FormControl><Textarea {...field} rows={5} data-testid="textarea-email-body" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" disabled={sendEmailMutation.isPending} data-testid="button-send-email">
                    <Send className="mr-1 h-4 w-4" />
                    {sendEmailMutation.isPending ? "Sending..." : "Send Email"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          <Dialog open={smsDialogOpen} onOpenChange={setSmsDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-compose-sms">
                <MessageSquare className="mr-1 h-4 w-4" /> Send SMS
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Send Text Message</DialogTitle>
              </DialogHeader>
              {!config?.sms?.configured && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0" /> Twilio credentials not configured
                </div>
              )}
              {config?.sms?.phoneNumber && (
                <p className="text-sm text-muted-foreground">From: {config.sms.phoneNumber}</p>
              )}
              <Form {...smsForm}>
                <form onSubmit={smsForm.handleSubmit((v) => sendSmsMutation.mutate(v))} className="space-y-4">
                  <FormField control={smsForm.control} name="contactId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact (optional)</FormLabel>
                      <Select onValueChange={(v) => { field.onChange(v); handleContactSelectSms(v); }} value={field.value || ""}>
                        <FormControl><SelectTrigger data-testid="select-sms-contact"><SelectValue placeholder="Select a contact" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {contacts?.filter(c => c.phone).map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName} - {c.phone}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={smsForm.control} name="to" render={({ field }) => (
                    <FormItem>
                      <FormLabel>To</FormLabel>
                      <FormControl><Input {...field} data-testid="input-sms-to" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={smsForm.control} name="body" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Message</FormLabel>
                      <FormControl><Textarea {...field} rows={3} data-testid="textarea-sms-body" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" disabled={sendSmsMutation.isPending} data-testid="button-send-sms">
                    <Send className="mr-1 h-4 w-4" />
                    {sendSmsMutation.isPending ? "Sending..." : "Send SMS"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Email</p>
              <Badge variant={config?.email?.configured ? "default" : "destructive"} data-testid="badge-email-status">
                {config?.email?.configured ? "Connected" : "Not Configured"}
              </Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">SMS</p>
              <Badge variant={config?.sms?.configured ? "default" : "destructive"} data-testid="badge-sms-status">
                {config?.sms?.configured ? "Connected" : "Not Configured"}
              </Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Send className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Total Messages</p>
              <p className="text-lg font-semibold" data-testid="text-total-messages">{messages?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all" data-testid="tab-all-messages">All</TabsTrigger>
          <TabsTrigger value="email" data-testid="tab-email-messages">Email</TabsTrigger>
          <TabsTrigger value="sms" data-testid="tab-sms-messages">SMS</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : messages && messages.length > 0 ? (
            <div className="space-y-2">
              {messages.map((msg) => (
                <Card key={msg.id} data-testid={`card-message-${msg.id}`}>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="mt-0.5">
                          <DirectionIcon direction={msg.direction} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">
                              {msg.channel === "email" ? <Mail className="h-3 w-3 mr-1" /> : <MessageSquare className="h-3 w-3 mr-1" />}
                              {msg.channel}
                            </Badge>
                            <StatusBadge status={msg.status} />
                            {msg.contactId && getContactName(msg.contactId) && (
                              <ClientInfoPopover contactId={msg.contactId}>
                                <span className="text-sm text-muted-foreground">{getContactName(msg.contactId)}</span>
                              </ClientInfoPopover>
                            )}
                          </div>
                          <div className="mt-1 text-sm">
                            <span className="text-muted-foreground">{msg.direction === "outbound" ? "To" : "From"}: </span>
                            <span>{msg.direction === "outbound" ? msg.toAddress : msg.fromAddress}</span>
                          </div>
                          {msg.subject && (
                            <p className="font-medium mt-1 truncate" data-testid={`text-msg-subject-${msg.id}`}>{msg.subject}</p>
                          )}
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{msg.body}</p>
                          {msg.errorMessage && (
                            <p className="text-sm text-destructive mt-1">{msg.errorMessage}</p>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(msg.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground" data-testid="text-no-messages">
                No messages yet. Send an email or SMS to get started.
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
