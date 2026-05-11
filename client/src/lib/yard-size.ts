export type YardSizeTier = {
  name?: string;
  upToAcres: number | null;
  surcharge: number;
};

export function toFrac(ac: number): string {
  if (Math.abs(ac - 0.25) < 0.001) return "¼";
  if (Math.abs(ac - 0.5) < 0.001) return "½";
  if (Math.abs(ac - 0.75) < 0.001) return "¾";
  if (Math.abs(ac - 1) < 0.001) return "1";
  return `${ac}`;
}

export function yardSizeHint(tier: YardSizeTier, index: number, tiers: YardSizeTier[]): string {
  const prevTier = index > 0 ? tiers[index - 1] : null;
  const lowerAcres = prevTier?.upToAcres ?? 0;
  if (tier.upToAcres === null) {
    return lowerAcres > 0 ? `> ${toFrac(lowerAcres)} ac` : "any size";
  }
  if (index === 0) {
    return `< ${toFrac(tier.upToAcres)} ac`;
  }
  return `${toFrac(lowerAcres)}–${toFrac(tier.upToAcres)} ac`;
}

export function yardSizeLabel(storedValue: string, tiers?: YardSizeTier[]): string {
  if (!storedValue) return storedValue;
  if (!tiers || tiers.length === 0) return storedValue;
  const idx = tiers.findIndex((t) => (t.name ?? "") === storedValue);
  if (idx === -1) return storedValue;
  const hint = yardSizeHint(tiers[idx], idx, tiers);
  return `${storedValue} (${hint})`;
}
