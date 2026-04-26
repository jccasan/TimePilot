import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, Contact2, CalendarCheck, DollarSign, ChevronRight, BarChart3, ArrowRight, AlertTriangle, Bug } from "lucide-react";
import { TIER_CONFIG } from "@shared/schema";
import { adminFetchFn } from "@/lib/adminApi";

const tierColors: Record<string, string> = {
  tier_starter: "bg-teal-100 text-teal-800 dark:bg-teal-800 dark:text-teal-200",
  tier_1: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  tier_1_3: "bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-200",
  tier_3_5: "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-200",
  tier_6_10: "bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-200",
  tier_10_plus: "bg-orange-100 text-orange-800 dark:bg-orange-800 dark:text-orange-200",
};

export default function AdminDashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<{
    totalCompanies: number;
    totalUsers: number;
    totalContacts: number;
    totalVisits: number;
    mrr: number;
  }>({
    queryKey: ["/api/admin/stats"],
    queryFn: adminFetchFn("/api/admin/stats"),
  });

  const { data: companies } = useQuery<any[]>({
    queryKey: ["/api/admin/companies"],
    queryFn: adminFetchFn("/api/admin/companies"),
  });

  const { data: inactiveUsers } = useQuery<Record<string, any[]>>({
    queryKey: ["/api/admin/inactive-users"],
    queryFn: adminFetchFn("/api/admin/inactive-users"),
  });

  const { data: errorStats } = useQuery<{ openCount: number; latestTimestamp: string | null }>({
    queryKey: ["/api/admin/error-reports/stats"],
    queryFn: adminFetchFn("/api/admin/error-reports/stats"),
    refetchInterval: 60000,
  });

  const recentTenants = (companies || [])
    .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 5);

  const statCards = [
    { label: "Total Tenants", value: stats?.totalCompanies ?? 0, icon: Building2 },
    { label: "Total Users", value: stats?.totalUsers ?? 0, icon: Users },
    { label: "Total Contacts", value: stats?.totalContacts ?? 0, icon: Contact2 },
    { label: "Total Visits", value: stats?.totalVisits ?? 0, icon: CalendarCheck },
    { label: "Platform MRR", value: `$${(stats?.mrr ?? 0).toFixed(2)}`, icon: DollarSign },
  ];

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto" data-testid="admin-dashboard">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-admin-title">Platform Overview</h1>
        <p className="text-muted-foreground text-sm mt-1">ScooPilot administration at a glance</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <s.icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <p className="text-xl font-bold" data-testid={`text-stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}>
                {statsLoading ? "..." : s.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Link href="/admin/errors">
        <Card className={`hover-elevate cursor-pointer ${(errorStats?.openCount ?? 0) > 0 ? "border-red-300 dark:border-red-800 bg-red-50/30 dark:bg-red-950/10" : ""}`} data-testid="card-system-errors">
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${(errorStats?.openCount ?? 0) > 0 ? "bg-red-100 dark:bg-red-900/40" : "bg-muted"}`}>
                  <Bug className={`h-5 w-5 ${(errorStats?.openCount ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <p className="font-medium text-sm">System Errors</p>
                  <p className="text-sm text-muted-foreground">
                    {errorStats == null
                      ? "Loading..."
                      : errorStats.openCount === 0
                        ? "No open errors"
                        : `${errorStats.openCount} open error${errorStats.openCount !== 1 ? "s" : ""}`}
                  </p>
                  {errorStats?.latestTimestamp && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Latest: {new Date(errorStats.latestTimestamp).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(errorStats?.openCount ?? 0) > 0 && (
                  <Badge className="bg-red-500 text-white hover:bg-red-600" data-testid="badge-open-errors">
                    {errorStats!.openCount}
                  </Badge>
                )}
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>

      <div className="grid md:grid-cols-2 gap-4">
        <Link href="/admin/tenants">
          <Card className="hover-elevate cursor-pointer h-full" data-testid="card-quick-tenants">
            <CardContent className="pt-5 pb-4 px-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Manage Tenants</p>
                  <p className="text-sm text-muted-foreground">View, create, and manage tenant accounts</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/analytics">
          <Card className="hover-elevate cursor-pointer h-full" data-testid="card-quick-analytics">
            <CardContent className="pt-5 pb-4 px-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <BarChart3 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Platform Analytics</p>
                  <p className="text-sm text-muted-foreground">Revenue metrics, churn, and growth trends</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>

      {inactiveUsers && (Object.values(inactiveUsers).some((arr) => arr.length > 0)) && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20" data-testid="card-inactive-users-alert">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Inactive Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { key: "3d", label: "3+ days", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
                { key: "5d", label: "5+ days", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
                { key: "7d", label: "7+ days", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
                { key: "14d", label: "14+ days", color: "bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-200" },
              ].map((tier) => {
                const count = inactiveUsers[tier.key]?.length || 0;
                return (
                  <div key={tier.key} className="flex items-center justify-between p-3 rounded-lg border bg-background" data-testid={`stat-inactive-${tier.key}`}>
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
                      <div className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-muted cursor-pointer" data-testid={`row-inactive-${u.userId}`}>
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
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Recent Tenants</h2>
          <Link href="/admin/tenants" className="text-sm text-primary hover:underline" data-testid="link-view-all-tenants">
            View all
          </Link>
        </div>
        {recentTenants.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Building2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No tenants yet</p>
              <Link href="/admin/tenants" className="text-sm text-primary hover:underline mt-1 inline-block" data-testid="link-add-first-tenant">
                Add your first tenant
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentTenants.map((c: any) => {
              const tierConfig = TIER_CONFIG[c.subscriptionTier as keyof typeof TIER_CONFIG];
              return (
                <Link key={c.id} href={`/admin/companies/${c.id}`}>
                  <Card className="hover-elevate cursor-pointer" data-testid={`card-recent-${c.id}`}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium truncate">{c.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{c.email || c.id}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <Badge className={tierColors[c.subscriptionTier] || ""}>
                            {tierConfig?.name || c.subscriptionTier}
                          </Badge>
                          <Badge variant="outline">{c.subscriptionStatus}</Badge>
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
    </div>
  );
}
