import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Building2, DollarSign, TrendingUp, AlertTriangle,
  CreditCard, Repeat, Target, MessageSquare, Calculator, Search,
  ChevronRight, ArrowUpRight, ArrowDownRight, Activity,
  Mail, Phone, BarChart3, Wallet, ArrowUpDown, Plus, Pencil,
  Filter, Cpu,
} from "lucide-react";
import { TIER_CONFIG } from "@shared/schema";
import { useState, useMemo } from "react";
import { adminFetchFn, adminRequest } from "@/lib/adminApi";

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
        <StatCard label="Total Overhead" value={fmt(data?.totalOverhead)} icon={Wallet} subtitle="last 30 days" onClick={() => onDrillDown("costs")} />
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
                    <TableHead className="text-right">Telnyx</TableHead>
                    <TableHead className="text-right">Email</TableHead>
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
                      <TableCell className="text-right text-muted-foreground">{fmt(m.telnyxCost)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmt(m.emailCost)}</TableCell>
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

const COST_FIELDS = [
  { key: "hostingCents", label: "Hosting (Replit)" },
  { key: "dbCents", label: "Database" },
  { key: "emailPlatformCents", label: "Email Platform" },
  { key: "smsPlatformCents", label: "SMS Platform" },
  { key: "monitoringCents", label: "Monitoring" },
  { key: "supportLaborCents", label: "Support Labor" },
  { key: "otherCents", label: "Other" },
] as const;

