import { storage } from "../storage";
import { db } from "../db";
import { invoices } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { getCompanyToday } from "../utils/company-date";
import { upsertHealthCheckResult } from "./system-health-check";
import { calculateProratedAmount, monthlyRateForPlan } from "../services/proration";
import { autoChargeInvoiceByCardOnFile } from "../services/invoice-charge";
import { acquireJobLock, releaseJobLock } from "../lib/job-lock";

const PREPAY_LOCK = "prepay_billing";
const PREPAY_TTL_SECONDS = 23 * 60 * 60; // 23 hours — just under the 24-hour interval

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Beginning-of-month prepay billing.
 *
 * Runs daily. For every company whose chargeTiming is "beginning_of_month":
 *  1. A proration sweep generates a prorated first-month invoice for any plan
 *     that started in the current month and has not been prorated yet (covers
 *     mid-month signups even if the synchronous signup hook was missed).
 *  2. On the 1st of the month it generates one full-month prepay invoice per
 *     client for the calendar month being entered (1st → last day). A per-month
 *     guard (companies.lastPrepayBillingMonth) ensures this fires once per month
 *     and never double-fires on a restart within the same month.
 *
 * If a client has card-on-file auto-pay enabled, generated invoices are charged
 * automatically.
 */
export async function runPrepayBilling() {
  const acquired = await acquireJobLock(PREPAY_LOCK, PREPAY_TTL_SECONDS);
  if (!acquired) {
    console.log(`[prepay-billing] Lock not acquired — another instance is running. Skipping.`);
    return { totalInvoicesCreated: 0, errors: 0, skipped: true };
  }

  console.log(`[prepay-billing] Starting run`);
  let totalInvoicesCreated = 0;
  let errors = 0;

  try {
    const allCompanies = await storage.getAllCompanies();
    for (const company of allCompanies) {
      if (company.chargeTiming !== "beginning_of_month") continue;
      try {
        const tz = company.timezone || "America/New_York";
        const companyToday = getCompanyToday(tz); // YYYY-MM-DD in company tz
        const day = parseInt(companyToday.slice(8, 10), 10);
        const currentMonth = companyToday.slice(0, 7); // YYYY-MM

        // 1) Mid-month signup proration (idempotent via plan.proratedThrough).
        totalInvoicesCreated += await generatePrepayProrationSweep(company.id, currentMonth);

        // 2) Full-month charge on the 1st, guarded to once per calendar month.
        if (day === 1 && company.lastPrepayBillingMonth !== currentMonth) {
          totalInvoicesCreated += await generateFullMonthInvoices(company.id, companyToday);
          await storage.updateCompany(company.id, { lastPrepayBillingMonth: currentMonth });
        }
      } catch (err) {
        errors++;
        console.error(`[prepay-billing] Error processing company ${company.id}:`, err);
      }
    }

    const msg = `Completed: ${totalInvoicesCreated} prepay invoices created, ${errors} company errors`;
    console.log(`[prepay-billing] ${msg}`);
    await upsertHealthCheckResult(
      "job_prepay_billing",
      errors === 0 ? "pass" : "warn",
      "high",
      msg
    ).catch(() => {});
  } finally {
    await releaseJobLock(PREPAY_LOCK);
  }

  return { totalInvoicesCreated, errors };
}

function lastDayOfMonth(year: number, monthIdx0: number): number {
  return new Date(Date.UTC(year, monthIdx0 + 1, 0)).getUTCDate();
}

/**
 * Generate a prorated first-month invoice for a single plan, charging the
 * remaining days of the plan's start month. Idempotent: a plan that already has
 * proratedThrough set is skipped. Exposed for the synchronous signup hook.
 */
