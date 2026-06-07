import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save } from "lucide-react";
import { DEFAULT_TIER_NAMES, type PricingConfig } from "@shared/schema";

/**
 * Standalone residential proposal tier-name editor (Good/Better/Best), extracted
 * from unified-pricing-engine.tsx's MyPricingTab so it can live in the
 * "What you sell" section. Empty fields show the defaults as placeholders.
 */
export function TierNamesCard() {
  const { toast } = useToast();
  const { data: config } = useQuery<PricingConfig>({ queryKey: ["/api/pricing-config"] });

  const [tierNames, setTierNames] = useState({ tier1: "", tier2: "", tier3: "" });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (config) {
      setTierNames({
        tier1: config.tierNames?.tier1 ?? "",
        tier2: config.tierNames?.tier2 ?? "",
        tier3: config.tierNames?.tier3 ?? "",
      });
      setDirty(false);
    }
  }, [config]);

  const save = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/pricing-config", {
        tierNames: {
          tier1: tierNames.tier1.trim() || DEFAULT_TIER_NAMES.tier1,
          tier2: tierNames.tier2.trim() || DEFAULT_TIER_NAMES.tier2,
          tier3: tierNames.tier3.trim() || DEFAULT_TIER_NAMES.tier3,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-config"] });
      setDirty(false);
      toast({ title: "Tier names saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid="card-tier-names">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Proposal Tier Names</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Customize the three service tier labels shown on residential quote proposals (e.g. Good /
          Better / Best, or Bronze / Silver / Gold). Leave blank to use the defaults.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {(
            [
              { key: "tier1", label: "Tier 1", placeholder: DEFAULT_TIER_NAMES.tier1 },
              { key: "tier2", label: "Tier 2", placeholder: DEFAULT_TIER_NAMES.tier2 },
              { key: "tier3", label: "Tier 3", placeholder: DEFAULT_TIER_NAMES.tier3 },
            ] as const
          ).map(({ key, label, placeholder }) => (
            <div key={key} className="space-y-1">
              <Label className="text-xs">{label}</Label>
              <Input
                value={tierNames[key]}
                placeholder={placeholder}
                onChange={(e) => {
                  setTierNames((prev) => ({ ...prev, [key]: e.target.value }));
                  setDirty(true);
                }}
                className="h-8 text-sm"
                data-testid={`input-tier-name-${key}`}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={save.isPending || !dirty}
            data-testid="button-save-tier-names"
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            {save.isPending ? "Saving..." : "Save Tier Names"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
