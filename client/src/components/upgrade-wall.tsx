import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, Mic } from "lucide-react";

interface UpgradeWallProps {
  type: "subscription" | "voice" | "tier";
  featureName?: string;
}

export function UpgradeWall({ type, featureName }: UpgradeWallProps) {
  const isVoice = type === "voice";
  const isTier = type === "tier";

  return (
    <div
      className="flex items-center justify-center h-full min-h-[400px] p-8"
      data-testid="upgrade-wall"
    >
      <Card className="max-w-md w-full shadow-sm">
        <CardContent className="p-8 text-center space-y-5">
          <div className="flex justify-center">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
              {isVoice ? (
                <Mic className="h-7 w-7 text-muted-foreground" />
              ) : (
                <Lock className="h-7 w-7 text-muted-foreground" />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-semibold" data-testid="text-upgrade-wall-title">
              {isVoice
                ? "Voice Plan Required"
                : isTier
                  ? "Upgrade Your Plan"
                  : "Upgrade to Access This Feature"}
            </h2>
            <p className="text-sm text-muted-foreground" data-testid="text-upgrade-wall-desc">
              {isVoice
                ? `${featureName ? featureName + " is" : "This feature is"} part of the Voice Agent add-on. Add it to your account to unlock AI-powered call handling.`
                : isTier
                  ? `${featureName ? featureName + " is" : "This feature is"} available on the Solo plan and above. Upgrade to unlock pipeline management, deals, sequences, and campaigns.`
                  : `${featureName ? featureName + " is" : "This section is"} available on a full ScooPilot subscription. Upgrade to unlock CRM, scheduling, invoicing, routes, and more.`}
            </p>
          </div>

          <Link href="/billing">
            <Button className="w-full" data-testid="button-upgrade-wall-cta">
              {isVoice ? "Add Voice Plan" : "View Plans and Upgrade"}
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
