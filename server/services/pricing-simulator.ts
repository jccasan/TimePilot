import { storage } from "../storage";
import {
  calculatePrice,
  getEffectivePricingConfig,
  type PriceCalculatorInputs,
} from "./pricing-calculator";
import {
  calculateAllCustomerProfitability,
} from "./profitability-calculator";
import type { PricingConfig } from "@shared/schema";

export interface SimulationParams {
  targetMarginPct: number;
  overheadAdjustmentPct: number;
  laborRateAdjustmentPct: number;
  travelCostFactor: number;
}

export interface SimulatedProperty {
  propertyId: string;
  propertyAddress: string;
  contactId: string;
  contactName: string;
  zipCode: string;
  frequency: string;
  dogCount: number;
  yardSizeAcres: number;
  currentPriceCents: number;
  simulatedPriceCents: number;
  changeCents: number;
  changePct: number;
  currentMarginPct: number;
  projectedMarginPct: number;
  currentCostPerVisitCents: number;
  simulatedCostPerVisitCents: number;
}

export interface SimulationResult {
  properties: SimulatedProperty[];
  summary: {
    totalCurrentMonthlyRevenueCents: number;
    totalSimulatedMonthlyRevenueCents: number;
    monthlyRevenueDeltaCents: number;
    averageCurrentMarginPct: number;
    averageSimulatedMarginPct: number;
    propertiesNeedingIncrease: number;
    propertiesNeedingDecrease: number;
    propertiesUnchanged: number;
  };
  params: SimulationParams;
}

export interface ElasticityPoint {
  priceChangePct: number;
  estimatedChurnPct: number;
  retainedCustomers: number;
  totalCustomers: number;
  currentMonthlyRevenueCents: number;
  adjustedMonthlyRevenueCents: number;
  netRevenueDeltaCents: number;
  avgNewPriceCents: number;
}

export interface ElasticityResult {
  propertyId: string | null;
  propertyLabel: string;
  points: ElasticityPoint[];
  sweetSpotIndex: number;
}

export interface CompetitorAnalysisEntry {
  zipCode: string;
  yourAvgPriceCents: number;
  yourPropertyCount: number;
  marketAvgPriceCents: number;
  competitorCount: number;
  competitors: Array<{
    name: string;
    priceCents: number;
    frequency: string;
    dogCountRange: string;
    yardSizeCategory: string;
  }>;
  positionPct: number;
  position: "below_market" | "at_market" | "above_market";
}

export interface CompetitorAnalysisResult {
  zipCodes: CompetitorAnalysisEntry[];
  overallPosition: "below_market" | "at_market" | "above_market";
  overallYourAvgCents: number;
  overallMarketAvgCents: number;
}

function getFrequencyVisitsPerMonth(frequency: string): number {
  switch (frequency) {
    case "weekly": return 4.33;
    case "biweekly": return 2.17;
    case "monthly": return 1;
    case "onetime": return 1;
    default: return 4.33;
  }
}

function normalizeToWeekly(priceCents: number, frequency: string): number {
  switch (frequency) {
    case "weekly": return priceCents;
    case "biweekly": return Math.round(priceCents / 2);
    case "monthly": return Math.round(priceCents / 4.33);
    case "onetime": return priceCents;
    default: return priceCents;
  }
}

function estimateChurnPct(priceChangePct: number): number {
  if (priceChangePct <= 0) return 0;
  if (priceChangePct <= 5) return priceChangePct * 0.3;
  if (priceChangePct <= 10) return 1.5 + (priceChangePct - 5) * 0.8;
  if (priceChangePct <= 15) return 5.5 + (priceChangePct - 10) * 1.2;
  if (priceChangePct <= 20) return 11.5 + (priceChangePct - 15) * 1.8;
  return Math.min(50, 20.5 + (priceChangePct - 20) * 2.5);
}

