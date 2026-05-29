/**
 * Report Generator Service
 * Builds structured report data and generates a PDF buffer (using pdfkit)
 * for scheduled report email delivery and on-demand "Run now" execution.
 */
import PDFDocument from "pdfkit";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReportSection = {
  key: string;
  title: string;
  summary: string;
  rows?: (string | number | null)[][];
  headers?: string[];
};

export type GeneratedReport = {
  companyName: string;
  reportName: string;
  generatedAt: Date;
  dateRange: { start: string; end: string };
  sections: ReportSection[];
};

// ─── Data Fetchers ────────────────────────────────────────────────────────────

async function fetchOpenBalance(companyId: string): Promise<ReportSection> {
  const today = new Date().toISOString().split("T")[0];
  const rows = await db.execute(sql`
    SELECT
      c.first_name || ' ' || c.last_name AS name,
      COALESCE(SUM(CASE WHEN i.due_date IS NULL OR i.due_date::date >= ${today}::date THEN (i.total::numeric - COALESCE(paid.paid,0)) ELSE 0 END), 0) AS current,
      COALESCE(SUM(CASE WHEN i.due_date IS NOT NULL AND ${today}::date - i.due_date::date BETWEEN 1 AND 30 THEN (i.total::numeric - COALESCE(paid.paid,0)) ELSE 0 END), 0) AS days30,
      COALESCE(SUM(CASE WHEN i.due_date IS NOT NULL AND ${today}::date - i.due_date::date BETWEEN 31 AND 60 THEN (i.total::numeric - COALESCE(paid.paid,0)) ELSE 0 END), 0) AS days60,
      COALESCE(SUM(CASE WHEN i.due_date IS NOT NULL AND ${today}::date - i.due_date::date > 60 THEN (i.total::numeric - COALESCE(paid.paid,0)) ELSE 0 END), 0) AS days90plus,
      COALESCE(SUM(i.total::numeric - COALESCE(paid.paid,0)), 0) AS total
    FROM contacts c
    JOIN invoices i ON i.contact_id = c.id AND i.company_id = ${companyId}
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(amount::numeric),0) AS paid
      FROM invoice_payments
      WHERE invoice_id = i.id
    ) paid ON true
    WHERE c.company_id = ${companyId} AND i.status IN ('sent','pending','draft')
    GROUP BY c.id, c.first_name, c.last_name
    HAVING SUM(i.total::numeric - COALESCE(paid.paid,0)) > 0
    ORDER BY SUM(i.total::numeric - COALESCE(paid.paid,0)) DESC
    LIMIT 50
  `);

  const data = rows.rows as {
    name: string;
    current: number;
    days30: number;
    days60: number;
    days90plus: number;
    total: number;
  }[];

  const grandTotal = data.reduce((s, r) => s + parseFloat(String(r.total)), 0);

  return {
    key: "open_balance",
    title: "Open Balance (Aging)",
    summary: `${data.length} clients with outstanding balances. Total: $${grandTotal.toFixed(2)}`,
    headers: ["Contact", "Current", "1-30 Days", "31-60 Days", "60+ Days", "Total"],
    rows: data.map((r) => [
      r.name,
      `$${parseFloat(String(r.current)).toFixed(2)}`,
      `$${parseFloat(String(r.days30)).toFixed(2)}`,
      `$${parseFloat(String(r.days60)).toFixed(2)}`,
      `$${parseFloat(String(r.days90plus)).toFixed(2)}`,
      `$${parseFloat(String(r.total)).toFixed(2)}`,
    ]),
  };
}

async function fetchRevenueSummary(
  companyId: string,
  startDate: string,
  endDate: string
): Promise<ReportSection> {
  const rows = await db.execute(sql`
    SELECT
      TO_CHAR(created_at, 'YYYY-MM') AS month,
      SUM(total::numeric) AS revenue
    FROM invoices
    WHERE company_id = ${companyId}
      AND status = 'paid'
      AND created_at >= ${startDate}
      AND created_at <= ${endDate}
    GROUP BY TO_CHAR(created_at, 'YYYY-MM')
    ORDER BY month ASC
  `);

  const data = rows.rows as { month: string; revenue: number }[];
  const total = data.reduce((s, r) => s + parseFloat(String(r.revenue)), 0);

  return {
    key: "revenue_by_period",
    title: "Revenue by Period",
    summary: `Total collected: $${total.toFixed(2)} across ${data.length} months`,
    headers: ["Month", "Revenue"],
    rows: data.map((r) => [r.month, `$${parseFloat(String(r.revenue)).toFixed(2)}`]),
  };
}

