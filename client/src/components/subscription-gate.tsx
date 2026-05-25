import { useAuth } from "@/hooks/use-auth";
import { UpgradeWall } from "@/components/upgrade-wall";

interface SubscriptionGateProps {
  children: React.ReactNode;
  featureName?: string;
  type?: "subscription" | "voice";
  excludedTiers?: string[];
}

export function SubscriptionGate({
  children,
  featureName,
  type = "subscription",
  excludedTiers,
}: SubscriptionGateProps) {
  const { user } = useAuth();

  if (!user) return <>{children}</>;

  if (user.isPlatformAdmin) return <>{children}</>;

  if (type === "voice") {
    const hasVoice = user.voicePlanStatus === "active";
    if (!hasVoice) {
      return <UpgradeWall type="voice" featureName={featureName} />;
    }
    return <>{children}</>;
  }

  const hasSubscription =
    user.subscriptionStatus === "active" || user.subscriptionStatus === "trialing";
  if (!hasSubscription) {
    return <UpgradeWall type="subscription" featureName={featureName} />;
  }

  if (
    excludedTiers &&
    user.subscriptionTier &&
    excludedTiers.includes(user.subscriptionTier) &&
    !user.crmGrandfathered
  ) {
    return <UpgradeWall type="tier" featureName={featureName} />;
  }

  return <>{children}</>;
}
