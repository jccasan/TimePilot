import { storage } from "../storage";
import { getCompanyToday } from "../utils/company-date";
import type { VacationHold, ServicePlan } from "@shared/schema";

export async function runAutoVisits() {
  console.log("[auto-visits] Starting auto visit generation...");

  const allCompanies = await storage.getAllCompanies();
  let totalCreated = 0;
  let companiesProcessed = 0;
  let errors = 0;

  for (const company of allCompanies) {
    if (!company.autoVisitsEnabled) continue;

    try {
      const companyToday = getCompanyToday(company.timezone || "America/New_York");
      const startDate = new Date(companyToday + "T00:00:00Z");
      startDate.setUTCDate(startDate.getUTCDate() + 1);
      const endDate = new Date(companyToday + "T00:00:00Z");
      endDate.setUTCDate(endDate.getUTCDate() + 182);

      const startStr = startDate.toISOString().split("T")[0];
      const endStr = endDate.toISOString().split("T")[0];

      const created = await generateVisitsForCompany(company.id, startStr, endStr);
      totalCreated += created;
      companiesProcessed++;

      if (created > 0) {
        storage.createNotification({
          companyId: company.id,
          type: "general",
          title: "Visits Auto-Generated",
          message: `${created} visit${created !== 1 ? "s" : ""} created for the next 6 months (${startStr} to ${endStr}).`,
          isRead: false,
          linkUrl: "/scheduling",
        }).catch(console.error);
      }
    } catch (err) {
      errors++;
      console.error(`[auto-visits] Error processing company ${company.id}:`, err);
    }
  }

  console.log(`[auto-visits] Completed: ${companiesProcessed} companies, ${totalCreated} visits created, ${errors} errors`);
  return { companiesProcessed, totalCreated, errors };
}

export async function generateVisitsForPlans(companyId: string, planIds: string[], startDate: string, endDate: string): Promise<number> {
  const plans = await storage.getServicePlans(companyId, { isActive: true });
  const matching = plans.filter(p => planIds.includes(p.id) && !p.pausedAt);
  if (matching.length === 0) return 0;
  return generateVisitsFromPlans(companyId, matching, startDate, endDate, true);
}

export async function generateVisitsForCompany(companyId: string, startDate: string, endDate: string): Promise<number> {
  const plans = await storage.getServicePlans(companyId, { isActive: true });
  const activePlans = plans.filter(p => !p.pausedAt);
  return generateVisitsFromPlans(companyId, activePlans, startDate, endDate, false);
}

function isDateInVacationHold(dateStr: string, holdKey: string, holdsByKey: Map<string, VacationHold[]>): boolean {
  const holds = holdsByKey.get(holdKey);
  if (!holds || holds.length === 0) return false;
  for (const hold of holds) {
    if (dateStr >= hold.startDate && dateStr <= hold.endDate) return true;
  }
  return false;
}

