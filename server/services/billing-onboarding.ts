import { storage } from "../storage";
import { db } from "../db";
import { visits } from "@shared/schema";
import { and, eq, gte, asc } from "drizzle-orm";
import { generateProratedInvoiceForPlan } from "../jobs/auto-invoice";
import { monthlyRateForPlan, isProratable } from "./proration";

/** Last calendar day of the month containing dateStr (YYYY-MM-DD). */
function endOfMonth(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return last.toISOString().split("T")[0];
}

// Stage labels used for UI display
export const ONBOARDING_STAGE_LABELS: Record<string, string> = {
  deposit_pending: "Deposit Pending",
  balance_pending: "Balance Due",
  active_autopay: "Autopay Active",
  none: "",
};

function calcDepositAmount(
  depositType: string | null | undefined,
  depositValue: string | null | undefined,
  monthlyRate: number
): number {
  if (!depositValue) return 0;
  const val = parseFloat(depositValue);
  if (isNaN(val) || val <= 0) return 0;
  if (depositType === "percent") {
    return Math.round(((monthlyRate * val) / 100) * 100) / 100;
  }
  return val;
}

/** Return earliest upcoming scheduled visit date for a service plan, or null. */
async function firstUpcomingVisitDate(
  companyId: string,
  servicePlanId: string,
  fromDate: string
): Promise<string | null> {
  try {
    const rows = await db
      .select({ scheduledDate: visits.scheduledDate })
      .from(visits)
      .where(
        and(
          eq(visits.companyId, companyId),
          eq(visits.servicePlanId, servicePlanId),
          gte(visits.scheduledDate, fromDate)
        )
      )
      .orderBy(asc(visits.scheduledDate))
      .limit(1);
    return rows[0]?.scheduledDate ?? null;
  } catch {
    return null;
  }
}

/**
 * Reduce an onboarding invoice's total by the deposit already collected.
 * Updates subtotal and total in-place; appends a credit note.
 * No-op if depositCredit <= 0.
 */
async function applyDepositCredit(
  invoiceId: string,
  companyId: string,
  depositCredit: number,
  originalAmount: number
): Promise<void> {
  if (depositCredit <= 0) return;
  const credited = Math.min(depositCredit, originalAmount);
  const newTotal = Math.max(0, originalAmount - credited);
  await storage.updateInvoice(invoiceId, companyId, {
    subtotal: newTotal.toFixed(2),
    total: newTotal.toFixed(2),
    notes: `Deposit credit applied: -$${credited.toFixed(2)}`,
  });
}

/**
 * Call this immediately after a service plan is created from quote acceptance
 * (both portal and staff CRM paths).
 *
 * For per_month contacts with company deposit enabled:
 *   - Creates a deposit invoice (status=sent) and sets stage to deposit_pending.
 *   - The balance invoice is deferred until the deposit is paid.
 *
 * For per_month contacts with deposit disabled:
 *   - Creates the prorated balance invoice immediately and sets stage to balance_pending.
 *   - Day-1 starts get a full first-month invoice instead of skipping balance collection.
 *
 * For non-monthly contacts: falls back to creating the prorated invoice via the
 * existing utility (which is a no-op for non-monthly cadences).
 */
