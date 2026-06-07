/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  type QuoteDefaults,
  DEFAULT_QUOTE_DEFAULTS,
  type TierNames,
  DEFAULT_TIER_NAMES,
} from "@shared/schema";

function resolveImageUrl(url: string, baseUrl?: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const path = url.startsWith("/") ? url : `/objects/${url}`;
  return baseUrl ? `${baseUrl}${path}` : path;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ResidentialQuoteInput {
  type: "residential";
  dogCount: number;
  yardSize: string;
  frequency: "weekly" | "biweekly" | "monthly" | "onetime";
  isFirstTime: boolean;
}

export interface CommercialQuoteInput {
  type: "commercial";
  stationCount: number;
  commonAreaMinutes: number;
  frequency: "1x_weekly" | "2x_weekly" | "3x_weekly" | "monthly";
  timePerStation: number;
  mileageDistance: number;
  dumpFee: number;
  crewSize: number;
  siteSqft: number;
  isInitialClean: boolean;
  markupPct: number;
}

export type QuoteInput = ResidentialQuoteInput | CommercialQuoteInput;

export interface TierPricing {
  essential: number;
  premium: number;
  deluxe: number;
  initialCleanFee: number;
  essentialFeatures: string[];
  premiumFeatures: string[];
  deluxeFeatures: string[];
  breakdown: Record<string, any>;
}

/** A custom package assigned to a residential quote tier slot. */
export interface TierPackageInfo {
  description?: string | null;
  includedItems: string[];
  showInheritancePrefix?: boolean | null;
}

export interface TierPackages {
  tier1?: TierPackageInfo | null;
  tier2?: TierPackageInfo | null;
  tier3?: TierPackageInfo | null;
}

/**
 * Resolve the feature list + description shown for a tier card.
 * - If a package is assigned to the slot, use its includedItems (and optionally
 *   prepend the inheritance line) and its description.
 * - Otherwise fall back to the template features with no description.
 * `inheritanceLine` is null for tier1 (no inheritance) and the
 * "Everything in <prev>, plus:" string for tier2/tier3.
 */
function resolveTierContent(
  pkg: TierPackageInfo | null | undefined,
  templateFeatures: string[],
  inheritanceLine: string | null
): { features: string[]; description: string | null } {
  if (!pkg) {
    return { features: templateFeatures, description: null };
  }
  const features =
    inheritanceLine && pkg.showInheritancePrefix
      ? [inheritanceLine, ...pkg.includedItems]
      : [...pkg.includedItems];
  return { features, description: pkg.description ?? null };
}

type YardSizeTier = { name?: string; upToAcres: number | null; surcharge: number };

function getAcreageSurcharge(
  yardSize: string,
  defaults: QuoteDefaults,
  yardSizeTiers?: YardSizeTier[] | null
): number {
  if (yardSizeTiers && yardSizeTiers.length > 0) {
    // Always sort by upToAcres ascending (nulls = unbounded = last).
    // Boundary-sorted order is the primary resolution model so that lookup
    // results are consistent regardless of the order tiers are stored.
    const sorted = [...yardSizeTiers].sort(
      (a, b) => (a.upToAcres ?? Infinity) - (b.upToAcres ?? Infinity)
    );

    const nameLower = yardSize.toLowerCase().trim();

    // 1. Primary: name match within boundary-sorted tiers
    const nameMatch = sorted.find((t) => t.name && t.name.toLowerCase().trim() === nameLower);
    if (nameMatch) return nameMatch.surcharge;

    // 2. Boundary-based: yardSize value is numeric acreage — find first tier
    //    whose upper bound contains it (primary model for acreage inputs)
    const acresNum = parseFloat(yardSize);
    if (!isNaN(acresNum)) {
      for (const t of sorted) {
        if (t.upToAcres === null || acresNum <= t.upToAcres) return t.surcharge;
      }
    }

    // 3. Compatibility: legacy single-word names (small/medium/large/estate → position)
    const legacyMap: Record<string, number> = { small: 0, medium: 1, large: 2, estate: 3 };
    const legacyIdx = legacyMap[nameLower];
    if (legacyIdx !== undefined && sorted[legacyIdx]) {
      return sorted[legacyIdx].surcharge;
    }

    // 4. Compatibility: "Tier N" positional reference
    const tierMatch = nameLower.match(/^tier\s+(\d+)$/);
    if (tierMatch) {
      const idx = parseInt(tierMatch[1]) - 1;
      if (idx >= 0 && sorted[idx]) return sorted[idx].surcharge;
    }

    // 5. Final fallback: first (smallest) tier surcharge
    return sorted[0].surcharge;
  }
  // No configured tiers — fall back to QuoteDefaults-based lookup for legacy companies
  switch (yardSize.toLowerCase()) {
    case "small":
      return 0;
    case "medium":
      return defaults.acreageMediumSurcharge;
    case "large":
      return defaults.acreageLargeSurcharge;
    case "estate":
      return defaults.acreageEstateSurcharge;
    default:
      return 0;
  }
}

function getYardSizeLabel(size: string): string {
  return size;
}

type FirstTimeCleanupConfig = {
  baseAmount?: number;
  firstTimeCleanupMode?: "fixed" | "hourly" | "bucket";
  hourlyRate?: number;
  estimatedHours?: number;
  bucketFirstPrice?: number;
  bucketAdditionalPrice?: number;
  defaultBucketCount?: number;
};

export function calculateResidentialPricing(
  input: ResidentialQuoteInput,
  config?: Partial<QuoteDefaults> | null,
  yardSizeTiers?: YardSizeTier[] | null,
  firstTimeCleanupConfig?: FirstTimeCleanupConfig | null,
  tierNames?: TierNames | null
): TierPricing {
  const d = { ...DEFAULT_QUOTE_DEFAULTS, ...(config || {}) };
  const tn = { ...DEFAULT_TIER_NAMES, ...(tierNames || {}) };

  let basePerVisit = d.residentialBaseRate;
  const additionalDogs = Math.max(input.dogCount - 1, 0);
  const dogSurcharge = additionalDogs * d.perDogSurcharge;
  basePerVisit += dogSurcharge;

  const acreageSurcharge = getAcreageSurcharge(input.yardSize, d, yardSizeTiers);
  basePerVisit += acreageSurcharge;

  if (input.dogCount > 4) {
    basePerVisit = Math.round(basePerVisit * d.heavyAccumulationMultiplier * 100) / 100;
  }

  let initialCleanFee = 0;
  if (input.isFirstTime) {
    if (firstTimeCleanupConfig) {
      const mode = firstTimeCleanupConfig.firstTimeCleanupMode ?? "fixed";
      if (mode === "hourly") {
        const rate = firstTimeCleanupConfig.hourlyRate ?? 0;
        const hours = firstTimeCleanupConfig.estimatedHours ?? 1;
        initialCleanFee = Math.round(rate * hours * 100) / 100;
      } else if (mode === "bucket") {
        const firstBucket = firstTimeCleanupConfig.bucketFirstPrice ?? 0;
        const addlBucket = firstTimeCleanupConfig.bucketAdditionalPrice ?? 0;
        const buckets = Math.max(1, firstTimeCleanupConfig.defaultBucketCount ?? 1);
        initialCleanFee =
          Math.round((firstBucket + Math.max(0, buckets - 1) * addlBucket) * 100) / 100;
      } else {
        initialCleanFee = firstTimeCleanupConfig.baseAmount ?? 0;
      }
    } else {
      initialCleanFee = Math.min(
        Math.round(basePerVisit * d.initialCleanMultiplier * 100) / 100,
        d.initialCleanCap
      );
    }
  }

  const essential = Math.round(basePerVisit * 100) / 100;
  const premiumAddOns = d.premiumDeodorizerPrice + d.premiumGateCheckPrice;
  const premium = Math.round((basePerVisit + premiumAddOns) * 100) / 100;
  const deluxeAddOns = premiumAddOns + d.deluxeSanitizationPrice + d.deluxePriorityPrice;
  const deluxe = Math.round((basePerVisit + deluxeAddOns) * 100) / 100;

  const breakdown: Record<string, any> = {
    baseRate: d.residentialBaseRate,
    dogCount: input.dogCount,
    dogSurcharge,
    yardSize: input.yardSize,
    yardSizeLabel: getYardSizeLabel(input.yardSize),
    acreageSurcharge,
    heavyAccumulation: input.dogCount > 4,
    heavyAccumulationMultiplier: input.dogCount > 4 ? d.heavyAccumulationMultiplier : 1,
    frequency: input.frequency,
    isFirstTime: input.isFirstTime,
    initialCleanFee,
    premiumAddOns: {
      deodorizer: d.premiumDeodorizerPrice,
      gateCheck: d.premiumGateCheckPrice,
    },
    deluxeAddOns: {
      sanitization: d.deluxeSanitizationPrice,
      priority: d.deluxePriorityPrice,
    },
  };

  return {
    essential,
    premium,
    deluxe,
    initialCleanFee,
    essentialFeatures: [
      `${input.frequency === "weekly" ? "Weekly" : input.frequency === "biweekly" ? "Bi-weekly" : input.frequency === "monthly" ? "Monthly" : "One-time"} yard scooping`,
      `${input.dogCount} dog${input.dogCount !== 1 ? "s" : ""}`,
      `${getYardSizeLabel(input.yardSize)} yard`,
      "Waste removal & disposal",
      "Service confirmation notification",
    ],
    premiumFeatures: [
      `Everything in ${tn.tier1}, plus:`,
      `Yard deodorizer treatment (+$${d.premiumDeodorizerPrice}/visit)`,
      `Gate & fence safety check (+$${d.premiumGateCheckPrice}/visit)`,
      "Service completion photo",
    ],
    deluxeFeatures: [
      `Everything in ${tn.tier2}, plus:`,
      `Bi-weekly sanitization spray (+$${d.deluxeSanitizationPrice}/visit)`,
      `Priority scheduling (+$${d.deluxePriorityPrice}/visit)`,
      "Before & after photos",
      "Dedicated technician assignment",
    ],
    breakdown,
  };
}

export function calculateCommercialPricing(
  input: CommercialQuoteInput,
  config?: Partial<QuoteDefaults> | null
): TierPricing {
  const d = { ...DEFAULT_QUOTE_DEFAULTS, ...(config || {}) };

  const stationCost = input.stationCount * d.commercialStationRate;

  const timePerStation = input.timePerStation || d.commercialTimePerStation;
  const totalStationMinutes = input.stationCount * timePerStation;
  const totalLaborMinutes = totalStationMinutes + input.commonAreaMinutes;
  const totalLaborHours = totalLaborMinutes / 60;

  const crewSize = Math.max(input.crewSize || 1, 1);
  const laborCost = Math.round(totalLaborHours * d.commercialCrewRate * crewSize * 100) / 100;

  const mileageDistance = input.mileageDistance || 0;
  const mileageCost = Math.round(mileageDistance * d.commercialMileageRate * 100) / 100;

  const dumpFee = input.dumpFee ?? d.commercialDumpFee;

  let costSubtotal = stationCost + laborCost + mileageCost + dumpFee;

  let visitsPerWeek = 1;
  let discountPct = 0;
  switch (input.frequency) {
    case "2x_weekly":
      visitsPerWeek = 2;
      discountPct = d.commercialDensityDiscount2x;
      break;
    case "3x_weekly":
      visitsPerWeek = 3;
      discountPct = d.commercialDensityDiscount3x;
      break;
    case "monthly":
      visitsPerWeek = 0.25;
      break;
  }

  if (discountPct > 0 && visitsPerWeek > 1) {
    const firstVisitCost = costSubtotal;
    const additionalVisitCost = costSubtotal * (1 - discountPct);
    costSubtotal =
      Math.round(
        ((firstVisitCost + additionalVisitCost * (visitsPerWeek - 1)) / visitsPerWeek) * 100
      ) / 100;
  }

  let initialCleanFee = 0;
  if (input.isInitialClean) {
    initialCleanFee = d.commercialInitialCleanRate;
    const sqftMultiplier = input.siteSqft > 0 ? Math.max(1, Math.ceil(input.siteSqft / 10000)) : 1;
    initialCleanFee = initialCleanFee * sqftMultiplier;
  }

  const markupPct = Math.max(input.markupPct ?? 20, 0);
  const markupFee = Math.round(costSubtotal * (markupPct / 100) * 100) / 100;
  const basePerVisit = Math.round((costSubtotal + markupFee) * 100) / 100;

  const essential = basePerVisit;
  const premiumUpcharge = input.stationCount * d.commercialPremiumStationUpcharge;
  const premium = Math.round((basePerVisit + premiumUpcharge) * 100) / 100;
  const deluxeUpcharge = input.stationCount * d.commercialDeluxeStationUpcharge;
  const deluxe = Math.round((basePerVisit + deluxeUpcharge) * 100) / 100;

  const frequencyLabel =
    input.frequency === "1x_weekly"
      ? "Weekly"
      : input.frequency === "2x_weekly"
        ? "2x Weekly"
        : input.frequency === "3x_weekly"
          ? "3x Weekly"
          : "Monthly";

  const visitsPerMonth = Math.round(visitsPerWeek * 4.33 * 100) / 100;

  const breakdown: Record<string, any> = {
    stationCount: input.stationCount,
    stationRate: d.commercialStationRate,
    stationCost,
    timePerStation,
    totalStationMinutes,
    commonAreaMinutes: input.commonAreaMinutes,
    totalLaborMinutes,
    totalLaborHours: Math.round(totalLaborHours * 100) / 100,
    crewSize,
    crewRate: d.commercialCrewRate,
    laborCost,
    mileageDistance,
    mileageRate: d.commercialMileageRate,
    mileageCost,
    dumpFee,
    costSubtotal: Math.round(costSubtotal * 100) / 100,
    markupPct,
    markupFee,
    siteSqft: input.siteSqft || 0,
    frequency: input.frequency,
    frequencyLabel,
    visitsPerWeek,
    visitsPerMonth,
    densityDiscount: discountPct > 0 ? `${(discountPct * 100).toFixed(0)}%` : null,
    isInitialClean: input.isInitialClean,
    initialCleanFee,
    weeklyTotal: Math.round(essential * Math.max(visitsPerWeek, 1) * 100) / 100,
    monthlyEstimate: Math.round(essential * visitsPerMonth * 100) / 100,
    fieldRate: d.commercialFieldRate,
  };

  return {
    essential,
    premium,
    deluxe,
    initialCleanFee,
    essentialFeatures: [
      `${frequencyLabel} station maintenance`,
      input.stationCount > 0
        ? `${input.stationCount} waste station${input.stationCount !== 1 ? "s" : ""} (${timePerStation} min each)`
        : "",
      "Station emptying & bag refill",
      `Common area scooping (${input.commonAreaMinutes} min)`,
      `${crewSize}-person crew · ${Math.round(totalLaborHours * 10) / 10} hr total labor`,
      mileageDistance > 0 ? `Travel: ${mileageDistance} mi round trip` : "",
      dumpFee > 0 ? `Waste disposal included ($${dumpFee.toFixed(2)}/visit)` : "",
      "GPS-verified service logs",
      discountPct > 0 ? `${(discountPct * 100).toFixed(0)}% multi-visit discount applied` : "",
    ].filter(Boolean),
    premiumFeatures: [
      "Everything in Essential, plus:",
      `Station sanitization (+$${d.commercialPremiumStationUpcharge}/station/visit)`,
      "Odor neutralizer treatment",
      "Monthly service report for board",
      "Photo documentation per visit",
    ],
    deluxeFeatures: [
      "Everything in Property Care, plus:",
      `Full station deep clean (+$${d.commercialDeluxeStationUpcharge}/station/visit)`,
      "Bi-weekly ground sanitization",
      "Priority scheduling & response",
      "Quarterly compliance audit report",
      "Dedicated account manager",
    ],
    breakdown,
  };
}

export function calculateQuotePricing(
  input: QuoteInput,
  config?: Partial<QuoteDefaults> | null,
  yardSizeTiers?: YardSizeTier[] | null,
  firstTimeCleanupConfig?: FirstTimeCleanupConfig | null,
  tierNames?: TierNames | null
): TierPricing {
  if (input.type === "residential") {
    return calculateResidentialPricing(
      input,
      config,
      yardSizeTiers,
      firstTimeCleanupConfig,
      tierNames
    );
  }
  // Commercial quotes intentionally keep their fixed tier labels and are not
  // affected by the residential tierNames configuration.
  return calculateCommercialPricing(input, config);
}

export function renderResidentialProposalHtml(data: {
  companyName: string;
  companyEmail?: string;
  companyPhone?: string;
  companyLogo?: string;
  contactName: string;
  quoteNumber: string;
  propertyAddress?: string;
  pricing: TierPricing;
  frequency: string;
  expiresAt?: string;
  notes?: string;
  acceptUrl?: string;
  images?: { url: string; caption: string; sqft?: number }[];
  baseUrl?: string;
  lineItems?: { pricingItemId: string; name: string; unitPrice: number; quantity: number }[];
  frequencyOptions?: {
    weekly: { perVisit: number; monthlyEstimate: number; acceptUrl: string };
    biweekly: { perVisit: number; monthlyEstimate: number; acceptUrl: string };
    monthly: { perVisit: number; monthlyEstimate: number; acceptUrl: string };
  };
  tierNames?: TierNames | null;
  tierPackages?: TierPackages | null;
}): string {
  const { pricing } = data;
  const tierLabels = { ...DEFAULT_TIER_NAMES, ...(data.tierNames || {}) };

  // Resolve each tier's feature list + description: a package assigned to the
  // slot overrides the template text; otherwise fall back to the template
  // exactly as before. tier2/tier3 packages may prepend an inheritance line.
  const tp = data.tierPackages || {};
  const tier1Content = resolveTierContent(tp.tier1, pricing.essentialFeatures, null);
  const tier2Content = resolveTierContent(
    tp.tier2,
    pricing.premiumFeatures,
    `Everything in ${tierLabels.tier1}, plus:`
  );
  const tier3Content = resolveTierContent(
    tp.tier3,
    pricing.deluxeFeatures,
    `Everything in ${tierLabels.tier2}, plus:`
  );
  const e = {
    companyName: escapeHtml(data.companyName),
    contactName: escapeHtml(data.contactName),
    quoteNumber: escapeHtml(data.quoteNumber),
    propertyAddress: data.propertyAddress ? escapeHtml(data.propertyAddress) : undefined,
    notes: data.notes ? escapeHtml(data.notes) : undefined,
    companyEmail: data.companyEmail ? escapeHtml(data.companyEmail) : undefined,
    companyPhone: data.companyPhone ? escapeHtml(data.companyPhone) : undefined,
    acceptUrl: data.acceptUrl,
    companyLogo: data.companyLogo,
    expiresAt: data.expiresAt,
  };
  const frequencyLabel =
    data.frequency === "weekly"
      ? "Weekly"
      : data.frequency === "biweekly"
        ? "Bi-weekly"
        : data.frequency === "monthly"
          ? "Monthly"
          : "One-time";

  function frequencyCard(
    label: string,
    perVisit: number,
    monthlyEstimate: number,
    cardAcceptUrl: string,
    recommended?: boolean
  ) {
    const color = recommended ? "#1a7a4c" : "#64748b";
    return `
      <div class="tier-card" style="flex: 1; min-width: 200px; border: 2px solid ${recommended ? color : "#e2e8f0"}; border-radius: 12px; overflow: hidden; ${recommended ? "box-shadow: 0 4px 12px rgba(0,0,0,0.1);" : ""}">
        ${recommended ? `<div style="background-color: ${color}; color: white; text-align: center; padding: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Most Popular</div>` : ""}
        <div style="padding: 20px; text-align: center;">
          <h3 style="margin: 0 0 8px; font-size: 18px; color: #1e293b;">${label}</h3>
          <p style="margin: 0 0 4px; font-size: 30px; font-weight: 700; color: ${color};">$${perVisit.toFixed(2)}<span style="font-size: 14px; font-weight: 400; color: #64748b;">/visit</span></p>
          <p style="margin: 0 0 16px; font-size: 13px; color: #64748b;">~$${monthlyEstimate.toFixed(2)}/month</p>
          <a href="${cardAcceptUrl}" style="display: block; background-color: ${color}; color: white; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600;">Sign Up for ${label}</a>
        </div>
      </div>`;
  }

  function tierCard(
    name: string,
    price: number,
    features: string[],
    color: string,
    recommended?: boolean,
    description?: string | null
  ) {
    return `
      <div class="tier-card" style="flex: 1; min-width: 200px; border: 2px solid ${recommended ? color : "#e2e8f0"}; border-radius: 12px; overflow: hidden; ${recommended ? "box-shadow: 0 4px 12px rgba(0,0,0,0.1);" : ""}">
        ${recommended ? `<div style="background-color: ${color}; color: white; text-align: center; padding: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Most Popular</div>` : ""}
        <div style="padding: 20px; text-align: center;">
          <h3 style="margin: 0 0 4px; font-size: 18px; color: #1e293b;">${escapeHtml(name)}</h3>
          <p style="margin: 0 0 ${description ? "8" : "12"}px; font-size: 32px; font-weight: 700; color: ${color};">$${price.toFixed(2)}<span style="font-size: 14px; font-weight: 400; color: #64748b;">/visit</span></p>
          ${description ? `<p style="margin: 0 0 12px; font-size: 13px; color: #64748b; text-align: center;">${escapeHtml(description)}</p>` : ""}
          <ul style="list-style: none; padding: 0; margin: 0; text-align: left;">
            ${features.map((f) => `<li style="padding: 6px 0; font-size: 13px; color: #475569; border-bottom: 1px solid #f1f5f9;">✓ ${escapeHtml(f)}</li>`).join("")}
          </ul>
        </div>
      </div>`;
  }

  const initialCleanSection =
    pricing.initialCleanFee > 0
      ? `
    <div style="background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px 16px; margin-top: 20px;">
      <p style="margin: 0; font-size: 14px; color: #92400e;">
        <strong>Initial Clean Fee:</strong> $${pricing.initialCleanFee.toFixed(2)} (one-time) — Covers first-visit deep clean for accumulated waste.
      </p>
    </div>`
      : "";

  const hasLineItems = Array.isArray(data.lineItems) && data.lineItems.length > 0;

  const pricingBreakdownBox = `
        <div style="background-color: #f8fafc; border-radius: 8px; padding: 14px 18px; margin-bottom: 20px;">
          <p style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #334155;">Your Pricing</p>
          <table style="width: 100%; font-size: 13px; color: #475569;">
            ${pricing.breakdown.baseRate ? `<tr><td style="padding: 2px 0;">Base rate</td><td style="text-align: right;">$${Number(pricing.breakdown.baseRate).toFixed(2)}</td></tr>` : ""}
            ${pricing.breakdown.dogSurcharge && pricing.breakdown.dogSurcharge > 0 ? `<tr><td style="padding: 2px 0;">Dog surcharge (${pricing.breakdown.dogCount || ""})</td><td style="text-align: right;">+$${Number(pricing.breakdown.dogSurcharge).toFixed(2)}</td></tr>` : ""}
            ${pricing.breakdown.acreageSurcharge && pricing.breakdown.acreageSurcharge > 0 ? `<tr><td style="padding: 2px 0;">Yard size (${escapeHtml(String(pricing.breakdown.yardSize || ""))})</td><td style="text-align: right;">+$${Number(pricing.breakdown.acreageSurcharge).toFixed(2)}</td></tr>` : ""}
            ${pricing.breakdown.heavyAccumulation ? `<tr><td style="padding: 2px 0;">Heavy accumulation (${pricing.breakdown.heavyAccumulationMultiplier}x)</td><td style="text-align: right;">applied</td></tr>` : ""}
          </table>
        </div>`;

  function renderLineItemsTable(): string {
    const items = data.lineItems!;
    const grandTotal = items.reduce((sum, li) => sum + li.unitPrice * li.quantity, 0);
    const rows = items
      .map(
        (li) => `
        <tr>
          <td class="li-cell" style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #1e293b;">${escapeHtml(li.name)}</td>
          <td class="li-cell" style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #475569; text-align: center;">${li.quantity}</td>
          <td class="li-cell li-unitprice" style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #475569; text-align: right;">$${Number(li.unitPrice).toFixed(2)}</td>
          <td class="li-cell" style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 13px; font-weight: 600; color: #1e293b; text-align: right;">$${(li.unitPrice * li.quantity).toFixed(2)}</td>
        </tr>`
      )
      .join("");
    return `
      <div style="background-color: #f8fafc; border-radius: 8px; padding: 0; margin-bottom: 20px; overflow: hidden; border: 1px solid #e2e8f0;">
        <p style="margin: 0; padding: 12px 14px 10px; font-size: 13px; font-weight: 600; color: #334155; border-bottom: 1px solid #e2e8f0;">Services Included</p>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background-color: #f1f5f9;">
              <th class="li-header" style="padding: 8px 10px; font-size: 12px; font-weight: 600; color: #64748b; text-align: left; text-transform: uppercase; letter-spacing: 0.05em;">Service</th>
              <th class="li-header" style="padding: 8px 10px; font-size: 12px; font-weight: 600; color: #64748b; text-align: center; text-transform: uppercase; letter-spacing: 0.05em;">Qty</th>
              <th class="li-header li-unitprice" style="padding: 8px 10px; font-size: 12px; font-weight: 600; color: #64748b; text-align: right; text-transform: uppercase; letter-spacing: 0.05em;">Unit Price</th>
              <th class="li-header" style="padding: 8px 10px; font-size: 12px; font-weight: 600; color: #64748b; text-align: right; text-transform: uppercase; letter-spacing: 0.05em;">Subtotal</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="background-color: #f1f5f9;">
              <td class="li-cell li-tfoot-label" colspan="3" style="padding: 10px 10px; font-size: 14px; font-weight: 700; color: #1e293b; text-align: right;">Total per visit</td>
              <td class="li-cell li-tfoot-total" style="padding: 10px 10px; font-size: 14px; font-weight: 700; color: #1a7a4c; text-align: right;">$${grandTotal.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }

  const pricingSection = hasLineItems
    ? renderLineItemsTable()
    : data.frequencyOptions
      ? `
        ${pricingBreakdownBox}
        <h2 style="margin: 0 0 16px; font-size: 18px; color: #1e293b; text-align: center;">Choose Your Service Frequency</h2>
        <div class="tier-cards" style="display: flex; gap: 16px; flex-wrap: wrap;">
          ${frequencyCard("Weekly", data.frequencyOptions.weekly.perVisit, data.frequencyOptions.weekly.monthlyEstimate, data.frequencyOptions.weekly.acceptUrl)}
          ${frequencyCard("Bi-Weekly", data.frequencyOptions.biweekly.perVisit, data.frequencyOptions.biweekly.monthlyEstimate, data.frequencyOptions.biweekly.acceptUrl, true)}
          ${frequencyCard("Monthly", data.frequencyOptions.monthly.perVisit, data.frequencyOptions.monthly.monthlyEstimate, data.frequencyOptions.monthly.acceptUrl)}
        </div>`
      : `
        ${pricingBreakdownBox}
        <p style="margin: 0 0 24px; font-size: 14px; color: #475569;">Service Frequency: <strong>${frequencyLabel}</strong></p>
        <h2 style="margin: 0 0 16px; font-size: 18px; color: #1e293b; text-align: center;">Choose Your Service Level</h2>
        <div class="tier-cards" style="display: flex; gap: 16px; flex-wrap: wrap;">
          ${tierCard(tierLabels.tier1, pricing.essential, tier1Content.features, "#64748b", false, tier1Content.description)}
          ${tierCard(tierLabels.tier2, pricing.premium, tier2Content.features, "#1a7a4c", true, tier2Content.description)}
          ${tierCard(tierLabels.tier3, pricing.deluxe, tier3Content.features, "#7c3aed", false, tier3Content.description)}
        </div>`;

  return `
    <style>
      @media only screen and (max-width: 480px) {
        .quote-body { padding: 16px !important; }
        .tier-cards { display: block !important; }
        .tier-card { display: block !important; min-width: 0 !important; width: 100% !important; margin-bottom: 12px !important; box-sizing: border-box !important; }
        .cta-wrap { padding-left: 0 !important; padding-right: 0 !important; }
        .cta-link { display: block !important; width: 100% !important; box-sizing: border-box !important; padding: 14px 16px !important; text-align: center !important; }
        .img-flex { display: block !important; }
        .img-item { display: block !important; min-width: 0 !important; max-width: 100% !important; width: 100% !important; margin-bottom: 12px !important; box-sizing: border-box !important; }
        .li-unitprice { display: none !important; }
        .li-cell { padding: 6px 6px !important; font-size: 12px !important; }
        .li-header { padding: 6px 6px !important; font-size: 11px !important; }
        .li-tfoot-label { display: none !important; }
        .li-tfoot-total { text-align: left !important; }
      }
    </style>
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 700px; margin: 0 auto; background-color: #ffffff;">
      <div style="background-color: #1a7a4c; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        ${e.companyLogo ? `<img src="${e.companyLogo}" alt="${e.companyName}" style="max-height: 50px; margin-bottom: 8px;" />` : ""}
        <h1 style="color: white; margin: 0; font-size: 22px;">${e.companyName}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 4px 0 0; font-size: 17px; font-weight: 600;">Service Proposal</p>
        <p style="color: rgba(255,255,255,0.6); margin: 2px 0 0; font-size: 13px;">#${e.quoteNumber}</p>
      </div>

      <div class="quote-body" style="padding: 24px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="margin: 0 0 4px; font-size: 14px; color: #64748b;">Prepared for</p>
        <p style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #1e293b;">${e.contactName}</p>
        ${e.propertyAddress ? `<p style="margin: 0 0 16px; font-size: 14px; color: #475569;">${e.propertyAddress}</p>` : ""}

        ${pricingSection}

        ${initialCleanSection}

        ${
          data.images && data.images.length > 0
            ? `
          <div style="margin-top: 24px;">
            <h3 style="margin: 0 0 12px; font-size: 15px; color: #1e293b;">Property Measurement</h3>
            <div class="img-flex" style="display: flex; gap: 12px; flex-wrap: wrap;">
              ${data.images
                .map((img) => {
                  const imgSrc = resolveImageUrl(img.url, data.baseUrl);
                  return `<div class="img-item" style="flex: 1; min-width: 240px; max-width: 380px;">
                  <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(img.caption)}" style="width: 100%; border-radius: 8px; border: 1px solid #e2e8f0;" />
                  <p style="margin: 6px 0 0; font-size: 12px; color: #64748b; text-align: center;">${escapeHtml(img.caption)}</p>
                </div>`;
                })
                .join("")}
            </div>
          </div>`
            : ""
        }

        ${e.notes ? `<div style="margin-top: 20px; padding: 12px 16px; background-color: #f8fafc; border-radius: 8px;"><p style="margin: 0; font-size: 13px; color: #475569;">${e.notes}</p></div>` : ""}

        ${
          e.acceptUrl
            ? data.frequencyOptions
              ? `
          <div style="margin-top: 24px; padding: 16px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; text-align: center;">
            <p style="margin: 0 0 8px; font-size: 14px; color: #374151;">Ready to get started? Click any option above to sign up instantly${e.companyPhone ? `, or call/text ${e.companyPhone}` : ""}.</p>
            <a href="${e.acceptUrl}" style="font-size: 13px; color: #1a7a4c; text-decoration: underline;">View full quote</a>
          </div>`
              : `
          <div class="cta-wrap" style="text-align: center; margin: 28px 0 20px;">
            <a href="${e.acceptUrl}" class="cta-link" style="display: inline-block; background-color: #1a7a4c; color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 6px; font-size: 16px; font-weight: 600;">View & Accept Quote</a>
          </div>`
            : ""
        }

        ${e.expiresAt ? `<p style="text-align: center; font-size: 12px; color: #94a3b8;">This quote expires on ${new Date(e.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>` : ""}
      </div>

      <div style="padding: 16px; text-align: center; font-size: 11px; color: #94a3b8;">
        ${e.companyName}${e.companyPhone ? ` • ${e.companyPhone}` : ""}${e.companyEmail ? ` • ${e.companyEmail}` : ""}
      </div>
    </div>`;
}

export function renderCommercialProposalHtml(data: {
  companyName: string;
  companyEmail?: string;
  companyPhone?: string;
  companyLogo?: string;
  contactName: string;
  quoteNumber: string;
  propertyAddress?: string;
  pricing: TierPricing;
  frequency: string;
  expiresAt?: string;
  notes?: string;
  acceptUrl?: string;
  images?: { url: string; caption: string; sqft?: number }[];
  baseUrl?: string;
  tierAcceptUrls?: {
    essential: string;
    premium: string;
    deluxe: string;
  };
}): string {
  const { pricing } = data;
  const breakdown = pricing.breakdown || {};
  const e = {
    companyName: escapeHtml(data.companyName),
    contactName: escapeHtml(data.contactName),
    quoteNumber: escapeHtml(data.quoteNumber),
    propertyAddress: data.propertyAddress ? escapeHtml(data.propertyAddress) : undefined,
    notes: data.notes ? escapeHtml(data.notes) : undefined,
    companyEmail: data.companyEmail ? escapeHtml(data.companyEmail) : undefined,
    companyPhone: data.companyPhone ? escapeHtml(data.companyPhone) : undefined,
    acceptUrl: data.acceptUrl,
    companyLogo: data.companyLogo,
    expiresAt: data.expiresAt,
  };

  function tierRow(name: string, price: number, features: string[], acceptUrl?: string) {
    return `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #1e293b;">${escapeHtml(name)}</td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; text-align: right; font-size: 18px; font-weight: 700; color: #1a7a4c;">$${price.toFixed(2)}/visit</td>
      </tr>
      <tr>
        <td colspan="2" style="padding: 8px 16px 16px; border-bottom: 2px solid #e2e8f0;">
          <ul style="margin: 0; padding: 0 0 0 16px; font-size: 13px; color: #475569;">
            ${features.map((f) => `<li style="padding: 3px 0;">${escapeHtml(f)}</li>`).join("")}
          </ul>
          ${acceptUrl ? `<div style="margin-top: 12px; text-align: center;"><a href="${acceptUrl}" style="display: inline-block; background-color: #1a7a4c; color: white; text-decoration: none; padding: 8px 24px; border-radius: 6px; font-size: 13px; font-weight: 600;">Sign Up for ${escapeHtml(name)}</a></div>` : ""}
        </td>
      </tr>`;
  }

  return `
    <style>
      @media only screen and (max-width: 480px) {
        .comm-body { padding: 16px !important; }
        .comm-scope-cell { padding: 6px 8px !important; font-size: 13px !important; }
        .cta-wrap { padding-left: 0 !important; padding-right: 0 !important; }
        .cta-link { display: block !important; width: 100% !important; box-sizing: border-box !important; padding: 14px 16px !important; text-align: center !important; }
        .img-flex { display: block !important; }
        .img-item { display: block !important; min-width: 0 !important; max-width: 100% !important; width: 100% !important; margin-bottom: 12px !important; box-sizing: border-box !important; }
      }
    </style>
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 750px; margin: 0 auto; background-color: #ffffff;">
      <div style="background-color: #0f172a; padding: 32px; text-align: center; border-radius: 8px 8px 0 0;">
        ${e.companyLogo ? `<img src="${e.companyLogo}" alt="${e.companyName}" style="max-height: 50px; margin-bottom: 12px;" />` : ""}
        <h1 style="color: white; margin: 0; font-size: 24px; letter-spacing: 0.5px;">${e.companyName}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 18px; font-weight: 600;">Service Proposal</p>
        <p style="color: rgba(255,255,255,0.6); margin: 4px 0 0; font-size: 13px;">#${e.quoteNumber}</p>
      </div>

      <div class="comm-body" style="padding: 32px; border: 1px solid #e2e8f0; border-top: none;">
        <h2 style="margin: 0 0 12px; font-size: 18px; color: #0f172a; border-bottom: 2px solid #1a7a4c; padding-bottom: 8px;">Executive Summary</h2>
        <p style="margin: 0 0 8px; font-size: 14px; color: #475569;">Prepared for: <strong>${e.contactName}</strong></p>
        ${e.propertyAddress ? `<p style="margin: 0 0 8px; font-size: 14px; color: #475569;">Property: <strong>${e.propertyAddress}</strong></p>` : ""}
        <p style="margin: 0 0 20px; font-size: 14px; color: #475569;">
          This proposal outlines a comprehensive pet waste management solution for your property,
          ${(breakdown.stationCount || 0) > 0 ? `including maintenance of ${breakdown.stationCount} waste station${breakdown.stationCount !== 1 ? "s" : ""},` : "including"}
          ${breakdown.commonAreaMinutes || 0} minutes of common area servicing,
          and an estimated ${breakdown.totalLaborHours || 0} hours of on-site labor per visit
          with a ${breakdown.crewSize || 1}-person crew.
        </p>

        <h2 style="margin: 24px 0 12px; font-size: 18px; color: #0f172a; border-bottom: 2px solid #1a7a4c; padding-bottom: 8px;">Scope of Work</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 14px;">
          <tr style="background-color: #f8fafc;">
            <td class="comm-scope-cell" style="padding: 8px 12px; font-weight: 600;">Service Frequency</td>
            <td class="comm-scope-cell" style="padding: 8px 12px;">${breakdown.frequencyLabel || data.frequency} (${breakdown.visitsPerMonth || 0} visits/month)</td>
          </tr>
          <tr>
            <td class="comm-scope-cell" style="padding: 8px 12px; font-weight: 600;">Waste Stations</td>
            <td class="comm-scope-cell" style="padding: 8px 12px;">${(breakdown.stationCount || 0) > 0 ? `${breakdown.stationCount} station${breakdown.stationCount !== 1 ? "s" : ""} maintained per visit` : "No waste stations"}</td>
          </tr>
          ${
            (breakdown.stationCount || 0) > 0
              ? `<tr style="background-color: #f8fafc;">
            <td class="comm-scope-cell" style="padding: 8px 12px; font-weight: 600;">Time Per Station</td>
            <td class="comm-scope-cell" style="padding: 8px 12px;">${breakdown.timePerStation || 0} min × ${breakdown.stationCount || 0} stations = ${breakdown.totalStationMinutes || 0} min</td>
          </tr>`
              : ""
          }
          <tr>
            <td class="comm-scope-cell" style="padding: 8px 12px; font-weight: 600;">Common Area Service</td>
            <td class="comm-scope-cell" style="padding: 8px 12px;">${breakdown.commonAreaMinutes || 0} minutes</td>
          </tr>
          <tr style="background-color: #f8fafc;">
            <td class="comm-scope-cell" style="padding: 8px 12px; font-weight: 600;">On-Site Labor</td>
            <td class="comm-scope-cell" style="padding: 8px 12px;">${breakdown.totalLaborHours || 0} hrs with ${breakdown.crewSize || 1}-person crew</td>
          </tr>
          ${
            (breakdown.mileageDistance || 0) > 0
              ? `<tr>
            <td class="comm-scope-cell" style="padding: 8px 12px; font-weight: 600;">Travel</td>
            <td class="comm-scope-cell" style="padding: 8px 12px;">Included (${breakdown.mileageDistance} mi round-trip)</td>
          </tr>`
              : ""
          }
          ${
            (breakdown.dumpFee || 0) > 0
              ? `<tr style="background-color: #f8fafc;">
            <td class="comm-scope-cell" style="padding: 8px 12px; font-weight: 600;">Waste Disposal</td>
            <td class="comm-scope-cell" style="padding: 8px 12px;">Included</td>
          </tr>`
              : ""
          }
          ${
            (breakdown.siteSqft || 0) > 0
              ? `<tr>
            <td class="comm-scope-cell" style="padding: 8px 12px; font-weight: 600;">Site Area</td>
            <td class="comm-scope-cell" style="padding: 8px 12px;">${(breakdown.siteSqft || 0).toLocaleString()} sq ft</td>
          </tr>`
              : ""
          }
          ${
            breakdown.densityDiscount
              ? `<tr>
            <td class="comm-scope-cell" style="padding: 8px 12px; font-weight: 600;">Multi-Visit Discount</td>
            <td class="comm-scope-cell" style="padding: 8px 12px; color: #1a7a4c; font-weight: 600;">${breakdown.densityDiscount} off additional visits</td>
          </tr>`
              : ""
          }
          <tr style="background-color: #f1f5f9;">
            <td class="comm-scope-cell" style="padding: 8px 12px; font-weight: 600;">Per-Visit Total</td>
            <td class="comm-scope-cell" style="padding: 8px 12px; font-weight: 700; color: #1a7a4c;">$${pricing.essential.toFixed(2)}</td>
          </tr>
          ${
            (pricing.initialCleanFee || 0) > 0
              ? `<tr style="background-color: #fef3c7;">
            <td class="comm-scope-cell" style="padding: 8px 12px; font-weight: 600;">Initial Deep Clean (one-time)</td>
            <td class="comm-scope-cell" style="padding: 8px 12px; font-weight: 600;">$${pricing.initialCleanFee.toFixed(2)}</td>
          </tr>`
              : ""
          }
          <tr style="background-color: #f1f5f9;">
            <td class="comm-scope-cell" style="padding: 8px 12px; font-weight: 600;">Est. Monthly Investment</td>
            <td class="comm-scope-cell" style="padding: 8px 12px; font-weight: 700; color: #1a7a4c;">$${(breakdown.monthlyEstimate || 0).toFixed(2)}</td>
          </tr>
        </table>

        <h2 style="margin: 24px 0 12px; font-size: 18px; color: #0f172a; border-bottom: 2px solid #1a7a4c; padding-bottom: 8px;">Service Tiers</h2>
        <table style="width: 100%; border-collapse: collapse;">
          ${tierRow("Essential", pricing.essential, pricing.essentialFeatures, data.tierAcceptUrls?.essential)}
          ${tierRow("Property Care", pricing.premium, pricing.premiumFeatures, data.tierAcceptUrls?.premium)}
          ${tierRow("Deluxe", pricing.deluxe, pricing.deluxeFeatures, data.tierAcceptUrls?.deluxe)}
        </table>

        <div style="margin-top: 24px; padding: 16px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;">
          <h3 style="margin: 0 0 8px; font-size: 15px; color: #166534;">Governance & Compliance</h3>
          <ul style="margin: 0; padding: 0 0 0 16px; font-size: 13px; color: #15803d;">
            <li style="padding: 3px 0;">✓ General Liability & Workers' Compensation coverage maintained</li>
            <li style="padding: 3px 0;">✓ GPS-Verified Service Logs for board auditing (ScooPilot Technology)</li>
            <li style="padding: 3px 0;">✓ Proof-of-service photo documentation per visit</li>
            <li style="padding: 3px 0;">✓ Digital service records available on demand</li>
          </ul>
        </div>

        <div style="margin-top: 20px; padding: 16px; background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px;">
          <h3 style="margin: 0 0 8px; font-size: 15px; color: #1e40af;">Why ${e.companyName}?</h3>
          <ul style="margin: 0; padding: 0 0 0 16px; font-size: 13px; color: #1e40af;">
            <li style="padding: 3px 0;">Real-time GPS tracking confirms every service visit</li>
            <li style="padding: 3px 0;">Digital service logs exportable for board meetings</li>
            <li style="padding: 3px 0;">Automated scheduling ensures consistent, reliable service</li>
            <li style="padding: 3px 0;">Fully insured and bonded team members</li>
            <li style="padding: 3px 0;">Online portal for service history and communication</li>
          </ul>
        </div>

        ${
          data.images && data.images.length > 0
            ? `
          <div style="margin-top: 24px;">
            <h3 style="margin: 0 0 12px; font-size: 15px; color: #1e293b;">Site Overview</h3>
            <div class="img-flex" style="display: flex; gap: 12px; flex-wrap: wrap;">
              ${data.images
                .map((img) => {
                  const imgSrc = resolveImageUrl(img.url, data.baseUrl);
                  return `<div class="img-item" style="flex: 1; min-width: 240px; max-width: 380px;">
                  <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(img.caption)}" style="width: 100%; border-radius: 8px; border: 1px solid #e2e8f0;" />
                  <p style="margin: 6px 0 0; font-size: 12px; color: #64748b; text-align: center;">${escapeHtml(img.caption)}</p>
                </div>`;
                })
                .join("")}
            </div>
          </div>`
            : ""
        }

        ${e.notes ? `<div style="margin-top: 20px; padding: 12px 16px; background-color: #f8fafc; border-radius: 8px;"><p style="margin: 0; font-size: 13px; color: #475569;">${e.notes}</p></div>` : ""}

        <div style="margin-top: 24px; padding: 16px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; text-align: center;">
          <p style="margin: 0 0 8px; font-size: 14px; color: #374151;">Ready to get started? Click the tier above that best fits your property${e.companyPhone ? `, or call/text ${e.companyPhone}` : ""}.</p>
          ${e.acceptUrl ? `<a href="${e.acceptUrl}" style="font-size: 13px; color: #1a7a4c; text-decoration: underline;">View full proposal</a>` : ""}
        </div>

        ${e.expiresAt ? `<p style="text-align: center; font-size: 12px; color: #94a3b8; margin-top: 16px;">This proposal is valid until ${new Date(e.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>` : ""}
      </div>

      <div style="padding: 16px; text-align: center; font-size: 11px; color: #94a3b8;">
        ${e.companyName}${e.companyPhone ? ` • ${e.companyPhone}` : ""}${e.companyEmail ? ` • ${e.companyEmail}` : ""}
      </div>
    </div>`;
}

export function renderQuoteSmsText(data: {
  companyName: string;
  contactName: string;
  quoteNumber: string;
  pricing: TierPricing;
  type: "residential" | "commercial";
  frequency: string;
  acceptUrl?: string;
  tierNames?: TierNames | null;
}): string {
  // Residential quotes use the company's configured tier labels; commercial
  // quotes keep the fixed defaults.
  const tl =
    data.type === "residential"
      ? { ...DEFAULT_TIER_NAMES, ...(data.tierNames || {}) }
      : DEFAULT_TIER_NAMES;
  const lines: string[] = [
    `Hi ${data.contactName},`,
    ``,
    `${data.companyName} has prepared a ${data.type === "commercial" ? "site management proposal" : "service quote"} for you (Quote #${data.quoteNumber}):`,
    ``,
    `${tl.tier1}: $${data.pricing.essential.toFixed(2)}/visit`,
    `${tl.tier2}: $${data.pricing.premium.toFixed(2)}/visit`,
    `${tl.tier3}: $${data.pricing.deluxe.toFixed(2)}/visit`,
  ];

  if (data.pricing.initialCleanFee > 0) {
    lines.push(`Initial Clean: $${data.pricing.initialCleanFee.toFixed(2)} (one-time)`);
  }

  if (data.acceptUrl) {
    lines.push(``, `View & accept: ${data.acceptUrl}`);
  }

  lines.push(``, `Reply with any questions!`);

  return lines.join("\n");
}
