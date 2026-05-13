import { useState } from "react";
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
import { Plus, GitBranch, Trash2, ChevronLeft } from "lucide-react";
import type { CrmSequence, CrmSequenceStep } from "@shared/crm-schema";

const stepTypes = ["email", "sms", "task", "wait", "condition"];

function SequenceDetail({ seq, onBack }: { seq: CrmSequence; onBack: () => void }) {
  const { toast } = useToast();
  const [stepOpen, setStepOpen] = useState(false);

  const { data: steps = [] } = useQuery<CrmSequenceStep[]>({
    queryKey: ["/api/crm/sequences", seq.id, "steps"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/sequences/${seq.id}/steps`, { credentials: "include" });
      return res.json();
    },
  });

  const addStepMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", `/api/crm/sequences/${seq.id}/steps`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences", seq.id, "steps"] });
      setStepOpen(false);
      toast({ title: "Step added" });
    },
  });

  const deleteStepMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/sequence-steps/${id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences", seq.id, "steps"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onBack}
          data-testid="button-crm-back-sequences"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div>
          <h2 className="text-xl font-bold" data-testid="text-crm-sequence-name">
            {seq.name}
          </h2>
          <p className="text-sm text-muted-foreground">{steps.length} steps</p>
        </div>
        <Badge variant={seq.status === "active" ? "default" : "outline"} className="ml-2">
          {seq.status}
        </Badge>
        <div className="ml-auto">
          <Dialog open={stepOpen} onOpenChange={setStepOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2" data-testid="button-crm-add-step">
                <Plus className="w-4 h-4" /> Add Step
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Sequence Step</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  addStepMutation.mutate({
                    stepNumber: steps.length + 1,
                    type: fd.get("type"),
                    emailSubject: fd.get("emailSubject"),
                    emailBody: fd.get("emailBody"),
                    delayDays: parseInt((fd.get("delayDays") as string) || "0"),
                    delayHours: 0,
                  });
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Type</Label>
                    <Select name="type" defaultValue="email">
                      <SelectTrigger data-testid="select-crm-step-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {stepTypes.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Delay (days)</Label>
                    <Input
                      name="delayDays"
                      type="number"
                      min="0"
                      defaultValue="1"
                      data-testid="input-crm-step-delay"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Subject</Label>
                  <Input name="emailSubject" data-testid="input-crm-step-subject" />
                </div>
                <div className="space-y-1.5">
                  <Label>Body</Label>
                  <Textarea name="emailBody" rows={4} data-testid="input-crm-step-body" />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={addStepMutation.isPending}
                  data-testid="button-crm-submit-step"
                >
                  Add Step
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      {seq.description && <p className="text-sm text-muted-foreground">{seq.description}</p>}
      <div className="space-y-2">
        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No steps yet. Add the first step to build your sequence.
          </p>
        ) : (
          steps.map((step, i) => (
            <div
              key={step.id}
              className="flex items-start gap-3"
              data-testid={`item-crm-step-${step.id}`}
            >
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                  {i + 1}
                </div>
                {i < steps.length - 1 && <div className="w-0.5 h-8 bg-border/50 mt-1" />}
              </div>
              <div className="flex-1 p-3 rounded border border-border/50 bg-card/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {step.type}
                    </Badge>
                    {step.delayDays && step.delayDays > 0 && (
                      <span className="text-xs text-muted-foreground">Wait {step.delayDays}d</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteStepMutation.mutate(step.id)}
                    data-testid={`button-crm-delete-step-${step.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {step.emailSubject && (
                  <p className="text-sm font-medium mt-1">{step.emailSubject}</p>
                )}
                {step.emailBody && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {step.emailBody}
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function CrmSequences() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<CrmSequence | null>(null);

  const { data: sequences = [], isLoading } = useQuery<CrmSequence[]>({
    queryKey: ["/api/crm/sequences"],
    queryFn: async () => {
      const res = await fetch("/api/crm/sequences", { credentials: "include" });
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/crm/sequences", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences"] });
      setOpen(false);
      toast({ title: "Sequence created" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crm/sequences/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences"] });
      toast({ title: "Sequence deleted" });
    },
  });

  if (selected) {
    return (
      <div className="p-6">
        <SequenceDetail seq={selected} onBack={() => setSelected(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-crm-sequences-title">
            Email Sequences
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Multi-step email drip sequences for leads.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" data-testid="button-crm-add-sequence">
              <Plus className="w-4 h-4" /> New Sequence
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Sequence</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                createMutation.mutate({
                  name: fd.get("name"),
                  description: fd.get("description") || undefined,
                });
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input name="name" required data-testid="input-crm-sequence-name" />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  name="description"
                  rows={3}
                  data-testid="input-crm-sequence-description"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={createMutation.isPending}
                data-testid="button-crm-submit-sequence"
              >
                Create Sequence
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : sequences.length === 0 ? (
        <div className="text-center py-12">
          <GitBranch className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground">No sequences yet.</p>
        </div>
      ) : (
        <div className="rounded-md border border-border/50 bg-card/50">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Enrolled</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sequences.map((s) => (
                <TableRow
                  key={s.id}
                  data-testid={`row-crm-sequence-${s.id}`}
                  className="cursor-pointer"
                  onClick={() => setSelected(s)}
                >
                  <TableCell className="font-medium">
                    <div>{s.name}</div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={s.status === "active" ? "default" : "outline"}
                      className="text-[10px]"
                    >
                      {s.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">—</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-7 h-7 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMutation.mutate(s.id)}
                      data-testid={`button-crm-delete-sequence-${s.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
