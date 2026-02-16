import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Building2, Users, Contact2, CalendarCheck, DollarSign, Search, ChevronRight } from "lucide-react";
import { TIER_CONFIG } from "@shared/schema";
import { useState, useMemo } from "react";

const tierColors: Record<string, string> = {
  tier_1: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  tier_1_3: "bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-200",
  tier_3_5: "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-200",
  tier_6_10: "bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-200",
  tier_10_plus: "bg-orange-100 text-orange-800 dark:bg-orange-800 dark:text-orange-200",
};

export default function AdminDashboard() {
  const [search, setSearch] = useState("");

  const { data: stats, isLoading: statsLoading } = useQuery<{
    totalCompanies: number;
    totalUsers: number;
    totalContacts: number;
    totalVisits: number;
    mrr: number;
  }>({
    queryKey: ["/api/admin/stats"],
  });

  const { data: companies, isLoading: companiesLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/companies"],
  });

  const filtered = useMemo(() => {
    if (!companies) return [];
    if (!search.trim()) return companies;
    const q = search.toLowerCase();
    return companies.filter(
      (c: any) =>
        c.name?.toLowerCase().includes(q) ||
        c.id?.toLowerCase().includes(q) ||
        c.subscriptionTier?.toLowerCase().includes(q)
    );
  }, [companies, search]);

  const statCards = [
    { label: "Total Tenants", value: stats?.totalCompanies ?? 0, icon: Building2 },
    { label: "Total Users", value: stats?.totalUsers ?? 0, icon: Users },
    { label: "Total Contacts", value: stats?.totalContacts ?? 0, icon: Contact2 },
    { label: "Total Visits", value: stats?.totalVisits ?? 0, icon: CalendarCheck },
    { label: "Platform MRR", value: `$${(stats?.mrr ?? 0).toFixed(2)}`, icon: DollarSign },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="admin-dashboard">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-admin-title">Platform Admin</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage all tenant accounts</p>
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

      <div>
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <h2 className="text-lg font-semibold">Tenant Accounts</h2>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search companies..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-admin-search"
            />
          </div>
        </div>

        {companiesLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading accounts...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No accounts found</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((c: any) => {
              const tierConfig = TIER_CONFIG[c.subscriptionTier as keyof typeof TIER_CONFIG];
              return (
                <Link key={c.id} href={`/admin/companies/${c.id}`}>
                  <Card className="hover-elevate cursor-pointer" data-testid={`card-company-${c.id}`}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium truncate" data-testid={`text-company-name-${c.id}`}>{c.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{c.id}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <Badge className={tierColors[c.subscriptionTier] || ""} data-testid={`badge-tier-${c.id}`}>
                            {tierConfig?.name || c.subscriptionTier}
                          </Badge>
                          <Badge variant="outline" data-testid={`badge-status-${c.id}`}>
                            {c.subscriptionStatus}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{c.userCount} users</span>
                          <span className="text-xs text-muted-foreground">{c.contactCount} contacts</span>
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
