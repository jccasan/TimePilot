import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Contact, Property, ServicePlan, Tag } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
import { Label } from "@/components/ui/label";
import { ArrowLeft, Plus, X, Edit2, Save, Receipt, CreditCard, Shield, ShieldOff, Trash2 } from "lucide-react";
import { AddressAutocomplete } from "@/components/address-autocomplete";

const statusColors: Record<string, string> = {
  lead: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  estimate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  paused: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const propertyFormSchema = z.object({
  streetAddress: z.string().min(1, "Street address is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  zipCode: z.string().min(1, "Zip code is required"),
  numberOfDogs: z.coerce.number().min(0).optional(),
  yardSize: z.string().optional(),
  gateCode: z.string().optional(),
  specialInstructions: z.string().optional(),
});

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [propertyDialogOpen, setPropertyDialogOpen] = useState(false);
  const [editNotes, setEditNotes] = useState("");
  const [newTagName, setNewTagName] = useState("");

  const { data: contact, isLoading } = useQuery<Contact>({
    queryKey: ["/api/contacts", id],
  });

  const { data: properties } = useQuery<Property[]>({
    queryKey: ["/api/properties" + `?contactId=${id}`],
    enabled: !!id,
  });

  const { data: servicePlans } = useQuery<ServicePlan[]>({
    queryKey: ["/api/service-plans" + `?contactId=${id}`],
    enabled: !!id,
  });

  const { data: contactTags } = useQuery<Tag[]>({
    queryKey: ["/api/contacts", id, "tags"],
    enabled: !!id,
  });

  const { data: allTags } = useQuery<Tag[]>({
    queryKey: ["/api/tags"],
  });

  const [editForm, setEditForm] = useState<Partial<Contact>>({});

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<Contact>) => {
      await apiRequest("PATCH", `/api/contacts/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({ title: "Updated", description: "Contact updated successfully." });
      setEditing(false);
    },
  });

  const updateNotesMutation = useMutation({
    mutationFn: async (notes: string) => {
      await apiRequest("PATCH", `/api/contacts/${id}`, { notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", id] });
      toast({ title: "Updated", description: "Notes saved." });
    },
  });

  const propertyForm = useForm({
    resolver: zodResolver(propertyFormSchema),
    defaultValues: {
      streetAddress: "",
      city: "",
      state: "",
      zipCode: "",
      numberOfDogs: 1,
      yardSize: "",
      gateCode: "",
      specialInstructions: "",
    },
  });

  const createPropertyMutation = useMutation({
    mutationFn: async (data: z.infer<typeof propertyFormSchema>) => {
      await apiRequest("POST", "/api/properties", { ...data, contactId: id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({ title: "Property added", description: "New property added." });
      setPropertyDialogOpen(false);
      propertyForm.reset();
    },
  });

  const addTagMutation = useMutation({
    mutationFn: async (tagId: string) => {
      await apiRequest("POST", `/api/contacts/${id}/tags`, { tagId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", id, "tags"] });
      toast({ title: "Tag added" });
    },
  });

  const removeTagMutation = useMutation({
    mutationFn: async (tagId: string) => {
      await apiRequest("DELETE", `/api/contacts/${id}/tags/${tagId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", id, "tags"] });
      toast({ title: "Tag removed" });
    },
  });

  const createTagMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/tags", { name });
      return res.json();
    },
    onSuccess: (tag: Tag) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
      addTagMutation.mutate(tag.id);
      setNewTagName("");
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-muted-foreground" data-testid="text-contact-not-found">Contact not found</p>
        <Button asChild variant="ghost" className="mt-2">
          <Link href="/contacts">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to Contacts
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <Button asChild variant="ghost" data-testid="button-back-contacts">
        <Link href="/contacts">
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to Contacts
        </Link>
      </Button>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-xl" data-testid="text-contact-detail-name">
            {contact.firstName} {contact.lastName}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className={statusColors[contact.status] || ""} data-testid="badge-contact-status">
              {contact.status}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setEditing(!editing);
                setEditForm({
                  firstName: contact.firstName,
                  lastName: contact.lastName,
                  email: contact.email,
                  phone: contact.phone,
                  streetAddress: contact.streetAddress,
                  address2: contact.address2,
                  city: contact.city,
                  state: contact.state,
                  zipCode: contact.zipCode,
                  yardSize: contact.yardSize,
                  numberOfDogs: contact.numberOfDogs,
                  serviceFrequency: contact.serviceFrequency,
                  status: contact.status,
                });
              }}
              data-testid="button-edit-contact"
            >
              <Edit2 />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  placeholder="First Name"
                  value={editForm.firstName || ""}
                  onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                  data-testid="input-edit-first-name"
                />
                <Input
                  placeholder="Last Name"
                  value={editForm.lastName || ""}
                  onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                  data-testid="input-edit-last-name"
                />
                <Input
                  placeholder="Email"
                  value={editForm.email || ""}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  data-testid="input-edit-email"
                />
                <Input
                  placeholder="Phone"
                  value={editForm.phone || ""}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  data-testid="input-edit-phone"
                />
              </div>
              <AddressAutocomplete
                value={editForm.streetAddress || ""}
                onChange={(v) => setEditForm({ ...editForm, streetAddress: v })}
                onSelect={(addr) => setEditForm({
                  ...editForm,
                  streetAddress: addr.streetAddress,
                  city: addr.city,
                  state: addr.state,
                  zipCode: addr.zipCode,
                })}
                placeholder="Street Address"
                data-testid="input-edit-street-address"
              />
              <Input
                placeholder="Address 2 (Suite, Apt, etc.)"
                value={editForm.address2 || ""}
                onChange={(e) => setEditForm({ ...editForm, address2: e.target.value })}
                data-testid="input-edit-address2"
              />
              <div className="grid grid-cols-3 gap-3">
                <Input
                  placeholder="City"
                  value={editForm.city || ""}
                  onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                  data-testid="input-edit-city"
                />
                <Input
                  placeholder="State"
                  value={editForm.state || ""}
                  onChange={(e) => setEditForm({ ...editForm, state: e.target.value })}
                  data-testid="input-edit-state"
                />
                <Input
                  placeholder="Zip Code"
                  value={editForm.zipCode || ""}
                  onChange={(e) => setEditForm({ ...editForm, zipCode: e.target.value })}
                  data-testid="input-edit-zip-code"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Select
                  value={editForm.yardSize || ""}
                  onValueChange={(v) => setEditForm({ ...editForm, yardSize: v })}
                >
                  <SelectTrigger data-testid="select-edit-yard-size">
                    <SelectValue placeholder="Lot Size" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.25_or_less">0.25 Acre or Less</SelectItem>
                    <SelectItem value="0.26_0.5">.26-.5 Acre</SelectItem>
                    <SelectItem value="0.51_0.75">.51-.75 Acre</SelectItem>
                    <SelectItem value="0.75_1">.75-1 Acre</SelectItem>
                    <SelectItem value="over_1">Over 1 Acre</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="0"
                  placeholder="# of Dogs"
                  value={editForm.numberOfDogs ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, numberOfDogs: e.target.value ? parseInt(e.target.value) : null })}
                  data-testid="input-edit-number-of-dogs"
                />
                <Select
                  value={editForm.serviceFrequency || ""}
                  onValueChange={(v) => setEditForm({ ...editForm, serviceFrequency: v })}
                >
                  <SelectTrigger data-testid="select-edit-service-frequency">
                    <SelectValue placeholder="Service Frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1_per_week">1x per week</SelectItem>
                    <SelectItem value="2_per_week">2x per week</SelectItem>
                    <SelectItem value="biweekly">Bi-weekly</SelectItem>
                    <SelectItem value="as_needed">As needed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Select
                value={editForm.status || "lead"}
                onValueChange={(v) => setEditForm({ ...editForm, status: v as any })}
              >
                <SelectTrigger data-testid="select-edit-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="estimate">Estimate</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={() => updateMutation.mutate(editForm)} disabled={updateMutation.isPending} data-testid="button-save-contact">
                <Save className="mr-1 h-4 w-4" /> Save
              </Button>
            </div>
          ) : (
            <div className="space-y-1 text-sm">
              <p data-testid="text-contact-email">Email: {contact.email || "N/A"}</p>
              <p data-testid="text-contact-phone">Phone: {contact.phone || "N/A"}</p>
              {contact.streetAddress && (
                <p data-testid="text-contact-address">
                  Address: {contact.streetAddress}{contact.address2 ? `, ${contact.address2}` : ""}{contact.city ? `, ${contact.city}` : ""}{contact.state ? `, ${contact.state}` : ""} {contact.zipCode || ""}
                </p>
              )}
              {contact.yardSize && (
                <p data-testid="text-contact-yard-size">Lot Size: {
                  { "0.25_or_less": "0.25 Acre or Less", "0.26_0.5": ".26-.5 Acre", "0.51_0.75": ".51-.75 Acre", "0.75_1": ".75-1 Acre", "over_1": "Over 1 Acre" }[contact.yardSize] || contact.yardSize
                }</p>
              )}
              {contact.numberOfDogs != null && (
                <p data-testid="text-contact-dogs"># of Dogs: {contact.numberOfDogs}</p>
              )}
              {contact.serviceFrequency && (
                <p data-testid="text-contact-frequency">Service Frequency: {
                  { "1_per_week": "1x per week", "2_per_week": "2x per week", "biweekly": "Bi-weekly", "as_needed": "As needed" }[contact.serviceFrequency] || contact.serviceFrequency
                }</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <BillingPreferences contact={contact} contactId={id!} />

      <PortalAccessCard contact={contact} contactId={id!} />

      <PaymentMethodsCard contact={contact} contactId={id!} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg">Properties</CardTitle>
          <Dialog open={propertyDialogOpen} onOpenChange={setPropertyDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-property">
                <Plus className="mr-1 h-4 w-4" /> Add Property
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Property</DialogTitle>
              </DialogHeader>
              <Form {...propertyForm}>
                <form onSubmit={propertyForm.handleSubmit((v) => createPropertyMutation.mutate(v))} className="space-y-3">
                  <FormField control={propertyForm.control} name="streetAddress" render={({ field }) => (
                    <FormItem><FormLabel>Street Address</FormLabel><FormControl>
                      <AddressAutocomplete
                        value={field.value || ""}
                        onChange={field.onChange}
                        onSelect={(addr) => {
                          propertyForm.setValue("streetAddress", addr.streetAddress);
                          propertyForm.setValue("city", addr.city);
                          propertyForm.setValue("state", addr.state);
                          propertyForm.setValue("zipCode", addr.zipCode);
                        }}
                        data-testid="input-street"
                      />
                    </FormControl><FormMessage /></FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={propertyForm.control} name="city" render={({ field }) => (
                      <FormItem><FormLabel>City</FormLabel><FormControl><Input {...field} data-testid="input-city" /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={propertyForm.control} name="state" render={({ field }) => (
                      <FormItem><FormLabel>State</FormLabel><FormControl><Input {...field} data-testid="input-state" /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                  <FormField control={propertyForm.control} name="zipCode" render={({ field }) => (
                    <FormItem><FormLabel>Zip Code</FormLabel><FormControl><Input {...field} data-testid="input-zip" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={propertyForm.control} name="numberOfDogs" render={({ field }) => (
                    <FormItem><FormLabel>Number of Dogs</FormLabel><FormControl><Input type="number" {...field} data-testid="input-dogs" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={propertyForm.control} name="gateCode" render={({ field }) => (
                    <FormItem><FormLabel>Gate Code</FormLabel><FormControl><Input {...field} data-testid="input-gate-code" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={propertyForm.control} name="specialInstructions" render={({ field }) => (
                    <FormItem><FormLabel>Special Instructions</FormLabel><FormControl><Textarea {...field} data-testid="input-special-instructions" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <Button type="submit" disabled={createPropertyMutation.isPending} data-testid="button-submit-property">
                    {createPropertyMutation.isPending ? "Adding..." : "Add Property"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {properties && properties.length > 0 ? (
            <div className="space-y-2">
              {properties.map((prop) => (
                <div key={prop.id} className="border rounded-md p-3" data-testid={`text-property-${prop.id}`}>
                  <p className="font-medium">{prop.streetAddress}</p>
                  <p className="text-sm text-muted-foreground">{prop.city}, {prop.state} {prop.zipCode}</p>
                  {prop.gateCode && <p className="text-sm text-muted-foreground">Gate: {prop.gateCode}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No properties yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Service Plans</CardTitle>
        </CardHeader>
        <CardContent>
          {servicePlans && servicePlans.length > 0 ? (
            <div className="space-y-2">
              {servicePlans.map((plan) => (
                <div key={plan.id} className="border rounded-md p-3" data-testid={`text-plan-${plan.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium capitalize">{plan.frequency} service</p>
                    <Badge variant={plan.isActive ? "default" : "secondary"}>
                      {plan.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">${plan.pricePerVisit}/visit</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No service plans yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tags</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {contactTags?.map((tag) => (
              <Badge key={tag.id} variant="outline" className="gap-1" data-testid={`badge-tag-${tag.id}`}>
                {tag.name}
                <button
                  onClick={() => removeTagMutation.mutate(tag.id)}
                  className="ml-1"
                  data-testid={`button-remove-tag-${tag.id}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {allTags?.filter((t) => !contactTags?.some((ct) => ct.id === t.id)).map((tag) => (
              <Button
                key={tag.id}
                variant="outline"
                size="sm"
                onClick={() => addTagMutation.mutate(tag.id)}
                data-testid={`button-add-tag-${tag.id}`}
              >
                <Plus className="mr-1 h-3 w-3" /> {tag.name}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="New tag name"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              data-testid="input-new-tag"
            />
            <Button
              size="sm"
              onClick={() => newTagName && createTagMutation.mutate(newTagName)}
              disabled={!newTagName}
              data-testid="button-create-tag"
            >
              Create
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            defaultValue={contact.notes || ""}
            onChange={(e) => setEditNotes(e.target.value)}
            placeholder="Add notes about this contact..."
            data-testid="input-notes"
          />
          <Button
            size="sm"
            onClick={() => updateNotesMutation.mutate(editNotes || contact.notes || "")}
            disabled={updateNotesMutation.isPending}
            data-testid="button-save-notes"
          >
            <Save className="mr-1 h-4 w-4" /> Save Notes
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function PortalAccessCard({ contact, contactId }: { contact: Contact; contactId: string }) {
  const { toast } = useToast();

  const enablePortalMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/contacts/${contactId}/portal-access`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId] });
      toast({ title: "Portal enabled", description: "Customer can now log into the client portal." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const disablePortalMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/contacts/${contactId}/portal-access`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId] });
      toast({ title: "Portal disabled", description: "Customer portal access has been revoked." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-lg flex items-center gap-2">
          <Shield className="h-5 w-5" /> Client Portal
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium" data-testid="text-portal-status">
              Portal Access: {contact.hasPortalAccess ? "Enabled" : "Disabled"}
            </p>
            <p className="text-xs text-muted-foreground">
              {contact.hasPortalAccess
                ? "Customer can log in with their email and last name to view schedule, invoices, and manage service."
                : "Enable portal access to let this customer self-serve."}
            </p>
          </div>
          {contact.hasPortalAccess ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => disablePortalMutation.mutate()}
              disabled={disablePortalMutation.isPending}
              data-testid="button-disable-portal"
            >
              <ShieldOff className="mr-1 h-4 w-4" /> Disable
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => enablePortalMutation.mutate()}
              disabled={enablePortalMutation.isPending}
              data-testid="button-enable-portal"
            >
              <Shield className="mr-1 h-4 w-4" /> Enable Portal
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PaymentMethodsCard({ contact, contactId }: { contact: Contact; contactId: string }) {
  const { toast } = useToast();

  const { data: stripeConfig } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/stripe/config"],
  });

  const { data: paymentMethods, isLoading: pmLoading } = useQuery<any[]>({
    queryKey: ["/api/contacts", contactId, "payment-methods"],
    queryFn: () => fetch(`/api/contacts/${contactId}/payment-methods`, { credentials: "include" }).then(r => r.json()),
    enabled: !!contact.stripeCustomerId && !!stripeConfig?.configured,
  });

  const createCustomerMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/contacts/${contactId}/stripe-customer`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId] });
      toast({ title: "Stripe customer created", description: "Contact linked to Stripe." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const removeMethodMutation = useMutation({
    mutationFn: async (pmId: string) => {
      await apiRequest("DELETE", `/api/payment-methods/${pmId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "payment-methods"] });
      toast({ title: "Removed", description: "Payment method removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (!stripeConfig?.configured) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-lg flex items-center gap-2">
          <CreditCard className="h-5 w-5" /> Payment Methods
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!contact.stripeCustomerId ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">No Stripe customer record yet.</p>
            <Button
              size="sm"
              onClick={() => createCustomerMutation.mutate()}
              disabled={createCustomerMutation.isPending}
              data-testid="button-create-stripe-customer"
            >
              <CreditCard className="mr-1 h-4 w-4" />
              {createCustomerMutation.isPending ? "Creating..." : "Link to Stripe"}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground" data-testid="text-stripe-id">
              Stripe ID: {contact.stripeCustomerId}
            </p>
            {pmLoading ? (
              <p className="text-sm text-muted-foreground">Loading payment methods...</p>
            ) : paymentMethods && paymentMethods.length > 0 ? (
              <div className="space-y-2">
                {paymentMethods.map((pm: any) => (
                  <div key={pm.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border rounded-md p-2">
                    <div className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{(pm.brand || "Card").toUpperCase()}</span>
                      <span className="text-muted-foreground">****{pm.last4}</span>
                      <span className="text-muted-foreground text-xs">{pm.expMonth}/{pm.expYear}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeMethodMutation.mutate(pm.id)}
                      disabled={removeMethodMutation.isPending}
                      data-testid={`button-remove-pm-${pm.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="text-no-payment-methods">
                No payment methods on file. Cards will be added when customers pay via checkout.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BillingPreferences({ contact, contactId }: { contact: Contact; contactId: string }) {
  const { toast } = useToast();
  const [timing, setTiming] = useState<string>(contact.invoiceTiming || "after_service");
  const [frequency, setFrequency] = useState<string>(contact.invoiceFrequency || "per_service");

  useEffect(() => {
    setTiming(contact.invoiceTiming || "after_service");
    setFrequency(contact.invoiceFrequency || "per_service");
  }, [contact.invoiceTiming, contact.invoiceFrequency]);

  const updateBillingMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/contacts/${contactId}/billing-preferences`, {
        invoiceTiming: timing,
        invoiceFrequency: frequency,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId] });
      toast({ title: "Updated", description: "Billing preferences saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const timingLabels: Record<string, string> = {
    before_service: "Before Service",
    after_service: "After Service",
  };
  const frequencyLabels: Record<string, string> = {
    per_service: "Per Service",
    per_week: "Per Week",
    per_month: "Per Month",
  };

  const hasChanges = timing !== (contact.invoiceTiming || "after_service") || frequency !== (contact.invoiceFrequency || "per_service");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-lg flex items-center gap-2">
          <Receipt className="h-5 w-5" /> Billing Preferences
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-sm text-muted-foreground">Invoice Timing</Label>
            <Select value={timing} onValueChange={setTiming}>
              <SelectTrigger data-testid="select-billing-timing">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="before_service">Before Service</SelectItem>
                <SelectItem value="after_service">After Service</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {timing === "before_service"
                ? "Invoice created before scheduled services"
                : "Invoice created after services are completed"}
            </p>
          </div>
          <div>
            <Label className="text-sm text-muted-foreground">Invoice Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger data-testid="select-billing-frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="per_service">Per Service</SelectItem>
                <SelectItem value="per_week">Per Week</SelectItem>
                <SelectItem value="per_month">Per Month</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {frequency === "per_service" && "One invoice generated per visit"}
              {frequency === "per_week" && "One invoice per week covering all visits"}
              {frequency === "per_month" && "One invoice per month covering all visits"}
            </p>
          </div>
        </div>
        {hasChanges && (
          <Button
            size="sm"
            onClick={() => updateBillingMutation.mutate()}
            disabled={updateBillingMutation.isPending}
            data-testid="button-save-billing"
          >
            <Save className="mr-1 h-4 w-4" />
            {updateBillingMutation.isPending ? "Saving..." : "Save Billing Preferences"}
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Current: {timingLabels[contact.invoiceTiming || "after_service"]} / {frequencyLabels[contact.invoiceFrequency || "per_service"]}
        </p>
      </CardContent>
    </Card>
  );
}
