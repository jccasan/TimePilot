import { useState, useCallback, useEffect, useRef } from "react";
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
  Plus,
  Trash2,
  Play,
  Pencil,
  RefreshCw,
  Clock,
  Route,
  UserCheck,
  Activity,
} from "lucide-react";
import Analytics from "@/pages/analytics";
import { useToast } from "@/hooks/use-toast";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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

type RouteSummaryRow = {
  routeId: string;
  routeName: string;
  techName: string | null;
  totalVisits: number;
  completed: number;
  skipped: number;
  completionRate: number;
  avgVisitMinutes: number;
  activeStops: number;
};

type TechPerformanceRow = {
  userId: string;
  techName: string;
  totalVisits: number;
  completed: number;
  completionRate: number;
  avgMinutesPerStop: number;
  routeCount: number;
};

type RevenueByFrequencyRow = {
  frequency: string;
  planCount: number;
  totalPricePerVisit: number;
  estimatedMonthlyRevenue: number;
};

type ClientMetrics = {
  monthly: { month: string; newClients: number; cancelledClients: number; netClients: number }[];
  leadSources: { source: string; count: number }[];
  cancellationReasons: { reason: string; count: number }[];
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
  { key: "revenue_by_frequency", label: "Revenue by Frequency", tab: "Finance" },
  { key: "jobs", label: "Completed Jobs", tab: "Operations" },
  { key: "route_summary", label: "Route Summary", tab: "Operations" },
  { key: "tech_performance", label: "Technician Performance", tab: "Operations" },
  { key: "active_clients", label: "Active Clients Trend", tab: "Customers" },
  { key: "new_vs_lost", label: "New vs Lost Clients", tab: "Customers" },
  { key: "lead_sources", label: "Lead Sources", tab: "Customers" },
  { key: "cancellation_reasons", label: "Cancellation Reasons", tab: "Customers" },
  { key: "cross_sell", label: "Cross-sell Opportunities", tab: "Customers" },
];

const CHART_COLORS = ["#2d8a5e", "#4fb483", "#8dc5a8", "#b8ddc9", "#a0785e", "#c9a882", "#e5f4ed"];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const PERIOD_OPTIONS = [
  { value: "3m", label: "Last 3 Months" },
  { value: "6m", label: "Last 6 Months" },
  { value: "12m", label: "Last 12 Months" },
  { value: "q1", label: "Q1 (Jan-Mar)" },
  { value: "q2", label: "Q2 (Apr-Jun)" },
  { value: "q3", label: "Q3 (Jul-Sep)" },
  { value: "q4", label: "Q4 (Oct-Dec)" },
  { value: "annual", label: "Full Year" },
];

const MONTHS_OPTIONS = [
  { value: "3", label: "Last 3 Months" },
  { value: "6", label: "Last 6 Months" },
  { value: "12", label: "Last 12 Months" },
];

// ─── Export Utilities ─────────────────────────────────────────────────────────

function exportCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
) {
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

function exportPdf(
  title: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
  subtitle?: string
) {
  const doc = new jsPDF({ orientation: "landscape" });
  const GREEN: [number, number, number] = [45, 138, 94];
  const GRAY: [number, number, number] = [107, 114, 128];

  // Header block
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, doc.internal.pageSize.width, 22, "F");
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text(title, 14, 13);
  if (subtitle) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(subtitle, 14, 20);
  }

  // Generated date
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(`Generated ${new Date().toLocaleDateString()}`, 14, 28);

  autoTable(doc, {
    startY: 32,
    head: [headers],
    body: rows.map((r) => r.map((c) => String(c ?? ""))),
    headStyles: {
      fillColor: GREEN,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8, textColor: [30, 30, 30] },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    margin: { left: 14, right: 14 },
  });

  doc.save(`${title.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}.pdf`);
}

