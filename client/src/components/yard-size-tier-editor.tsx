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

const COMMON_FRACTIONS: [number, string][] = [
  [1 / 8, "1/8"],
  [1 / 4, "1/4"],
  [1 / 3, "1/3"],
  [3 / 8, "3/8"],
  [1 / 2, "1/2"],
  [5 / 8, "5/8"],
  [2 / 3, "2/3"],
  [3 / 4, "3/4"],
  [7 / 8, "7/8"],
  [1, "1"],
  [1.25, "1.25"],
  [1.5, "1.5"],
  [2, "2"],
];

function acresToLabel(acres: number): string {
  const sqft = Math.round(acres * 43560);
  const closest = COMMON_FRACTIONS.reduce<[number, string]>(
    (best, candidate) =>
      Math.abs(candidate[0] - acres) < Math.abs(best[0] - acres) ? candidate : best,
    COMMON_FRACTIONS[0]
  );
  const fracStr = Math.abs(closest[0] - acres) < 0.02 ? `${closest[1]} ac` : `${acres} ac`;
  return `${fracStr} (${sqft.toLocaleString()} sq ft)`;
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
    if (tiers.length <= 1) return;
    const next = tiers.filter((_, i) => i !== index);
    // Ensure the last remaining tier is always unlimited (upToAcres: null)
    if (next.length > 0 && next[next.length - 1].upToAcres !== null) {
      next[next.length - 1] = { ...next[next.length - 1], upToAcres: null };
    }
    onChange(next);
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
            <span className="w-36 text-center">Upper Bound</span>
            <span className="w-28 text-center">Size</span>
            <span className="w-28 text-center">Surcharge ($)</span>
            <span />
          </div>
          {tiers.map((tier, index) => {
            const isLast = index === tiers.length - 1;
            const sizeHint = tier.upToAcres != null ? acresToLabel(tier.upToAcres) : "unlimited";
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
                <div className="w-36">
                  {isLast ? (
                    <div className="h-8 flex items-center justify-center text-sm text-muted-foreground border rounded-md bg-muted/30 px-2">
                      unlimited
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        step="0.05"
                        min={0}
                        value={tier.upToAcres ?? ""}
                        onChange={(e) => updateTier(index, "upToAcres", e.target.value)}
                        className="h-8 text-sm"
                        data-testid={`input-yard-acres-${index}`}
                      />
                      <span className="text-xs text-muted-foreground shrink-0">ac</span>
                    </div>
                  )}
                </div>
                <div className="w-28 text-xs text-muted-foreground text-center whitespace-nowrap">
                  {sizeHint}
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
                  disabled={tiers.length <= 1}
                  title={tiers.length <= 1 ? "At least one tier is required" : "Remove tier"}
                  data-testid={`button-remove-yard-tier-${index}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            The last tier has no upper bound and applies to any yard larger than the previous tier.
            1–{maxTiers} tiers supported.
          </p>
        </>
      )}
    </div>
  );
}
