import type { Express, Request, Response } from "express";
import { eq, and, gte, lte, count, sql, desc, lt, or } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import {
  companies,
  companyUsers,
  contacts,
  servicePlans,
  invoices,
  visits,
  smsMessages,
  emailsSent,
  saasCostsMonthly,
  TIER_CONFIG,
  messages,
  messageAttachments,
  messageExceptions,
  voiceCalls,
  quoteFormEvents,
  apiUsageDaily,
} from "@shared/schema";

const SMS_COST_PER_SEGMENT_CENTS = 75;
const EMAIL_COST_PER_UNIT_CENTS = 10;
const VOICE_COST_PER_MINUTE_CENTS = 50;
const MAPBOX_GEOCODE_COST_CENTS = 0.075;
const MAPBOX_DIRECTIONS_COST_CENTS = 0.075;
const OPENAI_CALL_COST_CENTS = 0.3;
const STRIPE_PCT = 2.9;
const STRIPE_FIXED_CENTS = 30;

const PLAN_WEIGHT: Record<string, number> = {
  tier_1: 1,
  tier_1_3: 2,
  tier_3_5: 3,
  tier_6_10: 5,
  tier_10_plus: 8,
};

function getPlanWeight(tier: string): number {
  return PLAN_WEIGHT[tier] ?? 1;
}

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

