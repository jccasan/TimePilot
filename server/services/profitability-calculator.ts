import { storage } from "../storage";
import {
  calculatePrice,
  yardSizeLabelToAcres,
  sqftToAcres,
  type PriceCalculatorInputs,
  type PriceCalculatorResult,
} from "./pricing-calculator";
import type {
  PricingConfig,
  InsertProfitabilitySnapshot,
} from "@shared/schema";

export type ProfitabilityStatus = "profitable" | "marginal" | "unprofitable";

export interface CustomerPropertyProfitability {
  propertyId: string;
  propertyAddress: string;
  servicePlanId: string;
  frequency: string;
  dogCount: number;
  yardSizeAcres: number;
  yardDifficulty: string;
  revenuePerVisitCents: number;
  costPerVisitCents: number;
  profitPerVisitCents: number;
  profitMarginPct: number;
  profitPerHourCents: number;
  recommendedPriceCents: number;
  costBreakdown: {
    laborCostCents: number;
    travelCostCents: number;
    equipmentCostCents: number;
    overheadCostCents: number;
  };
  calculatorResult: PriceCalculatorResult;
}

export interface CustomerProfitability {
  contactId: string;
  contactName: string;
  propertyCount: number;
  totalRevenuePerVisitCents: number;
  totalCostPerVisitCents: number;
  totalProfitPerVisitCents: number;
  profitMarginPct: number;
  status: ProfitabilityStatus;
  properties: CustomerPropertyProfitability[];
  monthlyRevenueCents: number;
  monthlyCostCents: number;
  monthlyProfitCents: number;
}

export interface ProfitabilityConfig {
  distanceFromNearestStopMiles?: number;
  routeStopsPerMile?: number;
}

const DEFAULT_PROFITABILITY_CONFIG: ProfitabilityConfig = {
  distanceFromNearestStopMiles: 1.0,
  routeStopsPerMile: undefined,
};

function getFrequencyVisitsPerMonth(frequency: string): number {
  switch (frequency) {
    case "weekly": return 4.33;
    case "biweekly": return 2.17;
    case "monthly": return 1;
    case "onetime": return 1;
    default: return 4.33;
  }
}

function determineProfitabilityStatus(marginPct: number): ProfitabilityStatus {
  if (marginPct < 0) return "unprofitable";
  if (marginPct <= 15) return "marginal";
  return "profitable";
}

