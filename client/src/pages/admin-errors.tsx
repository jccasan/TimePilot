import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { adminFetchFn, adminRequest } from "@/lib/adminApi";
import { queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Bug, ChevronRight, ChevronDown, Wrench, CheckCircle, Eye, X, ChevronLeft, Layers, List, Check, CheckCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 50;

type ErrorReport = {
  id: string;
  message: string;
  stack: string | null;
  errorType: "react" | "js" | "api";
  pageUrl: string | null;
  userId: string | null;
  companyId: string | null;
  userAgent: string | null;
  status: "open" | "acknowledged" | "resolved";
  createdAt: string;
  fixTask: { id: string; title: string; status: "open" | "done"; createdAt: string } | null;
};

type GroupedErrorReport = {
  message: string;
  errorType: "react" | "js" | "api";
  status: "open" | "acknowledged" | "resolved";
  count: number;
  firstSeen: string;
  lastSeen: string;
  latestId: string;
};

const TYPE_COLORS: Record<string, string> = {
  react: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  js: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  api: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-500/20 text-red-400 border-red-500/30",
  acknowledged: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  resolved: "bg-green-500/20 text-green-400 border-green-500/30",
};

function formatTs(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
  } catch {
    return ts;
  }
}

function parseUA(ua: string | null) {
  if (!ua) return "Unknown browser";
  const browsers = [
    { re: /Chrome\/(\S+)/, name: "Chrome" },
    { re: /Firefox\/(\S+)/, name: "Firefox" },
    { re: /Safari\/(\S+)/, name: "Safari" },
    { re: /Edge\/(\S+)/, name: "Edge" },
  ];
  for (const b of browsers) {
    const m = ua.match(b.re);
    if (m) return `${b.name} ${m[1]}`;
  }
  return ua.slice(0, 60);
}

function parseOS(ua: string | null) {
  if (!ua) return "Unknown OS";
  if (ua.includes("Windows NT 10")) return "Windows 10/11";
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Mac OS X")) return "macOS";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
  if (ua.includes("Linux")) return "Linux";
  return "Unknown OS";
}

function buildQueryUrl(statusFilter: string, fromDate: string, toDate: string, page: number, grouped: boolean) {
  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (fromDate) params.set("fromDate", new Date(fromDate).toISOString());
  if (toDate) {
    const d = new Date(toDate);
    d.setHours(23, 59, 59, 999);
    params.set("toDate", d.toISOString());
  }
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));
  const base = grouped ? "/api/admin/error-reports/grouped" : "/api/admin/error-reports";
  return `${base}?${params.toString()}`;
}

function buildGroupDetailUrl(message: string, statusFilter: string, fromDate: string, toDate: string) {
  const params = new URLSearchParams();
  params.set("message", message);
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (fromDate) params.set("fromDate", new Date(fromDate).toISOString());
  if (toDate) {
    const d = new Date(toDate);
    d.setHours(23, 59, 59, 999);
    params.set("toDate", d.toISOString());
  }
  params.set("limit", "100");
  return `/api/admin/error-reports?${params.toString()}`;
}

