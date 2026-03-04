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
          type: "info" as any,
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
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (const plan of plans) {
    if (!plan.dayOfWeek) continue;
    const targetDay = dayMap[plan.dayOfWeek];
    if (targetDay === undefined) continue;

    const planStart = plan.startDate ? new Date(plan.startDate) : start;
    const planEnd = plan.endDate ? new Date(plan.endDate) : end;
    const effectiveStart = planStart > start ? planStart : start;
    const effectiveEnd = planEnd < end ? planEnd : end;

    const current = new Date(effectiveStart);
    while (current <= effectiveEnd) {
      if (current.getDay() === targetDay) {
        const dateStr = current.toISOString().split("T")[0];
        const key = `${plan.id}_${dateStr}`;

        if (!existingKeys.has(key)) {
          let shouldGenerate = true;

          if (plan.frequency === "biweekly") {
            const planStartDate = new Date(plan.startDate);
            const diffDays = Math.floor((current.getTime() - planStartDate.getTime()) / (1000 * 60 * 60 * 24));
            const diffWeeks = Math.floor(diffDays / 7);
            if (diffWeeks % 2 !== 0) shouldGenerate = false;
          } else if (plan.frequency === "monthly") {
            const planStartDate = new Date(plan.startDate);
            if (current.getMonth() === planStartDate.getMonth() && current.getFullYear() === planStartDate.getFullYear()) {
              shouldGenerate = true;
            } else {
              const firstOfMonth = new Date(current.getFullYear(), current.getMonth(), 1);
              let firstTargetDay = new Date(firstOfMonth);
              while (firstTargetDay.getDay() !== targetDay) {
                firstTargetDay.setDate(firstTargetDay.getDate() + 1);
              }
              if (current.getTime() !== firstTargetDay.getTime()) shouldGenerate = false;
            }
          } else if (plan.frequency === "onetime") {
            const planStartDate = new Date(plan.startDate);
            if (current.toISOString().split("T")[0] !== planStartDate.toISOString().split("T")[0]) {
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
          current.setDate(current.getDate() + 7);
          continue;
        }
      }
      current.setDate(current.getDate() + 1);
    }
  }

  return created;
}
