/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Contact, Tag } from "@shared/schema";
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
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  Search,
  Download,
  Upload,
  FileDown,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Tags,
  RefreshCw,
  Send,
  SlidersHorizontal,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { DialogFooter } from "@/components/ui/dialog";
import { AddContactDialog } from "@/components/add-contact-dialog";
import { LearnHowButton } from "@/components/interactive-tutorial";
import { useTutorialContext } from "@/hooks/use-tutorials";
import { useAddressLabels } from "@/hooks/use-address-labels";
import { BulkServicePlanSetup } from "@/components/bulk-service-plan-setup";

type OnboardingStatus = { pending: boolean; completed: boolean } | null;
type EnrichedContact = Contact & { onboardingStatus: OnboardingStatus };

const statusColors: Record<string, string> = {
  lead: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  estimate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  paused: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

type ImportRow = Record<string, string>;

type ColumnMapping = { csvHeader: string; mappedField: string };

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
  { key: "numberOfDogs", label: "Number of Dogs" },
  { key: "yardSize", label: "Yard Size" },
  { key: "serviceFrequency", label: "Frequency" },
  { key: "serviceDay", label: "Service Day" },
  { key: "leadSource", label: "Lead Source" },
  { key: "referralSource", label: "Referral Source" },
  { key: "status", label: "Status" },
  { key: "notes", label: "Notes" },
];

const VALID_STATUS_FILTERS = ["all", "lead", "estimate", "active", "paused", "cancelled"];
const VALID_TYPE_FILTERS = ["all", "residential", "commercial"];

function getInitialStatusFilter(): string {
  const params = new URLSearchParams(window.location.search);
  const s = params.get("status");
  return s && VALID_STATUS_FILTERS.includes(s) ? s : "all";
}

function getInitialTypeFilter(): string {
  const params = new URLSearchParams(window.location.search);
  const t = params.get("contactType");
  return t && VALID_TYPE_FILTERS.includes(t) ? t : "all";
}

