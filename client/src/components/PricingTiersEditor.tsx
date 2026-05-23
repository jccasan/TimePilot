import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Plus } from "lucide-react";

export interface PricingTier {
  label: string;
  pricePerVisit: number | null;
}

export interface PricingTiersEditorProps {
  value: PricingTier[];
  onChange: (tiers: PricingTier[]) => void;
  perDogAdder: number | null;
  onPerDogAdderChange: (v: number | null) => void;
  firstTimeCleanupFee: number | null;
  onFirstTimeCleanupFeeChange: (v: number | null) => void;
  depositPercent?: number | null;
  onDepositPercentChange?: (v: number | null) => void;
  showDepositPercent?: boolean;
  initialTiers?: PricingTier[];
  errors?: Record<string, string>;
}

export const REQUIRED_TIERS = 3;

function parseMoney(raw: string): number | null {
  const n = parseFloat(raw);
  return isNaN(n) || n < 0 ? null : n;
}

function formatMoney(v: number | null): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function tierLabel(i: number): string {
  return `Tier ${i + 1}`;
}

export function PricingTiersEditor({
  value,
  onChange,
  perDogAdder,
  onPerDogAdderChange,
  firstTimeCleanupFee,
  onFirstTimeCleanupFeeChange,
  depositPercent,
  onDepositPercentChange,
  showDepositPercent = false,
  initialTiers,
  errors = {},
}: PricingTiersEditorProps) {
  const tiers: PricingTier[] =
    value.length > 0
      ? value
      : initialTiers && initialTiers.length > 0
        ? initialTiers
        : Array.from({ length: REQUIRED_TIERS }, () => ({ label: "", pricePerVisit: null }));

  function updateTier(index: number, field: keyof PricingTier, raw: string) {
    const next = tiers.map((t) => ({ ...t }));
    if (field === "label") {
      next[index].label = raw;
    } else {
      next[index].pricePerVisit = parseMoney(raw);
    }
    onChange(next);
  }

  function addTier() {
    onChange([...tiers, { label: "", pricePerVisit: null }]);
  }

  function removeTier(index: number) {
    if (index < REQUIRED_TIERS) return;
    onChange(tiers.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {tiers.map((tier, i) => {
          const isRequired = i < REQUIRED_TIERS;
          const labelKey = `tier_${i + 1}_label`;
          const priceKey = `tier_${i + 1}_price`;

          return (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-3 items-start">
              <div className="space-y-1">
                <Label className="text-xs" htmlFor={`tier-label-${i}`}>
                  {tierLabel(i)} Label
                  {isRequired && <span className="text-red-500 ml-0.5">*</span>}
                </Label>
                <Input
                  id={`tier-label-${i}`}
                  value={tier.label}
                  onChange={(e) => updateTier(i, "label", e.target.value)}
                  placeholder={isRequired ? "e.g. Small Yard" : "Optional"}
                  className={errors[labelKey] ? "border-red-400" : ""}
                  data-testid={`input-tier-${i + 1}-label`}
                />
                {errors[labelKey] && <p className="text-xs text-red-500">{errors[labelKey]}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor={`tier-price-${i}`}>
                  Price / visit{isRequired && <span className="text-red-500 ml-0.5">*</span>}
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    $
                  </span>
                  <Input
                    id={`tier-price-${i}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={formatMoney(tier.pricePerVisit)}
                    onChange={(e) => updateTier(i, "pricePerVisit", e.target.value)}
                    placeholder={isRequired ? "0.00" : ""}
                    className={`pl-7 ${errors[priceKey] ? "border-red-400" : ""}`}
                    data-testid={`input-tier-${i + 1}-price`}
                  />
                </div>
                {errors[priceKey] && <p className="text-xs text-red-500">{errors[priceKey]}</p>}
              </div>
              <div className="pt-5">
                {!isRequired ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    onClick={() => removeTier(i)}
                    data-testid={`button-remove-tier-${i + 1}`}
                    aria-label={`Remove ${tierLabel(i)}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                ) : (
                  <div className="h-9 w-9" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={addTier}
        data-testid="button-add-tier"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Tier
      </Button>

      <div className="border-t pt-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 items-start">
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="per-dog-adder">
              Per Dog Adder
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                $
              </span>
              <Input
                id="per-dog-adder"
                type="number"
                min="0"
                step="0.01"
                value={formatMoney(perDogAdder)}
                onChange={(e) => onPerDogAdderChange(parseMoney(e.target.value))}
                placeholder="0.00"
                className="pl-7"
                data-testid="input-per-dog-adder"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="first-time-fee">
              First Time Cleanup Fee
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                $
              </span>
              <Input
                id="first-time-fee"
                type="number"
                min="0"
                step="0.01"
                value={formatMoney(firstTimeCleanupFee)}
                onChange={(e) => onFirstTimeCleanupFeeChange(parseMoney(e.target.value))}
                placeholder="0.00"
                className="pl-7"
                data-testid="input-first-time-cleanup-fee"
              />
            </div>
          </div>
        </div>

        {showDepositPercent && (
          <div className="space-y-1 max-w-48">
            <Label className="text-xs" htmlFor="deposit-percent">
              Deposit Percent
            </Label>
            <div className="relative">
              <Input
                id="deposit-percent"
                type="number"
                min="0"
                max="100"
                step="1"
                value={depositPercent != null ? String(depositPercent) : ""}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  onDepositPercentChange?.(isNaN(n) ? null : Math.min(100, Math.max(0, n)));
                }}
                placeholder="0"
                className="pr-7"
                data-testid="input-deposit-percent"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                %
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Validate tiers for the settings/onboarding save path.
 * Returns a map of field key → error message.
 * Empty map = valid.
 */
export function validatePricingTiers(tiers: PricingTier[]): Record<string, string> {
  const errs: Record<string, string> = {};
  for (let i = 0; i < REQUIRED_TIERS; i++) {
    const t = tiers[i];
    if (!t || !t.label.trim()) {
      errs[`tier_${i + 1}_label`] = "Label is required";
    }
    if (!t || t.pricePerVisit === null || t.pricePerVisit === undefined) {
      errs[`tier_${i + 1}_price`] = "Price is required";
    }
  }
  return errs;
}
