import { db } from "../db";
import { eq, and, lte, sql, isNull, lt } from "drizzle-orm";
import { contacts, visits, invoices, servicePlans, properties } from "@shared/schema";
import { storage } from "../storage";
import { sendEmail } from "../services/email";
import { sendSms, isTwilioConfigured } from "../services/sms";

export async function runReminders() {
  const now = new Date();
  console.log(`[reminders] Starting reminder job at ${now.toISOString()}`);

  const allCompanies = await storage.getAllCompanies();
  let totalServiceReminders = 0;
  let totalInvoiceReminders = 0;
  let errors = 0;

  for (const company of allCompanies) {
    if (!company.remindersEnabled) continue;

    try {
      const serviceCount = await sendServiceReminders(company.id, company.name);
      totalServiceReminders += serviceCount;

      const invoiceCount = await sendInvoiceReminders(company.id, company.name);
      totalInvoiceReminders += invoiceCount;
    } catch (err) {
      errors++;
      console.error(`[reminders] Error processing company ${company.id}:`, err);
    }
  }

  console.log(
    `[reminders] Completed: ${totalServiceReminders} service reminders, ${totalInvoiceReminders} invoice reminders, ${errors} errors`
  );
}

async function sendServiceReminders(companyId: string, companyName: string): Promise<number> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  const tomorrowVisits = await db
    .select({
      visit: visits,
      contact: contacts,
      property: properties,
    })
    .from(visits)
    .innerJoin(servicePlans, eq(visits.servicePlanId, servicePlans.id))
    .innerJoin(contacts, eq(servicePlans.contactId, contacts.id))
    .innerJoin(properties, eq(visits.propertyId, properties.id))
    .where(
      and(
        eq(visits.companyId, companyId),
        eq(visits.scheduledDate, tomorrowStr),
        eq(visits.status, "scheduled")
      )
    );

  let sent = 0;

  const contactVisitsMap = new Map<string, { contact: typeof tomorrowVisits[0]["contact"]; addresses: string[] }>();

  for (const row of tomorrowVisits) {
    const existing = contactVisitsMap.get(row.contact.id);
    const addr = `${row.property.streetAddress}, ${row.property.city}`;
    if (existing) {
      existing.addresses.push(addr);
    } else {
      contactVisitsMap.set(row.contact.id, {
        contact: row.contact,
        addresses: [addr],
      });
    }
  }

  const entries = Array.from(contactVisitsMap.values());
  for (const { contact, addresses } of entries) {
    const prefs = (contact.reminderPreferences as { email: boolean; sms: boolean } | null) ?? {
      email: true,
      sms: false,
    };

    if (!prefs.email && !prefs.sms) continue;

    const contactName = `${contact.firstName} ${contact.lastName}`;
    const addressList = addresses.join("; ");
    const message = `Hi ${contact.firstName}, your service with ${companyName} is scheduled for tomorrow at ${addressList}. Thank you!`;

    let delivered = false;

    if (prefs.email && contact.email) {
      try {
        await sendEmail({
          to: contact.email,
          subject: `Service Reminder - ${companyName}`,
          text: message,
          html: generateServiceReminderHtml(companyName, contactName, addresses, tomorrowStr),
        });
        delivered = true;
      } catch (err) {
        console.error(`[reminders] Failed to send email to ${contact.email}:`, err);
      }
    }

    if (!delivered && prefs.sms && contact.phone && isTwilioConfigured()) {
      try {
        await sendSms({ to: contact.phone, body: message });
        delivered = true;
      } catch (err) {
        console.error(`[reminders] Failed to send SMS to ${contact.phone}:`, err);
      }
    }

    if (delivered) sent++;
  }

  return sent;
}

const PRE_DUE_DAYS = [7, 2, 1, 0];
const LATE_INTERVAL_DAYS = 2;

function shouldSendReminder(dueDate: string, lastReminderSentAt: Date | null, todayStr: string): boolean {
  const due = new Date(dueDate + "T00:00:00Z");
  const today = new Date(todayStr + "T00:00:00Z");
  const daysUntilDue = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const isOverdue = daysUntilDue < 0;

  if (!isOverdue) {
    if (!PRE_DUE_DAYS.includes(daysUntilDue)) return false;
  } else {
    const daysLate = Math.abs(daysUntilDue);
    if (daysLate % LATE_INTERVAL_DAYS !== 0) return false;
  }

  if (lastReminderSentAt) {
    const lastSent = new Date(lastReminderSentAt);
    const lastSentStr = lastSent.toISOString().split("T")[0];
    if (lastSentStr === todayStr) return false;
  }

  return true;
}

