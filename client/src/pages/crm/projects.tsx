import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, FolderKanban, Trash2, ChevronLeft, CheckCircle2, Circle } from "lucide-react";
import type { CrmProject, CrmProjectTask } from "@shared/crm-schema";

interface PaginatedResult<T> { data: T[]; total: number; page: number; totalPages: number; }

const projectStatuses = ["active", "on_hold", "completed", "cancelled"];

function Pagination({ page, totalPages, total, onPageChange }: { page: number; totalPages: number; total: number; onPageChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
      <span>{total} total</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} data-testid="button-crm-projects-prev">Prev</Button>
        <span>{page} / {totalPages}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} data-testid="button-crm-projects-next">Next</Button>
      </div>
    </div>
  );
}

function ProjectDetail({ project, onBack, onDelete }: { project: CrmProject; onBack: () => void; onDelete: () => void }) {
  const [taskOpen, setTaskOpen] = useState(false);
  const { toast } = useToast();

  const { data: tasks = [] } = useQuery<CrmProjectTask[]>({
    queryKey: ["/api/crm/projects", project.id, "tasks"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/projects/${project.id}/tasks`, { credentials: "include" });
      return res.json();
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", `/api/crm/projects/${project.id}/tasks`, data);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/projects", project.id, "tasks"] }); setTaskOpen(false); toast({ title: "Task added" }); },
  });

  const toggleTaskMutation = useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      const res = await apiRequest("PATCH", `/api/crm/project-tasks/${id}`, { status: done ? "completed" : "pending" });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/projects", project.id, "tasks"] }),
  });

  const completedCount = tasks.filter((t) => t.status === "completed").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} data-testid="button-crm-back-projects">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div>
          <h2 className="text-xl font-bold" data-testid="text-crm-project-name">{project.name}</h2>
          <p className="text-sm text-muted-foreground">{completedCount}/{tasks.length} tasks completed</p>
        </div>
        <Badge variant={project.status === "completed" ? "default" : project.status === "cancelled" ? "destructive" : "outline"} className="ml-2">
          {project.status}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2" data-testid="button-crm-add-project-task">
                <Plus className="w-4 h-4" /> Add Task
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Project Task</DialogTitle></DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); createTaskMutation.mutate({ title: fd.get("title"), description: fd.get("description") }); }} className="space-y-4">
                <div className="space-y-1.5"><Label>Title</Label><Input name="title" required data-testid="input-crm-project-task-title" /></div>
                <div className="space-y-1.5"><Label>Description</Label><Textarea name="description" rows={3} data-testid="input-crm-project-task-desc" /></div>
                <Button type="submit" className="w-full" disabled={createTaskMutation.isPending} data-testid="button-crm-submit-project-task">Add Task</Button>
              </form>
            </DialogContent>
          </Dialog>
          <Button variant="destructive" size="sm" onClick={onDelete} data-testid="button-crm-delete-project">Delete Project</Button>
        </div>
      </div>

      {project.description && <p className="text-sm text-muted-foreground">{project.description}</p>}

      {tasks.length > 0 && (
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0}%` }} />
        </div>
      )}

      <div className="space-y-1.5">
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No tasks yet. Add the first task to get started.</p>
        ) : tasks.map((t) => (
          <div key={t.id} className={`flex items-center gap-3 p-3 rounded border border-border/50 ${t.status === "completed" ? "opacity-60" : ""}`} data-testid={`item-crm-project-task-${t.id}`}>
            <button onClick={() => toggleTaskMutation.mutate({ id: t.id, done: t.status !== "completed" })} data-testid={`button-crm-toggle-project-task-${t.id}`}>
              {t.status === "completed" ? <CheckCircle2 className="w-5 h-5 text-primary" /> : <Circle className="w-5 h-5 text-muted-foreground" />}
            </button>
            <div className="flex-1">
              <p className={`text-sm ${t.status === "completed" ? "line-through text-muted-foreground" : ""}`}>{t.title}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CrmProjects() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState<CrmProject | null>(null);
  const [page, setPage] = useState(1);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    p.set("page", String(page));
    return p.toString();
  }, [search, page]);

  const { data: result, isLoading } = useQuery<PaginatedResult<CrmProject>>({
    queryKey: ["/api/crm/projects", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/crm/projects?${queryParams}`, { credentials: "include" });
      return res.json();
    },
  });
  const projects = result?.data ?? [];

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/crm/projects", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] }); queryClient.invalidateQueries({ queryKey: ["/api/crm/stats"] }); setOpen(false); toast({ title: "Project created" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/projects/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] }); queryClient.invalidateQueries({ queryKey: ["/api/crm/stats"] }); setSelectedProject(null); toast({ title: "Project deleted" }); },
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      name: fd.get("name") as string,
      description: fd.get("description") as string || undefined,
      status: fd.get("status") as string || "active",
    });
  }

  if (selectedProject) {
    return (
      <div className="p-6">
        <ProjectDetail
          project={selectedProject}
          onBack={() => setSelectedProject(null)}
          onDelete={() => deleteMutation.mutate(selectedProject.id)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-crm-projects-title">CRM Projects</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage client projects and their tasks.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" data-testid="button-crm-add-project">
              <Plus className="w-4 h-4" /> New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5"><Label>Name</Label><Input name="name" required data-testid="input-crm-project-name" /></div>
              <div className="space-y-1.5"><Label>Description</Label><Textarea name="description" rows={3} data-testid="input-crm-project-description" /></div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select name="status" defaultValue="active">
                  <SelectTrigger data-testid="select-crm-project-status"><SelectValue /></SelectTrigger>
                  <SelectContent>{projectStatuses.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-crm-submit-project">
                {createMutation.isPending ? "Creating..." : "Create Project"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-3 border-b border-border/50 pb-4">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input type="search" placeholder="Search projects..." className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} data-testid="input-crm-search-projects" />
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12">
          <FolderKanban className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground">No projects yet.</p>
        </div>
      ) : (
        <>
          <div className="rounded-md border border-border/50 bg-card/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((proj) => (
                  <TableRow key={proj.id} data-testid={`row-crm-project-${proj.id}`} className="cursor-pointer" onClick={() => setSelectedProject(proj)}>
                    <TableCell className="font-medium">{proj.name}</TableCell>
                    <TableCell><Badge variant={proj.status === "completed" ? "default" : proj.status === "cancelled" ? "destructive" : "outline"} className="text-[10px]">{proj.status}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">{proj.description || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{proj.createdAt ? new Date(proj.createdAt).toLocaleDateString() : ""}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-destructive" onClick={() => deleteMutation.mutate(proj.id)} data-testid={`button-crm-delete-project-${proj.id}`}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {result && <Pagination page={result.page} totalPages={result.totalPages} total={result.total} onPageChange={setPage} />}
        </>
      )}
    </div>
  );
}
