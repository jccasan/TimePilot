import { db } from "../db";
import { contacts, servicePlans, visits, servicePricing, properties, servicePlanAddOns } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

export interface Opportunity {
  key: string;
  label: string;
  detail: string;
  estimatedMonthlyUplift: number;
}

interface ContactProfile {
  contactId: string;
  contactName: string;
  status: string;
  createdAt: Date;
  dismissedOpportunities: string[];
  plans: {
    id: string;
    frequency: string;
    pricePerVisit: number;
    isActive: boolean;
    serviceName: string | null;
  }[];
  totalDogs: number;
  visitStats: {
    total: number;
    completed: number;
  };
  availableAddOns: string[];
  activeAddOnNames: string[];
}

async function buildContactProfile(contactId: string, companyId: string): Promise<ContactProfile | null> {
  const contact = await db.query.contacts.findFirst({
    where: and(eq(contacts.id, contactId), eq(contacts.companyId, companyId)),
  });
  if (!contact) return null;

  const plans = await db.query.servicePlans.findMany({
    where: and(eq(servicePlans.contactId, contactId), eq(servicePlans.companyId, companyId)),
  });

  const activePlans = plans.filter(p => p.isActive && p.jobStatus === "active");

  const propRows = await db.query.properties.findMany({
    where: eq(properties.contactId, contactId),
  });
  const totalDogs = propRows.reduce((sum, p) => sum + (p.numberOfDogs ?? 0), 0);

  let visitStats = { total: 0, completed: 0 };
  if (activePlans.length > 0) {
    const planIds = activePlans.map(p => p.id);
    const visitRows = await db.select({ status: visits.status })
      .from(visits)
      .where(and(eq(visits.companyId, companyId), inArray(visits.servicePlanId, planIds)));
    visitStats.total = visitRows.length;
    visitStats.completed = visitRows.filter(v => v.status === "completed").length;
  }

  const addOnRows = await db.query.servicePricing.findMany({
    where: and(eq(servicePricing.companyId, companyId), eq(servicePricing.category, "add_on")),
  });
  const availableAddOns = addOnRows.map(a => a.name);

  const activeAddOnNames: string[] = [];
  if (activePlans.length > 0) {
    const planIds = activePlans.map(p => p.id);
    const planAddOnRows = await db.query.servicePlanAddOns.findMany({
      where: inArray(servicePlanAddOns.servicePlanId, planIds),
    });
    for (const row of planAddOnRows) {
      if (!activeAddOnNames.includes(row.name)) {
        activeAddOnNames.push(row.name);
      }
    }
  }

  return {
    contactId: contact.id,
    contactName: `${contact.firstName} ${contact.lastName}`.trim(),
    status: contact.status,
    createdAt: contact.createdAt,
    dismissedOpportunities: (contact.dismissedOpportunities as string[] | null) ?? [],
    plans: activePlans.map(p => ({
      id: p.id,
      frequency: p.frequency,
      pricePerVisit: parseFloat(p.pricePerVisit as string),
      isActive: p.isActive,
      serviceName: p.serviceName,
    })),
    totalDogs,
    visitStats,
    availableAddOns,
    activeAddOnNames,
  };
}

