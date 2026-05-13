import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
import { ChevronLeft, Plus, FileText, Mail, CheckSquare, Pencil, X, Check } from "lucide-react";
import type { CrmDeal, CrmNote, CrmTask, CrmEmail } from "@shared/crm-schema";

const stages = ["lead", "qualified", "proposal", "negotiation", "closed_won", "closed_lost"];

export default function CrmDealDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [noteOpen, setNoteOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");

  const { data: deal, isLoading } = useQuery<CrmDeal>({
    queryKey: ["/api/crm/deals", id],
    queryFn: async () => {
      const res = await fetch(`/api/crm/deals/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch deal");
      return res.json();
    },
  });

  const { data: notes = [] } = useQuery<CrmNote[]>({
    queryKey: ["/api/crm/deals", id, "notes"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/deals/${id}/notes`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: tasks = [] } = useQuery<CrmTask[]>({
    queryKey: ["/api/crm/deals", id, "tasks"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/deals/${id}/tasks`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: emails = [] } = useQuery<CrmEmail[]>({
    queryKey: ["/api/crm/deals", id, "emails"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/deals/${id}/emails`, { credentials: "include" });
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<CrmDeal>) => {
      const res = await apiRequest("PATCH", `/api/crm/deals/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", id] });
      toast({ title: "Deal updated" });
    },
  });

  const noteMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiRequest("POST", "/api/crm/notes", { content: body, dealId: id });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", id, "notes"] });
      setNoteOpen(false);
      toast({ title: "Note added" });
    },
  });

  const taskMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/crm/tasks", { ...data, dealId: id });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", id, "tasks"] });
      setTaskOpen(false);
      toast({ title: "Task created" });
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: async ({ noteId, content }: { noteId: string; content: string }) => {
      const res = await apiRequest("PATCH", `/api/crm/notes/${noteId}`, { content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", id, "notes"] });
      setEditingNoteId(null);
      setEditingContent("");
      toast({ title: "Note updated" });
    },
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (!deal) return <div className="p-6 text-muted-foreground">Deal not found.</div>;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/deals">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            data-testid="button-crm-back-deals"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold" data-testid="text-crm-deal-title">
            {deal.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            ${((deal.value || 0) / 100).toLocaleString()} · {deal.currency}
          </p>
        </div>
        <Badge
          variant={
            deal.stage === "closed_won"
              ? "default"
              : deal.stage === "closed_lost"
                ? "destructive"
                : "outline"
          }
          className="ml-2"
        >
          {deal.stage.replace("_", " ")}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Select value={deal.stage} onValueChange={(s) => updateMutation.mutate({ stage: s })}>
            <SelectTrigger className="w-[160px]" data-testid="select-crm-deal-stage-detail">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stages.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                data-testid="button-crm-deal-add-note"
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
                  noteMutation.mutate(new FormData(e.currentTarget).get("body") as string);
                }}
                className="space-y-4"
              >
                <Textarea name="body" rows={4} required data-testid="input-crm-deal-note-body" />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={noteMutation.isPending}
                  data-testid="button-crm-submit-deal-note"
                >
                  Save
                </Button>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2" data-testid="button-crm-deal-add-task">
                <CheckSquare className="w-4 h-4" /> Task
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Task</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  taskMutation.mutate({
                    title: fd.get("title"),
                    description: fd.get("description"),
                  });
                }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label>Title</Label>
                  <Textarea
                    name="title"
                    rows={1}
                    required
                    data-testid="input-crm-deal-task-title"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={taskMutation.isPending}
                  data-testid="button-crm-submit-deal-task"
                >
                  Create
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Deal Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground">Value: </span>
              <span className="font-semibold">${((deal.value || 0) / 100).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Probability: </span>
              {deal.probability || 0}%
            </div>
            <div>
              <span className="text-muted-foreground">Status: </span>
              {deal.status}
            </div>
            {deal.assignedTo && (
              <div>
                <span className="text-muted-foreground">Assigned To: </span>
                {deal.assignedTo}
              </div>
            )}
            {deal.description && (
              <div className="pt-2 border-t border-border/50 text-muted-foreground">
                {deal.description}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="pt-4">
            <Tabs defaultValue="notes">
              <TabsList>
                <TabsTrigger value="notes" data-testid="tab-crm-deal-notes">
                  <FileText className="w-4 h-4 mr-1" />
                  Notes ({notes.length})
                </TabsTrigger>
                <TabsTrigger value="tasks" data-testid="tab-crm-deal-tasks">
                  <CheckSquare className="w-4 h-4 mr-1" />
                  Tasks ({tasks.length})
                </TabsTrigger>
                <TabsTrigger value="emails" data-testid="tab-crm-deal-emails">
                  <Mail className="w-4 h-4 mr-1" />
                  Emails ({emails.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="notes" className="space-y-2 mt-4">
                {notes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
                ) : (
                  notes.map((n) => (
                    <div
                      key={n.id}
                      className="p-3 rounded border border-border/50"
                      data-testid={`item-crm-deal-note-${n.id}`}
                    >
                      {editingNoteId === n.id ? (
                        <div className="space-y-2">
                          <Textarea
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            rows={3}
                            className="text-sm"
                            autoFocus
                            data-testid={`input-crm-edit-deal-note-${n.id}`}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() =>
                                updateNoteMutation.mutate({ noteId: n.id, content: editingContent })
                              }
                              disabled={updateNoteMutation.isPending}
                              data-testid={`button-crm-save-deal-note-${n.id}`}
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
                              data-testid={`button-crm-cancel-deal-note-${n.id}`}
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
                            data-testid={`button-crm-edit-deal-note-${n.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </TabsContent>
              <TabsContent value="tasks" className="space-y-2 mt-4">
                {tasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tasks yet.</p>
                ) : (
                  tasks.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-3 p-3 rounded border border-border/50"
                      data-testid={`item-crm-deal-task-${t.id}`}
                    >
                      <Badge
                        variant={t.status === "completed" ? "default" : "outline"}
                        className="text-[10px]"
                      >
                        {t.status}
                      </Badge>
                      <span className="text-sm">{t.title}</span>
                    </div>
                  ))
                )}
              </TabsContent>
              <TabsContent value="emails" className="space-y-2 mt-4">
                {emails.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No emails yet.</p>
                ) : (
                  emails.map((em) => (
                    <div
                      key={em.id}
                      className="p-3 rounded border border-border/50"
                      data-testid={`item-crm-deal-email-${em.id}`}
                    >
                      <p className="text-sm font-medium">{em.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        {em.direction} · {em.status}
                      </p>
                    </div>
                  ))
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