async function generateVisitsFromPlans(companyId: string, plans: ServicePlan[], startDate: string, endDate: string, ignoreCancelled: boolean): Promise<number> {
  const existingVisits = await storage.getVisitsForDateRange(companyId, startDate, endDate);
  const existingKeys = new Set(
    existingVisits
      .filter((v) => !ignoreCancelled || v.status !== "cancelled")
      .map((v) => `${v.servicePlanId}_${v.scheduledDate}`)
  );

  const planIds = plans.map(p => p.id);
  const allHolds = planIds.length > 0
    ? await storage.getVacationHoldsForPlans(planIds)
    : [];
  const holdsByPlan = new Map<string, VacationHold[]>();
  for (const hold of allHolds) {
    const existing = holdsByPlan.get(hold.servicePlanId) || [];
    existing.push(hold);
    holdsByPlan.set(hold.servicePlanId, existing);
  }

  const dayMap: Record<string, number> = {
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
    friday: 5, saturday: 6, sunday: 0,
  };

  let created = 0;
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  const dailyRouteCache = new Map<string, string>();

  async function getRouteIdForDate(dateStr: string): Promise<string> {
    if (dailyRouteCache.has(dateStr)) return dailyRouteCache.get(dateStr)!;
    const route = await storage.getOrCreateDailyRoute(companyId, dateStr);
    dailyRouteCache.set(dateStr, route.id);
    return route.id;
  }

  for (const plan of plans) {
    const planStart = plan.startDate ? new Date(plan.startDate + "T00:00:00Z") : start;
    let computedEndDate: Date | null = plan.endDate ? new Date(plan.endDate + "T00:00:00Z") : null;
    if (!computedEndDate && plan.endsAfterCount && plan.endsAfterUnit && plan.startDate) {
      const base = new Date(plan.startDate + "T00:00:00Z");
      switch (plan.endsAfterUnit) {
        case "days": base.setUTCDate(base.getUTCDate() + plan.endsAfterCount); break;
        case "weeks": base.setUTCDate(base.getUTCDate() + plan.endsAfterCount * 7); break;
        case "months": base.setUTCMonth(base.getUTCMonth() + plan.endsAfterCount); break;
        case "years": base.setUTCFullYear(base.getUTCFullYear() + plan.endsAfterCount); break;
      }
      computedEndDate = base;
    }
    const planEnd = computedEndDate || end;
    const effectiveStart = planStart > start ? planStart : start;
    const effectiveEnd = planEnd < end ? planEnd : end;

    if (plan.frequency === "monthly") {
      if (!plan.startDate) continue;
      const anchorDate = new Date(plan.startDate + "T00:00:00Z");
      const anchorYear = anchorDate.getUTCFullYear();
      const anchorMonth = anchorDate.getUTCMonth();
      const anchorDay = anchorDate.getUTCDate();
      let monthOffset = 0;
      while (true) {
        const targetYear = anchorYear + Math.floor((anchorMonth + monthOffset) / 12);
        const targetMonth = (anchorMonth + monthOffset) % 12;
        const lastDayOfMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
        const clampedDay = Math.min(anchorDay, lastDayOfMonth);
        const candidate = new Date(Date.UTC(targetYear, targetMonth, clampedDay));
        if (candidate > effectiveEnd) break;
        if (candidate >= effectiveStart) {
          const dateStr = candidate.toISOString().split("T")[0];
          const key = `${plan.id}_${dateStr}`;
          if (!existingKeys.has(key) && !isDateInVacationHold(dateStr, plan.id, holdsByPlan)) {
            const routeId = await getRouteIdForDate(dateStr);
            const newVisit = await storage.createVisit({
              companyId,
              servicePlanId: plan.id,
              propertyId: plan.propertyId,
              routeId,
              scheduledDate: dateStr,
              status: "scheduled",
            });
            if (newVisit) created++;
            existingKeys.add(key);
          }
        }
        monthOffset++;
        if (monthOffset > 1200) break;
      }
      continue;
    }

    if (plan.frequency === "onetime") {
      if (!plan.startDate) continue;
      const dateStr = plan.startDate;
      if (dateStr >= startDate && dateStr <= endDate) {
        const key = `${plan.id}_${dateStr}`;
        if (!existingKeys.has(key) && !isDateInVacationHold(dateStr, plan.id, holdsByPlan)) {
          const routeId = await getRouteIdForDate(dateStr);
          const newVisit = await storage.createVisit({
            companyId,
            servicePlanId: plan.id,
            propertyId: plan.propertyId,
            routeId,
            scheduledDate: dateStr,
            status: "scheduled",
          });
          if (newVisit) created++;
          existingKeys.add(key);
        }
      }
      continue;
    }

    if (!plan.dayOfWeek) continue;
    const targetDay = dayMap[plan.dayOfWeek];
    if (targetDay === undefined) continue;

    const current = new Date(effectiveStart);
    while (current <= effectiveEnd) {
      if (current.getUTCDay() === targetDay) {
        const dateStr = current.toISOString().split("T")[0];
        const key = `${plan.id}_${dateStr}`;

        if (!existingKeys.has(key) && !isDateInVacationHold(dateStr, plan.id, holdsByPlan)) {
          let shouldGenerate = true;

          if (plan.frequency === "biweekly") {
            const planStartDate = new Date(plan.startDate + "T00:00:00Z");
            const diffMs = current.getTime() - planStartDate.getTime();
            const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
            const diffWeeks = Math.floor(diffDays / 7);
            if (diffWeeks % 2 !== 0) shouldGenerate = false;
          }

          if (shouldGenerate) {
            const routeId = await getRouteIdForDate(dateStr);
            const newVisit = await storage.createVisit({
              companyId,
              servicePlanId: plan.id,
              propertyId: plan.propertyId,
              routeId,
              scheduledDate: dateStr,
              status: "scheduled",
            });
            if (newVisit) created++;
            existingKeys.add(key);
          }
        }

        if (plan.frequency === "weekly" || plan.frequency === "biweekly") {
          current.setUTCDate(current.getUTCDate() + 7);
          continue;
        }
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }
  }

  return created;
}
