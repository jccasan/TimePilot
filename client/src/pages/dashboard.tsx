import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  DollarSign, CalendarCheck, AlertTriangle, UserCheck,
  Plus, Eye, Users, ClipboardList, TrendingUp,
  FileText, Clock, CheckCircle2, Circle, ArrowRight,
  MessageSquare, Mail,
} from "lucide-react";
import { TIER_CONFIG } from "@shared/schema";

type OnboardingStatus = {
  isComplete: boolean;
  steps: { key: string; label: string; completed: boolean }[];
};

type CompanyStats = {
  mrr: number;
  todaysVisits: number;
  todaysVisitBreakdown: { completed: number; scheduled: number; inProgress: number };
  failedPayments: number;
  overdueInvoices: number;
  activeUsers: number;
  activeContacts: number;
  activeServicePlans: number;
  monthRevenue: number;
  smsCountThisMonth: number;
  emailCountThisMonth: number;
  subscriptionTier: string;
  tierName: string;
};

export default function Dashboard() {
  const { user } = useAuth();
  const { data: stats, isLoading } = useQuery<CompanyStats>({
    queryKey: ["/api/company/stats"],
  });

  const { data: onboarding } = useQuery<OnboardingStatus>({
    queryKey: ["/api/onboarding/status"],
  });

  const tierKey = stats?.subscriptionTier as keyof typeof TIER_CONFIG | undefined;
  const tierInfo = tierKey ? TIER_CONFIG[tierKey] : null;

  const visitProgress = stats && stats.todaysVisits > 0
    ? Math.round((stats.todaysVisitBreakdown.completed / stats.todaysVisits) * 100)
    : 0;

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-welcome">
          Welcome back, {user?.firstName || "there"}
        </h1>
        <p className="text-muted-foreground">Here is your business overview</p>
      </div>

      {onboarding && !onboarding.isComplete && (
        <Card data-testid="card-onboarding">
          <CardHeader>
            <CardTitle className="text-lg">Getting Started</CardTitle>
            <CardDescription>Complete these steps to set up your business</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {onboarding.steps.map((step) => {
              const stepLinks: Record<string, string> = {
                contact: "/contacts",
                route: "/routes",
                service_plan: "/scheduling",
              };
              return (
                <div key={step.key} className="flex items-center justify-between gap-2" data-testid={`onboarding-step-${step.key}`}>
                  <div className="flex items-center gap-2">
                    {step.completed ? (
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground" />
                    )}
                    <span className={step.completed ? "line-through text-muted-foreground" : ""}>{step.label}</span>
                  </div>
                  {!step.completed && (
                    <Button asChild variant="ghost" size="sm" data-testid={`button-onboarding-${step.key}`}>
                      <Link href={stepLinks[step.key] || "/"}>
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  )}
                </div>
              );
            })}
            <Progress
              value={(onboarding.steps.filter(s => s.completed).length / onboarding.steps.length) * 100}
              className="h-2 mt-2"
            />
          </CardContent>
        </Card>
      )}

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
              <div data-testid="text-todays-visits">
                <div className="text-2xl font-bold">{stats?.todaysVisits ?? 0}</div>
                {stats && stats.todaysVisits > 0 && (
                  <div className="mt-2 space-y-1">
                    <Progress value={visitProgress} className="h-2" />
                    <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                      <span>{stats.todaysVisitBreakdown.completed} done</span>
                      <span>/</span>
                      <span>{stats.todaysVisitBreakdown.inProgress} active</span>
                      <span>/</span>
                      <span>{stats.todaysVisitBreakdown.scheduled} pending</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Overdue Invoices</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div data-testid="text-overdue-invoices">
                <div className="text-2xl font-bold">{stats?.overdueInvoices ?? 0}</div>
                {(stats?.failedPayments ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {stats?.failedPayments} failed payment{stats?.failedPayments === 1 ? "" : "s"}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Month Revenue</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-month-revenue">
                ${(stats?.monthRevenue ?? 0).toFixed(2)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Clients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-active-contacts">
                {stats?.activeContacts ?? 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Service Plans</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-active-plans">
                {stats?.activeServicePlans ?? 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Team Size</CardTitle>
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div data-testid="text-active-users">
                <div className="text-2xl font-bold">{stats?.activeUsers ?? 0}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  of {tierInfo?.maxUsers ?? 1} allowed
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Texts Sent</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div data-testid="text-sms-count">
                <div className="text-2xl font-bold">{stats?.smsCountThisMonth ?? 0}</div>
                <p className="text-xs text-muted-foreground mt-1">this month</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Emails Sent</CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div data-testid="text-email-count">
                <div className="text-2xl font-bold">{stats?.emailCountThisMonth ?? 0}</div>
                <p className="text-xs text-muted-foreground mt-1">this month</p>
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
              <div className="space-y-3" data-testid="text-plan-info">
                <div className="flex items-center gap-2">
                  <p className="text-xl font-semibold">{tierInfo?.name ?? stats?.tierName ?? "Unknown"}</p>
                  <Badge variant="secondary">Active</Badge>
                </div>
                <p className="text-muted-foreground">
                  ${tierInfo?.price?.toFixed(2) ?? "0.00"}/mo -- Up to {tierInfo?.maxUsers ?? 1} user{(tierInfo?.maxUsers ?? 1) > 1 ? "s" : ""}
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
            <Button asChild variant="outline" data-testid="button-quick-scheduling">
              <Link href="/scheduling">
                <CalendarCheck className="mr-1 h-4 w-4" />
                Scheduling
              </Link>
            </Button>
            <Button asChild variant="outline" data-testid="button-quick-view-routes">
              <Link href="/routes">
                <Eye className="mr-1 h-4 w-4" />
                Routes
              </Link>
            </Button>
            <Button asChild variant="outline" data-testid="button-quick-invoices">
              <Link href="/invoices">
                <FileText className="mr-1 h-4 w-4" />
                Invoices
              </Link>
            </Button>
            <Button asChild variant="outline" data-testid="button-quick-tech-mobile">
              <Link href="/m/today">
                <Clock className="mr-1 h-4 w-4" />
                Tech View
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
