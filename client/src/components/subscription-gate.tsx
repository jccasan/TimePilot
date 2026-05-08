import { useAuth } from "@/hooks/use-auth";
import { UpgradeWall } from "@/components/upgrade-wall";

interface SubscriptionGateProps {
  children: React.ReactNode;
  featureName?: string;
  type?: "subscription" | "voice";
}

export function SubscriptionGate({
  children,
  featureName,
  type = "subscription",
}: SubscriptionGateProps) {
  const { user } = useAuth();

  if (!user) return <>{children}</>;

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

  return <>{children}</>;
}
