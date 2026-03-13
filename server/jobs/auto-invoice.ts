import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { companies, contacts, servicePlans, visits } from "@shared/schema";
import { storage } from "../storage";
import {
  isStripeConfigured,
  chargeInvoiceAutomatically,
  createStripeCustomer,
} from "../services/stripe";
import { getCompanyToday, getCompanyDayOfWeek, getCompanyDayOfMonth } from "../utils/company-date";

export async function runAutoInvoice() {
  console.log(`[auto-invoice] Starting auto-invoice run`);

  const allCompanies = await storage.getAllCompanies();
  let totalInvoicesCreated = 0;
  let totalChargesAttempted = 0;
  let totalChargesSucceeded = 0;
  let errors = 0;

  for (const company of allCompanies) {
    try {
      const tz = company.timezone || "America/New_York";
      const companyToday = getCompanyToday(tz);

      const missedDates = getMissedDates(company.lastAutoInvoiceRun, companyToday);
      const datesToProcess = missedDates.length > 0 ? missedDates : [companyToday];

      for (const dateStr of datesToProcess) {
        const result = await processCompanyAutoInvoice(company.id, dateStr, tz);
        totalInvoicesCreated += result.invoicesCreated;
        totalChargesAttempted += result.chargesAttempted;
        totalChargesSucceeded += result.chargesSucceeded;
      }

      await storage.updateCompany(company.id, { lastAutoInvoiceRun: companyToday });
    } catch (err) {
      errors++;
      console.error(`[auto-invoice] Error processing company ${company.id}:`, err);
    }
  }

  console.log(
    `[auto-invoice] Completed: ${totalInvoicesCreated} invoices created, ` +
    `${totalChargesSucceeded}/${totalChargesAttempted} charges succeeded, ` +
    `${errors} company errors`
  );

  return { totalInvoicesCreated, totalChargesAttempted, totalChargesSucceeded, errors };
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
    console.warn(`[auto-invoice] Large catch-up window: ${dates.length} missed days, processing all`);
  }

  return dates;
}

