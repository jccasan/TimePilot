import { storage } from "../storage";
import { db } from "../db";
import { visits } from "@shared/schema";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { getCompanyToday } from "../utils/company-date";
import { upsertHealthCheckResult } from "./system-health-check";
import { calculateProratedAmount, monthlyRateForPlan, isProratable } from "../services/proration";
import { acquireJobLock, releaseJobLock } from "../lib/job-lock";

const AUTO_INVOICE_LOCK = "auto_invoice";
const AUTO_INVOICE_TTL_SECONDS = 23 * 60 * 60; // 23 hours — just under the 24-hour interval

export async function runAutoInvoice() {
  const acquired = await acquireJobLock(AUTO_INVOICE_LOCK, AUTO_INVOICE_TTL_SECONDS);
  if (!acquired) {
    console.log(
      `[auto-invoice] Lock not acquired — another instance is already running. Skipping.`
    );
    return { totalInvoicesCreated: 0, errors: 0, skipped: true };
  }

  console.log(`[auto-invoice] Starting auto-invoice run`);

  let totalInvoicesCreated = 0;
  let errors = 0;

  try {
    const allCompanies = await storage.getAllCompanies();

    for (const company of allCompanies) {
      try {
        const tz = company.timezone || "America/New_York";
        const companyToday = getCompanyToday(tz);

        const missedDates = getMissedDates(company.lastAutoInvoiceRun, companyToday);
        const datesToProcess = missedDates.length > 0 ? missedDates : [companyToday];

        for (const dateStr of datesToProcess) {
          const result = await processCompanyAutoInvoice(company.id, dateStr, tz);
          totalInvoicesCreated += result.invoicesCreated;
        }

        await storage.updateCompany(company.id, { lastAutoInvoiceRun: companyToday });
      } catch (err) {
        errors++;
        console.error(`[auto-invoice] Error processing company ${company.id}:`, err);
      }
    }

    const msg = `Completed: ${totalInvoicesCreated} draft invoices created, ${errors} company errors`;
    console.log(`[auto-invoice] ${msg}`);
    await upsertHealthCheckResult(
      "job_auto_invoice",
      errors === 0 ? "pass" : "warn",
      "high",
      msg
    ).catch(() => {});
  } finally {
    await releaseJobLock(AUTO_INVOICE_LOCK);
  }

  return { totalInvoicesCreated, errors };
}