export async function runPricingSimulation(
  companyId: string,
  params: SimulationParams
): Promise<SimulationResult> {
  const company = await storage.getCompany(companyId);
  if (!company) throw new Error("Company not found");

  const basePricingConfig = company.pricingConfig as Partial<PricingConfig> | null;
  const effectiveConfig = getEffectivePricingConfig(basePricingConfig);

  const adjustedConfig: Partial<PricingConfig> = {
    ...effectiveConfig,
    targetProfitMarginPct: params.targetMarginPct,
    techHourlyWageCents: Math.round(
      effectiveConfig.techHourlyWageCents * (1 + params.laborRateAdjustmentPct / 100)
    ),
    vehicleCostPerMileCents: Math.round(
      effectiveConfig.vehicleCostPerMileCents * params.travelCostFactor
    ),
  };

  const overheadTotal = await storage.getTotalMonthlyOverheadCents(companyId);
  const adjustedOverhead = overheadTotal > 0
    ? Math.round(overheadTotal * (1 + params.overheadAdjustmentPct / 100))
    : undefined;

  const allProfitability = await calculateAllCustomerProfitability(companyId);
  const allProperties = await storage.getProperties(companyId);
  const propertyMap = new Map(allProperties.map(p => [p.id, p]));

  const simulatedProperties: SimulatedProperty[] = [];

  for (const customer of allProfitability) {
    for (const prop of customer.properties) {
      const property = propertyMap.get(prop.propertyId);
      if (!property) continue;

      const simInputs: PriceCalculatorInputs = {
        yardSizeAcres: prop.yardSizeAcres,
        dogCount: prop.dogCount,
        serviceFrequency: prop.frequency as "weekly" | "biweekly" | "monthly" | "onetime",
        yardDifficulty: (prop.yardDifficulty ?? "flat") as "flat" | "moderate" | "difficult",
        distanceFromNearestStopMiles: 1.0,
        currentPriceCents: prop.revenuePerVisitCents,
      };

      const simResult = calculatePrice(simInputs, adjustedConfig, adjustedOverhead);
      const simulatedPriceCents = simResult.recommendedPriceCents;
      const simulatedCostCents = simResult.minimumPriceCents;

      const changeCents = simulatedPriceCents - prop.revenuePerVisitCents;
      const changePct = prop.revenuePerVisitCents > 0
        ? (changeCents / prop.revenuePerVisitCents) * 100
        : 0;

      const projectedProfit = simulatedPriceCents - simulatedCostCents;
      const projectedMargin = simulatedPriceCents > 0
        ? (projectedProfit / simulatedPriceCents) * 100
        : 0;

      simulatedProperties.push({
        propertyId: prop.propertyId,
        propertyAddress: prop.propertyAddress,
        contactId: customer.contactId,
        contactName: customer.contactName,
        zipCode: property.zipCode,
        frequency: prop.frequency,
        dogCount: prop.dogCount,
        yardSizeAcres: prop.yardSizeAcres,
        currentPriceCents: prop.revenuePerVisitCents,
        simulatedPriceCents,
        changeCents,
        changePct: Math.round(changePct * 100) / 100,
        currentMarginPct: prop.profitMarginPct,
        projectedMarginPct: Math.round(projectedMargin * 100) / 100,
        currentCostPerVisitCents: prop.costPerVisitCents,
        simulatedCostPerVisitCents: simulatedCostCents,
      });
    }
  }

  let totalCurrentMonthly = 0;
  let totalSimulatedMonthly = 0;
  let sumCurrentMargin = 0;
  let sumSimulatedMargin = 0;
  let propertiesNeedingIncrease = 0;
  let propertiesNeedingDecrease = 0;
  let propertiesUnchanged = 0;

  for (const sp of simulatedProperties) {
    const vpm = getFrequencyVisitsPerMonth(sp.frequency);
    totalCurrentMonthly += Math.round(sp.currentPriceCents * vpm);
    totalSimulatedMonthly += Math.round(sp.simulatedPriceCents * vpm);
    sumCurrentMargin += sp.currentMarginPct;
    sumSimulatedMargin += sp.projectedMarginPct;
    if (sp.changeCents > 50) propertiesNeedingIncrease++;
    else if (sp.changeCents < -50) propertiesNeedingDecrease++;
    else propertiesUnchanged++;
  }

  const n = simulatedProperties.length || 1;

  return {
    properties: simulatedProperties,
    summary: {
      totalCurrentMonthlyRevenueCents: totalCurrentMonthly,
      totalSimulatedMonthlyRevenueCents: totalSimulatedMonthly,
      monthlyRevenueDeltaCents: totalSimulatedMonthly - totalCurrentMonthly,
      averageCurrentMarginPct: Math.round((sumCurrentMargin / n) * 100) / 100,
      averageSimulatedMarginPct: Math.round((sumSimulatedMargin / n) * 100) / 100,
      propertiesNeedingIncrease,
      propertiesNeedingDecrease,
      propertiesUnchanged,
    },
    params,
  };
}

