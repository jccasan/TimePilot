import { storage } from "../storage";
import { db } from "../db";
import { calculateCustomerProfitability } from "./profitability-calculator";
import {
  calculatePrice,
  getEffectivePricingConfig,
  sqftToAcres,
  yardSizeLabelToAcres,
  parseLotSizeStringToAcres,
  type PriceCalculatorInputs,
} from "./pricing-calculator";
import type { PricingConfig } from "@shared/schema";
import { properties, servicePlans as servicePlansTable, routes } from "@shared/schema";
import { eq, and, isNotNull, ne } from "drizzle-orm";
import { sql } from "drizzle-orm";

export interface SuggestionActionData {
  servicePlanId?: string;
  propertyId?: string;
  targetDayOfWeek?: string;
  recommendedPriceCents?: number;
  targetFrequency?: string;
  measuredYardSqft?: number;
  currentYardSize?: string;
}

export interface ProfitabilitySuggestion {
  type:
    | "route_day_move"
    | "yard_size_mismatch"
    | "price_increase"
    | "frequency_upgrade"
    | "add_nearby_customers"
    | "no_path_to_profitability";
  title: string;
  explanation: string;
  impactCents: number;
  actionData?: SuggestionActionData;
}

function haversineDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function frequencyLabel(freq: string): string {
  switch (freq) {
    case "weekly": return "weekly";
    case "biweekly": return "every other week";
    case "monthly": return "monthly";
    default: return freq;
  }
}

function nextFrequency(freq: string): string | null {
  if (freq === "monthly") return "biweekly";
  if (freq === "biweekly") return "weekly";
  return null;
}

