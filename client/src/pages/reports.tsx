import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  TrendingUp,
  DollarSign,
  Users,
  FileText,
  CalendarCheck,
  BarChart3,
  Download,
  Printer,
  Plus,
  Trash2,
  Play,
  Pencil,
  RefreshCw,
  Clock,
  Route,
  UserCheck,
} from "lucide-react";
import Analytics from "@/pages/analytics";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type KpiStrip = {
  activeClients: number;
  techCount: number;
  routeCount: number;
  avgStopsPerRoute: number;
  avgVisitMinutes: number;
  residentialCount: number;
  commercialCount: number;
};

type OpenBalanceRow = {
  contactId: string;
  contactName: string;
  current: number;
  days30: number;
  days60: number;
  days90plus: number;
  total: number;
  oldestInvoiceDate: string | null;
};

type JobRow = {
  visitId: string;
  date: string;
  status: string;
  contactName: string;
  routeName: string | null;
  techName: string | null;
  durationMinutes: number | null;
};

type ClientMetrics = {
  monthly: { month: string; newClients: number; cancelledClients: number; netClients: number }[];
  leadSources: { source: string; count: number }[];
  avgClientValue: number;
  activeCount: number;
};

type CrossSellRow = {
  contactId: string;
  contactName: string;
  upgradeType: string;
  detail: string;
  monthlyValue: number;
};

type ScheduledReport = {
  id: string;
  name: string;
  sections: string[];
  frequency: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  sendHour: number;
  recipients: string[];
  lastSentAt: string | null;
  createdAt: string;
};

type ReportData = {
  period: string;
  periodLabel: string;
  monthlyRevenue: { month: string; revenue: number; projected?: boolean }[];
  bookedRevenue: number;
  contactsByStatus: Record<string, number>;
  totalContacts: number;
  invoicesByStatus: Record<string, number>;
  totalInvoices: number;
  totalOutstanding: number;
  totalCollected: number;
  thisMonthVisits: { completed: number; scheduled: number; skipped: number; total: number };
};

// ─── Constants ────────────────────────────────────────────────────────────────

const SECTION_OPTIONS: { key: string; label: string; tab: string }[] = [
  { key: "open_balance", label: "Open Balance", tab: "Finance" },
  { key: "revenue_by_period", label: "Revenue by Period", tab: "Finance" },
  { key: "jobs", label: "Completed Jobs", tab: "Operations" },
  { key: "active_clients", label: "Active Clients Trend", tab: "Customers" },
  { key: "new_vs_lost", label: "New vs Lost Clients", tab: "Customers" },
  { key: "lead_sources", label: "Lead Sources", tab: "Customers" },
  { key: "cross_sell", label: "Cross-sell Opportunities", tab: "Customers" },
];

const CHART_COLORS = ["#2d8a5e", "#4fb483", "#8dc5a8", "#b8ddc9", "#e5f4ed", "#a0785e", "#c9a882"];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ─── Export Utilities ─────────────────────────────────────────────────────────

function exportCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function printTable(title: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const headerHtml = headers.map((h) => `<th style="border:1px solid #ccc;padding:6px 10px;background:#2d8a5e;color:#fff;text-align:left;font-size:12px">${h}</th>`).join("");
  const rowsHtml = rows
    .map(
      (row, i) =>
        `<tr style="background:${i % 2 === 0 ? "#f9fafb" : "#fff"}">${row
          .map((cell) => `<td style="border:1px solid #ccc;padding:5px 10px;font-size:12px">${cell ?? ""}</td>`)
          .join("")}</tr>`
    )
    .join("");
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>body{font-family:Arial,sans-serif;padding:24px}h2{color:#2d8a5e}table{border-collapse:collapse;width:100%}@media print{button{display:none}}</style></head><body><h2>${title}</h2><p style="color:#666;font-size:13px">Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table><br/><button onclick="window.print()">Print / Save as PDF</button></body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── KPI Strip ────────────────────────────────────────────────────────────────

function KpiStrip() {
  const { data, isLoading } = useQuery<KpiStrip>({ queryKey: ["/api/reports/kpi-strip"] });

  const kpis = [
    {
      label: "Active Clients",
      value: isLoading ? null : data?.activeClients,
      icon: <Users className="h-4 w-4 text-muted-foreground" />,
      testId: "kpi-active-clients",
    },
    {
      label: "Technicians",
      value: isLoading ? null : data?.techCount,
      icon: <UserCheck className="h-4 w-4 text-muted-foreground" />,
      testId: "kpi-tech-count",
    },
    {
      label: "Routes",
      value: isLoading ? null : `${data?.routeCount ?? 0} (avg ${data?.avgStopsPerRoute ?? 0} stops)`,
      icon: <Route className="h-4 w-4 text-muted-foreground" />,
      testId: "kpi-routes",
    },
    {
      label: "Avg Visit",
      value: isLoading ? null : (data?.avgVisitMinutes ? `${data.avgVisitMinutes} min` : "—"),
      icon: <Clock className="h-4 w-4 text-muted-foreground" />,
      testId: "kpi-avg-visit",
    },
    {
      label: "Res / Com",
      value: isLoading
        ? null
        : `${data?.residentialCount ?? 0} / ${data?.commercialCount ?? 0}`,
      icon: <BarChart3 className="h-4 w-4 text-muted-foreground" />,
      testId: "kpi-res-com",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      {kpis.map((kpi) => (
        <Card key={kpi.label} className="shadow-none border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {kpi.label}
            </CardTitle>
            {kpi.icon}
          </CardHeader>
          <CardContent className="pb-3 px-4">
            {isLoading ? (
              <Skeleton className="h-6 w-20" />
            ) : (
              <div className="text-xl font-bold" data-testid={kpi.testId}>
                {kpi.value}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Finance Tab ──────────────────────────────────────────────────────────────

const periodOptions = [
  { value: "3m", label: "Last 3 Months" },
  { value: "6m", label: "Last 6 Months" },
  { value: "12m", label: "Last 12 Months" },
  { value: "q1", label: "Q1 (Jan-Mar)" },
  { value: "q2", label: "Q2 (Apr-Jun)" },
  { value: "q3", label: "Q3 (Jul-Sep)" },
  { value: "q4", label: "Q4 (Oct-Dec)" },
  { value: "annual", label: "Full Year" },
];

function FinanceTab() {
  const [period, setPeriod] = useState("6m");

  const { data: summary, isLoading: summaryLoading } = useQuery<ReportData>({
    queryKey: [`/api/reports/summary?period=${period}`],
  });

  const { data: openBalance, isLoading: obLoading } = useQuery<OpenBalanceRow[]>({
    queryKey: ["/api/reports/open-balance"],
  });

  const handleObCsv = useCallback(() => {
    if (!openBalance) return;
    exportCsv(
      "open-balance.csv",
      ["Contact", "Current", "1-30 Days", "31-60 Days", "60+ Days", "Total", "Oldest Invoice"],
      openBalance.map((r) => [
        r.contactName,
        r.current,
        r.days30,
        r.days60,
        r.days90plus,
        r.total,
        r.oldestInvoiceDate ?? "",
      ])
    );
  }, [openBalance]);

  const handleObPrint = useCallback(() => {
    if (!openBalance) return;
    printTable(
      "Open Balance Report",
      ["Contact", "Current", "1-30 Days", "31-60 Days", "60+ Days", "Total"],
      openBalance.map((r) => [
        r.contactName,
        fmt(r.current),
        fmt(r.days30),
        fmt(r.days60),
        fmt(r.days90plus),
        fmt(r.total),
      ])
    );
  }, [openBalance]);

  const handleRevenueCsv = useCallback(() => {
    if (!summary) return;
    exportCsv(
      "revenue-by-period.csv",
      ["Month", "Revenue", "Projected"],
      summary.monthlyRevenue.map((r) => [r.month, r.revenue, r.projected ? "Yes" : "No"])
    );
  }, [summary]);

  const totalCollected = summary?.totalCollected ?? 0;
  const totalOutstanding = summary?.totalOutstanding ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {summary?.periodLabel || "Financial performance overview"}
        </p>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[180px]" data-testid="select-finance-period">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            {periodOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Collected", value: fmt(totalCollected), icon: <DollarSign className="h-4 w-4 text-muted-foreground" />, testId: "text-total-collected" },
          { label: "Outstanding", value: fmt(totalOutstanding), icon: <FileText className="h-4 w-4 text-muted-foreground" />, testId: "text-total-outstanding" },
          { label: "Booked This Month", value: fmt(summary?.bookedRevenue), icon: <TrendingUp className="h-4 w-4 text-muted-foreground" />, testId: "text-booked-revenue" },
          { label: "Total Contacts", value: String(summary?.totalContacts ?? 0), icon: <Users className="h-4 w-4 text-muted-foreground" />, testId: "text-total-contacts" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{kpi.label}</CardTitle>
              {kpi.icon}
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-2xl font-bold" data-testid={kpi.testId}>
                  {kpi.value}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Revenue Chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Revenue by Period</CardTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRevenueCsv}
              data-testid="button-revenue-csv"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              CSV
            </Button>
          </div>
          <CardDescription>{summary?.periodLabel}</CardDescription>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={220} data-testid="chart-monthly-revenue">
              <BarChart data={summary?.monthlyRevenue ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => [`$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, "Revenue"]} />
                <Bar dataKey="revenue" fill="#2d8a5e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Open Balance */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Open Balance (Aging)</CardTitle>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleObCsv}
                disabled={!openBalance?.length}
                data-testid="button-open-balance-csv"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleObPrint}
                disabled={!openBalance?.length}
                data-testid="button-open-balance-print"
              >
                <Printer className="h-3.5 w-3.5 mr-1.5" />
                PDF
              </Button>
            </div>
          </div>
          <CardDescription>Unpaid invoices grouped by aging bucket</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {obLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !openBalance?.length ? (
            <p className="text-sm text-muted-foreground p-4">No outstanding balances.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-open-balance">
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">1-30 Days</TableHead>
                    <TableHead className="text-right">31-60 Days</TableHead>
                    <TableHead className="text-right">60+ Days</TableHead>
                    <TableHead className="text-right font-bold">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openBalance.map((row) => (
                    <TableRow key={row.contactId} data-testid={`row-ob-${row.contactId}`}>
                      <TableCell className="font-medium">{row.contactName}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmt(row.current)}</TableCell>
                      <TableCell className={`text-right ${row.days30 > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                        {fmt(row.days30)}
                      </TableCell>
                      <TableCell className={`text-right ${row.days60 > 0 ? "text-orange-600" : "text-muted-foreground"}`}>
                        {fmt(row.days60)}
                      </TableCell>
                      <TableCell className={`text-right ${row.days90plus > 0 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                        {fmt(row.days90plus)}
                      </TableCell>
                      <TableCell className="text-right font-bold">{fmt(row.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {openBalance && openBalance.length > 0 && (
            <div className="flex justify-end px-4 py-3 border-t bg-muted/30 text-sm font-semibold">
              Total Outstanding:{" "}
              {fmt(openBalance.reduce((s, r) => s + Number(r.total), 0))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Visits summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">This Month's Visits</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="space-y-4" data-testid="chart-visits">
                <div className="text-3xl font-bold">{summary?.thisMonthVisits.total ?? 0}</div>
                <div className="space-y-2">
                  {[
                    { label: "Completed", value: summary?.thisMonthVisits.completed ?? 0 },
                    { label: "Scheduled", value: summary?.thisMonthVisits.scheduled ?? 0 },
                    { label: "Skipped", value: summary?.thisMonthVisits.skipped ?? 0 },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">{item.label}</span>
                      <Badge variant="secondary">{item.value}</Badge>
                    </div>
                  ))}
                  <Progress
                    value={
                      summary?.thisMonthVisits.total
                        ? (summary.thisMonthVisits.completed / summary.thisMonthVisits.total) * 100
                        : 0
                    }
                    className="h-2 mt-2"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Invoices by Status</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="space-y-2" data-testid="chart-invoices-status">
                {Object.entries(summary?.invoicesByStatus ?? {}).map(([status, cnt]) => (
                  <div key={status} className="flex items-center justify-between gap-2">
                    <span className="text-sm capitalize">{status}</span>
                    <div className="flex items-center gap-2">
                      <Progress
                        value={summary?.totalInvoices ? (cnt / summary.totalInvoices) * 100 : 0}
                        className="h-2 w-24"
                      />
                      <Badge variant="secondary">{cnt}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Operations Tab ───────────────────────────────────────────────────────────

function OperationsTab() {
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split("T")[0];
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [appliedStart, setAppliedStart] = useState(thirtyDaysAgo);
  const [appliedEnd, setAppliedEnd] = useState(today);

  const { data: jobs, isLoading } = useQuery<JobRow[]>({
    queryKey: [`/api/reports/jobs?startDate=${appliedStart}&endDate=${appliedEnd}`],
  });

  const apply = () => {
    setAppliedStart(startDate);
    setAppliedEnd(endDate);
  };

  const handleCsv = useCallback(() => {
    if (!jobs) return;
    exportCsv(
      "jobs-report.csv",
      ["Date", "Contact", "Route", "Technician", "Status", "Duration (min)"],
      jobs.map((r) => [
        r.date,
        r.contactName,
        r.routeName ?? "",
        r.techName ?? "",
        r.status,
        r.durationMinutes != null ? Math.round(r.durationMinutes) : "",
      ])
    );
  }, [jobs]);

  const handlePrint = useCallback(() => {
    if (!jobs) return;
    printTable(
      `Jobs Report (${appliedStart} to ${appliedEnd})`,
      ["Date", "Contact", "Route", "Technician", "Status", "Duration"],
      jobs.map((r) => [
        r.date,
        r.contactName,
        r.routeName ?? "—",
        r.techName ?? "—",
        r.status,
        r.durationMinutes != null ? `${Math.round(r.durationMinutes)} min` : "—",
      ])
    );
  }, [jobs, appliedStart, appliedEnd]);

  const completed = jobs?.filter((j) => j.status === "completed").length ?? 0;
  const total = jobs?.length ?? 0;
  const avgDuration = jobs
    ? (() => {
        const timed = jobs.filter((j) => j.durationMinutes != null);
        if (!timed.length) return null;
        return Math.round(timed.reduce((s, j) => s + j.durationMinutes!, 0) / timed.length);
      })()
    : null;

  return (
    <div className="space-y-6">
      {/* Date range picker */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Date Range</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label htmlFor="ops-start" className="text-xs">From</Label>
              <Input
                id="ops-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-40"
                data-testid="input-ops-start"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ops-end" className="text-xs">To</Label>
              <Input
                id="ops-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-40"
                data-testid="input-ops-end"
              />
            </div>
            <Button onClick={apply} data-testid="button-ops-apply">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Apply
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-3">
        <div className="rounded-lg border px-4 py-2 bg-card">
          <p className="text-xs text-muted-foreground">Total Visits</p>
          <p className="text-xl font-bold" data-testid="ops-total-visits">{total}</p>
        </div>
        <div className="rounded-lg border px-4 py-2 bg-card">
          <p className="text-xs text-muted-foreground">Completed</p>
          <p className="text-xl font-bold text-primary" data-testid="ops-completed">{completed}</p>
        </div>
        <div className="rounded-lg border px-4 py-2 bg-card">
          <p className="text-xs text-muted-foreground">Completion Rate</p>
          <p className="text-xl font-bold" data-testid="ops-completion-rate">
            {total > 0 ? `${Math.round((completed / total) * 100)}%` : "—"}
          </p>
        </div>
        <div className="rounded-lg border px-4 py-2 bg-card">
          <p className="text-xs text-muted-foreground">Avg Duration</p>
          <p className="text-xl font-bold" data-testid="ops-avg-duration">
            {avgDuration != null ? `${avgDuration} min` : "—"}
          </p>
        </div>
      </div>

      {/* Jobs Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Visit Log</CardTitle>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCsv}
                disabled={!jobs?.length}
                data-testid="button-jobs-csv"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrint}
                disabled={!jobs?.length}
                data-testid="button-jobs-print"
              >
                <Printer className="h-3.5 w-3.5 mr-1.5" />
                PDF
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !jobs?.length ? (
            <p className="text-sm text-muted-foreground p-4">No visits found for this date range.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-jobs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Technician</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.slice(0, 200).map((row) => (
                    <TableRow key={row.visitId} data-testid={`row-job-${row.visitId}`}>
                      <TableCell className="text-muted-foreground text-sm">{row.date}</TableCell>
                      <TableCell className="font-medium">{row.contactName}</TableCell>
                      <TableCell className="text-muted-foreground">{row.routeName ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{row.techName ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.status === "completed"
                              ? "default"
                              : row.status === "skipped"
                              ? "destructive"
                              : "secondary"
                          }
                          className="capitalize"
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {row.durationMinutes != null ? `${Math.round(row.durationMinutes)} min` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {jobs.length > 200 && (
                <p className="text-xs text-muted-foreground px-4 py-2 border-t">
                  Showing 200 of {jobs.length} records. Export to CSV for full data.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Customers Tab ────────────────────────────────────────────────────────────

function CustomersTab() {
  const [months, setMonths] = useState("12");

  const { data: metrics, isLoading: metricsLoading } = useQuery<ClientMetrics>({
    queryKey: [`/api/reports/client-metrics?months=${months}`],
  });

  const { data: crossSell, isLoading: csLoading } = useQuery<CrossSellRow[]>({
    queryKey: ["/api/reports/cross-sell"],
  });

  const handleCsCsv = useCallback(() => {
    if (!crossSell) return;
    exportCsv(
      "cross-sell.csv",
      ["Contact", "Upgrade Type", "Detail", "Est. Monthly Value"],
      crossSell.map((r) => [r.contactName, r.upgradeType, r.detail, r.monthlyValue])
    );
  }, [crossSell]);

  const handleCsPrint = useCallback(() => {
    if (!crossSell) return;
    printTable(
      "Cross-sell Opportunities",
      ["Contact", "Upgrade Type", "Detail", "Est. Monthly Value"],
      crossSell.map((r) => [r.contactName, r.upgradeType, r.detail, fmt(r.monthlyValue)])
    );
  }, [crossSell]);

  const handleLeadCsv = useCallback(() => {
    if (!metrics?.leadSources) return;
    exportCsv(
      "lead-sources.csv",
      ["Source", "Count"],
      metrics.leadSources.map((r) => [r.source, r.count])
    );
  }, [metrics]);

  const formattedMonthly = (metrics?.monthly ?? []).map((m) => ({
    ...m,
    label: m.month.slice(0, 7),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {metrics
              ? `${metrics.activeCount} active clients — avg monthly value $${metrics.avgClientValue.toFixed(2)}`
              : "Client acquisition and retention trends"}
          </p>
        </div>
        <Select value={months} onValueChange={setMonths}>
          <SelectTrigger className="w-[160px]" data-testid="select-customer-period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3">Last 3 Months</SelectItem>
            <SelectItem value="6">Last 6 Months</SelectItem>
            <SelectItem value="12">Last 12 Months</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI summary chips */}
      <div className="flex flex-wrap gap-3">
        {metricsLoading ? (
          [1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-32 rounded-lg" />)
        ) : (
          <>
            <div className="rounded-lg border px-4 py-2 bg-card">
              <p className="text-xs text-muted-foreground">Active Clients</p>
              <p className="text-xl font-bold text-primary" data-testid="cust-active">{metrics?.activeCount ?? 0}</p>
            </div>
            <div className="rounded-lg border px-4 py-2 bg-card">
              <p className="text-xs text-muted-foreground">Avg Monthly Value</p>
              <p className="text-xl font-bold" data-testid="cust-avg-value">{fmt(metrics?.avgClientValue)}</p>
            </div>
            <div className="rounded-lg border px-4 py-2 bg-card">
              <p className="text-xs text-muted-foreground">New (period)</p>
              <p className="text-xl font-bold" data-testid="cust-new">
                {metrics?.monthly.reduce((s, m) => s + m.newClients, 0) ?? 0}
              </p>
            </div>
            <div className="rounded-lg border px-4 py-2 bg-card">
              <p className="text-xs text-muted-foreground">Cancelled (period)</p>
              <p className="text-xl font-bold text-destructive" data-testid="cust-cancelled">
                {metrics?.monthly.reduce((s, m) => s + m.cancelledClients, 0) ?? 0}
              </p>
            </div>
          </>
        )}
      </div>

      {/* New vs Lost chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">New vs Lost Clients</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {metricsLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : !formattedMonthly.length ? (
            <p className="text-sm text-muted-foreground">No data available.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220} data-testid="chart-new-vs-lost">
              <BarChart data={formattedMonthly} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="newClients" name="New" fill="#2d8a5e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="cancelledClients" name="Cancelled" fill="#c9a882" radius={[3, 3, 0, 0]} />
                <Line
                  type="monotone"
                  dataKey="netClients"
                  name="Net"
                  stroke="#4fb483"
                  strokeWidth={2}
                  dot={false}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lead Sources */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">Lead Sources</CardTitle>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLeadCsv}
                disabled={!metrics?.leadSources?.length}
                data-testid="button-lead-csv"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : !metrics?.leadSources?.length ? (
              <p className="text-sm text-muted-foreground">No lead source data.</p>
            ) : (
              <ResponsiveContainer width="100%" height={180} data-testid="chart-lead-sources">
                <PieChart>
                  <Pie
                    data={metrics.leadSources}
                    dataKey="count"
                    nameKey="source"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    label={({ source, percent }) =>
                      `${source} ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {metrics.leadSources.map((_, idx) => (
                      <Cell
                        key={idx}
                        fill={CHART_COLORS[idx % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [v, "Clients"]} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Contacts by Status */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Client Status Breakdown</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <div className="space-y-2" data-testid="chart-contacts-status">
                {[
                  { key: "active", label: "Active" },
                  { key: "lead", label: "Lead" },
                  { key: "paused", label: "Paused" },
                  { key: "cancelled", label: "Cancelled" },
                ].map(({ key, label }) => {
                  const count =
                    (metrics?.monthly ?? []).reduce(
                      (s, m) => (key === "active" ? s + m.newClients : s),
                      0
                    ) ?? 0;
                  const pct = key === "active" ? 100 : 0;
                  return (
                    <div key={key} className="flex items-center justify-between gap-2">
                      <span className="text-sm">{label}</span>
                      <div className="flex items-center gap-2">
                        <Progress value={pct} className="h-2 w-20" />
                        <Badge variant="secondary">
                          {key === "active" ? metrics?.activeCount ?? 0 : count}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cross-sell list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Cross-sell Fulfilled</CardTitle>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCsCsv}
                disabled={!crossSell?.length}
                data-testid="button-crosssell-csv"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCsPrint}
                disabled={!crossSell?.length}
                data-testid="button-crosssell-print"
              >
                <Printer className="h-3.5 w-3.5 mr-1.5" />
                PDF
              </Button>
            </div>
          </div>
          <CardDescription>
            Clients on premium or multi-service plans — your highest-value accounts
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {csLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !crossSell?.length ? (
            <p className="text-sm text-muted-foreground p-4">No cross-sell data available.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-crosssell">
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead className="text-right">Est. Monthly</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {crossSell.slice(0, 100).map((row) => (
                    <TableRow key={row.contactId} data-testid={`row-cs-${row.contactId}`}>
                      <TableCell className="font-medium">{row.contactName}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{row.upgradeType}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{row.detail}</TableCell>
                      <TableCell className="text-right font-medium text-primary">
                        {fmt(row.monthlyValue)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Scheduled Tab ────────────────────────────────────────────────────────────

const FREQ_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

function ScheduledTab() {
  const { toast } = useToast();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ScheduledReport | null>(null);

  const { data: reports, isLoading } = useQuery<ScheduledReport[]>({
    queryKey: ["/api/scheduled-reports"],
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<ScheduledReport>) =>
      apiRequest("POST", "/api/scheduled-reports", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-reports"] });
      setBuilderOpen(false);
      setEditTarget(null);
      toast({ title: "Scheduled report saved" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ScheduledReport> }) =>
      apiRequest("PUT", `/api/scheduled-reports/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-reports"] });
      setBuilderOpen(false);
      setEditTarget(null);
      toast({ title: "Scheduled report updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/scheduled-reports/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-reports"] });
      toast({ title: "Report deleted" });
    },
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/scheduled-reports/${id}/run`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-reports"] });
      toast({ title: "Report marked as run" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Save reports to run automatically on a schedule and deliver via email.
        </p>
        <Button
          onClick={() => {
            setEditTarget(null);
            setBuilderOpen(true);
          }}
          data-testid="button-new-scheduled-report"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          New Report
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : !reports?.length ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No scheduled reports yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create a report to send automatically on a schedule.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <Card key={report.id} data-testid={`card-scheduled-report-${report.id}`}>
              <CardContent className="py-4 px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{report.name}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {FREQ_LABELS[report.frequency] ?? report.frequency}
                      {report.frequency === "weekly" && report.dayOfWeek != null
                        ? ` on ${DAY_NAMES[report.dayOfWeek]}`
                        : ""}
                      {report.frequency === "monthly" && report.dayOfMonth != null
                        ? ` on day ${report.dayOfMonth}`
                        : ""}
                      {" — "}
                      {report.recipients.join(", ") || "No recipients"}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {report.sections.map((s) => {
                        const opt = SECTION_OPTIONS.find((o) => o.key === s);
                        return (
                          <Badge key={s} variant="secondary" className="text-xs">
                            {opt?.label ?? s}
                          </Badge>
                        );
                      })}
                    </div>
                    {report.lastSentAt && (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Last run: {new Date(report.lastSentAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => runMutation.mutate(report.id)}
                      disabled={runMutation.isPending}
                      title="Run now"
                      data-testid={`button-run-report-${report.id}`}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditTarget(report);
                        setBuilderOpen(true);
                      }}
                      title="Edit"
                      data-testid={`button-edit-report-${report.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => deleteMutation.mutate(report.id)}
                      disabled={deleteMutation.isPending}
                      title="Delete"
                      data-testid={`button-delete-report-${report.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Builder Dialog */}
      <ReportBuilderDialog
        open={builderOpen}
        onOpenChange={(open) => {
          setBuilderOpen(open);
          if (!open) setEditTarget(null);
        }}
        initial={editTarget}
        onSave={(data) => {
          if (editTarget) {
            updateMutation.mutate({ id: editTarget.id, data });
          } else {
            createMutation.mutate(data);
          }
        }}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}

function ReportBuilderDialog({
  open,
  onOpenChange,
  initial,
  onSave,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ScheduledReport | null;
  onSave: (data: Partial<ScheduledReport>) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [sections, setSections] = useState<string[]>(initial?.sections ?? []);
  const [frequency, setFrequency] = useState(initial?.frequency ?? "weekly");
  const [dayOfWeek, setDayOfWeek] = useState<number>(initial?.dayOfWeek ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState<number>(initial?.dayOfMonth ?? 1);
  const [sendHour, setSendHour] = useState<number>(initial?.sendHour ?? 7);
  const [recipientsStr, setRecipientsStr] = useState(
    initial?.recipients.join(", ") ?? ""
  );

  // Reset form when initial changes
  const resetForm = useCallback(() => {
    setName(initial?.name ?? "");
    setSections(initial?.sections ?? []);
    setFrequency(initial?.frequency ?? "weekly");
    setDayOfWeek(initial?.dayOfWeek ?? 1);
    setDayOfMonth(initial?.dayOfMonth ?? 1);
    setSendHour(initial?.sendHour ?? 7);
    setRecipientsStr(initial?.recipients.join(", ") ?? "");
  }, [initial]);

  const handleSave = () => {
    const recipients = recipientsStr
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    onSave({
      name: name.trim(),
      sections,
      frequency,
      dayOfWeek: frequency === "weekly" ? dayOfWeek : null,
      dayOfMonth: frequency === "monthly" ? dayOfMonth : null,
      sendHour,
      recipients,
    });
  };

  const toggleSection = (key: string) => {
    setSections((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Scheduled Report" : "New Scheduled Report"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="sr-name">Report Name</Label>
            <Input
              id="sr-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Weekly Finance Summary"
              data-testid="input-report-name"
            />
          </div>

          <div className="space-y-2">
            <Label>Sections to Include</Label>
            <div className="grid grid-cols-1 gap-2">
              {SECTION_OPTIONS.map((opt) => (
                <label
                  key={opt.key}
                  className="flex items-center gap-2.5 cursor-pointer"
                  data-testid={`checkbox-section-${opt.key}`}
                >
                  <Checkbox
                    checked={sections.includes(opt.key)}
                    onCheckedChange={() => toggleSection(opt.key)}
                  />
                  <span className="text-sm">{opt.label}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{opt.tab}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger data-testid="select-frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {frequency === "weekly" && (
            <div className="space-y-1.5">
              <Label>Day of Week</Label>
              <Select
                value={String(dayOfWeek)}
                onValueChange={(v) => setDayOfWeek(parseInt(v))}
              >
                <SelectTrigger data-testid="select-day-of-week">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_NAMES.map((day, idx) => (
                    <SelectItem key={idx} value={String(idx)}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {frequency === "monthly" && (
            <div className="space-y-1.5">
              <Label>Day of Month</Label>
              <Select
                value={String(dayOfMonth)}
                onValueChange={(v) => setDayOfMonth(parseInt(v))}
              >
                <SelectTrigger data-testid="select-day-of-month">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Send Hour (24h)</Label>
            <Select
              value={String(sendHour)}
              onValueChange={(v) => setSendHour(parseInt(v))}
            >
              <SelectTrigger data-testid="select-send-hour">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {h === 0
                      ? "12:00 AM"
                      : h < 12
                      ? `${h}:00 AM`
                      : h === 12
                      ? "12:00 PM"
                      : `${h - 12}:00 PM`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sr-recipients">Recipients (comma-separated emails)</Label>
            <Input
              id="sr-recipients"
              value={recipientsStr}
              onChange={(e) => setRecipientsStr(e.target.value)}
              placeholder="owner@company.com, manager@company.com"
              data-testid="input-recipients"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !name.trim() || sections.length === 0}
            data-testid="button-save-report"
          >
            {isSaving ? "Saving..." : "Save Report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Root Component ───────────────────────────────────────────────────────────

export default function Reports() {
  const [tab, setTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    if (["finance", "operations", "customers", "scheduled", "analytics"].includes(t ?? ""))
      return t!;
    return "finance";
  });

  return (
    <div className="p-4 md:p-6 overflow-auto h-full">
      <div className="mb-5">
        <h1 className="text-2xl font-bold" data-testid="text-reports-heading">
          Reports
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Financial, operational, and customer analytics for your business
        </p>
      </div>

      <KpiStrip />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-5 flex-wrap h-auto gap-1">
          <TabsTrigger value="finance" data-testid="tab-finance">
            <DollarSign className="mr-1.5 h-4 w-4" />
            Finance
          </TabsTrigger>
          <TabsTrigger value="operations" data-testid="tab-operations">
            <CalendarCheck className="mr-1.5 h-4 w-4" />
            Operations
          </TabsTrigger>
          <TabsTrigger value="customers" data-testid="tab-customers">
            <Users className="mr-1.5 h-4 w-4" />
            Customers
          </TabsTrigger>
          <TabsTrigger value="scheduled" data-testid="tab-scheduled">
            <Clock className="mr-1.5 h-4 w-4" />
            Scheduled
          </TabsTrigger>
          <TabsTrigger value="analytics" data-testid="tab-analytics">
            <BarChart3 className="mr-1.5 h-4 w-4" />
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="finance">
          <FinanceTab />
        </TabsContent>

        <TabsContent value="operations">
          <OperationsTab />
        </TabsContent>

        <TabsContent value="customers">
          <CustomersTab />
        </TabsContent>

        <TabsContent value="scheduled">
          <ScheduledTab />
        </TabsContent>

        <TabsContent value="analytics" className="-m-4 md:-m-6">
          <Analytics />
        </TabsContent>
      </Tabs>
    </div>
  );
}