export async function calculateCustomerProfitability(
  companyId: string,
  contactId: string,
  config?: ProfitabilityConfig
): Promise<CustomerProfitability | null> {
  const effectiveConfig = { ...DEFAULT_PROFITABILITY_CONFIG, ...config };

  const company = await storage.getCompany(companyId);
  if (!company) return null;

  const contacts = await storage.getContacts(companyId, {});
  const contact = contacts.find(c => c.id === contactId);
  if (!contact) return null;

  const allPlans = await storage.getServicePlans(companyId, { contactId, isActive: true });
  const plans = allPlans.filter(p => !p.isStopOnly);
  if (plans.length === 0) return null;

  const properties = await storage.getProperties(companyId, contactId);
  const propertyMap = new Map(properties.map(p => [p.id, p]));

  const pricingConfig = company.pricingConfig as Partial<PricingConfig> | null;

  const overheadTotal = await storage.getTotalMonthlyOverheadCents(companyId);
  const overrideOverhead = overheadTotal > 0 ? overheadTotal : undefined;

  const propertyResults: CustomerPropertyProfitability[] = [];

  for (const plan of plans) {
    const property = propertyMap.get(plan.propertyId);
    if (!property) continue;

    let yardSizeAcres: number;
    if (property.measuredYardSqft) {
      yardSizeAcres = sqftToAcres(property.measuredYardSqft);
    } else {
      yardSizeAcres = yardSizeLabelToAcres(property.yardSize);
    }

    const dogCount = property.numberOfDogs ?? 1;

    const planAddOns = await storage.getServicePlanAddOns(plan.id);
    const addOnsCents = planAddOns.filter(a => a.isActive).reduce((s, a) => s + Math.round((parseFloat(a.price) || 0) * 100), 0);
    const totalPerVisitCents = Math.round(parseFloat(plan.pricePerVisit) * 100) + addOnsCents;

    const inputs: PriceCalculatorInputs = {
      yardSizeAcres,
      dogCount,
      serviceFrequency: plan.frequency as "weekly" | "biweekly" | "monthly" | "onetime",
      yardDifficulty: (property.yardDifficulty ?? "flat") as "flat" | "moderate" | "difficult",
      distanceFromNearestStopMiles: effectiveConfig.distanceFromNearestStopMiles ?? 1.0,
      routeStopsPerMile: effectiveConfig.routeStopsPerMile,
      currentPriceCents: totalPerVisitCents,
    };

    const result = calculatePrice(inputs, pricingConfig, overrideOverhead);

    const revenuePerVisitCents = totalPerVisitCents;
    const costPerVisitCents = result.minimumPriceCents;
    const profitPerVisitCents = revenuePerVisitCents - costPerVisitCents;
    const profitMarginPct = revenuePerVisitCents > 0
      ? (profitPerVisitCents / revenuePerVisitCents) * 100
      : 0;
    const jobMinutes = result.derived.jobMinutes;
    const profitPerHourCents = jobMinutes > 0
      ? (profitPerVisitCents / jobMinutes) * 60
      : 0;

    propertyResults.push({
      propertyId: property.id,
      propertyAddress: [property.streetAddress, property.city, property.state, property.zipCode].filter(Boolean).join(", "),
      servicePlanId: plan.id,
      frequency: plan.frequency,
      dogCount,
      yardSizeAcres,
      yardDifficulty: property.yardDifficulty ?? "flat",
      revenuePerVisitCents,
      costPerVisitCents,
      profitPerVisitCents,
      profitMarginPct: Math.round(profitMarginPct * 100) / 100,
      profitPerHourCents: Math.round(profitPerHourCents),
      recommendedPriceCents: result.recommendedPriceCents,
      costBreakdown: {
        laborCostCents: result.breakdown.laborCostCents,
        travelCostCents: result.breakdown.adjustedTravelCostCents,
        equipmentCostCents: result.breakdown.equipmentCostCents,
        overheadCostCents: result.breakdown.overheadPerVisitCents,
      },
      calculatorResult: result,
    });
  }

  const totalRevenuePerVisitCents = propertyResults.reduce((sum, p) => sum + p.revenuePerVisitCents, 0);
  const totalCostPerVisitCents = propertyResults.reduce((sum, p) => sum + p.costPerVisitCents, 0);
  const totalProfitPerVisitCents = totalRevenuePerVisitCents - totalCostPerVisitCents;
  const overallMarginPct = totalRevenuePerVisitCents > 0
    ? (totalProfitPerVisitCents / totalRevenuePerVisitCents) * 100
    : 0;

  let monthlyRevenueCents = 0;
  let monthlyCostCents = 0;
  for (const p of propertyResults) {
    const plan = plans.find(pl => pl.id === p.servicePlanId);
    const visitsPerMonth = getFrequencyVisitsPerMonth(plan?.frequency ?? "weekly");
    monthlyRevenueCents += Math.round(p.revenuePerVisitCents * visitsPerMonth);
    monthlyCostCents += Math.round(p.costPerVisitCents * visitsPerMonth);
  }
  const monthlyProfitCents = monthlyRevenueCents - monthlyCostCents;

  return {
    contactId,
    contactName: `${contact.firstName} ${contact.lastName}`,
    propertyCount: propertyResults.length,
    totalRevenuePerVisitCents,
    totalCostPerVisitCents,
    totalProfitPerVisitCents,
    profitMarginPct: Math.round(overallMarginPct * 100) / 100,
    status: determineProfitabilityStatus(overallMarginPct),
    properties: propertyResults,
    monthlyRevenueCents,
    monthlyCostCents,
    monthlyProfitCents,
  };
}

