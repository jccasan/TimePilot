import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Contact, Property, ServicePlan, Tag, ServicePricingItem, Route, ActivityLog, Invoice } from "@shared/schema";
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
import { Label } from "@/components/ui/label";
import { ArrowLeft, Plus, X, Edit2, Save, Receipt, CreditCard, Shield, ShieldOff, Trash2, ArrowRight, CheckCircle, Calendar, FileText, DollarSign, Mail, MessageSquare, StickyNote, LogIn, Ruler, Calculator, AlertTriangle, TrendingUp, TrendingDown, KeyRound, Zap, Clock, MapPin, ChevronDown } from "lucide-react";
import { GenerateInvoiceDialog } from "@/components/generate-invoice-dialog";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { StreetViewImage } from "@/components/street-view-image";
import { SatelliteImage } from "@/components/satellite-image";
import { YardMeasureTool, getYardCategory, formatArea } from "@/components/yard-measure-tool";
import { PriceCalculatorCard } from "@/components/price-calculator-card";

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
  yardDifficulty: z.enum(["flat", "moderate", "difficult"]).optional(),
  gateCode: z.string().optional(),
  lotSize: z.string().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  specialInstructions: z.string().optional(),
});

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [propertyDialogOpen, setPropertyDialogOpen] = useState(false);
  const [measurePropertyId, setMeasurePropertyId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [newTagName, setNewTagName] = useState("");

  const { data: contact, isLoading } = useQuery<Contact>({
    queryKey: ["/api/contacts", id],
  });

  const { data: properties } = useQuery<Property[]>({
    queryKey: ["/api/properties" + `?contactId=${id}`],
    enabled: !!id,
  });

  const { data: servicePlansForPricing } = useQuery<ServicePlan[]>({
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

  const { data: leadSources = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/lead-sources"],
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
      yardDifficulty: "flat" as const,
      gateCode: "",
      lotSize: "",
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

  const deletePropertyMutation = useMutation({
    mutationFn: async (propertyId: string) => {
      await apiRequest("DELETE", `/api/properties/${propertyId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({ title: "Property deleted", description: "Property removed successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveMeasurementMutation = useMutation({
    mutationFn: async ({ propertyId, polygon, areaSqft }: { propertyId: string; polygon: number[][]; areaSqft: number }) => {
      await apiRequest("PATCH", `/api/properties/${propertyId}`, {
        yardPolygon: polygon,
        measuredYardSqft: areaSqft,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      setMeasurePropertyId(null);
      toast({ title: "Measurement saved", description: "Yard area has been recorded." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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
                  leadSource: contact.leadSource,
                  serviceDay: contact.serviceDay,
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
                    <SelectValue placeholder="Yard Size" />
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
                  placeholder="Number of Dogs"
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
                <Select
                  value={editForm.leadSource || ""}
                  onValueChange={(v) => setEditForm({ ...editForm, leadSource: v })}
                >
                  <SelectTrigger data-testid="select-edit-lead-source">
                    <SelectValue placeholder="Lead Source" />
                  </SelectTrigger>
                  <SelectContent>
                    {leadSources.map((source) => (
                      <SelectItem key={source.id} value={source.name}>{source.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={editForm.serviceDay || ""}
                  onValueChange={(v) => setEditForm({ ...editForm, serviceDay: v as any })}
                >
                  <SelectTrigger data-testid="select-edit-service-day">
                    <SelectValue placeholder="Service Day" />
                  </SelectTrigger>
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
                <p data-testid="text-contact-yard-size">Yard Size: {
                  { "0.25_or_less": "0.25 Acre or Less", "0.26_0.5": ".26-.5 Acre", "0.51_0.75": ".51-.75 Acre", "0.75_1": ".75-1 Acre", "over_1": "Over 1 Acre" }[contact.yardSize] || contact.yardSize
                }</p>
              )}
              {contact.numberOfDogs != null && (
                <p data-testid="text-contact-dogs">Number of Dogs: {contact.numberOfDogs}</p>
              )}
              {contact.serviceFrequency && (
                <p data-testid="text-contact-frequency">Service Frequency: {
                  { "1_per_week": "1x per week", "2_per_week": "2x per week", "biweekly": "Bi-weekly", "as_needed": "As needed" }[contact.serviceFrequency] || contact.serviceFrequency
                }</p>
              )}
              {contact.leadSource && (
                <p data-testid="text-contact-lead-source">Lead Source: {
                  { "referral": "Referral", "facebook": "Facebook", "google": "Google", "bing": "Bing", "nextdoor": "NextDoor", "yard_sign": "Yard Sign", "local_advertising": "Local Advertising" }[contact.leadSource] || contact.leadSource
                }</p>
              )}
              {contact.serviceDay && (
                <p data-testid="text-contact-service-day">Service Day: <span className="capitalize">{contact.serviceDay}</span></p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <ProfitabilityIndicator contactId={id!} contactStatus={contact.status} />

      <BillingPreferences contact={contact} contactId={id!} />

      <PortalAccessCard contact={contact} contactId={id!} />

      <PaymentMethodsCard contact={contact} contactId={id!} />

      <BillingHistoryCard contactId={id!} />

      <VisitHistoryCard contactId={id!} />

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
                          if (addr.latitude) propertyForm.setValue("latitude", String(addr.latitude));
                          if (addr.longitude) propertyForm.setValue("longitude", String(addr.longitude));
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
                  <FormField control={propertyForm.control} name="yardDifficulty" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Yard Difficulty</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || "flat"}>
                        <FormControl><SelectTrigger data-testid="select-yard-difficulty"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="flat">Flat</SelectItem>
                          <SelectItem value="moderate">Moderate</SelectItem>
                          <SelectItem value="difficult">Difficult</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={propertyForm.control} name="gateCode" render={({ field }) => (
                    <FormItem><FormLabel>Gate Code</FormLabel><FormControl><Input {...field} data-testid="input-gate-code" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={propertyForm.control} name="lotSize" render={({ field }) => (
                    <FormItem><FormLabel>Yard Size</FormLabel><FormControl><Input {...field} placeholder="e.g. 0.18 acres, 7,840 sqft" data-testid="input-lot-size" /></FormControl><FormMessage /></FormItem>
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
              {properties.map((prop) => {
                const propAddress = `${prop.streetAddress}, ${prop.city}, ${prop.state} ${prop.zipCode}`;
                const propLat = prop.latitude ? Number(prop.latitude) : undefined;
                const propLng = prop.longitude ? Number(prop.longitude) : undefined;
                const yardCat = prop.measuredYardSqft ? getYardCategory(prop.measuredYardSqft) : null;
                return (
                <div key={prop.id} className="border rounded-md overflow-hidden" data-testid={`text-property-${prop.id}`}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 border-b">
                    <StreetViewImage
                      address={propAddress}
                      lat={propLat}
                      lng={propLng}
                      className="rounded-none border-0 h-[120px]"
                      size="600x300"
                    />
                    <SatelliteImage
                      address={propAddress}
                      lat={propLat}
                      lng={propLng}
                      className="rounded-none border-0 border-t sm:border-t-0 sm:border-l h-[120px]"
                      size="600x300"
                      zoom={19}
                      clickToNavigate={false}
                    />
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{prop.streetAddress}</p>
                        <p className="text-sm text-muted-foreground">{prop.city}, {prop.state} {prop.zipCode}</p>
                        {prop.gateCode && <p className="text-sm text-muted-foreground">Gate: {prop.gateCode}</p>}
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0" data-testid={`button-delete-property-${prop.id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Property</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete {prop.streetAddress}? This action cannot be undone. Any service plans linked to this property will also be affected.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deletePropertyMutation.mutate(prop.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              data-testid={`button-confirm-delete-property-${prop.id}`}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {prop.measuredYardSqft && yardCat ? (
                        <>
                          <Badge className={`text-xs ${yardCat.color}`} data-testid={`badge-yard-category-${prop.id}`}>
                            {yardCat.label}
                          </Badge>
                          <span className="text-sm text-muted-foreground" data-testid={`text-yard-area-${prop.id}`}>
                            {formatArea(prop.measuredYardSqft)}
                          </span>
                        </>
                      ) : null}
                      {prop.lotSize && (
                        <span className="text-sm text-muted-foreground">Yard Size: {prop.lotSize}</span>
                      )}
                      {prop.yardDifficulty && prop.yardDifficulty !== "flat" && (
                        <Badge variant="outline" className="text-xs" data-testid={`badge-yard-difficulty-${prop.id}`}>
                          {prop.yardDifficulty === "moderate" ? "Moderate Terrain" : "Difficult Terrain"}
                        </Badge>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => {
                          if (propLat == null || propLng == null) {
                            toast({ title: "Geocoding required", description: "This property needs coordinates before measuring. Use Geocode All on the properties page.", variant: "destructive" });
                            return;
                          }
                          setMeasurePropertyId(measurePropertyId === prop.id ? null : prop.id);
                        }}
                        data-testid={`button-measure-yard-${prop.id}`}
                      >
                        <Ruler className="h-3.5 w-3.5" />
                        {measurePropertyId === prop.id ? "Hide Measure Tool" : prop.measuredYardSqft ? "Re-measure Yard" : "Measure Yard"}
                      </Button>
                    </div>
                  </div>
                  {measurePropertyId === prop.id && propLat != null && propLng != null && (
                    <div className="border-t p-3">
                      <YardMeasureTool
                        lat={propLat}
                        lng={propLng}
                        propertyId={prop.id}
                        existingPolygon={prop.yardPolygon as number[][] | null}
                        existingArea={prop.measuredYardSqft}
                        onSave={(polygon, areaSqft) => saveMeasurementMutation.mutate({ propertyId: prop.id, polygon, areaSqft })}
                        onCancel={() => setMeasurePropertyId(null)}
                      />
                    </div>
                  )}
                  <div className="border-t">
                    <PriceCalculatorCard
                      property={prop}
                      servicePlans={servicePlansForPricing?.filter((sp) => sp.propertyId === prop.id)}
                    />
                  </div>
                </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No properties yet.</p>
          )}
        </CardContent>
      </Card>

      <ServicePlansCard contactId={id!} contact={contact} properties={properties || []} />

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

      <ActivitySection contactId={id!} />
    </div>
  );
}

function PortalAccessCard({ contact, contactId }: { contact: Contact; contactId: string }) {
  const { toast } = useToast();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [portalNewPassword, setPortalNewPassword] = useState("");
  const [portalConfirmPassword, setPortalConfirmPassword] = useState("");

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

  const resendPortalMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/contacts/${contactId}/portal-access/resend`);
    },
    onSuccess: () => {
      toast({ title: "Portal link sent", description: "A new password and portal link have been emailed to the customer." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetPortalPasswordMutation = useMutation({
    mutationFn: async (newPassword: string) => {
      const res = await apiRequest("POST", `/api/contacts/${contactId}/portal-access/reset-password`, { newPassword });
      return res.json();
    },
    onSuccess: () => {
      setResetDialogOpen(false);
      setPortalNewPassword("");
      setPortalConfirmPassword("");
      toast({ title: "Password updated", description: "The client's portal password has been changed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <>
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
                  ? "Customer can log in with their email to view schedule, invoices, and manage service."
                  : "Enable portal access to let this customer self-serve."}
              </p>
            </div>
            {contact.hasPortalAccess ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resendPortalMutation.mutate()}
                  disabled={resendPortalMutation.isPending}
                  data-testid="button-send-portal-link"
                >
                  <Mail className="mr-1 h-4 w-4" /> Send Portal Link
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setResetDialogOpen(true)}
                  data-testid="button-reset-portal-password"
                >
                  <KeyRound className="mr-1 h-4 w-4" /> Reset Password
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => disablePortalMutation.mutate()}
                  disabled={disablePortalMutation.isPending}
                  data-testid="button-disable-portal"
                >
                  <ShieldOff className="mr-1 h-4 w-4" /> Disable
                </Button>
              </div>
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

      <Dialog open={resetDialogOpen} onOpenChange={(open) => { if (!open) { setResetDialogOpen(false); setPortalNewPassword(""); setPortalConfirmPassword(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Portal Password</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Set a new portal password for {contact.firstName} {contact.lastName} ({contact.email}).
          </p>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>New Password</Label>
              <Input
                type="password"
                value={portalNewPassword}
                onChange={(e) => setPortalNewPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                data-testid="input-portal-new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm Password</Label>
              <Input
                type="password"
                value={portalConfirmPassword}
                onChange={(e) => setPortalConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                data-testid="input-portal-confirm-password"
              />
            </div>
            {portalNewPassword && portalConfirmPassword && portalNewPassword !== portalConfirmPassword && (
              <p className="text-sm text-destructive">Passwords do not match</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setResetDialogOpen(false); setPortalNewPassword(""); setPortalConfirmPassword(""); }}>Cancel</Button>
            <Button
              disabled={!portalNewPassword || portalNewPassword.length < 8 || portalNewPassword !== portalConfirmPassword || resetPortalPasswordMutation.isPending}
              onClick={() => resetPortalPasswordMutation.mutate(portalNewPassword)}
              data-testid="button-confirm-portal-password-reset"
            >
              {resetPortalPasswordMutation.isPending ? "Updating..." : "Update Password"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PaymentMethodsCard({ contact, contactId }: { contact: Contact; contactId: string }) {
  const { toast } = useToast();

  const { data: stripeConfig } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/stripe/config"],
  });

  const { data: paymentMethods, isLoading: pmLoading } = useQuery<any[]>({
    queryKey: ["/api/contacts", contactId, "payment-methods"],
    queryFn: () => {
      const token = localStorage.getItem("sessionToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return fetch(`/api/contacts/${contactId}/payment-methods`, { credentials: "include", headers }).then(r => r.json());
    },
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

function ProfitabilityIndicator({ contactId, contactStatus }: { contactId: string; contactStatus: string }) {
  const { data, isLoading, isError } = useQuery<{
    contactId: string;
    contactName: string;
    propertyCount: number;
    totalRevenuePerVisitCents: number;
    totalCostPerVisitCents: number;
    totalProfitPerVisitCents: number;
    profitMarginPct: number;
    status: "profitable" | "marginal" | "unprofitable";
    properties: Array<{
      propertyId: string;
      propertyAddress: string;
      revenuePerVisitCents: number;
      costPerVisitCents: number;
      profitPerVisitCents: number;
      profitMarginPct: number;
      recommendedPriceCents: number;
    }>;
    monthlyRevenueCents: number;
    monthlyCostCents: number;
    monthlyProfitCents: number;
  }>({
    queryKey: ["/api/profitability/customer", contactId],
    enabled: contactStatus === "active",
  });

  if (contactStatus !== "active") return null;
  if (isLoading) {
    return (
      <Card data-testid="card-profitability-indicator">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> Profitability
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (isError || !data) return null;

  const centsToDisplay = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;

  const statusConfig: Record<string, { label: string; badgeClass: string }> = {
    profitable: { label: "Profitable", badgeClass: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
    marginal: { label: "Marginal", badgeClass: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
    unprofitable: { label: "Unprofitable", badgeClass: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  };

  const cfg = statusConfig[data.status] || statusConfig.profitable;
  const isUnprofitable = data.status === "unprofitable";

  const unprofitableProperties = data.properties.filter(p => p.profitMarginPct < 0);

  return (
    <Card data-testid="card-profitability-indicator">
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          {isUnprofitable ? (
            <TrendingDown className="h-4 w-4 text-destructive" />
          ) : (
            <TrendingUp className="h-4 w-4" />
          )}
          Profitability
        </CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className={cfg.badgeClass} data-testid="badge-profitability-status">
            {cfg.label}
          </Badge>
          <Button variant="ghost" size="sm" asChild data-testid="link-profitability-drilldown">
            <Link href={`/profitability/${contactId}`}>
              Details <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3" data-testid="grid-profitability-metrics">
          <div className="text-center" data-testid="metric-profit-per-visit">
            <p className="text-xs text-muted-foreground">Profit/Visit</p>
            <p className={`text-lg font-bold ${data.totalProfitPerVisitCents < 0 ? "text-destructive" : ""}`}>
              {data.totalProfitPerVisitCents < 0 ? "-" : ""}{centsToDisplay(data.totalProfitPerVisitCents)}
            </p>
          </div>
          <div className="text-center" data-testid="metric-margin">
            <p className="text-xs text-muted-foreground">Margin</p>
            <p className={`text-lg font-bold ${data.profitMarginPct < 0 ? "text-destructive" : data.profitMarginPct <= 15 ? "text-yellow-600 dark:text-yellow-400" : ""}`}>
              {data.profitMarginPct.toFixed(1)}%
            </p>
          </div>
          <div className="text-center" data-testid="metric-monthly-profit">
            <p className="text-xs text-muted-foreground">Monthly Profit</p>
            <p className={`text-lg font-bold ${data.monthlyProfitCents < 0 ? "text-destructive" : ""}`}>
              {data.monthlyProfitCents < 0 ? "-" : ""}{centsToDisplay(data.monthlyProfitCents)}
            </p>
          </div>
        </div>

        {isUnprofitable && unprofitableProperties.length > 0 && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="alert-unprofitable-warning">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">
                {unprofitableProperties.length} {unprofitableProperties.length === 1 ? "property is" : "properties are"} losing money
              </p>
              {unprofitableProperties.slice(0, 2).map(p => (
                <p key={p.propertyId} className="text-xs opacity-75">
                  {p.propertyAddress}: Current {centsToDisplay(p.revenuePerVisitCents)}/visit — Recommended {centsToDisplay(p.recommendedPriceCents)}/visit
                </p>
              ))}
            </div>
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

const servicePlanFormSchema = z.object({
  propertyId: z.string().min(1, "Property is required"),
  frequency: z.enum(["weekly", "biweekly", "monthly", "onetime"]),
  dayOfWeek: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]).optional(),
  pricePerVisit: z.string().min(1, "Price is required"),
  startDate: z.string().min(1, "Start date is required"),
  routeId: z.string().optional(),
  isActive: z.boolean().optional(),
});

type ServicePlanFormValues = z.infer<typeof servicePlanFormSchema>;

const daysOfWeek = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const frequencyLabelsMap: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  onetime: "One-time",
};

interface PriceCalcResult {
  minimumPriceCents: number;
  recommendedPriceCents: number;
  premiumPriceCents: number;
  breakdown: {
    serviceMinutes: number;
    travelMinutes: number;
    adjustedTravelMinutes: number;
    densityMultiplier: number;
    laborCostCents: number;
    travelCostCents: number;
    adjustedTravelCostCents: number;
    equipmentCostCents: number;
    overheadPerVisitCents: number;
  };
  derived: {
    jobMinutes: number;
    profitAtRecommendedCents: number;
    profitPerHourAtRecommendedCents: number;
    clusterDiscountAppliedPct: number;
    marketAnchorClamped: boolean;
    isEstimated: boolean;
  };
  profitWarning?: {
    message: string;
    lossPerVisitCents: number;
    profitPerVisitCents: number;
    profitPerHourCents: number;
  };
}

function useInlinePriceCalc(
  propertyId: string | undefined,
  frequency: string | undefined,
  pricePerVisit: string | undefined,
  properties: Property[]
) {
  const [calcResult, setCalcResult] = useState<PriceCalcResult | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [debouncedPrice, setDebouncedPrice] = useState(pricePerVisit);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPrice(pricePerVisit), 400);
    return () => clearTimeout(timer);
  }, [pricePerVisit]);

  const selectedProperty = useMemo(() => {
    if (!propertyId) return null;
    return properties.find((p) => p.id === propertyId) || null;
  }, [propertyId, properties]);

  useEffect(() => {
    if (!selectedProperty || !frequency) {
      setCalcResult(null);
      return;
    }

    let yardSizeAcres = 0.1;
    if (selectedProperty.measuredYardSqft) {
      yardSizeAcres = selectedProperty.measuredYardSqft / 43560;
    } else if (selectedProperty.yardSize) {
      const label = selectedProperty.yardSize.toLowerCase();
      if (label.includes("small") || label.includes("xs")) yardSizeAcres = 0.05;
      else if (label.includes("medium") || label.includes("standard")) yardSizeAcres = 0.1;
      else if (label.includes("large") && !label.includes("extra")) yardSizeAcres = 0.2;
      else if (label.includes("extra") || label.includes("xl")) yardSizeAcres = 0.35;
      else {
        const numMatch = selectedProperty.yardSize.match(/[\d.]+/);
        if (numMatch) yardSizeAcres = parseFloat(numMatch[0]);
      }
    }

    const currentPriceCents = debouncedPrice ? Math.round(parseFloat(debouncedPrice) * 100) : undefined;

    const body = {
      yardSizeAcres,
      dogCount: selectedProperty.numberOfDogs || 1,
      serviceFrequency: frequency,
      yardDifficulty: selectedProperty.yardDifficulty || "flat",
      distanceFromNearestStopMiles: 1,
      currentPriceCents,
    };

    setCalcLoading(true);
    const token = localStorage.getItem("sessionToken");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch("/api/pricing/calculate", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(body),
    })
      .then((r) => {
        if (r.ok) return r.json();
        return null;
      })
      .then((data) => {
        if (data) setCalcResult(data);
        else setCalcResult(null);
      })
      .catch(() => setCalcResult(null))
      .finally(() => setCalcLoading(false));
  }, [selectedProperty, frequency, debouncedPrice]);

  return { calcResult, calcLoading, selectedProperty };
}

function InlinePriceSuggestion({
  calcResult,
  calcLoading,
  pricePerVisit,
  onUsePrice,
}: {
  calcResult: PriceCalcResult | null;
  calcLoading: boolean;
  pricePerVisit: string;
  onUsePrice: (price: string) => void;
}) {
  if (calcLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1" data-testid="text-calc-loading">
        <Calculator className="h-3.5 w-3.5 animate-spin" />
        Calculating suggested price...
      </div>
    );
  }

  if (!calcResult) return null;

  const recommendedDollars = (calcResult.recommendedPriceCents / 100).toFixed(2);
  const minimumDollars = (calcResult.minimumPriceCents / 100).toFixed(2);
  const premiumDollars = (calcResult.premiumPriceCents / 100).toFixed(2);
  const enteredCents = pricePerVisit ? Math.round(parseFloat(pricePerVisit) * 100) : 0;
  const isBelowMinimum = enteredCents > 0 && enteredCents < calcResult.minimumPriceCents;

  return (
    <div className="space-y-2 mt-2" data-testid="section-price-suggestions">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs">
          <Calculator className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Suggested:</span>
        </div>
        <Badge
          variant="outline"
          className="text-xs cursor-pointer"
          onClick={() => onUsePrice(minimumDollars)}
          data-testid="badge-price-minimum"
        >
          Min ${minimumDollars}
        </Badge>
        <Badge
          variant="default"
          className="text-xs cursor-pointer"
          onClick={() => onUsePrice(recommendedDollars)}
          data-testid="badge-price-recommended"
        >
          <TrendingUp className="h-3 w-3 mr-1" />
          ${recommendedDollars}
        </Badge>
        <Badge
          variant="outline"
          className="text-xs cursor-pointer"
          onClick={() => onUsePrice(premiumDollars)}
          data-testid="badge-price-premium"
        >
          Premium ${premiumDollars}
        </Badge>
      </div>

      {isBelowMinimum && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-2" data-testid="alert-profit-warning">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="font-medium text-destructive">Below cost</p>
            <p className="text-muted-foreground">
              Entered price ${pricePerVisit} is below the estimated minimum cost of ${minimumDollars}/visit. You may lose ${((calcResult.minimumPriceCents - enteredCents) / 100).toFixed(2)} per visit.
            </p>
          </div>
        </div>
      )}

      {calcResult.profitWarning && enteredCents > 0 && !isBelowMinimum && (
        <p className="text-xs text-muted-foreground" data-testid="text-profit-info">
          {calcResult.profitWarning.message} (${(calcResult.profitWarning.profitPerHourCents / 100).toFixed(2)}/hr)
        </p>
      )}
    </div>
  );
}

function ServicePlansCard({ contactId, contact, properties }: { contactId: string; contact: Contact; properties: Property[] }) {
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<ServicePlan | null>(null);

  const { data: servicePlans } = useQuery<(ServicePlan & { addOns?: { id: string; servicePricingId: string; name: string; price: string }[] })[]>({
    queryKey: ["/api/service-plans" + `?contactId=${contactId}`],
    enabled: !!contactId,
  });

  const { data: pricingItems } = useQuery<ServicePricingItem[]>({
    queryKey: ["/api/pricing"],
  });

  const { data: routes } = useQuery<Route[]>({
    queryKey: ["/api/routes"],
  });

  const [createSelectedAddOns, setCreateSelectedAddOns] = useState<string[]>([]);
  const [editSelectedAddOns, setEditSelectedAddOns] = useState<string[]>([]);

  const basePricingForFreq = useCallback((freq: string) => {
    if (!pricingItems) return [];
    const categoryMap: Record<string, string> = {
      weekly: "recurring_service",
      biweekly: "recurring_service",
      monthly: "recurring_service",
      onetime: "one_time_service",
    };
    const cat = categoryMap[freq] || "recurring_service";
    return pricingItems.filter((p) => p.category === cat && p.isActive);
  }, [pricingItems]);

  const addOnPricing = useMemo(() => {
    if (!pricingItems) return [];
    return pricingItems.filter((p) => p.category === "add_on" && p.isActive);
  }, [pricingItems]);

  const recurringPricing = useMemo(() => basePricingForFreq("weekly"), [basePricingForFreq]);

  const defaultPrice = useMemo(() => {
    if (recurringPricing.length > 0) return recurringPricing[0].basePrice;
    return "";
  }, [recurringPricing]);

  const createForm = useForm<ServicePlanFormValues>({
    resolver: zodResolver(servicePlanFormSchema),
    defaultValues: {
      propertyId: "",
      frequency: "weekly",
      dayOfWeek: "monday",
      pricePerVisit: "",
      startDate: new Date().toISOString().split("T")[0],
      routeId: "",
    },
  });

  const editForm = useForm<ServicePlanFormValues>({
    resolver: zodResolver(servicePlanFormSchema),
    defaultValues: {
      propertyId: "",
      frequency: "weekly",
      dayOfWeek: "monday",
      pricePerVisit: "",
      startDate: new Date().toISOString().split("T")[0],
      routeId: "",
      isActive: true,
    },
  });

  useEffect(() => {
    if (createDialogOpen && defaultPrice && !createForm.getValues("pricePerVisit")) {
      createForm.setValue("pricePerVisit", defaultPrice);
    }
  }, [createDialogOpen, defaultPrice, createForm]);

  useEffect(() => {
    if (createDialogOpen && properties.length === 1) {
      createForm.setValue("propertyId", properties[0].id);
    }
  }, [createDialogOpen, properties, createForm]);

  useEffect(() => {
    if (editingPlan) {
      editForm.reset({
        propertyId: editingPlan.propertyId,
        frequency: editingPlan.frequency as any,
        dayOfWeek: (editingPlan.dayOfWeek as any) || "monday",
        pricePerVisit: editingPlan.pricePerVisit,
        startDate: editingPlan.startDate,
        routeId: editingPlan.routeId || "",
        isActive: editingPlan.isActive,
      });
      const planWithAddOns = servicePlans?.find(sp => sp.id === editingPlan.id);
      setEditSelectedAddOns(planWithAddOns?.addOns?.map(a => a.servicePricingId) || []);
    }
  }, [editingPlan, editForm, servicePlans]);

  const buildAddOnsPayload = (selectedIds: string[]) => {
    return selectedIds.map(id => {
      const item = addOnPricing.find(p => p.id === id);
      return { servicePricingId: id, name: item?.name || "", price: item?.basePrice || "0" };
    });
  };

  const createMutation = useMutation({
    mutationFn: async (data: ServicePlanFormValues) => {
      await apiRequest("POST", "/api/service-plans", {
        ...data,
        contactId,
        addOns: buildAddOnsPayload(createSelectedAddOns),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans" + `?contactId=${contactId}`] });
      toast({ title: "Service plan created" });
      setCreateDialogOpen(false);
      createForm.reset();
      setCreateSelectedAddOns([]);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ServicePlanFormValues> }) => {
      await apiRequest("PATCH", `/api/service-plans/${id}`, {
        ...data,
        addOns: buildAddOnsPayload(editSelectedAddOns),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans" + `?contactId=${contactId}`] });
      toast({ title: "Service plan updated" });
      setEditingPlan(null);
      setEditSelectedAddOns([]);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/service-plans/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans" + `?contactId=${contactId}`] });
      toast({ title: "Service plan deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handlePricingSelect = (pricingId: string, form: ReturnType<typeof useForm<ServicePlanFormValues>>) => {
    const item = pricingItems?.find((p) => p.id === pricingId);
    if (item) {
      form.setValue("pricePerVisit", item.basePrice);
    }
  };

  const createPropertyId = createForm.watch("propertyId");
  const createFrequency = createForm.watch("frequency");
  const createPrice = createForm.watch("pricePerVisit");

  const editPropertyId = editForm.watch("propertyId");
  const editFrequency = editForm.watch("frequency");
  const editPrice = editForm.watch("pricePerVisit");

  const { calcResult: createCalcResult, calcLoading: createCalcLoading } = useInlinePriceCalc(
    createPropertyId, createFrequency, createPrice, properties
  );
  const { calcResult: editCalcResult, calcLoading: editCalcLoading } = useInlinePriceCalc(
    editPropertyId, editFrequency, editPrice, properties
  );

  const renderPlanForm = (
    form: ReturnType<typeof useForm<ServicePlanFormValues>>,
    onSubmit: (v: ServicePlanFormValues) => void,
    isPending: boolean,
    submitLabel: string,
    isEdit?: boolean,
    calcResult?: PriceCalcResult | null,
    calcLoading?: boolean,
    selectedAddOns?: string[],
    setSelectedAddOns?: (ids: string[]) => void
  ) => {
    const freq = form.watch("frequency");
    const basePrice = form.watch("pricePerVisit");
    const templates = basePricingForFreq(freq);
    const addOnsTotal = (selectedAddOns || []).reduce((sum, id) => {
      const item = addOnPricing.find(p => p.id === id);
      return sum + parseFloat(item?.basePrice || "0");
    }, 0);
    const totalPerVisit = parseFloat(basePrice || "0") + addOnsTotal;

    return (
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField control={form.control} name="propertyId" render={({ field }) => (
            <FormItem>
              <FormLabel>Property</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl><SelectTrigger data-testid="select-plan-property"><SelectValue placeholder={properties.length === 0 ? "No properties" : "Select property"} /></SelectTrigger></FormControl>
                <SelectContent>
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.streetAddress}, {p.city}</SelectItem>
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
                <FormControl><SelectTrigger data-testid="select-plan-frequency"><SelectValue /></SelectTrigger></FormControl>
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
                  <FormControl><SelectTrigger data-testid="select-plan-day"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {daysOfWeek.map((d) => (
                      <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
          {templates.length > 0 && (
            <div>
              <Label className="text-sm">Use Pricing Template</Label>
              <Select onValueChange={(v) => handlePricingSelect(v, form)}>
                <SelectTrigger data-testid="select-pricing-template">
                  <SelectValue placeholder="Select pricing template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} - ${p.basePrice}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <FormField control={form.control} name="pricePerVisit" render={({ field }) => (
            <FormItem>
              <FormLabel>Base Price Per Visit ($)</FormLabel>
              <FormControl><Input type="number" step="0.01" {...field} data-testid="input-plan-price" /></FormControl>
              <InlinePriceSuggestion
                calcResult={calcResult || null}
                calcLoading={calcLoading || false}
                pricePerVisit={field.value || ""}
                onUsePrice={(price) => form.setValue("pricePerVisit", price)}
              />
              <FormMessage />
            </FormItem>
          )} />
          {addOnPricing.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm">Add-Ons (per visit)</Label>
              <div className="border rounded-md p-3 space-y-2">
                {addOnPricing.map((addon) => {
                  const checked = (selectedAddOns || []).includes(addon.id);
                  return (
                    <label key={addon.id} className="flex items-center gap-2 cursor-pointer" data-testid={`addon-${addon.id}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          if (!setSelectedAddOns) return;
                          setSelectedAddOns(
                            checked
                              ? (selectedAddOns || []).filter(id => id !== addon.id)
                              : [...(selectedAddOns || []), addon.id]
                          );
                        }}
                        className="accent-primary"
                      />
                      <span className="text-sm flex-1">{addon.name}</span>
                      <span className="text-sm text-muted-foreground">+${addon.basePrice}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {addOnsTotal > 0 && (
            <div className="bg-muted/50 rounded-md p-3 text-sm space-y-1" data-testid="price-breakdown">
              <div className="flex justify-between">
                <span>Base price</span>
                <span>${parseFloat(basePrice || "0").toFixed(2)}</span>
              </div>
              {(selectedAddOns || []).map(id => {
                const item = addOnPricing.find(p => p.id === id);
                return item ? (
                  <div key={id} className="flex justify-between text-muted-foreground">
                    <span>+ {item.name}</span>
                    <span>${parseFloat(item.basePrice).toFixed(2)}</span>
                  </div>
                ) : null;
              })}
              <div className="flex justify-between font-medium border-t pt-1">
                <span>Total per visit</span>
                <span>${totalPerVisit.toFixed(2)}</span>
              </div>
            </div>
          )}
          <FormField control={form.control} name="startDate" render={({ field }) => (
            <FormItem>
              <FormLabel>Start Date</FormLabel>
              <FormControl><Input type="date" {...field} data-testid="input-plan-start-date" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="routeId" render={({ field }) => (
              <FormItem>
                <FormLabel>Route (optional)</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger data-testid="select-plan-route"><SelectValue placeholder="No route" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {routes?.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
          {isEdit && (
            <FormField control={form.control} name="isActive" render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <input
                    type="checkbox"
                    checked={!!field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="accent-primary"
                    data-testid="checkbox-plan-active"
                  />
                </FormControl>
                <FormLabel className="!mt-0">Active</FormLabel>
              </FormItem>
            )} />
          )}
          <Button type="submit" disabled={isPending} data-testid="button-submit-plan">
            {isPending ? "Saving..." : submitLabel}
          </Button>
        </form>
      </Form>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-lg">Service Plans</CardTitle>
        <Dialog open={createDialogOpen} onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) createForm.reset();
        }}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-service-plan">
              <Plus className="mr-1 h-4 w-4" /> Add Plan
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Service Plan</DialogTitle>
            </DialogHeader>
            {renderPlanForm(createForm, (v) => createMutation.mutate(v), createMutation.isPending, "Create Service Plan", false, createCalcResult, createCalcLoading, createSelectedAddOns, setCreateSelectedAddOns)}
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {servicePlans && servicePlans.length > 0 ? (
          <div className="space-y-2">
            {servicePlans.map((plan) => (
              <div key={plan.id} className="border rounded-md p-3" data-testid={`text-plan-${plan.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium capitalize">{frequencyLabelsMap[plan.frequency] || plan.frequency} service</p>
                    <p className="text-sm text-muted-foreground">${plan.pricePerVisit}/visit</p>
                    {plan.addOns && plan.addOns.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {plan.addOns.map(a => (
                          <span key={a.id} className="inline-block mr-2">+ {a.name} (${a.price})</span>
                        ))}
                        <p className="font-medium text-foreground text-sm mt-0.5">
                          Total: ${(parseFloat(plan.pricePerVisit) + plan.addOns.reduce((s, a) => s + parseFloat(a.price), 0)).toFixed(2)}/visit
                        </p>
                      </div>
                    )}
                    {plan.dayOfWeek && (
                      <p className="text-xs text-muted-foreground capitalize">Day: {plan.dayOfWeek}</p>
                    )}
                    <p className="text-xs text-muted-foreground">Started: {plan.startDate}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={plan.isActive ? "default" : "secondary"}>
                      {plan.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditingPlan(plan)}
                      data-testid={`button-edit-plan-${plan.id}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-delete-plan-${plan.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Service Plan</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete this service plan and all associated visits. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteMutation.mutate(plan.id)}
                            data-testid={`button-confirm-delete-plan-${plan.id}`}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No service plans yet.</p>
        )}

        <Dialog open={!!editingPlan} onOpenChange={(open) => { if (!open) setEditingPlan(null); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Service Plan</DialogTitle>
            </DialogHeader>
            {editingPlan && renderPlanForm(
              editForm,
              (v) => updateMutation.mutate({ id: editingPlan.id, data: v }),
              updateMutation.isPending,
              "Save Changes",
              true,
              editCalcResult,
              editCalcLoading,
              editSelectedAddOns,
              setEditSelectedAddOns
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

const activityActionIcons: Record<string, typeof Plus> = {
  created: Plus,
  updated: Edit2,
  status_changed: ArrowRight,
  visit_completed: CheckCircle,
  visit_scheduled: Calendar,
  invoice_created: FileText,
  invoice_paid: DollarSign,
  email_sent: Mail,
  sms_sent: MessageSquare,
  note_added: StickyNote,
  portal_login: LogIn,
};

const activityActionLabels: Record<string, string> = {
  created: "Contact Created",
  updated: "Contact Updated",
  status_changed: "Status Changed",
  visit_completed: "Visit Completed",
  visit_scheduled: "Visit Scheduled",
  invoice_created: "Invoice Created",
  invoice_paid: "Invoice Paid",
  email_sent: "Email Sent",
  sms_sent: "SMS Sent",
  note_added: "Note Added",
  portal_login: "Portal Login",
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString();
}

function ActivitySection({ contactId }: { contactId: string }) {
  const { data: activityLogs, isLoading } = useQuery<ActivityLog[]>({
    queryKey: ["/api/contacts", contactId, "activity"],
  });

  return (
    <Card data-testid="section-activity">
      <CardHeader>
        <CardTitle className="text-lg">Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : activityLogs && activityLogs.length > 0 ? (
          <div className="space-y-0" data-testid="activity-timeline">
            {activityLogs.map((log, index) => {
              const Icon = activityActionIcons[log.action] || Plus;
              const label = activityActionLabels[log.action] || log.action;
              const details = log.details as Record<string, any> | null;
              const description = details?.description || details?.message || "";

              return (
                <div
                  key={log.id}
                  className="flex gap-3 relative"
                  data-testid={`activity-entry-${log.id}`}
                >
                  <div className="flex flex-col items-center">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full border bg-muted shrink-0">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    {index < activityLogs.length - 1 && (
                      <div className="w-px flex-1 bg-border min-h-[16px]" />
                    )}
                  </div>
                  <div className="pb-4 pt-1 min-w-0">
                    <p className="text-sm font-medium" data-testid={`activity-action-${log.id}`}>
                      {label}
                    </p>
                    {description && (
                      <p className="text-xs text-muted-foreground" data-testid={`activity-details-${log.id}`}>
                        {description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground" data-testid={`activity-time-${log.id}`}>
                      {formatRelativeTime(log.createdAt as unknown as string)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="text-no-activity">No activity recorded yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

const invoiceStatusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  voided: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  refunded: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

const visitStatusColors: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  in_progress: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  skipped: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const visitStatusLabels: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

type VisitHistoryRow = {
  id: string;
  scheduledDate: string;
  status: string;
  servicePlanName: string;
  propertyAddress: string;
  completedAt: string | null;
  startedAt: string | null;
};

type VisitHistoryResult = {
  visits: VisitHistoryRow[];
  total: number;
};

function VisitHistoryCard({ contactId }: { contactId: string }) {
  const [limit, setLimit] = useState(10);

  const { data, isLoading, isError } = useQuery<VisitHistoryResult>({
    queryKey: ["/api/contacts", contactId, "visits", limit],
    queryFn: async () => {
      const token = localStorage.getItem("sessionToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/contacts/${contactId}/visits?limit=${limit}`, { credentials: "include", headers });
      if (!res.ok) throw new Error("Failed to fetch visits");
      return res.json();
    },
  });

  const visits = data?.visits ?? [];
  const total = data?.total ?? 0;
  const hasMore = visits.length < total;

  return (
    <Card data-testid="card-visit-history">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Visit History
          {total > 0 && (
            <Badge variant="secondary" className="ml-auto text-xs" data-testid="badge-visit-count">
              {total} total
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isError ? (
          <p className="text-sm text-destructive text-center py-3" data-testid="text-visits-error">
            Failed to load visit history
          </p>
        ) : isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />
            ))}
          </div>
        ) : visits.length > 0 ? (
          <>
            <div className="space-y-2" data-testid="list-visit-history">
              {visits.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg border"
                  data-testid={`row-visit-${v.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium" data-testid={`text-visit-date-${v.id}`}>
                          {new Date(v.scheduledDate + "T00:00:00").toLocaleDateString("en-US", {
                            month: "short", day: "numeric", year: "numeric",
                          })}
                        </span>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] ${visitStatusColors[v.status] || ""}`}
                          data-testid={`badge-visit-status-${v.id}`}
                        >
                          {visitStatusLabels[v.status] || v.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground" data-testid={`text-visit-plan-${v.id}`}>
                          {v.servicePlanName}
                        </span>
                        {v.propertyAddress && v.propertyAddress !== "Unknown" && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {v.propertyAddress}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {hasMore && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setLimit(prev => prev + 20)}
                data-testid="button-show-more-visits"
              >
                <ChevronDown className="h-4 w-4 mr-1" />
                Show More ({total - visits.length} remaining)
              </Button>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-3" data-testid="text-no-visits">
            No visit history yet
          </p>
        )}
      </CardContent>
    </Card>
  );
}

type UninvoicedVisitRow = {
  id: string;
  scheduledDate: string;
  servicePlanName: string;
  pricePerVisit: string;
  propertyAddress: string;
  completedAt: string | null;
};

type UninvoicedResult = {
  visits: UninvoicedVisitRow[];
  totalDollars: number;
};

function BillingHistoryCard({ contactId }: { contactId: string }) {
  const [generateOpen, setGenerateOpen] = useState(false);

  const { data: invoicesData } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices", "contact", contactId],
    queryFn: () => {
      const token = localStorage.getItem("sessionToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return fetch(`/api/invoices?contactId=${contactId}`, { credentials: "include", headers }).then(r => {
        if (!r.ok) throw new Error("Failed to fetch");
        return r.json();
      });
    },
  });

  const { data: uninvoicedData } = useQuery<UninvoicedResult>({
    queryKey: ["/api/contacts", contactId, "uninvoiced-visits"],
  });

  const totalOutstanding = useMemo(() => {
    if (!invoicesData) return 0;
    return invoicesData
      .filter(inv => ["pending", "sent", "failed"].includes(inv.status))
      .reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);
  }, [invoicesData]);

  const totalPaid = useMemo(() => {
    if (!invoicesData) return 0;
    return invoicesData
      .filter(inv => inv.status === "paid")
      .reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);
  }, [invoicesData]);

  const sortedInvoices = useMemo(() => {
    if (!invoicesData) return [];
    return [...invoicesData].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [invoicesData]);

  return (
    <>
      <Card data-testid="card-billing-history">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Billing
          </CardTitle>
          <Button size="sm" onClick={() => setGenerateOpen(true)} data-testid="button-generate-invoice-contact">
            <Zap className="mr-1 h-4 w-4" /> Generate Invoice
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 rounded-lg bg-muted/50" data-testid="billing-uninvoiced">
              <p className="text-xs text-muted-foreground mb-1">Uninvoiced</p>
              <p className="text-lg font-bold text-orange-600 dark:text-orange-400">
                ${(uninvoicedData?.totalDollars ?? 0).toFixed(2)}
              </p>
              <p className="text-[10px] text-muted-foreground">{uninvoicedData?.visits?.length ?? 0} visits</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50" data-testid="billing-outstanding">
              <p className="text-xs text-muted-foreground mb-1">Outstanding</p>
              <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
                ${totalOutstanding.toFixed(2)}
              </p>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50" data-testid="billing-paid">
              <p className="text-xs text-muted-foreground mb-1">Paid</p>
              <p className="text-lg font-bold text-green-600 dark:text-green-400">
                ${totalPaid.toFixed(2)}
              </p>
            </div>
          </div>

          {uninvoicedData && uninvoicedData.visits.length > 0 && (
            <div className="border border-orange-200 dark:border-orange-800 rounded-lg p-3 bg-orange-50 dark:bg-orange-950/30 space-y-2" data-testid="section-uninvoiced-alert">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                  <span className="text-sm font-medium">
                    {uninvoicedData.visits.length} completed visit{uninvoicedData.visits.length !== 1 ? "s" : ""} need invoicing
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setGenerateOpen(true)}
                  data-testid="button-invoice-uninvoiced-alert"
                >
                  Invoice Now
                </Button>
              </div>
              <div className="space-y-1 mt-1" data-testid="list-uninvoiced-visits">
                {uninvoicedData.visits.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-2 text-sm py-1 px-2 rounded bg-white/60 dark:bg-black/20" data-testid={`uninvoiced-visit-${v.id}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">
                        {new Date(v.scheduledDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">{v.servicePlanName}</span>
                    </div>
                    <span className="font-medium tabular-nums">${parseFloat(v.pricePerVisit).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sortedInvoices.length > 0 ? (
            <div className="space-y-2" data-testid="section-invoice-history">
              <p className="text-sm font-medium text-muted-foreground">Recent Invoices</p>
              {sortedInvoices.slice(0, 10).map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-2 py-2 border-b last:border-0"
                  data-testid={`row-invoice-${inv.id}`}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className={`text-[10px] ${invoiceStatusColors[inv.status] || ""}`}>
                      {inv.status}
                    </Badge>
                    <span className="text-sm">#{inv.invoiceNumber}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(inv.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <span className="text-sm font-medium tabular-nums">${parseFloat(inv.total).toFixed(2)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-3" data-testid="text-no-invoices">
              No invoices yet
            </p>
          )}
        </CardContent>
      </Card>

      <GenerateInvoiceDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        contactId={contactId}
      />
    </>
  );
}