export function registerAdminAnalyticsRoutes(app: Express, isAdmin: Function) {
  // 1. Executive Overview
  app.get(
    "/api/admin/analytics/executive",
    isAdmin as any,
    async (_req: Request, res: Response) => {
      try {
        const now = new Date();
        const thisMonthStart = monthStart(now);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

        const allCompanies = await db.select().from(companies);

        const activeCompanies = allCompanies.filter((c) => c.subscriptionStatus === "active");
        const activeAccounts = activeCompanies.length;
        const totalAccounts = allCompanies.length;

        const mrr = activeCompanies.reduce((sum, c) => sum + getTierPrice(c.subscriptionTier), 0);
        const arr = mrr * 12;

        const newThisMonth = activeCompanies.filter((c) => c.createdAt >= thisMonthStart);
        const newMrrThisMonth = newThisMonth.reduce(
          (sum, c) => sum + getTierPrice(c.subscriptionTier),
          0
        );

        const canceledThisMonth = allCompanies.filter(
          (c) =>
            c.subscriptionStatus === "cancelled" && c.canceledAt && c.canceledAt >= thisMonthStart
        );
        const churnedMrrThisMonth = canceledThisMonth.reduce(
          (sum, c) => sum + getTierPrice(c.subscriptionTier),
          0
        );

        const activeAtStartOfMonth = allCompanies.filter(
          (c) =>
            c.createdAt < thisMonthStart &&
            (c.subscriptionStatus === "active" ||
              (c.subscriptionStatus === "cancelled" &&
                c.canceledAt &&
                c.canceledAt >= thisMonthStart))
        ).length;
        const logoChurnPct =
          activeAtStartOfMonth > 0 ? (canceledThisMonth.length / activeAtStartOfMonth) * 100 : 0;

        const lastMonthActive = allCompanies.filter(
          (c) =>
            c.createdAt <= lastMonthEnd &&
            (c.subscriptionStatus === "active" ||
              (c.subscriptionStatus === "cancelled" && c.canceledAt && c.canceledAt > lastMonthEnd))
        );
        const lastMonthMrr = lastMonthActive.reduce(
          (sum, c) => sum + getTierPrice(c.subscriptionTier),
          0
        );
        const nrr = lastMonthMrr > 0 ? (mrr / lastMonthMrr) * 100 : 100;
        const grr =
          lastMonthMrr > 0
            ? Math.min(100, ((lastMonthMrr - churnedMrrThisMonth) / lastMonthMrr) * 100)
            : 100;

        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const [smsCountResult] = await db
          .select({ total: sql<number>`coalesce(sum(${smsMessages.segments}), 0)` })
          .from(smsMessages)
          .where(gte(smsMessages.createdAt, thirtyDaysAgo));
        const [emailCountResult] = await db
          .select({ total: count() })
          .from(emailsSent)
          .where(gte(emailsSent.createdAt, thirtyDaysAgo));
        const [voiceMinResult] = await db
          .select({ total: sql<number>`coalesce(sum(${voiceCalls.durationMinutes}), 0)` })
          .from(voiceCalls)
          .where(gte(voiceCalls.createdAt, thirtyDaysAgo));

        const totalSmsSeg = Number(smsCountResult?.total ?? 0);
        const totalEmailCount = Number(emailCountResult?.total ?? 0);
        const totalVoiceMin = Number(voiceMinResult?.total ?? 0);
        const telnyxCost = (totalSmsSeg * SMS_COST_PER_SEGMENT_CENTS) / 10000;
        const emailCost = (totalEmailCount * EMAIL_COST_PER_UNIT_CENTS) / 10000;
        const voiceCost = (totalVoiceMin * VOICE_COST_PER_MINUTE_CENTS) / 100;

        const paidInvs30d = await db
          .select()
          .from(invoices)
          .where(and(eq(invoices.status, "paid"), gte(invoices.paidAt, thirtyDaysAgo)));
        const paidTotal30d = paidInvs30d.reduce((s, inv) => s + parseFloat(inv.total), 0);
        const stripeFees =
          (paidTotal30d * STRIPE_PCT) / 100 + (paidInvs30d.length * STRIPE_FIXED_CENTS) / 100;

        const currentMonthKey = monthKey(now);
        const [currentMonthCost] = await db
          .select()
          .from(saasCostsMonthly)
          .where(eq(saasCostsMonthly.month, currentMonthKey));
        const fixedCosts = currentMonthCost
          ? (currentMonthCost.hostingCents +
              currentMonthCost.dbCents +
              currentMonthCost.emailPlatformCents +
              currentMonthCost.smsPlatformCents +
              currentMonthCost.monitoringCents +
              currentMonthCost.otherCents +
              currentMonthCost.supportLaborCents) /
            100
          : 0;

        const totalOverhead = telnyxCost + emailCost + voiceCost + stripeFees + fixedCosts;
        const estimatedGrossMarginPct = mrr > 0 ? ((mrr - totalOverhead) / mrr) * 100 : 0;

        res.json({
          activeAccounts,
          totalAccounts,
          mrr,
          arr,
          newMrrThisMonth,
          churnedMrrThisMonth,
          logoChurnPct,
          nrr: Math.round(nrr * 100) / 100,
          grr: Math.round(grr * 100) / 100,
          totalOverhead: Math.round(totalOverhead * 100) / 100,
          telnyxCost: Math.round(telnyxCost * 100) / 100,
          emailCost: Math.round(emailCost * 100) / 100,
          voiceCost: Math.round(voiceCost * 100) / 100,
          stripeFees: Math.round(stripeFees * 100) / 100,
          fixedCosts: Math.round(fixedCosts * 100) / 100,
          estimatedGrossMarginPct: Math.round(estimatedGrossMarginPct * 100) / 100,
        });
      } catch (err) {
        console.error("Executive analytics error:", err);
        res.status(500).json({ error: "Failed to compute executive analytics" });
      }
    }
  );

  // 2. Accounts
  app.get("/api/admin/analytics/accounts", isAdmin as any, async (req: Request, res: Response) => {
    try {
      const filter = req.query.filter as string | undefined;
      const search = req.query.search as string | undefined;
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      let allCompanies = await db.select().from(companies);

      const allActive = allCompanies.filter((c) => c.subscriptionStatus === "active");
      const totalActiveWeight = allActive.reduce(
        (s, c) => s + getPlanWeight(c.subscriptionTier),
        0
      );
      const currentMonthKey = monthKey(now);
      const allSaasCosts = await db.select().from(saasCostsMonthly);
      const currentMonthCost = allSaasCosts.find((sc) => sc.month === currentMonthKey);
      const monthlyFixedTotal = currentMonthCost
        ? (currentMonthCost.hostingCents +
            currentMonthCost.dbCents +
            currentMonthCost.emailPlatformCents +
            currentMonthCost.smsPlatformCents +
            currentMonthCost.monitoringCents +
            currentMonthCost.otherCents +
            currentMonthCost.supportLaborCents) /
          100
        : 0;
      const fixedCostPerWeight = totalActiveWeight > 0 ? monthlyFixedTotal / totalActiveWeight : 0;

      if (search) {
        const s = search.toLowerCase();
        allCompanies = allCompanies.filter((c) => c.name.toLowerCase().includes(s));
      }

      const results = await Promise.all(
        allCompanies.map(async (c) => {
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
            db
              .select({ cnt: count() })
              .from(contacts)
              .where(and(eq(contacts.companyId, c.id), eq(contacts.status, "active"))),
            db.select({ cnt: count() }).from(servicePlans).where(eq(servicePlans.companyId, c.id)),
            db
              .select({ cnt: count() })
              .from(servicePlans)
              .where(
                and(
                  eq(servicePlans.companyId, c.id),
                  eq(servicePlans.isActive, true),
                  or(
                    eq(servicePlans.frequency, "weekly"),
                    eq(servicePlans.frequency, "biweekly"),
                    eq(servicePlans.frequency, "monthly")
                  )
                )
              ),
            db
              .select({ maxDate: sql<string>`max(${visits.scheduledDate})` })
              .from(visits)
              .where(eq(visits.companyId, c.id)),
            db
              .select({ cnt: count() })
              .from(invoices)
              .where(
                and(
                  eq(invoices.companyId, c.id),
                  eq(invoices.status, "failed"),
                  gte(invoices.createdAt, thirtyDaysAgo)
                )
              ),
            db.select({ cnt: count() }).from(invoices).where(eq(invoices.companyId, c.id)),
            db
              .select({ cnt: count() })
              .from(invoices)
              .where(and(eq(invoices.companyId, c.id), eq(invoices.status, "paid"))),
            db
              .select({ total: sql<number>`coalesce(sum(${smsMessages.segments}), 0)` })
              .from(smsMessages)
              .where(
                and(eq(smsMessages.companyId, c.id), gte(smsMessages.createdAt, thirtyDaysAgo))
              ),
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
          const smsCost30dCents = Math.round((smsSeg30d * SMS_COST_PER_SEGMENT_CENTS) / 100);

          const mrrCents = Math.round(getTierPrice(c.subscriptionTier) * 100);
          const accountWeight = getPlanWeight(c.subscriptionTier);
          const allocatedFixedCostCents = Math.round(accountWeight * fixedCostPerWeight * 100);
          const estimatedMargin30d = mrrCents - smsCost30dCents - allocatedFixedCostCents;

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
        })
      );

      let filtered = results;
      if (filter === "inactive_14d") {
        filtered = results.filter(
          (r) => !r.lastVisitDate || new Date(r.lastVisitDate) < fourteenDaysAgo
        );
      } else if (filter === "high_sms_cost") {
        filtered = results.filter((r) => r.smsCost30dCents > r.mrrCents * 0.5);
      } else if (filter === "failed_payments") {
        filtered = results.filter((r) => r.failedPayments30d > 0);
      } else if (filter === "not_activated_7d") {
        filtered = results.filter((r) => !r.isActivated && new Date(r.createdAt) < sevenDaysAgo);
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
      const failedInvoices = allInvoices.filter((i) => i.status === "failed");
      const paidInvoices = allInvoices.filter((i) => i.status === "paid");
      const refundedInvoices = allInvoices.filter((i) => i.status === "refunded");
      const pastDueInvoices = allInvoices.filter(
        (i) => (i.status === "pending" || i.status === "draft") && i.dueDate < todayStr
      );

      const failedPaymentRate =
        totalInvoices > 0 ? (failedInvoices.length / totalInvoices) * 100 : 0;
      const recoveryRate =
        failedInvoices.length > 0
          ? (paidInvoices.filter((p) => p.paymentAttempts > 1).length / failedInvoices.length) * 100
          : 0;

      const pastDueCount = pastDueInvoices.length;
      const pastDueAmount = pastDueInvoices.reduce((sum, i) => sum + parseFloat(i.total), 0);
      const refundCount = refundedInvoices.length;
      const refundAmount = refundedInvoices.reduce((sum, i) => sum + parseFloat(i.total), 0);

      const paidTotal = paidInvoices.reduce((sum, i) => sum + parseFloat(i.total), 0);
      const totalStripeFees =
        (paidTotal * STRIPE_PCT) / 100 + (paidInvoices.length * STRIPE_FIXED_CENTS) / 100;

      const invoicesByStatus: Record<string, number> = {};
      for (const inv of allInvoices) {
        invoicesByStatus[inv.status] = (invoicesByStatus[inv.status] || 0) + 1;
      }

      const monthlyPayments: { month: string; amount: number; count: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
        const mKey = monthKey(d);
        const monthPaid = paidInvoices.filter((inv) => {
          const paidDate = inv.paidAt || inv.updatedAt;
          return paidDate >= d && paidDate <= mEnd;
        });
        monthlyPayments.push({
          month: mKey,
          amount:
            Math.round(monthPaid.reduce((s, inv) => s + parseFloat(inv.total), 0) * 100) / 100,
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
  app.get(
    "/api/admin/analytics/retention",
    isAdmin as any,
    async (_req: Request, res: Response) => {
      try {
        const now = new Date();
        const allCompanies = await db.select().from(companies);

        const cohorts: {
          month: string;
          started: number;
          retained: number[];
          retentionPct: number[];
        }[] = [];
        for (let i = 5; i >= 0; i--) {
          const cohortDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const cohortEnd = new Date(
            cohortDate.getFullYear(),
            cohortDate.getMonth() + 1,
            0,
            23,
            59,
            59,
            999
          );
          const mKey = monthKey(cohortDate);

          const cohortCompanies = allCompanies.filter(
            (c) => c.createdAt >= cohortDate && c.createdAt <= cohortEnd
          );
          const started = cohortCompanies.length;

          const retained: number[] = [];
          const retentionPct: number[] = [];
          for (
            let m = 0;
            m <=
            now.getMonth() -
              cohortDate.getMonth() +
              (now.getFullYear() - cohortDate.getFullYear()) * 12;
            m++
          ) {
            const checkDate = new Date(
              cohortDate.getFullYear(),
              cohortDate.getMonth() + m + 1,
              0,
              23,
              59,
              59,
              999
            );
            if (checkDate > now) break;

            const activeCount = cohortCompanies.filter(
              (c) => c.subscriptionStatus === "active" || (c.canceledAt && c.canceledAt > checkDate)
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

        const canceledCompanies = allCompanies.filter((c) => c.subscriptionStatus === "cancelled");
        for (const c of canceledCompanies) {
          const reason = c.churnReason || "unknown";
          churnReasons[reason] = (churnReasons[reason] || 0) + 1;
          churnByPlan[c.subscriptionTier] = (churnByPlan[c.subscriptionTier] || 0) + 1;

          const cancelDate = c.canceledAt || c.updatedAt;
          const tenureDays = Math.floor(
            (cancelDate.getTime() - c.createdAt.getTime()) / (1000 * 60 * 60 * 24)
          );
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
          churnByTenure: tenureBuckets.map((b) => ({ bucket: b.bucket, count: b.count })),
        });
      } catch (err) {
        console.error("Retention analytics error:", err);
        res.status(500).json({ error: "Failed to compute retention analytics" });
      }
    }
  );

  // 5. Activation
  app.get(
    "/api/admin/analytics/activation",
    isAdmin as any,
    async (_req: Request, res: Response) => {
      try {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const allCompanies = await db.select().from(companies);
        const totalAccounts = allCompanies.length;

        const activationResults = await Promise.all(
          allCompanies.map(async (c) => {
            const [contactResult, recurringResult, invoiceResult] = await Promise.all([
              db.select({ cnt: count() }).from(contacts).where(eq(contacts.companyId, c.id)),
              db
                .select({ cnt: count() })
                .from(servicePlans)
                .where(
                  and(
                    eq(servicePlans.companyId, c.id),
                    eq(servicePlans.isActive, true),
                    or(
                      eq(servicePlans.frequency, "weekly"),
                      eq(servicePlans.frequency, "biweekly"),
                      eq(servicePlans.frequency, "monthly")
                    )
                  )
                ),
              db.select({ cnt: count() }).from(invoices).where(eq(invoices.companyId, c.id)),
            ]);

            const contactCount = contactResult[0]?.cnt ?? 0;
            const recurringCount = recurringResult[0]?.cnt ?? 0;
            const invoiceCount = invoiceResult[0]?.cnt ?? 0;
            const isActivated = contactCount >= 10 && recurringCount >= 1 && invoiceCount >= 1;

            return { company: c, isActivated, contactCount };
          })
        );

        const activatedCount = activationResults.filter((r) => r.isActivated).length;
        const activationRate = totalAccounts > 0 ? (activatedCount / totalAccounts) * 100 : 0;

        const activatedCompanies = activationResults.filter((r) => r.isActivated);
        let avgDaysToActivation = 0;
        if (activatedCompanies.length > 0) {
          const totalDays = activatedCompanies.reduce((sum, r) => {
            const days = Math.floor(
              (now.getTime() - r.company.createdAt.getTime()) / (1000 * 60 * 60 * 24)
            );
            return sum + Math.min(days, 90);
          }, 0);
          avgDaysToActivation = Math.round(totalDays / activatedCompanies.length);
        }

        const notActivated7d = activationResults.filter(
          (r) => !r.isActivated && r.company.createdAt < sevenDaysAgo
        ).length;

        const byPlan: { plan: string; total: number; activated: number; rate: number }[] = [];
        const tiers = Object.keys(TIER_CONFIG) as (keyof typeof TIER_CONFIG)[];
        for (const tier of tiers) {
          const tierResults = activationResults.filter((r) => r.company.subscriptionTier === tier);
          const tierActivated = tierResults.filter((r) => r.isActivated).length;
          byPlan.push({
            plan: tier,
            total: tierResults.length,
            activated: tierActivated,
            rate:
              tierResults.length > 0
                ? Math.round((tierActivated / tierResults.length) * 10000) / 100
                : 0,
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
    }
  );

  // 6. Messaging costs (legacy — used by admin overview)
  app.get(
    "/api/admin/analytics/messaging-costs",
    isAdmin as any,
    async (_req: Request, res: Response) => {
      try {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

        const [smsSentResult] = await db
          .select({ total: sql<number>`coalesce(sum(${smsMessages.segments}), 0)` })
          .from(smsMessages)
          .where(eq(smsMessages.direction, "outbound"));
        const [smsRecvResult] = await db
          .select({ total: count() })
          .from(smsMessages)
          .where(eq(smsMessages.direction, "inbound"));
        const [emailTotalResult] = await db.select({ total: count() }).from(emailsSent);

        const totalSmsSent = Number(smsSentResult?.total ?? 0);
        const totalSmsReceived = Number(smsRecvResult?.total ?? 0);
        const totalEmailsSentCount = Number(emailTotalResult?.total ?? 0);
        const estimatedSmsCost = (totalSmsSent * SMS_COST_PER_SEGMENT_CENTS) / 10000;
        const estimatedEmailCost = (totalEmailsSentCount * EMAIL_COST_PER_UNIT_CENTS) / 10000;

        const topSmsRows = await db
          .select({
            companyId: smsMessages.companyId,
            smsCount: sql<number>`coalesce(sum(${smsMessages.segments}), 0)`,
          })
          .from(smsMessages)
          .groupBy(smsMessages.companyId)
          .orderBy(desc(sql`sum(${smsMessages.segments})`))
          .limit(10);

        const topEmailRows = await db
          .select({
            companyId: emailsSent.companyId,
            emailCount: count(),
          })
          .from(emailsSent)
          .groupBy(emailsSent.companyId)
          .orderBy(desc(count()))
          .limit(10);

        const companyNames: Record<string, string> = {};
        const allCompanies = await db
          .select({ id: companies.id, name: companies.name })
          .from(companies);
        for (const c of allCompanies) {
          companyNames[c.id] = c.name;
        }

        const topAccountsBySms = topSmsRows.map((r) => ({
          companyId: r.companyId,
          companyName: companyNames[r.companyId] || "Unknown",
          smsCount: Number(r.smsCount),
          cost: Math.round(Number(r.smsCount) * SMS_COST_PER_SEGMENT_CENTS) / 10000,
        }));

        const topAccountsByEmail = topEmailRows.map((r) => ({
          companyId: r.companyId,
          companyName: companyNames[r.companyId] || "Unknown",
          emailCount: Number(r.emailCount),
          cost: Math.round(Number(r.emailCount) * EMAIL_COST_PER_UNIT_CENTS) / 10000,
        }));

        const anomalies: {
          companyId: string;
          companyName: string;
          type: string;
          current: number;
          trailing7dAvg: number;
        }[] = [];

        const recentSms = await db
          .select({
            companyId: smsMessages.companyId,
            cnt: count(),
          })
          .from(smsMessages)
          .where(gte(smsMessages.createdAt, yesterday))
          .groupBy(smsMessages.companyId);

        for (const row of recentSms) {
          const [trailing] = await db
            .select({ cnt: count() })
            .from(smsMessages)
            .where(
              and(
                eq(smsMessages.companyId, row.companyId),
                gte(smsMessages.createdAt, eightDaysAgo),
                lt(smsMessages.createdAt, yesterday)
              )
            );
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

          const [smsM] = await db
            .select({ total: sql<number>`coalesce(sum(${smsMessages.segments}), 0)` })
            .from(smsMessages)
            .where(and(gte(smsMessages.createdAt, d), lte(smsMessages.createdAt, mEnd)));
          const [emailM] = await db
            .select({ total: count() })
            .from(emailsSent)
            .where(and(gte(emailsSent.createdAt, d), lte(emailsSent.createdAt, mEnd)));

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
    }
  );

  // 7a. Customer Costs — per-account itemized cost breakdown
  app.get(
    "/api/admin/analytics/customer-costs",
    isAdmin as any,
    async (_req: Request, res: Response) => {
      try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const allCompanies = await db.select().from(companies);
        const allActive = allCompanies.filter((c) => c.subscriptionStatus === "active");
        const totalActiveWeight = allActive.reduce(
          (s, c) => s + getPlanWeight(c.subscriptionTier),
          0
        );

        const currentMonthKey = monthKey(now);
        const allSaasCosts = await db.select().from(saasCostsMonthly);
        const currentMonthCost = allSaasCosts.find((sc) => sc.month === currentMonthKey);
        const monthlyFixedTotal = currentMonthCost
          ? (currentMonthCost.hostingCents +
              currentMonthCost.dbCents +
              currentMonthCost.emailPlatformCents +
              currentMonthCost.smsPlatformCents +
              currentMonthCost.monitoringCents +
              currentMonthCost.otherCents +
              currentMonthCost.supportLaborCents) /
            100
          : 0;
        const fixedCostPerWeight =
          totalActiveWeight > 0 ? monthlyFixedTotal / totalActiveWeight : 0;

        const rows = await Promise.all(
          allCompanies.map(async (c) => {
            const [smsResult, emailResult, voiceResult, paidInvoiceResult] = await Promise.all([
              db
                .select({ total: sql<number>`coalesce(sum(${smsMessages.segments}), 0)` })
                .from(smsMessages)
                .where(
                  and(eq(smsMessages.companyId, c.id), gte(smsMessages.createdAt, thirtyDaysAgo))
                ),
              db
                .select({ total: count() })
                .from(emailsSent)
                .where(
                  and(eq(emailsSent.companyId, c.id), gte(emailsSent.createdAt, thirtyDaysAgo))
                ),
              db
                .select({ total: sql<number>`coalesce(sum(${voiceCalls.durationMinutes}), 0)` })
                .from(voiceCalls)
                .where(
                  and(eq(voiceCalls.companyId, c.id), gte(voiceCalls.createdAt, thirtyDaysAgo))
                ),
              db
                .select()
                .from(invoices)
                .where(
                  and(
                    eq(invoices.companyId, c.id),
                    eq(invoices.status, "paid"),
                    gte(invoices.paidAt, thirtyDaysAgo)
                  )
                ),
            ]);

            const smsSegments = Number(smsResult[0]?.total ?? 0);
            const emailCount = Number(emailResult[0]?.total ?? 0);
            const voiceMinutes = Number(voiceResult[0]?.total ?? 0);
            const paidInvs = paidInvoiceResult;
            const paidTotal = paidInvs.reduce((s, inv) => s + parseFloat(inv.total), 0);

            const smsCostCents = Math.round((smsSegments * SMS_COST_PER_SEGMENT_CENTS) / 100);
            const emailCostCents = Math.round((emailCount * EMAIL_COST_PER_UNIT_CENTS) / 100);
            const voiceCostCents = voiceMinutes * VOICE_COST_PER_MINUTE_CENTS;
            const stripeFeesPassedThrough = !!c.passStripeFees;
            const stripeFeesCents = stripeFeesPassedThrough
              ? 0
              : Math.round(paidTotal * STRIPE_PCT) + paidInvs.length * STRIPE_FIXED_CENTS;
            const rawStripeFeesCents =
              Math.round(paidTotal * STRIPE_PCT) + paidInvs.length * STRIPE_FIXED_CENTS;

            const accountWeight = getPlanWeight(c.subscriptionTier);
            const allocatedInfraCents = Math.round(accountWeight * fixedCostPerWeight * 100);

            const totalCostCents =
              smsCostCents +
              emailCostCents +
              voiceCostCents +
              stripeFeesCents +
              allocatedInfraCents;
            const mrrCents =
              c.subscriptionStatus === "active"
                ? Math.round(getTierPrice(c.subscriptionTier) * 100)
                : 0;
            const netMarginCents = mrrCents - totalCostCents;
            const costRatioPct =
              mrrCents > 0
                ? Math.round((totalCostCents / mrrCents) * 10000) / 100
                : totalCostCents > 0
                  ? 999
                  : 0;

            return {
              id: c.id,
              name: c.name,
              subscriptionTier: c.subscriptionTier,
              subscriptionStatus: c.subscriptionStatus,
              mrrCents,
              smsCostCents,
              smsSegments,
              emailCostCents,
              emailCount,
              voiceCostCents,
              voiceMinutes,
              stripeFeesCents,
              rawStripeFeesCents,
              stripeFeesPassedThrough,
              paidInvoiceCount: paidInvs.length,
              paidInvoiceTotal: Math.round(paidTotal * 100) / 100,
              allocatedInfraCents,
              totalCostCents,
              netMarginCents,
              costRatioPct,
            };
          })
        );

        rows.sort((a, b) => b.totalCostCents - a.totalCostCents);

        const totalPlatformCostCents = rows.reduce((s, r) => s + r.totalCostCents, 0);
        const avgCostPerCustomerCents =
          rows.length > 0 ? Math.round(totalPlatformCostCents / rows.length) : 0;
        const unprofitableCount = rows.filter((r) => r.netMarginCents < 0).length;
        const highestCostRow = rows.reduce(
          (max, r) => (r.totalCostCents > (max?.totalCostCents ?? 0) ? r : max),
          rows[0]
        );

        res.json({
          rows,
          summary: {
            totalPlatformCostCents,
            avgCostPerCustomerCents,
            unprofitableCount,
            highestCostCustomer: highestCostRow
              ? {
                  id: highestCostRow.id,
                  name: highestCostRow.name,
                  totalCostCents: highestCostRow.totalCostCents,
                }
              : null,
            totalCustomers: rows.length,
          },
        });
      } catch (err) {
        console.error("Customer costs analytics error:", err);
        res.status(500).json({ error: "Failed to compute customer costs analytics" });
      }
    }
  );

  // 7b. Unit Economics
  app.get(
    "/api/admin/analytics/unit-economics",
    isAdmin as any,
    async (_req: Request, res: Response) => {
      try {
        const now = new Date();
        const allCompanies = await db.select().from(companies);
        const allSaasCosts = await db.select().from(saasCostsMonthly);
        const saasCostMap: Record<string, any> = {};
        for (const sc of allSaasCosts) {
          saasCostMap[sc.month] = sc;
        }

        const currentActive = allCompanies.filter((c) => c.subscriptionStatus === "active");
        const currentActiveAccounts = currentActive.length;
        const currentMrr = currentActive.reduce((s, c) => s + getTierPrice(c.subscriptionTier), 0);
        const avgRevenuePerAccount =
          currentActiveAccounts > 0 ? currentMrr / currentActiveAccounts : 0;

        const months: any[] = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
          const mKey = monthKey(d);

          const activeForMonth = allCompanies.filter(
            (c) =>
              c.createdAt <= mEnd &&
              (c.subscriptionStatus === "active" || (c.canceledAt && c.canceledAt > mEnd))
          );
          const revenueGross = activeForMonth.reduce(
            (s, c) => s + getTierPrice(c.subscriptionTier),
            0
          );

          const totalActiveWeight = activeForMonth.reduce(
            (s, c) => s + getPlanWeight(c.subscriptionTier),
            0
          );

          const monthPaidInvoices = await db
            .select()
            .from(invoices)
            .where(
              and(eq(invoices.status, "paid"), gte(invoices.paidAt, d), lte(invoices.paidAt, mEnd))
            );
          const paidTotal = monthPaidInvoices.reduce((s, inv) => s + parseFloat(inv.total), 0);
          const stripeFees =
            (paidTotal * STRIPE_PCT) / 100 + (monthPaidInvoices.length * STRIPE_FIXED_CENTS) / 100;

          const [smsM] = await db
            .select({ total: sql<number>`coalesce(sum(${smsMessages.segments}), 0)` })
            .from(smsMessages)
            .where(and(gte(smsMessages.createdAt, d), lte(smsMessages.createdAt, mEnd)));
          const [emailM] = await db
            .select({ total: count() })
            .from(emailsSent)
            .where(and(gte(emailsSent.createdAt, d), lte(emailsSent.createdAt, mEnd)));

          const telnyxCost = (Number(smsM?.total ?? 0) * SMS_COST_PER_SEGMENT_CENTS) / 10000;
          const emailCost = (Number(emailM?.total ?? 0) * EMAIL_COST_PER_UNIT_CENTS) / 10000;
          const totalVariableCosts = stripeFees + telnyxCost + emailCost;

          const sc = saasCostMap[mKey];
          const fixedCosts = sc
            ? (sc.hostingCents +
                sc.dbCents +
                sc.emailPlatformCents +
                sc.smsPlatformCents +
                sc.monitoringCents +
                sc.otherCents +
                sc.supportLaborCents) /
              100
            : 0;

          const costPerWeight = totalActiveWeight > 0 ? fixedCosts / totalActiveWeight : 0;

          const contributionMargin = revenueGross - totalVariableCosts;
          const contributionMarginPct =
            revenueGross > 0 ? (contributionMargin / revenueGross) * 100 : 0;
          const netMargin = revenueGross - totalVariableCosts - fixedCosts;
          const netMarginPct = revenueGross > 0 ? (netMargin / revenueGross) * 100 : 0;

          const perAccountFixed: Record<string, number> = {};
          for (const c of activeForMonth) {
            const w = getPlanWeight(c.subscriptionTier);
            perAccountFixed[c.id] = Math.round(w * costPerWeight * 100) / 100;
          }

          months.push({
            month: mKey,
            revenueGross: Math.round(revenueGross * 100) / 100,
            stripeFees: Math.round(stripeFees * 100) / 100,
            telnyxCost: Math.round(telnyxCost * 100) / 100,
            emailCost: Math.round(emailCost * 100) / 100,
            totalVariableCosts: Math.round(totalVariableCosts * 100) / 100,
            fixedCosts: Math.round(fixedCosts * 100) / 100,
            totalActiveWeight,
            costPerWeight: Math.round(costPerWeight * 100) / 100,
            contributionMargin: Math.round(contributionMargin * 100) / 100,
            contributionMarginPct: Math.round(contributionMarginPct * 100) / 100,
            netMargin: Math.round(netMargin * 100) / 100,
            netMarginPct: Math.round(netMarginPct * 100) / 100,
            perAccountFixed,
          });
        }

        const latestFixedCosts = months[months.length - 1]?.fixedCosts ?? 0;
        const breakEvenAccounts =
          avgRevenuePerAccount > 0 ? Math.ceil(latestFixedCosts / avgRevenuePerAccount) : 0;

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
    }
  );

  app.get(
    "/api/admin/analytics/messaging",
    isAdmin as any,
    async (_req: Request, res: Response) => {
      try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const allCompanies = await db
          .select({
            id: companies.id,
            name: companies.name,
            messageRetentionDays: companies.messageRetentionDays,
          })
          .from(companies);

        const [msgStats] = await db
          .select({
            total: count(),
            smsCount: sql<number>`count(*) filter (where ${messages.channel} = 'sms')`,
            emailCount: sql<number>`count(*) filter (where ${messages.channel} = 'email')`,
            inboundCount: sql<number>`count(*) filter (where ${messages.direction} = 'inbound')`,
            outboundCount: sql<number>`count(*) filter (where ${messages.direction} = 'outbound')`,
            last30Days: sql<number>`count(*) filter (where ${messages.createdAt} >= ${thirtyDaysAgo})`,
          })
          .from(messages);

        const [attachStats] = await db
          .select({
            total: count(),
            totalOriginalBytes: sql<number>`coalesce(sum(${messageAttachments.originalSizeBytes}), 0)`,
            totalCompressedBytes: sql<number>`coalesce(sum(${messageAttachments.compressedSizeBytes}), 0)`,
          })
          .from(messageAttachments);

        const [exceptionStats] = await db
          .select({
            total: count(),
            unresolved: sql<number>`count(*) filter (where ${messageExceptions.resolvedAt} is null)`,
          })
          .from(messageExceptions);

        const perTenant = [];
        for (const co of allCompanies) {
          const [stats] = await db
            .select({
              total: count(),
              sms: sql<number>`count(*) filter (where ${messages.channel} = 'sms')`,
              email: sql<number>`count(*) filter (where ${messages.channel} = 'email')`,
            })
            .from(messages)
            .where(eq(messages.companyId, co.id));

          const [attStats] = await db
            .select({
              count: count(),
              bytes: sql<number>`coalesce(sum(${messageAttachments.compressedSizeBytes}), 0)`,
            })
            .from(messageAttachments)
            .where(eq(messageAttachments.companyId, co.id));

          perTenant.push({
            companyId: co.id,
            companyName: co.name,
            retentionDays: co.messageRetentionDays,
            totalMessages: stats?.total ?? 0,
            smsMessages: stats?.sms ?? 0,
            emailMessages: stats?.email ?? 0,
            attachments: attStats?.count ?? 0,
            storageBytes: attStats?.bytes ?? 0,
          });
        }

        const compressionSavings =
          Number(attachStats?.totalOriginalBytes ?? 0) -
          Number(attachStats?.totalCompressedBytes ?? 0);

        res.json({
          overview: {
            totalMessages: msgStats?.total ?? 0,
            smsMessages: msgStats?.smsCount ?? 0,
            emailMessages: msgStats?.emailCount ?? 0,
            inbound: msgStats?.inboundCount ?? 0,
            outbound: msgStats?.outboundCount ?? 0,
            last30Days: msgStats?.last30Days ?? 0,
          },
          storage: {
            totalAttachments: attachStats?.total ?? 0,
            totalOriginalBytes: Number(attachStats?.totalOriginalBytes ?? 0),
            totalCompressedBytes: Number(attachStats?.totalCompressedBytes ?? 0),
            compressionSavingsBytes: compressionSavings,
            compressionSavingsPct: attachStats?.totalOriginalBytes
              ? Math.round((compressionSavings / Number(attachStats.totalOriginalBytes)) * 100)
              : 0,
          },
          exceptions: {
            total: exceptionStats?.total ?? 0,
            unresolved: exceptionStats?.unresolved ?? 0,
          },
          perTenant: perTenant.sort((a, b) => b.totalMessages - a.totalMessages),
        });
      } catch (err) {
        console.error("Messaging analytics error:", err);
        res.status(500).json({ error: "Failed to compute messaging analytics" });
      }
    }
  );

  app.post(
    "/api/admin/messaging/run-cleanup",
    isAdmin as any,
    async (_req: Request, res: Response) => {
      try {
        const { runMessageCleanup } = await import("./jobs/message-cleanup");
        const result = await runMessageCleanup();
        res.json({ success: true, ...result });
      } catch (err) {
        console.error("Manual cleanup error:", err);
        res.status(500).json({ error: "Failed to run message cleanup" });
      }
    }
  );

  app.patch(
    "/api/admin/companies/:companyId/messaging-config",
    isAdmin as any,
    async (req: Request, res: Response) => {
      try {
        const companyId = String(req.params.companyId);
        const { messageRetentionDays } = req.body;

        const company = await storage.getCompany(companyId);
        if (!company) {
          return res.status(404).json({ error: "Company not found" });
        }

        if (messageRetentionDays !== undefined) {
          const days = parseInt(messageRetentionDays, 10);
          if (isNaN(days) || days < 1 || days > 365) {
            return res
              .status(400)
              .json({ error: "messageRetentionDays must be between 1 and 365" });
          }
          await db
            .update(companies)
            .set({ messageRetentionDays: days })
            .where(eq(companies.id, companyId));
        }

        const updated = await storage.getCompany(companyId);
        res.json({ success: true, messageRetentionDays: updated?.messageRetentionDays ?? 30 });
      } catch (err) {
        console.error("Update messaging config error:", err);
        res.status(500).json({ error: "Failed to update messaging config" });
      }
    }
  );

  app.get(
    "/api/admin/analytics/fixed-costs",
    isAdmin as any,
    async (_req: Request, res: Response) => {
      try {
        const rows = await storage.getAllSaasCosts();
        res.json(rows);
      } catch (err) {
        console.error("Fixed costs fetch error:", err);
        res.status(500).json({ error: "Failed to fetch fixed costs" });
      }
    }
  );

  app.put(
    "/api/admin/analytics/fixed-costs",
    isAdmin as any,
    async (req: Request, res: Response) => {
      try {
        const {
          month,
          hostingCents,
          dbCents,
          emailPlatformCents,
          smsPlatformCents,
          monitoringCents,
          otherCents,
          supportLaborCents,
        } = req.body;
        if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
          return res
            .status(400)
            .json({ error: "Invalid month format (expected YYYY-MM with valid month 01-12)" });
        }
        const toInt = (v: any) => {
          const n = Number(v ?? 0);
          return isFinite(n) ? Math.round(n) : 0;
        };
        const result = await storage.upsertSaasCosts({
          month,
          hostingCents: toInt(hostingCents),
          dbCents: toInt(dbCents),
          emailPlatformCents: toInt(emailPlatformCents),
          smsPlatformCents: toInt(smsPlatformCents),
          monitoringCents: toInt(monitoringCents),
          otherCents: toInt(otherCents),
          supportLaborCents: toInt(supportLaborCents),
        });
        res.json(result);
      } catch (err) {
        console.error("Fixed costs upsert error:", err);
        res.status(500).json({ error: "Failed to save fixed costs" });
      }
    }
  );

  app.get(
    "/api/admin/analytics/quote-funnel",
    isAdmin as any,
    async (req: Request, res: Response) => {
      try {
        const days = Math.min(Number(req.query.days) || 30, 365);
        const companyFilter = req.query.companyId as string | undefined;
        const since = new Date(Date.now() - days * 86400000);

        const conditions = [gte(quoteFormEvents.createdAt, since)];
        if (companyFilter) conditions.push(eq(quoteFormEvents.companyId, companyFilter));

        const eventCounts = await db
          .select({
            event: quoteFormEvents.event,
            cnt: count(),
          })
          .from(quoteFormEvents)
          .where(and(...conditions))
          .groupBy(quoteFormEvents.event);

        const funnelMap: Record<string, number> = {};
        for (const r of eventCounts) funnelMap[r.event] = Number(r.cnt);

        const sessionCounts = await db
          .select({
            event: quoteFormEvents.event,
            sessions: sql<number>`COUNT(DISTINCT ${quoteFormEvents.sessionId})`,
          })
          .from(quoteFormEvents)
          .where(and(...conditions))
          .groupBy(quoteFormEvents.event);

        const sessionMap: Record<string, number> = {};
        for (const r of sessionCounts) sessionMap[r.event] = Number(r.sessions);

        const totalSessions = await db
          .select({ cnt: sql<number>`COUNT(DISTINCT ${quoteFormEvents.sessionId})` })
          .from(quoteFormEvents)
          .where(and(...conditions));

        const embedVsDirect = await db
          .select({
            isEmbed: quoteFormEvents.isEmbed,
            sessions: sql<number>`COUNT(DISTINCT ${quoteFormEvents.sessionId})`,
          })
          .from(quoteFormEvents)
          .where(and(...conditions))
          .groupBy(quoteFormEvents.isEmbed);

        const embedMap: Record<string, number> = {};
        for (const r of embedVsDirect) {
          embedMap[r.isEmbed ? "embed" : "direct"] = Number(r.sessions);
        }

        const dailyRows = await db
          .select({
            day: sql<string>`TO_CHAR(${quoteFormEvents.createdAt}, 'YYYY-MM-DD')`,
            event: quoteFormEvents.event,
            cnt: sql<number>`COUNT(DISTINCT ${quoteFormEvents.sessionId})`,
          })
          .from(quoteFormEvents)
          .where(and(...conditions))
          .groupBy(sql`TO_CHAR(${quoteFormEvents.createdAt}, 'YYYY-MM-DD')`, quoteFormEvents.event)
          .orderBy(sql`TO_CHAR(${quoteFormEvents.createdAt}, 'YYYY-MM-DD')`);

        const dailyMap: Record<string, Record<string, number>> = {};
        for (const r of dailyRows) {
          if (!dailyMap[r.day]) dailyMap[r.day] = {};
          dailyMap[r.day][r.event] = Number(r.cnt);
        }

        const byCompanyRows = await db
          .select({
            companyId: quoteFormEvents.companyId,
            event: quoteFormEvents.event,
            sessions: sql<number>`COUNT(DISTINCT ${quoteFormEvents.sessionId})`,
          })
          .from(quoteFormEvents)
          .where(and(...conditions))
          .groupBy(quoteFormEvents.companyId, quoteFormEvents.event);

        const companyMap: Record<string, Record<string, number>> = {};
        for (const r of byCompanyRows) {
          if (!companyMap[r.companyId]) companyMap[r.companyId] = {};
          companyMap[r.companyId][r.event] = Number(r.sessions);
        }

        const companyIds = Object.keys(companyMap);
        const companyNames: Record<string, string> = {};
        if (companyIds.length > 0) {
          const names = await db
            .select({ id: companies.id, name: companies.name })
            .from(companies)
            .where(
              sql`${companies.id} IN (${sql.join(
                companyIds.map((id) => sql`${id}`),
                sql`, `
              )})`
            );
          for (const c of names) companyNames[c.id] = c.name;
        }

        const byCompany = companyIds
          .map((id) => ({
            companyId: id,
            companyName: companyNames[id] || id,
            loaded: companyMap[id].form_loaded || 0,
            zipPassed: companyMap[id].zip_passed || 0,
            submitted: companyMap[id].submitted || 0,
            quoteShown: companyMap[id].quote_shown || 0,
            conversionPct: companyMap[id].form_loaded
              ? ((companyMap[id].submitted || 0) / companyMap[id].form_loaded) * 100
              : 0,
          }))
          .sort((a, b) => b.loaded - a.loaded);

        const loaded = sessionMap.form_loaded || 0;
        const makeFunnelStep = (step: string, event: string) => {
          const sessions = sessionMap[event] || 0;
          return { step, event, sessions, pct: loaded > 0 ? (sessions / loaded) * 100 : 0 };
        };
        const funnel = [
          makeFunnelStep("Form Loaded", "form_loaded"),
          makeFunnelStep("ZIP Entered", "zip_entered"),
          makeFunnelStep("ZIP Passed", "zip_passed"),
          makeFunnelStep("Service Details Done", "step2_completed"),
          makeFunnelStep("Contact Started", "step3_started"),
          makeFunnelStep("Submitted", "submitted"),
          makeFunnelStep("Quote Shown", "quote_shown"),
        ];

        const topZips = await db
          .select({
            zipCode: quoteFormEvents.zipCode,
            submissions: sql<number>`COUNT(DISTINCT ${quoteFormEvents.sessionId})`,
          })
          .from(quoteFormEvents)
          .where(
            and(
              ...conditions,
              eq(quoteFormEvents.event, "submitted"),
              sql`${quoteFormEvents.zipCode} IS NOT NULL`
            )
          )
          .groupBy(quoteFormEvents.zipCode)
          .orderBy(sql`COUNT(DISTINCT ${quoteFormEvents.sessionId}) DESC`)
          .limit(15);

        res.json({
          days,
          totalSessions: Number(totalSessions[0]?.cnt || 0),
          totalEvents: Object.values(funnelMap).reduce((a, b) => a + b, 0),
          funnel,
          embedVsDirect: embedMap,
          daily: dailyMap,
          byCompany: byCompany.slice(0, 20),
          topZipCodes: topZips.map((z) => ({
            zipCode: z.zipCode,
            submissions: Number(z.submissions),
          })),
          overallConversion: loaded > 0 ? ((sessionMap.submitted || 0) / loaded) * 100 : 0,
        });
      } catch (err) {
        console.error("Quote funnel analytics error:", err);
        res.status(500).json({ error: "Failed to load funnel data" });
      }
    }
  );

  app.get("/api/admin/api-usage", async (req: Request, res: Response) => {
    try {
      const days = Number(req.query.days) || 30;
      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceStr = since.toISOString().slice(0, 10);

      const apiRows = await db
        .select({
          date: apiUsageDaily.date,
          provider: apiUsageDaily.provider,
          metric: apiUsageDaily.metric,
          calls: apiUsageDaily.calls,
        })
        .from(apiUsageDaily)
        .where(gte(apiUsageDaily.date, sinceStr))
        .orderBy(apiUsageDaily.date);

      const smsTotals = await db
        .select({ calls: sql<number>`COALESCE(SUM(segment_count), 0)` })
        .from(smsMessages)
        .where(gte(smsMessages.createdAt, since));

      const emailTotals = await db
        .select({ calls: sql<number>`COUNT(*)` })
        .from(emailsSent)
        .where(gte(emailsSent.createdAt, since));

      const voiceTotals = await db
        .select({ minutes: sql<number>`COALESCE(SUM(duration_seconds) / 60.0, 0)` })
        .from(voiceCalls)
        .where(gte(voiceCalls.createdAt, since));

      const stripeTotals = await db
        .select({
          calls: sql<number>`COUNT(*)`,
          totalCents: sql<number>`COALESCE(SUM(amount_cents), 0)`,
        })
        .from(invoices)
        .where(and(gte(invoices.createdAt, since), eq(invoices.status, "paid")));

      const smsDaily = await db
        .select({
          date: sql<string>`DATE(${smsMessages.createdAt})`,
          calls: sql<number>`COALESCE(SUM(segment_count), 0)`,
        })
        .from(smsMessages)
        .where(gte(smsMessages.createdAt, since))
        .groupBy(sql`DATE(${smsMessages.createdAt})`)
        .orderBy(sql`DATE(${smsMessages.createdAt})`);

      const emailDaily = await db
        .select({
          date: sql<string>`DATE(${emailsSent.createdAt})`,
          calls: sql<number>`COUNT(*)`,
        })
        .from(emailsSent)
        .where(gte(emailsSent.createdAt, since))
        .groupBy(sql`DATE(${emailsSent.createdAt})`)
        .orderBy(sql`DATE(${emailsSent.createdAt})`);

      const voiceDaily = await db
        .select({
          date: sql<string>`DATE(${voiceCalls.createdAt})`,
          minutes: sql<number>`COALESCE(SUM(duration_seconds) / 60.0, 0)`,
        })
        .from(voiceCalls)
        .where(gte(voiceCalls.createdAt, since))
        .groupBy(sql`DATE(${voiceCalls.createdAt})`)
        .orderBy(sql`DATE(${voiceCalls.createdAt})`);

      const aggregated: Record<
        string,
        { calls: number; costCents: number; daily: Record<string, number> }
      > = {};

      for (const row of apiRows) {
        const key = `${row.provider}:${row.metric}`;
        if (!aggregated[key]) aggregated[key] = { calls: 0, costCents: 0, daily: {} };
        const calls = Number(row.calls);
        aggregated[key].calls += calls;
        const date = String(row.date);
        aggregated[key].daily[date] = (aggregated[key].daily[date] || 0) + calls;

        if (row.provider === "mapbox" && row.metric === "geocode") {
          aggregated[key].costCents += calls * MAPBOX_GEOCODE_COST_CENTS;
        } else if (row.provider === "mapbox" && row.metric === "directions") {
          aggregated[key].costCents += calls * MAPBOX_DIRECTIONS_COST_CENTS;
        } else if (row.provider === "openai") {
          aggregated[key].costCents += calls * OPENAI_CALL_COST_CENTS;
        }
      }

      const smsCalls = Number(smsTotals[0]?.calls || 0);
      const emailCalls = Number(emailTotals[0]?.calls || 0);
      const voiceMinutes = Number(voiceTotals[0]?.minutes || 0);
      const stripeTransactions = Number(stripeTotals[0]?.calls || 0);
      const stripeTotalCents = Number(stripeTotals[0]?.totalCents || 0);

      const providers = [
        {
          provider: "mapbox",
          metric: "geocode",
          label: "Mapbox Geocoding",
          calls: aggregated["mapbox:geocode"]?.calls || 0,
          costCents: aggregated["mapbox:geocode"]?.costCents || 0,
          daily: aggregated["mapbox:geocode"]?.daily || {},
          unit: "geocodes",
        },
        {
          provider: "mapbox",
          metric: "directions",
          label: "Mapbox Directions",
          calls: aggregated["mapbox:directions"]?.calls || 0,
          costCents: aggregated["mapbox:directions"]?.costCents || 0,
          daily: aggregated["mapbox:directions"]?.daily || {},
          unit: "route requests",
        },
        {
          provider: "openai",
          metric: "rover_chat",
          label: "OpenAI (Rover AI)",
          calls: aggregated["openai:rover_chat"]?.calls || 0,
          costCents: aggregated["openai:rover_chat"]?.costCents || 0,
          daily: aggregated["openai:rover_chat"]?.daily || {},
          unit: "completions",
        },
        {
          provider: "telnyx",
          metric: "sms",
          label: "Telnyx SMS",
          calls: smsCalls,
          costCents: smsCalls * SMS_COST_PER_SEGMENT_CENTS,
          daily: Object.fromEntries(smsDaily.map((r) => [r.date, Number(r.calls)])),
          unit: "segments",
        },
        {
          provider: "sendgrid",
          metric: "email",
          label: "SendGrid Email",
          calls: emailCalls,
          costCents: emailCalls * EMAIL_COST_PER_UNIT_CENTS,
          daily: Object.fromEntries(emailDaily.map((r) => [r.date, Number(r.calls)])),
          unit: "emails",
        },
        {
          provider: "retell",
          metric: "voice",
          label: "Retell Voice AI",
          calls: Math.round(voiceMinutes),
          costCents: voiceMinutes * VOICE_COST_PER_MINUTE_CENTS,
          daily: Object.fromEntries(voiceDaily.map((r) => [r.date, Math.round(Number(r.minutes))])),
          unit: "minutes",
        },
        {
          provider: "stripe",
          metric: "payments",
          label: "Stripe Payments",
          calls: stripeTransactions,
          costCents:
            (stripeTotalCents * STRIPE_PCT) / 100 + stripeTransactions * STRIPE_FIXED_CENTS,
          daily: {},
          unit: "transactions",
        },
      ];

      const totalCalls = providers.reduce((a, p) => a + p.calls, 0);
      const totalCostCents = providers.reduce((a, p) => a + p.costCents, 0);

      res.json({ providers, totalCalls, totalCostCents, days });
    } catch (err) {
      console.error("API usage analytics error:", err);
      res.status(500).json({ error: "Failed to load API usage data" });
    }
  });
}