export async function calculateAllCustomerProfitability(
  companyId: string,
  config?: ProfitabilityConfig
): Promise<CustomerProfitability[]> {
  const effectiveConfig = { ...DEFAULT_PROFITABILITY_CONFIG, ...config };

  const [company, contacts, allPlans, allProperties] = await Promise.all([
    storage.getCompany(companyId),
    storage.getContacts(companyId, { status: "active" }),
    storage.getServicePlans(companyId, { isActive: true }),
    storage.getProperties(companyId),
  ]);
  if (!company || contacts.length === 0) return [];

  const pricingConfig = company.pricingConfig as Partial<PricingConfig> | null;
  const overheadTotal = await storage.getTotalMonthlyOverheadCents(companyId);
  const overrideOverhead = overheadTotal > 0 ? overheadTotal : undefined;

  const activePlans = allPlans.filter(p => !p.isStopOnly);
  const allAddOnsMap = await storage.getAllServicePlanAddOnsForCompany(activePlans.map(p => p.id));

  const plansByContact = new Map<string, typeof activePlans>();
  for (const plan of activePlans) {
    if (!plansByContact.has(plan.contactId)) plansByContact.set(plan.contactId, []);
    plansByContact.get(plan.contactId)!.push(plan);
  }
  const propertyMap = new Map(allProperties.map(p => [p.id, p]));

  const results: CustomerProfitability[] = [];
  for (const contact of contacts) {
    const plans = plansByContact.get(contact.id);
    if (!plans || plans.length === 0) continue;

    const propertyResults: CustomerPropertyProfitability[] = [];
    for (const plan of plans) {
      const property = propertyMap.get(plan.propertyId);
      if (!property) continue;

      let yardSizeAcres: number;
      if (property.measuredYardSqft) {
        yardSizeAcres = sqftToAcres(property.measuredYardSqft);
      } else {
        yardSizeAcres = yardSizeLabelToAcres(property.yardSize);
      }
      const dogCount = property.numberOfDogs ?? 1;

      const planAddOns = allAddOnsMap.get(plan.id) || [];
      const addOnsCents = planAddOns.filter(a => a.isActive).reduce((s, a) => s + Math.round((parseFloat(a.price) || 0) * 100), 0);
      const totalPerVisitCents = Math.round(parseFloat(plan.pricePerVisit) * 100) + addOnsCents;

      const inputs: PriceCalculatorInputs = {
        yardSizeAcres,
        dogCount,
        serviceFrequency: plan.frequency as "weekly" | "biweekly" | "monthly" | "onetime",
        yardDifficulty: (property.yardDifficulty ?? "flat") as "flat" | "moderate" | "difficult",
        distanceFromNearestStopMiles: effectiveConfig.distanceFromNearestStopMiles ?? 1.0,
        routeStopsPerMile: effectiveConfig.routeStopsPerMile,
        currentPriceCents: totalPerVisitCents,
      };

      const result = calculatePrice(inputs, pricingConfig, overrideOverhead);
      const revenuePerVisitCents = totalPerVisitCents;
      const costPerVisitCents = result.minimumPriceCents;
      const profitPerVisitCents = revenuePerVisitCents - costPerVisitCents;
      const profitMarginPct = revenuePerVisitCents > 0 ? (profitPerVisitCents / revenuePerVisitCents) * 100 : 0;
      const jobMinutes = result.derived.jobMinutes;
      const profitPerHourCents = jobMinutes > 0 ? (profitPerVisitCents / jobMinutes) * 60 : 0;

      propertyResults.push({
        propertyId: property.id,
        propertyAddress: [property.streetAddress, property.city, property.state, property.zipCode].filter(Boolean).join(", "),
        servicePlanId: plan.id,
        frequency: plan.frequency,
        dogCount,
        yardSizeAcres,
        yardDifficulty: property.yardDifficulty ?? "flat",
        revenuePerVisitCents,
        costPerVisitCents,
        profitPerVisitCents,
        profitMarginPct: Math.round(profitMarginPct * 100) / 100,
        profitPerHourCents: Math.round(profitPerHourCents),
        recommendedPriceCents: result.recommendedPriceCents,
        costBreakdown: {
          laborCostCents: result.breakdown.laborCostCents,
          travelCostCents: result.breakdown.adjustedTravelCostCents,
          equipmentCostCents: result.breakdown.equipmentCostCents,
          overheadCostCents: result.breakdown.overheadPerVisitCents,
        },
        calculatorResult: result,
      });
    }

    if (propertyResults.length === 0) continue;

    const totalRevenuePerVisitCents = propertyResults.reduce((sum, p) => sum + p.revenuePerVisitCents, 0);
    const totalCostPerVisitCents = propertyResults.reduce((sum, p) => sum + p.costPerVisitCents, 0);
    const totalProfitPerVisitCents = totalRevenuePerVisitCents - totalCostPerVisitCents;
    const overallMarginPct = totalRevenuePerVisitCents > 0 ? (totalProfitPerVisitCents / totalRevenuePerVisitCents) * 100 : 0;

    let monthlyRevenueCents = 0;
    let monthlyCostCents = 0;
    for (const p of propertyResults) {
      const plan = plans.find(pl => pl.id === p.servicePlanId);
      const visitsPerMonth = getFrequencyVisitsPerMonth(plan?.frequency ?? "weekly");
      monthlyRevenueCents += Math.round(p.revenuePerVisitCents * visitsPerMonth);
      monthlyCostCents += Math.round(p.costPerVisitCents * visitsPerMonth);
    }

    results.push({
      contactId: contact.id,
      contactName: `${contact.firstName} ${contact.lastName}`,
      propertyCount: propertyResults.length,
      totalRevenuePerVisitCents,
      totalCostPerVisitCents,
      totalProfitPerVisitCents,
      profitMarginPct: Math.round(overallMarginPct * 100) / 100,
      status: determineProfitabilityStatus(overallMarginPct),
      properties: propertyResults,
      monthlyRevenueCents,
      monthlyCostCents,
      monthlyProfitCents: monthlyRevenueCents - monthlyCostCents,
    });
  }

  return results;
}

