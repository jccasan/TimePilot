import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PhoneIncoming,
  Users,
  DollarSign,
  CheckCircle2,
  XCircle,
  TrendingUp,
  ChevronUp,
  ChevronDown,
  ArrowRight,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface DashboardSummary {
  newToday: number;
  estimateSentLast30: number;
  depositPendingCount: number;
  depositPendingValue: number;
  depositPaidMonthCount: number;
  depositPaidMonthValue: number;
  scheduledThisMonth: number;
  deadThisMonth: number;
}

interface LeadRow {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  yardSize: string | null;
  numberOfDogs: number | null;
  leadResponseStatus: string | null;
  depositAmount: string | null;
  estimateAmount: string | null;
  createdAt: string;
}

interface LeadsResponse {
  leads: LeadRow[];
  total: number;
}

interface FunnelStage {
  stage: string;
  label: string;
  count: number;
}

type SortField = "status" | "createdAt";
type SortDir = "asc" | "desc";

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  estimate_sent: "Estimate Sent",
  deposit_pending: "Deposit Pending",
  deposit_paid: "Deposit Paid",
  scheduled: "Scheduled",
  dead: "Dead",
};

const STATUS_BADGE_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  estimate_sent: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  deposit_pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  deposit_paid: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  scheduled: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  dead: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const FUNNEL_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#059669"];

function SummaryCardSkeleton() {
  return (
    <Card>
      <CardContent className="pt-4 pb-4 px-4">
        <Skeleton className="h-3 w-24 mb-3" />
        <Skeleton className="h-7 w-16 mb-1" />
        <Skeleton className="h-3 w-20" />
      </CardContent>
    </Card>
  );
}

