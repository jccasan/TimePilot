import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Search, Users, Trash2, Download, Star, Upload, RefreshCw } from "lucide-react";
import type { CrmContact } from "@shared/crm-schema";
import { CrmImportModal } from "@/components/crm-import-modal";

interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

const contactStatuses = ["active", "inactive", "lead", "customer", "archived"];
const contactSources = ["manual", "web_form", "import", "referral", "campaign", "auto-sync"];

function statusBadgeClass(status: string): string {
  switch (status) {
    case "customer":
      return "border-emerald-500 text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-400";
    case "lead":
      return "border-blue-400 text-blue-700 bg-blue-50 dark:bg-blue-950 dark:text-blue-400";
    case "active":
      return "border-green-400 text-green-700 bg-green-50 dark:bg-green-950 dark:text-green-400";
    case "inactive":
    case "archived":
      return "border-muted-foreground/40 text-muted-foreground";
    default:
      return "";
  }
}

function PaginationControls({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
      <span>{total} total</span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          data-testid="button-prev-page"
        >
          Prev
        </Button>
        <span>
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          data-testid="button-next-page"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export default function CrmContacts() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [page, setPage] = useState(1);
  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (sourceFilter !== "all") p.set("source", sourceFilter);
    p.set("page", String(page));
    return p.toString();
  }, [search, statusFilter, sourceFilter, page]);

  const { data: result, isLoading } = useQuery<PaginatedResult<CrmContact>>({
    queryKey: ["/api/crm/contacts", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/crm/contacts?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return res.json();
    },
  });
  const contacts = result?.data ?? [];

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/crm/contacts", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/stats"] });
      setOpen(false);
      toast({ title: "Contact created" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/contacts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/stats"] });
      toast({ title: "Contact deleted" });
    },
  });

  const updateScoreMutation = useMutation({
    mutationFn: async ({ id, leadScore }: { id: string; leadScore: number }) => {
      const res = await apiRequest("PATCH", `/api/crm/contacts/${id}`, { leadScore });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] }),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/crm/contacts/sync-from-customers");
      if (!res.ok) throw new Error((await res.json()).message ?? "Sync failed");
      return res.json() as Promise<{ created: number; skipped: number; total: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/stats"] });
      toast({
        title: `Sync complete`,
        description:
          data.created > 0
            ? `${data.created} new customer${data.created !== 1 ? "s" : ""} added to CRM${data.skipped > 0 ? `, ${data.skipped} already linked` : ""}.`
            : `All ${data.total} customer${data.total !== 1 ? "s" : ""} already in CRM.`,
      });
    },
    onError: (err: Error) =>
      toast({ title: "Sync failed", description: err.message, variant: "destructive" }),
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      firstName: fd.get("firstName") as string,
      lastName: fd.get("lastName") as string,
      email: fd.get("email") as string,
      phone: (fd.get("phone") as string) || undefined,
      title: (fd.get("title") as string) || undefined,
      company: (fd.get("company") as string) || undefined,
      status: (fd.get("status") as string) || "active",
      source: (fd.get("source") as string) || "manual",
    });
  }

  function handleExport() {
    window.location.href = "/api/crm/contacts/export/csv";
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-crm-contacts-title">
            CRM Contacts
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage your CRM contacts and leads.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleExport}
            data-testid="button-crm-export-contacts"
          >
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setImportOpen(true)}
            data-testid="button-crm-import-contacts"
          >
            <Upload className="w-4 h-4" /> Import CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            data-testid="button-crm-sync-customers"
          >
            <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing..." : "Sync Customers"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2" data-testid="button-crm-add-contact">
                <Plus className="w-4 h-4" /> Add Contact
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Contact</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      name="firstName"
                      required
                      data-testid="input-crm-firstName"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      name="lastName"
                      required
                      data-testid="input-crm-lastName"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    data-testid="input-crm-email"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" name="phone" data-testid="input-crm-phone" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="title">Title</Label>
                    <Input id="title" name="title" data-testid="input-crm-title" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="company">Company</Label>
                  <Input id="company" name="company" data-testid="input-crm-company" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="status">Status</Label>
                    <Select name="status" defaultValue="active">
                      <SelectTrigger data-testid="select-crm-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {contactStatuses.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="source">Source</Label>
                    <Select name="source" defaultValue="manual">
                      <SelectTrigger data-testid="select-crm-source">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {contactSources.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={createMutation.isPending}
                  data-testid="button-crm-submit-contact"
                >
                  {createMutation.isPending ? "Creating..." : "Create Contact"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-border/50 pb-4">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search contacts..."
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            data-testid="input-crm-search-contacts"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[150px]" data-testid="select-crm-filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {contactStatuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sourceFilter}
          onValueChange={(v) => {
            setSourceFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[150px]" data-testid="select-crm-filter-source">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {contactSources.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground">No contacts found.</p>
        </div>
      ) : (
        <>
          <div className="rounded-md border border-border/50 bg-card/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((contact) => (
                  <TableRow key={contact.id} data-testid={`row-crm-contact-${contact.id}`}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/crm/contacts/${contact.id}`}
                        className="hover:text-primary hover:underline"
                        data-testid={`link-crm-contact-${contact.id}`}
                      >
                        {contact.firstName} {contact.lastName}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{contact.email}</TableCell>
                    <TableCell>{contact.company || "—"}</TableCell>
                    <TableCell>{contact.title || "—"}</TableCell>
                    <TableCell>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5 h-7 px-2"
                            data-testid={`button-crm-score-${contact.id}`}
                          >
                            <Star
                              className={`w-3.5 h-3.5 ${(contact.leadScore || 0) > 0 ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground"}`}
                            />
                            <span className="font-mono text-xs">{contact.leadScore || 0}</span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-44 p-3" align="start">
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const s = parseInt(
                                new FormData(e.currentTarget).get("score") as string,
                                10
                              );
                              if (!isNaN(s))
                                updateScoreMutation.mutate({ id: contact.id, leadScore: s });
                            }}
                            className="flex gap-2"
                          >
                            <Input
                              name="score"
                              type="number"
                              defaultValue={contact.leadScore || 0}
                              className="h-8 text-xs"
                              data-testid={`input-crm-score-${contact.id}`}
                            />
                            <Button
                              type="submit"
                              size="sm"
                              className="h-8 px-3"
                              data-testid={`button-crm-save-score-${contact.id}`}
                            >
                              Save
                            </Button>
                          </form>
                        </PopoverContent>
                      </Popover>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${statusBadgeClass(contact.status)}`}
                      >
                        {contact.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutate(contact.id)}
                        data-testid={`button-crm-delete-contact-${contact.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {result && (
            <PaginationControls
              page={result.page}
              totalPages={result.totalPages}
              total={result.total}
              onPageChange={setPage}
            />
          )}
        </>
      )}
      <CrmImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        entityLabel="Contact"
        templateUrl="/api/crm/contacts/import/template"
        importUrl="/api/crm/contacts/import"
        invalidateKeys={["/api/crm/contacts", "/api/crm/stats"]}
        knownFields={[
          "first_name",
          "last_name",
          "email",
          "phone",
          "company",
          "title",
          "status",
          "source",
          "lead_score",
          "assigned_to",
          "tags",
        ]}
        requiredFields={["first_name", "last_name", "email"]}
      />
    </div>
  );
}
