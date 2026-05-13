import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Code, Trash2, X, Eye } from "lucide-react";
import type { CrmWebForm, CrmFormSubmission } from "@shared/crm-schema";

interface FormField { name: string; label: string; type: string; required: boolean; }

export default function CrmForms() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [submissionsFor, setSubmissionsFor] = useState<CrmWebForm | null>(null);
  const [embedFor, setEmbedFor] = useState<CrmWebForm | null>(null);
  const [fields, setFields] = useState<FormField[]>([
    { name: "firstName", label: "First Name", type: "text", required: true },
    { name: "lastName", label: "Last Name", type: "text", required: true },
    { name: "email", label: "Email", type: "email", required: true },
  ]);
  const [copied, setCopied] = useState(false);

  const { data: forms = [], isLoading } = useQuery<CrmWebForm[]>({
    queryKey: ["/api/crm/forms"],
    queryFn: async () => {
      const res = await fetch("/api/crm/forms", { credentials: "include" });
      return res.json();
    },
  });

  const { data: submissions = [] } = useQuery<CrmFormSubmission[]>({
    queryKey: ["/api/crm/forms", submissionsFor?.id, "submissions"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/forms/${submissionsFor?.id}/submissions`, { credentials: "include" });
      return res.json();
    },
    enabled: !!submissionsFor,
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/crm/forms", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/forms"] }); setCreateOpen(false); toast({ title: "Form created" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/crm/forms/${id}`, { active });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/forms"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/forms/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/forms"] }); toast({ title: "Form deleted" }); },
  });

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({ name: fd.get("name") as string, fields, submitAction: fd.get("submitAction") as string || "thank_you" });
  }

  function embedCode(form: CrmWebForm) {
    return `<script src="${window.location.origin}/crm-form.js" data-form-id="${form.id}"></script>`;
  }

  function copyEmbed(form: CrmWebForm) {
    navigator.clipboard.writeText(embedCode(form));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-crm-forms-title">Web Forms</h1>
          <p className="text-muted-foreground mt-1 text-sm">Embeddable lead capture forms.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" data-testid="button-crm-add-form">
              <Plus className="w-4 h-4" /> New Form
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>New Web Form</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-1.5"><Label>Form Name</Label><Input name="name" required data-testid="input-crm-form-name" /></div>
              <div className="space-y-1.5">
                <Label>Submit Action</Label>
                <Select name="submitAction" defaultValue="thank_you">
                  <SelectTrigger data-testid="select-crm-form-action"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="thank_you">Show thank you message</SelectItem>
                    <SelectItem value="redirect">Redirect to URL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-2 block">Fields</Label>
                <div className="space-y-2">
                  {fields.map((f, i) => (
                    <div key={i} className="flex items-center gap-2" data-testid={`row-crm-form-field-${i}`}>
                      <Input placeholder="Field name" value={f.name} onChange={(e) => setFields((prev) => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className="flex-1" data-testid={`input-field-name-${i}`} />
                      <Input placeholder="Label" value={f.label} onChange={(e) => setFields((prev) => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} className="flex-1" data-testid={`input-field-label-${i}`} />
                      <select value={f.type} onChange={(e) => setFields((prev) => prev.map((x, j) => j === i ? { ...x, type: e.target.value } : x))} className="h-9 rounded-md border border-input bg-background px-2 text-sm" data-testid={`select-field-type-${i}`}>
                        <option value="text">Text</option>
                        <option value="email">Email</option>
                        <option value="phone">Phone</option>
                        <option value="textarea">Textarea</option>
                      </select>
                      {fields.length > 1 && <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setFields((prev) => prev.filter((_, j) => j !== i))} data-testid={`button-remove-field-${i}`}><X className="w-4 h-4" /></Button>}
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setFields((prev) => [...prev, { name: "", label: "", type: "text", required: false }])} data-testid="button-add-field">Add Field</Button>
              </div>
              <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-crm-submit-form">Create Form</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : forms.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No forms yet. Create your first lead capture form.</div>
      ) : (
        <div className="rounded-md border border-border/50 bg-card/50">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Fields</TableHead>
                <TableHead>Submissions</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-[120px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.map((form) => (
                <TableRow key={form.id} data-testid={`row-crm-form-${form.id}`}>
                  <TableCell className="font-medium">{form.name}</TableCell>
                  <TableCell className="text-sm">{Array.isArray(form.fields) ? (form.fields as FormField[]).length : 0} fields</TableCell>
                  <TableCell className="text-sm">—</TableCell>
                  <TableCell>
                    <Switch checked={!!form.active} onCheckedChange={(v) => toggleMutation.mutate({ id: form.id, active: v })} data-testid={`switch-crm-form-active-${form.id}`} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSubmissionsFor(form)} data-testid={`button-crm-form-submissions-${form.id}`} title="View submissions"><Eye className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEmbedFor(form)} data-testid={`button-crm-form-embed-${form.id}`} title="Embed code"><Code className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteMutation.mutate(form.id)} data-testid={`button-crm-delete-form-${form.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!embedFor} onOpenChange={(v) => !v && setEmbedFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Embed Code — {embedFor?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Paste this snippet into your website HTML to embed the form.</p>
            <code className="block bg-muted p-3 rounded text-xs font-mono break-all" data-testid="text-crm-embed-code">{embedFor ? embedCode(embedFor) : ""}</code>
            <Button className="w-full" onClick={() => embedFor && copyEmbed(embedFor)} data-testid="button-crm-copy-embed">
              {copied ? "Copied!" : "Copy Code"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!submissionsFor} onOpenChange={(v) => !v && setSubmissionsFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Submissions — {submissionsFor?.name}</DialogTitle></DialogHeader>
          {submissions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No submissions yet.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {submissions.map((s) => (
                <div key={s.id} className="p-3 rounded border border-border/50 text-sm" data-testid={`item-crm-submission-${s.id}`}>
                  <div className="flex justify-between">
                    <span className="font-medium">{(s.data as any)?.firstName} {(s.data as any)?.lastName}</span>
                    <span className="text-xs text-muted-foreground">{s.createdAt ? new Date(s.createdAt).toLocaleDateString() : ""}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{(s.data as any)?.email}</p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