function ExpandedGroupRows({
  message,
  statusFilter,
  fromDate,
  toDate,
  selectedId,
  onSelect,
}: {
  message: string;
  statusFilter: string;
  fromDate: string;
  toDate: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const url = buildGroupDetailUrl(message, statusFilter, fromDate, toDate);
  const { data: reports = [], isLoading } = useQuery<ErrorReport[]>({
    queryKey: ["/api/admin/error-reports", "group-expand", message, statusFilter, fromDate, toDate],
    queryFn: adminFetchFn(url),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-10 py-2 text-[#858585] text-xs border-b border-[#2d2d2d] bg-[#1a1a1a]">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <>
      {reports.map((report) => (
        <div
          key={report.id}
          className={`flex items-start gap-3 px-10 py-2.5 border-b border-[#2d2d2d] cursor-pointer transition-colors ${selectedId === report.id ? "bg-[#264f78]/30" : "bg-[#1a1a1a] hover:bg-[#222]"}`}
          onClick={() => onSelect(report.id)}
          data-testid={`error-subrow-${report.id}`}
        >
          <ChevronRight className="h-3 w-3 shrink-0 mt-0.5 text-[#555]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] border px-1.5 py-0.5 rounded font-medium ${STATUS_COLORS[report.status] || ""}`}>
                {report.status}
              </span>
              {report.fixTask && (
                <span className={`text-[10px] border px-1.5 py-0.5 rounded font-medium ${report.fixTask.status === "done" ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-purple-500/20 text-purple-400 border-purple-500/30"}`}>
                  {report.fixTask.status === "done" ? "fix done" : "fix open"}
                </span>
              )}
              <span className="text-[10px] text-[#858585]">{formatTs(report.createdAt)}</span>
              {report.userId && <span className="text-[10px] text-[#858585]">user: {report.userId.slice(0, 8)}</span>}
              {report.pageUrl && <span className="text-[10px] text-[#858585] truncate max-w-[180px]">{report.pageUrl}</span>}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

export default function AdminErrors() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showFixTaskForm, setShowFixTaskForm] = useState(false);
  const [fixTaskTitle, setFixTaskTitle] = useState("");
  const [viewMode, setViewMode] = useState<"all" | "grouped">("grouped");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<{ message: string; status: string; count: number } | null>(null);

  const queryUrl = buildQueryUrl(statusFilter, fromDate, toDate, page, viewMode === "grouped");

  const { data: allReports = [], isLoading: allLoading } = useQuery<ErrorReport[]>({
    queryKey: ["/api/admin/error-reports", statusFilter, fromDate, toDate, page],
    queryFn: adminFetchFn(buildQueryUrl(statusFilter, fromDate, toDate, page, false)),
    enabled: viewMode === "all",
  });

  const { data: groupedReports = [], isLoading: groupedLoading } = useQuery<GroupedErrorReport[]>({
    queryKey: ["/api/admin/error-reports/grouped", statusFilter, fromDate, toDate, page],
    queryFn: adminFetchFn(buildQueryUrl(statusFilter, fromDate, toDate, page, true)),
    enabled: viewMode === "grouped",
  });

  const isLoading = viewMode === "all" ? allLoading : groupedLoading;
  const reports = viewMode === "all" ? allReports : [];
  const hasNextPage = viewMode === "all" ? allReports.length === PAGE_SIZE : groupedReports.length === PAGE_SIZE;

  const selected = selectedId
    ? allReports.find(r => r.id === selectedId) ?? null
    : null;

  const selectedDetailQuery = useQuery<ErrorReport>({
    queryKey: ["/api/admin/error-reports", selectedId],
    queryFn: adminFetchFn(`/api/admin/error-reports/${selectedId}`),
    enabled: !!selectedId && !selected,
  });

  const detailReport = selected ?? (selectedDetailQuery.data || null);

  function handleSelectReport(id: string) {
    setSelectedId(prev => {
      const next = prev === id ? null : id;
      setShowFixTaskForm(false);
      setFixTaskTitle("");
      return next;
    });
  }

  function handleFilterChange(setter: (v: string) => void) {
    return (value: string) => {
      setter(value);
      setPage(0);
      setSelectedId(null);
      setExpandedGroups(new Set());
    };
  }

  function toggleGroup(message: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(message)) {
        next.delete(message);
      } else {
        next.add(message);
      }
      return next;
    });
  }

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await adminRequest("PATCH", `/api/admin/error-reports/${id}`, { status });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-reports/grouped"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-reports/stats"] });
      toast({ title: "Status updated" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ message, status }: { message: string; status: string }) => {
      const res = await adminRequest("POST", "/api/admin/error-reports/bulk-status", { message, status });
      if (!res.ok) throw new Error("Failed to bulk update");
      return res.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-reports/grouped"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-reports/stats"] });
      toast({ title: `${data.updated} error${data.updated !== 1 ? "s" : ""} marked as ${variables.status}` });
    },
    onError: () => toast({ title: "Failed to bulk update status", variant: "destructive" }),
  });

  const fixTaskMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const res = await adminRequest("POST", `/api/admin/error-reports/${id}/fix-task`, { title: title.trim() || undefined });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.fixTask) return body.fixTask;
        throw new Error("Failed to create fix task");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-reports/grouped"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-reports/stats"] });
      setShowFixTaskForm(false);
      setFixTaskTitle("");
      toast({ title: "Fix task created" });
    },
    onError: () => toast({ title: "Failed to create fix task", variant: "destructive" }),
  });

  const markFixTaskDoneMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "open" | "done" }) => {
      const res = await adminRequest("PATCH", `/api/admin/error-reports/${id}/fix-task`, { status });
      if (!res.ok) throw new Error("Failed to update fix task");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-reports/grouped"] });
      toast({ title: "Fix task updated" });
    },
    onError: () => toast({ title: "Failed to update fix task", variant: "destructive" }),
  });

  const openCount = viewMode === "all"
    ? allReports.filter(r => r.status === "open").length
    : groupedReports.filter(g => g.status === "open").length;

  const isEmpty = viewMode === "all" ? allReports.length === 0 : groupedReports.length === 0;

  return (
    <div className="flex h-full bg-[#1e1e1e] text-[#d4d4d4] font-mono" data-testid="admin-errors-page">
      <div className={`flex flex-col ${detailReport ? "w-1/2" : "w-full"} transition-all duration-200`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3c3c3c] flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Bug className="h-5 w-5 text-red-400" />
            <h1 className="text-base font-semibold text-[#e8e8e8]" data-testid="text-errors-title">
              Error Terminal
            </h1>
            {openCount > 0 && (
              <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full" data-testid="badge-open-count">
                {openCount} open
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center border border-[#3c3c3c] rounded overflow-hidden" data-testid="view-mode-toggle">
              <button
                className={`flex items-center gap-1 px-2.5 py-1 text-[11px] transition-colors ${viewMode === "grouped" ? "bg-[#264f78]/50 text-[#e8e8e8]" : "text-[#858585] hover:bg-[#2a2d2e]"}`}
                onClick={() => { setViewMode("grouped"); setPage(0); setSelectedId(null); setExpandedGroups(new Set()); }}
                data-testid="button-grouped-view"
              >
                <Layers className="h-3 w-3" />
                Grouped
              </button>
              <button
                className={`flex items-center gap-1 px-2.5 py-1 text-[11px] transition-colors border-l border-[#3c3c3c] ${viewMode === "all" ? "bg-[#264f78]/50 text-[#e8e8e8]" : "text-[#858585] hover:bg-[#2a2d2e]"}`}
                onClick={() => { setViewMode("all"); setPage(0); setSelectedId(null); }}
                data-testid="button-all-view"
              >
                <List className="h-3 w-3" />
                All
              </button>
            </div>
            <Input
              type="date"
              value={fromDate}
              onChange={e => { setFromDate(e.target.value); setPage(0); setSelectedId(null); setExpandedGroups(new Set()); }}
              className="h-7 w-[130px] text-xs bg-[#252526] border-[#3c3c3c] text-[#d4d4d4] px-2"
              data-testid="input-from-date"
            />
            <span className="text-[#858585] text-xs">–</span>
            <Input
              type="date"
              value={toDate}
              onChange={e => { setToDate(e.target.value); setPage(0); setSelectedId(null); setExpandedGroups(new Set()); }}
              className="h-7 w-[130px] text-xs bg-[#252526] border-[#3c3c3c] text-[#d4d4d4] px-2"
              data-testid="input-to-date"
            />
            <Select value={statusFilter} onValueChange={handleFilterChange(setStatusFilter)}>
              <SelectTrigger className="h-7 w-[140px] text-xs bg-[#252526] border-[#3c3c3c] text-[#d4d4d4]" data-testid="select-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#252526] border-[#3c3c3c] text-[#d4d4d4]">
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64" data-testid="loading-errors">
            <Loader2 className="h-5 w-5 animate-spin text-[#858585]" />
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center h-64 text-[#858585]" data-testid="empty-errors">
            <Bug className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">No error reports found</p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-auto">
              {viewMode === "all" && allReports.map((report) => (
                <div
                  key={report.id}
                  className={`flex items-start gap-3 px-5 py-3 border-b border-[#2d2d2d] cursor-pointer transition-colors ${selectedId === report.id ? "bg-[#264f78]/30" : "hover:bg-[#2a2d2e]"}`}
                  onClick={() => handleSelectReport(report.id)}
                  data-testid={`error-row-${report.id}`}
                >
                  <div className="shrink-0 mt-0.5 text-[#858585]">
                    {selectedId === report.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-[10px] border px-1.5 py-0.5 rounded font-medium ${TYPE_COLORS[report.errorType] || ""}`} data-testid={`badge-type-${report.id}`}>
                        {report.errorType.toUpperCase()}
                      </span>
                      <span className={`text-[10px] border px-1.5 py-0.5 rounded font-medium ${STATUS_COLORS[report.status] || ""}`} data-testid={`badge-status-${report.id}`}>
                        {report.status}
                      </span>
                      {report.fixTask && (
                        <span className={`text-[10px] border px-1.5 py-0.5 rounded font-medium ${report.fixTask.status === "done" ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-purple-500/20 text-purple-400 border-purple-500/30"}`}>
                          {report.fixTask.status === "done" ? "fix done" : "fix open"}
                        </span>
                      )}
                      <span className="text-[10px] text-[#858585]">{formatTs(report.createdAt)}</span>
                    </div>
                    <p className="text-sm text-[#e8e8e8] truncate" data-testid={`text-message-${report.id}`}>
                      {report.message}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-[#858585]">
                      {report.companyId && <span>company: {report.companyId.slice(0, 8)}</span>}
                      {report.userId && <span>user: {report.userId.slice(0, 8)}</span>}
                      {report.pageUrl && <span className="truncate max-w-[200px]">{report.pageUrl}</span>}
                    </div>
                  </div>
                </div>
              ))}

              {viewMode === "grouped" && groupedReports.map((group) => {
                const isExpanded = expandedGroups.has(group.message);
                const isBulkPending = bulkStatusMutation.isPending && bulkStatusMutation.variables?.message === group.message;
                return (
                  <div key={group.message} data-testid={`group-row-${group.latestId}`}>
                    <div
                      className="flex items-start gap-3 px-5 py-3 border-b border-[#2d2d2d] cursor-pointer transition-colors hover:bg-[#2a2d2e]"
                      onClick={() => toggleGroup(group.message)}
                      data-testid={`group-header-${group.latestId}`}
                    >
                      <div className="shrink-0 mt-0.5 text-[#858585]">
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-[10px] border px-1.5 py-0.5 rounded font-medium ${TYPE_COLORS[group.errorType] || ""}`}>
                            {group.errorType.toUpperCase()}
                          </span>
                          <span className={`text-[10px] border px-1.5 py-0.5 rounded font-medium ${STATUS_COLORS[group.status] || ""}`}>
                            {group.status}
                          </span>
                          <span
                            className="text-[10px] border px-1.5 py-0.5 rounded font-medium bg-[#3c3c3c] text-[#d4d4d4] border-[#555]"
                            data-testid={`badge-count-${group.latestId}`}
                          >
                            {group.count}×
                          </span>
                          <span className="text-[10px] text-[#858585]">last {formatTs(group.lastSeen)}</span>
                        </div>
                        <p className="text-sm text-[#e8e8e8] truncate" data-testid={`text-group-message-${group.latestId}`}>
                          {group.message}
                        </p>
                        <div className="text-[10px] text-[#555] mt-0.5">
                          first seen {formatTs(group.firstSeen)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2" onClick={e => e.stopPropagation()}>
                        {group.status !== "acknowledged" && (
                          <button
                            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-40"
                            disabled={isBulkPending}
                            onClick={() => setBulkConfirm({ message: group.message, status: "acknowledged", count: group.count })}
                            data-testid={`button-acknowledge-all-${group.latestId}`}
                          >
                            {isBulkPending && bulkStatusMutation.variables?.status === "acknowledged"
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Eye className="h-3 w-3" />}
                            Ack all
                          </button>
                        )}
                        {group.status !== "resolved" && (
                          <button
                            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors disabled:opacity-40"
                            disabled={isBulkPending}
                            onClick={() => setBulkConfirm({ message: group.message, status: "resolved", count: group.count })}
                            data-testid={`button-resolve-all-${group.latestId}`}
                          >
                            {isBulkPending && bulkStatusMutation.variables?.status === "resolved"
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <CheckCheck className="h-3 w-3" />}
                            Resolve all
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <ExpandedGroupRows
                        message={group.message}
                        statusFilter={statusFilter}
                        fromDate={fromDate}
                        toDate={toDate}
                        selectedId={selectedId}
                        onSelect={(id) => setSelectedId(selectedId === id ? null : id)}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-[#3c3c3c] text-xs text-[#858585]" data-testid="pagination-controls">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-[#d4d4d4] hover:bg-[#2a2d2e] disabled:opacity-30"
                disabled={page === 0}
                onClick={() => { setPage(p => p - 1); setSelectedId(null); setExpandedGroups(new Set()); }}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                Prev
              </Button>
              <span data-testid="text-page-info">
                Page {page + 1} · {viewMode === "grouped" ? groupedReports.length : allReports.length} records
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-[#d4d4d4] hover:bg-[#2a2d2e] disabled:opacity-30"
                disabled={!hasNextPage}
                onClick={() => { setPage(p => p + 1); setSelectedId(null); setExpandedGroups(new Set()); }}
                data-testid="button-next-page"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </>
        )}
      </div>

      {detailReport && (
        <div className="w-1/2 border-l border-[#3c3c3c] flex flex-col overflow-auto" data-testid="error-detail-panel">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#3c3c3c] sticky top-0 bg-[#1e1e1e] z-10">
            <div className="flex items-center gap-2">
              <Bug className="h-4 w-4 text-red-400" />
              <span className="text-sm font-medium text-[#e8e8e8]">Error Detail</span>
            </div>
            <button
              onClick={() => { setSelectedId(null); setShowFixTaskForm(false); setFixTaskTitle(""); }}
              className="text-[#858585] hover:text-[#d4d4d4] transition-colors"
              data-testid="button-close-detail"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: "ID", value: detailReport.id },
                { label: "Type", value: detailReport.errorType.toUpperCase() },
                { label: "Status", value: detailReport.status },
                { label: "Time", value: formatTs(detailReport.createdAt) },
                { label: "User", value: detailReport.userId || "anonymous" },
                { label: "Company", value: detailReport.companyId || "unknown" },
                { label: "Browser", value: parseUA(detailReport.userAgent) },
                { label: "OS", value: parseOS(detailReport.userAgent) },
              ].map(({ label, value }) => (
                <div key={label} className="bg-[#252526] rounded p-2" data-testid={`detail-${label.toLowerCase()}`}>
                  <div className="text-[#858585] text-[10px] mb-0.5">{label}</div>
                  <div className="text-[#d4d4d4] break-all">{value}</div>
                </div>
              ))}
            </div>

            {detailReport.pageUrl && (
              <div>
                <div className="text-[10px] text-[#858585] mb-1">PAGE URL</div>
                <div className="bg-[#252526] rounded p-2 text-xs text-[#9cdcfe] break-all" data-testid="detail-page-url">
                  {detailReport.pageUrl}
                </div>
              </div>
            )}

            <div>
              <div className="text-[10px] text-[#858585] mb-1">MESSAGE</div>
              <div className="bg-[#252526] rounded p-3 text-sm text-[#f44747] break-words" data-testid="detail-message">
                {detailReport.message}
              </div>
            </div>

            {detailReport.stack && (
              <div>
                <div className="text-[10px] text-[#858585] mb-1">STACK TRACE</div>
                <pre className="bg-[#0d0d0d] rounded p-3 text-[11px] text-[#ce9178] overflow-auto max-h-64 whitespace-pre-wrap break-words" data-testid="detail-stack">
                  {detailReport.stack}
                </pre>
              </div>
            )}

            <div>
              <div className="text-[10px] text-[#858585] mb-2">FIX TASKS</div>
              {detailReport.fixTask ? (
                <div
                  className={`border rounded p-3 ${detailReport.fixTask.status === "done" ? "bg-green-500/10 border-green-500/30" : "bg-purple-500/10 border-purple-500/30"}`}
                  data-testid="fix-task-item"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div
                        className={`text-xs ${detailReport.fixTask.status === "done" ? "line-through text-[#858585]" : "text-[#d4d4d4]"}`}
                        data-testid="fix-task-title"
                      >
                        {detailReport.fixTask.title}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${detailReport.fixTask.status === "done" ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-purple-500/20 text-purple-400 border-purple-500/30"}`}
                          data-testid="fix-task-status"
                        >
                          {detailReport.fixTask.status}
                        </span>
                        <span className="text-[10px] text-[#858585]" data-testid="fix-task-date">Created {formatTs(detailReport.fixTask.createdAt)}</span>
                      </div>
                    </div>
                    {detailReport.fixTask.status === "open" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] shrink-0 bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20"
                        disabled={markFixTaskDoneMutation.isPending}
                        onClick={() => markFixTaskDoneMutation.mutate({ id: detailReport.id, status: "done" })}
                        data-testid="button-mark-fix-done"
                      >
                        {markFixTaskDoneMutation.isPending ? <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" /> : <Check className="h-2.5 w-2.5 mr-1" />}
                        Mark done
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] shrink-0 text-[#858585] hover:text-[#d4d4d4] hover:bg-[#2a2d2e]"
                        disabled={markFixTaskDoneMutation.isPending}
                        onClick={() => markFixTaskDoneMutation.mutate({ id: detailReport.id, status: "open" })}
                        data-testid="button-reopen-fix-task"
                      >
                        Reopen
                      </Button>
                    )}
                  </div>
                </div>
              ) : showFixTaskForm ? (
                <div className="bg-[#252526] border border-[#3c3c3c] rounded p-3 space-y-2" data-testid="fix-task-form">
                  <Input
                    placeholder="Task title (leave blank to auto-generate)"
                    value={fixTaskTitle}
                    onChange={e => setFixTaskTitle(e.target.value)}
                    className="h-7 text-xs bg-[#1e1e1e] border-[#3c3c3c] text-[#d4d4d4] placeholder:text-[#585858]"
                    data-testid="input-fix-task-title"
                    onKeyDown={e => {
                      if (e.key === "Enter") fixTaskMutation.mutate({ id: detailReport.id, title: fixTaskTitle });
                      if (e.key === "Escape") { setShowFixTaskForm(false); setFixTaskTitle(""); }
                    }}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20"
                      disabled={fixTaskMutation.isPending}
                      onClick={() => fixTaskMutation.mutate({ id: detailReport.id, title: fixTaskTitle })}
                      data-testid="button-submit-fix-task"
                    >
                      {fixTaskMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wrench className="h-3 w-3 mr-1" />}
                      Create
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-[#858585] hover:text-[#d4d4d4] hover:bg-[#2a2d2e]"
                      onClick={() => { setShowFixTaskForm(false); setFixTaskTitle(""); }}
                      data-testid="button-cancel-fix-task"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20"
                  onClick={() => setShowFixTaskForm(true)}
                  data-testid="button-create-fix-task"
                >
                  <Wrench className="h-3 w-3 mr-1" />
                  Create Fix Task
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[#3c3c3c]">
              {detailReport.status !== "acknowledged" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs bg-[#252526] border-[#3c3c3c] text-[#d4d4d4] hover:bg-[#2d2d2d]"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ id: detailReport.id, status: "acknowledged" })}
                  data-testid="button-acknowledge"
                >
                  <Eye className="h-3 w-3 mr-1" />
                  Acknowledge
                </Button>
              )}
              {detailReport.status !== "resolved" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs bg-[#252526] border-[#3c3c3c] text-[#d4d4d4] hover:bg-[#2d2d2d]"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ id: detailReport.id, status: "resolved" })}
                  data-testid="button-resolve"
                >
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Resolve
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={!!bulkConfirm} onOpenChange={(open) => { if (!open) setBulkConfirm(null); }}>
        <AlertDialogContent data-testid="bulk-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkConfirm?.status === "resolved" ? "Resolve all errors?" : "Acknowledge all errors?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will mark{" "}
              <span className="font-semibold text-foreground">{bulkConfirm?.count ?? 0} error{(bulkConfirm?.count ?? 0) !== 1 ? "s" : ""}</span>{" "}
              as <span className="font-semibold text-foreground">{bulkConfirm?.status}</span>. This action cannot be undone automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="bulk-confirm-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="bulk-confirm-proceed"
              onClick={() => {
                if (bulkConfirm) {
                  bulkStatusMutation.mutate({ message: bulkConfirm.message, status: bulkConfirm.status });
                  setBulkConfirm(null);
                }
              }}
            >
              {bulkConfirm?.status === "resolved" ? "Resolve all" : "Acknowledge all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
