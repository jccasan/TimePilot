import sgMail from "@sendgrid/mail";
import { db } from "../db";
import { emailsSent } from "@shared/schema";
import crypto from "crypto";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

const INBOUND_EMAIL_DOMAIN = process.env.INBOUND_EMAIL_DOMAIN || "inbound.scoopilot.com";

interface SendEmailOptions {
  to: string;
  from?: string;
  senderName?: string;
  companyId?: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  emailThreadId?: string;
}

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

const VERIFIED_SENDER = "jeremy@scoopilot.com";
const OUTBOUND_DOMAIN = process.env.OUTBOUND_EMAIL_DOMAIN || "scoopilot.com";
const FALLBACK_SENDER = `notifications@${OUTBOUND_DOMAIN}`;

export function buildCompanySenderAddress(companyId: string): string {
  const shortId = companyId.split("-")[0];
  return `notifications+${shortId}@${OUTBOUND_DOMAIN}`;
}

export function generateEmailThreadId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function buildReplyToAddress(threadId: string): string {
  return `reply+${threadId}@${INBOUND_EMAIL_DOMAIN}`;
}

export function extractThreadIdFromAddress(address: string): string | null {
  const match = address.match(/^reply\+([a-f0-9]+)@/i);
  return match ? match[1] : null;
}

export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  if (!SENDGRID_API_KEY) {
    return { success: false, error: "SendGrid API key not configured" };
  }

  try {
    let replyTo: string | { email: string; name?: string } | undefined;

    if (options.emailThreadId) {
      const threadReplyTo = buildReplyToAddress(options.emailThreadId);
      const displayName = options.senderName || options.from || undefined;
      replyTo = displayName ? { email: threadReplyTo, name: displayName } : threadReplyTo;
    } else {
      replyTo = options.replyTo
        || (options.from && options.from !== VERIFIED_SENDER ? options.from : undefined);
    }

    const senderEmail = options.companyId
      ? buildCompanySenderAddress(options.companyId)
      : FALLBACK_SENDER;

    const from = options.senderName
      ? { name: options.senderName, email: senderEmail }
      : { name: "ScooPilot", email: senderEmail };

    const headers: Record<string, string> = {};
    if (options.emailThreadId) {
      const messageIdDomain = INBOUND_EMAIL_DOMAIN;
      const uniqueId = crypto.randomBytes(8).toString("hex");
      headers["Message-ID"] = `<${uniqueId}.${options.emailThreadId}@${messageIdDomain}>`;
      headers["In-Reply-To"] = `<${options.emailThreadId}@${messageIdDomain}>`;
      headers["References"] = `<${options.emailThreadId}@${messageIdDomain}>`;
    }

    const mailData: sgMail.MailDataRequired & { headers?: Record<string, string> } = {
      to: options.to,
      from,
      subject: options.subject,
      text: options.text,
      html: options.html || options.text,
      replyTo,
    };

    if (Object.keys(headers).length > 0) {
      mailData.headers = headers;
    }

    const [response] = await sgMail.send(mailData);
    return {
      success: true,
      messageId: response.headers["x-message-id"] as string,
    };
  } catch (err: any) {
    console.error("SendGrid error:", err?.response?.body || err.message);
    return {
      success: false,
      error: err?.response?.body?.errors?.[0]?.message || err.message,
    };
  }
}

const ADMIN_NOTIFICATION_EMAIL = "jeremy@scoopilot.com";

const TIER_LABELS: Record<string, string> = {
  free_trial: "Free Trial",
  tier_1: "Solo ($29/mo)",
  tier_1_3: "Walk ($49/mo)",
  tier_3_5: "Run ($99/mo)",
  tier_6_10: "Grow ($149/mo)",
  tier_10_plus: "Enterprise",
};

export async function sendAdminSignupNotification(details: {
  companyName: string;
  ownerEmail: string;
  ownerName: string;
  tier: string;
  source: string;
}): Promise<void> {
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
  const tierLabel = TIER_LABELS[details.tier] || details.tier;
  const subject = `New ScooPilot Signup: ${details.companyName}`;
  const text = `New signup!\n\nCompany: ${details.companyName}\nOwner: ${details.ownerName}\nEmail: ${details.ownerEmail}\nPlan: ${tierLabel}\nSource: ${details.source}\nTime: ${timestamp}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
        <h1 style="color: white; margin: 0;">ScooPilot</h1>
      </div>
      <div style="padding: 20px; border: 1px solid #e5e7eb;">
        <h2 style="margin-top: 0;">New Signup</h2>
        <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Company:</strong> ${details.companyName}</p>
          <p style="margin: 4px 0;"><strong>Owner:</strong> ${details.ownerName}</p>
          <p style="margin: 4px 0;"><strong>Email:</strong> ${details.ownerEmail}</p>
          <p style="margin: 4px 0;"><strong>Plan:</strong> ${tierLabel}</p>
          <p style="margin: 4px 0;"><strong>Source:</strong> ${details.source}</p>
          <p style="margin: 4px 0;"><strong>Time:</strong> ${timestamp}</p>
        </div>
      </div>
    </div>
  `;
  try {
    const result = await sendEmail({ to: ADMIN_NOTIFICATION_EMAIL, subject, text, html });
    if (result.success) {
      console.log(`[Signup Notification] Admin notified of new signup: ${details.companyName} (${details.ownerEmail})`);
    } else {
      console.error(`[Signup Notification] Failed to send admin notification: ${result.error}`);
    }
  } catch (err) {
    console.error("[Signup Notification] Failed to send admin notification:", err);
  }
}

