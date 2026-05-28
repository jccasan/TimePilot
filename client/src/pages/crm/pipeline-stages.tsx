import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ChevronLeft, Plus, Pencil, Trash2, GripVertical, Check, X } from "lucide-react";
import { Link } from "wouter";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface PipelineStage {
  id: string;
  name: string;
  slug: string;
  color: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  dealCount: number;
}

export default function CrmPipelineStages() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<PipelineStage>>({});

  const { data: stages = [], isLoading } = useQuery<PipelineStage[]>({
    queryKey: ["/api/crm/pipeline-stages"],
    queryFn: async () => {
      const res = await fetch("/api/crm/pipeline-stages", { credentials: "include" });
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/crm/pipeline-stages", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/pipeline-stages"] });
      setAddOpen(false);
      toast({ title: "Stage added" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/crm/pipeline-stages/${id}`, data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/pipeline-stages"] });
      setEditingId(null);
      toast({ title: "Stage updated" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/crm/pipeline-stages/${id}`);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/pipeline-stages"] });
      toast({ title: "Stage deleted" });
    },
    onError: (err: Error) =>
      toast({ title: "Cannot delete stage", description: err.message, variant: "destructive" }),
  });

  const reorderMutation = useMutation({
    mutationFn: async (order: string[]) => {
      const res = await apiRequest("POST", "/api/crm/pipeline-stages/reorder", { order });
      if (!res.ok) throw new Error("Reorder failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/pipeline-stages"] }),
  });

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      name: fd.get("name") as string,
      color: fd.get("color") as string,
      isWon: fd.get("isWon") === "on",
      isLost: fd.get("isLost") === "on",
    });
  }

  function handleMoveUp(idx: number) {
    if (idx === 0) return;
    const newOrder = [...stages];
    [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
    reorderMutation.mutate(newOrder.map((s) => s.id));
  }

  function handleMoveDown(idx: number) {
    if (idx === stages.length - 1) return;
    const newOrder = [...stages];
    [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
    reorderMutation.mutate(newOrder.map((s) => s.id));
  }

  return (
    <div className="space-y-6 p-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/crm/pipeline">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            data-testid="button-crm-back-pipeline"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold" data-testid="text-crm-pipeline-stages-title">
            Pipeline Stages
          </h1>
          <p className="text-sm text-muted-foreground">Configure the stages deals move through.</p>
        </div>
        <div className="ml-auto">
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2" data-testid="button-crm-add-stage">
                <Plus className="w-4 h-4" /> Add Stage
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Pipeline Stage</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAdd} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Stage Name</Label>
                  <Input
                    name="name"
                    required
                    placeholder="e.g. Discovery"
                    data-testid="input-crm-stage-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Color</Label>
                  <input
                    name="color"
                    type="color"
                    defaultValue="#6b7280"
                    className="h-10 w-full rounded-md border border-input px-2"
                    data-testid="input-crm-stage-color"
                  />
                </div>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      name="isWon"
                      type="checkbox"
                      className="rounded"
                      data-testid="checkbox-crm-stage-won"
                    />
                    Mark as Won
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      name="isLost"
                      type="checkbox"
                      className="rounded"
                      data-testid="checkbox-crm-stage-lost"
                    />
                    Mark as Lost
                  </label>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={createMutation.isPending}
                  data-testid="button-crm-submit-stage"
                >
                  {createMutation.isPending ? "Adding..." : "Add Stage"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading...</div>
      ) : (
        <div className="space-y-2">
          {stages.map((stage, idx) => (
            <div
              key={stage.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/50"
              data-testid={`row-crm-stage-${stage.id}`}
            >
              <div className="flex flex-col gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  disabled={idx === 0 || reorderMutation.isPending}
                  onClick={() => handleMoveUp(idx)}
                  data-testid={`button-crm-stage-up-${stage.id}`}
                >
                  <span className="text-xs leading-none">▲</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  disabled={idx === stages.length - 1 || reorderMutation.isPending}
                  onClick={() => handleMoveDown(idx)}
                  data-testid={`button-crm-stage-down-${stage.id}`}
                >
                  <span className="text-xs leading-none">▼</span>
                </Button>
              </div>

              <GripVertical className="w-4 h-4 text-muted-foreground/40" />

              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: stage.color }}
              />

              {editingId === stage.id ? (
                <div className="flex-1 flex items-center gap-2">
                  <Input
                    value={editForm.name ?? stage.name}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    className="h-7 text-sm flex-1"
                    data-testid={`input-crm-stage-edit-name-${stage.id}`}
                  />
                  <input
                    type="color"
                    value={editForm.color ?? stage.color}
                    onChange={(e) => setEditForm((f) => ({ ...f, color: e.target.value }))}
                    className="h-7 w-10 rounded border border-input"
                    data-testid={`input-crm-stage-edit-color-${stage.id}`}
                  />
                  <label className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editForm.isWon ?? stage.isWon}
                      onChange={(e) => setEditForm((f) => ({ ...f, isWon: e.target.checked }))}
                      data-testid={`checkbox-crm-stage-edit-won-${stage.id}`}
                    />
                    Won
                  </label>
                  <label className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editForm.isLost ?? stage.isLost}
                      onChange={(e) => setEditForm((f) => ({ ...f, isLost: e.target.checked }))}
                      data-testid={`checkbox-crm-stage-edit-lost-${stage.id}`}
                    />
                    Lost
                  </label>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={updateMutation.isPending}
                    onClick={() =>
                      updateMutation.mutate({
                        id: stage.id,
                        name: editForm.name ?? stage.name,
                        color: editForm.color ?? stage.color,
                        isWon: editForm.isWon ?? stage.isWon,
                        isLost: editForm.isLost ?? stage.isLost,
                      })
                    }
                    data-testid={`button-crm-stage-save-${stage.id}`}
                  >
                    <Check className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setEditingId(null)}
                    data-testid={`button-crm-stage-cancel-${stage.id}`}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-sm font-medium">{stage.name}</span>
                  <span className="text-xs text-muted-foreground font-mono">{stage.slug}</span>
                  {stage.isWon && (
                    <Badge className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 border-0">
                      Won
                    </Badge>
                  )}
                  {stage.isLost && (
                    <Badge className="text-[10px] bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 border-0">
                      Lost
                    </Badge>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setEditingId(stage.id);
                        setEditForm({});
                      }}
                      data-testid={`button-crm-stage-edit-${stage.id}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => deleteMutation.mutate(stage.id)}
                              disabled={deleteMutation.isPending || stage.dealCount > 0}
                              data-testid={`button-crm-stage-delete-${stage.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        {stage.dealCount > 0 && (
                          <TooltipContent>
                            <p>
                              Move or close the {stage.dealCount} deal
                              {stage.dealCount !== 1 ? "s" : ""} in this stage before deleting it.
                            </p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              )}
            </div>
          ))}
          {stages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No stages yet. Add your first stage above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