export async function runPriceElasticitySimulation(
  companyId: string,
  propertyId?: string
): Promise<ElasticityResult> {
  const allProfitability = await calculateAllCustomerProfitability(companyId);

  let properties: Array<{ revenuePerVisitCents: number; frequency: string; contactName: string; propertyAddress: string }> = [];
  let label = "All Properties";

  if (propertyId) {
    for (const customer of allProfitability) {
      const prop = customer.properties.find(p => p.propertyId === propertyId);
      if (prop) {
        properties.push({
          revenuePerVisitCents: prop.revenuePerVisitCents,
          frequency: prop.frequency,
          contactName: customer.contactName,
          propertyAddress: prop.propertyAddress,
        });
        label = `${customer.contactName} - ${prop.propertyAddress}`;
        break;
      }
    }
  } else {
    for (const customer of allProfitability) {
      for (const prop of customer.properties) {
        properties.push({
          revenuePerVisitCents: prop.revenuePerVisitCents,
          frequency: prop.frequency,
          contactName: customer.contactName,
          propertyAddress: prop.propertyAddress,
        });
      }
    }
  }

  const totalCustomers = properties.length;
  const pricePoints = [-10, -5, 0, 5, 10, 15, 20, 25, 30];

  const currentMonthlyRevenue = properties.reduce((sum, p) => {
    return sum + Math.round(p.revenuePerVisitCents * getFrequencyVisitsPerMonth(p.frequency));
  }, 0);

  const points: ElasticityPoint[] = pricePoints.map(changePct => {
    const churnPct = estimateChurnPct(changePct);
    const retained = Math.round(totalCustomers * (1 - churnPct / 100));

    let adjustedMonthly = 0;
    const avgPrices: number[] = [];

    for (const p of properties) {
      const newPrice = Math.round(p.revenuePerVisitCents * (1 + changePct / 100));
      avgPrices.push(newPrice);
      const monthly = Math.round(newPrice * getFrequencyVisitsPerMonth(p.frequency));
      adjustedMonthly += Math.round(monthly * (1 - churnPct / 100));
    }

    const avgNewPrice = avgPrices.length > 0
      ? Math.round(avgPrices.reduce((a, b) => a + b, 0) / avgPrices.length)
      : 0;

    return {
      priceChangePct: changePct,
      estimatedChurnPct: Math.round(churnPct * 100) / 100,
      retainedCustomers: retained,
      totalCustomers,
      currentMonthlyRevenueCents: currentMonthlyRevenue,
      adjustedMonthlyRevenueCents: adjustedMonthly,
      netRevenueDeltaCents: adjustedMonthly - currentMonthlyRevenue,
      avgNewPriceCents: avgNewPrice,
    };
  });

  const sweetSpotIndex = points.reduce((bestIdx, point, idx) => {
    return point.netRevenueDeltaCents > points[bestIdx].netRevenueDeltaCents ? idx : bestIdx;
  }, 0);

  return {
    propertyId: propertyId || null,
    propertyLabel: label,
    points,
    sweetSpotIndex,
  };
}

