import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle,
  XCircle,
  RotateCcw,
  Download,
  Plus,
  Loader2,
  Clock,
  AlertCircle,
  Edit2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamMember {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

interface Break {
  id: string;
  breakStart: string;
  breakEnd: string | null;
  durationMinutes: number | null;
}

interface TimeEntry {
  id: string;
  userId: string;
  clockIn: string;
  clockOut: string | null;
  durationMinutes: number | null;
  notes: string | null;
  editedBy: string | null;
  breaks: Break[];
}

interface Totals {
  totalRegularMinutes: number;
  totalOvertimeMinutes: number;
  totalBreakMinutes: number;
  dailyBreakdown: Array<{
    date: string;
    regularMinutes: number;
    overtimeMinutes: number;
    breakMinutes: number;
  }>;
}

interface TimecardPeriod {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "submitted" | "approved" | "rejected";
  submittedAt: string | null;
  totalRegularMinutes: number | null;
  totalOvertimeMinutes: number | null;
  entries: TimeEntry[];
  totals: Totals;
}

interface ExportTemplate {
  id: string;
  name: string;
  fields: Array<{ field: string; columnName: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMins(mins: number | null | undefined): string {
  if (mins == null) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function statusBadge(status: TimecardPeriod["status"]) {
  const map: Record<TimecardPeriod["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    draft: { label: "Draft", variant: "outline" },
    submitted: { label: "Submitted", variant: "secondary" },
    approved: { label: "Approved", variant: "default" },
    rejected: { label: "Rejected", variant: "destructive" },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

// ─── Period Detail Modal ───────────────────────────────────────────────────────

function PeriodDetailModal({
  period,
  teamMembers,
  onClose,
  onRefresh,
}: {
  period: TimecardPeriod;
  teamMembers: TeamMember[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [rejectNotes, setRejectNotes] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [editClockIn, setEditClockIn] = useState("");
  const [editClockOut, setEditClockOut] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const owner = teamMembers.find((m) => m.id === period.userId);
  const ownerName = owner ? `${owner.firstName} ${owner.lastName}` : "Unknown";

  const approveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/timecards/${period.id}/approve`, {}),
    onSuccess: () => { onRefresh(); onClose(); toast({ title: "Approved" }); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/timecards/${period.id}/reject`, { notes: rejectNotes }),
    onSuccess: () => { onRefresh(); onClose(); toast({ title: "Returned to tech" }); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const reopenMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/timecards/${period.id}/reopen`, {}),
    onSuccess: () => { onRefresh(); onClose(); toast({ title: "Reopened to draft" }); },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: (entryId: string) =>
      apiRequest("PATCH", `/api/time-entries/${entryId}`, {
        clockIn: editClockIn || undefined,
        clockOut: editClockOut || undefined,
        notes: editNotes || undefined,
      }),
    onSuccess: () => {
      setEditingEntry(null);
      onRefresh();
      toast({ title: "Entry updated" });
    },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  function startEdit(entry: TimeEntry) {
    setEditingEntry(entry.id);
    setEditClockIn(entry.clockIn ? new Date(entry.clockIn).toISOString().slice(0, 16) : "");
    setEditClockOut(
      entry.clockOut ? new Date(entry.clockOut).toISOString().slice(0, 16) : ""
    );
    setEditNotes(entry.notes ?? "");
  }

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          {ownerName} — {fmtDate(period.periodStart)} to {fmtDate(period.periodEnd)}
        </DialogTitle>
        <DialogDescription>
          {statusBadge(period.status)}
        </DialogDescription>
      </DialogHeader>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-3 mt-2">
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold">
              {fmtMins(period.totals.totalRegularMinutes)}
            </div>
            <div className="text-xs text-muted-foreground">Regular</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div
              className={`text-lg font-bold ${period.totals.totalOvertimeMinutes > 0 ? "text-orange-500" : ""}`}
            >
              {fmtMins(period.totals.totalOvertimeMinutes)}
            </div>
            <div className="text-xs text-muted-foreground">Overtime</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold">
              {fmtMins(period.totals.totalBreakMinutes)}
            </div>
            <div className="text-xs text-muted-foreground">Break</div>
          </CardContent>
        </Card>
      </div>

      {/* Entries */}
      <div className="space-y-2 mt-2">
        <h3 className="text-sm font-medium">Entries</h3>
        {period.entries.map((entry) => {
          const breakMins = entry.breaks.reduce(
            (s, b) => s + (b.durationMinutes ?? 0),
            0
          );
          const netMins = Math.max(0, (entry.durationMinutes ?? 0) - breakMins);
          const isEditing = editingEntry === entry.id;

          return (
            <Card key={entry.id}>
              <CardContent className="p-3 space-y-2">
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Clock In</Label>
                        <Input
                          type="datetime-local"
                          value={editClockIn}
                          onChange={(e) => setEditClockIn(e.target.value)}
                          className="text-xs h-8"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Clock Out</Label>
                        <Input
                          type="datetime-local"
                          value={editClockOut}
                          onChange={(e) => setEditClockOut(e.target.value)}
                          className="text-xs h-8"
                        />
                      </div>
                    </div>
                    <Input
                      placeholder="Notes"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      className="text-xs h-8"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => editMutation.mutate(entry.id)}
                        disabled={editMutation.isPending}
                      >
                        {editMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : null}
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => setEditingEntry(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">
                          {new Date(entry.clockIn).toLocaleDateString([], {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        {entry.editedBy && (
                          <Badge variant="outline" className="text-xs">
                            Office edit
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <span>In: {fmtTime(entry.clockIn)}</span>
                        {entry.clockOut && <span>Out: {fmtTime(entry.clockOut)}</span>}
                        <span>{fmtMins(netMins)} net</span>
                        {breakMins > 0 && <span>{fmtMins(breakMins)} break</span>}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => startEdit(entry)}
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {period.entries.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-2">No entries</p>
        )}
      </div>

      {/* Actions */}
      <DialogFooter className="flex-col sm:flex-row gap-2 mt-4">
        {period.status === "submitted" && (
          <>
            {showRejectInput ? (
              <div className="w-full space-y-2">
                <Textarea
                  placeholder="Reason for returning..."
                  value={rejectNotes}
                  onChange={(e) => setRejectNotes(e.target.value)}
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-1"
                    onClick={() => rejectMutation.mutate()}
                    disabled={!rejectNotes.trim() || rejectMutation.isPending}
                  >
                    {rejectMutation.isPending && (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    )}
                    Return to Tech
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowRejectInput(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Button
                  className="flex-1"
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending}
                >
                  {approveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <CheckCircle className="h-4 w-4 mr-1" />
                  )}
                  Approve
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => setShowRejectInput(true)}
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Return
                </Button>
              </>
            )}
          </>
        )}
        {(period.status === "approved" || period.status === "draft") && (
          <Button
            variant="outline"
            onClick={() => reopenMutation.mutate()}
            disabled={reopenMutation.isPending}
          >
            {reopenMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-1" />
            )}
            Reopen to Draft
          </Button>
        )}
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── Manual Entry Dialog ───────────────────────────────────────────────────────

function ManualEntryDialog({
  teamMembers,
  onClose,
  onSuccess,
}: {
  teamMembers: TeamMember[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [userId, setUserId] = useState("");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/time-entries/manual", {
        userId,
        clockIn,
        clockOut: clockOut || undefined,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      onSuccess();
      onClose();
      toast({ title: "Entry created" });
    },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  const techs = teamMembers.filter((m) => m.role === "tech" || m.role === "owner" || m.role === "admin");

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add Manual Entry</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-2">
        <div>
          <Label>Technician</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger>
              <SelectValue placeholder="Select tech..." />
            </SelectTrigger>
            <SelectContent>
              {techs.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.firstName} {m.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Clock In</Label>
          <Input
            type="datetime-local"
            value={clockIn}
            onChange={(e) => setClockIn(e.target.value)}
          />
        </div>
        <div>
          <Label>Clock Out (optional)</Label>
          <Input
            type="datetime-local"
            value={clockOut}
            onChange={(e) => setClockOut(e.target.value)}
          />
        </div>
        <div>
          <Label>Notes (optional)</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes..."
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => mutation.mutate()}
          disabled={!userId || !clockIn || mutation.isPending}
        >
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
          Add Entry
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── Export Dialog ────────────────────────────────────────────────────────────

function ExportDialog({
  periodIds,
  templates,
  onClose,
}: {
  periodIds: string[];
  templates: ExportTemplate[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");

  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/timecards/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ periodIds, templateId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ScooPilot_Payroll_Export.csv";
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => { onClose(); toast({ title: "Export downloaded" }); },
    onError: (e: any) => toast({ title: e.message || "Export failed", variant: "destructive" }),
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Export {periodIds.length} Period(s)</DialogTitle>
      </DialogHeader>
      <div className="py-2 space-y-3">
        <div>
          <Label>Template</Label>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger>
              <SelectValue placeholder="Select template..." />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => exportMutation.mutate()}
          disabled={!templateId || exportMutation.isPending}
        >
          {exportMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <Download className="h-4 w-4 mr-1" />
          )}
          Download CSV
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TimecardsOfficePage() {
  const [activeTab, setActiveTab] = useState<"queue" | "all">("queue");
  const [selectedPeriod, setSelectedPeriod] = useState<TimecardPeriod | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterUserId, setFilterUserId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const { toast } = useToast();

  const { data: teamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ["/api/team"],
  });

  const { data: submittedPeriods = [], isLoading: queueLoading, refetch: refetchQueue } =
    useQuery<TimecardPeriod[]>({
      queryKey: ["/api/timecards", "submitted"],
      queryFn: () => apiRequest("GET", "/api/timecards?status=submitted"),
      enabled: activeTab === "queue",
    });

  const { data: allPeriods = [], isLoading: allLoading, refetch: refetchAll } =
    useQuery<TimecardPeriod[]>({
      queryKey: ["/api/timecards", "all", filterUserId, filterStatus],
      queryFn: () => {
        const params = new URLSearchParams();
        if (filterUserId) params.set("userId", filterUserId);
        if (filterStatus) params.set("status", filterStatus);
        return apiRequest("GET", `/api/timecards?${params}`);
      },
      enabled: activeTab === "all",
    });

  const { data: templates = [] } = useQuery<ExportTemplate[]>({
    queryKey: ["/api/timecards/settings/templates"],
  });

  const { data: periodDetail } = useQuery<TimecardPeriod>({
    queryKey: [`/api/timecards/${selectedPeriod?.id}`],
    enabled: !!selectedPeriod,
    queryFn: () => apiRequest("GET", `/api/timecards/${selectedPeriod!.id}`),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          apiRequest("POST", `/api/timecards/${id}/approve`, {})
        )
      );
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      refetchQueue();
      refetchAll();
      toast({ title: `${selectedIds.size} periods approved` });
    },
    onError: (e: any) => toast({ title: e.message || "Error", variant: "destructive" }),
  });

  function getUserName(userId: string) {
    const u = teamMembers.find((m) => m.id === userId);
    return u ? `${u.firstName} ${u.lastName}` : userId;
  }

  const displayPeriod = periodDetail ?? selectedPeriod;
  const approvedSelectedIds = Array.from(selectedIds).filter((id) => {
    const p = allPeriods.find((x) => x.id === id);
    return p?.status === "approved";
  });

  const periods = activeTab === "queue" ? submittedPeriods : allPeriods;
  const isLoading = activeTab === "queue" ? queueLoading : allLoading;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Clock className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Timecards</h1>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && activeTab === "queue" && (
            <Button
              size="sm"
              onClick={() => bulkApproveMutation.mutate()}
              disabled={bulkApproveMutation.isPending}
            >
              {bulkApproveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-1" />
              )}
              Approve {selectedIds.size} Selected
            </Button>
          )}
          {approvedSelectedIds.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowExport(true)}
            >
              <Download className="h-4 w-4 mr-1" />
              Export {approvedSelectedIds.length}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowManualEntry(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Entry
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b bg-background shrink-0 px-6">
        <button
          className={`py-2.5 text-sm font-medium mr-6 transition-colors ${activeTab === "queue" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
          onClick={() => { setActiveTab("queue"); setSelectedIds(new Set()); }}
        >
          Approval Queue
          {submittedPeriods.length > 0 && (
            <Badge className="ml-2" variant="secondary">
              {submittedPeriods.length}
            </Badge>
          )}
        </button>
        <button
          className={`py-2.5 text-sm font-medium transition-colors ${activeTab === "all" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
          onClick={() => { setActiveTab("all"); setSelectedIds(new Set()); }}
        >
          All Periods
        </button>
      </div>

      {/* Filters (All Periods tab) */}
      {activeTab === "all" && (
        <div className="flex items-center gap-3 px-6 py-3 border-b bg-muted/20 shrink-0">
          <Select value={filterUserId} onValueChange={setFilterUserId}>
            <SelectTrigger className="w-44 h-8">
              <SelectValue placeholder="All technicians" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All technicians</SelectItem>
              {teamMembers.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.firstName} {m.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-36 h-8">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          {(filterUserId || filterStatus) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setFilterUserId(""); setFilterStatus(""); }}
            >
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : periods.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
            <AlertCircle className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">
              {activeTab === "queue"
                ? "No timecards awaiting approval"
                : "No periods found"}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background border-b">
              <tr>
                <th className="w-10 px-4 py-3 text-left">
                  <Checkbox
                    checked={selectedIds.size === periods.length && periods.length > 0}
                    onCheckedChange={(checked) => {
                      setSelectedIds(
                        checked ? new Set(periods.map((p) => p.id)) : new Set()
                      );
                    }}
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Technician
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Period
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Regular
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Overtime
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {periods.map((period) => (
                <tr
                  key={period.id}
                  className="hover:bg-muted/30 cursor-pointer"
                  onClick={() => setSelectedPeriod(period)}
                >
                  <td
                    className="px-4 py-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selectedIds.has(period.id)}
                      onCheckedChange={(checked) => {
                        const next = new Set(selectedIds);
                        checked ? next.add(period.id) : next.delete(period.id);
                        setSelectedIds(next);
                      }}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {getUserName(period.userId)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {fmtDate(period.periodStart)} – {fmtDate(period.periodEnd)}
                  </td>
                  <td className="px-4 py-3">{fmtMins(period.totalRegularMinutes)}</td>
                  <td className="px-4 py-3">
                    {(period.totalOvertimeMinutes ?? 0) > 0 ? (
                      <span className="text-orange-500 font-medium">
                        {fmtMins(period.totalOvertimeMinutes)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{statusBadge(period.status)}</td>
                  <td
                    className="px-4 py-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedPeriod(period)}
                      >
                        View
                      </Button>
                      {period.status === "approved" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSelectedIds(new Set([period.id]));
                            setShowExport(true);
                          }}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Period Detail Modal */}
      {selectedPeriod && displayPeriod && (
        <Dialog open={true} onOpenChange={() => setSelectedPeriod(null)}>
          <PeriodDetailModal
            period={displayPeriod}
            teamMembers={teamMembers}
            onClose={() => setSelectedPeriod(null)}
            onRefresh={() => {
              refetchQueue();
              refetchAll();
              queryClient.invalidateQueries({
                queryKey: [`/api/timecards/${selectedPeriod.id}`],
              });
            }}
          />
        </Dialog>
      )}

      {/* Manual Entry Dialog */}
      {showManualEntry && (
        <Dialog open={true} onOpenChange={() => setShowManualEntry(false)}>
          <ManualEntryDialog
            teamMembers={teamMembers}
            onClose={() => setShowManualEntry(false)}
            onSuccess={() => { refetchQueue(); refetchAll(); }}
          />
        </Dialog>
      )}

      {/* Export Dialog */}
      {showExport && (
        <Dialog open={true} onOpenChange={() => setShowExport(false)}>
          <ExportDialog
            periodIds={approvedSelectedIds.length > 0 ? approvedSelectedIds : Array.from(selectedIds)}
            templates={templates}
            onClose={() => setShowExport(false)}
          />
        </Dialog>
      )}
    </div>
  );
}
