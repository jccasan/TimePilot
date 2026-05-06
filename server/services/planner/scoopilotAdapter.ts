// Data adapter that maps ScooPilot's database rows into the planner's
// Customer[] and RoutePlannerSettings types.

import { storage } from "../../storage";
import { DEFAULT_PRICING_CONFIG } from "@shared/schema";
import type { Customer, CompanyLocation, RoutePlannerSettings, ServiceFrequency } from "./types";

/**
 * Loads contacts, properties, and active service plans for a company from
 * storage and converts them into the planner's Customer type.
 */
async function buildCustomers(companyId: string): Promise<Customer[]> {
  const [contacts, properties, servicePlans] = await Promise.all([
    storage.getContacts(companyId),
    storage.getProperties(companyId),
    storage.getServicePlans(companyId, { isActive: true }),
  ]);

  // Index properties by id for fast lookup.
  const propById = new Map(properties.map((p) => [p.id, p]));

  // Index service plans by contactId — we only need one plan per contact
  // to get the service frequency and route assignment. If a contact has
  // multiple plans we take the first active one with a valid frequency.
  const planByContact = new Map<string, (typeof servicePlans)[0]>();
  for (const sp of servicePlans) {
    if (!sp.contactId) continue;
    if (planByContact.has(sp.contactId)) continue;
    planByContact.set(sp.contactId, sp);
  }

  const customers: Customer[] = [];

  for (const contact of contacts) {
    const plan = planByContact.get(contact.id);
    if (!plan) continue; // No active service plan → skip

    // Resolve property coordinates.
    const prop = plan.propertyId ? propById.get(plan.propertyId) : undefined;
    const lat = prop?.latitude ? parseFloat(prop.latitude) : undefined;
    const lng = prop?.longitude ? parseFloat(prop.longitude) : undefined;

    // Build the service address string.
    const addressParts = [prop?.streetAddress, prop?.city, prop?.state, prop?.zipCode].filter(
      Boolean
    );
    const address =
      addressParts.length > 0
        ? addressParts.join(", ")
        : `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim();

    // Map ScooPilot frequency values to planner ServiceFrequency.
    // Schema uses "onetime"; the planner domain uses "one_time".
    const freqMap: Record<string, ServiceFrequency> = {
      weekly: "weekly",
      biweekly: "biweekly",
      monthly: "monthly",
      onetime: "one_time",
    };
    const serviceFrequency: ServiceFrequency = freqMap[plan.frequency] ?? "weekly";

    const revenuePerVisit = parseFloat(plan.pricePerVisit);

    const isActive = contact.status === "active";

    const customer: Customer = {
      id: contact.id,
      name:
        `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() ||
        contact.email ||
        contact.id,
      address,
      latitude: lat,
      longitude: lng,
      serviceFrequency,
      revenuePerVisit: Number.isFinite(revenuePerVisit) ? revenuePerVisit : 0,
      active: isActive,
      currentAssignedRouteId: plan.routeId ?? undefined,
    };

    customers.push(customer);
  }

  return customers;
}

/**
 * Builds a RoutePlannerSettings object from the company record.
 * Falls back to safe defaults when company fields are missing.
 */
async function buildSettings(companyId: string): Promise<RoutePlannerSettings> {
  const company = await storage.getCompany(companyId);
  if (!company) {
    throw new Error(`Company not found: ${companyId}`);
  }

  const pricing = { ...DEFAULT_PRICING_CONFIG, ...(company.pricingConfig ?? {}) };

  // Labor cost per hour: techHourlyWageCents with burden multiplier, converted to dollars.
  const laborCostPerHour = (pricing.techHourlyWageCents * pricing.burdenMultiplier) / 100;

  // Gas price in dollars per gallon.
  const averageGasPricePerGallon = pricing.averageGasPriceCentsPerGallon / 100;

  // Vehicle MPG — use vehicleMPG from pricing config, or fall back to computed from vehicleCostPerMileCents.
  const vehicleMilesPerGallon = pricing.vehicleMPG ?? 25;

  // Vehicle cost per mile in dollars (optional — if null, use fuel-only).
  const vehicleCostPerMile =
    pricing.vehicleMPG === null ? pricing.vehicleCostPerMileCents / 100 : undefined;

  // Company start location (if configured).
  let companyStartLocation: CompanyLocation | undefined;
  if (company.startLatitude && company.startLongitude) {
    companyStartLocation = {
      id: company.id,
      name: company.name,
      address: company.startAddress ?? company.address ?? "",
      latitude: parseFloat(company.startLatitude),
      longitude: parseFloat(company.startLongitude),
      coordinateSource: "owner_confirmed_location",
      isDefaultStartLocation: true,
    };
  }

  // Mapbox config — only if token is present.
  const mapboxToken =
    process.env.MAPBOX_ACCESS_TOKEN ||
    process.env.MAPBOX_PUBLIC_TOKEN ||
    process.env.MAPBOX_SECRET_TOKEN;
  const mapboxConfig = mapboxToken
    ? {
        accessToken: mapboxToken,
        profile: "driving" as const,
        cacheEnabled: true,
        coordinatePrecision: 5,
        maxMatrixSize: 25,
        requestTimeoutMs: 8000,
      }
    : undefined;

  const maxStopsPerRoute = company.maxStopsPerRoute ?? 50;
  // minStopsPerDay drives the route merging floor: routes with fewer stops than
  // this threshold are candidates for merging with nearby underutilized routes.
  const minStopsPerRoute = company.minStopsPerDay ?? 3;

  const settings: RoutePlannerSettings = {
    planningWeeks: 4,
    planningStartMode: "next_monday",

    companyStartLocation,
    routeCostMode: companyStartLocation ? "office_to_first_and_return" : "stop_to_stop_only",
    includeOfficeToFirstStop: !!companyStartLocation,
    includeReturnToOffice: false,

    defaultServiceMinutesPerStop: pricing.minimumServiceMinutesFloor ?? 10,
    allowCustomerServiceTimeOverride: false,
    routeBufferMinutes: 30,
    perStopBufferMinutes: 1,

    minimumViableRouteMinutes: 60,
    targetMinRouteMinutes: 300,
    targetMaxRouteMinutes: 420,
    hardMaxRouteMinutes: 450,
    allowTimeOverride: false,

    useStopCountAsHardConstraint: false,
    warnAtStopCount: maxStopsPerRoute,
    unusualStopCountThreshold: Math.ceil(maxStopsPerRoute * 1.2),

    laborCostPerHour,
    averageGasPricePerGallon,
    vehicleMilesPerGallon,
    useFuelOnlyCost: pricing.vehicleMPG !== null,
    vehicleCostPerMile,
    includeDriveLaborInProfitability: true,
    includeFuelCostInProfitability: true,

    minimumRouteGrossProfit: 0,
    targetRouteProfitMargin: pricing.targetProfitMarginPct / 100,
    minimumRouteProfitMargin: 0.1,

    profitabilityWeight: 0.4,
    driveEfficiencyWeight: 0.25,
    densityWeight: 0.15,
    routeStabilityWeight: 0.1,
    fewestRoutesWeight: 0.1,

    allowRouteRebalancing: true,
    preserveExistingRouteAssignments: false,

    minStopsPerRoute,
    mapboxConfig,
  };

  return settings;
}

/**
 * Main entry point: loads all data for a company and returns the planner inputs.
 */
export async function buildPlannerInputs(companyId: string): Promise<{
  customers: Customer[];
  settings: RoutePlannerSettings;
}> {
  const [customers, settings] = await Promise.all([
    buildCustomers(companyId),
    buildSettings(companyId),
  ]);
  return { customers, settings };
}
