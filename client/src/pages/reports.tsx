import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  TrendingUp, DollarSign, Users, FileText,
  CalendarCheck, BarChart3, BookOpen, TrendingDown,
} from "lucide-react";
import Analytics from "@/pages/analytics";

type RevenueMonth = {
  month: string;
  revenue: number;
  projected?: boolean;
};

type ReportData = {
  period: string;
  periodLabel: string;
  monthlyRevenue: RevenueMonth[];
  bookedRevenue: number;
  contactsByStatus: Record<string, number>;
  totalContacts: number;
  invoicesByStatus: Record<string, number>;
  totalInvoices: number;
  totalOutstanding: number;
  totalCollected: number;
  thisMonthVisits: {
    completed: number;
    scheduled: number;
    skipped: number;
    total: number;
  };
};

const statusLabels: Record<string, string> = {
  lead: "Lead",
  estimate: "Estimate",
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};

const invoiceStatusLabels: Record<string, string> = {
  draft: "Draft",
  pending: "Pending",
  sent: "Sent",
  paid: "Paid",
  failed: "Failed",
  voided: "Voided",
};

const periodOptions = [
  { group: "Trailing", items: [
    { value: "3m", label: "Last 3 Months" },
    { value: "6m", label: "Last 6 Months" },
    { value: "9m", label: "Last 9 Months" },
    { value: "12m", label: "Last 12 Months" },
  ]},
  { group: "Quarterly", items: [
    { value: "q1", label: "Q1 (Jan - Mar)" },
    { value: "q2", label: "Q2 (Apr - Jun)" },
    { value: "q3", label: "Q3 (Jul - Sep)" },
    { value: "q4", label: "Q4 (Oct - Dec)" },
  ]},
  { group: "Annual", items: [
    { value: "annual", label: "Full Year" },
  ]},
  { group: "Projections", items: [
    { value: "proj3", label: "3-Month Projection" },
    { value: "proj6", label: "6-Month Projection" },
    { value: "proj12", label: "12-Month Projection" },
  ]},
];

function ReportsContent() {
  const [period, setPeriod] = useState("6m");

  const { data, isLoading } = useQuery<ReportData>({
    queryKey: [`/api/reports/summary?period=${period}`],
  });

  const maxRevenue = data ? Math.max(...data.monthlyRevenue.map(m => m.revenue), 1) : 1;
  const totalPeriodRevenue = data ? data.monthlyRevenue.filter(m => !m.projected).reduce((sum, m) => sum + m.revenue, 0) : 0;
  const totalProjectedRevenue = data ? data.monthlyRevenue.filter(m => m.projected).reduce((sum, m) => sum + m.revenue, 0) : 0;
  const hasProjections = data?.monthlyRevenue.some(m => m.projected);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-sm">
            {data?.periodLabel || "Business performance overview"}
          </p>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[200px]" data-testid="select-report-period">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            {periodOptions.map((group) => (
              <div key={group.group}>
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{group.group}</div>
                {group.items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Collected</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-2xl font-bold" data-testid="text-total-collected">
                ${(data?.totalCollected ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Outstanding</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-2xl font-bold" data-testid="text-total-outstanding">
                ${(data?.totalOutstanding ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Booked This Month</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-2xl font-bold text-primary" data-testid="text-booked-revenue">
                ${(data?.bookedRevenue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Active plans + pending invoices</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Contacts</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold" data-testid="text-total-contacts">
                {data?.totalContacts ?? 0}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">Revenue</CardTitle>
              </div>
              {!isLoading && (
                <div className="text-right">
                  <p className="text-sm font-bold" data-testid="text-period-revenue">
                    ${totalPeriodRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  {hasProjections && (
                    <p className="text-xs text-muted-foreground">
                      +${totalProjectedRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} projected
                    </p>
                  )}
                </div>
              )}
            </div>
            <CardDescription>{data?.periodLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : (
              <div className="space-y-2.5" data-testid="chart-monthly-revenue">
                {data?.monthlyRevenue.map((m) => (
                  <div key={m.month} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <div className="flex items-center gap-1.5 min-w-[130px]">
                        <span className={m.projected ? "text-muted-foreground italic" : "text-muted-foreground"}>
                          {m.month}
                        </span>
                        {m.projected && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">projected</Badge>
                        )}
                      </div>
                      <span className={`font-medium ${m.projected ? "text-muted-foreground" : ""}`}>
                        ${m.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="relative">
                      <Progress
                        value={(m.revenue / maxRevenue) * 100}
                        className={`h-2 ${m.projected ? "opacity-50" : ""}`}
                      />
                      {m.projected && (
                        <div
                          className="absolute inset-0 h-2 rounded-full"
                          style={{
                            background: "repeating-linear-gradient(90deg, transparent, transparent 3px, hsl(var(--primary)/0.15) 3px, hsl(var(--primary)/0.15) 6px)",
                            width: `${(m.revenue / maxRevenue) * 100}%`,
                          }}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">This Month's Visits</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-32 w-full" /> : (
              <div className="space-y-4" data-testid="chart-visits">
                <div className="text-3xl font-bold">{data?.thisMonthVisits.total ?? 0}</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Completed</span>
                    <Badge variant="secondary">{data?.thisMonthVisits.completed ?? 0}</Badge>
                  </div>
                  <Progress
                    value={data?.thisMonthVisits.total ? (data.thisMonthVisits.completed / data.thisMonthVisits.total) * 100 : 0}
                    className="h-2"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Scheduled</span>
                    <Badge variant="secondary">{data?.thisMonthVisits.scheduled ?? 0}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Skipped</span>
                    <Badge variant="secondary">{data?.thisMonthVisits.skipped ?? 0}</Badge>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Contacts by Status</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-32 w-full" /> : (
              <div className="space-y-2" data-testid="chart-contacts-status">
                {Object.entries(data?.contactsByStatus ?? {}).map(([status, cnt]) => (
                  <div key={status} className="flex items-center justify-between gap-2">
                    <span className="text-sm">{statusLabels[status] || status}</span>
                    <div className="flex items-center gap-2">
                      <Progress
                        value={data?.totalContacts ? (cnt / data.totalContacts) * 100 : 0}
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

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Invoices by Status</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-32 w-full" /> : (
              <div className="space-y-2" data-testid="chart-invoices-status">
                {Object.entries(data?.invoicesByStatus ?? {}).map(([status, cnt]) => (
                  <div key={status} className="flex items-center justify-between gap-2">
                    <span className="text-sm">{invoiceStatusLabels[status] || status}</span>
                    <div className="flex items-center gap-2">
                      <Progress
                        value={data?.totalInvoices ? (cnt / data.totalInvoices) * 100 : 0}
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

export default function Reports() {
  const [tab, setTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") === "analytics" ? "analytics" : "reports";
  });

  return (
    <div className="p-4 md:p-6 overflow-auto h-full">
      <div className="mb-4">
        <h1 className="text-2xl font-bold" data-testid="text-reports-heading">Reports &amp; Analytics</h1>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="reports" data-testid="tab-reports">
            <BarChart3 className="mr-1.5 h-4 w-4" />
            Reports
          </TabsTrigger>
          <TabsTrigger value="analytics" data-testid="tab-analytics">
            <TrendingUp className="mr-1.5 h-4 w-4" />
            Analytics
          </TabsTrigger>
        </TabsList>
        <TabsContent value="reports">
          <ReportsContent />
        </TabsContent>
        <TabsContent value="analytics" className="-m-4 md:-m-6">
          <Analytics />
        </TabsContent>
      </Tabs>
    </div>
  );
}
