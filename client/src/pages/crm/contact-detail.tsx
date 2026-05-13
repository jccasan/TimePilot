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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, Plus, Mail, CheckSquare, TrendingUp, FileText, Pencil, X, Check } from "lucide-react";
import type { CrmContact, CrmDeal, CrmTask, CrmNote, CrmEmail } from "@shared/crm-schema";

export default function CrmContactDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [noteOpen, setNoteOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");

  const { data: contact, isLoading } = useQuery<CrmContact>({
    queryKey: ["/api/crm/contacts", id],
    queryFn: async () => {
      const res = await fetch(`/api/crm/contacts/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contact");
      return res.json();
    },
  });

  const { data: deals = [] } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/contacts", id, "deals"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/contacts/${id}/deals`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: tasks = [] } = useQuery<CrmTask[]>({
    queryKey: ["/api/crm/contacts", id, "tasks"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/contacts/${id}/tasks`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: notes = [] } = useQuery<CrmNote[]>({
    queryKey: ["/api/crm/contacts", id, "notes"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/contacts/${id}/notes`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: emails = [] } = useQuery<CrmEmail[]>({
    queryKey: ["/api/crm/contacts", id, "emails"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/contacts/${id}/emails`, { credentials: "include" });
      return res.json();
    },
  });

  const noteMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", "/api/crm/notes", { content, contactId: id });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts", id, "notes"] });
      setNoteOpen(false);
      toast({ title: "Note added" });
    },
  });

  const taskMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/crm/tasks", { ...data, contactId: id });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts", id, "tasks"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts", id, "notes"] });
      setEditingNoteId(null);
      setEditingContent("");
      toast({ title: "Note updated" });
    },
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (!contact) return <div className="p-6 text-muted-foreground">Contact not found.</div>;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/contacts">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            data-testid="button-crm-back-contacts"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold" data-testid="text-crm-contact-name">
            {contact.firstName} {contact.lastName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {contact.email}
            {contact.company ? ` · ${contact.company}` : ""}
          </p>
        </div>
        <Badge variant="outline" className="ml-2">
          {contact.status}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                data-testid="button-crm-add-note"
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
                  data-testid="input-crm-note-body"
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={noteMutation.isPending}
                  data-testid="button-crm-submit-note"
                >
                  Save Note
                </Button>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2" data-testid="button-crm-add-task">
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
                    priority: fd.get("priority") || "medium",
                  });
                }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label>Title</Label>
                  <Input name="title" required data-testid="input-crm-task-title" />
                </div>
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Textarea name="description" rows={3} data-testid="input-crm-task-description" />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={taskMutation.isPending}
                  data-testid="button-crm-submit-task"
                >
                  Create Task
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Contact Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground">Email: </span>
              {contact.email}
            </div>
            {contact.phone && (
              <div>
                <span className="text-muted-foreground">Phone: </span>
                {contact.phone}
              </div>
            )}
            {contact.title && (
              <div>
                <span className="text-muted-foreground">Title: </span>
                {contact.title}
              </div>
            )}
            {contact.company && (
              <div>
                <span className="text-muted-foreground">Company: </span>
                {contact.company}
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Source: </span>
              {contact.source || "manual"}
            </div>
            <div>
              <span className="text-muted-foreground">Lead Score: </span>
              <span className="font-semibold">{contact.leadScore || 0}</span>
            </div>
            {contact.assignedTo && (
              <div>
                <span className="text-muted-foreground">Assigned To: </span>
                {contact.assignedTo}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="pt-4">
            <Tabs defaultValue="deals">
              <TabsList data-testid="tabs-crm-contact-detail">
                <TabsTrigger value="deals" data-testid="tab-crm-deals">
                  <TrendingUp className="w-4 h-4 mr-1" />
                  Deals ({deals.length})
                </TabsTrigger>
                <TabsTrigger value="tasks" data-testid="tab-crm-tasks">
                  <CheckSquare className="w-4 h-4 mr-1" />
                  Tasks ({tasks.length})
                </TabsTrigger>
                <TabsTrigger value="notes" data-testid="tab-crm-notes">
                  <FileText className="w-4 h-4 mr-1" />
                  Notes ({notes.length})
                </TabsTrigger>
                <TabsTrigger value="emails" data-testid="tab-crm-emails">
                  <Mail className="w-4 h-4 mr-1" />
                  Emails ({emails.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="deals" className="space-y-2 mt-4">
                {deals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No deals yet.</p>
                ) : (
                  deals.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between p-3 rounded border border-border/50"
                      data-testid={`item-crm-deal-${d.id}`}
                    >
                      <div>
                        <Link
                          href={`/crm/deals/${d.id}`}
                          className="font-medium text-sm hover:text-primary hover:underline"
                          data-testid={`link-crm-deal-${d.id}`}
                        >
                          {d.title}
                        </Link>
                        <p className="text-xs text-muted-foreground">{d.stage}</p>
                      </div>
                      <span className="text-sm font-medium">
                        ${((d.value || 0) / 100).toLocaleString()}
                      </span>
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
                      data-testid={`item-crm-task-${t.id}`}
                    >
                      <Badge
                        variant={t.status === "completed" ? "default" : "outline"}
                        className="text-[10px]"
                      >
                        {t.status}
                      </Badge>
                      <span className="text-sm">{t.title}</span>
                      <Badge variant="outline" className="ml-auto text-[10px]">
                        {t.priority}
                      </Badge>
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
                      data-testid={`item-crm-note-${n.id}`}
                    >
                      {editingNoteId === n.id ? (
                        <div className="space-y-2">
                          <Textarea
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            rows={3}
                            className="text-sm"
                            autoFocus
                            data-testid={`input-crm-edit-note-${n.id}`}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() =>
                                updateNoteMutation.mutate({ noteId: n.id, content: editingContent })
                              }
                              disabled={updateNoteMutation.isPending}
                              data-testid={`button-crm-save-note-${n.id}`}
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
                              data-testid={`button-crm-cancel-note-${n.id}`}
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
                            data-testid={`button-crm-edit-note-${n.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
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
                      data-testid={`item-crm-email-${em.id}`}
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
