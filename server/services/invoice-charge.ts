import { storage } from "../storage";
import {
  chargeInvoiceAutomatically,
  ensureConnectedCustomer,
  isStripeConfigured,
} from "./stripe";

/**
 * Charge an invoice against the contact's card on file and update the invoice
 * status accordingly. Returns the charge result status.
 *
 * This mirrors the success/no-card/failure handling of `chargeInvoiceInternal`
 * in server/routes/billing.ts (the interactive API path); it exists separately
 * so background jobs (e.g. beginning-of-month prepay billing) can auto-charge
 * generated invoices without going through an HTTP request.
 */
export async function autoChargeInvoiceByCardOnFile(
  invoiceId: string,
  companyId: string
): Promise<{ status: string }> {
  if (!isStripeConfigured()) return { status: "stripe_not_configured" };

  const invoice = await storage.getInvoice(invoiceId, companyId);
  if (!invoice || invoice.status === "paid") return { status: "skipped" };

  const contact = await storage.getContact(invoice.contactId, companyId);
  if (!contact?.stripeCustomerId) return { status: "no_payment_method" };

  const company = await storage.getCompany(companyId);
  const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;
  const contactName = `${contact.firstName} ${contact.lastName}`.trim();

  const { customerId: resolvedCustomerId, wasRecreated } = await ensureConnectedCustomer({
    currentCustomerId: contact.stripeCustomerId,
    stripeAccount: connectAcct,
    email: contact.email || undefined,
    name: contactName,
    metadata: { contactId: contact.id, companyId },
  });
  if (wasRecreated) {
    await storage.updateContact(contact.id, companyId, { stripeCustomerId: resolvedCustomerId });
  }

  const result = await chargeInvoiceAutomatically({
    customerId: resolvedCustomerId,
    amount: parseFloat(invoice.total),
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    clientName: contactName,
    stripeConnectAccountId: connectAcct,
    tenantId: companyId,
    currency: company?.currency || "usd",
  });

  const updateData: Record<string, unknown> = {
    paymentAttempts: (invoice.paymentAttempts || 0) + 1,
    lastPaymentAttempt: new Date(),
  };

  if (result.status === "succeeded") {
    updateData.status = "paid";
    updateData.paidAt = new Date();
    updateData.stripePaymentIntentId = result.paymentIntentId;
  } else if (result.status === "no_payment_method") {
    // Leave the invoice payable via link.
    updateData.status = invoice.status === "draft" ? "draft" : "sent";
  } else {
    updateData.status = "failed";
    if (result.paymentIntentId) updateData.stripePaymentIntentId = result.paymentIntentId;
  }

  await storage.updateInvoice(
    invoice.id,
    companyId,
    updateData as Parameters<typeof storage.updateInvoice>[2]
  );

  return { status: result.status };
}
