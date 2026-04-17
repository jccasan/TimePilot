import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
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
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { ChevronDown, ChevronUp, FileText, CalendarDays, Send, CheckCircle2 } from "lucide-react";

const contactFormSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  streetAddress: z.string().optional().or(z.literal("")),
  address2: z.string().optional().or(z.literal("")),
  city: z.string().optional().or(z.literal("")),
  state: z.string().optional().or(z.literal("")),
  zipCode: z.string().optional().or(z.literal("")),
  yardSize: z.string().optional().or(z.literal("")),
  numberOfDogs: z.coerce.number().min(0).optional(),
  serviceFrequency: z.string().optional().or(z.literal("")),
  leadSource: z.string().optional().or(z.literal("")),
  referralSource: z.string().optional().or(z.literal("")),
  serviceDay: z.string().optional().or(z.literal("")),
  status: z.enum(["lead", "estimate", "active", "paused", "cancelled"]),
});

type ContactFormValues = z.infer<typeof contactFormSchema>;

interface AddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddContactDialog({ open, onOpenChange }: AddContactDialogProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [showFullForm, setShowFullForm] = useState(false);
  const [createdContact, setCreatedContact] = useState<{ id: string; firstName: string } | null>(null);
  const [sendingPortalInvite, setSendingPortalInvite] = useState(false);

  const { data: leadSources = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/lead-sources"],
    enabled: open,
  });

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      streetAddress: "",
      address2: "",
      city: "",
      state: "",
      zipCode: "",
      yardSize: "",
      numberOfDogs: undefined,
      serviceFrequency: "",
      leadSource: "",
      referralSource: "",
      serviceDay: "",
      status: "lead",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: ContactFormValues) => {
      const res = await apiRequest("POST", "/api/contacts", data);
      return res.json();
    },
    onSuccess: (result: Record<string, unknown>) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      form.reset();
      setCreatedContact({ id: result.id as string, firstName: result.firstName as string });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleClose = () => {
    form.reset();
    setShowFullForm(false);
    setCreatedContact(null);
    setSendingPortalInvite(false);
    onOpenChange(false);
  };

  const handleNavigateAction = (path: string) => {
    handleClose();
    navigate(path);
  };

  const handleSendPortalInvite = async () => {
    if (!createdContact) return;
    setSendingPortalInvite(true);
    try {
      await apiRequest("POST", "/api/contacts/bulk/send-portal-link", { contactIds: [createdContact.id] });
      toast({ title: "Portal invite sent", description: `Invite sent to ${createdContact.firstName}.` });
      handleClose();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setSendingPortalInvite(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) handleClose();
      else onOpenChange(isOpen);
    }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Contact</DialogTitle>
        </DialogHeader>

        {createdContact ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <p className="font-medium">{createdContact.firstName} was added successfully!</p>
            </div>
            <p className="text-sm text-muted-foreground">What would you like to do next?</p>
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                data-testid="button-next-create-quote"
                onClick={() => handleNavigateAction(`/quotes?create=true&contactId=${createdContact.id}`)}
              >
                <FileText className="h-4 w-4 text-green-600" />
                Create a Quote
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                data-testid="button-next-schedule-service"
                onClick={() => handleNavigateAction(`/scheduling?addJob=1&contactId=${createdContact.id}`)}
              >
                <CalendarDays className="h-4 w-4 text-blue-600" />
                Schedule a Service
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                data-testid="button-next-send-portal"
                disabled={sendingPortalInvite}
                onClick={handleSendPortalInvite}
              >
                <Send className="h-4 w-4 text-purple-600" />
                {sendingPortalInvite ? "Sending..." : "Send Portal Invite"}
              </Button>
            </div>
            <Button
              variant="ghost"
              className="w-full"
              data-testid="button-next-done"
              onClick={handleClose}
            >
              Done
            </Button>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-first-name" autoFocus />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-last-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} data-testid="input-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-status">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="lead">Lead</SelectItem>
                        <SelectItem value="estimate">Estimate</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="paused">Paused</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <button
                type="button"
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-full py-0.5"
                onClick={() => setShowFullForm(v => !v)}
                data-testid="button-toggle-full-form"
              >
                {showFullForm
                  ? <ChevronUp className="h-3.5 w-3.5" />
                  : <ChevronDown className="h-3.5 w-3.5" />
                }
                {showFullForm ? "Hide extra details" : "More details (address, dogs, source…)"}
              </button>

              {showFullForm && (
                <div className="space-y-4 border-t pt-4">
                  <FormField
                    control={form.control}
                    name="streetAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Street Address</FormLabel>
                        <FormControl>
                          <AddressAutocomplete
                            value={field.value || ""}
                            onChange={field.onChange}
                            onSelect={(addr) => {
                              form.setValue("streetAddress", addr.streetAddress);
                              form.setValue("city", addr.city);
                              form.setValue("state", addr.state);
                              form.setValue("zipCode", addr.zipCode);
                            }}
                            data-testid="input-street-address"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="address2"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address 2 (Suite, Apt, etc.)</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-address2" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-3 gap-3">
                    <FormField control={form.control} name="city" render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl><Input {...field} data-testid="input-city" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="state" render={({ field }) => (
                      <FormItem>
                        <FormLabel>State</FormLabel>
                        <FormControl><Input {...field} data-testid="input-state" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="zipCode" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Zip Code</FormLabel>
                        <FormControl><Input {...field} data-testid="input-zip-code" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="yardSize"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Yard Size</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-yard-size">
                                <SelectValue placeholder="Select size" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="0.25_or_less">0.25 Acre or Less</SelectItem>
                              <SelectItem value="0.26_0.5">.26-.5 Acre</SelectItem>
                              <SelectItem value="0.51_0.75">.51-.75 Acre</SelectItem>
                              <SelectItem value="0.75_1">.75-1 Acre</SelectItem>
                              <SelectItem value="over_1">Over 1 Acre</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="numberOfDogs"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Number of Dogs</FormLabel>
                          <FormControl>
                            <Input type="number" min="0" {...field} value={field.value ?? ""} data-testid="input-number-of-dogs" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="serviceFrequency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service Frequency</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-service-frequency">
                              <SelectValue placeholder="Select frequency" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="1_per_week">1x per week</SelectItem>
                            <SelectItem value="2_per_week">2x per week</SelectItem>
                            <SelectItem value="biweekly">Bi-weekly</SelectItem>
                            <SelectItem value="as_needed">As needed</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="leadSource"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Lead Source</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-lead-source">
                              <SelectValue placeholder="Select source" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {leadSources.map((source) => (
                              <SelectItem key={source.id} value={source.name}>{source.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="referralSource"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Referral Source</FormLabel>
                        <FormDescription>Person who referred this customer</FormDescription>
                        <FormControl>
                          <Input {...field} placeholder="e.g. John Smith" data-testid="input-referral-source" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="serviceDay"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service Day</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-service-day">
                              <SelectValue placeholder="Select day" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="tbd">TBD</SelectItem>
                            <SelectItem value="monday">Monday</SelectItem>
                            <SelectItem value="tuesday">Tuesday</SelectItem>
                            <SelectItem value="wednesday">Wednesday</SelectItem>
                            <SelectItem value="thursday">Thursday</SelectItem>
                            <SelectItem value="friday">Friday</SelectItem>
                            <SelectItem value="saturday">Saturday</SelectItem>
                            <SelectItem value="sunday">Sunday</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              <Button type="submit" disabled={createMutation.isPending} className="w-full" data-testid="button-submit-contact">
                {createMutation.isPending ? "Creating..." : "Create Contact"}
              </Button>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