async function fetchJobs(
  companyId: string,
  startDate: string,
  endDate: string
): Promise<ReportSection> {
  const rows = await db.execute(sql`
    SELECT
      v.scheduled_date AS date,
      c.first_name || ' ' || c.last_name AS contact,
      r.name AS route,
      u.first_name || ' ' || u.last_name AS tech,
      v.status,
      CASE WHEN v.started_at IS NOT NULL AND v.completed_at IS NOT NULL
        THEN ROUND(EXTRACT(EPOCH FROM (v.completed_at - v.started_at)) / 60)
        ELSE NULL
      END AS duration_min
    FROM visits v
    JOIN jobs j ON v.job_id = j.id
    JOIN agreements a ON j.agreement_id = a.id
    JOIN contacts c ON a.contact_id = c.id AND c.company_id = ${companyId}
    LEFT JOIN routes r ON v.route_id = r.id
    LEFT JOIN users u ON r.technician_id = u.id
    WHERE v.company_id = ${companyId}
      AND v.scheduled_date >= ${startDate}
      AND v.scheduled_date <= ${endDate}
    ORDER BY v.scheduled_date DESC
    LIMIT 200
  `);

  const data = rows.rows as {
    date: string;
    contact: string;
    route: string | null;
    tech: string | null;
    status: string;
    duration_min: number | null;
  }[];

  const completed = data.filter((r) => r.status === "completed").length;

  return {
    key: "jobs",
    title: "Completed Jobs",
    summary: `${completed} completed of ${data.length} total visits (${startDate} to ${endDate})`,
    headers: ["Date", "Contact", "Route", "Tech", "Status", "Duration"],
    rows: data.map((r) => [
      r.date,
      r.contact,
      r.route ?? "—",
      r.tech ?? "—",
      r.status,
      r.duration_min != null ? `${r.duration_min} min` : "—",
    ]),
  };
}

async function fetchActiveClients(companyId: string): Promise<ReportSection> {
  const rows = await db.execute(sql`
    SELECT
      TO_CHAR(created_at, 'YYYY-MM') AS month,
      COUNT(*) AS new_clients
    FROM contacts
    WHERE company_id = ${companyId}
      AND created_at >= NOW() - INTERVAL '12 months'
    GROUP BY TO_CHAR(created_at, 'YYYY-MM')
    ORDER BY month ASC
  `);

  const activeRow = await db.execute(sql`
    SELECT COUNT(*) AS count FROM contacts WHERE company_id = ${companyId} AND status = 'active'
  `);
  const activeCount = parseInt(String((activeRow.rows[0] as { count: string }).count));

  return {
    key: "active_clients",
    title: "Active Client Trend",
    summary: `Currently ${activeCount} active clients. Monthly new additions shown below.`,
    headers: ["Month", "New Clients"],
    rows: (rows.rows as { month: string; new_clients: string }[]).map((r) => [
      r.month,
      parseInt(r.new_clients),
    ]),
  };
}

async function fetchNewVsLost(companyId: string): Promise<ReportSection> {
  const newRows = await db.execute(sql`
    SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, COUNT(*) AS new_clients
    FROM contacts WHERE company_id = ${companyId} AND created_at >= NOW() - INTERVAL '12 months'
    GROUP BY TO_CHAR(created_at, 'YYYY-MM') ORDER BY month
  `);
  const cancelRows = await db.execute(sql`
    SELECT TO_CHAR(updated_at, 'YYYY-MM') AS month, COUNT(*) AS cancelled
    FROM contacts WHERE company_id = ${companyId} AND status = 'cancelled'
      AND updated_at >= NOW() - INTERVAL '12 months'
    GROUP BY TO_CHAR(updated_at, 'YYYY-MM') ORDER BY month
  `);

  const map = new Map<string, { new: number; cancelled: number }>();
  for (const r of newRows.rows as { month: string; new_clients: string }[]) {
    map.set(r.month, { new: parseInt(r.new_clients), cancelled: 0 });
  }
  for (const r of cancelRows.rows as { month: string; cancelled: string }[]) {
    const e = map.get(r.month) ?? { new: 0, cancelled: 0 };
    e.cancelled = parseInt(r.cancelled);
    map.set(r.month, e);
  }

  const rows = Array.from(map.entries())
    .sort()
    .map(([m, d]) => [m, d.new, d.cancelled, d.new - d.cancelled]);

  return {
    key: "new_vs_lost",
    title: "New vs Lost Clients",
    summary: `Monthly acquisition and cancellation trend`,
    headers: ["Month", "New", "Cancelled", "Net"],
    rows,
  };
}

