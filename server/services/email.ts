import sgMail from "@sendgrid/mail";
import { db } from "../db";
import { emailsSent } from "@shared/schema";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

interface SendEmailOptions {
  to: string;
  from?: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

const VERIFIED_SENDER = "jeremy@scoopilot.com";

export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  if (!SENDGRID_API_KEY) {
    return { success: false, error: "SendGrid API key not configured" };
  }

  try {
    const replyTo = options.replyTo
      || (options.from && options.from !== VERIFIED_SENDER ? options.from : undefined);

    const msg = {
      to: options.to,
      from: VERIFIED_SENDER,
      subject: options.subject,
      text: options.text,
      html: options.html || options.text,
      replyTo,
    };

    const [response] = await sgMail.send(msg);
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

export function generateInvoiceEmailHtml(data: {
  companyName: string;
  contactName: string;
  invoiceNumber: string;
  dueDate: string;
  total: string;
  lineItems: { description: string; quantity: number; unitPrice: string; total: string }[];
  paymentUrl?: string;
}): { subject: string; text: string; html: string } {
  const subject = `Invoice ${data.invoiceNumber} from ${data.companyName}`;

  const paymentLine = data.paymentUrl ? `\nPay online: ${data.paymentUrl}\n` : "";
  const text = `Hi ${data.contactName},\n\nYou have a new invoice from ${data.companyName}.\n\nInvoice #: ${data.invoiceNumber}\nDue Date: ${data.dueDate}\nTotal: $${data.total}\n\nItems:\n${data.lineItems.map(li => `  - ${li.description}: $${li.total}`).join("\n")}${paymentLine}\nThank you for your business!`;

  const payNowButton = data.paymentUrl ? `
        <div style="text-align: center; margin: 28px 0 20px;">
          <a href="${data.paymentUrl}" style="display: inline-block; background-color: #1a7a4c; color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 6px; font-size: 16px; font-weight: 600; letter-spacing: 0.5px;">Pay Now — $${data.total}</a>
          <p style="margin-top: 10px; font-size: 12px; color: #6b7280;">Pay securely with credit card or Venmo</p>
        </div>
  ` : "";

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

export async function logEmailSent(companyId: string, toAddress: string, subject: string, category: string, sendgridMessageId?: string): Promise<void> {
  await db.insert(emailsSent).values({
    companyId,
    toAddress,
    subject,
    category,
    sendgridMessageId,
  });
}