function evaluateOpportunities(profile: ContactProfile): Opportunity[] {
  const opps: Opportunity[] = [];
  const dismissed = new Set(profile.dismissedOpportunities ?? []);

  const biweeklyPlans = profile.plans.filter(p => p.frequency === "biweekly");
  const weeklyPlans = profile.plans.filter(p => p.frequency === "weekly");
  const monthlyPlans = profile.plans.filter(p => p.frequency === "monthly");

  if (
    !dismissed.has("upgrade_biweekly_to_weekly") &&
    biweeklyPlans.length > 0 &&
    weeklyPlans.length === 0 &&
    profile.totalDogs >= 4
  ) {
    const biweeklyPrice = biweeklyPlans[0].pricePerVisit;
    const estimatedWeeklyPrice = biweeklyPrice * 0.8;
    const uplift = estimatedWeeklyPrice * 4 - biweeklyPrice * 2;
    opps.push({
      key: "upgrade_biweekly_to_weekly",
      label: "Upgrade to weekly service",
      detail: `${profile.totalDogs} dogs on biweekly — high-volume clients often benefit from weekly visits`,
      estimatedMonthlyUplift: Math.max(0, uplift),
    });
  }

  if (
    !dismissed.has("upgrade_monthly_to_biweekly") &&
    monthlyPlans.length > 0 &&
    weeklyPlans.length === 0 &&
    biweeklyPlans.length === 0 &&
    profile.totalDogs >= 2
  ) {
    const monthlyPrice = monthlyPlans[0].pricePerVisit;
    const estimatedBiweeklyPrice = monthlyPrice * 0.7;
    const uplift = estimatedBiweeklyPrice * 2 - monthlyPrice;
    opps.push({
      key: "upgrade_monthly_to_biweekly",
      label: "Upgrade to biweekly service",
      detail: `${profile.totalDogs} dogs on monthly service — more frequent visits would benefit the yard`,
      estimatedMonthlyUplift: Math.max(0, uplift),
    });
  }

  const deodorizerAvailable = profile.availableAddOns.some(a =>
    a.toLowerCase().includes("deodorizer") || a.toLowerCase().includes("deodoriz")
  );
  const deodorizerActive = profile.activeAddOnNames.some(a =>
    a.toLowerCase().includes("deodorizer") || a.toLowerCase().includes("deodoriz")
  );
  if (
    !dismissed.has("add_deodorizer") &&
    deodorizerAvailable &&
    !deodorizerActive &&
    profile.totalDogs >= 3
  ) {
    opps.push({
      key: "add_deodorizer",
      label: "Add deodorizer service",
      detail: `${profile.totalDogs}+ dogs — clients with 3+ dogs often add deodorizer for fresher yards`,
      estimatedMonthlyUplift: 15,
    });
  }

  const tenureMonths = Math.floor(
    (Date.now() - new Date(profile.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30)
  );
  if (
    !dismissed.has("loyalty_upsell") &&
    tenureMonths >= 12 &&
    profile.plans.length > 0 &&
    profile.plans.every(p => p.frequency !== "weekly")
  ) {
    const avgPrice = profile.plans.reduce((s, p) => s + p.pricePerVisit, 0) / Math.max(1, profile.plans.length);
    opps.push({
      key: "loyalty_upsell",
      label: "Loyalty upgrade offer",
      detail: `${tenureMonths}-month customer — long-term clients are strong candidates for premium service tiers`,
      estimatedMonthlyUplift: Math.round(avgPrice * 0.15 * 4),
    });
  }

  if (
    !dismissed.has("reliable_client_upgrade") &&
    profile.visitStats.total >= 10 &&
    profile.visitStats.total > 0 &&
    profile.visitStats.completed / profile.visitStats.total >= 0.9 &&
    profile.plans.some(p => p.frequency === "biweekly" || p.frequency === "monthly")
  ) {
    const avgPrice = profile.plans.reduce((s, p) => s + p.pricePerVisit, 0) / Math.max(1, profile.plans.length);
    opps.push({
      key: "reliable_client_upgrade",
      label: "Reliable client — consider frequency upgrade",
      detail: `${profile.visitStats.completed}/${profile.visitStats.total} visits completed — excellent track record makes this client an ideal upgrade candidate`,
      estimatedMonthlyUplift: Math.round(avgPrice * 0.2 * 4),
    });
  }

  return opps;
}

export async function getOpportunitiesForContact(contactId: string, companyId: string): Promise<Opportunity[]> {
  const profile = await buildContactProfile(contactId, companyId);
  if (!profile) return [];
  return evaluateOpportunities(profile);
}

export async function getGrowthOpportunities(companyId: string, limit = 10): Promise<{
  contactId: string;
  contactName: string;
  topOpportunity: Opportunity;
  totalUplift: number;
  count: number;
}[]> {
  const activeContacts = await db.query.contacts.findMany({
    where: and(eq(contacts.companyId, companyId), eq(contacts.status, "active")),
    limit: 200,
  });

  const results: { contactId: string; contactName: string; topOpportunity: Opportunity; totalUplift: number; count: number }[] = [];

  for (const contact of activeContacts) {
    const profile = await buildContactProfile(contact.id, companyId);
    if (!profile) continue;
    const opps = evaluateOpportunities(profile);
    if (opps.length === 0) continue;
    const totalUplift = opps.reduce((s, o) => s + o.estimatedMonthlyUplift, 0);
    results.push({
      contactId: contact.id,
      contactName: `${contact.firstName} ${contact.lastName}`.trim(),
      topOpportunity: opps[0],
      totalUplift,
      count: opps.length,
    });
  }

  results.sort((a, b) => b.totalUplift - a.totalUplift);
  return results.slice(0, limit);
}
