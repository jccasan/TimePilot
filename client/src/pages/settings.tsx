import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Building2, Users, Mail, Phone, MapPin, Save, Shield, Wrench, Crown, Upload, Image, Download, FileSpreadsheet, FileDown, Plus, X, AlertTriangle, CheckCircle2, Info, KeyRound } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TIER_CONFIG } from "@shared/schema";
import { useUpload } from "@/hooks/use-upload";
import { AddressAutocomplete } from "@/components/address-autocomplete";

const companyFormSchema = z.object({
  name: z.string().min(1, "Company name is required"),
  email: z.string().email("Invalid email").or(z.literal("")).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  startAddress: z.string().optional(),
  startLatitude: z.string().optional(),
  startLongitude: z.string().optional(),
});

type CompanyFormValues = z.infer<typeof companyFormSchema>;

type Company = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  startAddress: string | null;
  startLatitude: string | null;
  startLongitude: string | null;
  logoUrl: string | null;
  subscriptionTier: string;
  subscriptionStatus: string;
};

type TeamMember = {
  id: string;
  companyUserId: string;
  role: string;
  firstName: string;
  lastName: string;
  email: string;
  profileImageUrl: string | null;
};

const roleIcons: Record<string, typeof Crown> = {
  owner: Crown,
  admin: Shield,
  tech: Wrench,
};

const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  tech: "Technician",
};

type ImportRow = Record<string, string>;
type ColumnMapping = { csvHeader: string; mappedField: string };

type ValidationResult = {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  issues: { row: number; field: string; message: string }[];
  newLeadSources: string[];
  headers: string[];
  columnMapping: ColumnMapping[];
  rows: ImportRow[];
};

const CONTACT_FIELDS = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "streetAddress", label: "Street Address" },
  { key: "address2", label: "Address 2" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zipCode", label: "Zip Code" },
  { key: "numberOfDogs", label: "# Dogs" },
  { key: "yardSize", label: "Yard Size" },
  { key: "serviceFrequency", label: "Frequency" },
  { key: "serviceDay", label: "Service Day" },
  { key: "leadSource", label: "Lead Source" },
  { key: "referralSource", label: "Referral Source" },
  { key: "status", label: "Status" },
  { key: "notes", label: "Notes" },
];

