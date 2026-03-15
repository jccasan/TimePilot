import { storage } from "../storage";
import { getCompanyToday } from "../utils/company-date";
import type { VacationHold } from "@shared/schema";

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
      endDate.setUTCDate(endDate.getUTCDate() + 7);

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
          message: `${created} visit${created !== 1 ? "s" : ""} created for the next 7 days (${startStr} to ${endStr}).`,
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
  const allPlans = await storage.getServicePlans(companyId, { isActive: true });
  const plans = allPlans.filter(p => planIds.includes(p.id) && !p.pausedAt && (!p.jobStatus || p.jobStatus === "active"));
  if (plans.length === 0) return 0;
  return generateVisitsFromPlans(companyId, plans, startDate, endDate, true);
}

export async function generateVisitsForCompany(companyId: string, startDate: string, endDate: string): Promise<number> {
  const allPlans = await storage.getServicePlans(companyId, { isActive: true });
  const plans = allPlans.filter(p => !p.pausedAt && (!p.jobStatus || p.jobStatus === "active"));
  return generateVisitsFromPlans(companyId, plans, startDate, endDate, false);
}

function isDateInVacationHold(dateStr: string, planId: string, holdsByPlan: Map<string, VacationHold[]>): boolean {
  const holds = holdsByPlan.get(planId);
  if (!holds || holds.length === 0) return false;
  for (const hold of holds) {
    if (dateStr >= hold.startDate && dateStr <= hold.endDate) return true;
  }
  return false;
}

async function generateVisitsFromPlans(companyId: string, plans: Awaited<ReturnType<typeof storage.getServicePlans>>, startDate: string, endDate: string, ignoreCancelled: boolean): Promise<number> {
  const existingVisits = await storage.getVisitsForDateRange(companyId, startDate, endDate);
  const existingKeys = new Set(
    existingVisits
      .filter((v) => !ignoreCancelled || v.status !== "cancelled")
      .map((v) => `${v.servicePlanId}_${v.scheduledDate}`)
  );

  const planIds = plans.map(p => p.id);
  const allHolds = await storage.getVacationHoldsForPlans(planIds);
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

  for (const plan of plans) {
    if (!plan.dayOfWeek) continue;
    const targetDay = dayMap[plan.dayOfWeek];
    if (targetDay === undefined) continue;

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
          } else if (plan.frequency === "monthly") {
            const planStartDate = new Date(plan.startDate + "T00:00:00Z");
            if (current.getUTCMonth() === planStartDate.getUTCMonth() && current.getUTCFullYear() === planStartDate.getUTCFullYear()) {
              shouldGenerate = true;
            } else {
              const firstOfMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
              let firstTargetDay = new Date(firstOfMonth);
              while (firstTargetDay.getUTCDay() !== targetDay) {
                firstTargetDay.setUTCDate(firstTargetDay.getUTCDate() + 1);
              }
              if (current.getTime() !== firstTargetDay.getTime()) shouldGenerate = false;
            }
          } else if (plan.frequency === "onetime") {
            if (dateStr !== plan.startDate) {
              shouldGenerate = false;
            }
          }

          if (shouldGenerate) {
            await storage.createVisit({
              companyId,
              servicePlanId: plan.id,
              propertyId: plan.propertyId,
              routeId: plan.routeId || null,
              scheduledDate: dateStr,
              status: "scheduled",
            });
            created++;
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
