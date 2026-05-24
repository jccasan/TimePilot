import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PricingRulesConfig } from "@shared/schema";

type YardSizeTier = PricingRulesConfig["yardSizeTiers"][number];

export interface YardSizeTierEditorProps {
  tiers: YardSizeTier[];
  onChange: (tiers: YardSizeTier[]) => void;
  maxTiers?: number;
}

const TOTAL_ROWS = 6;
const REQUIRED_ROWS = 3;

const ACRE_OPTIONS: { label: string; value: number }[] = Array.from({ length: 28 }, (_, i) => {
  const val = Math.round((0.15 + i * 0.05) * 100) / 100;
  return { label: `${val.toFixed(2)} ac`, value: val };
});

type RowDraft = { name: string; upToAcres: number; surcharge: string };

function toProp(tiers: YardSizeTier[]): RowDraft[] {
  const rows: RowDraft[] = tiers.slice(0, TOTAL_ROWS).map((t) => ({
    name: t.name ?? "",
    upToAcres: t.upToAcres ?? 0.25,
    surcharge: String(t.surcharge),
  }));
  while (rows.length < TOTAL_ROWS) {
    rows.push({ name: "", upToAcres: 0.25, surcharge: "" });
  }
  return rows;
}

function toTiers(rows: RowDraft[]): YardSizeTier[] {
  const used = rows.filter((r) => r.name.trim() !== "");
  return used.map((d, i) => ({
    name: d.name.trim(),
    upToAcres: i === used.length - 1 ? null : d.upToAcres,
    surcharge: parseFloat(d.surcharge) || 0,
  }));
}

export function YardSizeTierEditor({ tiers, onChange }: YardSizeTierEditorProps) {
  const [rows, setRows] = useState<RowDraft[]>(() => toProp(tiers));

  useEffect(() => {
    setRows(toProp(tiers));
  }, [tiers]);

  const lastUsedIndex = (() => {
    let last = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].name.trim() !== "") last = i;
    }
    return last;
  })();

  const getPrevBoundary = (rowIndex: number): number => {
    let max = 0;
    for (let i = 0; i < rowIndex; i++) {
      if (rows[i].name.trim() !== "") max = Math.max(max, rows[i].upToAcres);
    }
    return max;
  };

  const updateRow = (index: number, updates: Partial<RowDraft>) => {
    let newRows = rows.map((r, i) => (i === index ? { ...r, ...updates } : r));

    if ("name" in updates) {
      const usedIndices: number[] = [];
      for (let i = 0; i < newRows.length; i++) {
        if (newRows[i].name.trim()) usedIndices.push(i);
      }
      for (let k = 0; k < usedIndices.length - 1; k++) {
        const idx = usedIndices[k];
        const prevIdx = k > 0 ? usedIndices[k - 1] : -1;
        const prevBound = prevIdx >= 0 ? newRows[prevIdx].upToAcres : 0;
        if (newRows[idx].upToAcres <= prevBound) {
          const validOpt = ACRE_OPTIONS.find((o) => o.value > prevBound);
          if (validOpt) {
            newRows = newRows.map((r, i) => (i === idx ? { ...r, upToAcres: validOpt.value } : r));
          }
        }
      }
    }

    setRows(newRows);
    onChange(toTiers(newRows));
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_140px_110px] gap-2 px-1 mb-1">
        <span className="text-xs font-medium text-muted-foreground">Tier Name</span>
        <span className="text-xs font-medium text-muted-foreground text-center">Upper Bound</span>
        <span className="text-xs font-medium text-muted-foreground text-center">Surcharge</span>
      </div>

      {rows.map((row, index) => {
        const isRequired = index < REQUIRED_ROWS;
        const isUsed = row.name.trim() !== "";
        const isLastUsed = index === lastUsedIndex;
        const prevBound = getPrevBoundary(index);
        const hasNameError = isRequired && !isUsed;
        const availableOptions = ACRE_OPTIONS.filter((o) => o.value > prevBound);
        const effectiveBoundary = availableOptions.find((o) => o.value === row.upToAcres)
          ? row.upToAcres
          : (availableOptions[0]?.value ?? 0.25);

        return (
          <div key={index} className="grid grid-cols-[1fr_140px_110px] gap-2 items-start">
            <div>
              <Input
                value={row.name}
                onChange={(e) => updateRow(index, { name: e.target.value })}
                placeholder={
                  isRequired ? `Tier ${index + 1} name (required)` : "Leave blank if not used"
                }
                className={cn(
                  "h-8 text-sm",
                  hasNameError && "border-destructive focus-visible:ring-destructive"
                )}
                data-testid={`input-yard-name-${index}`}
              />
              {hasNameError && (
                <p className="text-[11px] text-destructive mt-0.5 leading-none">Required</p>
              )}
            </div>

            {!isUsed ? (
              <div className="h-8 rounded-md border bg-muted/20 flex items-center justify-center text-xs text-muted-foreground/40">
                —
              </div>
            ) : isLastUsed ? (
              <div className="h-8 rounded-md border bg-muted/30 flex items-center justify-center text-xs text-muted-foreground">
                Unlimited
              </div>
            ) : (
              <Select
                value={String(effectiveBoundary)}
                onValueChange={(v) => updateRow(index, { upToAcres: parseFloat(v) })}
              >
                <SelectTrigger className="h-8 text-sm" data-testid={`select-yard-acres-${index}`}>
                  <SelectValue>{`${effectiveBoundary.toFixed(2)} ac`}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {availableOptions.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {!isUsed ? (
              <div className="h-8 rounded-md border bg-muted/20 flex items-center justify-center text-xs text-muted-foreground/40">
                —
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={row.surcharge}
                  onChange={(e) => updateRow(index, { surcharge: e.target.value })}
                  placeholder="0"
                  className="h-8 text-sm"
                  data-testid={`input-yard-surcharge-${index}`}
                />
              </div>
            )}
          </div>
        );
      })}

      <p className="text-xs text-muted-foreground pt-1">
        Tiers 1–{REQUIRED_ROWS} are required. The last filled tier is unbounded and applies to any
        larger yard. Tiers {REQUIRED_ROWS + 1}–{TOTAL_ROWS} are optional.
      </p>
    </div>
  );
}
