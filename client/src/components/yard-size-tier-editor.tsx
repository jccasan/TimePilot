import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import type { PricingRulesConfig } from "@shared/schema";

type YardSizeTier = PricingRulesConfig["yardSizeTiers"][number];

interface YardSizeTierEditorProps {
  tiers: YardSizeTier[];
  onChange: (tiers: YardSizeTier[]) => void;
  maxTiers?: number;
}

const COMMON_ACRE_OPTIONS = [
  { label: "0.10 ac (4,356 sq ft)", value: 0.1 },
  { label: "0.15 ac (6,534 sq ft)", value: 0.15 },
  { label: "0.25 ac (10,890 sq ft)", value: 0.25 },
  { label: "0.50 ac (21,780 sq ft)", value: 0.5 },
  { label: "0.75 ac (32,670 sq ft)", value: 0.75 },
  { label: "1.0 ac (43,560 sq ft)", value: 1.0 },
];

function acresToLabel(acres: number): string {
  const opt = COMMON_ACRE_OPTIONS.find((o) => Math.abs(o.value - acres) < 0.001);
  if (opt) return opt.label;
  return `${acres} ac (${Math.round(acres * 43560).toLocaleString()} sq ft)`;
}

function BoundarySelect({
  value,
  onChange,
  minAcres,
  index,
}: {
  value: number;
  onChange: (v: number) => void;
  minAcres: number;
  index: number;
}) {
  const [showCustom, setShowCustom] = useState(false);
  const [customVal, setCustomVal] = useState(String(value));
  const isCommon = COMMON_ACRE_OPTIONS.some((o) => Math.abs(o.value - value) < 0.001);

  if (showCustom) {
    return (
      <div className="flex items-center gap-1 w-full">
        <Input
          type="number"
          step="0.01"
          min={minAcres + 0.01}
          value={customVal}
          className="h-8 text-sm"
          data-testid={`input-yard-acres-custom-${index}`}
          onChange={(e) => setCustomVal(e.target.value)}
          onBlur={() => {
            const n = parseFloat(customVal);
            if (!isNaN(n) && n > minAcres) {
              onChange(n);
              setShowCustom(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const n = parseFloat(customVal);
              if (!isNaN(n) && n > minAcres) {
                onChange(n);
                setShowCustom(false);
              }
            } else if (e.key === "Escape") {
              setShowCustom(false);
            }
          }}
          autoFocus
        />
        <span className="text-xs text-muted-foreground shrink-0">ac</span>
      </div>
    );
  }

  return (
    <Select
      value={isCommon ? String(value) : "custom"}
      onValueChange={(v) => {
        if (v === "custom") {
          setCustomVal(String(value));
          setShowCustom(true);
        } else {
          onChange(parseFloat(v));
        }
      }}
    >
      <SelectTrigger className="h-8 text-sm" data-testid={`select-yard-acres-${index}`}>
        <SelectValue>{isCommon ? acresToLabel(value) : acresToLabel(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {COMMON_ACRE_OPTIONS.filter((o) => o.value > minAcres).map((o) => (
          <SelectItem key={o.value} value={String(o.value)}>
            {o.label}
          </SelectItem>
        ))}
        <SelectItem value="custom">Custom...</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function YardSizeTierEditor({ tiers, onChange, maxTiers = 5 }: YardSizeTierEditorProps) {
  const updateName = (index: number, name: string) => {
    const next = tiers.map((t, i) => (i === index ? { ...t, name } : t));
    onChange(next);
  };

  const updateBoundary = (index: number, acres: number) => {
    const next = [...tiers];
    next[index] = { ...next[index], upToAcres: acres };
    // Enforce monotonic ascending: push subsequent bounded tiers up if needed
    for (let i = index + 1; i < next.length - 1; i++) {
      const prev = next[i - 1].upToAcres ?? 0;
      if (next[i].upToAcres !== null && (next[i].upToAcres as number) <= prev) {
        next[i] = { ...next[i], upToAcres: Math.round((prev + 0.125) * 1000) / 1000 };
      }
    }
    onChange(next);
  };

  const updateSurcharge = (index: number, raw: string) => {
    const num = parseFloat(raw);
    if (!isNaN(num)) {
      onChange(tiers.map((t, i) => (i === index ? { ...t, surcharge: Math.max(0, num) } : t)));
    }
  };

  const addTier = () => {
    if (tiers.length >= maxTiers) return;
    const lastBounded = tiers.slice(0, -1);
    const lastBoundary =
      lastBounded.length > 0 ? (lastBounded[lastBounded.length - 1].upToAcres ?? 0) : 0;
    const candidates = COMMON_ACRE_OPTIONS.filter((o) => o.value > lastBoundary);
    const newBoundary =
      candidates.length > 0 ? candidates[0].value : Math.round((lastBoundary + 0.25) * 100) / 100;
    const prevLast = tiers[tiers.length - 1];
    // Give old last tier a boundary, then append new unbounded tier
    const withBound = tiers.map((t, i) =>
      i === tiers.length - 1 ? { ...t, upToAcres: newBoundary } : t
    );
    onChange([
      ...withBound,
      {
        name: `Tier ${withBound.length + 1}`,
        upToAcres: null,
        surcharge: (prevLast?.surcharge || 0) + 7,
      },
    ]);
  };

  const removeTier = (index: number) => {
    if (tiers.length <= 1) return;
    const next = tiers.filter((_, i) => i !== index);
    // Ensure last tier is always unbounded
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
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center text-xs font-medium text-muted-foreground px-1">
            <span>Tier Name</span>
            <span className="w-48 text-center">Upper Bound</span>
            <span className="w-28 text-center">Surcharge ($)</span>
            <span />
          </div>
          {tiers.map((tier, index) => {
            const isLast = index === tiers.length - 1;
            const prevBoundary = index > 0 ? (tiers[index - 1].upToAcres ?? 0) : 0;
            return (
              <div key={index} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                <Input
                  value={tier.name || ""}
                  onChange={(e) => updateName(index, e.target.value)}
                  placeholder={`Tier ${index + 1}`}
                  className="h-8 text-sm"
                  data-testid={`input-yard-name-${index}`}
                />
                <div className="w-48">
                  {isLast ? (
                    <div className="h-8 flex items-center justify-center text-sm text-muted-foreground border rounded-md bg-muted/30 px-2 whitespace-nowrap">
                      Larger than previous
                    </div>
                  ) : (
                    <BoundarySelect
                      value={tier.upToAcres ?? 0.25}
                      onChange={(v) => updateBoundary(index, v)}
                      minAcres={prevBoundary}
                      index={index}
                    />
                  )}
                </div>
                <div className="w-28 flex items-center gap-1">
                  <span className="text-muted-foreground text-sm">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={tier.surcharge}
                    onChange={(e) => updateSurcharge(index, e.target.value)}
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
