import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";
import type { PricingRulesConfig } from "@shared/schema";

type YardSizeTier = PricingRulesConfig["yardSizeTiers"][number];

interface YardSizeTierEditorProps {
  tiers: YardSizeTier[];
  onChange: (tiers: YardSizeTier[]) => void;
  maxTiers?: number;
}

export function YardSizeTierEditor({ tiers, onChange, maxTiers = 5 }: YardSizeTierEditorProps) {
  const updateTier = (index: number, key: "name" | "upToAcres" | "surcharge", value: string) => {
    const next = [...tiers];
    if (key === "name") {
      next[index] = { ...next[index], name: value };
    } else {
      const isLast = index === next.length - 1;
      if (key === "upToAcres" && isLast) {
        next[index] = { ...next[index], upToAcres: null };
      } else {
        const num = value === "" ? 0 : parseFloat(value);
        if (!isNaN(num)) {
          next[index] = { ...next[index], [key]: Math.max(0, num) };
        }
      }
    }
    onChange(next);
  };

  const addTier = () => {
    if (tiers.length >= maxTiers) return;
    const withBound = tiers.map((t) =>
      t.upToAcres === null ? { ...t, upToAcres: tiers.length * 0.25 } : t
    );
    const lastTier = withBound[withBound.length - 1];
    onChange([
      ...withBound,
      {
        name: `Tier ${withBound.length + 1}`,
        upToAcres: null,
        surcharge: (lastTier?.surcharge || 0) + 7,
      },
    ]);
  };

  const removeTier = (index: number) => {
    onChange(tiers.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">Yard Size Tiers</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addTier}
          disabled={tiers.length >= maxTiers}
          data-testid="button-add-yard-tier"
        >
          <Plus className="h-3 w-3 mr-1" /> Add Tier
        </Button>
      </div>
      {tiers.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-2">
          No yard size tiers defined.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center text-xs font-medium text-muted-foreground px-1">
            <span>Tier Name</span>
            <span className="w-32 text-center">Upper Bound (acres)</span>
            <span className="w-20 text-center">Sq ft</span>
            <span className="w-28 text-center">Surcharge ($)</span>
            <span />
          </div>
          {tiers.map((tier, index) => {
            const isLast = index === tiers.length - 1;
            const sqftHint =
              tier.upToAcres != null
                ? `${Math.round(tier.upToAcres * 43560).toLocaleString()} sq ft`
                : "unlimited";
            return (
              <div
                key={index}
                className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center"
              >
                <Input
                  value={tier.name || ""}
                  onChange={(e) => updateTier(index, "name", e.target.value)}
                  placeholder={`Tier ${index + 1}`}
                  className="h-8 text-sm"
                  data-testid={`input-yard-name-${index}`}
                />
                <div className="w-32">
                  {isLast ? (
                    <div className="h-8 flex items-center justify-center text-sm text-muted-foreground border rounded-md bg-muted/30 px-2">
                      unlimited
                    </div>
                  ) : (
                    <Input
                      type="number"
                      step="0.05"
                      min={0}
                      value={tier.upToAcres ?? ""}
                      onChange={(e) => updateTier(index, "upToAcres", e.target.value)}
                      className="h-8 text-sm"
                      data-testid={`input-yard-acres-${index}`}
                    />
                  )}
                </div>
                <div className="w-20 text-xs text-muted-foreground text-center whitespace-nowrap">
                  {sqftHint}
                </div>
                <div className="w-28 flex items-center gap-1">
                  <span className="text-muted-foreground text-sm">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={tier.surcharge}
                    onChange={(e) => updateTier(index, "surcharge", e.target.value)}
                    className="h-8 text-sm"
                    data-testid={`input-yard-surcharge-${index}`}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => removeTier(index)}
                  data-testid={`button-remove-yard-tier-${index}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            The last tier has no upper bound and applies to any yard larger than the previous tier.
            Up to {maxTiers} tiers supported.
          </p>
        </>
      )}
    </div>
  );
}