async function fetchLeadSources(companyId: string): Promise<ReportSection> {
  const rows = await db.execute(sql`
    SELECT COALESCE(NULLIF(lead_source,''),'Unknown') AS source, COUNT(*) AS count
    FROM contacts WHERE company_id = ${companyId} AND status = 'active'
    GROUP BY COALESCE(NULLIF(lead_source,''),'Unknown') ORDER BY COUNT(*) DESC
  `);

  return {
    key: "lead_sources",
    title: "Lead Sources",
    summary: `Active client referral and lead source breakdown`,
    headers: ["Source", "Clients"],
    rows: (rows.rows as { source: string; count: string }[]).map((r) => [
      r.source,
      parseInt(r.count),
    ]),
  };
}

async function fetchCrossSell(companyId: string): Promise<ReportSection> {
  const rows = await db.execute(sql`
    SELECT c.first_name || ' ' || c.last_name AS contact,
      COUNT(sp.id) AS plan_count,
      SUM(sp.price_per_visit::numeric) AS total_ppv
    FROM contacts c
    JOIN service_plans sp ON sp.contact_id = c.id AND sp.company_id = ${companyId}
      AND sp.is_active = true AND sp.job_status = 'active'
    WHERE c.company_id = ${companyId} AND c.status = 'active'
    GROUP BY c.id, c.first_name, c.last_name
    HAVING COUNT(sp.id) > 1
    ORDER BY SUM(sp.price_per_visit::numeric) DESC
    LIMIT 50
  `);

  return {
    key: "cross_sell",
    title: "Cross-sell Fulfilled",
    summary: `Clients on multiple or premium service plans`,
    headers: ["Contact", "Plans", "Total $/Visit"],
    rows: (rows.rows as { contact: string; plan_count: string; total_ppv: number }[]).map((r) => [
      r.contact,
      parseInt(r.plan_count),
      `$${parseFloat(String(r.total_ppv)).toFixed(2)}`,
    ]),
  };
}

// ─── Main Generator ───────────────────────────────────────────────────────────

export async function generateReportData(
  companyId: string,
  sectionKeys: string[],
  reportName: string
): Promise<GeneratedReport> {
  const company = await storage.getCompany(companyId);
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split("T")[0];

  const sectionBuilders: Record<string, () => Promise<ReportSection>> = {
    open_balance: () => fetchOpenBalance(companyId),
    revenue_by_period: () => fetchRevenueSummary(companyId, thirtyDaysAgo, today),
    jobs: () => fetchJobs(companyId, thirtyDaysAgo, today),
    active_clients: () => fetchActiveClients(companyId),
    new_vs_lost: () => fetchNewVsLost(companyId),
    lead_sources: () => fetchLeadSources(companyId),
    cross_sell: () => fetchCrossSell(companyId),
  };

  const sections: ReportSection[] = [];
  for (const key of sectionKeys) {
    const builder = sectionBuilders[key];
    if (builder) {
      try {
        sections.push(await builder());
      } catch (err) {
        console.error(`[ReportGenerator] Failed to fetch section ${key}:`, err);
        sections.push({
          key,
          title: key,
          summary: "Data unavailable",
        });
      }
    }
  }

  return {
    companyName: company?.name ?? "Your Company",
    reportName,
    generatedAt: new Date(),
    dateRange: { start: thirtyDaysAgo, end: today },
    sections,
  };
}

// ─── PDF Builder ──────────────────────────────────────────────────────────────

