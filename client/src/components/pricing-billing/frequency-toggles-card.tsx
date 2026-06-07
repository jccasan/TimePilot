import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save, CheckCircle2 } from "lucide-react";
import { type PricingConfig } from "@shared/schema";

/**
 * Standalone "which recurring frequencies do you offer" toggles, extracted from
 * pricing.tsx's PricingRulesPanel. Persists only pricingRules.enabledFrequencies
 * via a dedicated endpoint that deep-merges server-side, so we never resend (and
 * risk clobbering) the rest of pricingRules.
 *
 * Saving is explicit (Save button) with a visible saved/unsaved indicator so the
 * operator can confirm the write completed.
 */
export function FrequencyTogglesCard() {
  const { toast } = useToast();
  const { data: config } = useQuery<PricingConfig>({ queryKey: ["/api/pricing-config"] });

  const serverTwiceWeekly = config?.pricingRules?.enabledFrequencies?.twiceWeekly !== false;
  const serverMonthly = config?.pricingRules?.enabledFrequencies?.monthly === true;

  const [twiceWeekly, setTwiceWeekly] = useState(true);
  const [monthly, setMonthly] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);

  // Sync from the server only when there are no unsaved local edits, so a
  // background refetch can't discard a toggle the operator just flipped.
  useEffect(() => {
    if (config?.pricingRules && !dirty) {
      setTwiceWeekly(serverTwiceWeekly);
      setMonthly(serverMonthly);
    }
  }, [config, dirty, serverTwiceWeekly, serverMonthly]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/pricing-config/enabled-frequencies", {
        twiceWeekly,
        monthly,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-config"] });
      setDirty(false);
      setSavedOnce(true);
      toast({ title: "Frequencies saved" });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't save frequencies",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const toggle = (key: "twiceWeekly" | "monthly", value: boolean) => {
    if (key === "twiceWeekly") setTwiceWeekly(value);
    else setMonthly(value);
    setDirty(true);
    setSavedOnce(false);
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
            onCheckedChange={(c) => toggle("twiceWeekly", !!c)}
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
            onCheckedChange={(c) => toggle("monthly", !!c)}
            data-testid="switch-enable-monthly"
          />
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs" data-testid="text-frequency-save-status">
            {dirty ? (
              <span className="text-amber-600 dark:text-amber-400">Unsaved changes</span>
            ) : savedOnce ? (
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> Saved
              </span>
            ) : null}
          </span>
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={save.isPending || !dirty}
            data-testid="button-save-frequencies"
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            {save.isPending ? "Saving..." : "Save frequencies"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