export async function generatePrepayProrationForPlan(
  companyId: string,
  servicePlanId: string
): Promise<number> {
  const company = await storage.getCompany(companyId);
  if (!company || company.chargeTiming !== "beginning_of_month") return 0;

  const plans = await storage.getServicePlans(companyId, {});
  const plan = plans.find((p) => p.id === servicePlanId);
  if (!plan || !plan.isActive || plan.pausedAt || plan.isStopOnly) return 0;
  if (plan.proratedThrough) return 0; // already prorated
  if (!plan.startDate) return 0;

  const contact = await storage.getContact(plan.contactId, companyId);
  if (!contact || contact.status !== "active") return 0;
  if (contact.autoInvoiceEnabled === false) return 0;

  const monthlyRate = monthlyRateForPlan(plan.pricePerVisit, plan.frequency);
  if (monthlyRate <= 0) return 0;

  const proration = calculateProratedAmount(plan.startDate, monthlyRate);

  const invoiceNumber = await storage.getNextInvoiceNumber(companyId);
  const invoice = await storage.createInvoiceWithLineItems(
    {
      companyId,
      contactId: plan.contactId,
      invoiceNumber,
      dueDate: plan.startDate,
      subtotal: proration.amount.toFixed(2),
      tax: "0",
      total: proration.amount.toFixed(2),
      status: "draft",
      autoGenerated: true,
      source: "prepay_prorated",
      issuedDate: plan.startDate,
      notes: `Prepaid (prorated): ${proration.label}`,
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

  // Mark the plan so neither this sweep nor the full-month run bills the same
  // first-month window again. proratedThrough = last day of the start month.
  await storage.updateServicePlan(servicePlanId, companyId, {
    proratedThrough: proration.proratedThrough,
  });

  storage
    .createNotification({
      companyId,
      type: "general",
      title: "Prepaid (Prorated) Invoice Created",
      message: `${proration.label} — $${proration.amount.toFixed(2)} for ${contact.firstName} ${contact.lastName}`,
      isRead: false,
      linkUrl: `/invoices`,
    })
    .catch(console.error);

  await maybeAutoCharge(invoice.id, companyId, contact);
  return 1;
}

async function generatePrepayProrationSweep(companyId: string, currentMonth: string): Promise<number> {
  let count = 0;
  const plans = await storage.getServicePlans(companyId, { isActive: true });
  for (const plan of plans) {
    if (plan.pausedAt || plan.isStopOnly) continue;
    if (plan.proratedThrough || !plan.startDate) continue;
    // Only prorate plans that started in the current calendar month.
    if (plan.startDate.slice(0, 7) !== currentMonth) continue;
    try {
      count += await generatePrepayProrationForPlan(companyId, plan.id);
    } catch (err) {
      console.error(`[prepay-billing] Proration error for plan ${plan.id}:`, err);
    }
  }
  return count;
}

async function generateFullMonthInvoices(companyId: string, companyToday: string): Promise<number> {
  let count = 0;
  const year = parseInt(companyToday.slice(0, 4), 10);
  const monthIdx0 = parseInt(companyToday.slice(5, 7), 10) - 1;
  const lastDay = lastDayOfMonth(year, monthIdx0);
  const firstStr = `${companyToday.slice(0, 7)}-01`;
  const lastStr = `${companyToday.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
  const periodLabel = `${MONTHS[monthIdx0]} 1–${lastDay}, ${year}`;

  const plans = await storage.getServicePlans(companyId, { isActive: true });
  const billablePlans = plans.filter((p) => {
    if (p.pausedAt || p.isStopOnly) return false;
    // Skip plans already covered for this month by a first-month proration
    // (e.g. a signup earlier this month, or a 1st-of-month signup that was
    // prorated to a full month). proratedThrough >= last day of this month.
    if (p.proratedThrough && p.proratedThrough >= lastStr) return false;
    return true;
  });

  // One invoice per client.
  const byContact = new Map<string, typeof billablePlans>();
  for (const plan of billablePlans) {
    const list = byContact.get(plan.contactId) || [];
    list.push(plan);
    byContact.set(plan.contactId, list);
  }

  for (const [contactId, contactPlans] of byContact) {
    try {
      const contact = await storage.getContact(contactId, companyId);
      if (!contact || contact.status !== "active") continue;
      if (contact.autoInvoiceEnabled === false) continue;

      // Per-contact idempotency: never create a second prepay invoice for the
      // same client and month (guards partial-failure retries within a month).
      const existing = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.companyId, companyId),
            eq(invoices.contactId, contactId),
            eq(invoices.source, "prepay"),
            eq(invoices.issuedDate, firstStr)
          )
        );
      if (existing.length > 0) continue;

      const lineItems = contactPlans
        .map((plan) => {
          const monthlyRate = monthlyRateForPlan(plan.pricePerVisit, plan.frequency);
          return { plan, monthlyRate };
        })
        .filter((x) => x.monthlyRate > 0)
        .map(({ plan, monthlyRate }) => ({
          description: `${plan.serviceName || "Recurring service"} — ${periodLabel}`,
          quantity: 1,
          unitPrice: monthlyRate.toFixed(2),
          total: monthlyRate.toFixed(2),
          visitId: null,
        }));

      if (lineItems.length === 0) continue;
      const subtotal = lineItems.reduce((sum, li) => sum + parseFloat(li.total), 0);
      if (subtotal <= 0) continue;

      const invoiceNumber = await storage.getNextInvoiceNumber(companyId);
      const invoice = await storage.createInvoiceWithLineItems(
        {
          companyId,
          contactId,
          invoiceNumber,
          dueDate: firstStr,
          subtotal: subtotal.toFixed(2),
          tax: "0",
          total: subtotal.toFixed(2),
          status: "draft",
          autoGenerated: true,
          source: "prepay",
          issuedDate: firstStr,
          notes: `Prepaid service: ${periodLabel}`,
        },
        lineItems
      );
      count++;

      storage
        .createNotification({
          companyId,
          type: "general",
          title: "Prepaid Monthly Invoice Created",
          message: `${periodLabel} — $${subtotal.toFixed(2)} for ${contact.firstName} ${contact.lastName}`,
          isRead: false,
          linkUrl: `/invoices`,
        })
        .catch(console.error);

      await maybeAutoCharge(invoice.id, companyId, contact);
    } catch (err) {
      console.error(`[prepay-billing] Error billing contact ${contactId}:`, err);
    }
  }

  return count;
}

async function maybeAutoCharge(
  invoiceId: string,
  companyId: string,
  contact: { autoPayEnabled?: boolean | null; stripeCustomerId?: string | null }
): Promise<void> {
  if (!contact.autoPayEnabled || !contact.stripeCustomerId) return;
  try {
    await autoChargeInvoiceByCardOnFile(invoiceId, companyId);
  } catch (err) {
    console.error(`[prepay-billing] Auto-charge failed for invoice ${invoiceId}:`, err);
  }
}
