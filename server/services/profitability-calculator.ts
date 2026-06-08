/* eslint-disable @typescript-eslint/no-explicit-any */
import { storage } from "../storage";
import {
  calculatePrice,
  getEffectivePricingConfig,
  yardSizeLabelToAcres,
  sqftToAcres,
  parseLotSizeStringToAcres,
  type PriceCalculatorInputs,
  type PriceCalculatorResult,
} from "./pricing-calculator";
import { computeJobEconomics, type JobEconomicsResult } from "./job-economics-engine";
import type { PricingConfig, InsertProfitabilitySnapshot } from "@shared/schema";
import { frequencyVisitsPerMonth } from "@shared/frequency-utils";

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
    travelLaborCostCents: number;
    travelCostCents: number;
    equipmentCostCents: number;
    overheadCostCents: number;
  };
  calculatorResult: PriceCalculatorResult;
  jobEconomicsResult: PriceCalculatorResult;
  jobCostPerVisitCents: number;
  jobProfitPerVisitCents: number;
  jobProfitMarginPct: number;
  jobProfitPerHourCents: number;
  standardTravelMinutesUsed: number;
  jobEconomicsV2: JobEconomicsResult;
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

function getVehicleCostPerMile(config: PricingConfig): number {
  if (config.vehicleCostPerMileCents > 0) return config.vehicleCostPerMileCents / 100;
  if (config.vehicleMPG && config.vehicleMPG > 0)
    return config.averageGasPriceCentsPerGallon / config.vehicleMPG / 100;
  return 0.65;
}

function buildEngineInputs(
  totalPerVisitCents: number,
  result: PriceCalculatorResult,
  standardTravelMins: number,
  distanceMiles: number,
  fullConfig: PricingConfig,
  monthlyOverheadCents: number,
  perVisitOverheadCents: number | undefined
): Parameters<typeof computeJobEconomics>[0] {
  const actualTravelMinutes =
    fullConfig.driveSpeedAverageMph > 0
      ? (distanceMiles / fullConfig.driveSpeedAverageMph) * 60
      : 0;

  let engineMonthlyOverhead: number;
  const engineMonthlyVisits = Math.max(fullConfig.estimatedMonthlyStops, 1);
  if (perVisitOverheadCents !== undefined) {
    engineMonthlyOverhead = (perVisitOverheadCents / 100) * engineMonthlyVisits;
  } else if (monthlyOverheadCents > 0) {
    engineMonthlyOverhead = monthlyOverheadCents / 100;
  } else {
    engineMonthlyOverhead =
      (fullConfig.advertisingCents +
        fullConfig.payrollProviderCents +
        fullConfig.benefitsCents +
        fullConfig.insuranceCents +
        fullConfig.softwareCents +
        fullConfig.otherOverheadCents) /
      100;
  }

  return {
    currentPricePerVisit: totalPerVisitCents / 100,
    serviceMinutes: result.breakdown.serviceMinutes,
    targetTravelMinutes: standardTravelMins,
    actualTravelMinutes,
    actualTravelMiles: distanceMiles,
    hourlyWage: fullConfig.techHourlyWageCents / 100,
    laborBurdenMultiplier: fullConfig.burdenMultiplier,
    vehicleCostPerMile: getVehicleCostPerMile(fullConfig),
    estimatedSuppliesPerVisit: result.breakdown.equipmentCostCents / 100,
    monthlyOverhead: engineMonthlyOverhead,
    estimatedMonthlyVisits: engineMonthlyVisits,
    targetMarginPercent: fullConfig.targetProfitMarginPct / 100,
  };
}

function getFrequencyVisitsPerMonth(frequency: string): number {
  return frequencyVisitsPerMonth(frequency);
}