export async function generateProfitabilitySnapshots(
  companyId: string,
  config?: ProfitabilityConfig
): Promise<number> {
  const allProfitability = await calculateAllCustomerProfitability(companyId, config);
  const snapshotDate = new Date().toISOString().split("T")[0];
  let count = 0;

  for (const customer of allProfitability) {
    for (const prop of customer.properties) {
      const plan = customer.properties.find(p => p.servicePlanId === prop.servicePlanId);
      const visitsPerMonth = getFrequencyVisitsPerMonth(prop.frequency);

      const snapshot: InsertProfitabilitySnapshot = {
        companyId,
        contactId: customer.contactId,
        propertyId: prop.propertyId,
        snapshotDate,
        revenueCents: Math.round(prop.revenuePerVisitCents * visitsPerMonth),
        totalCostCents: Math.round(prop.costPerVisitCents * visitsPerMonth),
        profitCents: Math.round(prop.profitPerVisitCents * visitsPerMonth),
        profitMarginPct: String(prop.profitMarginPct),
        visitCount: Math.round(visitsPerMonth),
        avgRevenuePerVisitCents: prop.revenuePerVisitCents,
        avgCostPerVisitCents: prop.costPerVisitCents,
        status: determineProfitabilityStatus(prop.profitMarginPct),
        breakdownJson: {
          laborCostCents: prop.costBreakdown.laborCostCents,
          travelCostCents: prop.costBreakdown.travelCostCents,
          equipmentCostCents: prop.costBreakdown.equipmentCostCents,
          overheadCostCents: prop.costBreakdown.overheadCostCents,
          recommendedPriceCents: prop.recommendedPriceCents,
          yardSizeAcres: prop.yardSizeAcres,
          dogCount: prop.dogCount,
          frequency: prop.frequency,
        } as Record<string, any>,
      };

      await storage.createProfitabilitySnapshot(snapshot);
      count++;
    }
  }

  return count;
}

export function generateBulkRecommendations(
  customerProfitabilities: CustomerProfitability[]
): Array<{
  contactId: string;
  contactName: string;
  propertyId: string;
  propertyAddress: string;
  currentPriceCents: number;
  recommendedPriceCents: number;
  currentMarginPct: number;
  projectedMarginPct: number;
  projectedProfitPerVisitCents: number;
}> {
  const recommendations: Array<{
    contactId: string;
    contactName: string;
    propertyId: string;
    propertyAddress: string;
    currentPriceCents: number;
    recommendedPriceCents: number;
    currentMarginPct: number;
    projectedMarginPct: number;
    projectedProfitPerVisitCents: number;
  }> = [];

  for (const customer of customerProfitabilities) {
    for (const prop of customer.properties) {
      if (prop.profitMarginPct < 15) {
        const projectedProfit = prop.recommendedPriceCents - prop.costPerVisitCents;
        const projectedMargin = prop.recommendedPriceCents > 0
          ? (projectedProfit / prop.recommendedPriceCents) * 100
          : 0;

        recommendations.push({
          contactId: customer.contactId,
          contactName: customer.contactName,
          propertyId: prop.propertyId,
          propertyAddress: prop.propertyAddress,
          currentPriceCents: prop.revenuePerVisitCents,
          recommendedPriceCents: prop.recommendedPriceCents,
          currentMarginPct: prop.profitMarginPct,
          projectedMarginPct: Math.round(projectedMargin * 100) / 100,
          projectedProfitPerVisitCents: projectedProfit,
        });
      }
    }
  }

  return recommendations;
}