export default function LeadResponseDashboard() {
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const { data: config, isLoading: configLoading } = useQuery<{ leadResponseActive: boolean }>({
    queryKey: ["/api/lead-response/config"],
  });

  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ["/api/lead-response/dashboard"],
    enabled: config?.leadResponseActive === true,
  });

  const { data: leadsData, isLoading: leadsLoading } = useQuery<LeadsResponse>({
    queryKey: ["/api/lead-response/leads", sortField, sortDir, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        sortField,
        sortDir,
        page: String(page),
        limit: String(pageSize),
      });
      const res = await fetch(`/api/lead-response/leads?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch leads");
      return res.json();
    },
    enabled: config?.leadResponseActive === true,
  });

  const { data: funnel, isLoading: funnelLoading } = useQuery<FunnelStage[]>({
    queryKey: ["/api/lead-response/funnel"],
    enabled: config?.leadResponseActive === true,
  });

  if (configLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>
    );
  }

  if (!config?.leadResponseActive) {
    return (
      <div className="p-6 max-w-lg mx-auto mt-16 text-center">
        <PhoneIncoming className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-40" />
        <h2 className="text-xl font-semibold mb-2">Lead Response Not Active</h2>
        <p className="text-muted-foreground text-sm">
          Your company does not currently have Lead Response enabled. Contact support to get
          started.
        </p>
      </div>
    );
  }

  const totalLeads = leadsData?.total ?? 0;
  const totalPages = Math.ceil(totalLeads / pageSize);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
    setPage(1);
  }

  const summaryCards = [
    {
      label: "New Leads Today",
      value: summary?.newToday ?? 0,
      sub: null,
      icon: PhoneIncoming,
      iconColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
      testId: "card-lr-new-today",
    },
    {
      label: "Estimates Sent",
      value: summary?.estimateSentLast30 ?? 0,
      sub: "last 30 days",
      icon: TrendingUp,
      iconColor: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
      testId: "card-lr-estimates-sent",
    },
    {
      label: "Deposit Pending",
      value: summary?.depositPendingCount ?? 0,
      sub:
        (summary?.depositPendingValue ?? 0) > 0
          ? `$${summary!.depositPendingValue.toFixed(2)} outstanding`
          : null,
      icon: DollarSign,
      iconColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
      testId: "card-lr-deposit-pending",
    },
    {
      label: "Deposit Paid",
      value: summary?.depositPaidMonthCount ?? 0,
      sub:
        (summary?.depositPaidMonthValue ?? 0) > 0
          ? `$${summary!.depositPaidMonthValue.toFixed(2)} this month`
          : "this month",
      icon: CheckCircle2,
      iconColor: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
      testId: "card-lr-deposit-paid",
    },
    {
      label: "Scheduled",
      value: summary?.scheduledThisMonth ?? 0,
      sub: "this month",
      icon: Users,
      iconColor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
      testId: "card-lr-scheduled",
    },
    {
      label: "Dead Leads",
      value: summary?.deadThisMonth ?? 0,
      sub: "this month",
      icon: XCircle,
      iconColor: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
      testId: "card-lr-dead",
    },
  ];

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto" data-testid="lead-response-dashboard">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-lr-title">
          Lead Response
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Monitor your inbound lead funnel and conversion pipeline
        </p>
      </div>

      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4"
        data-testid="section-lr-summary-cards"
      >
        {summaryLoading
          ? Array.from({ length: 6 }).map((_, i) => <SummaryCardSkeleton key={i} />)
          : summaryCards.map((card) => (
              <Card key={card.label} data-testid={card.testId}>
                <CardContent className="pt-4 pb-4 px-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`p-1.5 rounded-md ${card.iconColor}`}>
                      <card.icon className="h-3.5 w-3.5" />
                    </div>
                    <p className="text-xs text-muted-foreground leading-tight">{card.label}</p>
                  </div>
                  <p className="text-2xl font-bold tabular-nums">{card.value.toLocaleString()}</p>
                  {card.sub && <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>}
                </CardContent>
              </Card>
            ))}
      </div>

      <div data-testid="section-lr-funnel">
        <h2 className="text-lg font-semibold mb-3">Lead Funnel</h2>
        <Card>
          <CardContent className="pt-4 pb-4 px-4">
            {funnelLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : !funnel || funnel.every((s) => s.count === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-6">No lead data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={funnel}
                  layout="vertical"
                  margin={{ top: 4, right: 60, left: 100, bottom: 4 }}
                >
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 12 }} width={96} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as FunnelStage;
                      return (
                        <div className="bg-popover border rounded px-3 py-2 text-xs shadow-md">
                          <p className="font-medium">{d.label}</p>
                          <p>{d.count.toLocaleString()} leads</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {funnel.map((entry, index) => (
                      <Cell key={entry.stage} fill={FUNNEL_COLORS[index % FUNNEL_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div data-testid="section-lr-recent-leads">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Recent Leads</h2>
          {totalLeads > 0 && (
            <p className="text-sm text-muted-foreground">{totalLeads.toLocaleString()} total</p>
          )}
        </div>
        <Card>
          <CardContent className="p-0">
            {leadsLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !leadsData?.leads.length ? (
              <div className="py-12 text-center text-muted-foreground">
                <PhoneIncoming className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No leads yet</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-lr-leads">
                    <thead>
                      <tr className="border-b text-left bg-muted/30">
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">Name</th>
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">Phone</th>
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">Address</th>
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">Yard</th>
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">Dogs</th>
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">Estimate</th>
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">Deposit</th>
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">
                          <button
                            className="flex items-center gap-1 hover:text-foreground transition-colors"
                            onClick={() => handleSort("status")}
                            data-testid="sort-status"
                          >
                            Status
                            {sortField === "status" ? (
                              sortDir === "asc" ? (
                                <ChevronUp className="h-3 w-3" />
                              ) : (
                                <ChevronDown className="h-3 w-3" />
                              )
                            ) : (
                              <ChevronDown className="h-3 w-3 opacity-30" />
                            )}
                          </button>
                        </th>
                        <th className="px-4 py-2.5 font-medium text-muted-foreground">
                          <button
                            className="flex items-center gap-1 hover:text-foreground transition-colors"
                            onClick={() => handleSort("createdAt")}
                            data-testid="sort-date"
                          >
                            Submitted
                            {sortField === "createdAt" ? (
                              sortDir === "asc" ? (
                                <ChevronUp className="h-3 w-3" />
                              ) : (
                                <ChevronDown className="h-3 w-3" />
                              )
                            ) : (
                              <ChevronDown className="h-3 w-3 opacity-30" />
                            )}
                          </button>
                        </th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {leadsData.leads.map((lead, i) => (
                        <tr
                          key={lead.id}
                          className="border-b last:border-0 hover:bg-muted/40 transition-colors cursor-pointer"
                          data-testid={`row-lr-lead-${lead.id}`}
                          onClick={() => (window.location.href = `/contacts/${lead.id}`)}
                        >
                          <td className="px-4 py-3 font-medium">
                            {lead.firstName} {lead.lastName}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{lead.phone || "—"}</td>
                          <td className="px-4 py-3 text-muted-foreground max-w-[180px] truncate">
                            {[lead.streetAddress, lead.city, lead.state]
                              .filter(Boolean)
                              .join(", ") || "—"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {lead.yardSize || "—"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {lead.numberOfDogs ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {lead.estimateAmount
                              ? `$${parseFloat(lead.estimateAmount).toFixed(2)}`
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {lead.depositAmount
                              ? `$${parseFloat(lead.depositAmount).toFixed(2)}`
                              : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {lead.leadResponseStatus ? (
                              <Badge
                                className={`text-xs ${STATUS_BADGE_COLORS[lead.leadResponseStatus] ?? ""}`}
                                data-testid={`badge-status-${i}`}
                              >
                                {STATUS_LABELS[lead.leadResponseStatus] ?? lead.leadResponseStatus}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {new Date(lead.createdAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/contacts/${lead.id}`}
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`link-lead-detail-${lead.id}`}
                            >
                              <ArrowRight className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t">
                    <p className="text-xs text-muted-foreground">
                      Page {page} of {totalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                        data-testid="button-prev-page"
                      >
                        Previous
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        data-testid="button-next-page"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