export async function startBillingOnboardingSequence(
  contactId: string,
  companyId: string,
  servicePlan: {
    id: string;
    startDate: string;
    frequency: string;
    pricePerVisit: string;
  }
): Promise<void> {
  try {
    const contact = await storage.getContact(contactId, companyId);
    if (!contact) return;

    const isMonthly = (contact.invoiceFrequency ?? "per_service") === "per_month";

    if (!isMonthly) {
      // Non-monthly contacts — use the existing proration path (no-op for per_service/per_week)
      await generateProratedInvoiceForPlan(
        companyId,
        servicePlan.id,
        contactId,
        servicePlan.startDate,
        servicePlan.frequency,
        servicePlan.pricePerVisit
      );
      return;
    }

    // Only trigger for genuinely new clients (stage = none).
    // active_autopay, deposit_pending, and balance_pending contacts must not re-enter.
    const existingStage = contact.billingOnboardingStage ?? "none";
    if (existingStage !== "none") return;

    const company = await storage.getCompany(companyId);
    if (!company) return;

    if (company.newClientDepositEnabled) {
      const monthlyRate = monthlyRateForPlan(servicePlan.pricePerVisit, servicePlan.frequency);
      const depositAmt = calcDepositAmount(
        company.newClientDepositType,
        company.newClientDepositValue,
        monthlyRate
      );

      if (depositAmt <= 0) {
        // Deposit configured but results in $0 — fall through to balance-only path
        await _createBalanceInvoice(contactId, companyId, servicePlan, 0);
        return;
      }

      const invoiceNumber = await storage.getNextInvoiceNumber(companyId);
      const dueDate = new Date(servicePlan.startDate);
      dueDate.setDate(dueDate.getDate() + 7);
      const dueDateStr = dueDate.toISOString().split("T")[0];

      // Create as "sent" — deposit should be immediately actionable
      const depositInvoice = await storage.createInvoiceWithLineItems(
        {
          companyId,
          contactId,
          invoiceNumber,
          dueDate: dueDateStr,
          subtotal: depositAmt.toFixed(2),
          tax: "0",
          total: depositAmt.toFixed(2),
          status: "sent",
          autoGenerated: true,
          source: "onboarding_deposit",
          isOnboardingInvoice: true,
          notes: `New client deposit for service starting ${servicePlan.startDate}`,
          issuedDate: servicePlan.startDate,
        },
        [
          {
            description: `New client deposit`,
            quantity: 1,
            unitPrice: depositAmt.toFixed(2),
            total: depositAmt.toFixed(2),
            visitId: null,
          },
        ]
      );

      await storage.updateContact(contactId, companyId, {
        billingOnboardingStage: "deposit_pending",
        depositAmount: depositAmt.toFixed(2),
        depositInvoiceId: depositInvoice.id,
      });

      storage
        .createNotification({
          companyId,
          type: "general",
          title: "Client Onboarding Started",
          message: `Deposit invoice #${invoiceNumber} for $${depositAmt.toFixed(2)} created and sent for ${contact.firstName} ${contact.lastName}. Awaiting deposit payment.`,
          isRead: false,
          linkUrl: `/invoices`,
        })
        .catch(console.error);
    } else {
      // No deposit — create prorated balance invoice immediately (no deposit credit)
      await _createBalanceInvoice(contactId, companyId, servicePlan, 0);
    }
  } catch (err) {
    console.error("[billing-onboarding] startBillingOnboardingSequence error:", err);
  }
}

/**
 * Create the onboarding balance invoice for a service plan.
 * Handles both mid-month starts (prorated) and day-1 starts (full first month).
 * depositCredit: amount already collected as deposit, deducted from the balance total.
 */
