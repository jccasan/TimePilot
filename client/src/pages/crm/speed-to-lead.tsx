import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "wouter";
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
  Save,
  RefreshCw,
  AlertTriangle,
  Settings2,
  LayoutList,
  Radio,
  Loader2,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { PricingTiersEditor, validatePricingTiers } from "@/components/PricingTiersEditor";
import type { PricingTier } from "@/components/PricingTiersEditor";
import type { PricingRulesConfig } from "@shared/schema";

type LrConfig = {
  leadResponseActive: boolean;
  lrPhoneNumber?: string | null;
  portingRequested?: boolean;
  billingMode?: string | null;
  depositPercent?: string | number | null;
  schedulingPlatform?: string | null;
  hcpApiKey?: string | null;
  serviceZipCodes?: string | null;
  outOfAreaMessage?: string | null;
  pricingTiers?: PricingTier[] | null;
  perDogAdder?: string | number | null;
  firstTimeCleanupFee?: string | number | null;
  followUpDelayHours?: number | null;
};

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

function LeadBoardTab({ isActive }: { isActive: boolean }) {
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ["/api/lead-response/dashboard"],
    enabled: isActive,
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
    enabled: isActive,
  });

  const { data: funnel, isLoading: funnelLoading } = useQuery<FunnelStage[]>({
    queryKey: ["/api/lead-response/funnel"],
    enabled: isActive,
  });

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
    <div className="space-y-8" data-testid="lead-response-dashboard">
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

function SetupTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: lrConfig, isLoading: lrLoading } = useQuery<LrConfig>({
    queryKey: ["/api/lead-response/config"],
  });

  const { data: spPricing } = useQuery<
    { id: string; name: string; basePrice: string; category: string }[]
  >({
    queryKey: ["/api/service-pricing"],
  });

  const { data: pricingConfig } = useQuery<{ pricingRules?: PricingRulesConfig }>({
    queryKey: ["/api/pricing-config"],
  });

  const toNum = (v: string | number | null | undefined): number | null => {
    if (v == null || v === "") return null;
    const n = parseFloat(String(v));
    return isNaN(n) ? null : n;
  };

  const initialTiersFromSP = (): PricingTier[] => {
    if (!spPricing) return [];
    const sizeMap: Record<string, number> = { small: 0, medium: 1, large: 2, "extra-large": 3 };
    const result: PricingTier[] = [
      { label: "", pricePerVisit: null },
      { label: "", pricePerVisit: null },
      { label: "", pricePerVisit: null },
      { label: "", pricePerVisit: null },
    ];
    const weekly = spPricing.filter(
      (p) => p.category === "recurring_service" && p.name.toLowerCase().includes("weekly")
    );
    for (const item of weekly) {
      const lower = item.name.toLowerCase();
      for (const [size, idx] of Object.entries(sizeMap)) {
        if (lower.includes(size) && result[idx].pricePerVisit === null) {
          result[idx] = { label: item.name, pricePerVisit: parseFloat(item.basePrice) || null };
        }
      }
    }
    return result;
  };

  const isScenarioA = (): boolean => {
    if (!spPricing) return false;
    return spPricing.some((p) => p.category === "recurring_service");
  };

  const [billingMode, setBillingMode] = useState(lrConfig?.billingMode ?? "post_service");
  const [depositPercent, setDepositPercent] = useState<number | null>(
    toNum(lrConfig?.depositPercent)
  );
  const [schedulingPlatform, setSchedulingPlatform] = useState(
    lrConfig?.schedulingPlatform ?? "scoopilot"
  );
  const [hcpApiKey, setHcpApiKey] = useState(lrConfig?.hcpApiKey ?? "");
  const [serviceZipCodes, setServiceZipCodes] = useState(lrConfig?.serviceZipCodes ?? "");
  const [outOfAreaMessage, setOutOfAreaMessage] = useState(lrConfig?.outOfAreaMessage ?? "");
  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>(lrConfig?.pricingTiers ?? []);
  const [perDogAdder, setPerDogAdder] = useState<number | null>(toNum(lrConfig?.perDogAdder));
  const [firstTimeCleanupFee, setFirstTimeCleanupFee] = useState<number | null>(
    toNum(lrConfig?.firstTimeCleanupFee)
  );
  const [followUpDelayHours, setFollowUpDelayHours] = useState<string>(
    String(lrConfig?.followUpDelayHours ?? 1)
  );
  const [provisionAreaCode, setProvisionAreaCode] = useState("");
  const [portNumber, setPortNumber] = useState("");
  const [tierErrors, setTierErrors] = useState<Record<string, string>>({});

  const provisionNumberMutation = useMutation({
    mutationFn: async () => {
      const code = provisionAreaCode.replace(/\D/g, "").slice(0, 3);
      if (code.length !== 3) throw new Error("Enter a valid 3-digit area code");
      const res = await apiRequest("POST", "/api/lead-response/provision-number", {
        areaCode: code,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Provisioning failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/lead-response/config"] });
      toast({
        title: "Number provisioned",
        description: `Your Lead Response number is ${data.phoneNumber}.`,
      });
      setProvisionAreaCode("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (lrConfig) {
      setBillingMode(lrConfig.billingMode ?? "post_service");
      setDepositPercent(toNum(lrConfig.depositPercent));
      setSchedulingPlatform(lrConfig.schedulingPlatform ?? "scoopilot");
      setHcpApiKey(lrConfig.hcpApiKey ?? "");
      setServiceZipCodes(lrConfig.serviceZipCodes ?? "");
      setOutOfAreaMessage(lrConfig.outOfAreaMessage ?? "");
      setPricingTiers(lrConfig.pricingTiers ?? []);
      setPerDogAdder(toNum(lrConfig.perDogAdder));
      setFirstTimeCleanupFee(toNum(lrConfig.firstTimeCleanupFee));
      setFollowUpDelayHours(String(lrConfig.followUpDelayHours ?? 1));
    }
  }, [lrConfig]);

  const syncStatus = useMemo((): "in_sync" | "drifted" | null => {
    const rules = pricingConfig?.pricingRules;
    const tiers = lrConfig?.pricingTiers;
    if (!rules || !Array.isArray(tiers) || tiers.length === 0) return null;
    const firstTierPrice = tiers[0]?.pricePerVisit;
    if (firstTierPrice == null) return null;
    if (Math.abs(rules.basePrices.weekly - firstTierPrice) >= 0.01) return "drifted";
    const lrAdder =
      typeof lrConfig?.perDogAdder === "number"
        ? lrConfig.perDogAdder
        : tiers.length >= 2 &&
            typeof tiers[1]?.pricePerVisit === "number" &&
            tiers[1].pricePerVisit > firstTierPrice
          ? tiers[1].pricePerVisit - firstTierPrice
          : null;
    if (lrAdder != null && Math.abs((rules.perDogRule?.surchargeAmount ?? 0) - lrAdder) >= 0.01) {
      return "drifted";
    }
    return "in_sync";
  }, [pricingConfig, lrConfig]);

  const handleSyncFromPricingEngine = useCallback(() => {
    const rules = pricingConfig?.pricingRules;
    if (!rules) return;
    const { weekly } = rules.basePrices;
    const { surchargeAmount, maxDogs } = rules.perDogRule;
    const tiers: PricingTier[] = [];
    const dogLimit = Math.min(Math.max(maxDogs, 3), 4);
    for (let dogs = 1; dogs <= dogLimit; dogs++) {
      const price = Math.round((weekly + (dogs - 1) * surchargeAmount) * 100) / 100;
      tiers.push({ label: `${dogs} Dog${dogs > 1 ? "s" : ""} - Weekly`, pricePerVisit: price });
    }
    setPricingTiers(tiers);
    setPerDogAdder(Math.round(surchargeAmount * 100) / 100);
    toast({ title: "Tiers synced from Pricing Engine", description: "Review and save to apply." });
  }, [pricingConfig, toast]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const effectiveTiers =
        pricingTiers.length > 0 ? pricingTiers : isScenarioA() ? initialTiersFromSP() : [];
      const errs = validatePricingTiers(effectiveTiers);
      if (Object.keys(errs).length > 0) {
        setTierErrors(errs);
        throw new Error("Tier validation failed");
      }
      setTierErrors({});
      const res = await apiRequest("PATCH", "/api/lead-response/config", {
        billingMode,
        depositPercent: billingMode === "pre_service" ? depositPercent : null,
        schedulingPlatform,
        hcpApiKey: schedulingPlatform === "housecall_pro" ? hcpApiKey : undefined,
        serviceZipCodes,
        outOfAreaMessage,
        pricingTiers: effectiveTiers,
        perDogAdder,
        firstTimeCleanupFee,
        followUpDelayHours: parseInt(followUpDelayHours) || 1,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/lead-response/config"] });
      toast({ title: "Lead Response settings saved" });
    },
    onError: (err: Error) => {
      if (err.message !== "Tier validation failed") {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    },
  });

  const requestNumberChangeMutation = useMutation({
    mutationFn: async (numberToPort?: string) => {
      const res = await apiRequest("POST", "/api/lead-response/request-number-change", {
        portingPhoneNumber: numberToPort ?? undefined,
      });
      if (!res.ok) throw new Error("Failed to submit request");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/lead-response/config"] });
      toast({ title: "Number change requested", description: "Our team will be in touch." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to submit request.", variant: "destructive" });
    },
  });

  if (lrLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (!lrConfig?.leadResponseActive) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
        <PhoneIncoming className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Lead Response is not active on this account.
        </p>
      </div>
    );
  }

  const outOfAreaLen = outOfAreaMessage.length;

  return (
    <div className="space-y-5 max-w-2xl" data-testid="section-lead-response">
      {/* Phone Number Section */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Lead Response Phone Number</Label>
        {lrConfig.lrPhoneNumber ? (
          <>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground mb-0.5">Your dedicated number</p>
              <p
                className="text-lg font-bold font-mono tracking-wide"
                data-testid="input-lr-phone-number"
              >
                {lrConfig.lrPhoneNumber}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => requestNumberChangeMutation.mutate(undefined)}
                disabled={requestNumberChangeMutation.isPending || !!lrConfig.portingRequested}
                data-testid="button-request-number-change"
              >
                {requestNumberChangeMutation.isPending ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : null}
                {lrConfig.portingRequested ? "Change request submitted" : "Request number change"}
              </Button>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed p-4 space-y-4">
            <div className="flex items-start gap-2">
              <Radio className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">No number assigned yet</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Provision a new number or request porting of your existing business number.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Option A — Get a new number
              </p>
              <div className="flex gap-2 items-end">
                <div className="space-y-1">
                  <Label htmlFor="provision-area-code" className="text-xs">
                    Area Code
                  </Label>
                  <Input
                    id="provision-area-code"
                    value={provisionAreaCode}
                    onChange={(e) =>
                      setProvisionAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))
                    }
                    placeholder="e.g. 404"
                    maxLength={3}
                    className="w-28 h-8 text-sm"
                    data-testid="input-lr-provision-area-code"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => provisionNumberMutation.mutate()}
                  disabled={
                    provisionNumberMutation.isPending ||
                    provisionAreaCode.replace(/\D/g, "").length !== 3
                  }
                  data-testid="button-provision-number"
                >
                  {provisionNumberMutation.isPending ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : null}
                  Provision Number
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                We'll assign a new Telnyx number in your preferred area code.
              </p>
            </div>

            <div className="border-t pt-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Option B — Port your existing number
              </p>
              <div className="flex gap-2 items-end">
                <div className="space-y-1">
                  <Label htmlFor="port-number" className="text-xs">
                    Your current number
                  </Label>
                  <Input
                    id="port-number"
                    value={portNumber}
                    onChange={(e) => setPortNumber(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="w-44 h-8 text-sm"
                    data-testid="input-lr-port-number"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => requestNumberChangeMutation.mutate(portNumber.trim() || undefined)}
                  disabled={
                    requestNumberChangeMutation.isPending ||
                    !!lrConfig.portingRequested ||
                    !portNumber.trim()
                  }
                  data-testid="button-request-port"
                >
                  {requestNumberChangeMutation.isPending ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : null}
                  {lrConfig.portingRequested ? "Port request submitted" : "Request Port"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Porting typically takes 2–4 weeks. Our team will be in touch.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Billing Mode</Label>
        <Select value={billingMode} onValueChange={setBillingMode}>
          <SelectTrigger data-testid="select-lr-billing-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="post_service">Post-service</SelectItem>
            <SelectItem value="pre_service">Pre-service (deposit required)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {billingMode === "pre_service" && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Deposit Percent</Label>
          <div className="relative max-w-36">
            <Input
              type="number"
              min="0"
              max="100"
              step="1"
              value={depositPercent != null ? String(depositPercent) : ""}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                setDepositPercent(isNaN(n) ? null : Math.min(100, Math.max(0, n)));
              }}
              placeholder="0"
              className="pr-7"
              data-testid="input-lr-deposit-percent"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
              %
            </span>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Scheduling Platform</Label>
        <Select value={schedulingPlatform} onValueChange={setSchedulingPlatform}>
          <SelectTrigger data-testid="select-lr-scheduling-platform">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="scoopilot">ScooPilot</SelectItem>
            <SelectItem value="housecall_pro">HouseCallPro</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {schedulingPlatform === "housecall_pro" && (
        <div className="space-y-2 rounded-lg border p-3 bg-muted/30">
          <Label className="text-sm font-medium">HouseCall Pro API Key</Label>
          <p className="text-xs text-muted-foreground">
            To find your API key: log in to HouseCall Pro, go to{" "}
            <strong>Settings &rarr; Integrations &rarr; API</strong>, and copy your key.
          </p>
          <Input
            type="password"
            value={hcpApiKey}
            onChange={(e) => setHcpApiKey(e.target.value)}
            placeholder="hcp_..."
            data-testid="input-lr-hcp-api-key"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Service ZIP Codes</Label>
        <p className="text-xs text-muted-foreground">
          Comma-separated list of ZIP codes you serve (e.g. 30301, 30302, 30303)
        </p>
        <Input
          value={serviceZipCodes}
          onChange={(e) => setServiceZipCodes(e.target.value)}
          placeholder="30301, 30302, 30303"
          data-testid="input-lr-service-zip-codes"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Out of Area Message</Label>
          <span
            className={`text-xs ${outOfAreaLen > 160 ? "text-red-500" : "text-muted-foreground"}`}
          >
            {outOfAreaLen} / 160
          </span>
        </div>
        <Textarea
          value={outOfAreaMessage}
          onChange={(e) => setOutOfAreaMessage(e.target.value)}
          placeholder="Sorry, we don't currently service your area..."
          rows={2}
          maxLength={160}
          data-testid="input-lr-out-of-area-message"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Follow-up Reminder Timing</Label>
        <p className="text-xs text-muted-foreground">
          How long after receiving a new lead to send an automated follow-up reminder if no
          appointment has been scheduled.
        </p>
        <Select value={followUpDelayHours} onValueChange={setFollowUpDelayHours}>
          <SelectTrigger className="w-48" data-testid="select-lr-followup-delay">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1 hour</SelectItem>
            <SelectItem value="2">2 hours</SelectItem>
            <SelectItem value="4">4 hours</SelectItem>
            <SelectItem value="8">8 hours</SelectItem>
            <SelectItem value="24">24 hours</SelectItem>
            <SelectItem value="48">48 hours</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border-t pt-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Pricing Tiers</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isScenarioA()
                ? "Tiers 1–4 are pre-filled from your SP pricing. Review and adjust before saving."
                : "Define your pricing tiers. Tiers 1–3 are required."}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {syncStatus === "in_sync" && (
              <Badge
                variant="outline"
                className="text-xs gap-1 text-green-700 border-green-300 bg-green-50 dark:text-green-400 dark:border-green-700 dark:bg-green-950/30"
                data-testid="badge-pricing-sync-status"
              >
                <CheckCircle2 className="h-3 w-3" />
                In sync with Pricing Engine
              </Badge>
            )}
            {syncStatus === "drifted" && (
              <Badge
                variant="outline"
                className="text-xs gap-1 text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:bg-amber-950/30"
                data-testid="badge-pricing-sync-status"
              >
                <AlertTriangle className="h-3 w-3" />
                Differs from Pricing Engine
              </Badge>
            )}
            {pricingConfig?.pricingRules ? (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={handleSyncFromPricingEngine}
                data-testid="button-sync-from-pricing-engine"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Sync from Pricing Engine
              </Button>
            ) : (
              <Link href="/pricing">
                <span className="text-xs text-muted-foreground underline hover:text-foreground cursor-pointer">
                  Configure Pricing Engine
                </span>
              </Link>
            )}
          </div>
        </div>
        <PricingTiersEditor
          value={pricingTiers}
          onChange={setPricingTiers}
          perDogAdder={perDogAdder}
          onPerDogAdderChange={setPerDogAdder}
          firstTimeCleanupFee={firstTimeCleanupFee}
          onFirstTimeCleanupFeeChange={setFirstTimeCleanupFee}
          depositPercent={billingMode === "pre_service" ? depositPercent : null}
          onDepositPercentChange={setDepositPercent}
          showDepositPercent={false}
          initialTiers={isScenarioA() ? initialTiersFromSP() : undefined}
          errors={tierErrors}
        />
      </div>

      <Button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        data-testid="button-save-lead-response"
      >
        <Save className="h-4 w-4 mr-2" />
        {saveMutation.isPending ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  );
}

export default function SpeedToLeadPage() {
  const [activeTab, setActiveTab] = useState<"board" | "setup">("board");

  const { data: config, isLoading: configLoading } = useQuery<{ leadResponseActive: boolean }>({
    queryKey: ["/api/lead-response/config"],
  });

  if (configLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>
    );
  }

  const tabs = [
    { key: "board" as const, label: "Lead Board", icon: LayoutList },
    { key: "setup" as const, label: "Setup", icon: Settings2 },
  ];

  return (
    <div className="p-4 md:p-6 overflow-auto h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" data-testid="text-speed-to-lead-title">
          Speed to Lead
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Monitor your inbound lead funnel and configure your Lead Response settings.
        </p>
      </div>

      {!config?.leadResponseActive && activeTab === "board" ? (
        <div className="max-w-lg mx-auto mt-8 text-center">
          <PhoneIncoming className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-40" />
          <h2 className="text-xl font-semibold mb-2">Lead Response Not Active</h2>
          <p className="text-muted-foreground text-sm mb-4">
            Your company does not currently have Lead Response enabled. Contact support to get
            started, or configure your settings below.
          </p>
          <Button variant="outline" onClick={() => setActiveTab("setup")}>
            <Settings2 className="h-4 w-4 mr-2" />
            Go to Setup
          </Button>
        </div>
      ) : (
        <>
          <div className="flex border-b mb-6">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`tab-stl-${key}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {activeTab === "board" && <LeadBoardTab isActive={config?.leadResponseActive === true} />}
          {activeTab === "setup" && <SetupTab />}
        </>
      )}
    </div>
  );
}
