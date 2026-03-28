import { storage } from "../storage";
import { getCompanyToday } from "../utils/company-date";
import type { VacationHold, JobWithAgreement } from "@shared/schema";

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
  const allJobs = await storage.getJobsWithAgreements(companyId, { isActive: true });
  const matchingJobs = allJobs.filter(j =>
    j.servicePlanId && planIds.includes(j.servicePlanId) &&
    !j.agreementPausedAt &&
    (!j.jobStatus || j.jobStatus === "active")
  );
  if (matchingJobs.length === 0) return 0;
  return generateVisitsFromJobs(companyId, matchingJobs, startDate, endDate, true);
}

export async function generateVisitsForCompany(companyId: string, startDate: string, endDate: string): Promise<number> {
  const allJobs = await storage.getJobsWithAgreements(companyId, { isActive: true });
  const activeJobs = allJobs.filter(j => !j.agreementPausedAt && (!j.jobStatus || j.jobStatus === "active"));
  return generateVisitsFromJobs(companyId, activeJobs, startDate, endDate, false);
}

function isDateInVacationHold(dateStr: string, holdKey: string, holdsByKey: Map<string, VacationHold[]>): boolean {
  const holds = holdsByKey.get(holdKey);
  if (!holds || holds.length === 0) return false;
  for (const hold of holds) {
    if (dateStr >= hold.startDate && dateStr <= hold.endDate) return true;
  }
  return false;
}

async function generateVisitsFromJobs(companyId: string, jobsWithAgreements: JobWithAgreement[], startDate: string, endDate: string, ignoreCancelled: boolean): Promise<number> {
  const existingVisits = await storage.getVisitsForDateRange(companyId, startDate, endDate);
  const existingKeys = new Set(
    existingVisits
      .filter((v) => !ignoreCancelled || v.status !== "cancelled")
      .map((v) => `${v.servicePlanId}_${v.scheduledDate}`)
  );

  const servicePlanIds = jobsWithAgreements
    .map(j => j.servicePlanId)
    .filter((id): id is string => id !== null);
  const allHolds = servicePlanIds.length > 0
    ? await storage.getVacationHoldsForPlans(servicePlanIds)
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

  for (const job of jobsWithAgreements) {
    const spId = job.servicePlanId || job.id;
    const planStart = job.startDate ? new Date(job.startDate + "T00:00:00Z") : start;
    let computedEndDate: Date | null = job.endDate ? new Date(job.endDate + "T00:00:00Z") : null;
    if (!computedEndDate && job.endsAfterCount && job.endsAfterUnit && job.startDate) {
      const base = new Date(job.startDate + "T00:00:00Z");
      switch (job.endsAfterUnit) {
        case "days": base.setUTCDate(base.getUTCDate() + job.endsAfterCount); break;
        case "weeks": base.setUTCDate(base.getUTCDate() + job.endsAfterCount * 7); break;
        case "months": base.setUTCMonth(base.getUTCMonth() + job.endsAfterCount); break;
        case "years": base.setUTCFullYear(base.getUTCFullYear() + job.endsAfterCount); break;
      }
      computedEndDate = base;
    }
    const planEnd = computedEndDate || end;
    const effectiveStart = planStart > start ? planStart : start;
    const effectiveEnd = planEnd < end ? planEnd : end;

    if (job.frequency === "monthly") {
      if (!job.startDate) continue;
      const anchorDate = new Date(job.startDate + "T00:00:00Z");
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
          const key = `${spId}_${dateStr}`;
          if (!existingKeys.has(key) && !isDateInVacationHold(dateStr, spId, holdsByPlan)) {
            if (!job.servicePlanId) {
              console.warn(`[auto-visits] Job ${job.id} missing servicePlanId, skipping visit for ${dateStr}`);
              continue;
            }
            await storage.createVisit({
              companyId,
              servicePlanId: job.servicePlanId,
              jobId: job.id,
              propertyId: job.propertyId,
              routeId: job.routeId || null,
              scheduledDate: dateStr,
              status: "scheduled",
            });
            created++;
            existingKeys.add(key);
          }
        }
        monthOffset++;
        if (monthOffset > 1200) break;
      }
      continue;
    }

    if (!job.dayOfWeek) continue;
    const targetDay = dayMap[job.dayOfWeek];
    if (targetDay === undefined) continue;

    const current = new Date(effectiveStart);
    while (current <= effectiveEnd) {
      if (current.getUTCDay() === targetDay) {
        const dateStr = current.toISOString().split("T")[0];
        const key = `${spId}_${dateStr}`;

        if (!existingKeys.has(key) && !isDateInVacationHold(dateStr, spId, holdsByPlan)) {
          let shouldGenerate = true;

          if (job.frequency === "biweekly") {
            const planStartDate = new Date(job.startDate + "T00:00:00Z");
            const diffMs = current.getTime() - planStartDate.getTime();
            const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
            const diffWeeks = Math.floor(diffDays / 7);
            if (diffWeeks % 2 !== 0) shouldGenerate = false;
          } else if (job.frequency === "onetime") {
            if (dateStr !== job.startDate) {
              shouldGenerate = false;
            }
          }

          if (shouldGenerate) {
            if (!job.servicePlanId) {
              console.warn(`[auto-visits] Job ${job.id} missing servicePlanId, skipping visit for ${dateStr}`);
              continue;
            }
            await storage.createVisit({
              companyId,
              servicePlanId: job.servicePlanId,
              jobId: job.id,
              propertyId: job.propertyId,
              routeId: job.routeId || null,
              scheduledDate: dateStr,
              status: "scheduled",
            });
            created++;
            existingKeys.add(key);
          }
        }

        if (job.frequency === "weekly" || job.frequency === "biweekly") {
          current.setUTCDate(current.getUTCDate() + 7);
          continue;
        }
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }
  }

  return created;
}