async function _createBalanceInvoice(
  contactId: string,
  companyId: string,
  servicePlan: { id: string; startDate: string; frequency: string; pricePerVisit: string },
  depositCredit: number
): Promise<void> {
  const contact = await storage.getContact(contactId, companyId);

  const result = await generateProratedInvoiceForPlan(
    companyId,
    servicePlan.id,
    contactId,
    servicePlan.startDate,
    servicePlan.frequency,
    servicePlan.pricePerVisit
  );

  if (result) {
    // Mid-month start — prorated invoice created. Apply deposit credit and set due date.
    const firstVisit = await firstUpcomingVisitDate(
      companyId,
      servicePlan.id,
      servicePlan.startDate
    );
    const dueUpdates: Parameters<typeof storage.updateInvoice>[2] = {
      isOnboardingInvoice: true,
    };
    if (firstVisit) {
      dueUpdates.dueDate = firstVisit;
    }
    await storage.updateInvoice(result.invoiceId, companyId, dueUpdates);
    if (depositCredit > 0) {
      await applyDepositCredit(result.invoiceId, companyId, depositCredit, result.amount);
    }
    await storage.updateContact(contactId, companyId, {
      billingOnboardingStage: "balance_pending",
    });
    const displayAmt = Math.max(0, result.amount - depositCredit);
    storage
      .createNotification({
        companyId,
        type: "general",
        title: "Client Onboarding — Balance Due",
        message: `Balance invoice for $${displayAmt.toFixed(2)} created for ${contact?.firstName ?? ""} ${contact?.lastName ?? ""}. Autopay will be armed on payment.`,
        isRead: false,
        linkUrl: `/invoices`,
      })
      .catch(console.error);
  } else if (!isProratable(servicePlan.startDate, "per_month")) {
    // Day-1 start — no partial-month proration, but first full month must still be paid.
    // Net amount = monthly rate minus any deposit credit already collected.
    const monthlyRate = monthlyRateForPlan(servicePlan.pricePerVisit, servicePlan.frequency);
    const netAmt = Math.max(0, monthlyRate - depositCredit);
    if (monthlyRate > 0) {
      const invoiceNumber = await storage.getNextInvoiceNumber(companyId);
      const eom = endOfMonth(servicePlan.startDate);
      const firstVisit = await firstUpcomingVisitDate(
        companyId,
        servicePlan.id,
        servicePlan.startDate
      );
      const dueDate = firstVisit ?? eom;
      const depositNote =
        depositCredit > 0
          ? ` (deposit credit: -$${Math.min(depositCredit, monthlyRate).toFixed(2)})`
          : "";
      const label = `First month — ${servicePlan.startDate} to ${eom}${depositNote}`;

      await storage.createInvoiceWithLineItems(
        {
          companyId,
          contactId,
          invoiceNumber,
          dueDate,
          subtotal: netAmt.toFixed(2),
          tax: "0",
          total: netAmt.toFixed(2),
          status: "sent",
          autoGenerated: true,
          source: "prorated",
          isOnboardingInvoice: true,
          notes: label,
          issuedDate: servicePlan.startDate,
        },
        [
          {
            description: label,
            quantity: 1,
            unitPrice: netAmt.toFixed(2),
            total: netAmt.toFixed(2),
            visitId: null,
          },
        ]
      );

      // Mark proratedThrough so the nightly sweep does not double-bill this month
      await storage.updateServicePlan(servicePlan.id, companyId, { proratedThrough: eom });

      await storage.updateContact(contactId, companyId, {
        billingOnboardingStage: "balance_pending",
      });
      storage
        .createNotification({
          companyId,
          type: "general",
          title: "Client Onboarding — First Month Due",
          message: `First-month invoice (#${invoiceNumber}) for $${netAmt.toFixed(2)} created for ${contact?.firstName ?? ""} ${contact?.lastName ?? ""}. Autopay will be armed on payment.`,
          isRead: false,
          linkUrl: `/invoices`,
        })
        .catch(console.error);
    }
  }
}

/**
 * Call this whenever any invoice transitions to "paid".
 * Checks whether the invoice is part of a billing onboarding sequence and
 * advances the contact to the next stage if so.
 */
