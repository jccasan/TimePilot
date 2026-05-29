/**
 * Scheduled Reports Job
 * Runs hourly. For each scheduled_report row whose frequency/day/hour
 * matches the current time and last_sent_at is before the current period,
 * generates a PDF and sends it via SendGrid.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { sendEmail } from "../services/email";
import {
  generateReportData,
  generateReportPdf,
  buildReportEmailHtml,
} from "../services/report-generator";

type ScheduledReportRow = {
  id: string;
  companyId: string;
  name: string;
  sections: string[];
  frequency: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  sendHour: number;
  recipients: string[];
  lastSentAt: Date | null;
};

function isDue(report: ScheduledReportRow, now: Date): boolean {
  const h = now.getHours();
  if (h !== report.sendHour) return false;

  // Check if already sent this period
  if (report.lastSentAt) {
    const last = new Date(report.lastSentAt);
    if (report.frequency === "daily") {
      // Sent today already?
      if (last.toDateString() === now.toDateString()) return false;
    } else if (report.frequency === "weekly") {
      // Sent this week already?
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);
      if (last >= weekStart) return false;
    } else if (report.frequency === "monthly") {
      // Sent this month already?
      if (last.getFullYear() === now.getFullYear() && last.getMonth() === now.getMonth())
        return false;
    }
  }

  if (report.frequency === "daily") return true;
  if (report.frequency === "weekly") {
    return now.getDay() === (report.dayOfWeek ?? 1);
  }
  if (report.frequency === "monthly") {
    return now.getDate() === (report.dayOfMonth ?? 1);
  }
  return false;
}

async function sendScheduledReport(report: ScheduledReportRow): Promise<void> {
  try {
    console.log(
      `[ScheduledReports] Generating report "${report.name}" for company ${report.companyId}`
    );

    const reportData = await generateReportData(report.companyId, report.sections, report.name);

    const pdfBuffer = await generateReportPdf(reportData);
    const emailHtml = buildReportEmailHtml(reportData);
    const pdfBase64 = pdfBuffer.toString("base64");

    const errors: string[] = [];
    for (const recipient of report.recipients) {
      const result = await sendEmail({
        to: recipient,
        subject: `${reportData.companyName} — ${report.name}`,
        text: `${report.name} generated on ${reportData.generatedAt.toLocaleDateString()}.\n\nSections: ${report.sections.join(", ")}.\n\nPlease find the full report PDF attached.`,
        html: emailHtml,
        attachments: [
          {
            content: pdfBase64,
            filename: `${report.name.replace(/[^a-zA-Z0-9]/g, "-")}-${reportData.generatedAt.toISOString().split("T")[0]}.pdf`,
            type: "application/pdf",
            disposition: "attachment",
          },
        ],
      });
      if (!result.success) {
        errors.push(`${recipient}: ${result.error}`);
      }
    }

    if (errors.length) {
      console.warn(`[ScheduledReports] Some emails failed for "${report.name}":`, errors);
    }

    // Update last_sent_at regardless of partial failures
    await storage.updateScheduledReport(report.id, report.companyId, {
      lastSentAt: new Date(),
    });

    console.log(
      `[ScheduledReports] Sent "${report.name}" to ${report.recipients.length} recipient(s)`
    );
  } catch (err) {
    console.error(`[ScheduledReports] Failed to send "${report.name}":`, err);
  }
}

export async function runScheduledReportsJob(): Promise<void> {
  try {
    const now = new Date();
    const rows = await db.execute(sql`
      SELECT id, company_id, name, sections, frequency, day_of_week, day_of_month,
             send_hour, recipients, last_sent_at
      FROM scheduled_reports
      WHERE array_length(recipients, 1) > 0
    `);

    const reports = rows.rows as {
      id: string;
      company_id: string;
      name: string;
      sections: string[];
      frequency: string;
      day_of_week: number | null;
      day_of_month: number | null;
      send_hour: number;
      recipients: string[];
      last_sent_at: Date | null;
    }[];

    const due = reports
      .map((r) => ({
        id: r.id,
        companyId: r.company_id,
        name: r.name,
        sections: r.sections,
        frequency: r.frequency,
        dayOfWeek: r.day_of_week,
        dayOfMonth: r.day_of_month,
        sendHour: r.send_hour,
        recipients: r.recipients,
        lastSentAt: r.last_sent_at,
      }))
      .filter((r) => isDue(r, now));

    if (!due.length) return;

    console.log(`[ScheduledReports] ${due.length} report(s) due, sending...`);
    await Promise.allSettled(due.map(sendScheduledReport));
  } catch (err) {
    console.error("[ScheduledReports] Job error:", err);
  }
}

export function startScheduledReportsJob(): NodeJS.Timeout {
  console.log("[ScheduledReports] Scheduler started (hourly)");
  // Run at :00 each hour
  const interval = setInterval(
    () => {
      runScheduledReportsJob().catch((err) =>
        console.error("[ScheduledReports] Uncaught error:", err)
      );
    },
    60 * 60 * 1000
  );
  return interval;
}
