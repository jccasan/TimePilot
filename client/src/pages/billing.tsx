import { useQuery } from "@tanstack/react-query";
import { TIER_CONFIG } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CreditCard, Users, CheckCircle, ArrowUpRight } from "lucide-react";

type CompanyStats = {
  mrr: number;
  todaysVisits: number;
  failedPayments: number;
  activeUsers: number;
  subscriptionTier: string;
  tierName: string;
};

const tierKeys = Object.keys(TIER_CONFIG) as Array<keyof typeof TIER_CONFIG>;

export default function Billing() {
  const { data: stats, isLoading } = useQuery<CompanyStats>({
    queryKey: ["/api/company/stats"],
  });

  const currentTier = stats?.subscriptionTier as keyof typeof TIER_CONFIG | undefined;
  const currentTierInfo = currentTier ? TIER_CONFIG[currentTier] : null;

  return (
    <div className="p-4 md:p-6 space-y-6 overflow-auto h-full">
      <h1 className="text-2xl font-bold" data-testid="text-billing-heading">Subscription & Billing</h1>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Current Plan
            </CardTitle>
            <CardDescription>Your active subscription</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xl font-semibold" data-testid="text-current-tier">
              {currentTierInfo?.name || "Unknown"}
            </p>
            <p className="text-muted-foreground" data-testid="text-current-price">
              ${currentTierInfo?.price?.toFixed(2) || "0.00"}/month
            </p>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm" data-testid="text-user-limit">
                {stats?.activeUsers || 0} / {currentTierInfo?.maxUsers || 1} team members
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-3">Available Plans</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tierKeys.map((key) => {
            const tier = TIER_CONFIG[key];
            const isCurrent = key === currentTier;
            return (
              <Card
                key={key}
                className={isCurrent ? "border-primary" : ""}
                data-testid={`card-tier-${key}`}
              >
                <CardHeader>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-lg">{tier.name}</CardTitle>
                    {isCurrent && (
                      <Badge data-testid={`badge-current-${key}`}>
                        <CheckCircle className="mr-1 h-3 w-3" /> Current
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-2xl font-bold" data-testid={`text-price-${key}`}>
                    ${tier.price.toFixed(2)}
                    <span className="text-sm font-normal text-muted-foreground">/mo</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Up to {tier.maxUsers === 999 ? "unlimited" : tier.maxUsers} team members
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" data-testid="text-stripe-note">
            Need to upgrade or change your plan? Reach out and we will get you set up.
          </p>
          <Button variant="outline" size="sm" onClick={() => window.open("mailto:support@scoopilot.com?subject=Plan Change Request", "_blank")} data-testid="button-change-plan">
            <ArrowUpRight className="h-4 w-4 mr-1" /> Request Plan Change
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
