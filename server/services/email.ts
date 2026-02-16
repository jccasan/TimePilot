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

export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  if (!SENDGRID_API_KEY) {
    return { success: false, error: "SendGrid API key not configured" };
  }

  try {
    const msg = {
      to: options.to,
      from: options.from || "noreply@scoopilot.com",
      subject: options.subject,
      text: options.text,
      html: options.html || options.text,
      replyTo: options.replyTo,
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
}): { subject: string; text: string; html: string } {
  const subject = `Invoice ${data.invoiceNumber} from ${data.companyName}`;

  const text = `Hi ${data.contactName},\n\nYou have a new invoice from ${data.companyName}.\n\nInvoice #: ${data.invoiceNumber}\nDue Date: ${data.dueDate}\nTotal: $${data.total}\n\nItems:\n${data.lineItems.map(li => `  - ${li.description}: $${li.total}`).join("\n")}\n\nThank you for your business!`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
        <h1 style="color: white; margin: 0;">${data.companyName}</h1>
      </div>
      <div style="padding: 20px; border: 1px solid #e5e7eb;">
        <p>Hi ${data.contactName},</p>
        <p>You have a new invoice.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background-color: #f3f4f6;">
            <td style="padding: 10px; font-weight: bold;">Invoice #</td>
            <td style="padding: 10px;">${data.invoiceNumber}</td>
          </tr>
          <tr>
            <td style="padding: 10px; font-weight: bold;">Due Date</td>
            <td style="padding: 10px;">${data.dueDate}</td>
          </tr>
          <tr style="background-color: #f3f4f6;">
            <td style="padding: 10px; font-weight: bold;">Total</td>
            <td style="padding: 10px; font-weight: bold; color: #2d8a5e;">$${data.total}</td>
          </tr>
        </table>
        <h3 style="margin-top: 20px;">Items</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background-color: #2d8a5e; color: white;">
              <th style="padding: 8px; text-align: left;">Description</th>
              <th style="padding: 8px; text-align: right;">Qty</th>
              <th style="padding: 8px; text-align: right;">Price</th>
              <th style="padding: 8px; text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${data.lineItems.map((li, i) => `
              <tr style="background-color: ${i % 2 === 0 ? "#f9fafb" : "white"};">
                <td style="padding: 8px;">${li.description}</td>
                <td style="padding: 8px; text-align: right;">${li.quantity}</td>
                <td style="padding: 8px; text-align: right;">$${li.unitPrice}</td>
                <td style="padding: 8px; text-align: right;">$${li.total}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <p style="margin-top: 20px; color: #6b7280; font-size: 14px;">Thank you for your business!</p>
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
