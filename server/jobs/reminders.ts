import { db } from "../db";
import { eq, and, lte, sql, isNull, lt, inArray, desc } from "drizzle-orm";
import { contacts, visits, invoices, servicePlans, properties, routes, reminderLogs, type ReminderRule, type InvoiceReminderSettings } from "@shared/schema";
import { storage } from "../storage";
import { sendEmail } from "../services/email";
import { sendSms, isTwilioConfigured } from "../services/sms";
import { getCompanyToday } from "../utils/company-date";
import { users } from "@shared/schema";

const DEFAULT_REMINDER_RULES: ReminderRule[] = [
  {
    id: "default_24h",
    timing: "24h_before",
    channel: "sms",
    template: "Hi {firstName}, your service with {companyName} is scheduled for tomorrow at {propertyAddress}. Thank you!",
    isActive: true,
  },
];

const DEFAULT_INVOICE_SETTINGS: InvoiceReminderSettings = {
  preDueDays: [7, 2, 1, 0],
  overdueIntervalDays: 2,
  maxReminders: 10,
};

function isQuietHours(timezone: string): boolean {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { timeZone: timezone, hour12: false, hour: "2-digit" });
  const hour = parseInt(timeStr, 10);
  return hour < 8 || hour >= 20;
}

function getTimingHours(rule: ReminderRule): number {
  switch (rule.timing) {
    case "24h_before": return 24;
    case "2h_before": return 2;
    case "morning_of": return 0;
    case "custom": return rule.customHours ?? 24;
    default: return 24;
  }
}

function applyTemplate(template: string, fields: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(fields)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}

function getServiceDatetime(scheduledDate: string, startTime: string | null, timezone: string): Date {
  const timeStr = startTime || "08:00";
  const dateTimeStr = `${scheduledDate}T${timeStr}:00`;
  const utcDate = new Date(dateTimeStr);
  const tzOffset = getTimezoneOffsetMs(timezone, utcDate);
  return new Date(utcDate.getTime() + tzOffset);
}

function getTimezoneOffsetMs(timezone: string, date: Date): number {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = date.toLocaleString("en-US", { timeZone: timezone });
  return new Date(utcStr).getTime() - new Date(tzStr).getTime();
}

function isVisitInRuleWindow(rule: ReminderRule, scheduledDate: string, startTime: string | null, timezone: string): boolean {
  const hours = getTimingHours(rule);
  const now = new Date();

  if (rule.timing === "24h_before") {
    const serviceDt = getServiceDatetime(scheduledDate, startTime, timezone);
    const hoursUntil = (serviceDt.getTime() - now.getTime()) / (1000 * 60 * 60);
    return hoursUntil > 0 && hoursUntil <= 26 && hoursUntil >= 22;
  }

  if (rule.timing === "morning_of") {
    const todayStr = getCompanyToday(timezone);
    return scheduledDate === todayStr;
  }

  if (rule.timing === "2h_before" || rule.timing === "custom") {
    const serviceDt = getServiceDatetime(scheduledDate, startTime, timezone);
    const hoursUntil = (serviceDt.getTime() - now.getTime()) / (1000 * 60 * 60);
    const tolerance = 0.25;
    return hoursUntil > 0 && hoursUntil <= hours + tolerance && hoursUntil >= Math.max(0, hours - tolerance);
  }

  return false;
}

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
      const tz = company.timezone || "America/New_York";
      const rules: ReminderRule[] = company.reminderSettings || DEFAULT_REMINDER_RULES;
      const activeRules = rules.filter(r => r.isActive);

      for (const rule of activeRules) {
        const count = await sendServiceRemindersForRule(company.id, company.name, tz, rule);
        totalServiceReminders += count;
      }

      const invoiceSettings: InvoiceReminderSettings = company.invoiceReminderSettings || DEFAULT_INVOICE_SETTINGS;
      const invoiceCount = await sendInvoiceReminders(company.id, company.name, tz, invoiceSettings);
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

async function hasChannelLog(
  companyId: string,
  contactId: string,
  ruleId: string,
  visitId: string,
  channel: string
): Promise<boolean> {
  const logs = await db
    .select({ id: reminderLogs.id })
    .from(reminderLogs)
    .where(
      and(
        eq(reminderLogs.companyId, companyId),
        eq(reminderLogs.contactId, contactId),
        eq(reminderLogs.ruleId, ruleId),
        eq(reminderLogs.visitId, visitId),
        sql`(${reminderLogs.channel} = ${channel} OR ${reminderLogs.channel} = 'both')`
      )
    )
    .limit(1);
  return logs.length > 0;
}

