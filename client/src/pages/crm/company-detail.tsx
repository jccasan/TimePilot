import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronLeft,
  Plus,
  FileText,
  TrendingUp,
  Users,
  Activity,
  Pencil,
  X,
  Check,
  Globe,
  Building2,
} from "lucide-react";
import type { CrmCompany, CrmContact, CrmDeal, CrmNote, CrmAuditLog } from "@shared/crm-schema";

const industries = [
  "technology",
  "healthcare",
  "finance",
  "education",
  "retail",
  "manufacturing",
  "real_estate",
  "other",
];
const companySizes = ["1-10", "11-50", "51-200", "201-1000", "1000+"];
const statusOptions = ["active", "inactive", "prospect", "customer", "churned"];

function EditCompanyDialog({ company, onClose }: { company: CrmCompany; onClose: () => void }) {
  const { toast } = useToast();
  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/crm/companies/${company.id}`, data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", company.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      toast({ title: "Company updated" });
      onClose();
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      name: fd.get("name") as string,
    };
    const domain = fd.get("domain") as string;
    if (domain) payload.domain = domain;
    const industry = fd.get("industry") as string;
    if (industry) payload.industry = industry;
    const size = fd.get("size") as string;
    if (size) payload.size = size;
    const status = fd.get("status") as string;
    if (status) payload.status = status;
    updateMutation.mutate(payload);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="edit-name">Company Name</Label>
        <Input
          id="edit-name"
          name="name"
          defaultValue={company.name}
          required
          data-testid="input-crm-edit-company-name"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-domain">Website Domain</Label>
        <Input
          id="edit-domain"
          name="domain"
          defaultValue={company.domain ?? ""}
          placeholder="example.com"
          data-testid="input-crm-edit-company-domain"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Industry</Label>
          <Select name="industry" defaultValue={company.industry ?? ""}>
            <SelectTrigger data-testid="select-crm-edit-industry">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {industries.map((i) => (
                <SelectItem key={i} value={i}>
                  {i.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Size</Label>
          <Select name="size" defaultValue={company.size ?? ""}>
            <SelectTrigger data-testid="select-crm-edit-size">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {companySizes.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Status</Label>
        <Select name="status" defaultValue={company.status}>
          <SelectTrigger data-testid="select-crm-edit-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={updateMutation.isPending}
        data-testid="button-crm-save-company"
      >
        {updateMutation.isPending ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}

export default function CrmCompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");

  const { data: company, isLoading } = useQuery<CrmCompany>({
    queryKey: ["/api/crm/companies", id],
    queryFn: async () => {
      const res = await fetch(`/api/crm/companies/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch company");
      return res.json();
    },
  });

  const { data: contacts = [] } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/companies", id, "contacts"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/companies/${id}/contacts`, { credentials: "include" });
      return res.json();
    },
    enabled: !!id,
  });

  const { data: deals = [] } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/companies", id, "deals"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/companies/${id}/deals`, { credentials: "include" });
      return res.json();
    },
    enabled: !!id,
  });

  const { data: notes = [] } = useQuery<CrmNote[]>({
    queryKey: ["/api/crm/companies", id, "notes"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/companies/${id}/notes`, { credentials: "include" });
      return res.json();
    },
    enabled: !!id,
  });

  const { data: activity = [] } = useQuery<CrmAuditLog[]>({
    queryKey: ["/api/crm/companies", id, "activity"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/companies/${id}/activity`, { credentials: "include" });
      return res.json();
    },
    enabled: !!id,
  });

  const noteMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", `/api/crm/companies/${id}/notes`, { content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", id, "notes"] });
      setNoteOpen(false);
      toast({ title: "Note added" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateNoteMutation = useMutation({
    mutationFn: async ({ noteId, content }: { noteId: string; content: string }) => {
      const res = await apiRequest("PATCH", `/api/crm/notes/${noteId}`, { content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", id, "notes"] });
      setEditingNoteId(null);
      setEditingContent("");
      toast({ title: "Note updated" });
    },
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (!company) return <div className="p-6 text-muted-foreground">Company not found.</div>;

  const dealsValue = deals.reduce((sum, d) => sum + (d.value || 0), 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/companies">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            data-testid="button-crm-back-companies"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-3 flex-1">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight" data-testid="text-crm-company-name">
              {company.name}
            </h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
              {company.industry && (
                <span data-testid="text-crm-company-industry">
                  {company.industry.replace("_", " ")}
                </span>
              )}
              {company.industry && company.domain && <span>·</span>}
              {company.domain && (
                <a
                  href={`https://${company.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-primary"
                  data-testid="link-crm-company-domain"
                >
                  <Globe className="h-3 w-3" />
                  {company.domain}
                </a>
              )}
            </div>
          </div>
        </div>
        <Badge variant="outline" className="shrink-0" data-testid="badge-crm-company-status">
          {company.status}
        </Badge>
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 shrink-0"
              data-testid="button-crm-edit-company"
            >
              <Pencil className="w-4 h-4" /> Edit
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Company</DialogTitle>
            </DialogHeader>
            <EditCompanyDialog company={company} onClose={() => setEditOpen(false)} />
          </DialogContent>
        </Dialog>
        <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 shrink-0"
              data-testid="button-crm-company-add-note"
            >
              <Plus className="w-4 h-4" /> Note
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Note</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                noteMutation.mutate(new FormData(e.currentTarget).get("content") as string);
              }}
              className="space-y-4"
            >
              <Textarea
                name="content"
                placeholder="Write a note..."
                rows={4}
                required
                data-testid="input-crm-company-note-body"
              />
              <Button
                type="submit"
                className="w-full"
                disabled={noteMutation.isPending}
                data-testid="button-crm-company-submit-note"
              >
                Save Note
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Company Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {company.size && (
              <div>
                <span className="text-muted-foreground">Size: </span>
                <span data-testid="text-crm-company-size">{company.size} employees</span>
              </div>
            )}
            {company.industry && (
              <div>
                <span className="text-muted-foreground">Industry: </span>
                <span>{company.industry.replace("_", " ")}</span>
              </div>
            )}
            {company.domain && (
              <div>
                <span className="text-muted-foreground">Website: </span>
                <a
                  href={`https://${company.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {company.domain}
                </a>
              </div>
            )}
            <div className="pt-2 border-t border-border/50 grid grid-cols-3 gap-3 text-center">
              <div>
                <p
                  className="text-lg font-bold text-primary"
                  data-testid="stat-crm-company-contacts"
                >
                  {contacts.length}
                </p>
                <p className="text-xs text-muted-foreground">Contacts</p>
              </div>
              <div>
                <p className="text-lg font-bold text-primary" data-testid="stat-crm-company-deals">
                  {deals.length}
                </p>
                <p className="text-xs text-muted-foreground">Deals</p>
              </div>
              <div>
                <p className="text-lg font-bold text-primary" data-testid="stat-crm-company-value">
                  ${(dealsValue / 100).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Value</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="pt-4">
            <Tabs defaultValue="contacts">
              <TabsList data-testid="tabs-crm-company-detail">
                <TabsTrigger value="contacts" data-testid="tab-crm-company-contacts">
                  <Users className="w-4 h-4 mr-1" />
                  Contacts ({contacts.length})
                </TabsTrigger>
                <TabsTrigger value="deals" data-testid="tab-crm-company-deals">
                  <TrendingUp className="w-4 h-4 mr-1" />
                  Deals ({deals.length})
                </TabsTrigger>
                <TabsTrigger value="notes" data-testid="tab-crm-company-notes">
                  <FileText className="w-4 h-4 mr-1" />
                  Notes ({notes.length})
                </TabsTrigger>
                <TabsTrigger value="activity" data-testid="tab-crm-company-activity">
                  <Activity className="w-4 h-4 mr-1" />
                  Activity ({activity.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="contacts" className="space-y-2 mt-4">
                {contacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No contacts matched to this company. Contacts are matched by company name.
                  </p>
                ) : (
                  contacts.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between p-3 rounded border border-border/50"
                      data-testid={`item-crm-company-contact-${c.id}`}
                    >
                      <div>
                        <Link
                          href={`/crm/contacts/${c.id}`}
                          className="font-medium text-sm hover:text-primary hover:underline"
                          data-testid={`link-crm-company-contact-${c.id}`}
                        >
                          {c.firstName} {c.lastName}
                        </Link>
                        <p className="text-xs text-muted-foreground">{c.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {c.title && (
                          <span className="text-xs text-muted-foreground">{c.title}</span>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          {c.status}
                        </Badge>
                      </div>
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="deals" className="space-y-2 mt-4">
                {deals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No deals linked to this company.</p>
                ) : (
                  deals.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between p-3 rounded border border-border/50"
                      data-testid={`item-crm-company-deal-${d.id}`}
                    >
                      <div>
                        <Link
                          href={`/crm/deals/${d.id}`}
                          className="font-medium text-sm hover:text-primary hover:underline"
                          data-testid={`link-crm-company-deal-${d.id}`}
                        >
                          {d.title}
                        </Link>
                        <p className="text-xs text-muted-foreground">{d.stage.replace("_", " ")}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            d.stage === "closed_won"
                              ? "default"
                              : d.stage === "closed_lost"
                                ? "destructive"
                                : "outline"
                          }
                          className="text-[10px]"
                        >
                          {d.stage.replace("_", " ")}
                        </Badge>
                        <span className="text-sm font-medium">
                          ${((d.value || 0) / 100).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="notes" className="space-y-2 mt-4">
                {notes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
                ) : (
                  notes.map((n) => (
                    <div
                      key={n.id}
                      className="p-3 rounded border border-border/50"
                      data-testid={`item-crm-company-note-${n.id}`}
                    >
                      {editingNoteId === n.id ? (
                        <div className="space-y-2">
                          <Textarea
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            rows={3}
                            className="text-sm"
                            autoFocus
                            data-testid={`input-crm-edit-company-note-${n.id}`}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() =>
                                updateNoteMutation.mutate({
                                  noteId: n.id,
                                  content: editingContent,
                                })
                              }
                              disabled={updateNoteMutation.isPending}
                              data-testid={`button-crm-save-company-note-${n.id}`}
                            >
                              <Check className="w-3 h-3" /> Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1"
                              onClick={() => {
                                setEditingNoteId(null);
                                setEditingContent("");
                              }}
                              data-testid={`button-crm-cancel-company-note-${n.id}`}
                            >
                              <X className="w-3 h-3" /> Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2 group">
                          <div className="flex-1">
                            <p className="text-sm">{n.content}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {n.createdAt ? new Date(n.createdAt).toLocaleDateString() : ""}
                            </p>
                          </div>
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              setEditingNoteId(n.id);
                              setEditingContent(n.content ?? "");
                            }}
                            data-testid={`button-crm-edit-company-note-${n.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="activity" className="space-y-2 mt-4">
                {activity.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
                ) : (
                  <div className="relative pl-4">
                    <div className="absolute left-1.5 top-0 bottom-0 w-px bg-border/50" />
                    {activity.map((log) => (
                      <div
                        key={log.id}
                        className="relative mb-4 pl-4"
                        data-testid={`item-crm-company-activity-${log.id}`}
                      >
                        <div className="absolute -left-[3px] top-1.5 h-2 w-2 rounded-full bg-primary/60" />
                        <p className="text-sm font-medium capitalize">{log.action}</p>
                        {!!log.details && Object.keys(log.details as object).length > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {JSON.stringify(log.details)}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {log.createdAt ? new Date(log.createdAt).toLocaleString() : ""}
                          {log.userId ? ` · ${log.userId}` : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