export default function Settings() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [newLeadSourceName, setNewLeadSourceName] = useState("");
  const [importStep, setImportStep] = useState<"idle" | "mapping" | "review">("idle");
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  const [inviteRole, setInviteRole] = useState("tech");
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [rawCsvRows, setRawCsvRows] = useState<string[][]>([]);
  const [settingsColumnMapping, setSettingsColumnMapping] = useState<ColumnMapping[]>([]);
  const [settingsNewLeadSources, setSettingsNewLeadSources] = useState<string[]>([]);
  const [isValidating, setIsValidating] = useState(false);

  const { data: currentUser } = useQuery<{ id: string; role?: string }>({
    queryKey: ["/api/auth/user"],
  });

  const { data: company, isLoading: loadingCompany } = useQuery<Company>({
    queryKey: ["/api/company"],
  });

  const { data: team, isLoading: loadingTeam } = useQuery<TeamMember[]>({
    queryKey: ["/api/company/team"],
  });

  const { data: leadSources = [], isLoading: loadingLeadSources } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/lead-sources"],
  });

  const addLeadSourceMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/lead-sources", { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-sources"] });
      setNewLeadSourceName("");
      toast({ title: "Lead source added" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add lead source.", variant: "destructive" });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async (data: { email: string; firstName: string; lastName: string; role: string }) => {
      const res = await apiRequest("POST", "/api/company/invite", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/team"] });
      setInviteDialogOpen(false);
      setInviteEmail("");
      setInviteFirstName("");
      setInviteLastName("");
      setInviteRole("tech");
      toast({ title: "Team member invited", description: "An email with login credentials has been sent." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to invite", description: err.message || "Something went wrong", variant: "destructive" });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("DELETE", `/api/company/team/${userId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company/team"] });
      setRemovingMemberId(null);
      toast({ title: "Team member removed" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to remove", description: err.message || "Something went wrong", variant: "destructive" });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/change-password", { newPassword });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to change password");
      }
      return res.json();
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      toast({ title: "Password updated", description: "Your password has been changed successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteLeadSourceMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/lead-sources/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lead-sources"] });
      toast({ title: "Lead source removed" });
    },
  });

  const { uploadFile, isUploading } = useUpload({
    onSuccess: async (response) => {
      await apiRequest("PATCH", "/api/company", { logoUrl: response.objectPath });
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: "Logo uploaded", description: "Your company logo has been updated." });
    },
    onError: (error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companyFormSchema),
    values: {
      name: company?.name || "",
      email: company?.email || "",
      phone: company?.phone || "",
      address: company?.address || "",
      startAddress: company?.startAddress || "",
      startLatitude: company?.startLatitude || "",
      startLongitude: company?.startLongitude || "",
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: CompanyFormValues) => {
      const res = await apiRequest("PATCH", "/api/company", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company"] });
      toast({ title: "Company updated", description: "Your company information has been saved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update company information.", variant: "destructive" });
    },
  });

  const MAX_LOGO_SIZE = 2 * 1024 * 1024;

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image file (PNG or JPG).", variant: "destructive" });
      return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      toast({ title: "File too large", description: "Logo must be under 2 MB. Please resize your image and try again.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
    await uploadFile(file);
  };

  const currentTier = company?.subscriptionTier as keyof typeof TIER_CONFIG | undefined;
  const tierInfo = currentTier ? TIER_CONFIG[currentTier] : null;

  const displayLogo = logoPreview || (company?.logoUrl ? company.logoUrl : null);

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
      <h1 className="text-2xl font-bold" data-testid="text-settings-heading">Settings</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Image className="h-5 w-5" />
                Company Logo
              </CardTitle>
              <CardDescription>Upload a logo to display on invoices and your portal</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-lg border-2 border-dashed border-muted-foreground/25 flex items-center justify-center overflow-hidden bg-muted/50">
                  {displayLogo ? (
                    <img src={displayLogo} alt="Company logo" className="w-full h-full object-cover rounded-lg" data-testid="img-company-logo" />
                  ) : (
                    <Building2 className="h-8 w-8 text-muted-foreground/50" />
                  )}
                </div>
                <div className="space-y-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    data-testid="button-upload-logo"
                  >
                    <Upload className="mr-1 h-4 w-4" />
                    {isUploading ? "Uploading..." : "Upload Logo"}
                  </Button>
                  <p className="text-xs text-muted-foreground">Recommended: 200x200px, PNG or JPG, max 2 MB</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Company Information
              </CardTitle>
              <CardDescription>Update your business details</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCompany ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : (
                <Form {...form}>
                  <form onSubmit={form.handleSubmit((data) => updateMutation.mutate(data))} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Company Name</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input {...field} className="pl-10" data-testid="input-company-name" />
                            </div>
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
                            <div className="relative">
                              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input {...field} type="email" className="pl-10" data-testid="input-company-email" />
                            </div>
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
                            <div className="relative">
                              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input {...field} className="pl-10" data-testid="input-company-phone" />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Business Address</FormLabel>
                          <FormControl>
                            <Textarea {...field} rows={3} data-testid="input-company-address" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="pt-2 border-t">
                      <p className="text-sm font-medium mb-1">Route Starting Point</p>
                      <p className="text-xs text-muted-foreground mb-3">
                        Enter your home base address for route optimization. Routes will be ordered starting from this location.
                      </p>
                      <FormField
                        control={form.control}
                        name="startAddress"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Starting Address</FormLabel>
                            <FormControl>
                              <AddressAutocomplete
                                value={field.value || ""}
                                onChange={field.onChange}
                                onSelect={(addr) => {
                                  form.setValue("startAddress", `${addr.streetAddress}, ${addr.city}, ${addr.state} ${addr.zipCode}`);
                                  if (addr.latitude) form.setValue("startLatitude", String(addr.latitude));
                                  if (addr.longitude) form.setValue("startLongitude", String(addr.longitude));
                                }}
                                data-testid="input-start-address"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      {(form.watch("startLatitude") || form.watch("startLongitude")) && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Coordinates: {form.watch("startLatitude") || "—"}, {form.watch("startLongitude") || "—"}
                        </p>
                      )}
                    </div>
                    <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save-company">
                      <Save className="h-4 w-4 mr-2" />
                      {updateMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </form>
                </Form>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Team Members
                  </CardTitle>
                  <CardDescription>
                    {team?.length || 0} / {tierInfo?.maxUsers || 1} seats used
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  onClick={() => setInviteDialogOpen(true)}
                  data-testid="button-invite-team-member"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Invite Team Member
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingTeam ? (
                <div className="space-y-3">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : (
                <div className="space-y-3">
                  {team?.map((member) => {
                    const RoleIcon = roleIcons[member.role] || Wrench;
                    const canRemove = member.id !== currentUser?.id && member.role !== "owner";
                    return (
                      <div
                        key={member.companyUserId}
                        className="flex items-center gap-3 p-3 rounded-md border"
                        data-testid={`card-team-member-${member.id}`}
                      >
                        <Avatar>
                          <AvatarImage src={member.profileImageUrl || undefined} />
                          <AvatarFallback>
                            {(member.firstName?.[0] || "").toUpperCase()}
                            {(member.lastName?.[0] || "").toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate" data-testid={`text-member-name-${member.id}`}>
                            {member.firstName} {member.lastName}
                          </p>
                          <p className="text-sm text-muted-foreground truncate">
                            {member.email}
                          </p>
                        </div>
                        <Badge variant="secondary" className="flex items-center gap-1" data-testid={`badge-member-role-${member.id}`}>
                          <RoleIcon className="h-3 w-3" />
                          {roleLabels[member.role] || member.role}
                        </Badge>
                        {canRemove && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setRemovingMemberId(member.id)}
                            data-testid={`button-remove-member-${member.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {(!team || team.length === 0) && (
                    <p className="text-sm text-muted-foreground text-center py-4">No team members yet</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Subscription</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingCompany ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="font-semibold" data-testid="text-settings-tier">{tierInfo?.name || "Unknown"}</p>
                    <p className="text-sm text-muted-foreground">${tierInfo?.price?.toFixed(2) || "0.00"}/month</p>
                  </div>
                  <Badge
                    variant={company?.subscriptionStatus === "active" ? "default" : "secondary"}
                    data-testid="badge-subscription-status"
                  >
                    {company?.subscriptionStatus || "unknown"}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Change Password
              </CardTitle>
              <CardDescription>Update your login password</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newPassword.length < 8) {
                    toast({ title: "Error", description: "Password must be at least 8 characters", variant: "destructive" });
                    return;
                  }
                  if (newPassword !== confirmNewPassword) {
                    toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
                    return;
                  }
                  changePasswordMutation.mutate();
                }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <label htmlFor="newPassword" className="text-sm font-medium">New Password</label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    minLength={8}
                    required
                    data-testid="input-new-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="confirmNewPassword" className="text-sm font-medium">Confirm New Password</label>
                  <Input
                    id="confirmNewPassword"
                    type="password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Confirm your new password"
                    minLength={8}
                    required
                    data-testid="input-confirm-new-password"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={changePasswordMutation.isPending || !newPassword || !confirmNewPassword}
                  data-testid="button-change-password"
                >
                  {changePasswordMutation.isPending ? "Updating..." : "Update Password"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                Data Import / Export
              </CardTitle>
              <CardDescription>Import or export your contacts as a CSV file. The CSV should include columns for name, address, and service details.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open("/api/contacts/export/csv", "_blank")}
                  data-testid="button-export-csv"
                >
                  <Download className="mr-1 h-4 w-4" />
                  Export Contacts
                </Button>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setIsValidating(true);
                    try {
                      const text = await file.text();
                      const res = await apiRequest("POST", "/api/contacts/validate-csv", { csv: text });
                      const validation = await res.json();
                      setSettingsColumnMapping(validation.columnMapping);
                      setSettingsNewLeadSources(validation.newLeadSources);
                      setRawCsvRows(validation.rawRows);
                      setImportRows(validation.rows);
                      setImportStep("mapping");
                    } catch (err: any) {
                      toast({ title: "Validation failed", description: err.message, variant: "destructive" });
                    } finally {
                      setIsValidating(false);
                      if (csvInputRef.current) csvInputRef.current.value = "";
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => csvInputRef.current?.click()}
                  disabled={isValidating}
                  data-testid="button-import-csv"
                >
                  <Upload className="mr-1 h-4 w-4" />
                  {isValidating ? "Validating..." : "Import Contacts"}
                </Button>
              </div>
              <div className="border-t pt-3">
                <p className="text-sm text-muted-foreground mb-2">Need a template? Download an import template with the correct column headers and example data.</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open("/api/contacts/sample-csv", "_blank")}
                  data-testid="button-download-sample-csv"
                >
                  <FileDown className="mr-1 h-4 w-4" />
                  Download Import Template
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5" />
                Lead Sources
              </CardTitle>
              <CardDescription>Manage the lead sources available in contact forms. These are used to track where your clients come from.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingLeadSources ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {leadSources.map((source) => (
                      <Badge key={source.id} variant="secondary" className="flex items-center gap-1 pr-1" data-testid={`badge-lead-source-${source.id}`}>
                        {source.name}
                        <button
                          onClick={() => deleteLeadSourceMutation.mutate(source.id)}
                          className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                          data-testid={`button-delete-lead-source-${source.id}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                    {leadSources.length === 0 && (
                      <p className="text-sm text-muted-foreground">No lead sources configured.</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={newLeadSourceName}
                      onChange={(e) => setNewLeadSourceName(e.target.value)}
                      placeholder="Add a lead source..."
                      className="flex-1"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newLeadSourceName.trim()) {
                          e.preventDefault();
                          addLeadSourceMutation.mutate(newLeadSourceName.trim());
                        }
                      }}
                      data-testid="input-new-lead-source"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => newLeadSourceName.trim() && addLeadSourceMutation.mutate(newLeadSourceName.trim())}
                      disabled={!newLeadSourceName.trim() || addLeadSourceMutation.isPending}
                      data-testid="button-add-lead-source"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={importStep !== "idle"} onOpenChange={(open) => { if (!open) { setImportStep("idle"); setImportRows([]); setRawCsvRows([]); setSettingsColumnMapping([]); setSettingsNewLeadSources([]); } }}>
        <DialogContent className="max-w-[95vw] w-[900px] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {importStep === "mapping" ? "Map Columns" : "Review & Edit Contacts"}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              {importStep === "mapping"
                ? "Verify how your CSV columns map to contact fields. Adjust any mismatched mappings."
                : `${importRows.length} contact${importRows.length !== 1 ? "s" : ""} ready to import. Edit any field, or remove rows you don't want.`}
            </p>
          </DialogHeader>

          {importStep === "mapping" && (
            <div className="space-y-4 overflow-y-auto flex-1">
              <div className="grid gap-2">
                {settingsColumnMapping.map((col, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-2 rounded-md bg-muted/30">
                    <div className="w-[200px] text-sm font-medium truncate" title={col.csvHeader}>
                      {col.csvHeader}
                    </div>
                    <span className="text-muted-foreground text-sm">-&gt;</span>
                    <Select
                      value={col.mappedField || "__skip__"}
                      onValueChange={(v) => {
                        const updated = [...settingsColumnMapping];
                        updated[idx] = { ...updated[idx], mappedField: v === "__skip__" ? "" : v };
                        setSettingsColumnMapping(updated);
                      }}
                    >
                      <SelectTrigger className="w-[200px]" data-testid={`select-mapping-${idx}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">-- Skip this column --</SelectItem>
                        {CONTACT_FIELDS.map(f => (
                          <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {col.mappedField ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                  </div>
                ))}
              </div>

              {settingsNewLeadSources.length > 0 && (
                <div className="border rounded-md p-3 space-y-1 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">New Lead Sources</p>
                  <p className="text-xs text-muted-foreground">These will be added to your lead sources list:</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {settingsNewLeadSources.map((s) => (
                      <Badge key={s} variant="outline" className="text-amber-700 dark:text-amber-400 border-amber-300">{s}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {importStep === "review" && (
            <div className="flex-1 overflow-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="p-2 text-left font-medium w-8">#</th>
                    {CONTACT_FIELDS.filter(f => importRows.some(r => r[f.key])).map(f => (
                      <th key={f.key} className="p-2 text-left font-medium whitespace-nowrap">{f.label}</th>
                    ))}
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {importRows.map((row, rowIdx) => {
                    const hasName = row.firstName && row.lastName;
                    const visibleFields = CONTACT_FIELDS.filter(f => importRows.some(r => r[f.key]));
                    return (
                      <tr
                        key={rowIdx}
                        className={`border-t ${!hasName ? "bg-destructive/5" : ""}`}
                      >
                        <td className="p-2 text-muted-foreground">{rowIdx + 1}</td>
                        {visibleFields.map(f => (
                          <td key={f.key} className="p-1">
                            <Input
                              value={row[f.key] || ""}
                              onChange={(e) => {
                                const updated = [...importRows];
                                updated[rowIdx] = { ...updated[rowIdx], [f.key]: e.target.value };
                                setImportRows(updated);
                              }}
                              className={`h-8 text-xs ${(f.key === "firstName" || f.key === "lastName") && !row[f.key] ? "border-destructive" : ""}`}
                            />
                          </td>
                        ))}
                        <td className="p-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            onClick={() => setImportRows(importRows.filter((_, i) => i !== rowIdx))}
                          >
                            X
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {importRows.length === 0 && (
                <div className="p-8 text-center text-muted-foreground">
                  All rows have been removed. Cancel to start over.
                </div>
              )}
            </div>
          )}

          {importStep === "review" && (() => {
            const missingNames = importRows.filter(r => !r.firstName || !r.lastName);
            return missingNames.length > 0 ? (
              <div className="border rounded-md p-3 space-y-1 border-destructive/50 bg-destructive/5 flex-shrink-0">
                <p className="text-sm font-medium text-destructive">{missingNames.length} row{missingNames.length !== 1 ? "s" : ""} missing required fields</p>
                <p className="text-xs text-muted-foreground">Rows without a first and last name will be skipped. Edit them above or remove them.</p>
              </div>
            ) : null;
          })()}

          <DialogFooter className="gap-2 flex-shrink-0">
            <Button variant="outline" onClick={() => { setImportStep("idle"); setImportRows([]); setRawCsvRows([]); setSettingsColumnMapping([]); setSettingsNewLeadSources([]); }} data-testid="button-cancel-import">
              Cancel
            </Button>
            {importStep === "mapping" && (
              <Button
                onClick={() => {
                  const remapped = rawCsvRows.map(values => {
                    const row: ImportRow = {};
                    settingsColumnMapping.forEach((col, idx) => {
                      if (col.mappedField) {
                        row[col.mappedField] = values[idx] || "";
                      }
                    });
                    return row;
                  });
                  setImportRows(remapped);
                  setImportStep("review");
                }}
                data-testid="button-continue-to-review"
              >
                Continue to Review
              </Button>
            )}
            {importStep === "review" && (
              <>
                <Button variant="outline" onClick={() => setImportStep("mapping")}>
                  Back
                </Button>
                <Button
                  disabled={isImporting || importRows.filter(r => r.firstName && r.lastName).length === 0}
                  onClick={async () => {
                    setIsImporting(true);
                    try {
                      const validRows = importRows.filter(r => r.firstName && r.lastName);
                      const res = await apiRequest("POST", "/api/contacts/import/json", { rows: validRows });
                      const result = await res.json();
                      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
                      queryClient.invalidateQueries({ queryKey: ["/api/lead-sources"] });
                      let description = `${result.imported} contact${result.imported !== 1 ? "s" : ""} imported successfully.`;
                      if (result.addedLeadSources?.length) {
                        description += ` ${result.addedLeadSources.length} new lead source${result.addedLeadSources.length !== 1 ? "s" : ""} added.`;
                      }
                      if (result.errors?.length) {
                        description += ` ${result.errors.length} row(s) had issues.`;
                      }
                      toast({ title: "Import complete", description });
                      setImportStep("idle");
                      setImportRows([]);
                      setRawCsvRows([]);
                      setSettingsColumnMapping([]);
                      setSettingsNewLeadSources([]);
                    } catch (err: any) {
                      toast({ title: "Import failed", description: err.message, variant: "destructive" });
                    } finally {
                      setIsImporting(false);
                    }
                  }}
                  data-testid="button-confirm-import"
                >
                  {isImporting ? "Importing..." : `Import ${importRows.filter(r => r.firstName && r.lastName).length} Contacts`}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">First Name</label>
                <Input
                  value={inviteFirstName}
                  onChange={(e) => setInviteFirstName(e.target.value)}
                  placeholder="First name"
                  data-testid="input-invite-first-name"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Last Name</label>
                <Input
                  value={inviteLastName}
                  onChange={(e) => setInviteLastName(e.target.value)}
                  placeholder="Last name"
                  data-testid="input-invite-last-name"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@example.com"
                data-testid="input-invite-email"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Role</label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger data-testid="select-invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tech">Technician</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!inviteEmail || !inviteFirstName || inviteMutation.isPending}
              onClick={() => inviteMutation.mutate({ email: inviteEmail, firstName: inviteFirstName, lastName: inviteLastName, role: inviteRole })}
              data-testid="button-confirm-invite"
            >
              {inviteMutation.isPending ? "Sending..." : "Send Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removingMemberId} onOpenChange={(open) => !open && setRemovingMemberId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Team Member</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to remove this team member? They will lose access to the company and be unassigned from any routes.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemovingMemberId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={removeMemberMutation.isPending}
              onClick={() => removingMemberId && removeMemberMutation.mutate(removingMemberId)}
              data-testid="button-confirm-remove-member"
            >
              {removeMemberMutation.isPending ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