async function sendServiceRemindersForRule(
  companyId: string,
  companyName: string,
  timezone: string,
  rule: ReminderRule
): Promise<number> {
  const isMorningOf = rule.timing === "morning_of";
  const todayStr = getCompanyToday(timezone);
  const hours = getTimingHours(rule);
  const now = new Date();
  const lookAheadDate = new Date(now.getTime() + (hours + 2) * 60 * 60 * 1000);
  const lookAheadStr = lookAheadDate.toLocaleDateString("en-CA", { timeZone: timezone });

  const candidateVisits = await db
    .select({
      visit: visits,
      contact: contacts,
      property: properties,
      plan: servicePlans,
    })
    .from(visits)
    .innerJoin(servicePlans, eq(visits.servicePlanId, servicePlans.id))
    .innerJoin(contacts, eq(servicePlans.contactId, contacts.id))
    .innerJoin(properties, eq(visits.propertyId, properties.id))
    .where(
      and(
        eq(visits.companyId, companyId),
        eq(visits.status, "scheduled"),
        sql`${visits.scheduledDate} >= ${todayStr}`,
        sql`${visits.scheduledDate} <= ${lookAheadStr}`
      )
    );

  const eligibleVisits = candidateVisits.filter(row =>
    isVisitInRuleWindow(rule, row.visit.scheduledDate, row.plan.startTime ?? null, timezone)
  );

  const smsQuiet = isQuietHours(timezone);
  let sent = 0;

  type ContactGroup = {
    contact: typeof eligibleVisits[0]["contact"];
    visits: { visitId: string; address: string; plan: typeof eligibleVisits[0]["plan"]; visit: typeof eligibleVisits[0]["visit"] }[];
  };
  const contactGroups = new Map<string, ContactGroup>();

  for (const row of eligibleVisits) {
    const addr = `${row.property.streetAddress}, ${row.property.city}`;
    const existing = contactGroups.get(row.contact.id);
    if (existing) {
      existing.visits.push({ visitId: row.visit.id, address: addr, plan: row.plan, visit: row.visit });
    } else {
      contactGroups.set(row.contact.id, {
        contact: row.contact,
        visits: [{ visitId: row.visit.id, address: addr, plan: row.plan, visit: row.visit }],
      });
    }
  }

  for (const { contact, visits: contactVisits } of contactGroups.values()) {
    const prefs = contact.reminderPreferences ?? { email: true, sms: false };

    if (prefs.reminderOptOut) continue;
    if (prefs.serviceReminder === false) continue;
    if (prefs.preferredTiming && prefs.preferredTiming !== rule.timing) continue;

    const contactChannel = prefs.preferredChannel || null;
    const effectiveChannel = contactChannel || rule.channel;

    const wantsEmail = (effectiveChannel === "email" || effectiveChannel === "both") && !!contact.email;
    const wantsSms = (effectiveChannel === "sms" || effectiveChannel === "both") && !!contact.phone && isTwilioConfigured();

    const isTimeSensitive = rule.timing === "2h_before" || rule.timing === "morning_of";
    const smsDeferredByQuiet = smsQuiet && !isTimeSensitive;

    if (!wantsEmail && wantsSms && smsDeferredByQuiet) continue;

    const unsentVisits: typeof contactVisits = [];
    for (const cv of contactVisits) {
      const emailDone = !wantsEmail || await hasChannelLog(companyId, contact.id, rule.id, cv.visitId, "email");
      const smsDone = !wantsSms || await hasChannelLog(companyId, contact.id, rule.id, cv.visitId, "sms");
      const smsDeferred = wantsSms && smsDeferredByQuiet;
      if (!emailDone || (!smsDone && !smsDeferred)) {
        unsentVisits.push(cv);
      }
    }

    if (unsentVisits.length === 0) continue;

    const firstVisitId = unsentVisits[0].visitId;
    const alreadySentEmail = wantsEmail && await hasChannelLog(companyId, contact.id, rule.id, firstVisitId, "email");
    const alreadySentSms = wantsSms && await hasChannelLog(companyId, contact.id, rule.id, firstVisitId, "sms");

    const shouldSendEmail = wantsEmail && !alreadySentEmail;
    const shouldSendSms = wantsSms && !alreadySentSms && !smsDeferredByQuiet;

    if (!shouldSendEmail && !shouldSendSms) continue;

    const addresses = unsentVisits.map(v => v.address);
    const visitIds = unsentVisits.map(v => v.visitId);
    const firstVisit = unsentVisits[0];

    let techName = "";
    let arrivalWindow = "";
    if (isMorningOf && firstVisit.visit.routeId) {
      try {
        const routeData = await db.select().from(routes).where(eq(routes.id, firstVisit.visit.routeId)).limit(1);
        if (routeData.length > 0) {
          const route = routeData[0];
          if (route.technicianId) {
            const techData = await db.select({ firstName: users.firstName, lastName: users.lastName })
              .from(users).where(eq(users.id, route.technicianId)).limit(1);
            if (techData.length > 0) {
              techName = `${techData[0].firstName} ${techData[0].lastName}`.trim();
            }
          }
          const routePlans = await storage.getServicePlans(companyId, { routeId: route.id, isActive: true });
          const sortedPlans = routePlans.sort((a, b) => (a.stopOrder || 0) - (b.stopOrder || 0));
          const stopIndex = sortedPlans.findIndex(p => p.id === firstVisit.plan.id);
          if (stopIndex >= 0) {
            const avgMinutesPerStop = 15;
            const startHour = 8;
            const etaMinutes = startHour * 60 + stopIndex * avgMinutesPerStop;
            const etaEndMinutes = etaMinutes + 30;
            const formatTime = (m: number) => {
              const h = Math.floor(m / 60);
              const min = m % 60;
              const ampm = h >= 12 ? "PM" : "AM";
              const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
              return `${h12}:${min.toString().padStart(2, "0")} ${ampm}`;
            };
            arrivalWindow = `${formatTime(etaMinutes)} - ${formatTime(etaEndMinutes)}`;
          }
        }
      } catch (err) {
        console.error(`[reminders] Error calculating arrival window:`, err);
      }
    }

    const templateFields: Record<string, string> = {
      firstName: contact.firstName,
      lastName: contact.lastName || "",
      companyName: companyName,
      propertyAddress: addresses.join("; "),
      serviceDate: firstVisit.visit.scheduledDate,
      serviceTime: arrivalWindow || "during the day",
      technicianName: techName || "your technician",
      arrivalWindow: arrivalWindow || "TBD",
    };

    const message = applyTemplate(rule.template, templateFields);
    let emailSent = false;
    let smsSent = false;

    if (shouldSendEmail) {
      try {
        await sendEmail({
          to: contact.email!,
          subject: `Service Reminder - ${companyName}`,
          text: message,
          html: generateServiceReminderHtml(companyName, `${contact.firstName} ${contact.lastName}`, addresses, firstVisit.visit.scheduledDate, techName, arrivalWindow),
        });
        emailSent = true;
      } catch (err) {
        console.error(`[reminders] Failed to send email to ${contact.email}:`, err);
      }
    }

    if (shouldSendSms) {
      try {
        await sendSms({ to: contact.phone!, body: message });
        smsSent = true;
      } catch (err) {
        console.error(`[reminders] Failed to send SMS to ${contact.phone}:`, err);
      }
    }

    if (emailSent || smsSent) {
      sent++;
      const channelsSent = emailSent && smsSent ? "both" : emailSent ? "email" : "sms";
      for (const vid of visitIds) {
        await db.insert(reminderLogs).values({
          companyId,
          contactId: contact.id,
          visitId: vid,
          ruleId: rule.id,
          reminderType: `service_${rule.timing}`,
          channel: channelsSent,
          messagePreview: message.substring(0, 200),
          deliveryStatus: "sent",
        });
      }

      await db.update(visits)
        .set({ serviceReminderSentAt: new Date() })
        .where(inArray(visits.id, visitIds));
    }
  }

  return sent;
}