function FixedCostsSection() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMonth, setEditMonth] = useState("");
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const { data: fixedCosts, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/analytics/fixed-costs"],
    queryFn: adminFetchFn("/api/admin/analytics/fixed-costs"),
  });

  const mutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await adminRequest("PUT", "/api/admin/analytics/fixed-costs", body);
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics/fixed-costs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics/customer-costs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics/executive"] });
      setDialogOpen(false);
    },
  });

  const cFmt = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const openNew = () => {
    const now = new Date();
    const m = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    setEditMonth(m);
    setFormValues({});
    setDialogOpen(true);
  };

  const openEdit = (row: any) => {
    setEditMonth(row.month);
    const vals: Record<string, string> = {};
    for (const f of COST_FIELDS) {
      vals[f.key] = ((row[f.key] ?? 0) / 100).toFixed(2);
    }
    setFormValues(vals);
    setDialogOpen(true);
  };

  const handleSave = () => {
    const body: any = { month: editMonth };
    for (const f of COST_FIELDS) {
      body[f.key] = Math.round(parseFloat(formValues[f.key] || "0") * 100);
    }
    mutation.mutate(body);
  };

  const formTotal = COST_FIELDS.reduce((s, f) => s + (parseFloat(formValues[f.key] || "0") || 0), 0);

  const currentMonthKey = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  })();

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Monthly Fixed Costs</CardTitle>
          <Button size="sm" variant="outline" onClick={openNew} data-testid="button-add-fixed-cost">
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Month
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : !fixedCosts?.length ? (
          <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-no-fixed-costs">No fixed costs entered yet. Add your monthly platform costs to see accurate overhead calculations.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  {COST_FIELDS.map(f => <TableHead key={f.key} className="text-right">{f.label}</TableHead>)}
                  <TableHead className="text-right font-medium">Total</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fixedCosts.map((row: any) => {
                  const total = COST_FIELDS.reduce((s, f) => s + (row[f.key] ?? 0), 0);
                  const isCurrent = row.month === currentMonthKey;
                  return (
                    <TableRow key={row.id} className={isCurrent ? "bg-primary/5" : ""} data-testid={`row-fixed-cost-${row.month}`}>
                      <TableCell className="font-medium">
                        {row.month}
                        {isCurrent && <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0">current</Badge>}
                      </TableCell>
                      {COST_FIELDS.map(f => (
                        <TableCell key={f.key} className="text-right text-muted-foreground">{cFmt(row[f.key] ?? 0)}</TableCell>
                      ))}
                      <TableCell className="text-right font-medium">{cFmt(total)}</TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(row)} data-testid={`button-edit-fixed-cost-${row.month}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-fixed-costs">
          <DialogHeader>
            <DialogTitle>{formValues.hostingCents !== undefined ? "Edit" : "Add"} Monthly Fixed Costs</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="fc-month">Month</Label>
              <Input id="fc-month" type="month" value={editMonth} onChange={(e) => setEditMonth(e.target.value)} data-testid="input-fixed-cost-month" />
            </div>
            {COST_FIELDS.map(f => (
              <div key={f.key} className="flex items-center gap-3">
                <Label className="w-36 shrink-0 text-sm">{f.label}</Label>
                <div className="relative flex-1">
                  <span className="absolute left-2.5 top-2 text-sm text-muted-foreground">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    className="pl-6"
                    value={formValues[f.key] ?? ""}
                    onChange={(e) => setFormValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder="0.00"
                    data-testid={`input-fixed-cost-${f.key}`}
                  />
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm font-medium">Total</span>
              <span className="text-sm font-bold" data-testid="text-fixed-cost-total">${formTotal.toFixed(2)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-fixed-cost">Cancel</Button>
            <Button onClick={handleSave} disabled={mutation.isPending} data-testid="button-save-fixed-cost">
              {mutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
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
    <TooltipProvider>
    <div className="space-y-6" data-testid="tab-content-overhead">
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
                  <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort("costRatioPct")}>Cost Ratio<SortIcon col="costRatioPct" /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground" data-testid="text-no-customer-costs">No customers found</TableCell></TableRow>
                ) : sorted.map((r: any) => {
                  const tierConfig = TIER_CONFIG[r.subscriptionTier as keyof typeof TIER_CONFIG];
                  const barPct = Math.min(r.costRatioPct, 100);
                  const barColor = r.costRatioPct > 100 ? "bg-red-500" : r.costRatioPct > 70 ? "bg-yellow-500" : "bg-green-500";
                  const smsTip = `${r.smsSegments} segments × $0.0075 = ${cFmt(r.smsCostCents)}`;
                  const emailTip = `${r.emailCount} emails × $0.001 = ${cFmt(r.emailCostCents)}`;
                  const voiceTip = `${r.voiceMinutes} min × $0.50 = ${cFmt(r.voiceCostCents)}`;
                  const stripeTip = r.stripeFeesPassedThrough
                    ? "Passed to clients"
                    : `${r.paidInvoiceCount} inv × $0.30 + $${Number(r.paidInvoiceTotal ?? 0).toFixed(2)} × 2.9% = ${cFmt(r.stripeFeesCents)}`;
                  const infraTip = `Plan weight allocation = ${cFmt(r.allocatedInfraCents)}`;
                  const totalTip = `SMS ${cFmt(r.smsCostCents)} + Email ${cFmt(r.emailCostCents)} + Voice ${cFmt(r.voiceCostCents)} + Stripe ${cFmt(r.stripeFeesCents)} + Infra ${cFmt(r.allocatedInfraCents)} = ${cFmt(r.totalCostCents)}`;
                  const marginTip = `MRR ${cFmt(r.mrrCents)} − SMS ${cFmt(r.smsCostCents)} − Email ${cFmt(r.emailCostCents)} − Voice ${cFmt(r.voiceCostCents)} − Stripe ${cFmt(r.stripeFeesCents)} − Infra ${cFmt(r.allocatedInfraCents)} = ${cFmt(r.netMarginCents)}`;
                  return (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/admin/companies/${r.id}`)} data-testid={`row-customer-cost-${r.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2" data-testid={`link-customer-${r.id}`}>
                          <div className="min-w-0">
                            <p className="font-medium truncate text-sm" data-testid={`text-customer-name-${r.id}`}>{r.name}</p>
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className="text-[10px] px-1 py-0">{tierConfig?.name || r.subscriptionTier}</Badge>
                              {r.subscriptionStatus !== "active" && <Badge variant="destructive" className="text-[10px] px-1 py-0">{r.subscriptionStatus}</Badge>}
                              {r.stripeFeesPassedThrough && <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-400 text-blue-600 dark:text-blue-400">fees→client</Badge>}
                            </div>
                          </div>
                          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium" data-testid={`text-mrr-${r.id}`}>{cFmt(r.mrrCents)}</TableCell>
                      <TableCell className="text-right text-muted-foreground" data-testid={`text-sms-cost-${r.id}`}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted">{cFmt(r.smsCostCents)}</span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">{smsTip}</p></TooltipContent>
                        </Tooltip>
                        <span className="text-[10px] block">{r.smsSegments} seg</span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground" data-testid={`text-email-cost-${r.id}`}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted">{cFmt(r.emailCostCents)}</span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">{emailTip}</p></TooltipContent>
                        </Tooltip>
                        <span className="text-[10px] block">{r.emailCount}</span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground" data-testid={`text-voice-cost-${r.id}`}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted">{cFmt(r.voiceCostCents)}</span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">{voiceTip}</p></TooltipContent>
                        </Tooltip>
                        <span className="text-[10px] block">{r.voiceMinutes} min</span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground" data-testid={`text-stripe-cost-${r.id}`}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted">{r.stripeFeesPassedThrough ? "$0.00" : cFmt(r.stripeFeesCents)}</span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs max-w-[240px]">{stripeTip}</p></TooltipContent>
                        </Tooltip>
                        <span className="text-[10px] block">{r.paidInvoiceCount} inv</span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground" data-testid={`text-infra-cost-${r.id}`}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted">{cFmt(r.allocatedInfraCents)}</span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">{infraTip}</p></TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-right font-medium" data-testid={`text-total-cost-${r.id}`}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted">{cFmt(r.totalCostCents)}</span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs max-w-[280px]">{totalTip}</p></TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`font-medium cursor-help underline decoration-dotted ${r.netMarginCents >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`} data-testid={`text-margin-${r.id}`}>
                              {cFmt(r.netMarginCents)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs max-w-[320px]">{marginTip}</p></TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-right" data-testid={`text-cost-ratio-${r.id}`}>
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barPct}%` }} />
                          </div>
                          <span className={`text-xs font-medium ${r.costRatioPct > 100 ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>{r.costRatioPct >= 999 ? "N/A" : `${r.costRatioPct}%`}</span>
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

      <FixedCostsSection />
    </div>
    </TooltipProvider>
  );
}

type FunnelStep = { step: string; event: string; sessions: number; pct: number };
type FunnelZip = { zipCode: string; submissions: number };
type FunnelCompany = { companyId: string; companyName: string; loaded: number; zipPassed: number; submitted: number; quoteShown: number; conversionPct: number };
type FunnelData = {
  days: number;
  totalSessions: number;
  totalEvents: number;
  funnel: FunnelStep[];
  embedVsDirect: { embed?: number; direct?: number };
  daily: Record<string, Record<string, number>>;
  byCompany: FunnelCompany[];
  topZipCodes: FunnelZip[];
  overallConversion: number;
};

function FunnelTab() {
  const [days, setDays] = useState("30");
  const { data, isLoading } = useQuery<FunnelData>({
    queryKey: ["/api/admin/analytics/quote-funnel", days],
    queryFn: adminFetchFn(`/api/admin/analytics/quote-funnel?days=${days}`),
  });

  if (isLoading) return <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;

  const funnel: FunnelStep[] = data?.funnel || [];
  const topLoaded = funnel.find((f) => f.event === "form_loaded")?.sessions || 0;

  return (
    <div className="space-y-6" data-testid="tab-content-funnel">
      <div className="flex items-center gap-3">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-36" data-testid="select-funnel-days">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground">
          {data?.totalSessions ?? 0} unique sessions · {data?.totalEvents ?? 0} events
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Sessions" value={data?.totalSessions ?? 0} icon={BarChart3} />
        <StatCard label="Conversion Rate" value={pct(data?.overallConversion)} icon={Target} />
        <StatCard
          label="Embed Sessions"
          value={data?.embedVsDirect?.embed ?? 0}
          icon={Activity}
          subtitle={`${data?.embedVsDirect?.direct ?? 0} direct`}
        />
        <StatCard
          label="Submitted"
          value={funnel.find((f) => f.event === "submitted")?.sessions ?? 0}
          icon={ArrowUpRight}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Conversion Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          {funnel.length > 0 ? (
            <div className="space-y-3">
              {funnel.map((f, idx) => {
                const widthPct = topLoaded > 0 ? Math.max((f.sessions / topLoaded) * 100, 4) : 0;
                const prevSessions = idx > 0 ? funnel[idx - 1].sessions : f.sessions;
                const dropoff = prevSessions > 0 ? ((prevSessions - f.sessions) / prevSessions * 100) : 0;
                return (
                  <div key={f.event} data-testid={`row-funnel-${f.event}`}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium">{f.step}</span>
                      <div className="flex items-center gap-3">
                        <span className="tabular-nums" data-testid={`text-funnel-count-${f.event}`}>{f.sessions}</span>
                        <Badge variant="outline" data-testid={`badge-funnel-pct-${f.event}`}>{pct(f.pct)}</Badge>
                        {idx > 0 && dropoff > 0 && (
                          <span className="text-xs text-red-500" data-testid={`text-funnel-drop-${f.event}`}>
                            -{dropoff.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="h-6 bg-muted rounded-md overflow-hidden">
                      <div
                        className="h-full rounded-md transition-all duration-500"
                        style={{
                          width: `${widthPct}%`,
                          backgroundColor: idx < 3 ? "hsl(var(--primary))" : idx < 5 ? "hsl(var(--primary) / 0.7)" : "hsl(142 60% 45%)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-funnel-data">
              No funnel data yet. Events will appear once visitors use the quote form.
            </p>
          )}
        </CardContent>
      </Card>

      {(data?.topZipCodes?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top ZIP Codes by Submissions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data!.topZipCodes!.map((z) => (
                <div key={z.zipCode} className="flex items-center justify-between gap-2" data-testid={`row-zip-${z.zipCode}`}>
                  <span className="text-sm font-mono" data-testid={`text-zip-code-${z.zipCode}`}>{z.zipCode}</span>
                  <Badge variant="outline" data-testid={`badge-zip-count-${z.zipCode}`}>{z.submissions} submissions</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(data?.byCompany?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By Company</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead className="text-center">Loaded</TableHead>
                  <TableHead className="text-center">ZIP Passed</TableHead>
                  <TableHead className="text-center">Submitted</TableHead>
                  <TableHead className="text-center">Conversion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data!.byCompany!.map((c) => (
                  <TableRow key={c.companyId} data-testid={`row-funnel-company-${c.companyId}`}>
                    <TableCell className="font-medium truncate max-w-[200px]" data-testid={`text-funnel-company-${c.companyId}`}>{c.companyName}</TableCell>
                    <TableCell className="text-center">{c.loaded}</TableCell>
                    <TableCell className="text-center">{c.zipPassed}</TableCell>
                    <TableCell className="text-center">{c.submitted}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={c.conversionPct >= 10 ? "default" : "outline"} data-testid={`badge-funnel-conv-${c.companyId}`}>
                        {pct(c.conversionPct)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const TABS = [
  { key: "executive", label: "Executive", icon: BarChart3 },
  { key: "accounts", label: "Accounts", icon: Building2 },
  { key: "costs", label: "Overhead", icon: Wallet },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "retention", label: "Retention", icon: Repeat },
  { key: "activation", label: "Activation", icon: Target },
  { key: "messaging", label: "Messaging", icon: MessageSquare },
  { key: "economics", label: "Unit Economics", icon: Calculator },
  { key: "funnel", label: "Quote Funnel", icon: Filter },
  { key: "api-usage", label: "API Usage", icon: Cpu },
] as const;

const PROVIDER_COLORS: Record<string, string> = {
  mapbox: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  openai: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  telnyx: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  sendgrid: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  retell: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  stripe: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
};

interface ApiProvider {
  provider: string;
  metric: string;
  label: string;
  calls: number;
  costCents: number;
  daily: Record<string, number>;
  unit: string;
}

interface ApiUsageData {
  providers: ApiProvider[];
  totalCalls: number;
  totalCostCents: number;
  days: number;
}

function MiniSparkline({ daily, days }: { daily: Record<string, number>; days: number }) {
  const bars: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    bars.push(daily[key] || 0);
  }
  const max = Math.max(...bars, 1);
  return (
    <div className="flex items-end gap-px h-8" data-testid="sparkline">
      {bars.map((v, i) => (
        <div
          key={i}
          className="flex-1 bg-primary/40 rounded-sm min-w-px"
          style={{ height: `${Math.max((v / max) * 100, v > 0 ? 8 : 2)}%` }}
        />
      ))}
    </div>
  );
}

function ApiUsageTab() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery<ApiUsageData>({
    queryKey: ["/api/admin/api-usage", days],
    queryFn: adminFetchFn(`/api/admin/api-usage?days=${days}`),
  });

  const totalCalls = data?.totalCalls ?? 0;
  const totalCost = (data?.totalCostCents ?? 0) / 100;

  return (
    <div className="space-y-6" data-testid="api-usage-tab">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">API Usage</h2>
          <p className="text-sm text-muted-foreground">Third-party API calls and estimated costs across all services</p>
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-32" data-testid="select-api-days">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="60">Last 60 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total API Calls</p>
            {isLoading ? <Skeleton className="h-7 w-24 mt-1" /> : (
              <p className="text-2xl font-bold mt-1" data-testid="text-total-api-calls">{totalCalls.toLocaleString()}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Est. Total Cost</p>
            {isLoading ? <Skeleton className="h-7 w-24 mt-1" /> : (
              <p className="text-2xl font-bold mt-1" data-testid="text-total-api-cost">{fmt(totalCost)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Mapbox Calls</p>
            {isLoading ? <Skeleton className="h-7 w-24 mt-1" /> : (
              <p className="text-2xl font-bold mt-1" data-testid="text-mapbox-calls">
                {(data?.providers.filter(p => p.provider === "mapbox").reduce((a, p) => a + p.calls, 0) ?? 0).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">OpenAI Calls</p>
            {isLoading ? <Skeleton className="h-7 w-24 mt-1" /> : (
              <p className="text-2xl font-bold mt-1" data-testid="text-openai-calls">
                {(data?.providers.find(p => p.provider === "openai")?.calls ?? 0).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider / Service</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">Est. Cost</TableHead>
                <TableHead className="w-32">Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-32" /></TableCell>
                  </TableRow>
                ))
              ) : (
                data?.providers.map((p) => (
                  <TableRow key={`${p.provider}-${p.metric}`} data-testid={`row-api-${p.provider}-${p.metric}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge className={`text-xs ${PROVIDER_COLORS[p.provider] || "bg-muted"}`}>
                          {p.provider}
                        </Badge>
                        <span className="text-sm">{p.label}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{p.calls.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{p.unit}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmt(p.costCents / 100)}</TableCell>
                    <TableCell>
                      <MiniSparkline daily={p.daily} days={Math.min(days, 30)} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="bg-muted/30">
        <CardContent className="pt-4 pb-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Cost estimates</span> are approximations based on standard public pricing:
            Mapbox $0.00075/call, OpenAI ~$0.003/call (gpt-5-mini), Telnyx $0.0075/segment, SendGrid $0.001/email, Retell $0.005/min, Stripe 2.9%+$0.30.
            Mapbox and OpenAI calls are tracked from when this feature was deployed; historical data starts accumulating now.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

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
        {activeTab === "funnel" && <FunnelTab />}
        {activeTab === "api-usage" && <ApiUsageTab />}
      </div>
    </div>
  );
}
