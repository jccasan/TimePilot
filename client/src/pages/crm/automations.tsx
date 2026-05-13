import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, Zap, Trash2, Power, PowerOff } from "lucide-react";
import type { CrmAutomation } from "@shared/crm-schema";

interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

const triggerTypes = [
  "contact_created",
  "deal_stage_changed",
  "task_overdue",
  "form_submitted",
  "contact_tag_added",
  "scheduled",
];
const actionTypes = [
  "send_email",
  "create_task",
  "update_contact",
  "add_tag",
  "notify_user",
  "webhook",
];

function Pagination({
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
          data-testid="button-crm-automations-prev"
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
          data-testid="button-crm-automations-next"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export default function CrmAutomations() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    p.set("page", String(page));
    return p.toString();
  }, [search, page]);

  const { data: result, isLoading } = useQuery<PaginatedResult<CrmAutomation>>({
    queryKey: ["/api/crm/automations", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/crm/automations?${queryParams}`, { credentials: "include" });
      return res.json();
    },
  });
  const automations = result?.data ?? [];

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/crm/automations", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/automations"] });
      setOpen(false);
      toast({ title: "Automation created" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/crm/automations/${id}`, { active });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/automations"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/automations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/automations"] });
      toast({ title: "Automation deleted" });
    },
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      name: fd.get("name") as string,
      description: (fd.get("description") as string) || undefined,
      trigger: fd.get("triggerType") as string,
      conditions: {},
      actions: [{ type: fd.get("actionType") as string, config: {} }],
      active: true,
    });
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-bold tracking-tight"
            data-testid="text-crm-automations-title"
          >
            CRM Automations
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Trigger-based workflows for contacts and deals.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" data-testid="button-crm-add-automation">
              <Plus className="w-4 h-4" /> New Automation
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Automation</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input name="name" required data-testid="input-crm-automation-name" />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  name="description"
                  rows={2}
                  data-testid="input-crm-automation-description"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Trigger</Label>
                  <Select name="triggerType" defaultValue="contact_created">
                    <SelectTrigger data-testid="select-crm-automation-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {triggerTypes.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Action</Label>
                  <Select name="actionType" defaultValue="send_email">
                    <SelectTrigger data-testid="select-crm-automation-action">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {actionTypes.map((a) => (
                        <SelectItem key={a} value={a}>
                          {a.replace(/_/g, " ")}
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
                data-testid="button-crm-submit-automation"
              >
                {createMutation.isPending ? "Creating..." : "Create Automation"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-3 border-b border-border/50 pb-4">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search automations..."
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            data-testid="input-crm-search-automations"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : automations.length === 0 ? (
        <div className="text-center py-12">
          <Zap className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground">No automations yet.</p>
        </div>
      ) : (
        <>
          <div className="rounded-md border border-border/50 bg-card/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Runs</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {automations.map((a) => (
                  <TableRow key={a.id} data-testid={`row-crm-automation-${a.id}`}>
                    <TableCell className="font-medium">
                      <div>{a.name}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {(a.trigger || "").replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">—</TableCell>
                    <TableCell>
                      <Badge variant={a.active ? "default" : "outline"} className="text-[10px]">
                        {a.active ? "active" : "inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => toggleMutation.mutate({ id: a.id, active: !a.active })}
                          data-testid={`button-crm-toggle-automation-${a.id}`}
                          title={a.active ? "Deactivate" : "Activate"}
                        >
                          {a.active ? (
                            <PowerOff className="w-3.5 h-3.5 text-muted-foreground" />
                          ) : (
                            <Power className="w-3.5 h-3.5 text-primary" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteMutation.mutate(a.id)}
                          data-testid={`button-crm-delete-automation-${a.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {result && (
            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              total={result.total}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}
