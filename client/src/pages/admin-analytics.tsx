import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Building2, DollarSign, TrendingUp, AlertTriangle,
  CreditCard, Repeat, Target, MessageSquare, Calculator, Search,
  ChevronRight, ArrowUpRight, ArrowDownRight, Activity,
  Mail, Phone, BarChart3, Wallet, ArrowUpDown,
} from "lucide-react";
import { TIER_CONFIG } from "@shared/schema";
import { useState, useMemo } from "react";
import { adminFetchFn } from "@/lib/adminApi";

function fmt(n: number | undefined, decimals = 2): string {
  if (n === undefined || n === null || isNaN(n)) return "$0.00";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function pct(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return "0%";
  return `${n.toFixed(1)}%`;
}

function retentionColor(p: number): string {
  if (p >= 80) return "text-green-700 dark:text-green-400";
  if (p >= 50) return "text-yellow-700 dark:text-yellow-400";
  return "text-red-700 dark:text-red-400";
}

function marginColor(n: number): string {
  return n >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400";
}

function StatCard({ label, value, icon: Icon, trend, subtitle, onClick }: {
  label: string; value: string | number; icon: any; trend?: "up" | "down" | null; subtitle?: string; onClick?: () => void;
}) {
  const testId = `text-stat-${label.toLowerCase().replace(/\s/g, "-")}`;
  return (
    <Card
      data-testid={`card-stat-${label.toLowerCase().replace(/\s/g, "-")}`}
      className={onClick ? "cursor-pointer hover-elevate transition-shadow" : ""}
      onClick={onClick}
    >
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{label}</span>
          {trend === "up" && <ArrowUpRight className="h-3 w-3 text-green-700 dark:text-green-400" />}
          {trend === "down" && <ArrowDownRight className="h-3 w-3 text-red-700 dark:text-red-400" />}
          {onClick && <ChevronRight className="h-3 w-3 text-muted-foreground ml-auto" />}
        </div>
        <p className="text-xl font-bold" data-testid={testId}>{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

function ExecutiveTab({ onDrillDown }: { onDrillDown: (tab: string) => void }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/executive"],
    queryFn: adminFetchFn("/api/admin/analytics/executive"),
  });

  if (isLoading) return <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;

  return (
    <div className="space-y-6" data-testid="tab-content-executive">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active Accounts" value={data?.activeAccounts ?? 0} icon={Building2} subtitle={`${data?.totalAccounts ?? 0} total`} onClick={() => onDrillDown("accounts")} />
        <StatCard label="MRR" value={fmt(data?.mrr)} icon={DollarSign} onClick={() => onDrillDown("billing")} />
        <StatCard label="ARR" value={fmt(data?.arr)} icon={TrendingUp} onClick={() => onDrillDown("billing")} />
        <StatCard label="Gross Margin" value={pct(data?.estimatedGrossMarginPct)} icon={Calculator} onClick={() => onDrillDown("costs")} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="New MRR" value={fmt(data?.newMrrThisMonth)} icon={ArrowUpRight} subtitle="this month" onClick={() => onDrillDown("billing")} />
        <StatCard label="Churned MRR" value={fmt(data?.churnedMrrThisMonth)} icon={ArrowDownRight} subtitle="this month" onClick={() => onDrillDown("retention")} />
        <StatCard label="Logo Churn" value={pct(data?.logoChurnPct)} icon={AlertTriangle} onClick={() => onDrillDown("retention")} />
        <StatCard label="Net Revenue Retention" value={pct(data?.nrr)} icon={Repeat} onClick={() => onDrillDown("retention")} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="GRR" value={pct(data?.grr)} icon={Activity} onClick={() => onDrillDown("retention")} />
        <StatCard label="Twilio Cost" value={fmt(data?.totalTwilioCostEst)} icon={Phone} onClick={() => onDrillDown("messaging")} />
        <StatCard label="SendGrid Cost" value={fmt(data?.totalSendgridCostEst)} icon={Mail} onClick={() => onDrillDown("messaging")} />
      </div>
    </div>
  );
}

function AccountsTab() {
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data: accounts, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/analytics/accounts", filter],
    queryFn: adminFetchFn(`/api/admin/analytics/accounts${filter !== "all" ? `?filter=${filter}` : ""}`),
  });

  const filtered = useMemo(() => {
    if (!accounts) return [];
    if (!search.trim()) return accounts;
    const q = search.toLowerCase();
    return accounts.filter((a: any) =>
      a.name?.toLowerCase().includes(q) || a.id?.toLowerCase().includes(q)
    );
  }, [accounts, search]);

  return (
    <div className="space-y-4" data-testid="tab-content-accounts">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48" data-testid="select-account-filter">
            <SelectValue placeholder="Filter accounts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Accounts</SelectItem>
            <SelectItem value="inactive_14d">Inactive 14+ days</SelectItem>
            <SelectItem value="high_sms_cost">High SMS Cost</SelectItem>
            <SelectItem value="failed_payments">Failed Payments</SelectItem>
            <SelectItem value="not_activated_7d">Not Activated (7d)</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search accounts..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-accounts-search" />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground" data-testid="text-no-accounts">No accounts match the current filter</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((a: any) => {
            const tierConfig = TIER_CONFIG[a.subscriptionTier as keyof typeof TIER_CONFIG];
            return (
              <Link key={a.id} href={`/admin/companies/${a.id}`}>
                <Card className="hover-elevate cursor-pointer" data-testid={`card-account-${a.id}`}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium truncate" data-testid={`text-account-name-${a.id}`}>{a.name}</p>
                          <p className="text-xs text-muted-foreground" data-testid={`text-account-stats-${a.id}`}>
                            {a.userCount} users, {a.contactCount} contacts, {a.servicePlanCount} plans
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" data-testid={`badge-tier-${a.id}`}>{tierConfig?.name || a.subscriptionTier}</Badge>
                        {a.isActivated && <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid={`badge-activated-${a.id}`}>Activated</Badge>}
                        {a.churnRiskScore > 5 && <Badge variant="destructive" data-testid={`badge-risk-${a.id}`}>Risk: {a.churnRiskScore}</Badge>}
                        {a.churnRiskScore > 0 && a.churnRiskScore <= 5 && <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" data-testid={`badge-risk-${a.id}`}>Risk: {a.churnRiskScore}</Badge>}
                        {a.failedPayments30d > 0 && <Badge variant="destructive" data-testid={`badge-failed-${a.id}`}>{a.failedPayments30d} failed</Badge>}
                        <span className="text-xs text-muted-foreground" data-testid={`text-margin-${a.id}`}>{fmt(a.estimatedMargin30d)}/mo margin</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BillingTab() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/billing"],
    queryFn: adminFetchFn("/api/admin/analytics/billing"),
  });

  if (isLoading) return <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;

  return (
    <div className="space-y-6" data-testid="tab-content-billing">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Failed Payment Rate" value={pct(data?.failedPaymentRate)} icon={AlertTriangle} />
        <StatCard label="Recovery Rate" value={pct(data?.recoveryRate)} icon={TrendingUp} />
        <StatCard label="Past Due Invoices" value={data?.pastDueCount ?? 0} icon={CreditCard} subtitle={fmt(data?.pastDueAmount)} />
        <StatCard label="Stripe Fees" value={fmt(data?.totalStripeFees)} icon={DollarSign} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Refunds" value={data?.refundCount ?? 0} icon={Repeat} subtitle={fmt(data?.refundAmount)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Invoices by Status</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.invoicesByStatus ? (
              <div className="space-y-2">
                {Object.entries(data.invoicesByStatus).map(([status, cnt]) => (
                  <div key={status} className="flex items-center justify-between gap-2" data-testid={`row-invoice-status-${status}`}>
                    <span className="text-sm capitalize">{status}</span>
                    <Badge variant="outline">{cnt as number}</Badge>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No data</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Monthly Payments (6mo)</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.monthlyPayments?.length > 0 ? (
              <div className="space-y-2">
                {data.monthlyPayments.map((m: any) => (
                  <div key={m.month} className="flex items-center justify-between gap-2" data-testid={`row-payment-${m.month}`}>
                    <span className="text-sm">{m.month}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" data-testid={`text-payment-amount-${m.month}`}>{fmt(m.amount)}</span>
                      <Badge variant="outline">{m.count} paid</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No payment data yet</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RetentionTab() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/retention"],
    queryFn: adminFetchFn("/api/admin/analytics/retention"),
  });

  if (isLoading) return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>;

  return (
    <div className="space-y-6" data-testid="tab-content-retention">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Cohort Retention</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.cohorts?.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cohort</TableHead>
                    <TableHead className="text-center">Started</TableHead>
                    {data.cohorts[0]?.retentionPct?.map((_: any, i: number) => (
                      <TableHead key={i} className="text-center">M{i + 1}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.cohorts.map((c: any) => (
                    <TableRow key={c.month} data-testid={`row-cohort-${c.month}`}>
                      <TableCell className="font-medium" data-testid={`text-cohort-month-${c.month}`}>{c.month}</TableCell>
                      <TableCell className="text-center" data-testid={`text-cohort-started-${c.month}`}>{c.started}</TableCell>
                      {c.retentionPct?.map((p: number, i: number) => (
                        <TableCell key={i} className="text-center">
                          <span className={retentionColor(p)} data-testid={`text-retention-${c.month}-m${i + 1}`}>
                            {p.toFixed(0)}%
                          </span>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : <p className="text-sm text-muted-foreground">Not enough data for cohort analysis</p>}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Churn by Plan</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.churnByPlan && Object.keys(data.churnByPlan).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(data.churnByPlan).map(([plan, cnt]) => {
                  const tierConfig = TIER_CONFIG[plan as keyof typeof TIER_CONFIG];
                  return (
                    <div key={plan} className="flex items-center justify-between gap-2" data-testid={`row-churn-plan-${plan}`}>
                      <span className="text-sm">{tierConfig?.name || plan}</span>
                      <Badge variant="destructive">{cnt as number}</Badge>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-sm text-muted-foreground">No churn data</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Churn by Tenure</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.churnByTenure?.length > 0 ? (
              <div className="space-y-2">
                {data.churnByTenure.map((b: any, i: number) => (
                  <div key={b.bucket} className="flex items-center justify-between gap-2" data-testid={`row-churn-tenure-${i}`}>
                    <span className="text-sm">{b.bucket}</span>
                    <Badge variant="outline">{b.count}</Badge>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No churn data</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ActivationTab() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/activation"],
    queryFn: adminFetchFn("/api/admin/analytics/activation"),
  });

  if (isLoading) return <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;

  return (
    <div className="space-y-6" data-testid="tab-content-activation">
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground mb-1">Activation Definition</p>
          <p className="text-sm" data-testid="text-activation-definition">{data?.activationDefinition || "10+ contacts AND 1+ recurring plan AND (1+ invoice OR 1+ payment)"}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Activation Rate" value={pct(data?.activationRate)} icon={Target} />
        <StatCard label="Activated" value={`${data?.activatedCount ?? 0} / ${data?.totalAccounts ?? 0}`} icon={Building2} />
        <StatCard label="Avg Days to Activate" value={data?.avgDaysToActivation?.toFixed(1) ?? "N/A"} icon={Activity} />
        <StatCard label="Not Activated 7d+" value={data?.notActivated7d ?? 0} icon={AlertTriangle} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Activation by Plan</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.byPlan?.length > 0 ? (
            <div className="space-y-3">
              {data.byPlan.map((p: any) => {
                const tierConfig = TIER_CONFIG[p.plan as keyof typeof TIER_CONFIG];
                return (
                  <div key={p.plan} className="flex items-center justify-between gap-2" data-testid={`row-activation-plan-${p.plan}`}>
                    <span className="text-sm">{tierConfig?.name || p.plan}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm" data-testid={`text-activation-count-${p.plan}`}>{p.activated}/{p.total}</span>
                      <Badge variant={p.rate >= 50 ? "default" : "outline"} data-testid={`badge-activation-rate-${p.plan}`}>{pct(p.rate)}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-sm text-muted-foreground">No data</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function MessagingTab() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/messaging-costs"],
    queryFn: adminFetchFn("/api/admin/analytics/messaging-costs"),
  });

  if (isLoading) return <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;

  return (
    <div className="space-y-6" data-testid="tab-content-messaging">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="SMS Sent" value={data?.totalSmsSent ?? 0} icon={Phone} />
        <StatCard label="SMS Received" value={data?.totalSmsReceived ?? 0} icon={Phone} />
        <StatCard label="Emails Sent" value={data?.totalEmailsSent ?? 0} icon={Mail} />
        <StatCard label="SMS Cost" value={fmt(data?.estimatedSmsCost)} icon={DollarSign} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top Accounts by SMS</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.topAccountsBySms?.length > 0 ? (
              <div className="space-y-2">
                {data.topAccountsBySms.map((a: any) => (
                  <div key={a.companyId} className="flex items-center justify-between gap-2" data-testid={`row-sms-top-${a.companyId}`}>
                    <span className="text-sm truncate flex-1" data-testid={`text-sms-company-${a.companyId}`}>{a.companyName}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" data-testid={`badge-sms-count-${a.companyId}`}>{a.smsCount} msgs</Badge>
                      <span className="text-xs text-muted-foreground">{fmt(a.cost)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No SMS data</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top Accounts by Email</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.topAccountsByEmail?.length > 0 ? (
              <div className="space-y-2">
                {data.topAccountsByEmail.map((a: any) => (
                  <div key={a.companyId} className="flex items-center justify-between gap-2" data-testid={`row-email-top-${a.companyId}`}>
                    <span className="text-sm truncate flex-1" data-testid={`text-email-company-${a.companyId}`}>{a.companyName}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" data-testid={`badge-email-count-${a.companyId}`}>{a.emailCount} emails</Badge>
                      <span className="text-xs text-muted-foreground">{fmt(a.cost)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No email data</p>}
          </CardContent>
        </Card>
      </div>

      {data?.anomalies?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              Anomalies Detected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.anomalies.map((a: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-2" data-testid={`row-anomaly-${i}`}>
                  <span className="text-sm truncate flex-1">{a.companyName}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive" data-testid={`badge-anomaly-type-${i}`}>{a.type}</Badge>
                    <span className="text-xs text-muted-foreground">{a.current} vs avg {a.trailing7dAvg?.toFixed(1)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Monthly Volume</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.monthlyVolume?.length > 0 ? (
            <div className="space-y-2">
              {data.monthlyVolume.map((m: any) => (
                <div key={m.month} className="flex items-center justify-between gap-2" data-testid={`row-volume-${m.month}`}>
                  <span className="text-sm">{m.month}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground" data-testid={`text-sms-volume-${m.month}`}>{m.sms} SMS</span>
                    <span className="text-xs text-muted-foreground" data-testid={`text-email-volume-${m.month}`}>{m.email} emails</span>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">No messaging data yet</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function UnitEconomicsTab() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/unit-economics"],
    queryFn: adminFetchFn("/api/admin/analytics/unit-economics"),
  });

  if (isLoading) return <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;

  return (
    <div className="space-y-6" data-testid="tab-content-economics">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Current Active" value={data?.currentActiveAccounts ?? 0} icon={Building2} />
        <StatCard label="Avg Revenue per Acct" value={fmt(data?.avgRevenuePerAccount)} icon={DollarSign} />
        <StatCard label="Break-Even Accounts" value={data?.breakEvenAccounts?.toFixed(1) ?? "N/A"} icon={Target} />
        <StatCard
          label="Status"
          value={(data?.currentActiveAccounts ?? 0) >= (data?.breakEvenAccounts ?? Infinity) ? "Profitable" : "Pre-Profit"}
          icon={TrendingUp}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Monthly Unit Economics</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.months?.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Stripe</TableHead>
                    <TableHead className="text-right">Twilio</TableHead>
                    <TableHead className="text-right">SendGrid</TableHead>
                    <TableHead className="text-right">Fixed</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="text-right">$/wt</TableHead>
                    <TableHead className="text-right">Contrib. Margin</TableHead>
                    <TableHead className="text-right">Net Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.months.map((m: any) => (
                    <TableRow key={m.month} data-testid={`row-economics-${m.month}`}>
                      <TableCell className="font-medium" data-testid={`text-economics-month-${m.month}`}>{m.month}</TableCell>
                      <TableCell className="text-right" data-testid={`text-economics-revenue-${m.month}`}>{fmt(m.revenueGross)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmt(m.stripeFees)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmt(m.twilioCost)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmt(m.sendgridCost)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmt(m.fixedCosts)}</TableCell>
                      <TableCell className="text-right text-muted-foreground" data-testid={`text-weight-${m.month}`}>{m.totalActiveWeight ?? 0}</TableCell>
                      <TableCell className="text-right text-muted-foreground" data-testid={`text-cost-per-weight-${m.month}`}>{fmt(m.costPerWeight)}</TableCell>
                      <TableCell className="text-right">
                        <span className={`font-medium ${marginColor(m.contributionMargin)}`} data-testid={`text-contrib-margin-${m.month}`}>
                          {fmt(m.contributionMargin)} ({pct(m.contributionMarginPct)})
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`font-medium ${marginColor(m.netMargin)}`} data-testid={`text-net-margin-${m.month}`}>
                          {fmt(m.netMargin)} ({pct(m.netMarginPct)})
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : <p className="text-sm text-muted-foreground">No data available yet</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function CustomerCostsTab() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<string>("totalCostCents");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics/customer-costs"],
    queryFn: adminFetchFn("/api/admin/analytics/customer-costs"),
  });

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const cFmt = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const sorted = useMemo(() => {
    if (!data?.rows) return [];
    let rows = [...data.rows];
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r: any) => r.name?.toLowerCase().includes(q));
    }
    rows.sort((a: any, b: any) => {
      const av = a[sortCol] ?? 0;
      const bv = b[sortCol] ?? 0;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return rows;
  }, [data?.rows, search, sortCol, sortDir]);

  if (isLoading) return <div className="space-y-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-64" /></div>;

  const summary = data?.summary;
  const SortIcon = ({ col }: { col: string }) => (
    <ArrowUpDown className={`h-3 w-3 inline ml-1 ${sortCol === col ? "text-foreground" : "text-muted-foreground/40"}`} />
  );

  return (
    <div className="space-y-6" data-testid="tab-content-customer-costs">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Platform Cost" value={cFmt(summary?.totalPlatformCostCents ?? 0)} icon={Wallet} subtitle="last 30 days" />
        <StatCard label="Avg Cost / Customer" value={cFmt(summary?.avgCostPerCustomerCents ?? 0)} icon={Calculator} subtitle={`${summary?.totalCustomers ?? 0} customers`} />
        <StatCard label="Highest Cost" value={summary?.highestCostCustomer?.name ?? "—"} icon={AlertTriangle} subtitle={cFmt(summary?.highestCostCustomer?.totalCostCents ?? 0)} />
        <StatCard label="Unprofitable" value={summary?.unprofitableCount ?? 0} icon={ArrowDownRight} subtitle="negative margin" />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search customers..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-customer-costs-search" />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("name")}>Customer<SortIcon col="name" /></TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort("mrrCents")}>MRR<SortIcon col="mrrCents" /></TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort("smsCostCents")}>SMS<SortIcon col="smsCostCents" /></TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort("emailCostCents")}>Email<SortIcon col="emailCostCents" /></TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort("voiceCostCents")}>Voice AI<SortIcon col="voiceCostCents" /></TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort("stripeFeesCents")}>Stripe Fees<SortIcon col="stripeFeesCents" /></TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort("allocatedInfraCents")}>Infra<SortIcon col="allocatedInfraCents" /></TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort("totalCostCents")}>Total Cost<SortIcon col="totalCostCents" /></TableHead>
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort("netMarginCents")}>Net Margin<SortIcon col="netMarginCents" /></TableHead>
                  <TableHead className="text-right">Cost Ratio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground" data-testid="text-no-customer-costs">No customers found</TableCell></TableRow>
                ) : sorted.map((r: any) => {
                  const tierConfig = TIER_CONFIG[r.subscriptionTier as keyof typeof TIER_CONFIG];
                  const barWidth = Math.min(r.costRatioPct, 200);
                  const barColor = r.costRatioPct > 100 ? "bg-red-500" : r.costRatioPct > 70 ? "bg-yellow-500" : "bg-green-500";
                  return (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/admin/companies/${r.id}`)} data-testid={`row-customer-cost-${r.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2" data-testid={`link-customer-${r.id}`}>
                          <div className="min-w-0">
                            <p className="font-medium truncate text-sm" data-testid={`text-customer-name-${r.id}`}>{r.name}</p>
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className="text-[10px] px-1 py-0">{tierConfig?.name || r.subscriptionTier}</Badge>
                              {r.subscriptionStatus !== "active" && <Badge variant="destructive" className="text-[10px] px-1 py-0">{r.subscriptionStatus}</Badge>}
                            </div>
                          </div>
                          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium" data-testid={`text-mrr-${r.id}`}>{cFmt(r.mrrCents)}</TableCell>
                      <TableCell className="text-right text-muted-foreground" data-testid={`text-sms-cost-${r.id}`}>{cFmt(r.smsCostCents)}<span className="text-[10px] block">{r.smsSegments} seg</span></TableCell>
                      <TableCell className="text-right text-muted-foreground" data-testid={`text-email-cost-${r.id}`}>{cFmt(r.emailCostCents)}<span className="text-[10px] block">{r.emailCount}</span></TableCell>
                      <TableCell className="text-right text-muted-foreground" data-testid={`text-voice-cost-${r.id}`}>{cFmt(r.voiceCostCents)}<span className="text-[10px] block">{r.voiceMinutes} min</span></TableCell>
                      <TableCell className="text-right text-muted-foreground" data-testid={`text-stripe-cost-${r.id}`}>{cFmt(r.stripeFeesCents)}<span className="text-[10px] block">{r.paidInvoiceCount} inv</span></TableCell>
                      <TableCell className="text-right text-muted-foreground" data-testid={`text-infra-cost-${r.id}`}>{cFmt(r.allocatedInfraCents)}</TableCell>
                      <TableCell className="text-right font-medium" data-testid={`text-total-cost-${r.id}`}>{cFmt(r.totalCostCents)}</TableCell>
                      <TableCell className="text-right">
                        <span className={`font-medium ${r.netMarginCents >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`} data-testid={`text-margin-${r.id}`}>
                          {cFmt(r.netMarginCents)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right" data-testid={`text-cost-ratio-${r.id}`}>
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(barWidth / 2, 100)}%` }} />
                          </div>
                          <span className={`text-xs font-medium ${r.costRatioPct > 100 ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>{r.costRatioPct}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const TABS = [
  { key: "executive", label: "Executive", icon: BarChart3 },
  { key: "accounts", label: "Accounts", icon: Building2 },
  { key: "costs", label: "Customer Costs", icon: Wallet },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "retention", label: "Retention", icon: Repeat },
  { key: "activation", label: "Activation", icon: Target },
  { key: "messaging", label: "Messaging", icon: MessageSquare },
  { key: "economics", label: "Unit Economics", icon: Calculator },
] as const;

function InactiveUsersAlert() {
  const { data: inactiveUsers } = useQuery<Record<string, any[]>>({
    queryKey: ["/api/admin/inactive-users"],
    queryFn: adminFetchFn("/api/admin/inactive-users"),
  });

  if (!inactiveUsers || !Object.values(inactiveUsers).some((arr) => arr.length > 0)) return null;

  const tiers = [
    { key: "3d", label: "3+ days", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
    { key: "5d", label: "5+ days", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
    { key: "7d", label: "7+ days", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
    { key: "14d", label: "14+ days", color: "bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-200" },
  ];

  return (
    <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20" data-testid="card-analytics-inactive-users">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Inactive Users
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {tiers.map((tier) => {
            const count = inactiveUsers[tier.key]?.length || 0;
            return (
              <div key={tier.key} className="flex items-center justify-between p-3 rounded-lg border bg-background" data-testid={`stat-analytics-inactive-${tier.key}`}>
                <div>
                  <p className="text-xs text-muted-foreground">No login</p>
                  <p className="text-sm font-medium">{tier.label}</p>
                </div>
                <Badge className={tier.color}>{count}</Badge>
              </div>
            );
          })}
        </div>
        {(() => {
          const worst = inactiveUsers["14d"] || [];
          if (worst.length === 0) return null;
          return (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">14+ day inactive users:</p>
              {worst.slice(0, 5).map((u: any) => (
                <Link key={u.userId} href={`/admin/companies/${u.companyId}`}>
                  <div className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-muted cursor-pointer" data-testid={`row-analytics-inactive-${u.userId}`}>
                    <span className="truncate">{u.firstName} {u.lastName} ({u.email})</span>
                    <span className="text-muted-foreground shrink-0 ml-2">{u.companyName} - {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}</span>
                  </div>
                </Link>
              ))}
              {worst.length > 5 && <p className="text-xs text-muted-foreground">+{worst.length - 5} more</p>}
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}

export default function AdminAnalytics() {
  const [activeTab, setActiveTab] = useState<string>("executive");

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="admin-analytics">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-analytics-title">Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Platform performance and business metrics</p>
      </div>

      <InactiveUsersAlert />

      <div className="flex gap-1 overflow-x-auto border-b pb-px">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-primary text-foreground font-medium"
                : "border-transparent text-muted-foreground"
            }`}
            data-testid={`tab-${tab.key}`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div>
        {activeTab === "executive" && <ExecutiveTab onDrillDown={setActiveTab} />}
        {activeTab === "accounts" && <AccountsTab />}
        {activeTab === "costs" && <CustomerCostsTab />}
        {activeTab === "billing" && <BillingTab />}
        {activeTab === "retention" && <RetentionTab />}
        {activeTab === "activation" && <ActivationTab />}
        {activeTab === "messaging" && <MessagingTab />}
        {activeTab === "economics" && <UnitEconomicsTab />}
      </div>
    </div>
  );
}