function getMissedDates(lastRun: string | null | undefined, today: string): string[] {
  if (!lastRun) return [today];
  const dates: string[] = [];
  const current = new Date(lastRun + "T00:00:00Z");
  current.setUTCDate(current.getUTCDate() + 1);
  const end = new Date(today + "T00:00:00Z");

  while (current <= end) {
    dates.push(current.toISOString().split("T")[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  if (dates.length > 31) {
    console.warn(
      `[auto-invoice] Large catch-up window: ${dates.length} missed days, processing all`
    );
  }

  return dates;
}

async function processCompanyAutoInvoice(companyId: string, todayStr: string, _timezone: string) {
  let invoicesCreated = 0;

  await generateProratedInvoicesForCompany(companyId);

  const allActiveJobs = await storage.getJobsWithAgreements(companyId, { isActive: true });
  const activeJobs = allActiveJobs.filter((j) => !j.agreementPausedAt && !j.isStopOnly);
  if (activeJobs.length === 0) return { invoicesCreated };

  const contactIdSet = new Set(activeJobs.map((j) => j.contactId));
  const contactIds = Array.from(contactIdSet);

  for (const contactId of contactIds) {
    try {
      const contact = await storage.getContact(contactId, companyId);
      if (!contact) continue;
      if (contact.status !== "active") continue;
      if (contact.autoInvoiceEnabled === false) continue;

      const contactJobs = activeJobs.filter((j) => j.contactId === contactId);

      const lookbackStartDate = getLookbackStartDate(
        todayStr,
        contact.invoiceFrequency || "per_service"
      );

      const allUninvoicedVisits = await storage.getUninvoicedCompletedVisits(
        companyId,
        contactId,
        lookbackStartDate,
        todayStr
      );

      const activeSpIds = new Set(contactJobs.map((j) => j.servicePlanId).filter(Boolean));

      // For per_month contacts: load proratedThrough per plan and exclude visits
      // that fall within a plan's prorated first-month window. Visits in that window
      // are already covered by the flat prorated invoice and must not be billed again.
      // This filter is intentionally skipped for per_service / per_week contacts so
      // their normal visit-based invoicing is never affected by the prorated_through marker.
      const activePlanIds = Array.from(activeSpIds).filter(Boolean) as string[];
      const planProratedMap = new Map<string, string | null>();
      const isMonthlyBilled = (contact.invoiceFrequency || "per_service") === "per_month";
      if (isMonthlyBilled && activePlanIds.length > 0) {
        const plans = await storage.getServicePlans(companyId, { contactId });
        for (const sp of plans) {
          planProratedMap.set(sp.id, sp.proratedThrough ?? null);
        }
      }

      const uninvoicedVisits = allUninvoicedVisits.filter((v) => {
        if (!activeSpIds.has(v.servicePlanId)) return false;
        if (isMonthlyBilled) {
          const proratedThrough = planProratedMap.get(v.servicePlanId ?? "");
          if (proratedThrough && v.scheduledDate <= proratedThrough) return false;
        }
        return true;
      });

      if (uninvoicedVisits.length === 0) continue;

      const shouldInvoice = shouldGenerateInvoice(
        contact.invoiceFrequency || "per_service",
        contact.invoiceTiming || "after_service",
        todayStr
      );

      if (!shouldInvoice) continue;

      const jobBySpId = new Map(contactJobs.map((j) => [j.servicePlanId, j]));

      const jobAddOnsMap = new Map<string, { name: string; price: string }[]>();
      for (const job of contactJobs) {
        const addOns = await storage.getJobAddOns(job.id);
        jobAddOnsMap.set(
          job.id,
          addOns.filter((a) => a.isActive).map((a) => ({ name: a.name, price: a.price }))
        );
      }

      const lineItems: {
        visitId: string;
        description: string;
        quantity: number;
        unitPrice: string;
        total: string;
      }[] = [];
      for (const visit of uninvoicedVisits) {
        const job = jobBySpId.get(visit.servicePlanId);
        const unitPrice = job ? job.pricePerVisit : "0";
        lineItems.push({
          visitId: visit.id,
          description: `Service on ${visit.scheduledDate}`,
          quantity: 1,
          unitPrice: unitPrice.toString(),
          total: unitPrice.toString(),
        });
        if (job) {
          const addOns = jobAddOnsMap.get(job.id) || [];
          for (const addon of addOns) {
            lineItems.push({
              visitId: visit.id,
              description: `${addon.name} on ${visit.scheduledDate}`,
              quantity: 1,
              unitPrice: addon.price,
              total: addon.price,
            });
          }
        }
      }

      const subtotal = lineItems.reduce((sum, item) => sum + parseFloat(item.total), 0);
      if (subtotal <= 0) continue;

      const invoiceNumber = await storage.getNextInvoiceNumber(companyId);

      const dueDate = new Date(todayStr);
      dueDate.setDate(dueDate.getDate() + 30);
      const dueDateStr = dueDate.toISOString().split("T")[0];

      const invoice = await storage.createInvoiceWithLineItems(
        {
          companyId,
          contactId,
          invoiceNumber,
          dueDate: dueDateStr,
          subtotal: subtotal.toFixed(2),
          tax: "0",
          total: subtotal.toFixed(2),
          status: "draft",
          autoGenerated: true,
        },
        lineItems
      );

      for (const visit of uninvoicedVisits) {
        await storage.updateVisit(visit.id, companyId, { invoiceId: invoice.id });
      }

      invoicesCreated++;

      storage
        .createNotification({
          companyId,
          type: "general",
          title: "Draft Invoice Created",
          message: `Draft invoice ${invoiceNumber} for $${subtotal.toFixed(2)} created for ${contact.firstName} ${contact.lastName} — review and send when ready`,
          isRead: false,
          linkUrl: `/invoices`,
        })
        .catch(console.error);
    } catch (contactErr) {
      console.error(
        `[auto-invoice] Error processing contact ${contactId} in company ${companyId}:`,
        contactErr
      );
    }
  }

  return { invoicesCreated };
}

function getLookbackStartDate(todayStr: string, frequency: string): string {
  const today = new Date(todayStr);
  switch (frequency) {
    case "per_week": {
      const start = new Date(today);
      start.setDate(start.getDate() - 7);
      return start.toISOString().split("T")[0];
    }
    case "per_month": {
      const start = new Date(today);
      start.setMonth(start.getMonth() - 1);
      return start.toISOString().split("T")[0];
    }
    case "per_service":
    default: {
      const start = new Date(today);
      start.setDate(start.getDate() - 90);
      return start.toISOString().split("T")[0];
    }
  }
}

export async function generateProratedInvoiceForPlan(
  companyId: string,
  servicePlanId: string,
  contactId: string,
  planStartDate: string,
  planFrequency: string,
  pricePerVisit: string
): Promise<{ invoiceId: string; amount: number; label: string } | null> {
  // Idempotency guard: if proratedThrough is already set on the plan, a prorated
  // invoice was already issued — do not create a second one.
  const allPlansForContact = await storage.getServicePlans(companyId, { contactId });
  const matchingPlan = allPlansForContact.find((sp) => sp.id === servicePlanId);
  if (matchingPlan?.proratedThrough) return null;

  const contact = await storage.getContact(contactId, companyId);
  if (!contact) return null;
  if ((contact.invoiceFrequency || "per_service") !== "per_month") return null;
  if (!isProratable(planStartDate, contact.invoiceFrequency || "per_service")) return null;

  const monthlyRate = monthlyRateForPlan(pricePerVisit, planFrequency);
  if (monthlyRate <= 0) return null;

  const proration = calculateProratedAmount(planStartDate, monthlyRate);

  const invoiceNumber = await storage.getNextInvoiceNumber(companyId);
  const dueDate = proration.proratedThrough;

  const invoice = await storage.createInvoiceWithLineItems(
    {
      companyId,
      contactId,
      invoiceNumber,
      dueDate,
      subtotal: proration.amount.toFixed(2),
      tax: "0",
      total: proration.amount.toFixed(2),
      status: "draft",
      autoGenerated: true,
      source: "prorated",
      issuedDate: planStartDate,
    },
    [
      {
        description: proration.label,
        quantity: 1,
        unitPrice: proration.amount.toFixed(2),
        total: proration.amount.toFixed(2),
        visitId: null,
      },
    ]
  );

  await storage.updateServicePlan(servicePlanId, companyId, {
    proratedThrough: proration.proratedThrough,
  });

  // Claim completed visits within the exact prorated window [planStartDate, proratedThrough]
  // so the nightly per_month invoice run does not bill them again on the 1st.
  // Lower bound (>= planStartDate) prevents accidentally claiming stray pre-start visits.
  const proratedPeriodVisits = await db
    .select({ id: visits.id })
    .from(visits)
    .where(
      and(
        eq(visits.servicePlanId, servicePlanId),
        eq(visits.companyId, companyId),
        eq(visits.status, "completed"),
        lte(visits.scheduledDate, proration.proratedThrough),
        gte(visits.scheduledDate, planStartDate),
        isNull(visits.invoiceId)
      )
    );

  for (const v of proratedPeriodVisits) {
    await storage.updateVisit(v.id, companyId, { invoiceId: invoice.id });
  }

  return { invoiceId: invoice.id, amount: proration.amount, label: proration.label };
}

async function generateProratedInvoicesForCompany(companyId: string): Promise<number> {
  let count = 0;
  try {
    const now = new Date();
    // Only consider plans that started in the current calendar month.
    // Plans from prior months are backfilled by the startup migration with a
    // proratedThrough value so they are never touched here.
    const firstOfCurrentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const allPlans = await storage.getServicePlans(companyId, { isActive: true });
    const unprorated = allPlans.filter((sp) => {
      if (!sp.startDate || sp.proratedThrough) return false;
      if (!isProratable(sp.startDate, "per_month")) return false;
      // Guard: plan must have started in the current calendar month
      const startObj = new Date(sp.startDate + "T00:00:00Z");
      return startObj >= firstOfCurrentMonth;
    });
    if (unprorated.length === 0) return 0;

    for (const sp of unprorated) {
      try {
        const contact = await storage.getContact(sp.contactId, companyId);
        if (!contact || (contact.invoiceFrequency || "per_service") !== "per_month") continue;
        if (contact.autoInvoiceEnabled === false) continue;
        // Skip plans whose contacts are deposit_pending — the balance invoice will be created
        // by the billing onboarding service when the deposit invoice is paid.
        if ((contact.billingOnboardingStage ?? "none") === "deposit_pending") continue;

        const result = await generateProratedInvoiceForPlan(
          companyId,
          sp.id,
          sp.contactId,
          sp.startDate,
          sp.frequency,
          sp.pricePerVisit
        );
        if (result) {
          count++;
          storage
            .createNotification({
              companyId,
              type: "general",
              title: "Prorated Invoice Created",
              message: `${result.label} — $${result.amount.toFixed(2)} draft invoice created for ${contact.firstName} ${contact.lastName}`,
              isRead: false,
              linkUrl: `/invoices`,
            })
            .catch(console.error);
        }
      } catch (planErr) {
        console.error(`[auto-invoice] Proration error for plan ${sp.id}:`, planErr);
      }
    }
  } catch (err) {
    console.error(`[auto-invoice] Proration sweep error for company ${companyId}:`, err);
  }
  return count;
}

function shouldGenerateInvoice(frequency: string, timing: string, todayStr: string): boolean {
  if (timing === "before_service") {
    return true;
  }

  const today = new Date(todayStr + "T00:00:00Z");

  switch (frequency) {
    case "per_service":
      return true;
    case "per_week":
      return today.getUTCDay() === 0;
    case "per_month":
      return today.getUTCDate() === 1;
    default:
      return true;
  }
}