async function processCompanyAutoInvoice(companyId: string, todayStr: string, timezone: string) {
  let invoicesCreated = 0;
  let chargesAttempted = 0;
  let chargesSucceeded = 0;

  const allActiveServicePlans = await storage.getServicePlans(companyId, { isActive: true });
  const activeServicePlans = allActiveServicePlans.filter(sp => !sp.pausedAt);
  if (activeServicePlans.length === 0) return { invoicesCreated, chargesAttempted, chargesSucceeded };

  const contactIdSet = new Set(activeServicePlans.map(sp => sp.contactId));
  const contactIds = Array.from(contactIdSet);

  const company = await storage.getCompany(companyId);

  for (const contactId of contactIds) {
    try {
      const contact = await storage.getContact(contactId, companyId);
      if (!contact) continue;
      if (contact.status !== "active") continue;

      const contactPlans = activeServicePlans.filter(sp => sp.contactId === contactId);

      const lookbackStartDate = getLookbackStartDate(todayStr, contact.invoiceFrequency || "per_service");

      const allUninvoicedVisits = await storage.getUninvoicedCompletedVisits(
        companyId,
        contactId,
        lookbackStartDate,
        todayStr
      );

      const activePlanIds = new Set(contactPlans.map(p => p.id));
      const uninvoicedVisits = allUninvoicedVisits.filter(v => activePlanIds.has(v.servicePlanId));

      if (uninvoicedVisits.length === 0) continue;

      const shouldInvoice = shouldGenerateInvoice(
        contact.invoiceFrequency || "per_service",
        contact.invoiceTiming || "after_service",
        todayStr
      );

      if (!shouldInvoice) continue;

      const planMap = new Map(contactPlans.map(p => [p.id, p]));

      const planAddOnsMap = new Map<string, { name: string; price: string }[]>();
      for (const plan of contactPlans) {
        const addOns = await storage.getServicePlanAddOns(plan.id);
        planAddOnsMap.set(plan.id, addOns.filter(a => a.isActive).map(a => ({ name: a.name, price: a.price })));
      }

      const lineItems: { visitId: string; description: string; quantity: number; unitPrice: string; total: string }[] = [];
      for (const visit of uninvoicedVisits) {
        const plan = planMap.get(visit.servicePlanId);
        const unitPrice = plan ? plan.pricePerVisit : "0";
        lineItems.push({
          visitId: visit.id,
          description: `Service on ${visit.scheduledDate}`,
          quantity: 1,
          unitPrice: unitPrice.toString(),
          total: unitPrice.toString(),
        });
        const addOns = planAddOnsMap.get(visit.servicePlanId) || [];
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
          status: "pending",
          autoGenerated: true,
        },
        lineItems
      );

      for (const visit of uninvoicedVisits) {
        await storage.updateVisit(visit.id, { invoiceId: invoice.id });
      }

      invoicesCreated++;

      storage.createNotification({
        companyId,
        type: "invoice_paid",
        title: "Auto-Invoice Created",
        message: `Invoice ${invoiceNumber} for $${subtotal.toFixed(2)} was auto-generated for ${contact.firstName} ${contact.lastName}`,
        isRead: false,
        linkUrl: `/invoices`,
      }).catch(console.error);

      if (
        contact.autoPayEnabled &&
        !contact.stripeCustomerId &&
        contact.email &&
        isStripeConfigured()
      ) {
        try {
          const stripeId = await createStripeCustomer({
            email: contact.email,
            name: `${contact.firstName} ${contact.lastName}`.trim(),
            phone: contact.phone || undefined,
            metadata: { contactId, companyId },
          });
          await storage.updateContact(contactId, { stripeCustomerId: stripeId });
          contact.stripeCustomerId = stripeId;
          console.log(`[auto-invoice] Created Stripe customer for ${contact.email}`);
        } catch (stripeErr) {
          console.error(`[auto-invoice] Failed to create Stripe customer for ${contactId}:`, stripeErr);
        }
      }

      if (
        contact.autoPayEnabled &&
        contact.stripeCustomerId &&
        isStripeConfigured()
      ) {
        chargesAttempted++;
        try {
          const result = await chargeInvoiceAutomatically({
            customerId: contact.stripeCustomerId,
            amount: subtotal,
            invoiceId: invoice.id,
            invoiceNumber,
            stripeConnectAccountId: company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null,
          });

          if (result.status === "succeeded") {
            await storage.updateInvoice(invoice.id, {
              status: "paid",
              paidAt: new Date(),
              stripePaymentIntentId: result.paymentIntentId,
              paymentAttempts: 1,
              lastPaymentAttempt: new Date(),
            });
            chargesSucceeded++;

            storage.createNotification({
              companyId,
              type: "invoice_paid",
              title: "Auto-Payment Successful",
              message: `$${subtotal.toFixed(2)} charged to ${contact.firstName} ${contact.lastName} for invoice ${invoiceNumber}`,
              isRead: false,
              linkUrl: `/invoices`,
            }).catch(console.error);
          } else {
            await storage.updateInvoice(invoice.id, {
              status: "failed",
              paymentAttempts: 1,
              lastPaymentAttempt: new Date(),
            });

            storage.createNotification({
              companyId,
              type: "payment_failed",
              title: "Auto-Payment Failed",
              message: `Payment of $${subtotal.toFixed(2)} failed for ${contact.firstName} ${contact.lastName}: ${result.error || "Unknown error"}`,
              isRead: false,
              linkUrl: `/invoices`,
            }).catch(console.error);
          }
        } catch (chargeErr) {
          console.error(`[auto-invoice] Charge error for contact ${contactId}:`, chargeErr);
          await storage.updateInvoice(invoice.id, {
            status: "failed",
            paymentAttempts: 1,
            lastPaymentAttempt: new Date(),
          });
        }
      }
    } catch (contactErr) {
      console.error(`[auto-invoice] Error processing contact ${contactId} in company ${companyId}:`, contactErr);
    }
  }

  return { invoicesCreated, chargesAttempted, chargesSucceeded };
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

function shouldGenerateInvoice(
  frequency: string,
  timing: string,
  todayStr: string
): boolean {
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