export async function generateReportPdf(report: GeneratedReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const GREEN = "#2d8a5e";
    const GRAY = "#6b7280";
    const LIGHT = "#f3f4f6";

    // Header
    doc.rect(0, 0, doc.page.width, 70).fill(GREEN);
    doc.fillColor("white").fontSize(20).font("Helvetica-Bold").text(report.companyName, 50, 20);
    doc.fillColor("white").fontSize(12).font("Helvetica").text(report.reportName, 50, 44);

    // Generated date
    doc
      .fillColor(GRAY)
      .fontSize(9)
      .text(
        `Generated ${report.generatedAt.toLocaleDateString()} | Period: ${report.dateRange.start} to ${report.dateRange.end}`,
        50,
        85
      );

    let y = 110;

    for (const section of report.sections) {
      // Section heading
      if (y > doc.page.height - 120) {
        doc.addPage();
        y = 50;
      }

      doc.fillColor(GREEN).fontSize(13).font("Helvetica-Bold").text(section.title, 50, y);
      y += 18;
      doc.fillColor(GRAY).fontSize(9).font("Helvetica").text(section.summary, 50, y);
      y += 16;

      // Table
      if (section.headers && section.rows && section.rows.length > 0) {
        const colCount = section.headers.length;
        const colWidth = (doc.page.width - 100) / colCount;

        // Header row
        doc.rect(50, y, doc.page.width - 100, 18).fill(GREEN);
        section.headers.forEach((h, i) => {
          doc
            .fillColor("white")
            .fontSize(8)
            .font("Helvetica-Bold")
            .text(h, 52 + i * colWidth, y + 5, { width: colWidth - 4, ellipsis: true });
        });
        y += 18;

        // Data rows
        for (let ri = 0; ri < Math.min(section.rows.length, 40); ri++) {
          if (y > doc.page.height - 60) {
            doc.addPage();
            y = 50;
            // Re-draw header
            doc.rect(50, y, doc.page.width - 100, 18).fill(GREEN);
            section.headers.forEach((h, i) => {
              doc
                .fillColor("white")
                .fontSize(8)
                .font("Helvetica-Bold")
                .text(h, 52 + i * colWidth, y + 5, { width: colWidth - 4, ellipsis: true });
            });
            y += 18;
          }

          const row = section.rows[ri];
          if (ri % 2 === 0) {
            doc.rect(50, y, doc.page.width - 100, 16).fill(LIGHT);
          }
          row.forEach((cell, i) => {
            doc
              .fillColor("#111827")
              .fontSize(8)
              .font("Helvetica")
              .text(String(cell ?? ""), 52 + i * colWidth, y + 4, {
                width: colWidth - 4,
                ellipsis: true,
              });
          });
          y += 16;
        }

        if (section.rows.length > 40) {
          doc
            .fillColor(GRAY)
            .fontSize(8)
            .text(`... and ${section.rows.length - 40} more rows`, 50, y + 4);
          y += 16;
        }
      } else if (!section.rows?.length) {
        doc.fillColor(GRAY).fontSize(9).text("No data available for this period.", 50, y);
        y += 16;
      }

      y += 20;
    }

    doc.end();
  });
}

// ─── Email Body Builder ───────────────────────────────────────────────────────

export function buildReportEmailHtml(report: GeneratedReport): string {
  const sectionsHtml = report.sections
    .map(
      (s) => `
    <div style="margin-bottom:24px">
      <h3 style="color:#2d8a5e;margin:0 0 6px">${s.title}</h3>
      <p style="color:#6b7280;margin:0;font-size:14px">${s.summary}</p>
    </div>
  `
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#2d8a5e;padding:24px;text-align:center">
        <h1 style="color:white;margin:0;font-size:22px">${report.companyName}</h1>
        <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:15px">${report.reportName}</p>
      </div>
      <div style="padding:24px;border:1px solid #e5e7eb;border-top:none">
        <p style="color:#6b7280;font-size:13px;margin:0 0 20px">
          Generated ${report.generatedAt.toLocaleDateString()} &mdash; Period: ${report.dateRange.start} to ${report.dateRange.end}
        </p>
        ${sectionsHtml}
        <p style="color:#9ca3af;font-size:12px;margin-top:24px;border-top:1px solid #f3f4f6;padding-top:16px">
          This report was automatically generated by Scoopilot. Log in to view full interactive reports.
        </p>
      </div>
    </div>
  `;
}
