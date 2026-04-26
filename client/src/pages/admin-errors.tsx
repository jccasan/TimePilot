import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { adminFetchFn, adminRequest } from "@/lib/adminApi";
import { queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Bug, ChevronRight, ChevronDown, Wrench, CheckCircle, Eye, X, ChevronLeft } from "lucide-react";
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
  fixTask: { id: string; title: string; createdAt: string } | null;
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

function buildQueryUrl(statusFilter: string, fromDate: string, toDate: string, page: number) {
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
  return `/api/admin/error-reports?${params.toString()}`;
}

export default function AdminErrors() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const queryUrl = buildQueryUrl(statusFilter, fromDate, toDate, page);

  const { data: reports = [], isLoading } = useQuery<ErrorReport[]>({
    queryKey: ["/api/admin/error-reports", statusFilter, fromDate, toDate, page],
    queryFn: adminFetchFn(queryUrl),
  });

  const selected = selectedId ? reports.find(r => r.id === selectedId) ?? null : null;

  function handleFilterChange(setter: (v: string) => void) {
    return (value: string) => {
      setter(value);
      setPage(0);
      setSelectedId(null);
    };
  }

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await adminRequest("PATCH", `/api/admin/error-reports/${id}`, { status });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-reports/stats"] });
      toast({ title: "Status updated" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const fixTaskMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await adminRequest("POST", `/api/admin/error-reports/${id}/fix-task`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.fixTask) return body.fixTask;
        throw new Error("Failed to create fix task");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-reports/stats"] });
      toast({ title: "Fix task created" });
    },
    onError: () => toast({ title: "Failed to create fix task", variant: "destructive" }),
  });

  const openCount = reports.filter(r => r.status === "open").length;
  const hasNextPage = reports.length === PAGE_SIZE;

  return (
    <div className="flex h-full bg-[#1e1e1e] text-[#d4d4d4] font-mono" data-testid="admin-errors-page">
      <div className={`flex flex-col ${selected ? "w-1/2" : "w-full"} transition-all duration-200`}>
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
            <Input
              type="date"
              value={fromDate}
              onChange={e => { setFromDate(e.target.value); setPage(0); setSelectedId(null); }}
              className="h-7 w-[130px] text-xs bg-[#252526] border-[#3c3c3c] text-[#d4d4d4] px-2"
              data-testid="input-from-date"
            />
            <span className="text-[#858585] text-xs">–</span>
            <Input
              type="date"
              value={toDate}
              onChange={e => { setToDate(e.target.value); setPage(0); setSelectedId(null); }}
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
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-[#858585]" data-testid="empty-errors">
            <Bug className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">No error reports found</p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-auto">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className={`flex items-start gap-3 px-5 py-3 border-b border-[#2d2d2d] cursor-pointer transition-colors ${selectedId === report.id ? "bg-[#264f78]/30" : "hover:bg-[#2a2d2e]"}`}
                  onClick={() => setSelectedId(selectedId === report.id ? null : report.id)}
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
                        <span className="text-[10px] border px-1.5 py-0.5 rounded font-medium bg-purple-500/20 text-purple-400 border-purple-500/30">
                          task created
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
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-[#3c3c3c] text-xs text-[#858585]" data-testid="pagination-controls">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-[#d4d4d4] hover:bg-[#2a2d2e] disabled:opacity-30"
                disabled={page === 0}
                onClick={() => { setPage(p => p - 1); setSelectedId(null); }}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                Prev
              </Button>
              <span data-testid="text-page-info">Page {page + 1} · {reports.length} records</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-[#d4d4d4] hover:bg-[#2a2d2e] disabled:opacity-30"
                disabled={!hasNextPage}
                onClick={() => { setPage(p => p + 1); setSelectedId(null); }}
                data-testid="button-next-page"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </>
        )}
      </div>

      {selected && (
        <div className="w-1/2 border-l border-[#3c3c3c] flex flex-col overflow-auto" data-testid="error-detail-panel">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#3c3c3c] sticky top-0 bg-[#1e1e1e] z-10">
            <div className="flex items-center gap-2">
              <Bug className="h-4 w-4 text-red-400" />
              <span className="text-sm font-medium text-[#e8e8e8]">Error Detail</span>
            </div>
            <button
              onClick={() => setSelectedId(null)}
              className="text-[#858585] hover:text-[#d4d4d4] transition-colors"
              data-testid="button-close-detail"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: "ID", value: selected.id },
                { label: "Type", value: selected.errorType.toUpperCase() },
                { label: "Status", value: selected.status },
                { label: "Time", value: formatTs(selected.createdAt) },
                { label: "User", value: selected.userId || "anonymous" },
                { label: "Company", value: selected.companyId || "unknown" },
                { label: "Browser", value: parseUA(selected.userAgent) },
                { label: "OS", value: parseOS(selected.userAgent) },
              ].map(({ label, value }) => (
                <div key={label} className="bg-[#252526] rounded p-2" data-testid={`detail-${label.toLowerCase()}`}>
                  <div className="text-[#858585] text-[10px] mb-0.5">{label}</div>
                  <div className="text-[#d4d4d4] break-all">{value}</div>
                </div>
              ))}
            </div>

            {selected.pageUrl && (
              <div>
                <div className="text-[10px] text-[#858585] mb-1">PAGE URL</div>
                <div className="bg-[#252526] rounded p-2 text-xs text-[#9cdcfe] break-all" data-testid="detail-page-url">
                  {selected.pageUrl}
                </div>
              </div>
            )}

            <div>
              <div className="text-[10px] text-[#858585] mb-1">MESSAGE</div>
              <div className="bg-[#252526] rounded p-3 text-sm text-[#f44747] break-words" data-testid="detail-message">
                {selected.message}
              </div>
            </div>

            {selected.stack && (
              <div>
                <div className="text-[10px] text-[#858585] mb-1">STACK TRACE</div>
                <pre className="bg-[#0d0d0d] rounded p-3 text-[11px] text-[#ce9178] overflow-auto max-h-64 whitespace-pre-wrap break-words" data-testid="detail-stack">
                  {selected.stack}
                </pre>
              </div>
            )}

            {selected.fixTask && (
              <div className="bg-purple-500/10 border border-purple-500/30 rounded p-3">
                <div className="text-[10px] text-purple-400 mb-1">FIX TASK</div>
                <div className="text-xs text-[#d4d4d4]">{selected.fixTask.title}</div>
                <div className="text-[10px] text-[#858585] mt-0.5">Created {formatTs(selected.fixTask.createdAt)}</div>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[#3c3c3c]">
              {selected.status !== "acknowledged" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs bg-[#252526] border-[#3c3c3c] text-[#d4d4d4] hover:bg-[#2d2d2d]"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ id: selected.id, status: "acknowledged" })}
                  data-testid="button-acknowledge"
                >
                  <Eye className="h-3 w-3 mr-1" />
                  Acknowledge
                </Button>
              )}
              {selected.status !== "resolved" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs bg-[#252526] border-[#3c3c3c] text-[#d4d4d4] hover:bg-[#2d2d2d]"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ id: selected.id, status: "resolved" })}
                  data-testid="button-resolve"
                >
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Resolve
                </Button>
              )}
              {!selected.fixTask && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20"
                  disabled={fixTaskMutation.isPending}
                  onClick={() => fixTaskMutation.mutate(selected.id)}
                  data-testid="button-create-fix-task"
                >
                  <Wrench className="h-3 w-3 mr-1" />
                  Create Fix Task
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