export async function advanceBillingOnboarding(
  invoiceId: string,
  companyId: string
): Promise<void> {
  try {
    const invoice = await storage.getInvoice(invoiceId, companyId);
    if (!invoice || !invoice.isOnboardingInvoice) return;

    const contact = await storage.getContact(invoice.contactId, companyId);
    if (!contact) return;

    const stage = contact.billingOnboardingStage ?? "none";

    if (stage === "deposit_pending" && contact.depositInvoiceId === invoiceId) {
      // Deposit paid — record payment date and create balance invoice(s) with deposit credit.
      await storage.updateContact(contact.id, companyId, { depositPaidAt: new Date() });

      const depositPaid = parseFloat(contact.depositAmount ?? "0");
      const plans = await storage.getServicePlans(companyId, { contactId: contact.id });
      const unprorated = plans.filter((sp) => sp.isActive && !sp.proratedThrough);

      // Distribute deposit credit across plans proportionally (simple: apply to first plan)
      let remainingCredit = depositPaid;
      let balanceCreated = false;

      for (const sp of unprorated) {
        const result = await generateProratedInvoiceForPlan(
          companyId,
          sp.id,
          contact.id,
          sp.startDate,
          sp.frequency,
          sp.pricePerVisit
        );

        if (result) {
          // Set due date to first scheduled visit
          const firstVisit = await firstUpcomingVisitDate(companyId, sp.id, sp.startDate);
          const dueUpdates: Parameters<typeof storage.updateInvoice>[2] = {
            isOnboardingInvoice: true,
          };
          if (firstVisit) dueUpdates.dueDate = firstVisit;
          await storage.updateInvoice(result.invoiceId, companyId, dueUpdates);

          // Apply deposit credit (consume credit against this plan's balance)
          if (remainingCredit > 0) {
            const creditApplied = Math.min(remainingCredit, result.amount);
            await applyDepositCredit(result.invoiceId, companyId, creditApplied, result.amount);
            remainingCredit -= creditApplied;
          }

          balanceCreated = true;
        } else if (!isProratable(sp.startDate, "per_month")) {
          // Day-1 start: create a full first-month invoice minus any remaining deposit credit
          await _createBalanceInvoice(
            contact.id,
            companyId,
            {
              id: sp.id,
              startDate: sp.startDate,
              frequency: sp.frequency,
              pricePerVisit: sp.pricePerVisit,
            },
            remainingCredit
          );
          const monthlyRate = monthlyRateForPlan(sp.pricePerVisit, sp.frequency);
          remainingCredit = Math.max(0, remainingCredit - monthlyRate);
          balanceCreated = true;
        }
      }

      if (balanceCreated) {
        await storage.updateContact(contact.id, companyId, {
          billingOnboardingStage: "balance_pending",
        });
        storage
          .createNotification({
            companyId,
            type: "general",
            title: "Deposit Received",
            message: `Deposit paid for ${contact.firstName} ${contact.lastName}. Balance invoice created — autopay will be armed on payment.`,
            isRead: false,
            linkUrl: `/contacts/${contact.id}`,
          })
          .catch(console.error);
      } else {
        // No balance needed (deposit >= full month, or zero-rate plan) — arm autopay
        await storage.updateContact(contact.id, companyId, {
          autoPayEnabled: true,
          invoiceFrequency: "per_month",
          billingOnboardingStage: "active_autopay",
        });
        storage
          .createNotification({
            companyId,
            type: "general",
            title: "Autopay Armed",
            message: `${contact.firstName} ${contact.lastName} deposit received. No balance due — monthly autopay is now active.`,
            isRead: false,
            linkUrl: `/contacts/${contact.id}`,
          })
          .catch(console.error);
      }
    } else if (stage === "balance_pending" && contact.depositInvoiceId !== invoiceId) {
      // Balance invoice paid — verify ALL onboarding balance invoices are paid
      // before arming autopay (handles multi-plan contacts).
      const contactInvoices = await storage.getInvoices(companyId, { contactId: contact.id });
      const unpaidBalance = contactInvoices.filter(
        (inv) =>
          inv.isOnboardingInvoice && inv.source !== "onboarding_deposit" && inv.status !== "paid"
      );

      if (unpaidBalance.length > 0) {
        // Still outstanding — wait for all to be paid
        return;
      }

      // All onboarding balances paid — arm autopay
      await storage.updateContact(contact.id, companyId, {
        autoPayEnabled: true,
        invoiceFrequency: "per_month",
        billingOnboardingStage: "active_autopay",
      });

      storage
        .createNotification({
          companyId,
          type: "general",
          title: "Autopay Armed",
          message: `${contact.firstName} ${contact.lastName} has completed onboarding. Monthly autopay is now active starting next billing cycle.`,
          isRead: false,
          linkUrl: `/contacts/${contact.id}`,
        })
        .catch(console.error);
    }
  } catch (err) {
    console.error("[billing-onboarding] advanceBillingOnboarding error:", err);
  }
}