function ContactTypeBadge({ type, testId }: { type: string | null | undefined; testId?: string }) {
  if (!type || type === "residential") {
    return (
      <Badge
        variant="outline"
        className="text-xs border-green-300 text-green-700 bg-green-50 dark:border-green-700 dark:text-green-400 dark:bg-green-950/20"
        data-testid={testId}
      >
        Residential
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-xs border-blue-300 text-blue-700 bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:bg-blue-950/20"
      data-testid={testId}
    >
      Commercial
    </Badge>
  );
}

export default function Contacts() {
  const { toast } = useToast();
  const { startTutorial, isTutorialCompleted } = useTutorialContext();
  const { zipLabel, stateLabel } = useAddressLabels();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(getInitialStatusFilter);
  const [typeFilter, setTypeFilter] = useState(getInitialTypeFilter);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importStep, setImportStep] = useState<"idle" | "mapping" | "review">("idle");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [rawCsvRows, setRawCsvRows] = useState<string[][]>([]);
  const [, setRawCsvHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping[]>([]);
  const [newLeadSources, setNewLeadSources] = useState<string[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditDayOfWeek, setBulkEditDayOfWeek] = useState("");
  const [bulkEditFrequency, setBulkEditFrequency] = useState("");
  const [bulkServicePlanOpen, setBulkServicePlanOpen] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, typeFilter, search]);

  const queryParams = new URLSearchParams();
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  if (typeFilter !== "all") queryParams.set("contactType", typeFilter);
  if (search) queryParams.set("search", search);
  queryParams.set("page", String(page));
  queryParams.set("limit", String(PAGE_SIZE));
  const queryString = queryParams.toString();

  type ContactsPageResponse = {
    contacts: (EnrichedContact & { isStopOnlyContact?: boolean })[];
    total: number;
    page: number;
    pageSize: number;
  };

  const { data: contactsData, isLoading } = useQuery<ContactsPageResponse>({
    queryKey: ["/api/contacts" + `?${queryString}`],
  });

  const contacts = contactsData?.contacts ?? [];
  const totalContacts = contactsData?.total ?? 0;
  const totalPages = Math.ceil(totalContacts / PAGE_SIZE);

  const { data: tagsList = [] } = useQuery<Tag[]>({
    queryKey: ["/api/tags"],
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async (data: { ids: string[]; status?: string; tagId?: string }) => {
      await apiRequest("POST", "/api/contacts/bulk-update", data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      setSelectedIds(new Set());
      const action = variables.status ? `Status changed to ${variables.status}` : "Tag added";
      toast({
        title: "Bulk update complete",
        description: `${action} for ${variables.ids.length} contact(s).`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Bulk update failed", description: error.message, variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await apiRequest("POST", "/api/contacts/bulk-delete", { ids });
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/company/pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setSelectedIds(new Set());
      setDeleteConfirmOpen(false);
      toast({
        title: "Contacts deleted",
        description: `${ids.length} contact(s) deleted successfully.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const sendPortalLinkMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/contacts/bulk/send-portal-link", {
        contactIds: ids,
      });
      return res.json();
    },
    onSuccess: (data: { sent: number; skipped: number; errors?: string[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setSelectedIds(new Set());
      let description = `Portal link sent to ${data.sent} contact(s).`;
      if (data.skipped > 0) description += ` ${data.skipped} skipped.`;
      if (data.errors && data.errors.length > 0)
        description += ` Issues: ${data.errors.join(", ")}`;
      toast({ title: "Portal links sent", description });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const bulkUpdateServicePlansMutation = useMutation({
    mutationFn: async (data: { ids: string[]; dayOfWeek?: string; frequency?: string }) => {
      const res = await apiRequest("POST", "/api/contacts/bulk-update-service-plans", data);
      return res.json();
    },
    onSuccess: (data: { plansUpdated: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/service-plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setSelectedIds(new Set());
      setBulkEditOpen(false);
      setBulkEditDayOfWeek("");
      setBulkEditFrequency("");
      toast({
        title: "Service plans updated",
        description: `${data.plansUpdated} service plan${data.plansUpdated !== 1 ? "s" : ""} updated.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  const handleBulkEditApply = () => {
    if (!bulkEditDayOfWeek && !bulkEditFrequency) {
      toast({
        title: "Nothing selected",
        description: "Choose at least one field to update.",
        variant: "destructive",
      });
      return;
    }
    bulkUpdateServicePlansMutation.mutate({
      ids: Array.from(selectedIds),
      ...(bulkEditDayOfWeek ? { dayOfWeek: bulkEditDayOfWeek } : {}),
      ...(bulkEditFrequency ? { frequency: bulkEditFrequency } : {}),
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!contacts) return;
    if (selectedIds.size === contacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contacts.map((c) => c.id)));
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold" data-testid="text-contacts-heading">
            Contacts
          </h1>
          <LearnHowButton
            tutorialId="tutorial_import_wizard"
            onStart={startTutorial}
            isCompleted={isTutorialCompleted("tutorial_import_wizard")}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open("/api/contacts/export/csv", "_blank")}
            data-testid="button-export-csv"
          >
            <Download className="mr-1 h-4 w-4" />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isValidating}
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".csv";
              input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                setIsValidating(true);
                try {
                  const text = await file.text();
                  const res = await apiRequest("POST", "/api/contacts/validate-csv", { csv: text });
                  const validation = await res.json();
                  setColumnMapping(validation.columnMapping);
                  setNewLeadSources(validation.newLeadSources);
                  setRawCsvRows(validation.rawRows);
                  setRawCsvHeaders(validation.csvHeaders);
                  setImportRows(validation.rows);
                  setImportStep("mapping");
                } catch (err: any) {
                  toast({
                    title: "Validation failed",
                    description: err.message,
                    variant: "destructive",
                  });
                } finally {
                  setIsValidating(false);
                }
              };
              input.click();
            }}
            data-testid="button-import-csv"
          >
            <Upload className="mr-1 h-4 w-4" />
            {isValidating ? "Validating..." : "Import"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open("/api/contacts/sample-csv", "_blank")}
            data-testid="button-download-sample-csv"
          >
            <FileDown className="mr-1 h-4 w-4" />
            Import Template
          </Button>
          <Button onClick={() => setDialogOpen(true)} data-testid="button-add-contact">
            <Plus className="mr-1 h-4 w-4" />
            New Customer
          </Button>
          <AddContactDialog open={dialogOpen} onOpenChange={setDialogOpen} />
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, email, or address..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-9"
          data-testid="input-search-contacts"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="all" data-testid="tab-all">
              All
            </TabsTrigger>
            <TabsTrigger value="lead" data-testid="tab-lead">
              Lead
            </TabsTrigger>
            <TabsTrigger value="estimate" data-testid="tab-estimate">
              Estimate
            </TabsTrigger>
            <TabsTrigger value="active" data-testid="tab-active">
              Active
            </TabsTrigger>
            <TabsTrigger value="paused" data-testid="tab-paused">
              Paused
            </TabsTrigger>
            <TabsTrigger value="cancelled" data-testid="tab-cancelled">
              Cancelled
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Select
          value={typeFilter}
          onValueChange={(v) => {
            if (VALID_TYPE_FILTERS.includes(v)) setTypeFilter(v);
          }}
        >
          <SelectTrigger className="w-[160px] h-9" data-testid="select-type-filter">
            <SelectValue placeholder="Type: All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Type: All</SelectItem>
            <SelectItem value="residential">Residential</SelectItem>
            <SelectItem value="commercial">Commercial</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : contacts && contacts.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Checkbox
              checked={selectedIds.size === contacts.length && contacts.length > 0}
              onCheckedChange={toggleSelectAll}
              data-testid="checkbox-select-all"
              aria-label="Select all contacts"
            />
            <span className="text-sm text-muted-foreground">
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
            </span>
          </div>
          {contacts.map((contact) => (
            <div key={contact.id} className="flex items-stretch gap-2">
              <div className="flex items-center px-1">
                <Checkbox
                  checked={selectedIds.has(contact.id)}
                  onCheckedChange={() => toggleSelect(contact.id)}
                  data-testid={`checkbox-contact-${contact.id}`}
                  aria-label={`Select ${contact.firstName} ${contact.lastName}`}
                />
              </div>
              <Link href={`/contacts/${contact.id}`} className="flex-1 min-w-0">
                <Card
                  className="hover-elevate cursor-pointer"
                  data-testid={`card-contact-${contact.id}`}
                >
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                    <div>
                      <p className="font-medium" data-testid={`text-contact-name-${contact.id}`}>
                        {contact.firstName} {contact.lastName}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {contact.email || "No email"} {contact.phone ? ` | ${contact.phone}` : ""}
                      </p>
                      {contact.streetAddress && (
                        <p
                          className="text-sm text-muted-foreground"
                          data-testid={`text-contact-address-${contact.id}`}
                        >
                          {contact.streetAddress}
                          {contact.address2 ? `, ${contact.address2}` : ""}
                          {contact.city ? `, ${contact.city}` : ""}
                          {contact.state ? `, ${contact.state}` : ""} {contact.zipCode || ""}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <ContactTypeBadge
                        type={contact.contactType}
                        testId={`badge-contact-type-${contact.id}`}
                      />
                      {contact.status === "active" && contact.onboardingStatus?.pending && (
                        <Badge
                          className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                          data-testid={`badge-onboarding-pending-${contact.id}`}
                        >
                          Onboarding Pending
                        </Badge>
                      )}
                      {contact.onboardingStatus?.completed && (
                        <Badge
                          className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          data-testid={`badge-onboarding-complete-${contact.id}`}
                        >
                          Onboarded
                        </Badge>
                      )}
                      {contact.isStopOnlyContact && (
                        <Badge
                          variant="outline"
                          className="text-xs border-amber-300 text-amber-700 dark:border-amber-600 dark:text-amber-400"
                          data-testid={`badge-stop-only-${contact.id}`}
                        >
                          Stop Only
                        </Badge>
                      )}
                      {contact.leadSource && contact.leadSource !== "website_widget" && (
                        <Badge
                          variant="outline"
                          className="text-xs border-purple-300 text-purple-700 dark:border-purple-600 dark:text-purple-400"
                          data-testid={`badge-lead-source-${contact.id}`}
                        >
                          {contact.leadSource
                            .replace(/_/g, " ")
                            .replace(/\b\w/g, (c) => c.toUpperCase())}
                        </Badge>
                      )}
                      {contact.leadSource === "website_widget" && (
                        <Badge
                          variant="outline"
                          className="text-xs border-teal-300 text-teal-700 dark:border-teal-600 dark:text-teal-400"
                          data-testid={`badge-lead-source-${contact.id}`}
                        >
                          Website
                        </Badge>
                      )}
                      <Badge
                        variant="secondary"
                        className={statusColors[contact.status] || ""}
                        data-testid={`badge-status-${contact.id}`}
                      >
                        {contact.status}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent
            className="p-6 text-center text-muted-foreground"
            data-testid="text-no-contacts"
          >
            No contacts found. Add your first contact to get started.
          </CardContent>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2" data-testid="contacts-pagination">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalContacts)} of{" "}
            {totalContacts}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              data-testid="button-contacts-prev"
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              data-testid="button-contacts-next"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          data-testid="bulk-action-bar"
        >
          <Card className="shadow-lg">
            <CardContent className="flex flex-wrap items-center gap-2 p-3">
              <span className="text-sm font-medium mr-1" data-testid="text-bulk-selected-count">
                {selectedIds.size} selected
              </span>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={bulkUpdateMutation.isPending}
                    data-testid="button-bulk-change-status"
                  >
                    <RefreshCw className="mr-1 h-4 w-4" />
                    Change Status
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent data-testid="dropdown-bulk-status">
                  {["lead", "estimate", "active", "paused", "cancelled"].map((s) => (
                    <DropdownMenuItem
                      key={s}
                      onClick={() =>
                        bulkUpdateMutation.mutate({ ids: Array.from(selectedIds), status: s })
                      }
                      data-testid={`menu-item-status-${s}`}
                    >
                      <Badge variant="secondary" className={`${statusColors[s]} mr-2`}>
                        {s}
                      </Badge>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={bulkUpdateMutation.isPending}
                    data-testid="button-bulk-add-tag"
                  >
                    <Tags className="mr-1 h-4 w-4" />
                    Add Tag
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent data-testid="dropdown-bulk-tags">
                  {tagsList.length === 0 ? (
                    <DropdownMenuItem disabled>No tags available</DropdownMenuItem>
                  ) : (
                    tagsList.map((tag) => (
                      <DropdownMenuItem
                        key={tag.id}
                        onClick={() =>
                          bulkUpdateMutation.mutate({ ids: Array.from(selectedIds), tagId: tag.id })
                        }
                        data-testid={`menu-item-tag-${tag.id}`}
                      >
                        <span
                          className="inline-block w-3 h-3 rounded-full mr-2 flex-shrink-0"
                          style={{ backgroundColor: tag.color || "#3b82f6" }}
                        />
                        {tag.name}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkServicePlanOpen(true)}
                data-testid="button-bulk-create-service-plans"
              >
                <CalendarClock className="mr-1 h-4 w-4" />
                Create Service Plans
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkEditOpen(true)}
                data-testid="button-bulk-edit-service-plans"
              >
                <SlidersHorizontal className="mr-1 h-4 w-4" />
                Update Service Plans
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => sendPortalLinkMutation.mutate(Array.from(selectedIds))}
                disabled={sendPortalLinkMutation.isPending}
                data-testid="button-bulk-send-portal"
              >
                <Send className="mr-1 h-4 w-4" />
                Send Portal Link
              </Button>

              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={bulkDeleteMutation.isPending}
                data-testid="button-bulk-delete"
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Delete Selected
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
                data-testid="button-bulk-clear-selection"
              >
                Clear
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle data-testid="text-delete-confirm-title">
              Delete {selectedIds.size} Contact(s)?
            </DialogTitle>
            <DialogDescription data-testid="text-delete-confirm-description">
              This action cannot be undone. All selected contacts and their associated data will be
              permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              data-testid="button-cancel-bulk-delete"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
              disabled={bulkDeleteMutation.isPending}
              data-testid="button-confirm-bulk-delete"
            >
              {bulkDeleteMutation.isPending
                ? "Deleting..."
                : `Delete ${selectedIds.size} Contact(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkEditOpen}
        onOpenChange={(open) => {
          setBulkEditOpen(open);
          if (!open) {
            setBulkEditDayOfWeek("");
            setBulkEditFrequency("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle data-testid="text-bulk-edit-title">Update Service Plans</DialogTitle>
            <DialogDescription>
              Update active service plans for {selectedIds.size} selected customer
              {selectedIds.size !== 1 ? "s" : ""}. Leave a field blank to keep it unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Service Day</label>
              <Select
                value={bulkEditDayOfWeek || "__none__"}
                onValueChange={(v) => setBulkEditDayOfWeek(v === "__none__" ? "" : v)}
              >
                <SelectTrigger data-testid="select-bulk-day-of-week">
                  <SelectValue placeholder="Don't change" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Don't change</SelectItem>
                  <SelectItem value="monday">Monday</SelectItem>
                  <SelectItem value="tuesday">Tuesday</SelectItem>
                  <SelectItem value="wednesday">Wednesday</SelectItem>
                  <SelectItem value="thursday">Thursday</SelectItem>
                  <SelectItem value="friday">Friday</SelectItem>
                  <SelectItem value="saturday">Saturday</SelectItem>
                  <SelectItem value="sunday">Sunday</SelectItem>
                </SelectContent>
              </Select>
              {bulkEditDayOfWeek && (
                <p className="text-xs text-muted-foreground">
                  Plans will be auto-assigned to the matching route for this day if one exists.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Service Frequency</label>
              <Select
                value={bulkEditFrequency || "__none__"}
                onValueChange={(v) => setBulkEditFrequency(v === "__none__" ? "" : v)}
              >
                <SelectTrigger data-testid="select-bulk-frequency">
                  <SelectValue placeholder="Don't change" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Don't change</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Bi-Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="onetime">One-Time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setBulkEditOpen(false)}
              data-testid="button-bulk-edit-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleBulkEditApply}
              disabled={
                bulkUpdateServicePlansMutation.isPending ||
                (!bulkEditDayOfWeek && !bulkEditFrequency)
              }
              data-testid="button-bulk-edit-apply"
            >
              {bulkUpdateServicePlansMutation.isPending ? "Updating..." : "Apply to All Selected"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importStep !== "idle"}
        onOpenChange={(open) => {
          if (!open) {
            setImportStep("idle");
            setImportRows([]);
            setRawCsvRows([]);
            setRawCsvHeaders([]);
            setColumnMapping([]);
            setNewLeadSources([]);
          }
        }}
      >
        <DialogContent className="max-w-[95vw] w-[900px] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle data-testid="text-import-title">
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
                {columnMapping.map((col, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-2 rounded-md bg-muted/30">
                    <div className="w-[200px] text-sm font-medium truncate" title={col.csvHeader}>
                      {col.csvHeader}
                    </div>
                    <span className="text-muted-foreground text-sm">-&gt;</span>
                    <Select
                      value={col.mappedField || "__skip__"}
                      onValueChange={(v) => {
                        const updated = [...columnMapping];
                        updated[idx] = { ...updated[idx], mappedField: v === "__skip__" ? "" : v };
                        setColumnMapping(updated);
                      }}
                    >
                      <SelectTrigger className="w-[200px]" data-testid={`select-mapping-${idx}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">-- Skip this column --</SelectItem>
                        {CONTACT_FIELDS.map((f) => (
                          <SelectItem key={f.key} value={f.key}>
                            {f.key === "zipCode"
                              ? zipLabel
                              : f.key === "state"
                                ? stateLabel
                                : f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {col.mappedField ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                  </div>
                ))}
              </div>

              {newLeadSources.length > 0 && (
                <div className="border rounded-md p-3 space-y-1 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    New Lead Sources
                  </p>
                  <p className="text-xs text-muted-foreground">
                    These will be added to your lead sources list:
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {newLeadSources.map((s) => (
                      <Badge
                        key={s}
                        variant="outline"
                        className="text-amber-700 dark:text-amber-400 border-amber-300"
                      >
                        {s}
                      </Badge>
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
                    {CONTACT_FIELDS.filter((f) => importRows.some((r) => r[f.key])).map((f) => (
                      <th key={f.key} className="p-2 text-left font-medium whitespace-nowrap">
                        {f.label}
                      </th>
                    ))}
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {importRows.map((row, rowIdx) => {
                    const hasName = row.firstName && row.lastName;
                    const visibleFields = CONTACT_FIELDS.filter((f) =>
                      importRows.some((r) => r[f.key])
                    );
                    return (
                      <tr
                        key={rowIdx}
                        className={`border-t ${!hasName ? "bg-destructive/5" : ""}`}
                        data-testid={`import-row-${rowIdx}`}
                      >
                        <td className="p-2 text-muted-foreground">{rowIdx + 1}</td>
                        {visibleFields.map((f) => (
                          <td key={f.key} className="p-1">
                            <Input
                              value={row[f.key] || ""}
                              onChange={(e) => {
                                const updated = [...importRows];
                                updated[rowIdx] = { ...updated[rowIdx], [f.key]: e.target.value };
                                setImportRows(updated);
                              }}
                              className={`h-8 text-xs ${(f.key === "firstName" || f.key === "lastName") && !row[f.key] ? "border-destructive" : ""}`}
                              data-testid={`input-import-${f.key}-${rowIdx}`}
                            />
                          </td>
                        ))}
                        <td className="p-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            onClick={() => setImportRows(importRows.filter((_, i) => i !== rowIdx))}
                            data-testid={`button-remove-row-${rowIdx}`}
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

          {importStep === "review" &&
            (() => {
              const missingNames = importRows.filter((r) => !r.firstName || !r.lastName);
              return missingNames.length > 0 ? (
                <div className="border rounded-md p-3 space-y-1 border-destructive/50 bg-destructive/5 flex-shrink-0">
                  <p className="text-sm font-medium text-destructive">
                    {missingNames.length} row{missingNames.length !== 1 ? "s" : ""} missing required
                    fields
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Rows without a first and last name will be skipped. Edit them above or remove
                    them.
                  </p>
                </div>
              ) : null;
            })()}

          <DialogFooter className="gap-2 flex-shrink-0">
            <Button
              variant="outline"
              onClick={() => {
                setImportStep("idle");
                setImportRows([]);
                setRawCsvRows([]);
                setRawCsvHeaders([]);
                setColumnMapping([]);
                setNewLeadSources([]);
              }}
              data-testid="button-cancel-import"
            >
              Cancel
            </Button>
            {importStep === "mapping" && (
              <Button
                onClick={() => {
                  const remapped = rawCsvRows.map((values) => {
                    const row: ImportRow = {};
                    columnMapping.forEach((col, idx) => {
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
                <Button
                  variant="outline"
                  onClick={() => setImportStep("mapping")}
                  data-testid="button-back-to-mapping"
                >
                  Back
                </Button>
                <Button
                  disabled={
                    isImporting || importRows.filter((r) => r.firstName && r.lastName).length === 0
                  }
                  onClick={async () => {
                    setIsImporting(true);
                    try {
                      const validRows = importRows.filter((r) => r.firstName && r.lastName);
                      const res = await apiRequest("POST", "/api/contacts/import/json", {
                        rows: validRows,
                      });
                      const result = await res.json();
                      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
                      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
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
                      setRawCsvHeaders([]);
                      setColumnMapping([]);
                      setNewLeadSources([]);
                    } catch (err: any) {
                      toast({
                        title: "Import failed",
                        description: err.message,
                        variant: "destructive",
                      });
                    } finally {
                      setIsImporting(false);
                    }
                  }}
                  data-testid="button-confirm-import"
                >
                  {isImporting
                    ? "Importing..."
                    : `Import ${importRows.filter((r) => r.firstName && r.lastName).length} Contacts`}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkServicePlanSetup
        open={bulkServicePlanOpen}
        onOpenChange={setBulkServicePlanOpen}
        preselectedContactIds={Array.from(selectedIds)}
        title="Create Service Plans for Selected Contacts"
      />
    </div>
  );
}
