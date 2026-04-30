/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  CalendarCheck,
  Target,
  BarChart3,
  PieChart as PieChartIcon,
  Activity,
  Minus,
  Clock,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

type TimingMetrics = {
  avgTravelMinutes: number | null;
  travelSampleSize: number;
  avgYardMinutes: number | null;
  yardSampleSize: number;
};

type AnalyticsData = {
  monthlyRevenue: { month: string; revenue: number }[];
  yearlyRevenue: { year: string; revenue: number }[];
  customerAcquisition: { month: string; newClients: number; total: number }[];
  routePerformance: {
    day: string;
    completed: number;
    scheduled: number;
    skipped: number;
    cancelled: number;
  }[];
  weeklyVisits: { week: string; completed: number; total: number; completionRate: number }[];
  clientRetention: {
    retentionRate: number;
    statusBreakdown: { status: string; count: number; color: string }[];
    total: number;
    active: number;
  };
  avgServiceCost: {
    avgPricePerVisit: number;
    avgInvoiceAmount: number;
    totalPaidInvoices: number;
    activeServicePlans: number;
  };
  leadSourceDistribution: { source: string; count: number }[];
  serviceDayDistribution: { day: string; count: number }[];
  kpis: {
    thisMonthRevenue: number;
    lastMonthRevenue: number;
    revenueGrowth: number;
    totalOutstanding: number;
    totalContacts: number;
    activeContacts: number;
    completionRate: number;
    totalVisitsLast30Days: number;
  };
};

const leadSourceLabels: Record<string, string> = {
  referral: "Referral",
  facebook: "Facebook",
  google: "Google",
  bing: "Bing",
  nextdoor: "NextDoor",
  yard_sign: "Yard Sign",
  local_advertising: "Local Ad",
  unknown: "Not Set",
};

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "#8b5cf6",
  "#06b6d4",
];

