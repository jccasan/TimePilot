import { storage } from "../storage";
import { sendEmail } from "./email";
import { computeInvoice } from "../invoice-engine/invoice.compute";
import {
  renderInvoice,
  loadTemplate,
  loadTheme,
  getDefaultTemplatePath,
  getDefaultThemePath,
} from "../invoice-engine/invoice.render";
import { isStripeConfigured, createCheckoutSession, ensureConnectedCustomer } from "./stripe";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local[0]}***@${domain}`;
}

function ensureHttps(value: string): string {
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return `https://${value}`;
}

export function getAppBaseUrl(): string {
  if (process.env.APP_URL) return ensureHttps(process.env.APP_URL);
  if (process.env.REPLIT_DEPLOYMENT_URL) return ensureHttps(process.env.REPLIT_DEPLOYMENT_URL);
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "https://app.scoopilot.com";
}

export async function sendInvoiceEmail(
  invoiceId: string,
  companyId: string,
  options?: { sentBy?: string; baseUrl?: string }
): Promise<{ success: boolean; messageId?: string; paymentUrl?: string; error?: string }> {
  const invoice = await storage.getInvoice(invoiceId, companyId);
  if (!invoice) return { success: false, error: "Invoice not found" };
  if (invoice.status === "paid") return { success: false, error: "Invoice already paid" };

  const contact = await storage.getContact(invoice.contactId, companyId);
  if (!contact?.email) return { success: false, error: "Contact has no email address" };

  const company = await storage.getCompany(companyId);

  if (company?.clientNotificationsSuppressed) {
    console.log(
      `[invoice-email] Suppressed (clientNotificationsSuppressed=true) for invoice ${invoiceId}`
    );
    return { success: true, messageId: "suppressed-quiet-mode" };
  }

  const lineItems = await storage.getInvoiceLineItems(invoice.id);

  const baseUrl = options?.baseUrl ? ensureHttps(options.baseUrl) : getAppBaseUrl();
  const logoUrl = company?.logoUrl ? `${baseUrl}${company.logoUrl}` : "";
  const fromAddress = company?.email || "jeremy@scoopilot.com";

  let paymentUrl: string | undefined;
  if (isStripeConfigured()) {
    const invoiceTotal = parseFloat(invoice.total);
    const connectAccountId = company?.stripeConnectOnboarded
      ? company.stripeConnectAccountId
      : null;
    if (invoiceTotal > 0) {
      try {
        const contactName = `${contact.firstName} ${contact.lastName}`.trim();
        const { customerId: resolvedCustId, wasRecreated } = await ensureConnectedCustomer({
          currentCustomerId: contact.stripeCustomerId,
          stripeAccount: connectAccountId,
          email: contact.email || undefined,
          name: contactName,
          metadata: { contactId: contact.id, companyId },
        });
        if (wasRecreated) {
          await storage.updateContact(contact.id, companyId, { stripeCustomerId: resolvedCustId });
        }
        const checkoutResult = await createCheckoutSession({
          customerId: resolvedCustId,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          amount: invoiceTotal,
          successUrl: `${baseUrl}/portal?paid=${invoice.id}`,
          cancelUrl: `${baseUrl}/portal`,
          stripeConnectAccountId: connectAccountId,
          tenantId: companyId,
        });
        paymentUrl = checkoutResult.url;
      } catch (stripeErr: any) {
        console.error(
          "[invoice-email] Could not generate Stripe checkout URL, sending without payment link:",
          stripeErr?.message || stripeErr
        );
      }
    } else {
      paymentUrl = `${baseUrl}/invoice/${invoice.id}/pay`;
    }
  }

  const properties = await storage.getProperties(companyId, contact.id);
  const serviceAddr = properties.length > 0 ? properties[0] : null;

  const taxRateNum = parseFloat(invoice.taxRate || "0") / 100;
  const discountNum = parseFloat(invoice.discountAmount || "0");
  const paidNum = invoice.paidAt ? parseFloat(invoice.total) : 0;

  const emailFormattedDueDate = invoice.dueDate
    ? new Date(invoice.dueDate + "T12:00:00").toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "";

  const emailBillingAddr = contact.streetAddress
    ? {
        line1: contact.streetAddress,
        line2: contact.address2 || "",
        city: contact.city || "",
        state: contact.state || "",
        zip: contact.zipCode || "",
      }
    : null;

  const emailServiceAddr = serviceAddr
    ? {
        line1: serviceAddr.streetAddress || "",
        line2: "",
        city: serviceAddr.city || "",
        state: serviceAddr.state || "",
        zip: serviceAddr.zipCode || "",
      }
    : null;

  const emailBillingLine = emailBillingAddr
    ? `${emailBillingAddr.line1} ${emailBillingAddr.city} ${emailBillingAddr.state} ${emailBillingAddr.zip}`.trim()
    : "";
  const emailServiceLine = emailServiceAddr
    ? `${emailServiceAddr.line1} ${emailServiceAddr.city} ${emailServiceAddr.state} ${emailServiceAddr.zip}`.trim()
    : "";
  const emailShowServiceAddr =
    emailServiceAddr && emailServiceLine && emailServiceLine !== emailBillingLine;

  const invoiceData = {
    business: {
      name: company?.name || "",
      address: company?.address || "",
      phone: company?.phone || "",
      website: "",
      logo: logoUrl,
    },
    invoice: {
      number: invoice.invoiceNumber,
      status: invoice.status || "pending",
      issue_date: new Date(invoice.createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      due_date: emailFormattedDueDate,
      terms: "Net 30",
      service_period: "",
    },
    customer: {
      name: `${contact.firstName} ${contact.lastName || ""}`.trim(),
    },
    billing_address: emailBillingAddr,
    service_address: emailServiceAddr,
    show_service_address: emailShowServiceAddr ? emailServiceAddr : null,
    line_items: lineItems.map((li) => ({
      description: li.description,
      details: "",
      qty: li.quantity,
      unit_price: parseFloat(li.unitPrice),
      line_total: parseFloat(li.total),
    })),
    totals: {
      subtotal: parseFloat(invoice.subtotal),
      discount: discountNum,
      tax_rate: taxRateNum,
      paid: paidNum,
    },
    visits: undefined as { date: string; time: string; status: string }[] | undefined,
    notes: "",
    payment_instructions: "",
    thank_you: "Thank you for your business!",
    hasFooter: true,
    paymentUrl: paymentUrl || "",
    venmoHandle: company?.venmoHandle || "",
    venmoHandleOnly: !paymentUrl && !!company?.venmoHandle ? company.venmoHandle : "",
  };

  const computed = computeInvoice(invoiceData);
  const tpl = loadTemplate(getDefaultTemplatePath());
  const defaultTheme = loadTheme(getDefaultThemePath());
  let theme = defaultTheme;
  if (company?.invoiceTheme) {
    try {
      const custom = JSON.parse(company.invoiceTheme);
      theme = { ...defaultTheme, ...custom };
    } catch {}
  }
  const renderedHtml = renderInvoice(tpl, theme, computed);

  const subject = `Invoice ${invoice.invoiceNumber} from ${company?.name || "ScooPilot"}`;
  const venmoTextLine = company?.venmoHandle ? `\nOr pay via Venmo: @${company.venmoHandle}` : "";
  const textBody = `Hi ${contact.firstName},\n\nYou have a new invoice from ${company?.name || "ScooPilot"}.\n\nInvoice #: ${invoice.invoiceNumber}\nDue Date: ${invoice.dueDate}\nTotal: $${invoice.total}\n\nItems:\n${lineItems.map((li) => `  - ${li.description}: $${li.total}`).join("\n")}${paymentUrl ? `\n\nPay online: ${paymentUrl}` : ""}${venmoTextLine}\n\nThank you for your business!`;

  const msg = await storage.createMessage({
    companyId,
    contactId: contact.id,
    channel: "email",
    direction: "outbound",
    status: "queued",
    fromAddress,
    toAddress: contact.email,
    subject,
    body: textBody,
    htmlBody: renderedHtml,
    sentBy: options?.sentBy ?? undefined,
    metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
  });

  console.log(
    `[invoice-email] Sending invoice ${invoice.invoiceNumber} to ${maskEmail(contact.email)}`
  );
  const result = await sendEmail({
    companyId,
    to: contact.email,
    from: fromAddress,
    subject,
    text: textBody,
    html: renderedHtml,
    senderName: company?.name || undefined,
    replyTo: company?.email || undefined,
  });

  if (result.success) {
    console.log(
      `[invoice-email] Sent invoice ${invoice.invoiceNumber} to ${maskEmail(contact.email)}`
    );
    await storage.updateMessageStatus(msg.id, "sent");
    if (invoice.status === "pending" || invoice.status === "draft") {
      await storage.updateInvoice(invoice.id, companyId, { status: "sent" });
    }
    return { success: true, messageId: msg.id, paymentUrl: paymentUrl || undefined };
  } else {
    console.error(
      `[invoice-email] Failed to send invoice ${invoice.invoiceNumber}: ${result.error}`
    );
    await storage.updateMessageStatus(msg.id, "failed", result.error);
    return { success: false, error: result.error };
  }
}