function shouldSendInvoiceReminder(
  dueDate: string,
  lastReminderSentAt: Date | null,
  todayStr: string,
  reminderCount: number,
  settings: InvoiceReminderSettings
): boolean {
  if (reminderCount >= settings.maxReminders) return false;

  const due = new Date(dueDate + "T00:00:00Z");
  const today = new Date(todayStr + "T00:00:00Z");
  const daysUntilDue = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const isOverdue = daysUntilDue < 0;

  if (!isOverdue) {
    if (!settings.preDueDays.includes(daysUntilDue)) return false;
  } else {
    const daysLate = Math.abs(daysUntilDue);
    if (settings.overdueIntervalDays <= 0) return false;
    if (daysLate % settings.overdueIntervalDays !== 0) return false;
  }

  if (lastReminderSentAt) {
    const lastSent = new Date(lastReminderSentAt);
    const lastSentStr = lastSent.toISOString().split("T")[0];
    if (lastSentStr === todayStr) return false;
  }

  return true;
}

async function sendInvoiceReminders(
  companyId: string,
  companyName: string,
  timezone: string,
  settings: InvoiceReminderSettings
): Promise<number> {
  const todayStr = getCompanyToday(timezone);

  const maxPreDue = Math.max(...settings.preDueDays, 0);
  const lookAheadDays = maxPreDue + 2;
  const lookAheadDate = new Date(todayStr + "T00:00:00Z");
  lookAheadDate.setUTCDate(lookAheadDate.getUTCDate() + lookAheadDays);
  const lookAheadStr = lookAheadDate.toISOString().split("T")[0];

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
        lte(invoices.dueDate, lookAheadStr)
      )
    );

  let sent = 0;
  const smsQuiet = isQuietHours(timezone);

  for (const row of pendingInvoices) {
    const { invoice, contact } = row;

    if (invoice.excludeFromReminders) continue;

    if (!shouldSendInvoiceReminder(invoice.dueDate, invoice.lastReminderSentAt, todayStr, invoice.reminderCount || 0, settings)) continue;

    const prefs = contact.reminderPreferences ?? { email: true, sms: false };
    if (prefs.reminderOptOut) continue;
    if (prefs.invoiceDueReminder === false) continue;

    const contactChannel = prefs.preferredChannel || null;
    const effectiveChannel = contactChannel || "email";

    const canEmail = (effectiveChannel === "email" || effectiveChannel === "both") && !!contact.email;
    const canSms = (effectiveChannel === "sms" || effectiveChannel === "both") && !!contact.phone && isTwilioConfigured();

    if (!canEmail && canSms && smsQuiet) continue;

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
    let deliveredChannel = "";

    if (canEmail) {
      try {
        await sendEmail({
          to: contact.email!,
          subject,
          text: message,
          html: generateInvoiceReminderHtml(companyName, contactName, invoice.invoiceNumber, invoice.dueDate, String(total), isOverdue),
        });
        delivered = true;
        deliveredChannel = "email";
      } catch (err) {
        console.error(`[reminders] Failed to send invoice email to ${contact.email}:`, err);
      }
    }

    if (canSms && !smsQuiet) {
      try {
        await sendSms({ to: contact.phone!, body: message });
        delivered = true;
        deliveredChannel = deliveredChannel ? "both" : "sms";
      } catch (err) {
        console.error(`[reminders] Failed to send invoice SMS to ${contact.phone}:`, err);
      }
    }

    if (delivered) {
      sent++;
      await db.update(invoices)
        .set({
          lastReminderSentAt: new Date(),
          reminderCount: (invoice.reminderCount || 0) + 1,
        })
        .where(eq(invoices.id, invoice.id));

      await db.insert(reminderLogs).values({
        companyId,
        contactId: contact.id,
        invoiceId: invoice.id,
        ruleId: "invoice_reminder",
        reminderType: isOverdue ? "invoice_overdue" : "invoice_upcoming",
        channel: deliveredChannel,
        messagePreview: message.substring(0, 200),
        deliveryStatus: "sent",
      });
    }
  }

  return sent;
}

function generateServiceReminderHtml(
  companyName: string,
  contactName: string,
  addresses: string[],
  date: string,
  techName?: string,
  arrivalWindow?: string
): string {
  const techLine = techName ? `<p><strong>Technician:</strong> ${techName}</p>` : "";
  const arrivalLine = arrivalWindow ? `<p><strong>Estimated Arrival:</strong> ${arrivalWindow}</p>` : "";

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
        ${techLine}
        ${arrivalLine}
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