export function generateInvoiceEmailHtml(data: {
  companyName: string;
  contactName: string;
  invoiceNumber: string;
  dueDate: string;
  total: string;
  lineItems: { description: string; quantity: number; unitPrice: string; total: string }[];
  paymentUrl?: string;
  venmoHandle?: string;
}): { subject: string; text: string; html: string } {
  const subject = `Invoice ${data.invoiceNumber} from ${data.companyName}`;

  const paymentLine = data.paymentUrl ? `\nPay online: ${data.paymentUrl}\n` : "";
  const venmoLine = data.venmoHandle ? `\nOr pay via Venmo: @${data.venmoHandle}\n` : "";
  const text = `Hi ${data.contactName},\n\nYou have a new invoice from ${data.companyName}.\n\nInvoice #: ${data.invoiceNumber}\nDue Date: ${data.dueDate}\nTotal: $${data.total}\n\nItems:\n${data.lineItems.map(li => `  - ${li.description}: $${li.total}`).join("\n")}${paymentLine}${venmoLine}\nThank you for your business!`;

  const venmoSection = data.venmoHandle ? `
          <p style="margin-top: 12px; font-size: 14px; color: #374151;">Or pay via Venmo: <span style="display: inline-block; background-color: #3D95CE; color: #ffffff; border-radius: 4px; padding: 2px 10px; font-weight: 700; font-size: 14px;">@${data.venmoHandle}</span></p>
  ` : "";

  const payNowButton = data.paymentUrl ? `
        <div style="text-align: center; margin: 28px 0 20px; background-color: #f0fdf4; border: 2px solid #22c55e; border-radius: 10px; padding: 28px 24px;">
          <p style="margin: 0 0 14px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #16a34a;">Payment Due</p>
          <a href="${data.paymentUrl}" style="display: inline-block; background-color: #16a34a; color: #ffffff; text-decoration: none; padding: 18px 60px; border-radius: 8px; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; box-shadow: 0 4px 14px rgba(22,163,74,0.35);">Pay Now — $${data.total}</a>
          <p style="margin-top: 14px; font-size: 13px; color: #4b5563;">Pay securely online with credit card or bank transfer</p>
          ${venmoSection}
        </div>
  ` : (data.venmoHandle ? `
        <div style="text-align: center; margin: 28px 0 20px; background-color: #f0fdf4; border: 2px solid #22c55e; border-radius: 10px; padding: 28px 24px;">
          <p style="margin: 0 0 14px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #16a34a;">How to Pay</p>
          ${venmoSection}
        </div>
  ` : "");

  const html = `
    <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8fafc;">
      <div style="background-color: #1a7a4c; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 22px; letter-spacing: 0.5px;">${data.companyName}</h1>
      </div>
      <div style="padding: 24px; background: #ffffff; border: 1px solid #e2e8f0; border-top: none;">
        <p style="margin: 0 0 4px; font-size: 14px; color: #64748b;">Hi ${data.contactName},</p>
        <p style="margin: 0 0 20px; font-size: 14px; color: #1e293b;">Here is your invoice.</p>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
          <tr>
            <td style="padding: 10px 12px; background-color: #f8fafc; font-weight: 600; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Invoice #</td>
            <td style="padding: 10px 12px; background-color: #f8fafc; font-weight: 600; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; text-align: right;">Due Date</td>
          </tr>
          <tr>
            <td style="padding: 10px 12px; font-weight: 500;">${data.invoiceNumber}</td>
            <td style="padding: 10px 12px; text-align: right;">${data.dueDate}</td>
          </tr>
        </table>

        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background-color: #1a7a4c;">
              <th style="padding: 10px 12px; text-align: left; color: white; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Description</th>
              <th style="padding: 10px 12px; text-align: center; color: white; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Qty</th>
              <th style="padding: 10px 12px; text-align: right; color: white; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Price</th>
              <th style="padding: 10px 12px; text-align: right; color: white; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${data.lineItems.map((li, i) => `
              <tr style="background-color: ${i % 2 === 0 ? "#f8fafc" : "#ffffff"};">
                <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0;">${li.description}</td>
                <td style="padding: 10px 12px; text-align: center; border-bottom: 1px solid #e2e8f0;">${li.quantity}</td>
                <td style="padding: 10px 12px; text-align: right; border-bottom: 1px solid #e2e8f0;">$${li.unitPrice}</td>
                <td style="padding: 10px 12px; text-align: right; border-bottom: 1px solid #e2e8f0;">$${li.total}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <div style="text-align: right; margin-top: 16px; padding: 12px 0; border-top: 2px solid #1a7a4c;">
          <span style="font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Amount Due</span>
          <p style="margin: 4px 0 0; font-size: 24px; font-weight: 700; color: #1a7a4c;">$${data.total}</p>
        </div>

        ${payNowButton}

        <p style="margin: 20px 0 0; color: #64748b; font-size: 13px; font-style: italic; text-align: center;">Thank you for your business!</p>
      </div>
      <div style="padding: 16px; text-align: center; font-size: 11px; color: #94a3b8; border-radius: 0 0 8px 8px;">
        ${data.companyName}
      </div>
    </div>
  `;

  return { subject, text, html };
}

export async function logEmailSent(companyId: string, toAddress: string, subject: string, category: string, sendgridMessageId?: string, contactId?: string): Promise<void> {
  await db.insert(emailsSent).values({
    companyId,
    contactId: contactId || null,
    toAddress,
    subject,
    category,
    sendgridMessageId,
  });
}
