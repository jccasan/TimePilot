import { type QuoteDefaults, DEFAULT_QUOTE_DEFAULTS } from "@shared/schema";

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
  yardSize: "small" | "medium" | "large" | "estate";
  frequency: "weekly" | "biweekly" | "monthly" | "onetime";
  isFirstTime: boolean;
}

export interface CommercialQuoteInput {
  type: "commercial";
  stationCount: number;
  commonAreaMinutes: number;
  frequency: "1x_weekly" | "2x_weekly" | "3x_weekly" | "monthly";
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

function getAcreageSurcharge(yardSize: string, defaults: QuoteDefaults): number {
  switch (yardSize) {
    case "small": return 0;
    case "medium": return defaults.acreageMediumSurcharge;
    case "large": return defaults.acreageLargeSurcharge;
    case "estate": return defaults.acreageEstateSurcharge;
    default: return 0;
  }
}

function getYardSizeLabel(size: string): string {
  switch (size) {
    case "small": return "Small (< 0.25 acre)";
    case "medium": return "Medium (0.25–0.50 acre)";
    case "large": return "Large (0.51–1.0 acre)";
    case "estate": return "Estate (1.0+ acre)";
    default: return size;
  }
}

export function calculateResidentialPricing(
  input: ResidentialQuoteInput,
  config?: Partial<QuoteDefaults> | null
): TierPricing {
  const d = { ...DEFAULT_QUOTE_DEFAULTS, ...(config || {}) };

  let basePerVisit = d.residentialBaseRate;
  const additionalDogs = Math.max(input.dogCount - 1, 0);
  const dogSurcharge = additionalDogs * d.perDogSurcharge;
  basePerVisit += dogSurcharge;

  const acreageSurcharge = getAcreageSurcharge(input.yardSize, d);
  basePerVisit += acreageSurcharge;

  if (input.dogCount > 4) {
    basePerVisit = Math.round(basePerVisit * d.heavyAccumulationMultiplier * 100) / 100;
  }

  let initialCleanFee = 0;
  if (input.isFirstTime) {
    initialCleanFee = Math.min(
      Math.round(basePerVisit * d.initialCleanMultiplier * 100) / 100,
      d.initialCleanCap
    );
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
      "Everything in Essential, plus:",
      `Yard deodorizer treatment (+$${d.premiumDeodorizerPrice}/visit)`,
      `Gate & fence safety check (+$${d.premiumGateCheckPrice}/visit)`,
      "Service completion photo",
    ],
    deluxeFeatures: [
      "Everything in Property Care, plus:",
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
  const commonAreaHours = input.commonAreaMinutes / 60;
  const commonAreaCost = Math.round(commonAreaHours * d.commercialFieldRate * 100) / 100;
  let basePerVisit = stationCost + commonAreaCost;

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
    const firstVisitCost = basePerVisit;
    const additionalVisitCost = basePerVisit * (1 - discountPct);
    basePerVisit = Math.round(((firstVisitCost + additionalVisitCost * (visitsPerWeek - 1)) / visitsPerWeek) * 100) / 100;
  }

  const essential = Math.round(basePerVisit * 100) / 100;
  const premiumUpcharge = input.stationCount * d.commercialPremiumStationUpcharge;
  const premium = Math.round((basePerVisit + premiumUpcharge) * 100) / 100;
  const deluxeUpcharge = input.stationCount * d.commercialDeluxeStationUpcharge;
  const deluxe = Math.round((basePerVisit + deluxeUpcharge) * 100) / 100;

  const frequencyLabel = input.frequency === "1x_weekly" ? "Weekly" :
    input.frequency === "2x_weekly" ? "2x Weekly" :
    input.frequency === "3x_weekly" ? "3x Weekly" : "Monthly";

  const breakdown: Record<string, any> = {
    stationCount: input.stationCount,
    stationRate: d.commercialStationRate,
    stationCost,
    commonAreaMinutes: input.commonAreaMinutes,
    fieldRate: d.commercialFieldRate,
    commonAreaCost,
    frequency: input.frequency,
    frequencyLabel,
    visitsPerWeek,
    densityDiscount: discountPct > 0 ? `${(discountPct * 100).toFixed(0)}%` : null,
    weeklyTotal: Math.round(essential * visitsPerWeek * (visitsPerWeek >= 1 ? 1 : 4) * 100) / 100,
    monthlyEstimate: Math.round(essential * visitsPerWeek * 4.33 * 100) / 100,
  };

  return {
    essential,
    premium,
    deluxe,
    initialCleanFee: 0,
    essentialFeatures: [
      `${frequencyLabel} station maintenance`,
      `${input.stationCount} waste station${input.stationCount !== 1 ? "s" : ""}`,
      "Station emptying & bag refill",
      `Common area scooping (${input.commonAreaMinutes} min)`,
      "GPS-verified service logs",
      discountPct > 0 ? `${(discountPct * 100).toFixed(0)}% density discount applied` : "",
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
  config?: Partial<QuoteDefaults> | null
): TierPricing {
  if (input.type === "residential") {
    return calculateResidentialPricing(input, config);
  }
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
}): string {
  const { pricing } = data;
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
  const frequencyLabel = data.frequency === "weekly" ? "Weekly" :
    data.frequency === "biweekly" ? "Bi-weekly" :
    data.frequency === "monthly" ? "Monthly" : "One-time";

  function tierCard(name: string, price: number, features: string[], color: string, recommended?: boolean) {
    return `
      <div style="flex: 1; min-width: 200px; border: 2px solid ${recommended ? color : '#e2e8f0'}; border-radius: 12px; overflow: hidden; ${recommended ? 'box-shadow: 0 4px 12px rgba(0,0,0,0.1);' : ''}">
        ${recommended ? `<div style="background-color: ${color}; color: white; text-align: center; padding: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Most Popular</div>` : ''}
        <div style="padding: 20px; text-align: center;">
          <h3 style="margin: 0 0 4px; font-size: 18px; color: #1e293b;">${escapeHtml(name)}</h3>
          <p style="margin: 0 0 12px; font-size: 32px; font-weight: 700; color: ${color};">$${price.toFixed(2)}<span style="font-size: 14px; font-weight: 400; color: #64748b;">/visit</span></p>
          <ul style="list-style: none; padding: 0; margin: 0; text-align: left;">
            ${features.map(f => `<li style="padding: 6px 0; font-size: 13px; color: #475569; border-bottom: 1px solid #f1f5f9;">✓ ${escapeHtml(f)}</li>`).join('')}
          </ul>
        </div>
      </div>`;
  }

  const initialCleanSection = pricing.initialCleanFee > 0 ? `
    <div style="background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px 16px; margin-top: 20px;">
      <p style="margin: 0; font-size: 14px; color: #92400e;">
        <strong>Initial Clean Fee:</strong> $${pricing.initialCleanFee.toFixed(2)} (one-time) — Covers first-visit deep clean for accumulated waste.
      </p>
    </div>` : '';

  return `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 700px; margin: 0 auto; background-color: #ffffff;">
      <div style="background-color: #1a7a4c; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        ${e.companyLogo ? `<img src="${e.companyLogo}" alt="${e.companyName}" style="max-height: 50px; margin-bottom: 8px;" />` : ''}
        <h1 style="color: white; margin: 0; font-size: 22px;">${e.companyName}</h1>
        <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0; font-size: 14px;">Service Quote #${e.quoteNumber}</p>
      </div>

      <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="margin: 0 0 4px; font-size: 14px; color: #64748b;">Prepared for</p>
        <p style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #1e293b;">${e.contactName}</p>
        ${e.propertyAddress ? `<p style="margin: 0 0 16px; font-size: 14px; color: #475569;">📍 ${e.propertyAddress}</p>` : ''}
        <p style="margin: 0 0 24px; font-size: 14px; color: #475569;">Service Frequency: <strong>${frequencyLabel}</strong></p>

        <h2 style="margin: 0 0 16px; font-size: 18px; color: #1e293b; text-align: center;">Choose Your Service Level</h2>

        <div style="display: flex; gap: 16px; flex-wrap: wrap;">
          ${tierCard('Essential', pricing.essential, pricing.essentialFeatures, '#64748b')}
          ${tierCard('Property Care', pricing.premium, pricing.premiumFeatures, '#1a7a4c', true)}
          ${tierCard('Deluxe', pricing.deluxe, pricing.deluxeFeatures, '#7c3aed')}
        </div>

        ${initialCleanSection}

        ${e.notes ? `<div style="margin-top: 20px; padding: 12px 16px; background-color: #f8fafc; border-radius: 8px;"><p style="margin: 0; font-size: 13px; color: #475569;">${e.notes}</p></div>` : ''}

        ${e.acceptUrl ? `
          <div style="text-align: center; margin: 28px 0 20px;">
            <a href="${e.acceptUrl}" style="display: inline-block; background-color: #1a7a4c; color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 6px; font-size: 16px; font-weight: 600;">View & Accept Quote</a>
          </div>` : ''}

        ${e.expiresAt ? `<p style="text-align: center; font-size: 12px; color: #94a3b8;">This quote expires on ${new Date(e.expiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>` : ''}
      </div>

      <div style="padding: 16px; text-align: center; font-size: 11px; color: #94a3b8;">
        ${e.companyName}${e.companyPhone ? ` • ${e.companyPhone}` : ''}${e.companyEmail ? ` • ${e.companyEmail}` : ''}
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

  function tierRow(name: string, price: number, features: string[]) {
    return `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #1e293b;">${escapeHtml(name)}</td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; text-align: right; font-size: 18px; font-weight: 700; color: #1a7a4c;">$${price.toFixed(2)}/visit</td>
      </tr>
      <tr>
        <td colspan="2" style="padding: 8px 16px 16px; border-bottom: 2px solid #e2e8f0;">
          <ul style="margin: 0; padding: 0 0 0 16px; font-size: 13px; color: #475569;">
            ${features.map(f => `<li style="padding: 3px 0;">${escapeHtml(f)}</li>`).join('')}
          </ul>
        </td>
      </tr>`;
  }

  return `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 750px; margin: 0 auto; background-color: #ffffff;">
      <div style="background-color: #0f172a; padding: 32px; text-align: center; border-radius: 8px 8px 0 0;">
        ${e.companyLogo ? `<img src="${e.companyLogo}" alt="${e.companyName}" style="max-height: 50px; margin-bottom: 12px;" />` : ''}
        <h1 style="color: white; margin: 0; font-size: 24px; letter-spacing: 0.5px;">${e.companyName}</h1>
        <p style="color: rgba(255,255,255,0.7); margin: 8px 0 0; font-size: 16px;">Environmental Maintenance Proposal</p>
        <p style="color: rgba(255,255,255,0.5); margin: 4px 0 0; font-size: 13px;">Quote #${e.quoteNumber}</p>
      </div>

      <div style="padding: 32px; border: 1px solid #e2e8f0; border-top: none;">
        <h2 style="margin: 0 0 12px; font-size: 18px; color: #0f172a; border-bottom: 2px solid #1a7a4c; padding-bottom: 8px;">Executive Summary</h2>
        <p style="margin: 0 0 8px; font-size: 14px; color: #475569;">Prepared for: <strong>${e.contactName}</strong></p>
        ${e.propertyAddress ? `<p style="margin: 0 0 8px; font-size: 14px; color: #475569;">Property: <strong>${e.propertyAddress}</strong></p>` : ''}
        <p style="margin: 0 0 20px; font-size: 14px; color: #475569;">
          This proposal outlines a comprehensive pet waste management solution for your property,
          including maintenance of ${breakdown.stationCount || 0} waste station${(breakdown.stationCount || 0) !== 1 ? 's' : ''}
          and ${breakdown.commonAreaMinutes || 0} minutes of common area servicing per visit.
        </p>

        <h2 style="margin: 24px 0 12px; font-size: 18px; color: #0f172a; border-bottom: 2px solid #1a7a4c; padding-bottom: 8px;">Scope of Work</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 14px;">
          <tr style="background-color: #f8fafc;">
            <td style="padding: 8px 12px; font-weight: 600;">Service Frequency</td>
            <td style="padding: 8px 12px;">${breakdown.frequencyLabel || data.frequency}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; font-weight: 600;">Waste Stations</td>
            <td style="padding: 8px 12px;">${breakdown.stationCount || 0} stations @ $${(breakdown.stationRate || 0).toFixed(2)}/station/visit</td>
          </tr>
          <tr style="background-color: #f8fafc;">
            <td style="padding: 8px 12px; font-weight: 600;">Common Area Service</td>
            <td style="padding: 8px 12px;">${breakdown.commonAreaMinutes || 0} minutes @ $${(breakdown.fieldRate || 0).toFixed(2)}/hr</td>
          </tr>
          ${breakdown.densityDiscount ? `<tr>
            <td style="padding: 8px 12px; font-weight: 600;">Multi-Visit Discount</td>
            <td style="padding: 8px 12px; color: #1a7a4c; font-weight: 600;">${breakdown.densityDiscount} off additional visits</td>
          </tr>` : ''}
          <tr style="background-color: #f1f5f9;">
            <td style="padding: 8px 12px; font-weight: 600;">Est. Monthly Investment</td>
            <td style="padding: 8px 12px; font-weight: 700; color: #1a7a4c;">$${(breakdown.monthlyEstimate || 0).toFixed(2)}</td>
          </tr>
        </table>

        <h2 style="margin: 24px 0 12px; font-size: 18px; color: #0f172a; border-bottom: 2px solid #1a7a4c; padding-bottom: 8px;">Service Tiers</h2>
        <table style="width: 100%; border-collapse: collapse;">
          ${tierRow('Essential', pricing.essential, pricing.essentialFeatures)}
          ${tierRow('Property Care', pricing.premium, pricing.premiumFeatures)}
          ${tierRow('Deluxe', pricing.deluxe, pricing.deluxeFeatures)}
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

        ${e.notes ? `<div style="margin-top: 20px; padding: 12px 16px; background-color: #f8fafc; border-radius: 8px;"><p style="margin: 0; font-size: 13px; color: #475569;">${e.notes}</p></div>` : ''}

        ${e.acceptUrl ? `
          <div style="text-align: center; margin: 28px 0 20px;">
            <a href="${e.acceptUrl}" style="display: inline-block; background-color: #0f172a; color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 6px; font-size: 16px; font-weight: 600;">Review & Accept Proposal</a>
          </div>` : ''}

        ${e.expiresAt ? `<p style="text-align: center; font-size: 12px; color: #94a3b8;">This proposal is valid until ${new Date(e.expiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>` : ''}
      </div>

      <div style="padding: 16px; text-align: center; font-size: 11px; color: #94a3b8;">
        ${e.companyName}${e.companyPhone ? ` • ${e.companyPhone}` : ''}${e.companyEmail ? ` • ${e.companyEmail}` : ''}
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
}): string {
  const lines: string[] = [
    `Hi ${data.contactName},`,
    ``,
    `${data.companyName} has prepared a ${data.type === "commercial" ? "site management proposal" : "service quote"} for you (Quote #${data.quoteNumber}):`,
    ``,
    `Essential: $${data.pricing.essential.toFixed(2)}/visit`,
    `Property Care: $${data.pricing.premium.toFixed(2)}/visit`,
    `Deluxe: $${data.pricing.deluxe.toFixed(2)}/visit`,
  ];

  if (data.pricing.initialCleanFee > 0) {
    lines.push(`Initial Clean: $${data.pricing.initialCleanFee.toFixed(2)} (one-time)`);
  }

  if (data.acceptUrl) {
    lines.push(``, `View & accept: ${data.acceptUrl}`);
  }

  lines.push(``, `Reply with any questions!`);

  return lines.join('\n');
}
