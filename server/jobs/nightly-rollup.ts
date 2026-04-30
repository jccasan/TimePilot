import { db } from "../db";
import { eq, and, sql, gte, lte, count } from "drizzle-orm";
import { visits, invoices, smsMessages, emailsSent, contacts, agreements } from "@shared/schema";
import { storage } from "../storage";

export async function runNightlyRollup() {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split("T")[0];

  const dayStart = new Date(`${dateStr}T00:00:00Z`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

  console.log(`[nightly-rollup] Starting rollup for ${dateStr}`);

  const allCompanies = await storage.getAllCompanies();
  let processed = 0;
  let errors = 0;

  for (const company of allCompanies) {
    try {
      const companyId = company.id;

      const [jobsScheduledResult] = await db
        .select({ count: count() })
        .from(visits)
        .where(and(eq(visits.companyId, companyId), eq(visits.scheduledDate, dateStr)));
      const jobsScheduled = jobsScheduledResult?.count ?? 0;

      const [jobsCompletedResult] = await db
        .select({ count: count() })
        .from(visits)
        .where(
          and(
            eq(visits.companyId, companyId),
            eq(visits.scheduledDate, dateStr),
            eq(visits.status, "completed")
          )
        );
      const jobsCompleted = jobsCompletedResult?.count ?? 0;

      const [invoicesSentResult] = await db
        .select({ count: count() })
        .from(invoices)
        .where(
          and(
            eq(invoices.companyId, companyId),
            gte(invoices.createdAt, dayStart),
            lte(invoices.createdAt, dayEnd)
          )
        );
      const invoicesSent = invoicesSentResult?.count ?? 0;

      const [paymentsResult] = await db
        .select({ count: count() })
        .from(invoices)
        .where(
          and(
            eq(invoices.companyId, companyId),
            eq(invoices.status, "paid"),
            gte(invoices.paidAt, dayStart),
            lte(invoices.paidAt, dayEnd)
          )
        );
      const paymentsCount = paymentsResult?.count ?? 0;

      const [grossResult] = await db
        .select({ total: sql<string>`COALESCE(SUM(${invoices.total}::numeric), 0)` })
        .from(invoices)
        .where(
          and(
            eq(invoices.companyId, companyId),
            eq(invoices.status, "paid"),
            gte(invoices.paidAt, dayStart),
            lte(invoices.paidAt, dayEnd)
          )
        );
      const paymentsGrossCents = Math.round(parseFloat(grossResult?.total ?? "0") * 100);

      const stripeFees =
        paymentsCount > 0 ? Math.round(paymentsGrossCents * 0.029 + paymentsCount * 30) : 0;
      const paymentsNetCents = paymentsGrossCents - stripeFees;

      const [smsOutResult] = await db
        .select({ count: count() })
        .from(smsMessages)
        .where(
          and(
            eq(smsMessages.companyId, companyId),
            eq(smsMessages.direction, "outbound"),
            gte(smsMessages.createdAt, dayStart),
            lte(smsMessages.createdAt, dayEnd)
          )
        );
      const twilioSmsOutbound = smsOutResult?.count ?? 0;

      const [smsInResult] = await db
        .select({ count: count() })
        .from(smsMessages)
        .where(
          and(
            eq(smsMessages.companyId, companyId),
            eq(smsMessages.direction, "inbound"),
            gte(smsMessages.createdAt, dayStart),
            lte(smsMessages.createdAt, dayEnd)
          )
        );
      const twilioSmsInbound = smsInResult?.count ?? 0;

      const [segmentsOutResult] = await db
        .select({ total: sql<number>`COALESCE(SUM(${smsMessages.segments}), 0)` })
        .from(smsMessages)
        .where(
          and(
            eq(smsMessages.companyId, companyId),
            eq(smsMessages.direction, "outbound"),
            gte(smsMessages.createdAt, dayStart),
            lte(smsMessages.createdAt, dayEnd)
          )
        );
      const [segmentsInResult] = await db
        .select({ total: sql<number>`COALESCE(SUM(${smsMessages.segments}), 0)` })
        .from(smsMessages)
        .where(
          and(
            eq(smsMessages.companyId, companyId),
            eq(smsMessages.direction, "inbound"),
            gte(smsMessages.createdAt, dayStart),
            lte(smsMessages.createdAt, dayEnd)
          )
        );
      const totalSegments =
        Number(segmentsOutResult?.total ?? 0) + Number(segmentsInResult?.total ?? 0);
      const twilioCostCentsEst = totalSegments * 75;

      const [emailResult] = await db
        .select({ count: count() })
        .from(emailsSent)
        .where(
          and(
            eq(emailsSent.companyId, companyId),
            gte(emailsSent.createdAt, dayStart),
            lte(emailsSent.createdAt, dayEnd)
          )
        );
      const sendgridEmailsSentCount = emailResult?.count ?? 0;
      const sendgridCostCentsEst = sendgridEmailsSentCount * 10;

      const churnRiskScore = await computeChurnRisk(companyId, dateStr, twilioSmsOutbound);

      await storage.upsertDailyMetrics({
        companyId,
        date: dateStr,
        jobsScheduled,
        jobsCompleted,
        invoicesSent,
        paymentsCount,
        paymentsGrossCents,
        paymentsNetCents,
        twilioSmsOutbound,
        twilioSmsInbound,
        twilioCostCentsEst,
        sendgridEmailsSent: sendgridEmailsSentCount,
        sendgridCostCentsEst,
        churnRiskScore,
      });

      processed++;
    } catch (err) {
      errors++;
      console.error(`[nightly-rollup] Error processing company ${company.id}:`, err);
    }
  }

  console.log(
    `[nightly-rollup] Completed for ${dateStr}: ${processed} companies processed, ${errors} errors`
  );
}

async function computeChurnRisk(
  companyId: string,
  dateStr: string,
  yesterdayOutbound: number
): Promise<number> {
  let score = 0;

  const fourteenDaysAgo = new Date(dateStr);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
  const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().split("T")[0];

  const [completedLast14] = await db
    .select({ count: count() })
    .from(visits)
    .where(
      and(
        eq(visits.companyId, companyId),
        eq(visits.status, "completed"),
        gte(visits.scheduledDate, fourteenDaysAgoStr),
        lte(visits.scheduledDate, dateStr)
      )
    );
  if ((completedLast14?.count ?? 0) === 0) {
    score += 3;
    score += 3;
  }

  const thirtyDaysAgo = new Date(dateStr);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  const thirtyDaysStart = new Date(`${thirtyDaysAgo.toISOString().split("T")[0]}T00:00:00Z`);
  const dateEnd = new Date(`${dateStr}T23:59:59.999Z`);

  const [failedPayments] = await db
    .select({ count: count() })
    .from(invoices)
    .where(
      and(
        eq(invoices.companyId, companyId),
        eq(invoices.status, "failed"),
        gte(invoices.createdAt, thirtyDaysStart),
        lte(invoices.createdAt, dateEnd)
      )
    );
  if ((failedPayments?.count ?? 0) >= 2) {
    score += 2;
  }

  const company = await storage.getCompany(companyId);
  if (company) {
    const createdAt = new Date(company.createdAt);
    const yesterdayDate = new Date(dateStr);
    const daysSinceCreation = Math.floor(
      (yesterdayDate.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceCreation > 7) {
      const [contactCount] = await db
        .select({ count: count() })
        .from(contacts)
        .where(eq(contacts.companyId, companyId));
      const [activePlanCount] = await db
        .select({ count: count() })
        .from(agreements)
        .where(and(eq(agreements.companyId, companyId), eq(agreements.isActive, true)));
      const [paidInvoiceCount] = await db
        .select({ count: count() })
        .from(invoices)
        .where(and(eq(invoices.companyId, companyId), eq(invoices.status, "paid")));

      const hasEnoughContacts = (contactCount?.count ?? 0) >= 10;
      const hasActivePlan = (activePlanCount?.count ?? 0) >= 1;
      const hasPaidInvoice = (paidInvoiceCount?.count ?? 0) >= 1;

      if (!(hasEnoughContacts && hasActivePlan && hasPaidInvoice)) {
        score += 3;
      }
    }
  }

  const sevenDaysAgo = new Date(dateStr);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const trailingStart = new Date(`${sevenDaysAgo.toISOString().split("T")[0]}T00:00:00Z`);
  const trailingEnd = new Date(
    `${new Date(new Date(dateStr).getTime() - 86400000).toISOString().split("T")[0]}T23:59:59.999Z`
  );

  if (trailingEnd >= trailingStart) {
    const [trailingOutbound] = await db
      .select({ count: count() })
      .from(smsMessages)
      .where(
        and(
          eq(smsMessages.companyId, companyId),
          eq(smsMessages.direction, "outbound"),
          gte(smsMessages.createdAt, trailingStart),
          lte(smsMessages.createdAt, trailingEnd)
        )
      );
    const trailingCount = trailingOutbound?.count ?? 0;
    const trailingAvg = trailingCount / 7;
    if (trailingAvg > 0 && yesterdayOutbound > 3 * trailingAvg) {
      score += 2;
    }
  }

  return Math.min(score, 13);
}
