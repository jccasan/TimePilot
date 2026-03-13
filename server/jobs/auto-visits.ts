import { storage } from "../storage";

export async function runAutoVisits() {
  console.log("[auto-visits] Starting auto visit generation...");

  const allCompanies = await storage.getAllCompanies();
  let totalCreated = 0;
  let companiesProcessed = 0;
  let errors = 0;

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() + 1);
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 7);

  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];

  for (const company of allCompanies) {
    if (!company.autoVisitsEnabled) continue;

    try {
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

export async function generateVisitsForCompany(companyId: string, startDate: string, endDate: string): Promise<number> {
  const plans = await storage.getServicePlans(companyId, { isActive: true });
  const existingVisits = await storage.getVisitsForDateRange(companyId, startDate, endDate);
  const existingKeys = new Set(
    existingVisits.map((v) => `${v.servicePlanId}_${v.scheduledDate}`)
  );

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
    const planEnd = plan.endDate ? new Date(plan.endDate + "T00:00:00Z") : end;
    const effectiveStart = planStart > start ? planStart : start;
    const effectiveEnd = planEnd < end ? planEnd : end;

    const current = new Date(effectiveStart);
    while (current <= effectiveEnd) {
      if (current.getUTCDay() === targetDay) {
        const dateStr = current.toISOString().split("T")[0];
        const key = `${plan.id}_${dateStr}`;

        if (!existingKeys.has(key)) {
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
