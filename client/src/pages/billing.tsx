import { useQuery, useMutation } from "@tanstack/react-query";
import { TIER_CONFIG } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CreditCard, Users, CheckCircle, ExternalLink, AlertTriangle, MessageSquare, Phone, Clock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type SubscriptionInfo = {
  tier: string;
  tierName: string;
  status: string;
  price: number;
  maxUsers: number;
  activeUsers: number;
  frozenAt: string | null;
  trialEndsAt: string | null;
  stripeCustomerId: string | null;
  hasStripeSubscription: boolean;
};

type UsageInfo = {
  period: { start: string; end: string };
  usage: {
    smsSegments: number;
    voiceMinutes: number;
    activeUsers: number;
  };
  allowances: {
    maxUsers: number;
    smsSegmentsIncluded: number;
    voiceMinutesIncluded: number;
  };
};

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Active", variant: "default" },
  trialing: { label: "Free Trial", variant: "secondary" },
  past_due: { label: "Past Due", variant: "destructive" },
  suspended: { label: "Suspended", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

type TierPrices = Record<string, { name: string; price: number; maxUsers: number }>;

const tierKeys = Object.keys(TIER_CONFIG).filter(k => k !== "free_trial") as Array<keyof typeof TIER_CONFIG>;

export default function Billing() {
  const { toast } = useToast();

  const { data: subscription, isLoading: subLoading } = useQuery<SubscriptionInfo>({
    queryKey: ["/api/billing/subscription"],
  });

  const { data: usage, isLoading: usageLoading } = useQuery<UsageInfo>({
    queryKey: ["/api/billing/usage"],
  });

  const { data: tierPrices } = useQuery<TierPrices>({
    queryKey: ["/api/billing/prices"],
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/portal");
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      window.open(data.url, "_blank");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Could not open billing portal", variant: "destructive" });
    },
  });

  const statusInfo = STATUS_LABELS[subscription?.status || ""] || { label: subscription?.status || "Unknown", variant: "outline" as const };
  const isSuspended = subscription?.status === "suspended";
  const isCancelled = subscription?.status === "cancelled";
  const isTrialing = subscription?.status === "trialing";

  const trialDaysLeft = subscription?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
      <h1 className="text-2xl font-bold" data-testid="text-billing-heading">Subscription & Billing</h1>

      {isSuspended && (
        <Alert variant="destructive" data-testid="alert-suspended">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Account Suspended</AlertTitle>
          <AlertDescription>
            Your subscription payment has failed. Please update your payment method to restore full access.
          </AlertDescription>
        </Alert>
      )}

      {isTrialing && trialDaysLeft !== null && (
        <Alert data-testid="alert-trial">
          <Clock className="h-4 w-4" />
          <AlertTitle>Free Trial</AlertTitle>
          <AlertDescription>
            {trialDaysLeft > 0
              ? `You have ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left in your free trial.`
              : "Your free trial has ended. Choose a plan to continue."}
          </AlertDescription>
        </Alert>
      )}

      {subLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : subscription ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Current Plan
            </CardTitle>
            <CardDescription>Your active subscription details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-xl font-semibold" data-testid="text-current-tier">
                {subscription.tierName}
              </p>
              <Badge variant={statusInfo.variant} data-testid="badge-status">
                {statusInfo.label}
              </Badge>
            </div>
            <p className="text-muted-foreground" data-testid="text-current-price">
              ${subscription.price.toFixed(2)}/month
            </p>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm" data-testid="text-user-limit">
                {subscription.activeUsers} / {subscription.maxUsers === 999 ? "unlimited" : subscription.maxUsers} team members
              </span>
            </div>
            {subscription.hasStripeSubscription && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
                data-testid="button-manage-billing"
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                {portalMutation.isPending ? "Opening..." : "Manage Billing"}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}

      {usageLoading ? (
        <Skeleton className="h-36 w-full" />
      ) : usage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Usage This Month</CardTitle>
            <CardDescription>
              {new Date(usage.period.start).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2" data-testid="usage-sms">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  SMS Segments
                </div>
                <p className="text-2xl font-bold">{usage.usage.smsSegments}</p>
                <Progress value={Math.min(100, (usage.usage.smsSegments / usage.allowances.smsSegmentsIncluded) * 100)} className="h-1.5" />
                <p className="text-xs text-muted-foreground">{usage.usage.smsSegments} of {usage.allowances.smsSegmentsIncluded} included</p>
              </div>
              <div className="space-y-2" data-testid="usage-voice">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  Voice Minutes
                </div>
                <p className="text-2xl font-bold">{usage.usage.voiceMinutes}</p>
                <Progress value={Math.min(100, (usage.usage.voiceMinutes / usage.allowances.voiceMinutesIncluded) * 100)} className="h-1.5" />
                <p className="text-xs text-muted-foreground">{usage.usage.voiceMinutes} of {usage.allowances.voiceMinutesIncluded} included</p>
              </div>
              <div className="space-y-2" data-testid="usage-users">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  Active Users
                </div>
                <p className="text-2xl font-bold">{usage.usage.activeUsers}</p>
                <Progress
                  value={usage.allowances.maxUsers === 999 ? 20 : Math.min(100, (usage.usage.activeUsers / usage.allowances.maxUsers) * 100)}
                  className="h-1.5"
                />
                <p className="text-xs text-muted-foreground">
                  {usage.allowances.maxUsers === 999 ? "unlimited seats" : `${usage.usage.activeUsers} of ${usage.allowances.maxUsers} included`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div>
        <h2 className="text-lg font-semibold mb-3">Available Plans</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tierKeys.map((key) => {
            const fallback = TIER_CONFIG[key];
            const dynamic = tierPrices?.[key];
            const displayName = dynamic?.name ?? fallback.name;
            const displayPrice = dynamic?.price ?? fallback.price;
            const displayMaxUsers = dynamic?.maxUsers ?? fallback.maxUsers;
            const isCurrent = key === subscription?.tier;
            return (
              <Card
                key={key}
                className={isCurrent ? "border-primary" : ""}
                data-testid={`card-tier-${key}`}
              >
                <CardHeader>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-lg">{displayName}</CardTitle>
                    {isCurrent && (
                      <Badge data-testid={`badge-current-${key}`}>
                        <CheckCircle className="mr-1 h-3 w-3" /> Current
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-2xl font-bold" data-testid={`text-price-${key}`}>
                    ${displayPrice.toFixed(2)}
                    <span className="text-sm font-normal text-muted-foreground">/mo</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Up to {displayMaxUsers === 999 ? "unlimited" : displayMaxUsers} team members
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {(isSuspended || isCancelled) && (
        <Card className="border-destructive">
          <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="font-medium" data-testid="text-reactivate-heading">
                {isSuspended ? "Payment Required" : "Subscription Cancelled"}
              </p>
              <p className="text-sm text-muted-foreground">
                {isSuspended
                  ? "Update your payment method to restore full access to your account."
                  : "Resubscribe to regain access to all features."}
              </p>
            </div>
            {subscription?.hasStripeSubscription && (
              <Button
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
                data-testid="button-reactivate"
              >
                {portalMutation.isPending ? "Opening..." : "Update Payment Method"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {!isSuspended && !isCancelled && (
        <Card>
          <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" data-testid="text-stripe-note">
              {subscription?.hasStripeSubscription
                ? "Manage your subscription, update payment methods, or view invoices through the billing portal."
                : "Need to upgrade or change your plan? Reach out and we will get you set up."}
            </p>
            {subscription?.hasStripeSubscription ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
                data-testid="button-change-plan"
              >
                <ExternalLink className="h-4 w-4 mr-1" /> {portalMutation.isPending ? "Opening..." : "Billing Portal"}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open("mailto:support@scoopilot.com?subject=Plan Change Request", "_blank")}
                data-testid="button-change-plan"
              >
                <ExternalLink className="h-4 w-4 mr-1" /> Request Plan Change
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