function fmt(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtFull(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendLabel,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: typeof DollarSign;
  trend?: number;
  trendLabel?: string;
}) {
  return (
    <Card data-testid={`card-kpi-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <p
              className="text-2xl font-bold"
              data-testid={`text-kpi-value-${title.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {value}
            </p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="p-2 rounded-md bg-primary/10">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            {trend !== undefined && (
              <div
                className={`flex items-center gap-0.5 text-xs font-medium ${trend > 0 ? "text-green-600 dark:text-green-400" : trend < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
              >
                {trend > 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : trend < 0 ? (
                  <TrendingDown className="h-3 w-3" />
                ) : (
                  <Minus className="h-3 w-3" />
                )}
                <span>
                  {trend > 0 ? "+" : ""}
                  {trend}%
                </span>
              </div>
            )}
            {trendLabel && <span className="text-[10px] text-muted-foreground">{trendLabel}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartTooltipContent({ active, payload, label, prefix }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-background p-2 shadow-md text-xs">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1">
            <span
              className="h-2 w-2 rounded-full inline-block"
              style={{ backgroundColor: entry.color }}
            />
            {entry.name}
          </span>
          <span className="font-medium">{prefix === "$" ? fmtFull(entry.value) : entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function Analytics() {
  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ["/api/analytics/dashboard"],
  });
  const { data: timingData } = useQuery<TimingMetrics>({
    queryKey: ["/api/analytics/timing-metrics"],
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-muted-foreground">Loading business insights...</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { kpis } = data;

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-analytics-heading">
          Analytics
        </h1>
        <p className="text-muted-foreground">
          Comprehensive business intelligence and performance metrics
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="This Month Revenue"
          value={fmtFull(kpis.thisMonthRevenue)}
          subtitle={`Last month: ${fmtFull(kpis.lastMonthRevenue)}`}
          icon={DollarSign}
          trend={kpis.revenueGrowth}
          trendLabel="vs last month"
        />
        <KpiCard
          title="Active Clients"
          value={String(kpis.activeContacts)}
          subtitle={`${kpis.totalContacts} total contacts`}
          icon={Users}
        />
        <KpiCard
          title="Completion Rate"
          value={`${kpis.completionRate}%`}
          subtitle={`${kpis.totalVisitsLast30Days} visits (30 days)`}
          icon={CalendarCheck}
        />
        <KpiCard
          title="Outstanding Balance"
          value={fmtFull(kpis.totalOutstanding)}
          subtitle="Unpaid invoices"
          icon={Target}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card data-testid="card-chart-monthly-revenue">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Monthly Revenue
            </CardTitle>
            <CardDescription>Revenue trends over the last 12 months</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.monthlyRevenue}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  stroke="hsl(var(--border))"
                />
                <YAxis
                  tickFormatter={fmt}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  stroke="hsl(var(--border))"
                />
                <Tooltip content={<ChartTooltipContent prefix="$" />} />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="hsl(var(--chart-1))"
                  fill="url(#revenueGrad)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card data-testid="card-chart-customer-acquisition">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Customer Acquisition
            </CardTitle>
            <CardDescription>New clients added and running total</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.customerAcquisition}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  stroke="hsl(var(--border))"
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  stroke="hsl(var(--border))"
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  stroke="hsl(var(--border))"
                />
                <Tooltip content={<ChartTooltipContent />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  yAxisId="left"
                  dataKey="newClients"
                  name="New Clients"
                  fill="hsl(var(--chart-2))"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="total"
                  name="Total Clients"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  dot={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card data-testid="card-chart-route-performance">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Route Performance by Day
            </CardTitle>
            <CardDescription>Visit outcomes by day of week (last 30 days)</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.routePerformance}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  stroke="hsl(var(--border))"
                  tickFormatter={(v) => v.slice(0, 3)}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  stroke="hsl(var(--border))"
                />
                <Tooltip content={<ChartTooltipContent />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="completed"
                  name="Completed"
                  fill="hsl(var(--chart-1))"
                  stackId="a"
                  radius={[0, 0, 0, 0]}
                />
                <Bar dataKey="scheduled" name="Scheduled" fill="hsl(var(--chart-2))" stackId="a" />
                <Bar dataKey="skipped" name="Skipped" fill="hsl(var(--chart-3))" stackId="a" />
                <Bar
                  dataKey="cancelled"
                  name="Cancelled"
                  fill="hsl(var(--chart-5))"
                  stackId="a"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card data-testid="card-chart-weekly-visits">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Weekly Visit Trends
            </CardTitle>
            <CardDescription>Completion rate and volume (last 8 weeks)</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.weeklyVisits}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  stroke="hsl(var(--border))"
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  stroke="hsl(var(--border))"
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  domain={[0, 100]}
                  unit="%"
                  stroke="hsl(var(--border))"
                />
                <Tooltip content={<ChartTooltipContent />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  yAxisId="left"
                  dataKey="total"
                  name="Total Visits"
                  fill="hsl(var(--chart-2))"
                  radius={[4, 4, 0, 0]}
                  opacity={0.3}
                />
                <Bar
                  yAxisId="left"
                  dataKey="completed"
                  name="Completed"
                  fill="hsl(var(--chart-1))"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="completionRate"
                  name="Completion %"
                  stroke="hsl(var(--chart-4))"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card data-testid="card-chart-client-retention">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <PieChartIcon className="h-4 w-4" />
              Client Retention
            </CardTitle>
            <CardDescription>
              {data.clientRetention.retentionRate}% retention rate ({data.clientRetention.active}{" "}
              active of {data.clientRetention.total})
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={220}>
                <PieChart>
                  <Pie
                    data={data.clientRetention.statusBreakdown.filter((s) => s.count > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="count"
                    nameKey="status"
                  >
                    {data.clientRetention.statusBreakdown
                      .filter((s) => s.count > 0)
                      .map((entry, idx) => (
                        <Cell key={idx} fill={entry.color} />
                      ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {data.clientRetention.statusBreakdown.map((item) => (
                  <div
                    key={item.status}
                    className="flex items-center justify-between gap-2 flex-wrap text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full inline-block shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-muted-foreground">{item.status}</span>
                    </div>
                    <span className="font-medium">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-chart-lead-sources">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4" />
              Lead Sources
            </CardTitle>
            <CardDescription>Where your clients are coming from</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.leadSourceDistribution} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  stroke="hsl(var(--border))"
                />
                <YAxis
                  type="category"
                  dataKey="source"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  stroke="hsl(var(--border))"
                  width={80}
                  tickFormatter={(v) => leadSourceLabels[v] || v}
                />
                <Tooltip
                  formatter={(value: number, _name: string, props: any) => [
                    value,
                    leadSourceLabels[props.payload.source] || props.payload.source,
                  ]}
                />
                <Bar
                  dataKey="count"
                  name="Clients"
                  fill="hsl(var(--chart-2))"
                  radius={[0, 4, 4, 0]}
                >
                  {data.leadSourceDistribution.map((_, idx) => (
                    <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card data-testid="card-chart-service-day">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarCheck className="h-4 w-4" />
              Service Day Distribution
            </CardTitle>
            <CardDescription>Clients assigned per day of week</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.serviceDayDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  stroke="hsl(var(--border))"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  stroke="hsl(var(--border))"
                />
                <Tooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="count"
                  name="Clients"
                  fill="hsl(var(--chart-1))"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card data-testid="card-timing-metrics">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Service Timing Metrics
            </CardTitle>
            <CardDescription>Average travel and yard time per visit</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Avg Travel Time</p>
                <p className="text-xl font-bold" data-testid="text-avg-travel-time">
                  {timingData?.avgTravelMinutes != null
                    ? `${timingData.avgTravelMinutes} min`
                    : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {timingData?.travelSampleSize
                    ? `${timingData.travelSampleSize} trips tracked`
                    : "En-route tracking not yet active"}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Avg Yard Time</p>
                <p className="text-xl font-bold" data-testid="text-avg-yard-time">
                  {timingData?.avgYardMinutes != null ? `${timingData.avgYardMinutes} min` : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {timingData?.yardSampleSize
                    ? `${timingData.yardSampleSize} visits tracked`
                    : "Start/complete tracking active"}
                </p>
              </div>
            </div>
            <div className="rounded-md bg-muted/40 p-3 space-y-1.5">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                How these are calculated
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Travel time</span> — time from when
                "Send En-Route" is tapped to when the technician taps "Start Job"
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Yard time</span> — time from "Start
                Job" to "Complete" on each visit
              </p>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-avg-service-cost">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Service Cost Metrics
            </CardTitle>
            <CardDescription>Average pricing and revenue per service</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Avg Price/Visit</p>
                <p className="text-xl font-bold" data-testid="text-avg-price-per-visit">
                  {fmtFull(data.avgServiceCost.avgPricePerVisit)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {data.avgServiceCost.activeServicePlans} active plans
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Avg Invoice</p>
                <p className="text-xl font-bold" data-testid="text-avg-invoice">
                  {fmtFull(data.avgServiceCost.avgInvoiceAmount)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {data.avgServiceCost.totalPaidInvoices} paid invoices
                </p>
              </div>
            </div>
            {data.yearlyRevenue.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Yearly Revenue Comparison</p>
                <div className="space-y-2">
                  {data.yearlyRevenue.map((yr) => {
                    const maxYr = Math.max(...data.yearlyRevenue.map((y) => y.revenue), 1);
                    const pct = (yr.revenue / maxYr) * 100;
                    return (
                      <div key={yr.year} className="space-y-0.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{yr.year}</span>
                          <span className="font-medium">{fmtFull(yr.revenue)}</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