async function exportChartPdf(
  title: string,
  chartRef: React.RefObject<HTMLDivElement>,
  headers: string[],
  rows: (string | number | null | undefined)[][]
) {
  const { default: html2canvas } = await import("html2canvas");
  const doc = new jsPDF({ orientation: "landscape" });
  const GREEN: [number, number, number] = [45, 138, 94];
  const GRAY: [number, number, number] = [107, 114, 128];

  doc.setFillColor(...GREEN);
  doc.rect(0, 0, doc.internal.pageSize.width, 22, "F");
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text(title, 14, 13);
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.setFont("helvetica", "normal");
  doc.text(`Generated ${new Date().toLocaleDateString()}`, 14, 28);

  let startY = 32;

  // Embed chart as image if ref provided
  if (chartRef.current) {
    try {
      const canvas = await html2canvas(chartRef.current, { scale: 1.5, useCORS: true });
      const imgData = canvas.toDataURL("image/png");
      const pw = doc.internal.pageSize.width - 28;
      const ratio = canvas.height / canvas.width;
      const ih = Math.min(pw * ratio, 80);
      doc.addImage(imgData, "PNG", 14, startY, pw, ih);
      startY += ih + 6;
    } catch {
      // silently skip chart embed on error
    }
  }

  autoTable(doc, {
    startY,
    head: [headers],
    body: rows.map((r) => r.map((c) => String(c ?? ""))),
    headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    margin: { left: 14, right: 14 },
  });

  doc.save(`${title.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}.pdf`);
}

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Shared Period Selector ───────────────────────────────────────────────────