function centsToDisplay(cents: number): string {
  return `$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export async function generateProfitabilitySuggestions(
  companyId: string,
  contactId: string
): Promise<ProfitabilitySuggestion[]> {
  const profitability = await calculateCustomerProfitability(companyId, contactId);
  if (!profitability) throw new Error("No profitability data for this customer");

  const company = await storage.getCompany(companyId);
  if (!company) throw new Error("Company not found");

  const pricingConfig = company.pricingConfig as Partial<PricingConfig> | null;
  const fullConfig = getEffectivePricingConfig(pricingConfig);
  const overheadTotal = await storage.getTotalMonthlyOverheadCents(companyId);
  const overrideOverhead = overheadTotal > 0 ? overheadTotal : undefined;

  const contacts = await storage.getContacts(companyId, {});
  const contact = contacts.find((c) => c.id === contactId);
  if (!contact) throw new Error("Contact not found");

  const costOverrides = contact.costOverrides;

  const contactProps = await storage.getProperties(companyId, contactId);

  const allPlans = await storage.getServicePlans(companyId, { contactId, isActive: true });
  const targetPlans = allPlans.filter((p) => !p.isStopOnly);
  if (targetPlans.length === 0) throw new Error("No active service plans for this customer");

  const targetPlan = targetPlans[0];
  const targetProperty = contactProps.find((p) => p.id === targetPlan.propertyId);
  if (!targetProperty) throw new Error("Property not found");

  const targetPropRow = profitability.properties[0];
  if (!targetPropRow) throw new Error("No profitability property data");

  const currentMarginPct = targetPropRow.profitMarginPct;
  const currentPriceCents = targetPropRow.revenuePerVisitCents;
  const currentCostCents = targetPropRow.costPerVisitCents;
  const costBreakdown = targetPropRow.costBreakdown;
  const currentDistanceMiles =
    costOverrides?.distanceFromNearestStopMiles ?? 1.0;

  const currentFrequency = targetPlan.frequency as "weekly" | "biweekly" | "monthly" | "onetime";
  const dogCount = targetProperty.numberOfDogs ?? 1;
  const yardDifficulty = (targetProperty.yardDifficulty ?? "flat") as "flat" | "moderate" | "difficult";

  let yardSizeAcres: number;
  if (targetProperty.measuredYardSqft) {
    yardSizeAcres = sqftToAcres(targetProperty.measuredYardSqft);
  } else {
    const parsed = parseLotSizeStringToAcres((targetProperty as any).lotSize);
    yardSizeAcres = parsed !== null ? parsed : yardSizeLabelToAcres(targetProperty.yardSize);
  }

  const baseInputs: PriceCalculatorInputs = {
    yardSizeAcres,
    dogCount,
    serviceFrequency: currentFrequency,
    yardDifficulty,
    distanceFromNearestStopMiles: currentDistanceMiles,
    currentPriceCents,
  };

  const opportunities: Record<string, any> = {};

  // ─── Opportunity 1: Yard size mismatch ───────────────────────────────────
  if (targetProperty.measuredYardSqft) {
    const measuredAcres = sqftToAcres(targetProperty.measuredYardSqft);
    const labelAcres = yardSizeLabelToAcres(targetProperty.yardSize);
    const mismatchPct = labelAcres > 0 ? ((measuredAcres - labelAcres) / labelAcres) * 100 : 0;
    if (Math.abs(mismatchPct) >= 20) {
      const correctedInputs: PriceCalculatorInputs = {
        ...baseInputs,
        yardSizeAcres: measuredAcres,
      };
      const correctedResult = calculatePrice(correctedInputs, pricingConfig, overrideOverhead, costOverrides?.overheadAllocationCents);
      const correctedCostCents = correctedResult.minimumPriceCents;
      const correctedProfitCents = currentPriceCents - correctedCostCents;
      const correctedMarginPct = currentPriceCents > 0 ? (correctedProfitCents / currentPriceCents) * 100 : 0;
      const impactCents = correctedCostCents - currentCostCents;
      opportunities.yardSizeMismatch = {
        mismatchPct: Math.round(mismatchPct),
        measuredSqft: targetProperty.measuredYardSqft,
        measuredAcres: Math.round(measuredAcres * 10000) / 10000,
        labelUsedAcres: Math.round(labelAcres * 10000) / 10000,
        labelUsed: targetProperty.yardSize ?? "unknown",
        correctedCostCents,
        correctedMarginPct: Math.round(correctedMarginPct * 10) / 10,
        extraCostCents: Math.abs(impactCents),
        direction: mismatchPct > 0 ? "larger" : "smaller",
      };
    }
  }

  // ─── Opportunity 2: Route day move ───────────────────────────────────────
  const targetLat = targetProperty.latitude ? parseFloat(targetProperty.latitude) : null;
  const targetLon = targetProperty.longitude ? parseFloat(targetProperty.longitude) : null;

  if (targetLat !== null && targetLon !== null) {
    const companyRoutes = await db
      .select({
        routeId: routes.id,
        dayOfWeek: routes.dayOfWeek,
      })
      .from(routes)
      .where(and(eq(routes.companyId, companyId), isNotNull(routes.dayOfWeek)));

    const allCompanyProps = await db
      .select({
        latitude: properties.latitude,
        longitude: properties.longitude,
        routeId: servicePlansTable.routeId,
        propertyId: properties.id,
      })
      .from(properties)
      .innerJoin(servicePlansTable, eq(servicePlansTable.propertyId, properties.id))
      .where(
        and(
          eq(properties.companyId, companyId),
          isNotNull(properties.latitude),
          isNotNull(properties.longitude),
          eq(servicePlansTable.isActive, true),
          ne(properties.contactId, contactId),
          isNotNull(servicePlansTable.routeId)
        )
      );

    const routeDayMap = new Map<string, string>(companyRoutes.map((r) => [r.routeId, r.dayOfWeek ?? ""]));
    const byDay: Record<string, { count: number; minDist: number }> = {};

    for (const prop of allCompanyProps) {
      if (!prop.latitude || !prop.longitude || !prop.routeId) continue;
      const day = routeDayMap.get(prop.routeId);
      if (!day || day === "tbd") continue;
      const lat = parseFloat(prop.latitude);
      const lon = parseFloat(prop.longitude);
      const dist = haversineDistanceMiles(targetLat, targetLon, lat, lon);
      if (!byDay[day]) byDay[day] = { count: 0, minDist: Infinity };
      byDay[day].count++;
      if (dist < byDay[day].minDist) byDay[day].minDist = dist;
    }

    const bestDay = Object.entries(byDay)
      .filter(([, v]) => v.minDist < currentDistanceMiles - 0.1)
      .sort((a, b) => a[1].minDist - b[1].minDist)[0];

    if (bestDay) {
      const [day, { count, minDist }] = bestDay;
      const improvedInputs: PriceCalculatorInputs = { ...baseInputs, distanceFromNearestStopMiles: minDist };
      const improvedResult = calculatePrice(improvedInputs, pricingConfig, overrideOverhead, costOverrides?.overheadAllocationCents);
      const improvedCostCents = improvedResult.minimumPriceCents;
      const improvedProfitCents = currentPriceCents - improvedCostCents;
      const improvedMarginPct = currentPriceCents > 0 ? (improvedProfitCents / currentPriceCents) * 100 : 0;
      const savingsPerVisitCents = currentCostCents - improvedCostCents;

      if (savingsPerVisitCents > 50) {
        opportunities.routeDayMove = {
          bestDay: day,
          currentDistanceMiles: Math.round(currentDistanceMiles * 100) / 100,
          newDistanceMiles: Math.round(minDist * 100) / 100,
          nearbyCustomersOnThatDay: count,
          savingsPerVisitCents: Math.round(savingsPerVisitCents),
          improvedMarginPct: Math.round(improvedMarginPct * 10) / 10,
          currentTravelCostCents: costBreakdown.travelCostCents,
          newTravelCostCents: improvedResult.breakdown.adjustedTravelCostCents,
        };
      }
    }
  }

  // ─── Opportunity 3: Price increase ───────────────────────────────────────
  const recommendedPriceCents = targetPropRow.recommendedPriceCents;
  const increaseAmountCents = recommendedPriceCents - currentPriceCents;
  const increasePercent = currentPriceCents > 0 ? (increaseAmountCents / currentPriceCents) * 100 : 0;

  if (increaseAmountCents > 0 && increasePercent <= 40) {
    const projectedProfitCents = recommendedPriceCents - currentCostCents;
    const projectedMarginPct = recommendedPriceCents > 0 ? (projectedProfitCents / recommendedPriceCents) * 100 : 0;
    opportunities.priceIncrease = {
      currentPriceCents,
      recommendedPriceCents,
      increaseAmountCents: Math.round(increaseAmountCents),
      increasePercent: Math.round(increasePercent * 10) / 10,
      projectedMarginPct: Math.round(projectedMarginPct * 10) / 10,
    };
  }

  // ─── Opportunity 4: Frequency upgrade ────────────────────────────────────
  const upgradeFreq = nextFrequency(currentFrequency);
  if (upgradeFreq) {
    const upgradeInputs: PriceCalculatorInputs = {
      ...baseInputs,
      serviceFrequency: upgradeFreq as "weekly" | "biweekly" | "monthly",
    };
    const upgradeResult = calculatePrice(upgradeInputs, pricingConfig, overrideOverhead, costOverrides?.overheadAllocationCents);
    const upgradeCostCents = upgradeResult.minimumPriceCents;
    const upgradeRecommendedCents = upgradeResult.recommendedPriceCents;
    const upgradeIncreasePct = currentPriceCents > 0 ? ((upgradeRecommendedCents - currentPriceCents) / currentPriceCents) * 100 : 0;

    const upgradeProfitCents = upgradeRecommendedCents - upgradeCostCents;
    const upgradeMarginPct = upgradeRecommendedCents > 0 ? (upgradeProfitCents / upgradeRecommendedCents) * 100 : 0;

    if (upgradeMarginPct > currentMarginPct + 5 && upgradeIncreasePct <= 50) {
      opportunities.frequencyUpgrade = {
        currentFrequency,
        upgradeFrequency: upgradeFreq,
        currentPriceCents,
        recommendedNewPriceCents: upgradeRecommendedCents,
        newCostPerVisitCents: upgradeCostCents,
        newMarginPct: Math.round(upgradeMarginPct * 10) / 10,
        priceIncreasePct: Math.round(upgradeIncreasePct * 10) / 10,
        costReductionCents: currentCostCents - upgradeCostCents,
      };
    }
  }

  // ─── Opportunity 5: Add nearby customers ─────────────────────────────────
  if (targetLat !== null && targetLon !== null && currentMarginPct < 15) {
    const breakEvenMarginalInputs: PriceCalculatorInputs = { ...baseInputs, distanceFromNearestStopMiles: 0.25 };
    const breakEvenResult = calculatePrice(breakEvenMarginalInputs, pricingConfig, overrideOverhead, costOverrides?.overheadAllocationCents);
    const breakEvenCostCents = breakEvenResult.minimumPriceCents;
    const breakEvenMargin = currentPriceCents > 0 ? ((currentPriceCents - breakEvenCostCents) / currentPriceCents) * 100 : 0;

    const withinHalfMile = !opportunities.routeDayMove ? await db
      .select({ count: sql<number>`count(*)` })
      .from(properties)
      .innerJoin(servicePlansTable, eq(servicePlansTable.propertyId, properties.id))
      .where(
        and(
          eq(properties.companyId, companyId),
          isNotNull(properties.latitude),
          isNotNull(properties.longitude),
          eq(servicePlansTable.isActive, true),
          ne(properties.contactId, contactId)
        )
      )
      .then(async (rows) => {
        const allNearby = await db
          .select({ latitude: properties.latitude, longitude: properties.longitude })
          .from(properties)
          .innerJoin(servicePlansTable, eq(servicePlansTable.propertyId, properties.id))
          .where(
            and(
              eq(properties.companyId, companyId),
              isNotNull(properties.latitude),
              isNotNull(properties.longitude),
              eq(servicePlansTable.isActive, true),
              ne(properties.contactId, contactId)
            )
          );
        return allNearby.filter((p) => {
          if (!p.latitude || !p.longitude) return false;
          return haversineDistanceMiles(targetLat, targetLon, parseFloat(p.latitude), parseFloat(p.longitude)) <= 0.5;
        }).length;
      }) : 0;

    if (breakEvenMargin >= 15) {
      opportunities.addNearbyCustomers = {
        currentDistanceMiles,
        breakEvenDistanceMiles: 0.25,
        withinHalfMileCurrentCustomers: withinHalfMile,
        breakEvenMarginAtHalfMile: Math.round(breakEvenMargin * 10) / 10,
      };
    }
  }

  if (Object.keys(opportunities).length === 0) {
    opportunities.noPath = {
      reason: "No routing, pricing, frequency, or density change modeled would bring this customer above a 15% margin without an unrealistic price increase.",
      currentMarginPct: Math.round(currentMarginPct * 10) / 10,
      costCents: currentCostCents,
      revenueCents: currentPriceCents,
      gapCents: currentCostCents - currentPriceCents,
    };
  }

  // ─── AI: write explanations for the pre-computed opportunities ───────────
  const factSheet = {
    customerName: profitability.contactName,
    propertyAddress: targetPropRow.propertyAddress,
    currentMarginPct: Math.round(currentMarginPct * 10) / 10,
    currentPriceCents,
    currentCostCents,
    currentDistanceMiles,
    dogCount,
    frequency: currentFrequency,
    frequencyLabel: frequencyLabel(currentFrequency),
    yardSizeAcres: Math.round(yardSizeAcres * 10000) / 10000,
    yardDifficulty,
    laborCostCents: costBreakdown.laborCostCents,
    travelCostCents: costBreakdown.travelCostCents,
    overheadCostCents: costBreakdown.overheadCostCents,
    targetMarginPct: fullConfig.targetProfitMarginPct,
    opportunities,
  };

  const systemPrompt = `You are a profitability advisor for a pet waste removal business. 
You will receive a fact sheet about a customer with pre-computed opportunities to improve their profitability.
Your job is to select the most impactful suggestions (max 5, min 1) and write a clear, specific 1-2 sentence explanation for each using ONLY the numbers in the fact sheet.
NEVER invent or estimate numbers not present in the fact sheet. Every dollar amount and percentage you mention must come directly from the data.

Return a JSON object: { "suggestions": [ { "type": "<type>", "title": "<short title>", "explanation": "<1-2 sentences>", "impactCents": <monthly impact in cents or 0> } ] }

Valid types: route_day_move, yard_size_mismatch, price_increase, frequency_upgrade, add_nearby_customers, no_path_to_profitability.

Rules:
- Only use a type if the corresponding key exists in opportunities.
- For route_day_move: mention current vs. new distance, savings per visit, projected margin.
- For yard_size_mismatch: mention measured vs. priced yard size and cost impact.
- For price_increase: mention current price, suggested price, and increase percent.
- For frequency_upgrade: mention the frequency change and projected margin.
- For add_nearby_customers: explain how adding customers within the specified distance would reduce travel cost.
- For no_path_to_profitability: explain honestly that no realistic operational change closes the gap, referencing cost vs. revenue.
- Skip suggestions where opportunities data is absent.
- impactCents is the estimated additional monthly profit in cents (0 if uncertain or not applicable).`;

  const OpenAI = (await import("openai")).default;
  const ai = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
  });

  const completion = await ai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 1200,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(factSheet, null, 2) },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Failed to parse AI response");
  }

  const suggestions: ProfitabilitySuggestion[] = [];
  const validTypes = new Set([
    "route_day_move",
    "yard_size_mismatch",
    "price_increase",
    "frequency_upgrade",
    "add_nearby_customers",
    "no_path_to_profitability",
  ]);

  const actionDataByType: Record<string, SuggestionActionData> = {};

  if (opportunities.routeDayMove) {
    actionDataByType.route_day_move = {
      servicePlanId: targetPlan.id,
      targetDayOfWeek: opportunities.routeDayMove.bestDay,
    };
  }
  if (opportunities.priceIncrease) {
    actionDataByType.price_increase = {
      servicePlanId: targetPlan.id,
      recommendedPriceCents: opportunities.priceIncrease.recommendedPriceCents,
    };
  }
  if (opportunities.yardSizeMismatch) {
    actionDataByType.yard_size_mismatch = {
      propertyId: targetProperty.id,
      measuredYardSqft: opportunities.yardSizeMismatch.measuredSqft,
      currentYardSize: targetProperty.yardSize ?? undefined,
    };
  }
  if (opportunities.frequencyUpgrade) {
    actionDataByType.frequency_upgrade = {
      servicePlanId: targetPlan.id,
      targetFrequency: opportunities.frequencyUpgrade.upgradeFrequency,
      recommendedPriceCents: opportunities.frequencyUpgrade.recommendedNewPriceCents,
    };
  }

  if (Array.isArray(parsed.suggestions)) {
    for (const s of parsed.suggestions.slice(0, 5)) {
      if (!s.type || !validTypes.has(s.type)) continue;
      if (!s.title || !s.explanation) continue;
      suggestions.push({
        type: s.type,
        title: String(s.title).slice(0, 100),
        explanation: String(s.explanation).slice(0, 500),
        impactCents: typeof s.impactCents === "number" ? Math.round(s.impactCents) : 0,
        actionData: actionDataByType[s.type],
      });
    }
  }

  if (suggestions.length === 0) {
    suggestions.push({
      type: "no_path_to_profitability",
      title: "Unable to generate suggestions",
      explanation: "Not enough data or no viable path found. Review yard size, route assignment, and pricing manually.",
      impactCents: 0,
    });
  }

  return suggestions;
}
