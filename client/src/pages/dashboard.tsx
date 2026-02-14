import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, CalendarCheck, AlertTriangle, UserCheck, Plus, Eye } from "lucide-react";
import { TIER_CONFIG } from "@shared/schema";

type CompanyStats = {
  mrr: number;
  todaysVisits: number;
  failedPayments: number;
  activeUsers: number;
  subscriptionTier: string;
  tierName: string;
};

export default function Dashboard() {
  const { user } = useAuth();
  const { data: stats, isLoading } = useQuery<CompanyStats>({
    queryKey: ["/api/company/stats"],
  });

  const tierKey = stats?.subscriptionTier as keyof typeof TIER_CONFIG | undefined;
  const tierInfo = tierKey ? TIER_CONFIG[tierKey] : null;

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-welcome">
          Welcome back, {user?.firstName || "there"}
        </h1>
        <p className="text-muted-foreground">Here is your business overview</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">MRR</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-mrr">
                ${stats?.mrr?.toFixed(2) ?? "0.00"}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Visits</CardTitle>
            <CalendarCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-todays-visits">
                {stats?.todaysVisits ?? 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed Payments</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-failed-payments">
                {stats?.failedPayments ?? 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Team</CardTitle>
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-active-users">
                {stats?.activeUsers ?? 0}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Current Plan</CardTitle>
            <CardDescription>Your subscription details</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="space-y-2" data-testid="text-plan-info">
                <p className="text-xl font-semibold">{tierInfo?.name ?? stats?.tierName ?? "Unknown"}</p>
                <p className="text-muted-foreground">
                  ${tierInfo?.price?.toFixed(2) ?? "0.00"}/mo -- Up to {tierInfo?.maxUsers ?? 1} users
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Quick Actions</CardTitle>
            <CardDescription>Common tasks</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline" data-testid="button-quick-add-contact">
              <Link href="/contacts">
                <Plus className="mr-1 h-4 w-4" />
                Add Contact
              </Link>
            </Button>
            <Button asChild variant="outline" data-testid="button-quick-create-visit">
              <Link href="/scheduling">
                <CalendarCheck className="mr-1 h-4 w-4" />
                Create Visit
              </Link>
            </Button>
            <Button asChild variant="outline" data-testid="button-quick-view-routes">
              <Link href="/routes">
                <Eye className="mr-1 h-4 w-4" />
                View Routes
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
