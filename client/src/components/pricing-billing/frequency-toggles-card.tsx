import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { DEFAULT_PRICING_RULES, type PricingConfig, type PricingRulesConfig } from "@shared/schema";

/**
 * Standalone "which recurring frequencies do you offer" toggles, extracted from
 * pricing.tsx's PricingRulesPanel. Persists pricingRules.enabledFrequencies via
 * PATCH /api/pricing-config (sending the full pricingRules so nothing is wiped).
 */
export function FrequencyTogglesCard() {
  const { toast } = useToast();
  const { data: config } = useQuery<PricingConfig>({ queryKey: ["/api/pricing-config"] });

  const rules: PricingRulesConfig = config?.pricingRules ?? DEFAULT_PRICING_RULES;
  const [twiceWeekly, setTwiceWeekly] = useState(true);
  const [monthly, setMonthly] = useState(false);

  useEffect(() => {
    if (config?.pricingRules) {
      setTwiceWeekly(config.pricingRules.enabledFrequencies?.twiceWeekly !== false);
      setMonthly(config.pricingRules.enabledFrequencies?.monthly === true);
    }
  }, [config]);

  const save = useMutation({
    mutationFn: async (next: { twiceWeekly: boolean; monthly: boolean }) => {
      const merged: PricingRulesConfig = {
        ...DEFAULT_PRICING_RULES,
        ...rules,
        enabledFrequencies: { twiceWeekly: next.twiceWeekly, monthly: next.monthly },
      };
      await apiRequest("PATCH", "/api/pricing-config", { pricingRules: merged });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-config"] });
      toast({ title: "Frequencies updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const update = (key: "twiceWeekly" | "monthly", value: boolean) => {
    const next = { twiceWeekly, monthly, [key]: value };
    if (key === "twiceWeekly") setTwiceWeekly(value);
    else setMonthly(value);
    save.mutate(next);
  };

  return (
    <Card data-testid="card-frequency-toggles">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Frequencies offered</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Choose which recurring service frequencies customers can be placed on. Weekly and
          bi-weekly are always available.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <Label className="text-sm font-medium">Twice weekly</Label>
            <p className="text-xs text-muted-foreground">Two visits per week.</p>
          </div>
          <Switch
            checked={twiceWeekly}
            onCheckedChange={(c) => update("twiceWeekly", !!c)}
            disabled={save.isPending}
            data-testid="switch-enable-twice-weekly"
          />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <Label className="text-sm font-medium">Monthly</Label>
            <p className="text-xs text-muted-foreground">One visit per month.</p>
          </div>
          <Switch
            checked={monthly}
            onCheckedChange={(c) => update("monthly", !!c)}
            disabled={save.isPending}
            data-testid="switch-enable-monthly"
          />
        </div>
      </CardContent>
    </Card>
  );
}