function determineProfitabilityStatus(
  marginPct: number,
  targetMarginPct = 30
): ProfitabilityStatus {
  if (marginPct < 0) return "unprofitable";
  if (marginPct <= targetMarginPct * 0.5) return "marginal";
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
  const contact = contacts.find((c) => c.id === contactId);
  if (!contact) return null;

  const [allPlans, allCompanyPlans, properties] = await Promise.all([
    storage.getServicePlans(companyId, { contactId, isActive: true }),
    storage.getServicePlans(companyId, { isActive: true }),
    storage.getProperties(companyId, contactId),
  ]);
  const plans = allPlans.filter((p) => !p.isStopOnly);
  if (plans.length === 0) return null;

  // Actual monthly visits across ALL active company plans — used as overhead denominator
  const actualMonthlyVisits = Math.max(
    Math.round(
      allCompanyPlans
        .filter((p) => !p.isStopOnly)
        .reduce((sum, p) => sum + getFrequencyVisitsPerMonth(p.frequency), 0)
    ),
    1
  );

  const propertyMap = new Map(properties.map((p) => [p.id, p]));

  const pricingConfig = company.pricingConfig as Partial<PricingConfig> | null;
  const companyFullConfig = getEffectivePricingConfig(pricingConfig);

  const overheadTotal = await storage.getTotalMonthlyOverheadCents(companyId);
  const overrideOverhead = overheadTotal > 0 ? overheadTotal : undefined;

  const costOverrides = contact.costOverrides;

  const effectivePricingConfig: Partial<PricingConfig> = {
    ...pricingConfig,
    estimatedMonthlyStops: actualMonthlyVisits,
  };
  if (costOverrides?.techHourlyWageCents !== undefined) {
    effectivePricingConfig.techHourlyWageCents = costOverrides.techHourlyWageCents;
  }
  if (costOverrides?.burdenMultiplier !== undefined) {
    effectivePricingConfig.burdenMultiplier = costOverrides.burdenMultiplier;
  }

  const effectiveOverhead =
    costOverrides?.overheadAllocationCents !== undefined ? undefined : overrideOverhead;

  const propertyResults: CustomerPropertyProfitability[] = [];

  for (const plan of plans) {
    const property = propertyMap.get(plan.propertyId);
    if (!property) continue;

    let yardSizeAcres: number;
    if (property.measuredYardSqft) {
      // Most precise: actual map-measured yard area
      yardSizeAcres = sqftToAcres(property.measuredYardSqft);
    } else {
      // Try to parse the text "Yard Size" field (e.g. "0.18 acres", "7,840 sqft")
      const parsed = parseLotSizeStringToAcres((property as any).lotSize);
      yardSizeAcres = parsed !== null ? parsed : yardSizeLabelToAcres(property.yardSize);
    }

    const dogCount = property.numberOfDogs ?? 1;

    const planAddOns = await storage.getServicePlanAddOns(plan.id);
    const activeAddOns = planAddOns.filter((a) => a.isActive);
    const addOnsCents = activeAddOns.reduce(
      (s, a) => s + Math.round((parseFloat(a.price) || 0) * 100),
      0
    );
    const totalPerVisitCents = Math.round(parseFloat(plan.pricePerVisit) * 100) + addOnsCents;
    const hasYardDeodorizing = activeAddOns.some((a) => a.name.toLowerCase().includes("deodor"));

    const distanceMiles =
      costOverrides?.distanceFromNearestStopMiles !== undefined
        ? costOverrides.distanceFromNearestStopMiles
        : (effectiveConfig.distanceFromNearestStopMiles ?? 1.0);

    const inputs: PriceCalculatorInputs = {
      yardSizeAcres,
      dogCount,
      serviceFrequency: plan.frequency as "weekly" | "biweekly" | "monthly" | "onetime",
      yardDifficulty: (property.yardDifficulty ?? "flat") as "flat" | "moderate" | "difficult",
      distanceFromNearestStopMiles: distanceMiles,
      routeStopsPerMile: effectiveConfig.routeStopsPerMile,
      currentPriceCents: totalPerVisitCents,
      hasYardDeodorizing,
    };

    const result = calculatePrice(
      inputs,
      effectivePricingConfig,
      effectiveOverhead,
      costOverrides?.overheadAllocationCents
    );

    // Job-level economics: standardized travel time instead of actual route data
    const fullConfig = getEffectivePricingConfig(effectivePricingConfig);
    const standardTravelMins = fullConfig.standardTravelMinutesPerStop ?? 3;
    const jobInputs: PriceCalculatorInputs = {
      ...inputs,
      overrideAdjustedTravelMinutes: standardTravelMins,
    };
    const jobResult = calculatePrice(
      jobInputs,
      effectivePricingConfig,
      effectiveOverhead,
      costOverrides?.overheadAllocationCents
    );

    const revenuePerVisitCents = totalPerVisitCents;
    const costPerVisitCents = result.totalCostPerVisitCentsUnrounded;
    const profitPerVisitCents = revenuePerVisitCents - costPerVisitCents;
    const profitMarginPct =
      revenuePerVisitCents > 0
        ? (profitPerVisitCents / revenuePerVisitCents) * 100
        : costPerVisitCents > 0
          ? -100
          : 0;
    const jobMinutes = result.derived.jobMinutes;
    const profitPerHourCents = jobMinutes > 0 ? (profitPerVisitCents / jobMinutes) * 60 : 0;

    const jobCostPerVisitCents = jobResult.totalCostPerVisitCentsUnrounded;
    const jobProfitPerVisitCents = revenuePerVisitCents - jobCostPerVisitCents;
    const jobProfitMarginPct =
      revenuePerVisitCents > 0 ? (jobProfitPerVisitCents / revenuePerVisitCents) * 100 : 0;
    const jobResultMinutes = jobResult.derived.jobMinutes;
    const jobProfitPerHourCents =
      jobResultMinutes > 0 ? (jobProfitPerVisitCents / jobResultMinutes) * 60 : 0;

    const jobEconomicsV2 = computeJobEconomics(
      buildEngineInputs(
        totalPerVisitCents,
        result,
        standardTravelMins,
        distanceMiles,
        fullConfig,
        overrideOverhead ?? 0,
        costOverrides?.overheadAllocationCents
      )
    );

    propertyResults.push({
      propertyId: property.id,
      propertyAddress: [property.streetAddress, property.city, property.state, property.zipCode]
        .filter(Boolean)
        .join(", "),
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
        travelLaborCostCents: result.breakdown.travelLaborCostCents,
        travelCostCents: result.breakdown.adjustedTravelCostCents,
        equipmentCostCents: result.breakdown.equipmentCostCents,
        overheadCostCents: result.breakdown.overheadPerVisitCents,
      },
      calculatorResult: result,
      jobEconomicsResult: jobResult,
      jobCostPerVisitCents,
      jobProfitPerVisitCents,
      jobProfitMarginPct: Math.round(jobProfitMarginPct * 100) / 100,
      jobProfitPerHourCents: Math.round(jobProfitPerHourCents),
      standardTravelMinutesUsed: standardTravelMins,
      jobEconomicsV2,
    });
  }

  const totalRevenuePerVisitCents = propertyResults.reduce(
    (sum, p) => sum + p.revenuePerVisitCents,
    0
  );
  const totalCostPerVisitCents = propertyResults.reduce((sum, p) => sum + p.costPerVisitCents, 0);
  const totalProfitPerVisitCents = totalRevenuePerVisitCents - totalCostPerVisitCents;
  const overallMarginPct =
    totalRevenuePerVisitCents > 0
      ? (totalProfitPerVisitCents / totalRevenuePerVisitCents) * 100
      : totalCostPerVisitCents > 0
        ? -100
        : 0;

  let monthlyRevenueCents = 0;
  let monthlyCostCents = 0;
  for (const p of propertyResults) {
    const plan = plans.find((pl) => pl.id === p.servicePlanId);
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
    status: determineProfitabilityStatus(overallMarginPct, companyFullConfig.targetProfitMarginPct),
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
  const baseConfig = getEffectivePricingConfig(pricingConfig);
  const companyTargetMarginPct = baseConfig.targetProfitMarginPct;
  const overheadTotal = await storage.getTotalMonthlyOverheadCents(companyId);
  const overrideOverhead = overheadTotal > 0 ? overheadTotal : undefined;

  const activePlans = allPlans.filter((p) => !p.isStopOnly);

  // Compute actual monthly visit count from real plan frequencies so overhead/visit is accurate
  const actualMonthlyVisits = Math.max(
    Math.round(activePlans.reduce((sum, p) => sum + getFrequencyVisitsPerMonth(p.frequency), 0)),
    1
  );

  const allAddOnsMap = await storage.getAllServicePlanAddOnsForCompany(
    activePlans.map((p) => p.id)
  );

  const plansByContact = new Map<string, typeof activePlans>();
  for (const plan of activePlans) {
    if (!plansByContact.has(plan.contactId)) plansByContact.set(plan.contactId, []);
    plansByContact.get(plan.contactId)!.push(plan);
  }
  const propertyMap = new Map(allProperties.map((p) => [p.id, p]));

  const results: CustomerProfitability[] = [];
  for (const contact of contacts) {
    const plans = plansByContact.get(contact.id);
    if (!plans || plans.length === 0) continue;

    const contactOverrides = contact.costOverrides;

    const contactPricingConfig: Partial<PricingConfig> = {
      ...pricingConfig,
      estimatedMonthlyStops: actualMonthlyVisits,
    };
    if (contactOverrides?.techHourlyWageCents !== undefined) {
      contactPricingConfig.techHourlyWageCents = contactOverrides.techHourlyWageCents;
    }
    if (contactOverrides?.burdenMultiplier !== undefined) {
      contactPricingConfig.burdenMultiplier = contactOverrides.burdenMultiplier;
    }
    const contactOverhead =
      contactOverrides?.overheadAllocationCents !== undefined ? undefined : overrideOverhead;

    const propertyResults: CustomerPropertyProfitability[] = [];
    for (const plan of plans) {
      const property = propertyMap.get(plan.propertyId);
      if (!property) continue;

      let yardSizeAcres: number;
      if (property.measuredYardSqft) {
        // Most precise: actual map-measured yard area
        yardSizeAcres = sqftToAcres(property.measuredYardSqft);
      } else {
        // Try to parse the text "Yard Size" field (e.g. "0.18 acres", "7,840 sqft")
        const parsed = parseLotSizeStringToAcres((property as any).lotSize);
        yardSizeAcres = parsed !== null ? parsed : yardSizeLabelToAcres(property.yardSize);
      }
      const dogCount = property.numberOfDogs ?? 1;

      const planAddOns = allAddOnsMap.get(plan.id) || [];
      const activeAddOns = planAddOns.filter((a) => a.isActive);
      const addOnsCents = activeAddOns.reduce(
        (s, a) => s + Math.round((parseFloat(a.price) || 0) * 100),
        0
      );
      const totalPerVisitCents = Math.round(parseFloat(plan.pricePerVisit) * 100) + addOnsCents;
      const hasYardDeodorizing = activeAddOns.some((a) => a.name.toLowerCase().includes("deodor"));

      const distanceMiles =
        contactOverrides?.distanceFromNearestStopMiles !== undefined
          ? contactOverrides.distanceFromNearestStopMiles
          : (effectiveConfig.distanceFromNearestStopMiles ?? 1.0);

      const inputs: PriceCalculatorInputs = {
        yardSizeAcres,
        dogCount,
        serviceFrequency: plan.frequency as "weekly" | "biweekly" | "monthly" | "onetime",
        yardDifficulty: (property.yardDifficulty ?? "flat") as "flat" | "moderate" | "difficult",
        distanceFromNearestStopMiles: distanceMiles,
        routeStopsPerMile: effectiveConfig.routeStopsPerMile,
        currentPriceCents: totalPerVisitCents,
        hasYardDeodorizing,
      };

      const result = calculatePrice(
        inputs,
        contactPricingConfig,
        contactOverhead,
        contactOverrides?.overheadAllocationCents
      );
      const contactFullConfig = getEffectivePricingConfig(contactPricingConfig);
      const contactStandardTravelMins = contactFullConfig.standardTravelMinutesPerStop ?? 3;
      const contactJobInputs: PriceCalculatorInputs = {
        ...inputs,
        overrideAdjustedTravelMinutes: contactStandardTravelMins,
      };
      const contactJobResult = calculatePrice(
        contactJobInputs,
        contactPricingConfig,
        contactOverhead,
        contactOverrides?.overheadAllocationCents
      );

      const revenuePerVisitCents = totalPerVisitCents;
      const costPerVisitCents = result.totalCostPerVisitCentsUnrounded;
      const profitPerVisitCents = revenuePerVisitCents - costPerVisitCents;
      const profitMarginPct =
        revenuePerVisitCents > 0
          ? (profitPerVisitCents / revenuePerVisitCents) * 100
          : costPerVisitCents > 0
            ? -100
            : 0;
      const jobMinutes = result.derived.jobMinutes;
      const profitPerHourCents = jobMinutes > 0 ? (profitPerVisitCents / jobMinutes) * 60 : 0;

      const contactJobCostPerVisitCents = contactJobResult.totalCostPerVisitCentsUnrounded;
      const contactJobProfitPerVisitCents = revenuePerVisitCents - contactJobCostPerVisitCents;
      const contactJobProfitMarginPct =
        revenuePerVisitCents > 0 ? (contactJobProfitPerVisitCents / revenuePerVisitCents) * 100 : 0;
      const contactJobResultMinutes = contactJobResult.derived.jobMinutes;
      const contactJobProfitPerHourCents =
        contactJobResultMinutes > 0
          ? (contactJobProfitPerVisitCents / contactJobResultMinutes) * 60
          : 0;

      const contactJobEconomicsV2 = computeJobEconomics(
        buildEngineInputs(
          totalPerVisitCents,
          result,
          contactStandardTravelMins,
          distanceMiles,
          contactFullConfig,
          contactOverhead ?? overrideOverhead ?? 0,
          contactOverrides?.overheadAllocationCents
        )
      );

      propertyResults.push({
        propertyId: property.id,
        propertyAddress: [property.streetAddress, property.city, property.state, property.zipCode]
          .filter(Boolean)
          .join(", "),
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
          travelLaborCostCents: result.breakdown.travelLaborCostCents,
          travelCostCents: result.breakdown.adjustedTravelCostCents,
          equipmentCostCents: result.breakdown.equipmentCostCents,
          overheadCostCents: result.breakdown.overheadPerVisitCents,
        },
        calculatorResult: result,
        jobEconomicsResult: contactJobResult,
        jobCostPerVisitCents: contactJobCostPerVisitCents,
        jobProfitPerVisitCents: contactJobProfitPerVisitCents,
        jobProfitMarginPct: Math.round(contactJobProfitMarginPct * 100) / 100,
        jobProfitPerHourCents: Math.round(contactJobProfitPerHourCents),
        standardTravelMinutesUsed: contactStandardTravelMins,
        jobEconomicsV2: contactJobEconomicsV2,
      });
    }

    if (propertyResults.length === 0) continue;

    const totalRevenuePerVisitCents = propertyResults.reduce(
      (sum, p) => sum + p.revenuePerVisitCents,
      0
    );
    const totalCostPerVisitCents = propertyResults.reduce((sum, p) => sum + p.costPerVisitCents, 0);
    const totalProfitPerVisitCents = totalRevenuePerVisitCents - totalCostPerVisitCents;
    const overallMarginPct =
      totalRevenuePerVisitCents > 0
        ? (totalProfitPerVisitCents / totalRevenuePerVisitCents) * 100
        : totalCostPerVisitCents > 0
          ? -100
          : 0;

    let monthlyRevenueCents = 0;
    let monthlyCostCents = 0;
    for (const p of propertyResults) {
      const plan = plans.find((pl) => pl.id === p.servicePlanId);
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
      status: determineProfitabilityStatus(overallMarginPct, companyTargetMarginPct),
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
  const [allProfitability, company] = await Promise.all([
    calculateAllCustomerProfitability(companyId, config),
    storage.getCompany(companyId),
  ]);
  const companyTargetMarginPct = getEffectivePricingConfig(
    (company?.pricingConfig as Partial<PricingConfig> | null) ?? null
  ).targetProfitMarginPct;
  const snapshotDate = new Date().toISOString().split("T")[0];
  let count = 0;

  for (const customer of allProfitability) {
    for (const prop of customer.properties) {
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
        status: determineProfitabilityStatus(prop.profitMarginPct, companyTargetMarginPct),
        breakdownJson: {
          laborCostCents: prop.costBreakdown.laborCostCents,
          travelLaborCostCents: prop.costBreakdown.travelLaborCostCents,
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
        const projectedMargin =
          prop.recommendedPriceCents > 0 ? (projectedProfit / prop.recommendedPriceCents) * 100 : 0;

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