async function sendInvoiceReminders(companyId: string, companyName: string): Promise<number> {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  const eightDaysFromNow = new Date();
  eightDaysFromNow.setDate(eightDaysFromNow.getDate() + 8);
  const eightDaysStr = eightDaysFromNow.toISOString().split("T")[0];

  const pendingInvoices = await db
    .select({
      invoice: invoices,
      contact: contacts,
    })
    .from(invoices)
    .innerJoin(contacts, eq(invoices.contactId, contacts.id))
    .where(
      and(
        eq(invoices.companyId, companyId),
        eq(invoices.status, "pending"),
        lte(invoices.dueDate, eightDaysStr)
      )
    );

  let sent = 0;

  for (const row of pendingInvoices) {
    const { invoice, contact } = row;

    if (invoice.excludeFromReminders) continue;

    if (!shouldSendReminder(invoice.dueDate, invoice.lastReminderSentAt, todayStr)) continue;

    const prefs = (contact.reminderPreferences as { email: boolean; sms: boolean } | null) ?? {
      email: true,
      sms: false,
    };

    if (!prefs.email && !prefs.sms) continue;

    const claimed = await db.update(invoices)
      .set({
        lastReminderSentAt: new Date(),
        reminderCount: (invoice.reminderCount || 0) + 1,
      })
      .where(and(
        eq(invoices.id, invoice.id),
        invoice.lastReminderSentAt
          ? lt(invoices.lastReminderSentAt, sql`${todayStr}::date::timestamp`)
          : isNull(invoices.lastReminderSentAt)
      ))
      .returning({ id: invoices.id });

    if (claimed.length === 0) continue;

    const isOverdue = invoice.dueDate < todayStr;
    const contactName = `${contact.firstName} ${contact.lastName}`;
    const total = invoice.total;

    const subject = isOverdue
      ? `Overdue Invoice #${invoice.invoiceNumber} - ${companyName}`
      : `Invoice Reminder #${invoice.invoiceNumber} - ${companyName}`;

    const message = isOverdue
      ? `Hi ${contact.firstName}, invoice #${invoice.invoiceNumber} for $${total} from ${companyName} is overdue (due ${invoice.dueDate}). Please submit payment at your earliest convenience.`
      : `Hi ${contact.firstName}, invoice #${invoice.invoiceNumber} for $${total} from ${companyName} is due on ${invoice.dueDate}. This is a friendly reminder.`;

    let delivered = false;

    if (prefs.email && contact.email) {
      try {
        await sendEmail({
          to: contact.email,
          subject,
          text: message,
          html: generateInvoiceReminderHtml(companyName, contactName, invoice.invoiceNumber, invoice.dueDate, String(total), isOverdue),
        });
        delivered = true;
      } catch (err) {
        console.error(`[reminders] Failed to send invoice email to ${contact.email}:`, err);
      }
    }

    if (!delivered && prefs.sms && contact.phone && isTwilioConfigured()) {
      try {
        await sendSms({ to: contact.phone, body: message });
        delivered = true;
      } catch (err) {
        console.error(`[reminders] Failed to send invoice SMS to ${contact.phone}:`, err);
      }
    }

    if (delivered) sent++;
  }

  return sent;
}

function generateServiceReminderHtml(
  companyName: string,
  contactName: string,
  addresses: string[],
  date: string
): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
        <h1 style="color: white; margin: 0;">${companyName}</h1>
      </div>
      <div style="padding: 20px; border: 1px solid #e5e7eb;">
        <p>Hi ${contactName},</p>
        <p>This is a friendly reminder that your service is scheduled for <strong>${date}</strong>.</p>
        <p><strong>Service location${addresses.length > 1 ? "s" : ""}:</strong></p>
        <ul>
          ${addresses.map((a) => `<li>${a}</li>`).join("")}
        </ul>
        <p style="margin-top: 20px; color: #6b7280; font-size: 14px;">Thank you for choosing ${companyName}!</p>
      </div>
    </div>
  `;
}

function generateInvoiceReminderHtml(
  companyName: string,
  contactName: string,
  invoiceNumber: string,
  dueDate: string,
  total: string,
  isOverdue: boolean
): string {
  const statusText = isOverdue ? "is overdue" : "is due soon";
  const statusColor = isOverdue ? "#dc2626" : "#f59e0b";

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
        <h1 style="color: white; margin: 0;">${companyName}</h1>
      </div>
      <div style="padding: 20px; border: 1px solid #e5e7eb;">
        <p>Hi ${contactName},</p>
        <p>Your invoice <strong>#${invoiceNumber}</strong> for <strong>$${total}</strong> ${statusText}.</p>
        <div style="background-color: ${isOverdue ? "#fef2f2" : "#fffbeb"}; border-left: 4px solid ${statusColor}; padding: 12px; margin: 16px 0;">
          <p style="margin: 0; color: ${statusColor}; font-weight: bold;">
            ${isOverdue ? "Payment Overdue" : "Payment Due Soon"}
          </p>
          <p style="margin: 4px 0 0; color: #374151;">Due Date: ${dueDate}</p>
        </div>
        <p>Please submit payment at your earliest convenience.</p>
        <p style="margin-top: 20px; color: #6b7280; font-size: 14px;">Thank you for your business!</p>
      </div>
    </div>
  `;
}
