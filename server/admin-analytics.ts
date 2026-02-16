import type { Express, Request, Response } from "express";
import { eq, and, gte, lte, count, sql, desc, asc, lt, or } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import {
  companies, companyUsers, contacts, servicePlans, invoices,
  visits, smsMessages, emailsSent, saasCostsMonthly,
  TIER_CONFIG,
} from "@shared/schema";

const SMS_COST_PER_SEGMENT_CENTS = 75;
const EMAIL_COST_PER_UNIT_CENTS = 10;
const STRIPE_PCT = 2.9;
const STRIPE_FIXED_CENTS = 30;

function getTierPrice(tier: string): number {
  const config = TIER_CONFIG[tier as keyof typeof TIER_CONFIG];
  return config?.price ?? 0;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthEnd(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function registerAdminAnalyticsRoutes(app: Express, isAdmin: Function) {

  // 1. Executive Overview
  app.get("/api/admin/analytics/executive", isAdmin as any, async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const thisMonthStart = monthStart(now);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

      const allCompanies = await db.select().from(companies);

      const activeCompanies = allCompanies.filter(c => c.subscriptionStatus === "active");
      const activeAccounts = activeCompanies.length;
      const totalAccounts = allCompanies.length;

      const mrr = activeCompanies.reduce((sum, c) => sum + getTierPrice(c.subscriptionTier), 0);
      const arr = mrr * 12;

      const newThisMonth = activeCompanies.filter(c => c.createdAt >= thisMonthStart);
      const newMrrThisMonth = newThisMonth.reduce((sum, c) => sum + getTierPrice(c.subscriptionTier), 0);

      const canceledThisMonth = allCompanies.filter(c =>
        c.subscriptionStatus === "cancelled" && c.canceledAt && c.canceledAt >= thisMonthStart
      );
      const churnedMrrThisMonth = canceledThisMonth.reduce((sum, c) => sum + getTierPrice(c.subscriptionTier), 0);

      const activeAtStartOfMonth = allCompanies.filter(c =>
        c.createdAt < thisMonthStart &&
        (c.subscriptionStatus === "active" || (c.subscriptionStatus === "cancelled" && c.canceledAt && c.canceledAt >= thisMonthStart))
      ).length;
      const logoChurnPct = activeAtStartOfMonth > 0 ? (canceledThisMonth.length / activeAtStartOfMonth) * 100 : 0;

      const lastMonthActive = allCompanies.filter(c =>
        c.createdAt <= lastMonthEnd &&
        (c.subscriptionStatus === "active" || (c.subscriptionStatus === "cancelled" && c.canceledAt && c.canceledAt > lastMonthEnd))
      );
      const lastMonthMrr = lastMonthActive.reduce((sum, c) => sum + getTierPrice(c.subscriptionTier), 0);
      const nrr = lastMonthMrr > 0 ? (mrr / lastMonthMrr) * 100 : 100;
      const grr = lastMonthMrr > 0 ? Math.min(100, ((lastMonthMrr - churnedMrrThisMonth) / lastMonthMrr) * 100) : 100;

      const [smsCountResult] = await db.select({ total: sql<number>`coalesce(sum(${smsMessages.segments}), 0)` }).from(smsMessages);
      const [emailCountResult] = await db.select({ total: count() }).from(emailsSent);

      const totalSmsSeg = Number(smsCountResult?.total ?? 0);
      const totalEmailCount = Number(emailCountResult?.total ?? 0);
      const totalTwilioCostEst = (totalSmsSeg * SMS_COST_PER_SEGMENT_CENTS) / 100;
      const totalSendgridCostEst = (totalEmailCount * EMAIL_COST_PER_UNIT_CENTS) / 100;
      const totalCosts = totalTwilioCostEst + totalSendgridCostEst;
      const estimatedGrossMarginPct = mrr > 0 ? ((mrr - totalCosts) / mrr) * 100 : 0;

      res.json({
        activeAccounts, totalAccounts, mrr, arr,
        newMrrThisMonth, churnedMrrThisMonth, logoChurnPct,
        nrr: Math.round(nrr * 100) / 100,
        grr: Math.round(grr * 100) / 100,
        totalTwilioCostEst: Math.round(totalTwilioCostEst * 100) / 100,
        totalSendgridCostEst: Math.round(totalSendgridCostEst * 100) / 100,
        estimatedGrossMarginPct: Math.round(estimatedGrossMarginPct * 100) / 100,
      });
    } catch (err) {
      console.error("Executive analytics error:", err);
      res.status(500).json({ error: "Failed to compute executive analytics" });
    }
  });

  // 2. Accounts
  app.get("/api/admin/analytics/accounts", isAdmin as any, async (req: Request, res: Response) => {
    try {
      const filter = req.query.filter as string | undefined;
      const search = req.query.search as string | undefined;
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];

      let allCompanies = await db.select().from(companies);

      if (search) {
        const s = search.toLowerCase();
        allCompanies = allCompanies.filter(c => c.name.toLowerCase().includes(s));
      }

      const results = await Promise.all(allCompanies.map(async (c) => {
        const [
          userCountResult,
          contactCountResult,
          activeContactCountResult,
          servicePlanCountResult,
          recurringPlanCountResult,
          lastVisitResult,
          failedPaymentsResult,
          totalInvoiceCountResult,
          paidInvoiceCountResult,
          smsResult,
        ] = await Promise.all([
          db.select({ cnt: count() }).from(companyUsers).where(eq(companyUsers.companyId, c.id)),
          db.select({ cnt: count() }).from(contacts).where(eq(contacts.companyId, c.id)),
          db.select({ cnt: count() }).from(contacts).where(and(eq(contacts.companyId, c.id), eq(contacts.status, "active"))),
          db.select({ cnt: count() }).from(servicePlans).where(eq(servicePlans.companyId, c.id)),
          db.select({ cnt: count() }).from(servicePlans).where(and(
            eq(servicePlans.companyId, c.id),
            eq(servicePlans.isActive, true),
            or(
              eq(servicePlans.frequency, "weekly"),
              eq(servicePlans.frequency, "biweekly"),
              eq(servicePlans.frequency, "monthly")
            )
          )),
          db.select({ maxDate: sql<string>`max(${visits.scheduledDate})` }).from(visits).where(eq(visits.companyId, c.id)),
          db.select({ cnt: count() }).from(invoices).where(and(
            eq(invoices.companyId, c.id),
            eq(invoices.status, "failed"),
            gte(invoices.createdAt, thirtyDaysAgo)
          )),
          db.select({ cnt: count() }).from(invoices).where(eq(invoices.companyId, c.id)),
          db.select({ cnt: count() }).from(invoices).where(and(eq(invoices.companyId, c.id), eq(invoices.status, "paid"))),
          db.select({ total: sql<number>`coalesce(sum(${smsMessages.segments}), 0)` }).from(smsMessages).where(and(
            eq(smsMessages.companyId, c.id),
            gte(smsMessages.createdAt, thirtyDaysAgo)
          )),
        ]);

        const userCount = userCountResult[0]?.cnt ?? 0;
        const contactCount = contactCountResult[0]?.cnt ?? 0;
        const activeContactCount = activeContactCountResult[0]?.cnt ?? 0;
        const servicePlanCount = servicePlanCountResult[0]?.cnt ?? 0;
        const recurringPlanCount = recurringPlanCountResult[0]?.cnt ?? 0;
        const lastVisitDate = lastVisitResult[0]?.maxDate || null;
        const failedPayments30d = failedPaymentsResult[0]?.cnt ?? 0;
        const totalInvoices = totalInvoiceCountResult[0]?.cnt ?? 0;
        const paidInvoices = paidInvoiceCountResult[0]?.cnt ?? 0;
        const smsSeg30d = Number(smsResult[0]?.total ?? 0);
        const smsCost30dCents = smsSeg30d * SMS_COST_PER_SEGMENT_CENTS;

        const mrrCents = Math.round(getTierPrice(c.subscriptionTier) * 100);
        const estimatedMargin30d = mrrCents - smsCost30dCents;

        const hasEnoughContacts = contactCount >= 10;
        const hasRecurringPlan = recurringPlanCount >= 1;
        const hasInvoiceOrPayment = totalInvoices >= 1 || paidInvoices >= 1;
        const isActivated = hasEnoughContacts && hasRecurringPlan && hasInvoiceOrPayment;

        let churnRiskScore = 0;
        if (c.subscriptionStatus !== "active") churnRiskScore += 30;
        if (failedPayments30d > 0) churnRiskScore += 25;
        if (!lastVisitDate || new Date(lastVisitDate) < fourteenDaysAgo) churnRiskScore += 20;
        if (!isActivated) churnRiskScore += 15;
        if (contactCount < 5) churnRiskScore += 10;
        churnRiskScore = Math.min(100, churnRiskScore);

        return {
          id: c.id,
          name: c.name,
          subscriptionTier: c.subscriptionTier,
          subscriptionStatus: c.subscriptionStatus,
          mrrCents,
          createdAt: c.createdAt.toISOString(),
          userCount,
          contactCount,
          activeContactCount,
          servicePlanCount,
          lastVisitDate,
          failedPayments30d,
          smsCost30dCents,
          estimatedMargin30d,
          churnRiskScore,
          isActivated,
        };
      }));

      let filtered = results;
      if (filter === "inactive_14d") {
        filtered = results.filter(r => !r.lastVisitDate || new Date(r.lastVisitDate) < fourteenDaysAgo);
      } else if (filter === "high_sms_cost") {
        filtered = results.filter(r => r.smsCost30dCents > r.mrrCents * 0.5);
      } else if (filter === "failed_payments") {
        filtered = results.filter(r => r.failedPayments30d > 0);
      } else if (filter === "not_activated_7d") {
        filtered = results.filter(r => !r.isActivated && new Date(r.createdAt) < sevenDaysAgo);
      }

      res.json(filtered);
    } catch (err) {
      console.error("Accounts analytics error:", err);
      res.status(500).json({ error: "Failed to compute accounts analytics" });
    }
  });

  // 3. Billing
  app.get("/api/admin/analytics/billing", isAdmin as any, async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];

      const allInvoices = await db.select().from(invoices);

      const totalInvoices = allInvoices.length;
      const failedInvoices = allInvoices.filter(i => i.status === "failed");
      const paidInvoices = allInvoices.filter(i => i.status === "paid");
      const refundedInvoices = allInvoices.filter(i => i.status === "refunded");
      const pastDueInvoices = allInvoices.filter(i =>
        (i.status === "pending" || i.status === "draft") && i.dueDate < todayStr
      );

      const failedPaymentRate = totalInvoices > 0 ? (failedInvoices.length / totalInvoices) * 100 : 0;
      const recoveryRate = failedInvoices.length > 0
        ? (paidInvoices.filter(p => p.paymentAttempts > 1).length / failedInvoices.length) * 100
        : 0;

      const pastDueCount = pastDueInvoices.length;
      const pastDueAmount = pastDueInvoices.reduce((sum, i) => sum + parseFloat(i.total), 0);
      const refundCount = refundedInvoices.length;
      const refundAmount = refundedInvoices.reduce((sum, i) => sum + parseFloat(i.total), 0);

      const paidTotal = paidInvoices.reduce((sum, i) => sum + parseFloat(i.total), 0);
      const totalStripeFees = (paidTotal * STRIPE_PCT / 100) + (paidInvoices.length * STRIPE_FIXED_CENTS / 100);

      const invoicesByStatus: Record<string, number> = {};
      for (const inv of allInvoices) {
        invoicesByStatus[inv.status] = (invoicesByStatus[inv.status] || 0) + 1;
      }

      const monthlyPayments: { month: string; amount: number; count: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
        const mKey = monthKey(d);
        const monthPaid = paidInvoices.filter(inv => {
          const paidDate = inv.paidAt || inv.updatedAt;
          return paidDate >= d && paidDate <= mEnd;
        });
        monthlyPayments.push({
          month: mKey,
          amount: Math.round(monthPaid.reduce((s, inv) => s + parseFloat(inv.total), 0) * 100) / 100,
          count: monthPaid.length,
        });
      }

      res.json({
        failedPaymentRate: Math.round(failedPaymentRate * 100) / 100,
        recoveryRate: Math.round(recoveryRate * 100) / 100,
        pastDueCount,
        pastDueAmount: Math.round(pastDueAmount * 100) / 100,
        refundCount,
        refundAmount: Math.round(refundAmount * 100) / 100,
        totalStripeFees: Math.round(totalStripeFees * 100) / 100,
        invoicesByStatus,
        monthlyPayments,
      });
    } catch (err) {
      console.error("Billing analytics error:", err);
      res.status(500).json({ error: "Failed to compute billing analytics" });
    }
  });

  // 4. Retention
  app.get("/api/admin/analytics/retention", isAdmin as any, async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const allCompanies = await db.select().from(companies);

      const cohorts: { month: string; started: number; retained: number[]; retentionPct: number[] }[] = [];
      for (let i = 5; i >= 0; i--) {
        const cohortDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const cohortEnd = new Date(cohortDate.getFullYear(), cohortDate.getMonth() + 1, 0, 23, 59, 59, 999);
        const mKey = monthKey(cohortDate);

        const cohortCompanies = allCompanies.filter(c =>
          c.createdAt >= cohortDate && c.createdAt <= cohortEnd
        );
        const started = cohortCompanies.length;

        const retained: number[] = [];
        const retentionPct: number[] = [];
        for (let m = 0; m <= (now.getMonth() - cohortDate.getMonth() + (now.getFullYear() - cohortDate.getFullYear()) * 12); m++) {
          const checkDate = new Date(cohortDate.getFullYear(), cohortDate.getMonth() + m + 1, 0, 23, 59, 59, 999);
          if (checkDate > now) break;

          const activeCount = cohortCompanies.filter(c =>
            c.subscriptionStatus === "active" ||
            (c.canceledAt && c.canceledAt > checkDate)
          ).length;
          retained.push(activeCount);
          retentionPct.push(started > 0 ? Math.round((activeCount / started) * 10000) / 100 : 0);
        }

        cohorts.push({ month: mKey, started, retained, retentionPct });
      }

      const churnReasons: Record<string, number> = {};
      const churnByPlan: Record<string, number> = {};
      const tenureBuckets = [
        { bucket: "0-30d", min: 0, max: 30, count: 0 },
        { bucket: "31-90d", min: 31, max: 90, count: 0 },
        { bucket: "91-180d", min: 91, max: 180, count: 0 },
        { bucket: "180d+", min: 181, max: Infinity, count: 0 },
      ];

      const canceledCompanies = allCompanies.filter(c => c.subscriptionStatus === "cancelled");
      for (const c of canceledCompanies) {
        const reason = c.churnReason || "unknown";
        churnReasons[reason] = (churnReasons[reason] || 0) + 1;
        churnByPlan[c.subscriptionTier] = (churnByPlan[c.subscriptionTier] || 0) + 1;

        const cancelDate = c.canceledAt || c.updatedAt;
        const tenureDays = Math.floor((cancelDate.getTime() - c.createdAt.getTime()) / (1000 * 60 * 60 * 24));
        for (const bucket of tenureBuckets) {
          if (tenureDays >= bucket.min && tenureDays <= bucket.max) {
            bucket.count++;
            break;
          }
        }
      }

      res.json({
        cohorts,
        churnReasons,
        churnByPlan,
        churnByTenure: tenureBuckets.map(b => ({ bucket: b.bucket, count: b.count })),
      });
    } catch (err) {
      console.error("Retention analytics error:", err);
      res.status(500).json({ error: "Failed to compute retention analytics" });
    }
  });

  // 5. Activation
  app.get("/api/admin/analytics/activation", isAdmin as any, async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const allCompanies = await db.select().from(companies);
      const totalAccounts = allCompanies.length;

      const activationResults = await Promise.all(allCompanies.map(async (c) => {
        const [contactResult, recurringResult, invoiceResult] = await Promise.all([
          db.select({ cnt: count() }).from(contacts).where(eq(contacts.companyId, c.id)),
          db.select({ cnt: count() }).from(servicePlans).where(and(
            eq(servicePlans.companyId, c.id),
            eq(servicePlans.isActive, true),
            or(
              eq(servicePlans.frequency, "weekly"),
              eq(servicePlans.frequency, "biweekly"),
              eq(servicePlans.frequency, "monthly")
            )
          )),
          db.select({ cnt: count() }).from(invoices).where(eq(invoices.companyId, c.id)),
        ]);

        const contactCount = contactResult[0]?.cnt ?? 0;
        const recurringCount = recurringResult[0]?.cnt ?? 0;
        const invoiceCount = invoiceResult[0]?.cnt ?? 0;
        const isActivated = contactCount >= 10 && recurringCount >= 1 && invoiceCount >= 1;

        return { company: c, isActivated, contactCount };
      }));

      const activatedCount = activationResults.filter(r => r.isActivated).length;
      const activationRate = totalAccounts > 0 ? (activatedCount / totalAccounts) * 100 : 0;

      const activatedCompanies = activationResults.filter(r => r.isActivated);
      let avgDaysToActivation = 0;
      if (activatedCompanies.length > 0) {
        const totalDays = activatedCompanies.reduce((sum, r) => {
          const days = Math.floor((now.getTime() - r.company.createdAt.getTime()) / (1000 * 60 * 60 * 24));
          return sum + Math.min(days, 90);
        }, 0);
        avgDaysToActivation = Math.round(totalDays / activatedCompanies.length);
      }

      const notActivated7d = activationResults.filter(r =>
        !r.isActivated && r.company.createdAt < sevenDaysAgo
      ).length;

      const byPlan: { plan: string; total: number; activated: number; rate: number }[] = [];
      const tiers = Object.keys(TIER_CONFIG) as (keyof typeof TIER_CONFIG)[];
      for (const tier of tiers) {
        const tierResults = activationResults.filter(r => r.company.subscriptionTier === tier);
        const tierActivated = tierResults.filter(r => r.isActivated).length;
        byPlan.push({
          plan: tier,
          total: tierResults.length,
          activated: tierActivated,
          rate: tierResults.length > 0 ? Math.round((tierActivated / tierResults.length) * 10000) / 100 : 0,
        });
      }

      res.json({
        activationDefinition: "10+ contacts AND 1+ recurring plan AND (1+ invoice OR 1+ payment)",
        totalAccounts,
        activatedCount,
        activationRate: Math.round(activationRate * 100) / 100,
        avgDaysToActivation,
        notActivated7d,
        byPlan,
      });
    } catch (err) {
      console.error("Activation analytics error:", err);
      res.status(500).json({ error: "Failed to compute activation analytics" });
    }
  });

  // 6. Messaging
  app.get("/api/admin/analytics/messaging", isAdmin as any, async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

      const [smsSentResult] = await db.select({ total: sql<number>`coalesce(sum(${smsMessages.segments}), 0)` })
        .from(smsMessages).where(eq(smsMessages.direction, "outbound"));
      const [smsRecvResult] = await db.select({ total: count() })
        .from(smsMessages).where(eq(smsMessages.direction, "inbound"));
      const [emailTotalResult] = await db.select({ total: count() }).from(emailsSent);

      const totalSmsSent = Number(smsSentResult?.total ?? 0);
      const totalSmsReceived = Number(smsRecvResult?.total ?? 0);
      const totalEmailsSentCount = Number(emailTotalResult?.total ?? 0);
      const estimatedSmsCost = (totalSmsSent * SMS_COST_PER_SEGMENT_CENTS) / 10000;
      const estimatedEmailCost = (totalEmailsSentCount * EMAIL_COST_PER_UNIT_CENTS) / 10000;

      const topSmsRows = await db.select({
        companyId: smsMessages.companyId,
        smsCount: sql<number>`coalesce(sum(${smsMessages.segments}), 0)`,
      }).from(smsMessages).groupBy(smsMessages.companyId).orderBy(desc(sql`sum(${smsMessages.segments})`)).limit(10);

      const topEmailRows = await db.select({
        companyId: emailsSent.companyId,
        emailCount: count(),
      }).from(emailsSent).groupBy(emailsSent.companyId).orderBy(desc(count())).limit(10);

      const companyNames: Record<string, string> = {};
      const allCompanies = await db.select({ id: companies.id, name: companies.name }).from(companies);
      for (const c of allCompanies) {
        companyNames[c.id] = c.name;
      }

      const topAccountsBySms = topSmsRows.map(r => ({
        companyId: r.companyId,
        companyName: companyNames[r.companyId] || "Unknown",
        smsCount: Number(r.smsCount),
        cost: Math.round(Number(r.smsCount) * SMS_COST_PER_SEGMENT_CENTS) / 10000,
      }));

      const topAccountsByEmail = topEmailRows.map(r => ({
        companyId: r.companyId,
        companyName: companyNames[r.companyId] || "Unknown",
        emailCount: Number(r.emailCount),
        cost: Math.round(Number(r.emailCount) * EMAIL_COST_PER_UNIT_CENTS) / 10000,
      }));

      const anomalies: { companyId: string; companyName: string; type: string; current: number; trailing7dAvg: number }[] = [];

      const recentSms = await db.select({
        companyId: smsMessages.companyId,
        cnt: count(),
      }).from(smsMessages)
        .where(gte(smsMessages.createdAt, yesterday))
        .groupBy(smsMessages.companyId);

      for (const row of recentSms) {
        const [trailing] = await db.select({ cnt: count() }).from(smsMessages)
          .where(and(
            eq(smsMessages.companyId, row.companyId),
            gte(smsMessages.createdAt, eightDaysAgo),
            lt(smsMessages.createdAt, yesterday)
          ));
        const avg = (trailing?.cnt ?? 0) / 7;
        if (avg > 0 && Number(row.cnt) > avg * 3) {
          anomalies.push({
            companyId: row.companyId,
            companyName: companyNames[row.companyId] || "Unknown",
            type: "sms_spike",
            current: Number(row.cnt),
            trailing7dAvg: Math.round(avg * 100) / 100,
          });
        }
      }

      const monthlyVolume: { month: string; sms: number; email: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
        const mKey = monthKey(d);

        const [smsM] = await db.select({ total: sql<number>`coalesce(sum(${smsMessages.segments}), 0)` })
          .from(smsMessages).where(and(gte(smsMessages.createdAt, d), lte(smsMessages.createdAt, mEnd)));
        const [emailM] = await db.select({ total: count() })
          .from(emailsSent).where(and(gte(emailsSent.createdAt, d), lte(emailsSent.createdAt, mEnd)));

        monthlyVolume.push({
          month: mKey,
          sms: Number(smsM?.total ?? 0),
          email: Number(emailM?.total ?? 0),
        });
      }

      res.json({
        totalSmsSent,
        totalSmsReceived,
        totalEmailsSent: totalEmailsSentCount,
        estimatedSmsCost: Math.round(estimatedSmsCost * 100) / 100,
        estimatedEmailCost: Math.round(estimatedEmailCost * 100) / 100,
        topAccountsBySms,
        topAccountsByEmail,
        anomalies,
        monthlyVolume,
      });
    } catch (err) {
      console.error("Messaging analytics error:", err);
      res.status(500).json({ error: "Failed to compute messaging analytics" });
    }
  });

  // 7. Unit Economics
  app.get("/api/admin/analytics/unit-economics", isAdmin as any, async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const allCompanies = await db.select().from(companies);
      const allSaasCosts = await db.select().from(saasCostsMonthly);
      const saasCostMap: Record<string, any> = {};
      for (const sc of allSaasCosts) {
        saasCostMap[sc.month] = sc;
      }

      const currentActive = allCompanies.filter(c => c.subscriptionStatus === "active");
      const currentActiveAccounts = currentActive.length;
      const currentMrr = currentActive.reduce((s, c) => s + getTierPrice(c.subscriptionTier), 0);
      const avgRevenuePerAccount = currentActiveAccounts > 0 ? currentMrr / currentActiveAccounts : 0;

      const months: any[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
        const mKey = monthKey(d);

        const activeForMonth = allCompanies.filter(c =>
          c.createdAt <= mEnd &&
          (c.subscriptionStatus === "active" || (c.canceledAt && c.canceledAt > mEnd))
        );
        const revenueGross = activeForMonth.reduce((s, c) => s + getTierPrice(c.subscriptionTier), 0);

        const monthPaidInvoices = await db.select().from(invoices).where(and(
          eq(invoices.status, "paid"),
          gte(invoices.paidAt, d),
          lte(invoices.paidAt, mEnd)
        ));
        const paidTotal = monthPaidInvoices.reduce((s, inv) => s + parseFloat(inv.total), 0);
        const stripeFees = (paidTotal * STRIPE_PCT / 100) + (monthPaidInvoices.length * STRIPE_FIXED_CENTS / 100);

        const [smsM] = await db.select({ total: sql<number>`coalesce(sum(${smsMessages.segments}), 0)` })
          .from(smsMessages).where(and(gte(smsMessages.createdAt, d), lte(smsMessages.createdAt, mEnd)));
        const [emailM] = await db.select({ total: count() })
          .from(emailsSent).where(and(gte(emailsSent.createdAt, d), lte(emailsSent.createdAt, mEnd)));

        const twilioCost = (Number(smsM?.total ?? 0) * SMS_COST_PER_SEGMENT_CENTS) / 100;
        const sendgridCost = (Number(emailM?.total ?? 0) * EMAIL_COST_PER_UNIT_CENTS) / 100;
        const totalVariableCosts = stripeFees + twilioCost + sendgridCost;

        const sc = saasCostMap[mKey];
        const fixedCosts = sc
          ? ((sc.hostingCents + sc.dbCents + sc.emailPlatformCents + sc.smsPlatformCents + sc.monitoringCents + sc.otherCents + sc.supportLaborCents) / 100)
          : 0;

        const contributionMargin = revenueGross - totalVariableCosts;
        const contributionMarginPct = revenueGross > 0 ? (contributionMargin / revenueGross) * 100 : 0;
        const netMargin = revenueGross - totalVariableCosts - fixedCosts;
        const netMarginPct = revenueGross > 0 ? (netMargin / revenueGross) * 100 : 0;

        months.push({
          month: mKey,
          revenueGross: Math.round(revenueGross * 100) / 100,
          stripeFees: Math.round(stripeFees * 100) / 100,
          twilioCost: Math.round(twilioCost * 100) / 100,
          sendgridCost: Math.round(sendgridCost * 100) / 100,
          totalVariableCosts: Math.round(totalVariableCosts * 100) / 100,
          fixedCosts: Math.round(fixedCosts * 100) / 100,
          contributionMargin: Math.round(contributionMargin * 100) / 100,
          contributionMarginPct: Math.round(contributionMarginPct * 100) / 100,
          netMargin: Math.round(netMargin * 100) / 100,
          netMarginPct: Math.round(netMarginPct * 100) / 100,
        });
      }

      const latestFixedCosts = months[months.length - 1]?.fixedCosts ?? 0;
      const breakEvenAccounts = avgRevenuePerAccount > 0 ? Math.ceil(latestFixedCosts / avgRevenuePerAccount) : 0;

      res.json({
        months,
        breakEvenAccounts,
        currentActiveAccounts,
        avgRevenuePerAccount: Math.round(avgRevenuePerAccount * 100) / 100,
      });
    } catch (err) {
      console.error("Unit economics analytics error:", err);
      res.status(500).json({ error: "Failed to compute unit economics analytics" });
    }
  });
}
