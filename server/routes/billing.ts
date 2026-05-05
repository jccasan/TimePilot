import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { sql, eq, and, lt, gte, isNotNull, or, inArray } from "drizzle-orm";
import { users, contacts, invoices, agreements as agreementsTable } from "@shared/schema";
import {
  isStripeConfigured,
  chargeInvoiceAutomatically,
  createSubscriptionCheckout,
  createCustomerPortalSession,
  fetchStripePrices,
  getCachedStripePrices,
  createVoicePlanCheckout,
  ensureConnectedCustomer,
} from "../services/stripe";
import { getAutocompleteCached, setAutocompleteCache } from "../services/geocode";
import { trackApiCall, getApiUsageStats } from "../services/api-usage";
import { TIER_CONFIG, VOICE_PLAN_CONFIG } from "@shared/schema";

import {
  isAuthenticated,
  getCompanyContext,
  requireRole,
  getBaseUrl,
  handleError,
  auditLog,
  p,
  notify,
  qboAutoSync,
} from "./shared";

export async function registerBillingRoutes(app: Express): Promise<void> {
  // ================ Subscription Billing ================

  const TIER_PRICE_MAP: Record<string, string> = {
    tier_starter: process.env.STRIPE_PRICE_TIER_STARTER || "",
    tier_1: process.env.STRIPE_PRICE_TIER_1 || "",
    tier_1_3: process.env.STRIPE_PRICE_TIER_1_3 || "",
    tier_3_5: process.env.STRIPE_PRICE_TIER_3_5 || "",
    tier_6_10: process.env.STRIPE_PRICE_TIER_6_10 || "",
    tier_10_plus: process.env.STRIPE_PRICE_TIER_10_PLUS || "",
  };

  app.post("/api/subscriptions/create-checkout", async (req: Request, res: Response) => {
    try {
      if (!isStripeConfigured()) return res.status(400).json({ error: "Stripe not configured" });

      const { tier, email, companyName, firstName, lastName, phone } = req.body;
      if (!tier) return res.status(400).json({ error: "tier is required" });
      if (!email) return res.status(400).json({ error: "email is required" });
      if (!companyName) return res.status(400).json({ error: "companyName is required" });
      if (!firstName) return res.status(400).json({ error: "firstName is required" });

      const resolvedPriceId = TIER_PRICE_MAP[tier];
      if (!resolvedPriceId) {
        console.error(
          `[Checkout] Invalid or unconfigured tier: "${tier}". Configured tiers: ${Object.entries(
            TIER_PRICE_MAP
          )
            .filter(([, v]) => !!v)
            .map(([k]) => k)
            .join(", ")}`
        );
        return res.status(400).json({
          error: `Invalid tier: ${tier}. Valid tiers: ${Object.keys(TIER_PRICE_MAP).join(", ")}`,
        });
      }

      const baseUrl = getBaseUrl(req);

      let customerId: string | undefined;
      try {
        const { companyId } = await getCompanyContext(req);
        const company = await storage.getCompany(companyId);
        if (company?.stripeCustomerId) customerId = company.stripeCustomerId;
      } catch (_noAuth) {}

      let tenantId = "";
      try {
        const ctx = await getCompanyContext(req);
        tenantId = ctx.companyId;
      } catch (_noAuth) {}

      const result = await createSubscriptionCheckout({
        customerEmail: email,
        customerId,
        priceId: resolvedPriceId,
        successUrl: `${baseUrl}/billing?success=1`,
        cancelUrl: `${baseUrl}/billing?cancelled=1`,
        trialDays: 14,
        companyName,
        metadata: {
          plan_tier: tier,
          company_name: companyName,
          email,
          first_name: firstName,
          last_name: lastName || "",
          phone: phone || "",
          ...(tenantId ? { tenant_id: tenantId } : {}),
        },
      });
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/billing/portal", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      if (!company.stripeCustomerId)
        return res.status(400).json({ error: "No Stripe customer linked" });
      if (!isStripeConfigured()) return res.status(400).json({ error: "Stripe not configured" });

      const baseUrl = getBaseUrl(req);
      const url = await createCustomerPortalSession({
        customerId: company.stripeCustomerId,
        returnUrl: `${baseUrl}/billing`,
      });
      res.json({ url });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/billing/seat-checkout", isAuthenticated, async (req: Request, res: Response) => {
    try {
      if (!isStripeConfigured()) return res.status(400).json({ error: "Stripe not configured" });
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const priceId = process.env.STRIPE_PRICE_SEAT_ADDON || "price_1TRiS0GVMaTr43jX34RtXqoY";
      if (!priceId) return res.status(400).json({ error: "Seat add-on price not configured" });

      const baseUrl = getBaseUrl(req);
      const { default: StripeLib } = await import("stripe");
      const stripeLib = new StripeLib(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: "2026-01-28.clover" as const,
      });

      const seatDescription = company.name ? `Seat add-on \u2013 ${company.name}` : "Seat add-on";

      const sessionParams: import("stripe").Stripe.Checkout.SessionCreateParams = {
        mode: "payment",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/settings?seatAdded=1`,
        cancel_url: `${baseUrl}/settings`,
        payment_intent_data: {
          description: seatDescription,
          metadata: {
            type: "seat_purchase",
            companyId,
            ...(company.name ? { companyName: company.name } : {}),
          },
        },
        metadata: { type: "seat_purchase", companyId },
      };

      if (company.stripeCustomerId) {
        sessionParams.customer = company.stripeCustomerId;
      } else if (company.email) {
        sessionParams.customer_email = company.email;
      }

      console.log(`[seat-checkout] Creating session for company ${companyId}, priceId=${priceId}`);
      const session = await stripeLib.checkout.sessions.create(sessionParams);
      console.log(
        `[seat-checkout] Session created: ${session.id}, url=${session.url ? "ok" : "null"}`
      );
      if (!session.url) {
        return res.status(500).json({ error: "Stripe did not return a checkout URL" });
      }
      res.json({ url: session.url });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/billing/usage", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const endOfMonth = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59
      ).toISOString();

      const summary = await storage.getUsageSummary(companyId, startOfMonth, endOfMonth);
      const activeUsers = await storage.countActiveCompanyUsers(companyId);
      const tierConfig = company
        ? TIER_CONFIG[company.subscriptionTier as keyof typeof TIER_CONFIG]
        : null;

      const voiceMinutesAllowance = company?.voicePlanIncludedMinutes ?? 100;

      res.json({
        period: {
          start: startOfMonth,
          end: endOfMonth,
        },
        usage: {
          smsSegments: summary.smsSegments,
          voiceMinutes: summary.voiceMinutes,
          activeUsers,
        },
        allowances: {
          maxUsers: company?.customMaxUsers ?? tierConfig?.maxUsers ?? 1,
          smsSegmentsIncluded: 500,
          voiceMinutesIncluded: voiceMinutesAllowance,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/billing/subscription", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const tierConfig = TIER_CONFIG[company.subscriptionTier as keyof typeof TIER_CONFIG] || null;
      const activeUsers = await storage.countActiveCompanyUsers(companyId);
      let stripePrices = getCachedStripePrices();
      if (!stripePrices && isStripeConfigured()) {
        stripePrices = await fetchStripePrices();
      }
      const displayPrice = stripePrices?.[company.subscriptionTier] ?? tierConfig?.price ?? 0;

      const voicePlanConfig = company.voicePlanTier
        ? VOICE_PLAN_CONFIG[company.voicePlanTier as keyof typeof VOICE_PLAN_CONFIG] || null
        : null;

      res.json({
        tier: company.subscriptionTier,
        tierName: tierConfig?.name || "Unknown",
        status: company.subscriptionStatus,
        price: displayPrice,
        maxUsers: company.customMaxUsers ?? tierConfig?.maxUsers ?? 1,
        customMaxUsers: company.customMaxUsers,
        activeUsers,
        frozenAt: company.frozenAt,
        trialEndsAt: company.trialEndsAt,
        stripeCustomerId: company.stripeCustomerId,
        hasStripeSubscription: !!company.stripeSubscriptionId,
        voicePlan: company.voicePlanTier
          ? {
              tier: company.voicePlanTier,
              name: voicePlanConfig?.name || company.voicePlanTier,
              status: company.voicePlanStatus || "inactive",
              includedMinutes: company.voicePlanIncludedMinutes || 0,
              overageRate: company.voicePlanOverageRate
                ? parseFloat(company.voicePlanOverageRate)
                : 0,
              dedicatedPhoneNumber: company.dedicatedPhoneNumber || null,
            }
          : null,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Geocode Proxy (Mapbox) ================

  app.get("/api/billing/health", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const now = new Date();
      const sevenDaysLater = new Date(now);
      sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
      const nowDateStr = now.toISOString().slice(0, 10);
      const sevenDaysStr = sevenDaysLater.toISOString().slice(0, 10);

      const allContacts = await db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          autoPayEnabled: contacts.autoPayEnabled,
          stripeCustomerId: contacts.stripeCustomerId,
        })
        .from(contacts)
        .where(eq(contacts.companyId, companyId));

      const totalCustomers = allContacts.length;
      const autopayContacts = allContacts.filter((c) => c.autoPayEnabled);
      const autopayCustomers = autopayContacts.length;
      const autopayPercent =
        totalCustomers > 0 ? Math.round((autopayCustomers / totalCustomers) * 100) : 0;

      const missingPaymentMethodContacts = autopayContacts.filter((c) => !c.stripeCustomerId);
      const missingPaymentMethod = missingPaymentMethodContacts.length;

      const [failedInvoices, activeAgreements] = await Promise.all([
        db
          .select({ id: invoices.id, contactId: invoices.contactId, total: invoices.total })
          .from(invoices)
          .where(and(eq(invoices.companyId, companyId), eq(invoices.status, "failed"))),
        db
          .select({ contactId: agreementsTable.contactId })
          .from(agreementsTable)
          .where(and(eq(agreementsTable.companyId, companyId), eq(agreementsTable.isActive, true))),
      ]);
      const failedPayments = failedInvoices.length;

      const contactsWithActiveAgreement = new Set(activeAgreements.map((a) => a.contactId));
      const autopayContactIds = new Set(autopayContacts.map((c) => c.id));
      const noRuleContacts = autopayContacts.filter((c) => !contactsWithActiveAgreement.has(c.id));

      const upcomingInvoices = await db
        .select({
          id: invoices.id,
          contactId: invoices.contactId,
          total: invoices.total,
          dueDate: invoices.dueDate,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.companyId, companyId),
            or(
              eq(invoices.status, "sent"),
              eq(invoices.status, "pending"),
              eq(invoices.status, "draft")
            ),
            sql`${invoices.dueDate} >= ${nowDateStr}`,
            sql`${invoices.dueDate} <= ${sevenDaysStr}`
          )
        );

      const autopayUpcomingInvoices = upcomingInvoices.filter((inv) =>
        autopayContactIds.has(inv.contactId)
      );
      const upcomingChargesTotal = autopayUpcomingInvoices.reduce(
        (sum, inv) => sum + Math.round(parseFloat(inv.total) * 100),
        0
      );
      const upcomingChargesCustomers = new Set(autopayUpcomingInvoices.map((inv) => inv.contactId))
        .size;

      const byDate: Record<
        string,
        { customers: Set<string>; totalCents: number; invoiceIds: string[] }
      > = {};
      for (const inv of autopayUpcomingInvoices) {
        const d = inv.dueDate;
        if (!byDate[d]) byDate[d] = { customers: new Set(), totalCents: 0, invoiceIds: [] };
        byDate[d].customers.add(inv.contactId);
        byDate[d].totalCents += Math.round(parseFloat(inv.total) * 100);
        byDate[d].invoiceIds.push(inv.id);
      }
      const upcomingCharges = Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, info]) => ({
          date,
          customers: info.customers.size,
          totalCents: info.totalCents,
          invoiceIds: info.invoiceIds,
        }));

      const misconfigurations: Array<{ contactId: string; contactName: string; issue: string }> =
        [];
      const contactMap = new Map(allContacts.map((c) => [c.id, c]));
      for (const c of missingPaymentMethodContacts) {
        misconfigurations.push({
          contactId: c.id,
          contactName: `${c.firstName} ${c.lastName}`.trim(),
          issue: "no_payment_method",
        });
      }
      const failedContactIdSet = new Set(failedInvoices.map((i) => i.contactId));
      for (const contactId of failedContactIdSet) {
        const c = contactMap.get(contactId);
        if (c)
          misconfigurations.push({
            contactId: c.id,
            contactName: `${c.firstName} ${c.lastName}`.trim(),
            issue: "failed_charge",
          });
      }
      for (const c of noRuleContacts) {
        misconfigurations.push({
          contactId: c.id,
          contactName: `${c.firstName} ${c.lastName}`.trim(),
          issue: "no_billing_rule",
        });
      }

      res.json({
        autopayCustomers,
        totalCustomers,
        autopayPercent,
        autopayContacts: autopayContacts.map((c) => ({
          id: c.id,
          name: `${c.firstName} ${c.lastName}`.trim(),
        })),
        missingPaymentMethod,
        failedPayments,
        upcomingChargesTotal,
        upcomingChargesCustomers,
        upcomingCharges,
        misconfigurations,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  async function chargeInvoiceInternal(
    invoiceId: string,
    companyId: string,
    userId: string | null,
    ipAddress?: string
  ): Promise<{ status: string }> {
    const invoice = await storage.getInvoice(invoiceId, companyId);
    if (!invoice || invoice.status === "paid") return { status: "skipped" };
    const contact = await storage.getContact(invoice.contactId, companyId);
    if (!contact?.stripeCustomerId) return { status: "no_payment_method" };
    const company = await storage.getCompany(companyId);
    const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;
    const contactName = `${contact.firstName} ${contact.lastName}`.trim();
    const { customerId: resolvedCustomerId, wasRecreated } = await ensureConnectedCustomer({
      currentCustomerId: contact.stripeCustomerId,
      stripeAccount: connectAcct,
      email: contact.email || undefined,
      name: contactName,
      metadata: { contactId: contact.id, companyId },
    });
    if (wasRecreated)
      await storage.updateContact(contact.id, companyId, { stripeCustomerId: resolvedCustomerId });
    const result = await chargeInvoiceAutomatically({
      customerId: resolvedCustomerId,
      amount: parseFloat(invoice.total),
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      clientName: contactName,
      stripeConnectAccountId: connectAcct,
      tenantId: companyId,
      currency: company?.currency || "usd",
    });
    const updateData: Partial<Record<keyof import("@shared/schema").InsertInvoice, unknown>> & {
      paidAt?: Date | null;
      lastPaymentAttempt?: Date | null;
    } = {
      paymentAttempts: (invoice.paymentAttempts || 0) + 1,
      lastPaymentAttempt: new Date(),
    };
    if (result.status === "succeeded") {
      updateData.status = "paid";
      updateData.paidAt = new Date();
      updateData.stripePaymentIntentId = result.paymentIntentId;
      notify(
        companyId,
        "invoice_paid",
        "Invoice Paid",
        `Invoice #${invoice.invoiceNumber} has been paid ($${invoice.total}).`,
        `/invoices`
      );
      qboAutoSync(companyId, invoice.id, "payment");
    } else if (result.status === "no_payment_method") {
      // No card on file — leave the invoice in its current status so it can still be paid via link
      updateData.status = invoice.status === "draft" ? "draft" : "sent";
      notify(
        companyId,
        "payment_failed",
        "No Payment Method",
        `No payment method on file for ${contactName} (invoice #${invoice.invoiceNumber}). Send them a payment link to collect their card.`,
        `/invoices`
      );
      try {
        const { fireAutomationTrigger } = await import("../services/automation-runner");
        await fireAutomationTrigger("payment_failed", companyId, {
          invoiceId: invoice.id,
          reason: "no_payment_method",
        });
      } catch (autoErr) {
        console.error("[automation] payment_failed trigger error:", autoErr);
      }
    } else {
      updateData.status = "failed";
      if (result.paymentIntentId) updateData.stripePaymentIntentId = result.paymentIntentId;
      notify(
        companyId,
        "payment_failed",
        "Payment Failed",
        `Payment failed for invoice #${invoice.invoiceNumber}. The card on file was declined.`,
        `/invoices`
      );
      try {
        const { fireAutomationTrigger } = await import("../services/automation-runner");
        await fireAutomationTrigger("payment_failed", companyId, {
          invoiceId: invoice.id,
          reason: "card_declined",
        });
      } catch (autoErr) {
        console.error("[automation] payment_failed trigger error:", autoErr);
      }
    }
    const updated = await storage.updateInvoice(
      invoice.id,
      companyId,
      updateData as Parameters<typeof storage.updateInvoice>[2]
    );
    auditLog(
      companyId,
      userId,
      "invoice",
      invoice.id,
      "update",
      {
        old: { status: invoice.status, paymentAttempts: invoice.paymentAttempts },
        new: {
          status: updated.status,
          paymentAttempts: updated.paymentAttempts,
          chargeResult: result.status,
        },
      },
      ipAddress
    );
    return { status: result.status };
  }

  app.post("/api/billing/charge-by-date", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const { date } = req.body;
      if (!date) return res.status(400).json({ error: "date is required" });

      const autopayEligible = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.companyId, companyId),
            eq(contacts.autoPayEnabled, true),
            isNotNull(contacts.stripeCustomerId)
          )
        );
      const autopayContactIds = new Set(autopayEligible.map((c) => c.id));

      const dateInvoices = await db
        .select({ id: invoices.id, contactId: invoices.contactId })
        .from(invoices)
        .where(
          and(
            eq(invoices.companyId, companyId),
            or(
              eq(invoices.status, "sent"),
              eq(invoices.status, "pending"),
              eq(invoices.status, "draft")
            ),
            eq(invoices.dueDate, date)
          )
        );

      const toCharge = dateInvoices.filter((inv) => autopayContactIds.has(inv.contactId));
      const results: Array<{ invoiceId: string; status: string }> = [];
      for (const inv of toCharge) {
        try {
          const chargeResult = await chargeInvoiceInternal(
            inv.id,
            companyId,
            userId,
            req.ip || undefined
          );
          results.push({ invoiceId: inv.id, status: chargeResult.status });
        } catch {
          results.push({ invoiceId: inv.id, status: "error" });
        }
      }

      res.json({ charged: results.length, results });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/billing/prices", isAuthenticated, async (_req: Request, res: Response) => {
    try {
      let stripePrices = getCachedStripePrices();
      if (!stripePrices && isStripeConfigured()) {
        stripePrices = await fetchStripePrices();
      }
      const result: Record<
        string,
        { name: string; price: number; maxUsers: number; maxContacts: number | null }
      > = {};
      for (const [tier, config] of Object.entries(TIER_CONFIG)) {
        if (!config.visible) continue;
        result[tier] = {
          name: config.name,
          price: stripePrices?.[tier] ?? config.price,
          maxUsers: config.maxUsers,
          maxContacts:
            ((config as Record<string, unknown>).maxContacts as number | null | undefined) ?? null,
        };
      }
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  const VOICE_PRICE_MAP: Record<string, string | undefined> = {
    voice_bootstrap: process.env.STRIPE_PRICE_VOICE_BOOTSTRAP,
    voice_starter: process.env.STRIPE_PRICE_VOICE_STARTER,
    voice_pro: process.env.STRIPE_PRICE_VOICE_PRO,
  };

  const VOICE_COUPON_MAP: Record<string, string | undefined> = {
    voice_bootstrap: process.env.STRIPE_COUPON_VOICE_BOOTSTRAP_SUBSCRIBER,
    voice_starter: process.env.STRIPE_COUPON_VOICE_STARTER_SUBSCRIBER,
    voice_pro: process.env.STRIPE_COUPON_VOICE_PRO_SUBSCRIBER,
  };

  app.post("/api/billing/voice-checkout", isAuthenticated, async (req: Request, res: Response) => {
    try {
      if (!isStripeConfigured()) return res.status(400).json({ error: "Stripe not configured" });
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      if (company.voicePlanStatus === "active")
        return res.status(400).json({ error: "Voice plan already active" });

      const { plan } = req.body;
      if (!plan || !(plan in VOICE_PRICE_MAP)) {
        return res
          .status(400)
          .json({ error: `Invalid voice plan. Valid: ${Object.keys(VOICE_PRICE_MAP).join(", ")}` });
      }

      const priceId = VOICE_PRICE_MAP[plan];
      if (!priceId) {
        return res
          .status(400)
          .json({ error: "Voice plan pricing not configured. Contact support." });
      }

      const isSubscriber = company.subscriptionStatus === "active";
      const couponId = isSubscriber ? VOICE_COUPON_MAP[plan] : undefined;

      const baseUrl = getBaseUrl(req);
      const result = await createVoicePlanCheckout({
        tenantId: companyId,
        voicePlan: plan as "voice_bootstrap" | "voice_starter" | "voice_pro",
        priceId,
        customerEmail: company.email || "",
        successUrl: `${baseUrl}/billing?voice_success=1`,
        cancelUrl: `${baseUrl}/billing`,
        customerId: company.stripeCustomerId || undefined,
        couponId,
      });

      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/voice-signup/:slug/checkout", async (req: Request, res: Response) => {
    try {
      if (!isStripeConfigured()) return res.status(400).json({ error: "Stripe not configured" });
      const { slug: _slug } = req.params;
      const slug = p(_slug);
      const company = await storage.getCompanyBySlug(slug);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const { plan, email } = req.body;
      if (!plan || !(plan in VOICE_PRICE_MAP)) {
        return res
          .status(400)
          .json({ error: `Invalid voice plan. Valid: ${Object.keys(VOICE_PRICE_MAP).join(", ")}` });
      }
      if (!email) return res.status(400).json({ error: "email is required" });

      if (company.voicePlanStatus === "active") {
        return res.status(400).json({ error: "Company already has an active voice plan" });
      }

      const priceId = VOICE_PRICE_MAP[plan];
      if (!priceId) {
        return res.status(400).json({ error: "Voice plan pricing not configured" });
      }

      const isSubscriber = company.subscriptionStatus === "active";
      const couponId = isSubscriber ? VOICE_COUPON_MAP[plan] : undefined;

      const baseUrl = getBaseUrl(req);
      const result = await createVoicePlanCheckout({
        tenantId: company.id,
        voicePlan: plan as "voice_bootstrap" | "voice_starter" | "voice_pro",
        priceId,
        customerEmail: email,
        successUrl: `${baseUrl}/voice-signup/${slug}?success=1`,
        cancelUrl: `${baseUrl}/voice-signup/${slug}`,
        customerId: company.stripeCustomerId || undefined,
        couponId,
      });

      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/voice-signup/:slug/info", async (req: Request, res: Response) => {
    try {
      const { slug: _slug } = req.params;
      const slug = p(_slug);
      const company = await storage.getCompanyBySlug(slug);
      if (!company) return res.status(404).json({ error: "Company not found" });
      const isSubscriber = company.subscriptionStatus === "active";

      res.json({
        companyName: company.name,
        isSubscriber,
        plans: Object.entries(VOICE_PLAN_CONFIG).map(([key, cfg]) => ({
          key,
          name: cfg.name,
          price: isSubscriber ? cfg.subscriberPrice : cfg.price,
          subscriberPrice: cfg.subscriberPrice,
          regularPrice: cfg.price,
          includedMinutes: cfg.includedMinutes,
          overageRate: cfg.overageRate,
        })),
        currentVoicePlan: company.voicePlanTier || null,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/geocode/autocomplete", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const q = req.query.q as string;
      if (!q || q.length < 3) return res.json([]);

      const token = process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_SECRET_TOKEN;
      if (!token) return res.json([]);

      let countryFilter = "us";
      try {
        const { companyId } = await getCompanyContext(req);
        const co = await storage.getCompany(companyId);
        if (co?.country === "ca") countryFilter = "ca";
      } catch {}

      const cached = await getAutocompleteCached(q, countryFilter);
      if (cached) return res.json(cached);

      const params = new URLSearchParams({
        q,
        access_token: token,
        autocomplete: "true",
        country: countryFilter,
        types: "address",
        limit: "5",
      });
      const url = `https://api.mapbox.com/search/geocode/v6/forward?${params}`;
      const response = await fetch(url);
      if (!response.ok) return res.json([]);
      const data = await response.json();
      type GeoContext = Record<string, { name?: string; region_code?: string } | undefined>;
      type GeoFeature = {
        id?: string;
        geometry?: { coordinates?: [number, number] };
        properties?: {
          place_formatted?: string;
          coordinates?: { latitude?: number; longitude?: number };
          name?: string;
          region_code?: string;
          context?: GeoContext;
          full_address?: string;
          address?: string;
        };
      };
      const features = ((data.features || []) as GeoFeature[]).map((f) => {
        const props = f.properties ?? {};
        const ctx: GeoContext = props.context ?? {};
        const coords = f.geometry?.coordinates;
        const fullAddr = props.full_address || "";

        let city = ctx.place?.name || ctx.locality?.name || "";
        let state = ctx.region?.region_code || ctx.region?.name || "";
        let zipCode = ctx.postcode?.name || "";

        if ((!city || !state || !zipCode) && fullAddr) {
          const parts = fullAddr.split(",").map((p: string) => p.trim());
          if (!city && parts.length >= 2) city = parts[1] || "";
          if (!state && parts.length >= 3) {
            const stateZip = (parts[2] || "").trim().split(/\s+/);
            state = state || stateZip[0] || "";
            zipCode = zipCode || stateZip[1] || "";
          }
        }

        return {
          id: f.id || "",
          full_address: fullAddr,
          name: props.name || props.address || "",
          place_formatted: props.place_formatted || "",
          coordinates: coords ? { longitude: coords[0], latitude: coords[1] } : null,
          city,
          state,
          zipCode,
        };
      });
      setAutocompleteCache(q, countryFilter, features);
      trackApiCall("mapbox", "autocomplete");
      res.json(features);
    } catch {
      res.json([]);
    }
  });

  app.get("/api/geocode/usage", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const stats = await getApiUsageStats();
      res.json(stats);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/geocode/forward", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const q = req.query.q as string;
      if (!q) return res.json(null);

      const token = process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_SECRET_TOKEN;
      if (!token) return res.json(null);

      let countryFilter = "us";
      try {
        const { companyId } = await getCompanyContext(req);
        const co = await storage.getCompany(companyId);
        if (co?.country === "ca") countryFilter = "ca";
      } catch {}

      const params = new URLSearchParams({
        q,
        access_token: token,
        country: countryFilter,
        types: "address",
        limit: "1",
      });
      const url = `https://api.mapbox.com/search/geocode/v6/forward?${params}`;
      const response = await fetch(url);
      if (!response.ok) return res.json(null);
      const data = await response.json();
      const feature = data.features?.[0];
      if (!feature) return res.json(null);
      const coords = feature.geometry?.coordinates;
      res.json({
        full_address: feature.properties?.full_address || "",
        name: feature.properties?.name || "",
        coordinates: coords ? { longitude: coords[0], latitude: coords[1] } : null,
      });
    } catch {
      res.json(null);
    }
  });

  app.get("/api/mapbox-token", isAuthenticated, (_req: Request, res: Response) => {
    const token = process.env.MAPBOX_PUBLIC_TOKEN || "";
    res.json({ token });
  });

  // OSM tile proxy — avoids browser-side CSP/CORS issues with tile.openstreetmap.org
  app.get("/api/map/tiles/:z/:x/:y", async (req: Request, res: Response) => {
    const z = String(req.params.z);
    const x = String(req.params.x);
    const y = String(req.params.y);
    if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
      return res.status(400).send("Invalid tile coordinates");
    }
    const zi = parseInt(z, 10);
    const xi = parseInt(x, 10);
    const yi = parseInt(y, 10);
    if (zi < 0 || zi > 20 || xi < 0 || yi < 0) return res.status(400).send("Out of range");
    try {
      const upstream = await fetch(`https://tile.openstreetmap.org/${zi}/${xi}/${yi}.png`, {
        headers: { "User-Agent": "ScooPilot/1.0 map-proxy" },
      });
      if (!upstream.ok) return res.status(upstream.status).send("Tile unavailable");
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.set({
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      });
      res.send(buf);
    } catch {
      res.status(502).send("Tile fetch failed");
    }
  });

  app.get("/api/streetview", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const token = process.env.MAPBOX_PUBLIC_TOKEN;
      if (!token) return res.status(503).json({ error: "Street view not configured" });

      const { address, lat, lng, size } = req.query;

      let latitude: number;
      let longitude: number;

      if (lat && lng) {
        latitude = parseFloat(lat as string);
        longitude = parseFloat(lng as string);
      } else if (address) {
        const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address as string)}.json?access_token=${token}&limit=1`;
        const geocodeRes = await fetch(geocodeUrl);
        if (!geocodeRes.ok) return res.status(502).json({ error: "Geocoding failed" });
        const geocodeData = await geocodeRes.json();
        if (!geocodeData.features?.length)
          return res.status(404).json({ error: "Address not found" });
        [longitude, latitude] = geocodeData.features[0].center;
      } else {
        return res.status(400).json({ error: "address or lat+lng required" });
      }

      const allowedSizes = ["400x200", "400x250", "600x300", "640x400"];
      const safeSize = allowedSizes.includes(size as string) ? (size as string) : "600x300";
      const [width, height] = safeSize.split("x").map(Number);

      const url = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${longitude},${latitude},17,0,0/${width}x${height}?access_token=${token}`;
      const response = await fetch(url);

      if (!response.ok) {
        return res.status(response.status).json({ error: "Street view request failed" });
      }

      res.set("Content-Type", response.headers.get("content-type") || "image/png");
      res.set("Cache-Control", "public, max-age=604800");

      const buffer = Buffer.from(await response.arrayBuffer());
      res.send(buffer);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/satellite", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const token = process.env.MAPBOX_PUBLIC_TOKEN;
      if (!token) return res.status(503).json({ error: "Satellite view not configured" });

      const { address, lat, lng, size, zoom } = req.query;

      let latitude: number;
      let longitude: number;

      if (lat && lng) {
        latitude = parseFloat(lat as string);
        longitude = parseFloat(lng as string);
      } else if (address) {
        const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address as string)}.json?access_token=${token}&limit=1`;
        const geocodeRes = await fetch(geocodeUrl);
        if (!geocodeRes.ok) return res.status(502).json({ error: "Geocoding failed" });
        const geocodeData = await geocodeRes.json();
        if (!geocodeData.features?.length)
          return res.status(404).json({ error: "Address not found" });
        [longitude, latitude] = geocodeData.features[0].center;
      } else {
        return res.status(400).json({ error: "address or lat+lng required" });
      }

      const allowedSizes = ["400x200", "400x250", "400x300", "600x300", "600x400", "640x400"];
      const safeSize = allowedSizes.includes(size as string) ? (size as string) : "600x300";
      const [width, height] = safeSize.split("x").map(Number);
      const safeZoom = Math.min(21, Math.max(15, parseInt(zoom as string) || 19));

      const marker = `pin-s+ff0000(${longitude},${latitude})`;
      const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${encodeURIComponent(marker)}/${longitude},${latitude},${safeZoom}/${width}x${height}?access_token=${token}`;
      const response = await fetch(url);

      if (!response.ok) {
        return res.status(response.status).json({ error: "Satellite view request failed" });
      }

      res.set("Content-Type", response.headers.get("content-type") || "image/png");
      res.set("Cache-Control", "public, max-age=604800");

      const buffer = Buffer.from(await response.arrayBuffer());
      res.send(buffer);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Admin: fetch all today's visit data + billing summary
  app.get(
    "/api/admin/command-center-stats",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const today =
          typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
            ? req.query.date
            : new Date().toISOString().split("T")[0];

        const visitsList = await storage.getVisits(companyId, { date: today });
        const companyRoutes = await storage.getRoutes(companyId);
        const routeMap = new Map(companyRoutes.map((r) => [r.id, r]));

        // Resolve technician names for each route
        const techIds = Array.from(
          new Set(companyRoutes.map((r) => r.technicianId).filter(Boolean))
        ) as string[];
        const techUsers =
          techIds.length > 0
            ? await db
                .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
                .from(users)
                .where(inArray(users.id, techIds))
            : [];
        const techMap = new Map(
          techUsers.map((u) => [u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()])
        );

        const enriched = await Promise.all(
          visitsList.map(async (v) => {
            const plan = v.servicePlanId
              ? await storage.getServicePlan(v.servicePlanId, companyId)
              : null;
            const prop = await storage.getProperty(v.propertyId, companyId);
            const contact = plan ? await storage.getContact(plan.contactId, companyId) : null;
            const route = v.routeId ? routeMap.get(v.routeId) : null;
            const techName = route?.technicianId ? (techMap.get(route.technicianId) ?? null) : null;
            return {
              ...v,
              stopOrder: plan?.stopOrder ?? 999,
              routeName: route?.name ?? null,
              routeColor: route?.color ?? null,
              servicePlanName:
                plan?.serviceName || (plan?.frequency ? `${plan.frequency} service` : null),
              pricePerVisit: plan?.pricePerVisit ?? "0",
              techName,
              property: prop
                ? {
                    streetAddress: prop.streetAddress,
                    city: prop.city,
                    state: prop.state,
                    latitude: prop.latitude,
                    longitude: prop.longitude,
                  }
                : null,
              contact: contact
                ? {
                    id: contact.id,
                    firstName: contact.firstName,
                    lastName: contact.lastName,
                  }
                : null,
            };
          })
        );

        // Sort by scheduledTime ascending
        enriched.sort((a, b) => {
          const tA =
            ((a as Record<string, unknown>).scheduledTime as string | undefined) ?? "00:00";
          const tB =
            ((b as Record<string, unknown>).scheduledTime as string | undefined) ?? "00:00";
          return tA.localeCompare(tB);
        });

        const stats = {
          totalToday: enriched.length,
          inProgress: enriched.filter((v) => v.status === "in_progress").length,
          completed: enriched.filter((v) => v.status === "completed").length,
          upcoming: enriched.filter((v) => v.status === "scheduled").length,
        };

        const sumPrices = (vs: typeof enriched) =>
          vs.reduce(
            (s, v) =>
              s +
              parseFloat(
                ((v as Record<string, unknown>).pricePerVisit as string | undefined) || "0"
              ),
            0
          );

        const nonCancelled = enriched.filter((v) => v.status !== "cancelled");
        const completedVisits = enriched.filter((v) => v.status === "completed");
        const pendingVisits = enriched.filter(
          (v) => v.status === "scheduled" || v.status === "in_progress"
        );

        // Today's invoices
        const todayStart = new Date(today + "T00:00:00.000Z");
        const tomorrowStart = new Date(new Date(todayStart).getTime() + 86400000);
        const todayInvoices = await db
          .select({ status: invoices.status, total: invoices.total })
          .from(invoices)
          .where(
            and(
              eq(invoices.companyId, companyId),
              gte(invoices.createdAt, todayStart),
              lt(invoices.createdAt, tomorrowStart)
            )
          );

        const billing = {
          expectedRevenue: sumPrices(nonCancelled),
          completedRevenue: sumPrices(completedVisits),
          pendingRevenue: sumPrices(pendingVisits),
          invoicesCreatedToday: todayInvoices.length,
          totalInvoiced: todayInvoices.reduce((s, inv) => s + parseFloat(inv.total || "0"), 0),
          totalPaid: todayInvoices
            .filter((inv) => inv.status === "paid")
            .reduce((s, inv) => s + parseFloat(inv.total || "0"), 0),
        };

        res.json({ visits: enriched, stats, billing });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post("/api/tech/distances", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { originLat, originLng, destinations } = req.body;
      if (
        typeof originLat !== "number" ||
        typeof originLng !== "number" ||
        !Array.isArray(destinations) ||
        destinations.length === 0
      ) {
        return res.status(400).json({ error: "originLat, originLng, and destinations[] required" });
      }

      const mapboxToken = process.env.MAPBOX_SECRET_TOKEN || process.env.MAPBOX_PUBLIC_TOKEN;
      if (!mapboxToken) {
        return res.status(503).json({ error: "Mapbox not configured", fallback: true });
      }

      const coordsParam = [
        `${originLng},${originLat}`,
        ...destinations.map((d: { lat: number; lng: number }) => `${d.lng},${d.lat}`),
      ].join(";");

      const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coordsParam}?access_token=${mapboxToken}&annotations=duration,distance&sources=0`;

      const response = await fetch(url);
      if (!response.ok) {
        return res.status(502).json({ error: "Distance Matrix request failed", fallback: true });
      }

      const data = (await response.json()) as {
        code: string;
        durations: number[][];
        distances: number[][];
      };

      if (data.code !== "Ok" || !data.durations?.[0] || !data.distances?.[0]) {
        return res.status(502).json({ error: "Distance Matrix returned error", fallback: true });
      }

      const formatDuration = (seconds: number): string => {
        if (seconds < 60) return "1 min";
        const mins = Math.round(seconds / 60);
        if (mins < 60) return `${mins} min`;
        const hrs = Math.floor(mins / 60);
        const rem = mins % 60;
        return rem > 0 ? `${hrs} hr ${rem} min` : `${hrs} hr`;
      };

      const formatDistance = (meters: number): string => {
        const miles = meters / 1609.344;
        return `${miles.toFixed(1)} mi`;
      };

      const results = destinations.map((_: unknown, i: number) => {
        const durationSeconds = data.durations[0][i + 1];
        const distanceMeters = data.distances[0][i + 1];
        if (durationSeconds == null || distanceMeters == null) return null;
        return {
          durationText: formatDuration(durationSeconds),
          durationSeconds: Math.round(durationSeconds),
          distanceText: formatDistance(distanceMeters),
          distanceMeters: Math.round(distanceMeters),
        };
      });

      res.json({ results });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/mapbox-static-image", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const token = process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_SECRET_TOKEN;
      if (!token) return res.status(503).json({ error: "Mapbox not configured" });

      const { lat, lng, zoom, w, h } = req.query;
      if (!lat || !lng) return res.status(400).json({ error: "lat and lng required" });

      const safeLat = parseFloat(lat as string);
      const safeLng = parseFloat(lng as string);
      const safeZoom = Math.min(22, Math.max(0, parseInt(zoom as string) || 19));
      const safeW = Math.min(1280, Math.max(1, parseInt(w as string) || 640));
      const safeH = Math.min(1280, Math.max(1, parseInt(h as string) || 400));

      const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/${safeLng},${safeLat},${safeZoom},0/${safeW}x${safeH}@2x?access_token=${token}`;
      const response = await fetch(url);

      if (!response.ok) {
        return res.status(response.status).json({ error: "Mapbox static image request failed" });
      }

      res.set("Content-Type", response.headers.get("content-type") || "image/png");
      res.set("Cache-Control", "public, max-age=604800");

      const buffer = Buffer.from(await response.arrayBuffer());
      res.send(buffer);
    } catch (err) {
      handleError(res, err);
    }
  });
}