export async function runCompetitorAnalysis(
  companyId: string,
  zipCode?: string
): Promise<CompetitorAnalysisResult> {
  const competitors = await storage.getCompetitorPricing(companyId, zipCode);

  const allProfitability = await calculateAllCustomerProfitability(companyId);
  const allProperties = await storage.getProperties(companyId);
  const propertyMap = new Map(allProperties.map(p => [p.id, p]));

  interface PropertyPriceInfo {
    zipCode: string;
    priceCents: number;
    frequency: string;
  }

  const propertyPrices: PropertyPriceInfo[] = [];
  for (const customer of allProfitability) {
    for (const prop of customer.properties) {
      const property = propertyMap.get(prop.propertyId);
      if (!property) continue;
      if (zipCode && property.zipCode !== zipCode) continue;
      propertyPrices.push({
        zipCode: property.zipCode,
        priceCents: prop.revenuePerVisitCents,
        frequency: prop.frequency,
      });
    }
  }

  const allZips = new Set<string>();
  propertyPrices.forEach(p => allZips.add(p.zipCode));
  competitors.forEach(c => allZips.add(c.zipCode));

  const zipEntries: CompetitorAnalysisEntry[] = [];

  for (const zip of allZips) {
    const myProps = propertyPrices.filter(p => p.zipCode === zip);
    const myWeeklyPrices = myProps.map(p => normalizeToWeekly(p.priceCents, p.frequency));
    const myAvg = myWeeklyPrices.length > 0
      ? Math.round(myWeeklyPrices.reduce((a, b) => a + b, 0) / myWeeklyPrices.length)
      : 0;

    const zipCompetitors = competitors.filter(c => c.zipCode === zip);
    const competitorWeeklyPrices = zipCompetitors.map(c => normalizeToWeekly(c.priceCents, c.frequency));
    const marketAvg = competitorWeeklyPrices.length > 0
      ? Math.round(competitorWeeklyPrices.reduce((a, b) => a + b, 0) / competitorWeeklyPrices.length)
      : 0;

    let positionPct = 0;
    let position: "below_market" | "at_market" | "above_market" = "at_market";
    if (marketAvg > 0 && myAvg > 0) {
      positionPct = Math.round(((myAvg - marketAvg) / marketAvg) * 100 * 100) / 100;
      if (positionPct < -5) position = "below_market";
      else if (positionPct > 5) position = "above_market";
    }

    zipEntries.push({
      zipCode: zip,
      yourAvgPriceCents: myAvg,
      yourPropertyCount: myProps.length,
      marketAvgPriceCents: marketAvg,
      competitorCount: zipCompetitors.length,
      competitors: zipCompetitors.map(c => ({
        name: c.competitorName,
        priceCents: c.priceCents,
        frequency: c.frequency,
        dogCountRange: c.dogCountRange ?? "1-2",
        yardSizeCategory: c.yardSizeCategory ?? "medium",
      })),
      positionPct,
      position,
    });
  }

  const overallMyAvg = propertyPrices.length > 0
    ? Math.round(
        propertyPrices.map(p => normalizeToWeekly(p.priceCents, p.frequency)).reduce((a, b) => a + b, 0) / propertyPrices.length
      )
    : 0;

  const allCompWeekly = competitors.map(c => normalizeToWeekly(c.priceCents, c.frequency));
  const overallMarketAvg = allCompWeekly.length > 0
    ? Math.round(allCompWeekly.reduce((a, b) => a + b, 0) / allCompWeekly.length)
    : 0;

  let overallPosition: "below_market" | "at_market" | "above_market" = "at_market";
  if (overallMarketAvg > 0 && overallMyAvg > 0) {
    const diff = ((overallMyAvg - overallMarketAvg) / overallMarketAvg) * 100;
    if (diff < -5) overallPosition = "below_market";
    else if (diff > 5) overallPosition = "above_market";
  }

  return {
    zipCodes: zipEntries,
    overallPosition,
    overallYourAvgCents: overallMyAvg,
    overallMarketAvgCents: overallMarketAvg,
  };
}