function PeriodSelector({
  value,
  onChange,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  testId?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[180px]" data-testid={testId ?? "select-period"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERIOD_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── KPI Strip ────────────────────────────────────────────────────────────────

function KpiStrip() {
  const { data, isLoading } = useQuery<KpiStrip>({ queryKey: ["/api/reports/kpi-strip"] });

  const avgPerTech =
    data && data.techCount > 0 ? Math.round((data.activeClients / data.techCount) * 10) / 10 : 0;

  const kpis = [
    {
      label: "Active Clients",
      value: isLoading ? null : data?.activeClients,
      icon: <Users className="h-4 w-4 text-muted-foreground" />,
      testId: "kpi-active-clients",
    },
    {
      label: "Clients / Tech",
      value: isLoading ? null : avgPerTech,
      icon: <UserCheck className="h-4 w-4 text-muted-foreground" />,
      testId: "kpi-clients-per-tech",
    },
    {
      label: "Routes / Stops",
      value: isLoading ? null : `${data?.routeCount ?? 0} / ${data?.avgStopsPerRoute ?? 0} avg`,
      icon: <Route className="h-4 w-4 text-muted-foreground" />,
      testId: "kpi-routes",
    },
    {
      label: "Avg Visit",
      value: isLoading ? null : data?.avgVisitMinutes ? `${data.avgVisitMinutes} min` : "—",
      icon: <Clock className="h-4 w-4 text-muted-foreground" />,
      testId: "kpi-avg-visit",
    },
    {
      label: "Res / Com",
      value: isLoading ? null : `${data?.residentialCount ?? 0} / ${data?.commercialCount ?? 0}`,
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

function FinanceTab({
  period,
  onPeriodChange,
}: {
  period: string;
  onPeriodChange: (v: string) => void;
}) {
  const { data: summary, isLoading: summaryLoading } = useQuery<ReportData>({
    queryKey: [`/api/reports/summary?period=${period}`],
  });

  const { data: openBalance, isLoading: obLoading } = useQuery<OpenBalanceRow[]>({
    queryKey: ["/api/reports/open-balance"],
  });

  const { data: revFreq, isLoading: rfLoading } = useQuery<RevenueByFrequencyRow[]>({
    queryKey: ["/api/reports/revenue-by-frequency"],
  });

  const revenueChartRef = useRef<HTMLDivElement>(null);
  const rfChartRef = useRef<HTMLDivElement>(null);

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

  const handleObPdf = useCallback(() => {
    if (!openBalance) return;
    exportPdf(
      "Open Balance Report",
      ["Contact", "Current", "1-30 Days", "31-60 Days", "60+ Days", "Total"],
      openBalance.map((r) => [
        r.contactName,
        fmt(r.current),
        fmt(r.days30),
        fmt(r.days60),
        fmt(r.days90plus),
        fmt(r.total),
      ]),
      `Accounts receivable aging — ${new Date().toLocaleDateString()}`
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

  const handleRevenuePdf = useCallback(async () => {
    if (!summary) return;
    await exportChartPdf(
      "Revenue by Period",
      revenueChartRef,
      ["Month", "Revenue"],
      summary.monthlyRevenue.map((r) => [r.month, fmt(r.revenue)])
    );
  }, [summary]);

  const handleRfCsv = useCallback(() => {
    if (!revFreq) return;
    exportCsv(
      "revenue-by-frequency.csv",
      ["Frequency", "Plans", "Price/Visit", "Est. Monthly Revenue"],
      revFreq.map((r) => [
        r.frequency,
        r.planCount,
        r.totalPricePerVisit,
        r.estimatedMonthlyRevenue,
      ])
    );
  }, [revFreq]);

  const handleRfPdf = useCallback(async () => {
    if (!revFreq) return;
    await exportChartPdf(
      "Revenue by Service Frequency",
      rfChartRef,
      ["Frequency", "Plans", "Est. Monthly Revenue"],
      revFreq.map((r) => [r.frequency, r.planCount, fmt(r.estimatedMonthlyRevenue)])
    );
  }, [revFreq]);

  const totalCollected = summary?.totalCollected ?? 0;
  const totalOutstanding = summary?.totalOutstanding ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {summary?.periodLabel || "Financial performance overview"}
        </p>
        <PeriodSelector value={period} onChange={onPeriodChange} testId="select-finance-period" />
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Total Collected",
            value: fmt(totalCollected),
            icon: <DollarSign className="h-4 w-4 text-muted-foreground" />,
            testId: "text-total-collected",
          },
          {
            label: "Outstanding",
            value: fmt(totalOutstanding),
            icon: <FileText className="h-4 w-4 text-muted-foreground" />,
            testId: "text-total-outstanding",
          },
          {
            label: "Booked This Month",
            value: fmt(summary?.bookedRevenue),
            icon: <TrendingUp className="h-4 w-4 text-muted-foreground" />,
            testId: "text-booked-revenue",
          },
          {
            label: "Total Contacts",
            value: String(summary?.totalContacts ?? 0),
            icon: <Users className="h-4 w-4 text-muted-foreground" />,
            testId: "text-total-contacts",
          },
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
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRevenueCsv}
                data-testid="button-revenue-csv"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRevenuePdf}
                data-testid="button-revenue-pdf"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                PDF
              </Button>
            </div>
          </div>
          <CardDescription>{summary?.periodLabel}</CardDescription>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <div ref={revenueChartRef}>
              <ResponsiveContainer width="100%" height={220} data-testid="chart-monthly-revenue">
                <BarChart
                  data={summary?.monthlyRevenue ?? []}
                  margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(v: number) => [
                      `$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                      "Revenue",
                    ]}
                  />
                  <Bar dataKey="revenue" fill="#2d8a5e" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revenue by Service Frequency */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Revenue by Service Frequency</CardTitle>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRfCsv}
                disabled={!revFreq?.length}
                data-testid="button-rf-csv"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRfPdf}
                disabled={!revFreq?.length}
                data-testid="button-rf-pdf"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                PDF
              </Button>
            </div>
          </div>
          <CardDescription>Estimated monthly revenue split by billing frequency</CardDescription>
        </CardHeader>
        <CardContent>
          {rfLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : !revFreq?.length ? (
            <p className="text-sm text-muted-foreground">No active service plans.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div ref={rfChartRef}>
                <ResponsiveContainer width="100%" height={160} data-testid="chart-rev-frequency">
                  <BarChart data={revFreq} layout="vertical" margin={{ left: 8 }}>
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                    />
                    <YAxis type="category" dataKey="frequency" tick={{ fontSize: 11 }} width={70} />
                    <Tooltip
                      formatter={(v: number) => [
                        `$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                        "Est. Monthly",
                      ]}
                    />
                    <Bar dataKey="estimatedMonthlyRevenue" fill="#2d8a5e" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="overflow-x-auto">
                <Table data-testid="table-rev-frequency">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Frequency</TableHead>
                      <TableHead className="text-right">Plans</TableHead>
                      <TableHead className="text-right">Est. Monthly</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revFreq.map((r) => (
                      <TableRow key={r.frequency}>
                        <TableCell className="capitalize">{r.frequency}</TableCell>
                        <TableCell className="text-right">{r.planCount}</TableCell>
                        <TableCell className="text-right font-medium text-primary">
                          {fmt(r.estimatedMonthlyRevenue)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/30 font-bold">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right">
                        {revFreq.reduce((s, r) => s + Number(r.planCount), 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {fmt(revFreq.reduce((s, r) => s + Number(r.estimatedMonthlyRevenue), 0))}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
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
                onClick={handleObPdf}
                disabled={!openBalance?.length}
                data-testid="button-open-balance-pdf"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                PDF
              </Button>
            </div>
          </div>
          <CardDescription>
            Unpaid invoices net of partial payments, grouped by aging bucket
          </CardDescription>
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
                      <TableCell className="text-right text-muted-foreground">
                        {fmt(row.current)}
                      </TableCell>
                      <TableCell
                        className={`text-right ${Number(row.days30) > 0 ? "text-amber-600" : "text-muted-foreground"}`}
                      >
                        {fmt(row.days30)}
                      </TableCell>
                      <TableCell
                        className={`text-right ${Number(row.days60) > 0 ? "text-orange-600" : "text-muted-foreground"}`}
                      >
                        {fmt(row.days60)}
                      </TableCell>
                      <TableCell
                        className={`text-right ${Number(row.days90plus) > 0 ? "text-red-600 font-medium" : "text-muted-foreground"}`}
                      >
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
              Total Outstanding: {fmt(openBalance.reduce((s, r) => s + Number(r.total), 0))}
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

  const { data: jobs, isLoading: jobsLoading } = useQuery<JobRow[]>({
    queryKey: [`/api/reports/jobs?startDate=${appliedStart}&endDate=${appliedEnd}`],
  });

  const { data: routeSummary, isLoading: rsLoading } = useQuery<RouteSummaryRow[]>({
    queryKey: [`/api/reports/route-summary?startDate=${appliedStart}&endDate=${appliedEnd}`],
  });

  const { data: techPerf, isLoading: tpLoading } = useQuery<TechPerformanceRow[]>({
    queryKey: [`/api/reports/tech-performance?startDate=${appliedStart}&endDate=${appliedEnd}`],
  });

  const apply = () => {
    setAppliedStart(startDate);
    setAppliedEnd(endDate);
  };

  const handleJobsCsv = useCallback(() => {
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

  const handleJobsPdf = useCallback(() => {
    if (!jobs) return;
    exportPdf(
      "Jobs Report",
      ["Date", "Contact", "Route", "Tech", "Status", "Duration"],
      jobs.map((r) => [
        r.date,
        r.contactName,
        r.routeName ?? "—",
        r.techName ?? "—",
        r.status,
        r.durationMinutes != null ? `${Math.round(r.durationMinutes)} min` : "—",
      ]),
      `${appliedStart} to ${appliedEnd}`
    );
  }, [jobs, appliedStart, appliedEnd]);

  const handleRsCsv = useCallback(() => {
    if (!routeSummary) return;
    exportCsv(
      "route-summary.csv",
      [
        "Route",
        "Technician",
        "Active Stops",
        "Visits",
        "Completed",
        "Completion %",
        "Avg Duration (min)",
      ],
      routeSummary.map((r) => [
        r.routeName,
        r.techName ?? "",
        r.activeStops,
        r.totalVisits,
        r.completed,
        `${r.completionRate}%`,
        Math.round(r.avgVisitMinutes),
      ])
    );
  }, [routeSummary]);

  const handleRsPdf = useCallback(() => {
    if (!routeSummary) return;
    exportPdf(
      "Route Summary",
      ["Route", "Tech", "Stops", "Visits", "Completed", "%", "Avg Min"],
      routeSummary.map((r) => [
        r.routeName,
        r.techName ?? "—",
        r.activeStops,
        r.totalVisits,
        r.completed,
        `${r.completionRate}%`,
        Math.round(r.avgVisitMinutes),
      ]),
      `${appliedStart} to ${appliedEnd}`
    );
  }, [routeSummary, appliedStart, appliedEnd]);

  const handleTpCsv = useCallback(() => {
    if (!techPerf) return;
    exportCsv(
      "tech-performance.csv",
      ["Technician", "Routes", "Visits", "Completed", "Completion %", "Avg Min/Stop"],
      techPerf.map((r) => [
        r.techName,
        r.routeCount,
        r.totalVisits,
        r.completed,
        `${r.completionRate}%`,
        r.avgMinutesPerStop,
      ])
    );
  }, [techPerf]);

  const handleTpPdf = useCallback(() => {
    if (!techPerf) return;
    exportPdf(
      "Technician Performance",
      ["Technician", "Routes", "Visits", "Completed", "%", "Avg Min"],
      techPerf.map((r) => [
        r.techName,
        r.routeCount,
        r.totalVisits,
        r.completed,
        `${r.completionRate}%`,
        r.avgMinutesPerStop,
      ]),
      `${appliedStart} to ${appliedEnd}`
    );
  }, [techPerf, appliedStart, appliedEnd]);

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
              <Label htmlFor="ops-start" className="text-xs">
                From
              </Label>
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
              <Label htmlFor="ops-end" className="text-xs">
                To
              </Label>
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
        {[
          { label: "Total Visits", value: total, testId: "ops-total-visits" },
          { label: "Completed", value: completed, testId: "ops-completed", color: "text-primary" },
          {
            label: "Completion Rate",
            value: total > 0 ? `${Math.round((completed / total) * 100)}%` : "—",
            testId: "ops-completion-rate",
          },
          {
            label: "Avg Duration",
            value: avgDuration != null ? `${avgDuration} min` : "—",
            testId: "ops-avg-duration",
          },
        ].map((chip) => (
          <div key={chip.label} className="rounded-lg border px-4 py-2 bg-card">
            <p className="text-xs text-muted-foreground">{chip.label}</p>
            <p className={`text-xl font-bold ${chip.color ?? ""}`} data-testid={chip.testId}>
              {chip.value}
            </p>
          </div>
        ))}
      </div>

      {/* Visit Log */}
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
                onClick={handleJobsCsv}
                disabled={!jobs?.length}
                data-testid="button-jobs-csv"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleJobsPdf}
                disabled={!jobs?.length}
                data-testid="button-jobs-pdf"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                PDF
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {jobsLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !jobs?.length ? (
            <p className="text-sm text-muted-foreground p-4">
              No visits found for this date range.
            </p>
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
                      <TableCell className="text-muted-foreground">
                        {row.routeName ?? "—"}
                      </TableCell>
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
                        {row.durationMinutes != null
                          ? `${Math.round(row.durationMinutes)} min`
                          : "—"}
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

      {/* Route Summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Route className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Route Summary</CardTitle>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRsCsv}
                disabled={!routeSummary?.length}
                data-testid="button-rs-csv"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRsPdf}
                disabled={!routeSummary?.length}
                data-testid="button-rs-pdf"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                PDF
              </Button>
            </div>
          </div>
          <CardDescription>Stops, completion rate, and avg visit time by route</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rsLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !routeSummary?.length ? (
            <p className="text-sm text-muted-foreground p-4">No route data available.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-route-summary">
                <TableHeader>
                  <TableRow>
                    <TableHead>Route</TableHead>
                    <TableHead>Technician</TableHead>
                    <TableHead className="text-right">Active Stops</TableHead>
                    <TableHead className="text-right">Visits</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">Completion %</TableHead>
                    <TableHead className="text-right">Avg Min</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {routeSummary.map((r) => (
                    <TableRow key={r.routeId} data-testid={`row-rs-${r.routeId}`}>
                      <TableCell className="font-medium">{r.routeName}</TableCell>
                      <TableCell className="text-muted-foreground">{r.techName ?? "—"}</TableCell>
                      <TableCell className="text-right">{Number(r.activeStops)}</TableCell>
                      <TableCell className="text-right">{Number(r.totalVisits)}</TableCell>
                      <TableCell className="text-right">{Number(r.completed)}</TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            Number(r.completionRate) >= 90
                              ? "text-primary font-medium"
                              : Number(r.completionRate) >= 70
                                ? "text-amber-600"
                                : "text-red-600"
                          }
                        >
                          {r.completionRate != null ? `${r.completionRate}%` : "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(r.avgVisitMinutes) > 0
                          ? `${Math.round(Number(r.avgVisitMinutes))} min`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Technician Performance */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Technician Performance</CardTitle>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTpCsv}
                disabled={!techPerf?.length}
                data-testid="button-tp-csv"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTpPdf}
                disabled={!techPerf?.length}
                data-testid="button-tp-pdf"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                PDF
              </Button>
            </div>
          </div>
          <CardDescription>
            Jobs completed, completion rate, and average time on stop per technician
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {tpLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !techPerf?.length ? (
            <p className="text-sm text-muted-foreground p-4">No technician data available.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-tech-perf">
                <TableHeader>
                  <TableRow>
                    <TableHead>Technician</TableHead>
                    <TableHead className="text-right">Routes</TableHead>
                    <TableHead className="text-right">Visits</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">Completion %</TableHead>
                    <TableHead className="text-right">Avg Min/Stop</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {techPerf.map((r) => (
                    <TableRow key={r.userId} data-testid={`row-tp-${r.userId}`}>
                      <TableCell className="font-medium">{r.techName}</TableCell>
                      <TableCell className="text-right">{Number(r.routeCount)}</TableCell>
                      <TableCell className="text-right">{Number(r.totalVisits)}</TableCell>
                      <TableCell className="text-right">{Number(r.completed)}</TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            Number(r.completionRate) >= 90
                              ? "text-primary font-medium"
                              : "text-muted-foreground"
                          }
                        >
                          {r.completionRate != null ? `${r.completionRate}%` : "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(r.avgMinutesPerStop) > 0 ? `${r.avgMinutesPerStop} min` : "—"}
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

// ─── Customers Tab ────────────────────────────────────────────────────────────

function CustomersTab({
  months,
  onMonthsChange,
}: {
  months: string;
  onMonthsChange: (v: string) => void;
}) {
  const { data: metrics, isLoading: metricsLoading } = useQuery<ClientMetrics>({
    queryKey: [`/api/reports/client-metrics?months=${months}`],
  });

  const { data: crossSell, isLoading: csLoading } = useQuery<CrossSellRow[]>({
    queryKey: ["/api/reports/cross-sell"],
  });

  const newVsLostChartRef = useRef<HTMLDivElement>(null);

  const handleCsCsv = useCallback(() => {
    if (!crossSell) return;
    exportCsv(
      "cross-sell.csv",
      ["Contact", "Upgrade Type", "Detail", "Est. Monthly Value"],
      crossSell.map((r) => [r.contactName, r.upgradeType, r.detail, r.monthlyValue])
    );
  }, [crossSell]);

  const handleCsPdf = useCallback(() => {
    if (!crossSell) return;
    exportPdf(
      "Cross-sell Fulfilled",
      ["Contact", "Upgrade Type", "Detail", "Est. Monthly"],
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

  const handleCancelCsv = useCallback(() => {
    if (!metrics?.cancellationReasons) return;
    exportCsv(
      "cancellation-reasons.csv",
      ["Reason", "Count"],
      metrics.cancellationReasons.map((r) => [r.reason, r.count])
    );
  }, [metrics]);

  const handleNewVsLostPdf = useCallback(async () => {
    if (!metrics?.monthly) return;
    await exportChartPdf(
      "New vs Lost Clients",
      newVsLostChartRef,
      ["Month", "New", "Cancelled", "Net"],
      metrics.monthly.map((m) => [m.month, m.newClients, m.cancelledClients, m.netClients])
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
              ? `${metrics.activeCount} active clients — avg monthly value ${fmt(metrics.avgClientValue)}`
              : "Client acquisition and retention trends"}
          </p>
        </div>
        <Select value={months} onValueChange={onMonthsChange}>
          <SelectTrigger className="w-[160px]" data-testid="select-customer-period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPI summary chips */}
      <div className="flex flex-wrap gap-3">
        {metricsLoading ? (
          [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-32 rounded-lg" />)
        ) : (
          <>
            <div className="rounded-lg border px-4 py-2 bg-card">
              <p className="text-xs text-muted-foreground">Active Clients</p>
              <p className="text-xl font-bold text-primary" data-testid="cust-active">
                {metrics?.activeCount ?? 0}
              </p>
            </div>
            <div className="rounded-lg border px-4 py-2 bg-card">
              <p className="text-xs text-muted-foreground">Avg Monthly Value</p>
              <p className="text-xl font-bold" data-testid="cust-avg-value">
                {fmt(metrics?.avgClientValue)}
              </p>
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
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">New vs Lost Clients</CardTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewVsLostPdf}
              disabled={!metrics?.monthly.length}
              data-testid="button-newvlost-pdf"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {metricsLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : !formattedMonthly.length ? (
            <p className="text-sm text-muted-foreground">No data available.</p>
          ) : (
            <div ref={newVsLostChartRef}>
              <ResponsiveContainer width="100%" height={220} data-testid="chart-new-vs-lost">
                <BarChart data={formattedMonthly} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="newClients" name="New" fill="#2d8a5e" radius={[3, 3, 0, 0]} />
                  <Bar
                    dataKey="cancelledClients"
                    name="Cancelled"
                    fill="#c9a882"
                    radius={[3, 3, 0, 0]}
                  />
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
            </div>
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
                    label={({ source, percent }) => `${source} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {metrics.leadSources.map((_, idx) => (
                      <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [v, "Clients"]} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Cancellation Reasons */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">Cancellation Reasons</CardTitle>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancelCsv}
                disabled={!metrics?.cancellationReasons?.length}
                data-testid="button-cancel-csv"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </div>
            <CardDescription>Why clients cancelled in the selected period</CardDescription>
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : !metrics?.cancellationReasons?.length ? (
              <p className="text-sm text-muted-foreground">No cancellations in this period.</p>
            ) : (
              <div className="space-y-2" data-testid="chart-cancel-reasons">
                {metrics.cancellationReasons.map((r) => {
                  const total = metrics.cancellationReasons.reduce(
                    (s, x) => s + Number(x.count),
                    0
                  );
                  return (
                    <div key={r.reason} className="flex items-center justify-between gap-2">
                      <span className="text-sm truncate max-w-[60%]">{r.reason}</span>
                      <div className="flex items-center gap-2">
                        <Progress value={(Number(r.count) / total) * 100} className="h-2 w-20" />
                        <Badge variant="secondary">{Number(r.count)}</Badge>
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
                onClick={handleCsPdf}
                disabled={!crossSell?.length}
                data-testid="button-crosssell-pdf"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                PDF
              </Button>
            </div>
          </div>
          <CardDescription>
            Clients on premium or multi-service plans — highest-value accounts
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

// ─── Metrics Tab ──────────────────────────────────────────────────────────────

function MetricsTab() {
  const { data: kpi, isLoading } = useQuery<KpiStrip>({ queryKey: ["/api/reports/kpi-strip"] });

  const avgPerTech =
    kpi && kpi.techCount > 0 ? (kpi.activeClients / kpi.techCount).toFixed(1) : "—";
  const avgJobsPerRoute = kpi && kpi.routeCount > 0 ? kpi.avgStopsPerRoute : "—";
  const avgJobsPerHour =
    kpi && kpi.avgVisitMinutes > 0 ? (60 / kpi.avgVisitMinutes).toFixed(1) : "—";
  const commercialPct =
    kpi && kpi.residentialCount + kpi.commercialCount > 0
      ? Math.round((kpi.commercialCount / (kpi.residentialCount + kpi.commercialCount)) * 100)
      : 0;

  const metrics = [
    {
      label: "Active Clients",
      value: isLoading ? null : kpi?.activeClients,
      desc: "Clients with active service",
      testId: "met-active",
    },
    {
      label: "Clients per Technician",
      value: isLoading ? null : avgPerTech,
      desc: "Workload distribution",
      testId: "met-cpt",
    },
    {
      label: "Routes",
      value: isLoading ? null : kpi?.routeCount,
      desc: "Configured service routes",
      testId: "met-routes",
    },
    {
      label: "Avg Stops per Route",
      value: isLoading ? null : avgJobsPerRoute,
      desc: "Active jobs per route",
      testId: "met-stops",
    },
    {
      label: "Avg Stops per Hour",
      value: isLoading ? null : avgJobsPerHour,
      desc: "Based on avg visit duration",
      testId: "met-sph",
    },
    {
      label: "Avg Visit Duration",
      value: isLoading ? null : kpi?.avgVisitMinutes ? `${kpi.avgVisitMinutes} min` : "—",
      desc: "Calculated from completed visits",
      testId: "met-duration",
    },
    {
      label: "Residential",
      value: isLoading ? null : kpi?.residentialCount,
      desc: "Residential clients",
      testId: "met-res",
    },
    {
      label: "Commercial",
      value: isLoading ? null : kpi?.commercialCount,
      desc: `${commercialPct}% of client base`,
      testId: "met-com",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Key operational metrics for your business. Auto-refreshed every visit.
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {m.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4 px-4">
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <>
                  <div className="text-2xl font-bold" data-testid={m.testId}>
                    {m.value}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{m.desc}</p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Res vs Commercial bar */}
      {kpi && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Residential vs Commercial Mix</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3" data-testid="chart-mix">
              {[
                {
                  label: "Residential",
                  value: kpi.residentialCount,
                  total: kpi.residentialCount + kpi.commercialCount,
                  color: "bg-primary",
                },
                {
                  label: "Commercial",
                  value: kpi.commercialCount,
                  total: kpi.residentialCount + kpi.commercialCount,
                  color: "bg-amber-600",
                },
              ].map((item) => (
                <div key={item.label} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{item.label}</span>
                    <span className="font-medium">
                      {item.value} (
                      {item.total > 0 ? Math.round((item.value / item.total) * 100) : 0}%)
                    </span>
                  </div>
                  <Progress
                    value={item.total > 0 ? (item.value / item.total) * 100 : 0}
                    className="h-3"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
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
      toast({ title: "Report queued for delivery" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Save reports to run automatically on a schedule and deliver via email with a PDF
          attachment.
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
                        Last sent: {new Date(report.lastSentAt).toLocaleDateString()}
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

      <ReportBuilderDialog
        open={builderOpen}
        onOpenChange={(open) => {
          setBuilderOpen(open);
          if (!open) setEditTarget(null);
        }}
        initial={editTarget}
        onSave={(data) => {
          if (editTarget) updateMutation.mutate({ id: editTarget.id, data });
          else createMutation.mutate(data);
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
  const [name, setName] = useState("");
  const [sections, setSections] = useState<string[]>([]);
  const [frequency, setFrequency] = useState("weekly");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [sendHour, setSendHour] = useState(7);
  const [recipientsStr, setRecipientsStr] = useState("");

  // Sync form state when initial changes (edit vs new) or dialog opens
  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setSections(initial?.sections ?? []);
      setFrequency(initial?.frequency ?? "weekly");
      setDayOfWeek(initial?.dayOfWeek ?? 1);
      setDayOfMonth(initial?.dayOfMonth ?? 1);
      setSendHour(initial?.sendHour ?? 7);
      setRecipientsStr(initial?.recipients.join(", ") ?? "");
    }
  }, [open, initial]);

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
    setSections((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  // Group sections by tab
  const sectionsByTab = SECTION_OPTIONS.reduce<Record<string, typeof SECTION_OPTIONS>>(
    (acc, opt) => {
      if (!acc[opt.tab]) acc[opt.tab] = [];
      acc[opt.tab].push(opt);
      return acc;
    },
    {}
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            {Object.entries(sectionsByTab).map(([tab, opts]) => (
              <div key={tab}>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                  {tab}
                </p>
                <div className="grid grid-cols-1 gap-1.5 mb-3">
                  {opts.map((opt) => (
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
                    </label>
                  ))}
                </div>
              </div>
            ))}
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
              <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(parseInt(v))}>
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
              <Select value={String(dayOfMonth)} onValueChange={(v) => setDayOfMonth(parseInt(v))}>
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
            <Select value={String(sendHour)} onValueChange={(v) => setSendHour(parseInt(v))}>
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
    if (
      ["finance", "operations", "customers", "metrics", "scheduled", "analytics"].includes(t ?? "")
    )
      return t!;
    return "finance";
  });

  // Global period selector — shared between Finance + Customers
  const [period, setPeriod] = useState("6m");
  const months = period === "3m" ? "3" : period === "12m" || period === "annual" ? "12" : "6";

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
          <TabsTrigger value="metrics" data-testid="tab-metrics">
            <Activity className="mr-1.5 h-4 w-4" />
            Metrics
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
          <FinanceTab period={period} onPeriodChange={setPeriod} />
        </TabsContent>

        <TabsContent value="operations">
          <OperationsTab />
        </TabsContent>

        <TabsContent value="customers">
          <CustomersTab
            months={months}
            onMonthsChange={(v) => {
              if (v === "3") setPeriod("3m");
              else if (v === "12") setPeriod("12m");
              else setPeriod("6m");
            }}
          />
        </TabsContent>

        <TabsContent value="metrics">
          <MetricsTab />
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
