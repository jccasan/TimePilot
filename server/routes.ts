import type { Express, Request, Response } from "express";
import { type Server } from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import { storage } from "./storage";
import { db } from "./db";
import { sql, eq, and, lt, gte, isNotNull, like, or, inArray, desc } from "drizzle-orm";
import { users, companyUsers, companies, contacts, properties, invoices, routes, DEFAULT_PRICING_CONFIG, type PricingConfig, type PricingRulesConfig, DEFAULT_PRICING_RULES, adminUsers, adminSessions, adminAuditLogs, subscriptionTiers, type Visit, reminderLogs, qboSyncLogs, servicePlans as servicePlansTable, messages as messagesTable, messages, usageEvents, auditTrail, visits, type Message, agreements as agreementsTable, jobs as jobsTable, stripeEvents, automationRules, automationEventLogs, quoteFormEvents } from "@shared/schema";
import { calculatePrice, sqftToAcres, yardSizeLabelToAcres, type PriceCalculatorInputs } from "./services/pricing-calculator";
import { z } from "zod";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { registerUser, loginUser, getUserById, getUserByEmail, createPasswordResetToken, resetPasswordWithToken, createUserWithTempPassword, changePassword } from "./services/app-auth";
import type { RequestHandler } from "express";
import { sendEmail, sendAdminSignupNotification, generateEmailThreadId, logEmailSent } from "./services/email";
import { getCompanyToday, getCompanyMonthStart, getCompanyMonthEnd, getCompanyWeekStart, getCompanyWeekEnd, getCompanyDayOfWeek } from "./utils/company-date";
import { sendSmsForCompany, isSmsConfiguredForCompany, getFromPhoneForCompany, getCompanySmsConfig } from "./services/sms";
import {
  isStripeConfigured,
  createStripeCustomer,
  createSetupIntent,
  getCustomerPaymentMethods,
  createPaymentIntent,
  chargeInvoiceAutomatically,
  constructWebhookEvent,
  createCheckoutSession,
  detachPaymentMethod,
  createConnectAccount,
  createConnectAccountLink,
  getConnectAccountStatus,
  createConnectLoginLink,
  createSubscriptionCheckout,
  createCustomerPortalSession,
  reportMeteredUsage,
  reportMeteredUsageSet,
  validateStripeConfig,
  fetchStripePrices,
  getCachedStripePrices,
  createVoicePlanCheckout,
  migrateCustomerToConnectedAccount,
  isCustomerOnPlatform,
  ensureConnectedCustomer,
} from "./services/stripe";
import { seedRetellKnowledgeBase, provisionRetellNumber } from "./services/retell";
import { optimizeRoute, calculateTotalDistance, getMapboxRouteMetrics, haversineDistance, fetchMapboxDirections, getRouteMetricsWithLegs } from "./services/route-optimizer";
import { geocodeAddress } from "./services/geocode";
import { computeInvoice, formatUSD } from "./invoice-engine/invoice.compute";
import { renderInvoice, loadTemplate, loadTheme, getDefaultTemplatePath, getDefaultThemePath } from "./invoice-engine/invoice.render";
import { calculateQuotePricing, renderResidentialProposalHtml, renderCommercialProposalHtml, renderQuoteSmsText, type ResidentialQuoteInput, type CommercialQuoteInput } from "./services/quote-pricing";
import { generateQuotePdf, generateQuoteDocx } from "./services/quote-document";
import {
  TIER_CONFIG,
  VOICE_PLAN_CONFIG,
  insertContactSchema,
  insertTagSchema,
  insertPropertySchema,
  insertRouteSchema,
  insertServicePlanSchema,
  insertVacationHoldSchema,
  insertVisitSchema,
  insertInvoiceSchema,
  insertInvoiceLineItemSchema,
  insertAutomationRuleSchema,
  insertWebhookSchema,
  insertServicePricingSchema,
  insertServicePackageSchema,
  type InsertQuote,
} from "@shared/schema";

const CHANGE_PASSWORD_EXEMPT_PATHS = ["/api/auth/change-password", "/api/auth/user", "/api/auth/logout"];

const isAuthenticated: RequestHandler = async (req, res, next) => {
  let userId = (req.session as any)?.userId;
  let authMethod = userId ? "session-cookie" : "none";
  if (!userId) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const sessionRow = await db.execute(sql`SELECT sess FROM sessions WHERE sid = ${token} AND expire > NOW()`);
      if (sessionRow.rows.length > 0) {
        const sess = sessionRow.rows[0].sess as any;
        if (sess?.userId) {
          userId = sess.userId;
          (req.session as any).userId = userId;
          authMethod = "bearer-token";
        }
      } else {
        authMethod = "bearer-token-invalid";
      }
    }
  }
  if (!userId) {
    const apiKeyHeader = req.headers["x-api-key"] as string | undefined;
    if (apiKeyHeader) {
      if (apiKeyHeader.length < 8) {
        return res.status(401).json({ message: "Invalid API key" });
      }
      const prefix = apiKeyHeader.substring(0, 8);
      const keyHash = crypto.createHash("sha256").update(apiKeyHeader).digest("hex");
      const apiKey = await storage.getApiKeyByPrefix(prefix);
      if (apiKey && apiKey.keyHash === keyHash) {
        if (!apiKey.isActive) {
          return res.status(401).json({ message: "API key is inactive" });
        }
        if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
          return res.status(401).json({ message: "API key has expired" });
        }
        const companyUsers_ = await storage.getCompanyUsers(apiKey.companyId);
        const ownerOrAdmin = companyUsers_.find(cu => cu.role === "owner" && cu.isActive !== false) || companyUsers_.find(cu => cu.role === "admin" && cu.isActive !== false);
        if (ownerOrAdmin) {
          userId = ownerOrAdmin.userId;
          (req as any)._apiKeyAuth = { userId: ownerOrAdmin.userId, companyId: apiKey.companyId, role: ownerOrAdmin.role };
          authMethod = "api-key";
          storage.updateApiKeyLastUsed(apiKey.id).catch(console.error);
        }
      } else {
        return res.status(401).json({ message: "Invalid API key" });
      }
    }
  }
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (authMethod !== "api-key" && !CHANGE_PASSWORD_EXEMPT_PATHS.includes(req.path)) {
    const user = await getUserById(userId);
    if (user?.mustChangePassword) {
      return res.status(403).json({ error: "Password change required", mustChangePassword: true });
    }
  }
  return next();
};

async function getCompanyContext(req: Request) {
  const apiKeyAuth = (req as any)._apiKeyAuth as { userId: string; companyId: string; role: string } | undefined;
  if (apiKeyAuth) {
    return { userId: apiKeyAuth.userId, companyId: apiKeyAuth.companyId, role: apiKeyAuth.role };
  }
  const userId = (req.session as any)?.userId;
  if (!userId) {
    throw { status: 401, message: "Not authenticated" };
  }
  const memberships = await storage.getCompaniesForUser(userId);
  if (!memberships.length) {
    throw { status: 403, message: "No company membership found" };
  }
  const membership = memberships[0];
  return { userId, companyId: membership.companyId, role: membership.role };
}

function requireRole(role: string, allowed: string[] = ["owner", "admin"]) {
  if (!allowed.includes(role)) {
    throw { status: 403, message: "Insufficient permissions" };
  }
}

function getBaseUrl(req: Request): string {
  const host = req.get("host") || "localhost";
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  return `${proto === "http" && !host.startsWith("localhost") ? "https" : proto}://${host}`;
}

function handleError(res: Response, err: any) {
  if (err && typeof err === "object" && "status" in err) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err?.name === "ZodError" || err?.constructor?.name === "ZodError") {
    const issues = err.issues || err.errors || [];
    const message = issues.map((i: any) => `${i.path?.join(".")}: ${i.message}`).join("; ");
    return res.status(400).json({ error: message || "Validation error" });
  }
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
}

function sanitizeDecimal(value: any): string {
  const n = parseFloat(value);
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

function auditLog(companyId: string, userId: string | null, entityType: string, entityId: string, action: string, changes?: any, ipAddress?: string) {
  storage.createAuditEntry({ companyId, userId: userId || null, entityType, entityId, action, changes: changes || {}, ipAddress: ipAddress || null }).catch(console.error);
}

const EMAIL_NOTIFY_TYPES = new Set([
  "portal_message", "new_message", "service_paused", "service_resumed",
  "payment_failed", "invoice_paid", "new_lead", "general",
]);

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function notify(companyId: string, type: string, title: string, message: string, linkUrl?: string) {
  storage.createNotification({ companyId, type: type as any, title, message, isRead: false, linkUrl: linkUrl || null }).catch(console.error);

  if (EMAIL_NOTIFY_TYPES.has(type)) {
    (async () => {
      try {
        const ownerRows = await db.select({ email: users.email, firstName: users.firstName })
          .from(companyUsers)
          .innerJoin(users, eq(companyUsers.userId, users.id))
          .where(and(eq(companyUsers.companyId, companyId), or(eq(companyUsers.role, "owner"), eq(companyUsers.role, "admin")), eq(companyUsers.isActive, true)));
        const company = await storage.getCompany(companyId);
        const companyName = company?.name || "ScooPilot";
        const baseUrl = process.env.REPLIT_DEPLOYMENT_URL
          ? `https://${process.env.REPLIT_DEPLOYMENT_URL}`
          : process.env.REPLIT_DEV_DOMAIN
            ? `https://${process.env.REPLIT_DEV_DOMAIN}`
            : "https://scoopilot.replit.app";
        const fullLink = linkUrl?.startsWith("/") ? `${baseUrl}${linkUrl}` : null;
        const safeCompany = escapeHtml(companyName);
        const safeTitle = escapeHtml(title);
        const safeMessage = escapeHtml(message);
        const seen = new Set<string>();
        const sends = ownerRows
          .filter(r => {
            if (!r.email) return false;
            const key = r.email.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map(row => sendEmail({
            companyId: companyId,
            to: row.email!,
            subject: `${companyName} - ${title}`,
            text: `${message}${fullLink ? `\n\nView details: ${fullLink}` : ""}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #2d8a5e; padding: 16px 20px;">
                  <h2 style="color: white; margin: 0; font-size: 18px;">${safeCompany}</h2>
                </div>
                <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none;">
                  <h3 style="margin: 0 0 8px 0; color: #1f2937;">${safeTitle}</h3>
                  <p style="color: #4b5563; margin: 0 0 16px 0;">${safeMessage}</p>
                  ${fullLink ? `<a href="${escapeHtml(fullLink)}" style="display: inline-block; background-color: #2d8a5e; color: white; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: bold;">View Details</a>` : ""}
                </div>
              </div>`,
            senderName: company?.name || undefined,
            replyTo: company?.email || undefined,
          }));
        const results = await Promise.allSettled(sends);
        for (const r of results) {
          if (r.status === "rejected") console.error("Notification email send failed:", r.reason);
          else if (!r.value.success) console.error("Notification email error:", r.value.error);
        }
      } catch (err) {
        console.error("Failed to send notification email:", err);
      }
    })();
  }

  const eventMap: Record<string, string> = {
    invoice_paid: "invoice.paid",
    invoice_overdue: "invoice.created",
    visit_completed: "visit.completed",
    new_lead: "contact.created",
    payment_failed: "payment.failed",
  };
  const webhookEvent = eventMap[type];
  if (webhookEvent) {
    import("./services/webhook-dispatcher").then(({ dispatchWebhooksForEvent }) => {
      dispatchWebhooksForEvent(companyId, webhookEvent, { type, title, message, linkUrl }).catch(console.error);
    });
  }
}

function qboAutoSync(companyId: string, entityId: string, type: "invoice" | "payment" | "contact") {
  import("./services/quickbooks").then(async ({ isQboConfigured, syncInvoiceToQbo, syncPaymentToQbo, syncContactToQbo }) => {
    if (!isQboConfigured()) return;
    const company = await storage.getCompany(companyId);
    if (!company?.qboRealmId || !company?.qboAccessToken) return;
    try {
      if (type === "invoice") await syncInvoiceToQbo(companyId, entityId);
      else if (type === "payment") await syncPaymentToQbo(companyId, entityId);
      else if (type === "contact") await syncContactToQbo(companyId, entityId);
    } catch (err: any) {
      console.error(`[QBO auto-sync] ${type} ${entityId} failed:`, err);
      db.insert(qboSyncLogs).values({
        companyId,
        entityType: type,
        entityId,
        action: "auto_sync",
        status: "error",
        errorMessage: err?.message || String(err),
      }).catch(console.error);
    }
  }).catch(console.error);
}

async function createPropertyWithGeocode(data: {
  companyId: string; contactId: string; streetAddress: string;
  city?: string | null; state?: string | null; zipCode?: string | null;
  numberOfDogs?: number | null; yardSize?: string | null;
  latitude?: string | null; longitude?: string | null;
}) {
  if (!data.latitude && !data.longitude && data.streetAddress) {
    const coords = await geocodeAddress(data.streetAddress, data.city, data.state, data.zipCode);
    if (coords) {
      data.latitude = coords.latitude;
      data.longitude = coords.longitude;
    }
  }
  return storage.createProperty(data as any);
}

function getStopOnlyOnlyContactIds(activePlans: { contactId: string; isStopOnly: boolean }[]): Set<string> {
  const contactHasReal = new Set<string>();
  const contactHasStopOnly = new Set<string>();
  for (const p of activePlans) {
    if (p.isStopOnly) {
      contactHasStopOnly.add(p.contactId);
    } else {
      contactHasReal.add(p.contactId);
    }
  }
  const result = new Set<string>();
  for (const cid of contactHasStopOnly) {
    if (!contactHasReal.has(cid)) result.add(cid);
  }
  return result;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  registerObjectStorageRoutes(app, isAuthenticated);

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

  validateStripeConfig();
  fetchStripePrices().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Stripe Prices] Startup price fetch failed:", msg);
  });

  const GATE_EXEMPT_PREFIXES = [
    "/api/auth/", "/api/auth/login", "/api/auth/register", "/api/auth/user",
    "/api/billing/", "/api/subscriptions/",
    "/api/webhooks/", "/api/portal/",
    "/api/password/",
    "/api/create-tenant",
  ];
  const GATE_READ_EXEMPT_PREFIXES = [
    "/api/company/stats",
  ];

  function isGateExempt(path: string, method: string): boolean {
    const p = path.toLowerCase();
    for (const exempt of GATE_EXEMPT_PREFIXES) {
      if (p === exempt.replace(/\/$/, "") || p.startsWith(exempt)) return true;
    }
    if (method === "GET" || method === "OPTIONS") {
      for (const exempt of GATE_READ_EXEMPT_PREFIXES) {
        if (p === exempt || p.startsWith(exempt)) return true;
      }
    }
    return false;
  }

  const subscriptionGate: RequestHandler = async (req, res, next) => {
    if (req.method === "OPTIONS") return next();
    if (isGateExempt(req.path, req.method)) return next();
    const sessionUserId = (req.session as any)?.userId;
    const hasApiKey = !!req.headers["x-api-key"];
    const authHeader = req.headers.authorization;
    const hasBearerToken = authHeader?.startsWith("Bearer ");
    if (!sessionUserId && !hasApiKey && !hasBearerToken) return next();
    try {
      let companyId: string | null = null;
      let resolvedUserId = sessionUserId;
      if (!resolvedUserId && hasBearerToken) {
        const token = authHeader!.substring(7);
        const sessionRow = await db.execute(sql`SELECT sess FROM sessions WHERE sid = ${token} AND expire > NOW()`);
        if (sessionRow.rows.length > 0) {
          const sess = sessionRow.rows[0].sess as { userId?: string };
          if (sess?.userId) {
            resolvedUserId = sess.userId;
          }
        }
        if (!resolvedUserId) {
          if (token.length >= 8) {
            const prefix = token.substring(0, 8);
            const keyHash = crypto.createHash("sha256").update(token).digest("hex");
            const apiKey = await storage.getApiKeyByPrefix(prefix);
            if (apiKey && apiKey.keyHash === keyHash && apiKey.isActive) {
              companyId = apiKey.companyId;
            }
          }
        }
      }
      if (!companyId && resolvedUserId) {
        const memberships = await storage.getCompaniesForUser(resolvedUserId);
        if (memberships.length > 0) companyId = memberships[0].companyId;
      }
      if (!companyId && hasApiKey) {
        const apiKeyHeader = req.headers["x-api-key"] as string;
        if (apiKeyHeader && apiKeyHeader.length >= 8) {
          const prefix = apiKeyHeader.substring(0, 8);
          const keyHash = crypto.createHash("sha256").update(apiKeyHeader).digest("hex");
          const apiKey = await storage.getApiKeyByPrefix(prefix);
          if (apiKey && apiKey.keyHash === keyHash && apiKey.isActive) {
            companyId = apiKey.companyId;
          }
        }
      }
      if (companyId) {
        const company = await storage.getCompany(companyId);
        if (company && (company.subscriptionStatus === "suspended" || company.subscriptionStatus === "cancelled")) {
          return res.status(402).json({
            error: "Account suspended",
            message: "Your subscription is inactive. Please update your billing to continue.",
            subscriptionStatus: company.subscriptionStatus,
          });
        }
      }
    } catch (gateErr) {
      console.error("[SubscriptionGate] Error checking subscription status:", gateErr);
    }
    return next();
  };

  app.use("/api", subscriptionGate);

  // ================ Subscription Billing ================

  const TIER_PRICE_MAP: Record<string, string> = {
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
        console.error(`[Checkout] Invalid or unconfigured tier: "${tier}". Configured tiers: ${Object.entries(TIER_PRICE_MAP).filter(([,v]) => !!v).map(([k]) => k).join(", ")}`);
        return res.status(400).json({ error: `Invalid tier: ${tier}. Valid tiers: ${Object.keys(TIER_PRICE_MAP).join(", ")}` });
      }

      const baseUrl = getBaseUrl(req);

      let customerId: string | undefined;
      try {
        const { companyId } = await getCompanyContext(req);
        const company = await storage.getCompany(companyId);
        if (company?.stripeCustomerId) customerId = company.stripeCustomerId;
      } catch (_noAuth) {
      }

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
      if (!company.stripeCustomerId) return res.status(400).json({ error: "No Stripe customer linked" });
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

  app.get("/api/billing/usage", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

      const summary = await storage.getUsageSummary(companyId, startOfMonth, endOfMonth);
      const activeUsers = await storage.countActiveCompanyUsers(companyId);
      const tierConfig = company ? TIER_CONFIG[company.subscriptionTier as keyof typeof TIER_CONFIG] : null;

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
        voicePlan: company.voicePlanTier ? {
          tier: company.voicePlanTier,
          name: voicePlanConfig?.name || company.voicePlanTier,
          status: company.voicePlanStatus || "inactive",
          includedMinutes: company.voicePlanIncludedMinutes || 0,
          overageRate: company.voicePlanOverageRate ? parseFloat(company.voicePlanOverageRate) : 0,
          dedicatedPhoneNumber: company.dedicatedPhoneNumber || null,
        } : null,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Geocode Proxy (Mapbox) ================

  app.get("/api/billing/prices", isAuthenticated, async (_req: Request, res: Response) => {
    try {
      let stripePrices = getCachedStripePrices();
      if (!stripePrices && isStripeConfigured()) {
        stripePrices = await fetchStripePrices();
      }
      const result: Record<string, { name: string; price: number; maxUsers: number }> = {};
      for (const [tier, config] of Object.entries(TIER_CONFIG)) {
        if (!config.visible) continue;
        result[tier] = {
          name: config.name,
          price: stripePrices?.[tier] ?? config.price,
          maxUsers: config.maxUsers,
        };
      }
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  const VOICE_PRICE_MAP: Record<string, string | undefined> = {
    voice_starter: process.env.STRIPE_PRICE_VOICE_STARTER,
    voice_pro: process.env.STRIPE_PRICE_VOICE_PRO,
  };

  const VOICE_COUPON_MAP: Record<string, string | undefined> = {
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
      if (company.voicePlanStatus === "active") return res.status(400).json({ error: "Voice plan already active" });

      const { plan } = req.body;
      if (!plan || !(plan in VOICE_PRICE_MAP)) {
        return res.status(400).json({ error: `Invalid voice plan. Valid: ${Object.keys(VOICE_PRICE_MAP).join(", ")}` });
      }

      const priceId = VOICE_PRICE_MAP[plan];
      if (!priceId) {
        return res.status(400).json({ error: "Voice plan pricing not configured. Contact support." });
      }

      const isSubscriber = company.subscriptionStatus === "active";
      const couponId = isSubscriber ? VOICE_COUPON_MAP[plan] : undefined;

      const baseUrl = getBaseUrl(req);
      const result = await createVoicePlanCheckout({
        tenantId: companyId,
        voicePlan: plan as "voice_starter" | "voice_pro",
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
      const { slug } = req.params;
      const company = await storage.getCompanyBySlug(slug);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const { plan, email } = req.body;
      if (!plan || !(plan in VOICE_PRICE_MAP)) {
        return res.status(400).json({ error: `Invalid voice plan. Valid: ${Object.keys(VOICE_PRICE_MAP).join(", ")}` });
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
        voicePlan: plan as "voice_starter" | "voice_pro",
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
      const { slug } = req.params;
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
      const features = (data.features || []).map((f: any) => {
        const props = f.properties || {};
        const ctx = props.context || {};
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
      res.json(features);
    } catch {
      res.json([]);
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

  app.get("/api/streetview", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "Street View not configured" });

      const { address, lat, lng, size, fov } = req.query;
      if (!address && !(lat && lng)) {
        return res.status(400).json({ error: "address or lat+lng required" });
      }

      const allowedSizes = ["400x200", "400x250", "600x300", "640x400"];
      const safeSize = allowedSizes.includes(size as string) ? (size as string) : "600x300";
      const safeFov = Math.min(120, Math.max(20, parseInt(fov as string) || 90));

      const params = new URLSearchParams({
        size: safeSize,
        fov: String(safeFov),
        key: apiKey,
      });

      if (lat && lng) {
        params.set("location", `${lat},${lng}`);
      } else {
        params.set("location", address as string);
      }

      const url = `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
      const response = await fetch(url);

      if (!response.ok) {
        return res.status(response.status).json({ error: "Street View request failed" });
      }

      res.set("Content-Type", response.headers.get("content-type") || "image/jpeg");
      res.set("Cache-Control", "public, max-age=604800");

      const buffer = Buffer.from(await response.arrayBuffer());
      res.send(buffer);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/satellite", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "Satellite view not configured" });

      const { address, lat, lng, size, zoom } = req.query;
      if (!address && !(lat && lng)) {
        return res.status(400).json({ error: "address or lat+lng required" });
      }

      const allowedSizes = ["400x200", "400x250", "400x300", "600x300", "600x400", "640x400"];
      const safeSize = allowedSizes.includes(size as string) ? (size as string) : "600x300";
      const safeZoom = Math.min(21, Math.max(15, parseInt(zoom as string) || 19));

      const location = (lat && lng) ? `${lat},${lng}` : (address as string);

      const params = new URLSearchParams({
        center: location,
        zoom: String(safeZoom),
        size: safeSize,
        maptype: "satellite",
        markers: `color:red|${location}`,
        key: apiKey,
      });

      const url = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
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

  // ================ Auth Routes ================

  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, firstName, lastName, companyName } = req.body;
      const result = await registerUser(email, password, firstName || "", lastName || "");
      if ("error" in result) {
        return res.status(400).json({ error: result.error });
      }
      (req.session as any).userId = result.user.id;
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });
      const { passwordHash, ...safeUser } = result.user;

      let setupDone = false;
      let companyInfo: { companyId: string; alreadySetup: boolean } | null = null;
      try {
        companyInfo = await ensureCompanySetup(result.user.id, companyName);
        setupDone = true;
      } catch (err) {
        console.error("Setup during register failed:", err);
      }

      const displayName = [firstName, lastName].filter(Boolean).join(" ") || "there";
      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host || "localhost:5000";
      const appUrl = `${protocol}://${host}`;
      const resolvedCompanyName = companyName?.trim() || `${displayName}'s Company`;

      sendEmail({
        to: email,
        subject: "Welcome to ScooPilot — Your 14-day free trial is active",
        text: `Hi ${displayName},\n\nWelcome to ScooPilot! Your account "${resolvedCompanyName}" has been created with a 14-day free trial.\n\nLog in at: ${appUrl}\nEmail: ${email}\n\nThank you for choosing ScooPilot!`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">ScooPilot</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #e5e7eb;">
              <h2 style="margin-top: 0;">Welcome, ${displayName}!</h2>
              <p>Your account <strong>"${resolvedCompanyName}"</strong> has been created with a <strong>14-day free trial</strong>.</p>
              <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 4px 0;"><strong>Email:</strong> ${email}</p>
                <p style="margin: 4px 0;"><strong>Trial ends:</strong> ${new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
              </div>
              <div style="text-align: center; margin: 24px 0;">
                <a href="${appUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log In Now</a>
              </div>
              <p style="margin-top: 20px; color: #6b7280; font-size: 14px;">Thank you for choosing ScooPilot!</p>
            </div>
          </div>
        `,
      }).catch((err) => console.error("Failed to send welcome email:", err));

      if (companyInfo && !companyInfo.alreadySetup) {
        sendAdminSignupNotification({
          companyName: resolvedCompanyName,
          ownerEmail: email,
          ownerName: displayName,
          tier: "free_trial",
          source: "Direct Registration",
        }).catch((err) => console.error("[Signup Notification] Failed during direct registration:", err));
      }

      return res.json({ ...safeUser, setupDone, sessionToken: req.sessionID });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      const result = await loginUser(email, password);
      if ("error" in result) {
        return res.status(401).json({ error: result.error });
      }
      (req.session as any).userId = result.user.id;
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, result.user.id)).execute();
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });
      const { passwordHash, ...safeUser } = result.user;

      let setupDone = false;
      try {
        await ensureCompanySetup(result.user.id);
        setupDone = true;
      } catch (err) {
        console.error("Setup during login failed:", err);
      }

      console.log(`[auth] login success | user=${result.user.id} sid=${req.sessionID.substring(0, 8)}... ua=${(req.headers["user-agent"] || "").substring(0, 80)}`);
      return res.json({ ...safeUser, setupDone, sessionToken: req.sessionID });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/auth/user", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any).userId;
      const user = await getUserById(userId);
      if (!user) return res.status(401).json({ message: "User not found" });
      const { passwordHash, ...safeUser } = user;
      const memberships = await storage.getCompaniesForUser(userId);
      const role = memberships.length > 0 ? memberships[0].role : "tech";
      return res.json({ ...safeUser, role });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: "Logout failed" });
      res.clearCookie("connect.sid");
      return res.json({ ok: true });
    });
  });

  app.get("/api/tours/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any).userId;
      const user = await getUserById(userId);
      if (!user) return res.status(401).json({ error: "Not found" });
      return res.json({ completions: user.tourCompletions || {} });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/tours/complete", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any).userId;
      const { tourId, version } = req.body;
      if (!tourId || typeof tourId !== "string") return res.status(400).json({ error: "tourId is required" });
      const user = await getUserById(userId);
      if (!user) return res.status(401).json({ error: "Not found" });
      const completions = (user.tourCompletions as Record<string, string>) || {};
      completions[tourId] = new Date().toISOString();
      if (version && typeof version === "string") {
        completions[`${tourId}_version`] = version;
      }
      await db.update(users).set({ tourCompletions: completions }).where(eq(users.id, userId));
      return res.json({ ok: true, completions });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/tutorials/progress", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any).userId;
      const user = await getUserById(userId);
      if (!user) return res.status(401).json({ error: "Not found" });
      const completions = (user.tourCompletions as Record<string, any>) || {};
      const progress: Record<string, { currentStep: number; completed: boolean; version: string }> = {};
      for (const key of Object.keys(completions)) {
        if (key.endsWith("_progress")) {
          const tutorialId = key.replace("_progress", "");
          const stored = completions[key];
          if (stored && typeof stored === "object") {
            progress[tutorialId] = stored;
          }
        }
      }
      return res.json({ progress });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/tutorials/progress", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any).userId;
      const { tutorialId, currentStep, completed, version } = req.body;
      if (!tutorialId || typeof tutorialId !== "string") return res.status(400).json({ error: "tutorialId required" });
      if (typeof currentStep !== "number") return res.status(400).json({ error: "currentStep required" });
      const user = await getUserById(userId);
      if (!user) return res.status(401).json({ error: "Not found" });
      const completions = (user.tourCompletions as Record<string, any>) || {};
      const progressKey = `${tutorialId}_progress`;
      completions[progressKey] = {
        currentStep,
        completed: !!completed,
        version: version || "1.0",
      };
      if (completed) {
        completions[tutorialId] = new Date().toISOString();
        if (version) completions[`${tutorialId}_version`] = version;
      }
      await db.update(users).set({ tourCompletions: completions }).where(eq(users.id, userId));
      return res.json({ ok: true, progress: completions[progressKey] });
    } catch (err) { handleError(res, err); }
  });

  const resetRateLimits = new Map<string, { count: number; resetAt: number }>();
  function checkResetRateLimit(key: string, maxAttempts: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = resetRateLimits.get(key);
    if (!entry || now > entry.resetAt) {
      resetRateLimits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= maxAttempts) return false;
    entry.count++;
    return true;
  }

  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "Email is required" });

      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const isProd = process.env.NODE_ENV === "production";
      if (!checkResetRateLimit(`forgot:${ip}`, isProd ? 5 : 500, 15 * 60 * 1000) ||
          !checkResetRateLimit(`forgot:${email.toLowerCase()}`, isProd ? 3 : 500, 15 * 60 * 1000)) {
        return res.json({ message: "If an account exists with that email, a password reset link has been sent." });
      }

      const result = await createPasswordResetToken(email);
      if ("error" in result) {
        return res.status(400).json({ error: result.error });
      }

      if (result.token !== "noop") {
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = req.headers.host || "localhost:5000";
        const resetUrl = `${protocol}://${host}/reset-password?token=${result.token}`;

        const emailResult = await sendEmail({
          to: email,
          subject: "Reset your ScooPilot password",
          text: `You requested a password reset. Click the link below to set a new password:\n\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can safely ignore this email.`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">ScooPilot</h1>
              </div>
              <div style="padding: 20px; border: 1px solid #e5e7eb;">
                <h2 style="margin-top: 0;">Password Reset</h2>
                <p>You requested a password reset. Click the button below to set a new password:</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${resetUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
                </div>
                <p style="color: #6b7280; font-size: 14px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
                <p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">If the button doesn't work, copy and paste this link into your browser:<br/>${resetUrl}</p>
              </div>
            </div>
          `,
        });
        if (!emailResult.success) {
          console.error("[Password Reset] Failed to send email:", emailResult.error);
        } else {
          console.log("[Password Reset] Email sent successfully to:", email);
        }
      }

      return res.json({ message: "If an account exists with that email, a password reset link has been sent." });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body;
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkResetRateLimit(`reset:${ip}`, process.env.NODE_ENV === "production" ? 10 : 500, 15 * 60 * 1000)) {
        return res.status(429).json({ error: "Too many attempts. Please try again later." });
      }
      const result = await resetPasswordWithToken(token, password);
      if ("error" in result) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ message: "Password has been reset successfully. You can now sign in." });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/auth/change-password", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { newPassword } = req.body;
      if (!newPassword) return res.status(400).json({ error: "New password is required" });
      const result = await changePassword(userId, newPassword);
      if ("error" in result) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ message: "Password changed successfully" });
    } catch (err) { handleError(res, err); }
  });

  // ================ Setup / Onboarding ================

  async function ensureCompanySetup(userId: string, companyName?: string): Promise<{ companyId: string; alreadySetup: boolean }> {
    const existing = await storage.getCompaniesForUser(userId);
    if (existing.length > 0) {
      return { companyId: existing[0].companyId, alreadySetup: true };
    }
    const user = await getUserById(userId);
    const username = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || "User" : "User";
    const resolvedName = companyName?.trim() || `${username}'s Company`;

    const baseSlug = resolvedName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "company";
    let slug = baseSlug;
    let slugSuffix = 1;
    while (true) {
      const existingSlug = await storage.getCompanyBySlug(slug);
      if (!existingSlug) break;
      slug = `${baseSlug}-${slugSuffix++}`;
    }

    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const company = await storage.createCompany({
      name: resolvedName,
      email: user?.email || "",
      slug,
      subscriptionTier: "free_trial",
      subscriptionStatus: "trialing",
      trialEndsAt,
    } as typeof companies.$inferInsert);
    await storage.addUserToCompany(userId, company.id, "owner");

    await seedDefaultLeadSources(company.id);
    await storage.seedDefaultPricing(company.id);

    return { companyId: company.id, alreadySetup: false };
  }

  async function seedDefaultLeadSources(companyId: string) {
    const defaultLeadSources = ["Referral", "Nextdoor", "Facebook", "Yelp", "Instagram", "Google Ad", "Organic Search", "Bing", "Yard Sign", "Local Advertising"];
    for (const name of defaultLeadSources) {
      await storage.createLeadSource({ companyId, name });
    }
  }

  app.post("/api/setup", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any).userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const result = await ensureCompanySetup(userId);
      return res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/onboarding/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contactsList = await storage.getContacts(companyId);
      const routesList = await storage.getRoutes(companyId);
      const plansList = await storage.getServicePlans(companyId);
      const zonesList = await storage.getServiceZones(companyId);

      const hasServiceZones = zonesList.length > 0;
      const hasContacts = contactsList.length > 0;
      const hasRoutes = routesList.length > 0;
      const hasServicePlans = plansList.length > 0;

      let firstContact: any = null;
      let firstProperty: any = null;
      let firstServicePlan: any = null;
      if (hasContacts) {
        firstContact = contactsList[0];
        const props = await storage.getProperties(companyId, firstContact.id);
        if (props.length > 0) firstProperty = props[0];
      }
      if (hasServicePlans) {
        firstServicePlan = plansList[0];
      }

      let hasPriceRecommendation = false;
      if (firstProperty) {
        const recs = await storage.getPriceRecommendations(companyId);
        hasPriceRecommendation = recs.some((r: any) => r.propertyId === firstProperty.id);
      }

      const steps = [
        { key: "service_zones", label: "Set up your service zones", completed: hasServiceZones },
        { key: "add_customer", label: "Add your first customer", completed: hasContacts },
        { key: "price_property", label: "Price your first property", completed: hasPriceRecommendation || hasServicePlans },
        { key: "create_service_plan", label: "Schedule your first service", completed: hasServicePlans },
        { key: "generate_route", label: "Generate your first route", completed: hasRoutes },
      ];

      const isComplete = steps.filter(s => s.key !== "service_zones").every(s => s.completed);
      res.json({
        isComplete,
        steps,
        firstContact: firstContact ? { id: firstContact.id, firstName: firstContact.firstName, lastName: firstContact.lastName } : null,
        firstProperty: firstProperty ? {
          id: firstProperty.id,
          streetAddress: firstProperty.streetAddress,
          city: firstProperty.city,
          state: firstProperty.state,
          yardSize: firstProperty.yardSize,
          numberOfDogs: firstProperty.numberOfDogs,
          measuredYardSqft: firstProperty.measuredYardSqft,
        } : null,
        firstServicePlan: firstServicePlan ? { id: firstServicePlan.id, routeId: firstServicePlan.routeId } : null,
      });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/onboarding/business-status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const result = await db.execute(sql`SELECT name, email, phone, address, logo_url, website_url, business_description, service_area_description, pricing_config, stripe_connect_account_id, stripe_connect_onboarded, business_onboarding_step, business_onboarding_complete FROM companies WHERE id = ${companyId}`);
      const rows = result.rows as Record<string, unknown>[];
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Company not found" });
      const row = rows[0];
      const step = (row.business_onboarding_step as number) ?? 0;
      const completedSteps: number[] = Array.from({ length: step }, (_, i) => i);
      res.json({
        currentStep: step,
        isComplete: (row.business_onboarding_complete as boolean) ?? false,
        completedSteps,
        companyData: {
          name: row.name,
          email: row.email,
          phone: row.phone,
          address: row.address,
          logoUrl: row.logo_url,
          websiteUrl: row.website_url,
          businessDescription: row.business_description,
          serviceAreaDescription: row.service_area_description,
          pricingConfig: row.pricing_config,
          stripeConnectAccountId: row.stripe_connect_account_id,
          stripeConnectOnboarded: row.stripe_connect_onboarded,
        },
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/onboarding/business-step", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const { step, data, resetWizard } = req.body;

      if (resetWizard) {
        await db.execute(sql`UPDATE companies SET business_onboarding_step = 0, business_onboarding_complete = false WHERE id = ${companyId}`);
        return res.json({ success: true, nextStep: 0 });
      }

      if (typeof step !== "number" || step < 0 || step > 4) {
        return res.status(400).json({ error: "Invalid step number" });
      }

      if (step === 0 && data) {
        await db.execute(sql`UPDATE companies SET
          name = ${data.name || sql`name`},
          email = ${data.email || sql`email`},
          phone = ${data.phone || sql`phone`},
          address = ${data.address || sql`address`},
          website_url = ${data.websiteUrl || null},
          timezone = ${data.timezone || sql`timezone`},
          business_onboarding_step = ${step + 1}
          WHERE id = ${companyId}`);
      } else if (step === 1 && data) {
        await db.execute(sql`UPDATE companies SET business_description = ${data.businessDescription || null}, service_area_description = ${data.serviceAreaDescription || null}, business_onboarding_step = ${step + 1} WHERE id = ${companyId}`);
      } else if (step === 2 && data?.pricingConfig) {
        await db.execute(sql`UPDATE companies SET pricing_config = ${JSON.stringify(data.pricingConfig)}::jsonb, business_onboarding_step = ${step + 1} WHERE id = ${companyId}`);
      } else {
        await db.execute(sql`UPDATE companies SET business_onboarding_step = ${step + 1} WHERE id = ${companyId}`);
      }

      res.json({ success: true, nextStep: step + 1 });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/onboarding/business-complete", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      await db.execute(
        sql`UPDATE companies SET business_onboarding_complete = true, business_onboarding_step = 5 WHERE id = ${companyId}`
      );
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/onboarding/scrape-website", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      let { websiteUrl } = req.body;
      if (!websiteUrl || typeof websiteUrl !== "string") return res.status(400).json({ error: "Website URL is required" });

      websiteUrl = websiteUrl.trim();
      if (!/^https?:\/\//i.test(websiteUrl)) {
        websiteUrl = `https://${websiteUrl}`;
      }

      let parsed: URL;
      try {
        parsed = new URL(websiteUrl);
      } catch {
        return res.status(400).json({ error: "Invalid URL format" });
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return res.status(400).json({ error: "Only HTTP/HTTPS URLs are allowed" });
      }
      const hostname = parsed.hostname.toLowerCase();
      const hostnameBlockedPatterns = [
        /^localhost$/i,
        /metadata\.google/i,
        /\.internal$/i,
        /\.local$/i,
      ];
      if (hostnameBlockedPatterns.some(p => p.test(hostname))) {
        return res.status(400).json({ error: "URL points to a restricted network address" });
      }

      const isPrivateIP = (ip: string): boolean => {
        const parts = ip.split(".").map(Number);
        if (parts.length === 4) {
          if (parts[0] === 127) return true;
          if (parts[0] === 10) return true;
          if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
          if (parts[0] === 192 && parts[1] === 168) return true;
          if (parts[0] === 169 && parts[1] === 254) return true;
          if (parts[0] === 0) return true;
        }
        if (ip === "::1" || ip === "::" || ip.startsWith("fc00:") || ip.startsWith("fd") || ip.startsWith("fe80:")) return true;
        return false;
      };

      const ipLiteralMatch = hostname.match(/^\[?([0-9a-f.:]+)\]?$/i);
      if (ipLiteralMatch && isPrivateIP(ipLiteralMatch[1])) {
        return res.status(400).json({ error: "URL points to a restricted network address" });
      }
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) && isPrivateIP(hostname)) {
        return res.status(400).json({ error: "URL points to a restricted network address" });
      }

      const dns = await import("dns");
      const { promisify } = await import("util");
      const dnsResolve = promisify(dns.resolve);

      const validateResolvedIPs = async (host: string): Promise<boolean> => {
        let resolvedIPs: string[] = [];
        try { resolvedIPs = resolvedIPs.concat(await dnsResolve(host, "A")); } catch {}
        try { resolvedIPs = resolvedIPs.concat(await dnsResolve(host, "AAAA")); } catch {}
        if (resolvedIPs.length === 0) return true;
        return !resolvedIPs.some(isPrivateIP);
      };

      if (!(await validateResolvedIPs(hostname))) {
        return res.status(400).json({ error: "URL resolves to a private network address" });
      }

      let pageText = "";
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(parsed.toString(), {
          signal: controller.signal,
          headers: { "User-Agent": "ScooPilot-Onboarding/1.0" },
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (location) {
            try {
              const redirectUrl = new URL(location, parsed.toString());
              if (!["http:", "https:"].includes(redirectUrl.protocol)) {
                return res.json({ success: false, error: "Redirect to non-HTTP URL blocked.", insights: null });
              }
              const rHost = redirectUrl.hostname.toLowerCase();
              if (hostnameBlockedPatterns.some(p => p.test(rHost))) {
                return res.json({ success: false, error: "Redirect to restricted address blocked.", insights: null });
              }
              if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(rHost) && isPrivateIP(rHost)) {
                return res.json({ success: false, error: "Redirect to private IP blocked.", insights: null });
              }
              if (!(await validateResolvedIPs(rHost))) {
                return res.json({ success: false, error: "Redirect resolves to private address.", insights: null });
              }
              const controller2 = new AbortController();
              const timeout2 = setTimeout(() => controller2.abort(), 10000);
              const response2 = await fetch(redirectUrl.toString(), {
                signal: controller2.signal,
                headers: { "User-Agent": "ScooPilot-Onboarding/1.0" },
                redirect: "manual",
              });
              clearTimeout(timeout2);
              const ct2 = response2.headers.get("content-type") || "";
              if (!ct2.includes("text/html") && !ct2.includes("text/plain")) {
                return res.json({ success: false, error: "URL did not return an HTML page.", insights: null });
              }
              const html2 = await response2.text();
              pageText = html2.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000);
            } catch {
              return res.json({ success: false, error: "Could not follow redirect.", insights: null });
            }
          } else {
            return res.json({ success: false, error: "Redirect without location header.", insights: null });
          }
        } else {
          clearTimeout(timeout);
          const contentType = response.headers.get("content-type") || "";
          if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
            return res.json({ success: false, error: "URL did not return an HTML page.", insights: null });
          }
          const html = await response.text();
          pageText = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 5000);
        }
      } catch (fetchErr) {
        return res.json({
          success: false,
          error: "Could not fetch website. Please check the URL and try again.",
          insights: null,
        });
      }

      try {
        const OpenAI = (await import("openai")).default;
        const ai = new OpenAI({
          apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
          baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
        });

        const completion = await ai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are a business analyst specializing in pet waste removal companies. Analyze the following website text and extract business intelligence. Return a JSON object with these fields:
- businessDescription: string (1-2 sentence summary of what the business does)
- serviceArea: string (geographic area they serve, if mentioned)
- servicesOffered: string[] (list of services)
- pricingInfo: { weeklyPrice?: number, biweeklyPrice?: number, monthlyPrice?: number, oneTimePrice?: number, perDogExtra?: number } (any pricing found, in dollars)
- competitiveInsights: string (brief competitive positioning notes)
- suggestedPricingMode: "aggressive" | "standard" | "premium" (based on their positioning)
Return ONLY valid JSON, no markdown.`,
            },
            { role: "user", content: pageText },
          ],
          temperature: 0.3,
          max_tokens: 1000,
        });

        const raw = completion.choices[0]?.message?.content || "{}";
        let insights;
        try {
          insights = JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
        } catch {
          insights = { businessDescription: raw, serviceArea: "", servicesOffered: [], pricingInfo: {}, competitiveInsights: "", suggestedPricingMode: "standard" };
        }

        res.json({ success: true, insights, rawTextLength: pageText.length });
      } catch (aiErr) {
        console.error("[Onboarding] AI analysis failed:", aiErr instanceof Error ? aiErr.message : aiErr);
        res.json({
          success: true,
          insights: { businessDescription: "Unable to analyze website content automatically.", serviceArea: "", servicesOffered: [], pricingInfo: {}, competitiveInsights: "", suggestedPricingMode: "standard" },
          rawTextLength: pageText.length,
        });
      }
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/onboarding/import-pricing-csv", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const { csvText } = req.body;
      if (!csvText) return res.status(400).json({ error: "CSV text is required" });

      const { parseCSV } = await import("./services/import-transforms");
      const { headers, rows } = parseCSV(csvText);

      if (rows.length === 0) return res.status(400).json({ error: "CSV has no data rows" });

      const priceHeaders = headers.filter(h => {
        const lower = h.toLowerCase();
        return lower.includes("price") || lower.includes("rate") || lower.includes("cost") || lower.includes("amount") || lower.includes("fee") || lower.includes("charge");
      });
      const freqHeaders = headers.filter(h => {
        const lower = h.toLowerCase();
        return lower.includes("frequency") || lower.includes("schedule") || lower.includes("service");
      });
      const sizeHeaders = headers.filter(h => {
        const lower = h.toLowerCase();
        return lower.includes("yard") || lower.includes("size") || lower.includes("lot") || lower.includes("acre") || lower.includes("sqft");
      });
      const dogHeaders = headers.filter(h => {
        const lower = h.toLowerCase();
        return lower.includes("dog") || lower.includes("pet");
      });

      const pricingData: any[] = [];
      for (const row of rows) {
        const entry: any = {};
        for (let i = 0; i < headers.length; i++) {
          entry[headers[i]] = row[i] || "";
        }
        pricingData.push(entry);
      }

      const summary = {
        totalRows: rows.length,
        headers,
        priceColumns: priceHeaders,
        frequencyColumns: freqHeaders,
        sizeColumns: sizeHeaders,
        dogColumns: dogHeaders,
        sampleRows: pricingData.slice(0, 5),
      };

      res.json({ success: true, summary });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/company/invite", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const { email, firstName, lastName, role: targetRole } = req.body;
      if (!email) return res.status(400).json({ error: "Email is required" });
      if (!firstName) return res.status(400).json({ error: "First name is required" });
      const validRoles = ["admin", "tech"];
      if (!validRoles.includes(targetRole || "tech")) {
        return res.status(400).json({ error: "Invalid role" });
      }

      const company = await storage.getCompany(companyId);
      const companyUsersList = await storage.getCompanyUsers(companyId);
      const activeCount = companyUsersList.filter(cu => cu.isActive).length;
      const tier = company?.subscriptionTier || "tier_1";
      const tierConfig = (await import("@shared/schema")).TIER_CONFIG;
      const tierMaxUsers = tierConfig[tier as keyof typeof tierConfig]?.maxUsers || 1;
      const maxUsers = company?.customMaxUsers ?? tierMaxUsers;
      if (activeCount >= maxUsers) {
        return res.status(400).json({ error: `Seat limit reached (${activeCount}/${maxUsers}). Upgrade your plan to add more team members.` });
      }

      let existingUser = await getUserByEmail(email);
      let tempPassword: string | null = null;

      if (existingUser) {
        const existingMembership = await storage.getCompanyUser(companyId, existingUser.id);
        if (existingMembership && existingMembership.isActive) {
          return res.status(409).json({ error: "This user is already a team member" });
        }
        if (existingMembership && !existingMembership.isActive) {
          await storage.updateCompanyUser(existingMembership.id, { isActive: true, role: targetRole || "tech" });
        } else {
          await storage.addUserToCompany(existingUser.id, companyId, targetRole || "tech");
        }
      } else {
        const crypto = await import("crypto");
        tempPassword = crypto.randomBytes(6).toString("base64url");
        existingUser = await createUserWithTempPassword(email, firstName, lastName || "", tempPassword);
        await storage.addUserToCompany(existingUser.id, companyId, targetRole || "tech");
      }

      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host || "localhost:5000";
      const appUrl = `${protocol}://${host}/auth`;
      const companyName = company?.name || "your company";

      if (tempPassword) {
        await sendEmail({
          companyId: companyId,
          to: email,
          subject: `You've been invited to ${companyName} on ScooPilot`,
          senderName: company?.name || undefined,
          replyTo: company?.email || undefined,
          text: `Hi ${firstName},\n\nYou've been added as a ${targetRole || "tech"} on ${companyName}'s ScooPilot account.\n\nLog in at: ${appUrl}\nEmail: ${email}\nTemporary Password: ${tempPassword}\n\nYou'll be asked to set a new password on your first login.\n\nFor the best experience on your phone, open the link above and install the app when prompted.`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">${companyName}</h1>
              </div>
              <div style="padding: 20px; border: 1px solid #e5e7eb;">
                <h2 style="margin-top: 0;">Welcome to ${companyName}!</h2>
                <p>Hi ${firstName},</p>
                <p>You've been added as a <strong>${targetRole || "technician"}</strong> on ${companyName}'s ScooPilot account.</p>
                <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
                  <p style="margin: 4px 0;"><strong>Email:</strong> ${email}</p>
                  <p style="margin: 4px 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
                </div>
                <div style="text-align: center; margin: 24px 0;">
                  <a href="${appUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log In Now</a>
                </div>
                <p style="color: #6b7280; font-size: 14px;">You'll be asked to set a new password when you first log in.</p>
                <p style="color: #6b7280; font-size: 14px;">For the best experience on your phone, open the app and tap "Install" when prompted.</p>
              </div>
            </div>
          `,
        });
      } else {
        await sendEmail({
          companyId: companyId,
          to: email,
          subject: `You've been added to ${companyName} on ScooPilot`,
          senderName: company?.name || undefined,
          replyTo: company?.email || undefined,
          text: `Hi ${firstName},\n\nYou've been added as a ${targetRole || "tech"} on ${companyName}'s ScooPilot account. Log in with your existing credentials at: ${appUrl}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">${companyName}</h1>
              </div>
              <div style="padding: 20px; border: 1px solid #e5e7eb;">
                <h2 style="margin-top: 0;">You've been added to ${companyName}</h2>
                <p>Hi ${firstName},</p>
                <p>You've been added as a <strong>${targetRole || "technician"}</strong>. Log in with your existing credentials.</p>
                <div style="text-align: center; margin: 24px 0;">
                  <a href="${appUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log In Now</a>
                </div>
              </div>
            </div>
          `,
        });
      }

      (async () => {
        try {
          await storage.createUsageEvent({
            companyId,
            eventType: "user_seat",
            quantity: 1,
            metadata: { userId: existingUser.id, email, role: targetRole || "tech" },
          });
          const activeMembers = await storage.getCompanyUsers(companyId);
          const activeCount = activeMembers.filter(m => m.isActive !== false).length;
          const company = await storage.getCompany(companyId);
          if (company?.stripeSubscriptionId) {
            reportMeteredUsageSet(company.stripeSubscriptionId, "user_seat", activeCount).catch(() => {});
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[Usage] Failed to log user seat event:", message);
        }
      })();

      res.json({ success: true, userId: existingUser.id, email, role: targetRole || "tech" });
    } catch (err) { handleError(res, err); }
  });

  // ================ Company Routes ================

  function sanitizeCompany(company: any) {
    if (!company) return company;
    const { telnyxApiKey, qboAccessToken, qboRefreshToken, ...safe } = company;
    return { ...safe, telnyxApiKey: telnyxApiKey ? "••••••••" : null };
  }

  app.get("/api/company", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      res.json(sanitizeCompany(company));
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/company", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role, userId } = await getCompanyContext(req);
      requireRole(role);
      const existing = await storage.getCompany(companyId);
      const validTimezones = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];
      const allowed = ["name", "email", "phone", "address", "startAddress", "startLatitude", "startLongitude",
        "logoUrl", "chargeTiming", "invoiceTheme", "remindersEnabled", "autoVisitsEnabled", "dashboardLayout", "settingsLayout", "dashboardNotes", "timezone",
        "reminderSettings", "invoiceReminderSettings", "roverAiEnabled", "slug", "leadWebhookSmsTemplate",
        "quoteAutoFollowUpEnabled", "quoteFollowUpSmsTemplate", "quoteFollowUpEmailEnabled", "quoteFollowUpEmailSubject", "quoteFollowUpEmailBody", "quoteFormLayout",
        "telnyxApiKey", "telnyxPhoneNumber", "telnyxMessagingProfileId", "venmoHandle", "maxStopsPerRoute",
        "country", "currency", "taxRatePercent"];
      const updates: any = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      if (updates.timezone && !validTimezones.includes(updates.timezone)) {
        return res.status(400).json({ error: "Invalid timezone" });
      }
      if (updates.slug !== undefined) {
        const cleanSlug = String(updates.slug).toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-|-$/g, "");
        if (!cleanSlug || cleanSlug.length < 3) return res.status(400).json({ error: "Slug must be at least 3 characters" });
        if (cleanSlug.length > 60) return res.status(400).json({ error: "Slug must be 60 characters or fewer" });
        const existingSlug = await storage.getCompanyBySlug(cleanSlug);
        if (existingSlug && existingSlug.id !== companyId) return res.status(409).json({ error: "This slug is already taken" });
        updates.slug = cleanSlug;
      }
      if (updates.telnyxApiKey && typeof updates.telnyxApiKey === "string" && updates.telnyxApiKey.length > 0) {
        const { encrypt } = await import("./utils/encryption");
        updates.telnyxApiKey = encrypt(updates.telnyxApiKey);
      }
      if (updates.reminderSettings) {
        const validTimings = ["24h_before", "2h_before", "morning_of", "custom"];
        const validChannels = ["email", "sms", "both"];
        if (!Array.isArray(updates.reminderSettings)) {
          return res.status(400).json({ error: "reminderSettings must be an array" });
        }
        for (const rule of updates.reminderSettings) {
          if (!rule.id || typeof rule.id !== "string") return res.status(400).json({ error: "Each rule must have a string id" });
          if (!validTimings.includes(rule.timing)) return res.status(400).json({ error: `Invalid timing: ${rule.timing}` });
          if (!validChannels.includes(rule.channel)) return res.status(400).json({ error: `Invalid channel: ${rule.channel}` });
          if (!rule.template || typeof rule.template !== "string") return res.status(400).json({ error: "Each rule must have a template string" });
          if (rule.timing === "custom" && (typeof rule.customHours !== "number" || rule.customHours < 0.5 || rule.customHours > 72)) {
            return res.status(400).json({ error: "Custom timing requires customHours between 0.5 and 72" });
          }
        }
      }
      if (updates.invoiceReminderSettings) {
        const s = updates.invoiceReminderSettings;
        if (!Array.isArray(s.preDueDays) || s.preDueDays.some((d: unknown) => typeof d !== "number" || d < 0)) {
          return res.status(400).json({ error: "preDueDays must be an array of non-negative numbers" });
        }
        if (typeof s.overdueIntervalDays !== "number" || s.overdueIntervalDays < 1) {
          return res.status(400).json({ error: "overdueIntervalDays must be at least 1" });
        }
        if (typeof s.maxReminders !== "number" || s.maxReminders < 1 || s.maxReminders > 100) {
          return res.status(400).json({ error: "maxReminders must be between 1 and 100" });
        }
      }
      if (updates.country !== undefined) {
        if (!["us", "ca"].includes(String(updates.country))) {
          return res.status(400).json({ error: "country must be 'us' or 'ca'" });
        }
      }
      if (updates.currency !== undefined) {
        if (!["usd", "cad"].includes(String(updates.currency))) {
          return res.status(400).json({ error: "currency must be 'usd' or 'cad'" });
        }
      }
      if (updates.taxRatePercent !== undefined && updates.taxRatePercent !== null) {
        const rate = parseFloat(String(updates.taxRatePercent));
        if (isNaN(rate) || rate < 0 || rate > 100) {
          return res.status(400).json({ error: "taxRatePercent must be between 0 and 100" });
        }
        updates.taxRatePercent = rate.toFixed(2);
      }
      if (updates.venmoHandle !== undefined) {
        const raw = String(updates.venmoHandle).trim().replace(/^@+/, "").replace(/[^a-zA-Z0-9_.\-]/g, "");
        if (raw.length > 0 && raw.length > 50) {
          return res.status(400).json({ error: "Venmo handle must be 50 characters or fewer" });
        }
        updates.venmoHandle = raw || null;
      }
      const company = await storage.updateCompany(companyId, updates);
      auditLog(companyId, userId, "company", companyId, "update", { old: sanitizeCompany(existing), new: sanitizeCompany(company) }, req.ip);
      res.json(sanitizeCompany(company));
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/company/users", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const companyUsersList = await storage.getCompanyUsers(companyId);
      res.json(companyUsersList);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/company/team", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const companyUsersList = await storage.getCompanyUsers(companyId);
      const teamMembers = await Promise.all(
        companyUsersList.filter(cu => cu.isActive).map(async (cu) => {
          const user = await getUserById(cu.userId);
          return {
            id: cu.userId,
            companyUserId: cu.id,
            role: cu.role,
            firstName: user?.firstName || "",
            lastName: user?.lastName || "",
            email: user?.email || "",
            profileImageUrl: user?.profileImageUrl || null,
          };
        })
      );
      res.json(teamMembers);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/company/team/:userId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role, userId: currentUserId } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const targetUserId = req.params.userId;
      if (targetUserId === currentUserId) {
        return res.status(400).json({ error: "You cannot remove yourself" });
      }
      const membership = await storage.getCompanyUser(companyId, targetUserId);
      if (!membership) {
        return res.status(404).json({ error: "Team member not found" });
      }
      if (membership.role === "owner") {
        return res.status(400).json({ error: "Cannot remove the company owner" });
      }
      await storage.updateCompanyUser(membership.id, { isActive: false });
      const routes = await storage.getRoutes(companyId);
      for (const route of routes) {
        if (route.technicianId === targetUserId) {
          await storage.updateRoute(route.id, companyId, { technicianId: null });
        }
      }

      (async () => {
        try {
          await storage.createUsageEvent({
            companyId,
            eventType: "user_seat",
            quantity: -1,
            metadata: { userId: targetUserId, action: "removed" },
          });
          const activeMembers = await storage.getCompanyUsers(companyId);
          const activeCount = activeMembers.filter(m => m.isActive !== false).length;
          const company = await storage.getCompany(companyId);
          if (company?.stripeSubscriptionId) {
            reportMeteredUsageSet(company.stripeSubscriptionId, "user_seat", activeCount).catch(() => {});
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[Usage] Failed to log seat removal:", message);
        }
      })();

      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/company/users", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const { email, name, role: userRole, phone } = req.body;
      const cu = await storage.createCompanyUser({ email, name, role: userRole, phone, companyId });
      res.status(201).json(cu);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/company/team/:userId/reset-password", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role, userId: currentUserId } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const targetUserId = req.params.userId;
      if (targetUserId === currentUserId) {
        return res.status(400).json({ error: "Use the change password form to update your own password" });
      }
      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      const membership = await storage.getCompanyUser(companyId, targetUserId);
      if (!membership || !membership.isActive) {
        return res.status(404).json({ error: "Team member not found" });
      }
      if (membership.role === "owner") {
        return res.status(403).json({ error: "Cannot reset the owner's password" });
      }
      if (role === "admin" && membership.role === "admin") {
        return res.status(403).json({ error: "Admins can only reset passwords for technicians" });
      }
      const result = await changePassword(targetUserId, newPassword);
      if ("error" in result) {
        return res.status(400).json({ error: result.error });
      }
      auditLog(companyId, currentUserId, "user", targetUserId, "password_reset", { resetBy: currentUserId });
      res.json({ success: true, message: "Password has been updated." });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/company/stats", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const tier = company.subscriptionTier as keyof typeof TIER_CONFIG;
      const tierInfo = TIER_CONFIG[tier];

      const tz = company.timezone || "America/New_York";
      const today = getCompanyToday(tz);
      const monthStart = getCompanyMonthStart(tz);
      const monthEnd = getCompanyMonthEnd(tz);

      const [todaysVisitsList, overdueVisits, failedPayments, activeUsers, overdueInvoices, invoiceMonthRevenue, smsCountThisMonth, emailCountThisMonth, monthVisitsForRevenue] = await Promise.all([
        storage.getTodaysVisits(companyId, today),
        storage.getOverdueVisits(companyId, today),
        storage.getFailedPaymentsCount(companyId),
        storage.countActiveCompanyUsers(companyId),
        storage.getOverdueInvoicesCount(companyId, today),
        storage.getRevenueForPeriod(companyId, monthStart, monthEnd, tz),
        storage.getSmsCountForPeriod(companyId, monthStart, monthEnd),
        storage.getEmailCountForPeriod(companyId, monthStart, monthEnd),
        storage.getVisitsForDateRange(companyId, monthStart, monthEnd),
      ]);

      const todaysWorkload = [...overdueVisits, ...todaysVisitsList];
      const todaysVisits = todaysWorkload.length;

      const completedToday = todaysVisitsList.filter(v => v.status === "completed").length;
      const scheduledToday = todaysWorkload.filter(v => v.status === "scheduled").length;
      const inProgressToday = todaysWorkload.filter(v => v.status === "in_progress").length;

      const allActivePlans = await storage.getServicePlans(companyId, { isActive: true });
      const activePlans = allActivePlans.filter(p => !p.isStopOnly);

      const stopOnlyOnlyContactIds = getStopOnlyOnlyContactIds(allActivePlans);
      const allActiveStatusContacts = await storage.getContacts(companyId, { status: "active" });
      const activeContacts = allActiveStatusContacts.filter(c => !stopOnlyOnlyContactIds.has(c.id)).length;
      const activeServicePlans = activePlans.length;

      const allAddOnsMap = await storage.getAllServicePlanAddOnsForCompany(activePlans.map(p => p.id));
      let mrr = 0;
      for (const plan of activePlans) {
        const basePrice = parseFloat(plan.pricePerVisit) || 0;
        const addOns = allAddOnsMap.get(plan.id) || [];
        const addOnsTotal = addOns.filter(a => a.isActive).reduce((sum, a) => sum + (parseFloat(a.price) || 0), 0);
        const perVisit = basePrice + addOnsTotal;

        let visitsPerMonth = 0;
        switch (plan.frequency) {
          case "weekly": visitsPerMonth = 4.33; break;
          case "biweekly": visitsPerMonth = 2.17; break;
          case "monthly": visitsPerMonth = 1; break;
          case "onetime": visitsPerMonth = 0; break;
          default: visitsPerMonth = 4.33;
        }
        mrr += perVisit * visitsPerMonth;
      }
      mrr = Math.round(mrr * 100) / 100;

      let monthRevenue = invoiceMonthRevenue;
      if (monthRevenue === 0) {
        const planPriceMap = new Map(allActivePlans.map(p => [p.id, parseFloat(p.pricePerVisit) || 0]));
        let earned = 0;
        for (const v of monthVisitsForRevenue) {
          if (v.status === "completed") earned += planPriceMap.get(v.servicePlanId) || 0;
        }
        monthRevenue = Math.round(earned * 100) / 100;
      }

      res.json({
        mrr,
        todaysVisits,
        todaysVisitBreakdown: { completed: completedToday, scheduled: scheduledToday, inProgress: inProgressToday },
        failedPayments,
        overdueInvoices,
        activeUsers,
        activeContacts,
        activeServicePlans,
        monthRevenue,
        smsCountThisMonth,
        emailCountThisMonth,
        subscriptionTier: tier,
        tierName: tierInfo?.name ?? "Unknown",
      });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/company/reminder-settings", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      const reminderSettings = company?.reminderSettings || [
        { id: "default_24h", timing: "24h_before", channel: "sms", template: "Hi {firstName}, your service with {companyName} is scheduled for tomorrow at {propertyAddress}. Thank you!", isActive: true }
      ];
      const invoiceReminderSettings = company?.invoiceReminderSettings || {
        preDueDays: [7, 2, 1, 0], overdueIntervalDays: 2, maxReminders: 10
      };
      res.json({ reminderSettings, invoiceReminderSettings, remindersEnabled: company?.remindersEnabled || false });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/company/reminder-logs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = (page - 1) * limit;
      const [logs, countResult] = await Promise.all([
        db.select({
          id: reminderLogs.id,
          contactId: reminderLogs.contactId,
          visitId: reminderLogs.visitId,
          invoiceId: reminderLogs.invoiceId,
          ruleId: reminderLogs.ruleId,
          reminderType: reminderLogs.reminderType,
          channel: reminderLogs.channel,
          messagePreview: reminderLogs.messagePreview,
          deliveryStatus: reminderLogs.deliveryStatus,
          sentAt: reminderLogs.sentAt,
        })
          .from(reminderLogs)
          .where(eq(reminderLogs.companyId, companyId))
          .orderBy(desc(reminderLogs.sentAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: sql<number>`count(*)::int` })
          .from(reminderLogs)
          .where(eq(reminderLogs.companyId, companyId)),
      ]);

      const contactIds = [...new Set(logs.map(l => l.contactId))];
      let contactMap = new Map<string, string>();
      if (contactIds.length > 0) {
        const contactRows = await db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
          .from(contacts).where(inArray(contacts.id, contactIds));
        contactMap = new Map(contactRows.map(c => [c.id, `${c.firstName} ${c.lastName}`.trim()]));
      }

      const enrichedLogs = logs.map(l => ({
        ...l,
        contactName: contactMap.get(l.contactId) || "Unknown",
      }));

      res.json({ logs: enrichedLogs, total: countResult[0]?.total || 0, page, limit });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/company/revenue-chart", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      const tz = company?.timezone || "America/New_York";
      const now = new Date();
      const months: { month: string; revenue: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const start = d.toISOString().split("T")[0];
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0];
        const revenue = await storage.getRevenueForPeriod(companyId, start, end, tz);
        months.push({
          month: d.toLocaleString("default", { month: "short" }),
          revenue: Math.round(revenue * 100) / 100,
        });
      }
      res.json(months);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/company/recent-activity", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const notifications = await storage.getNotifications(companyId, 10);
      res.json(notifications.map(n => ({
        id: n.id,
        title: n.title,
        message: n.message,
        type: n.type,
        linkUrl: n.linkUrl,
        isRead: n.isRead,
        createdAt: n.createdAt,
      })));
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/company/recent-communications", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);

      const [smsRows, emailRows] = await Promise.all([
        db.select().from(messagesTable).where(and(eq(messagesTable.companyId, companyId), eq(messagesTable.channel, "sms"))).orderBy(desc(messagesTable.createdAt)).limit(5),
        db.select().from(messagesTable).where(and(eq(messagesTable.companyId, companyId), eq(messagesTable.channel, "email"))).orderBy(desc(messagesTable.createdAt)).limit(5),
      ]);

      const contactCache = new Map<string, string>();
      async function enrichWithContact(m: Message) {
        let contactName = "";
        if (m.contactId) {
          if (contactCache.has(m.contactId)) {
            contactName = contactCache.get(m.contactId)!;
          } else {
            const contact = await storage.getContact(m.contactId, companyId);
            contactName = contact ? `${contact.firstName} ${contact.lastName}`.trim() : "";
            contactCache.set(m.contactId, contactName);
          }
        }
        return {
          id: m.id,
          contactId: m.contactId,
          contactName,
          channel: m.channel,
          direction: m.direction,
          subject: m.subject,
          body: m.body?.substring(0, 120) || "",
          createdAt: m.createdAt,
        };
      }

      const recentSms = await Promise.all(smsRows.map(enrichWithContact));
      const recentEmails = await Promise.all(emailRows.map(enrichWithContact));

      res.json({ sms: recentSms, emails: recentEmails });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/company/upcoming-visits", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      const tz = company?.timezone || "America/New_York";
      const today = getCompanyToday(tz);
      const weekEnd = getCompanyWeekEnd(tz);
      const visits = await storage.getVisitsForDateRange(companyId, today, weekEnd);
      const allPlans = await storage.getServicePlans(companyId, {});
      const allContacts = await storage.getContacts(companyId, {});
      const allProperties = await storage.getProperties(companyId);
      const planMap = new Map(allPlans.map(p => [p.id, p]));
      const contactMap = new Map(allContacts.map(c => [c.id, c]));
      const propMap = new Map(allProperties.map(p => [p.id, p]));
      const upcoming = visits
        .filter(v => v.status === "scheduled" && v.scheduledDate >= today)
        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
        .slice(0, 10)
        .map(v => {
          const plan = planMap.get(v.servicePlanId!);
          const contact = plan ? contactMap.get(plan.contactId) : null;
          const prop = plan ? propMap.get(plan.propertyId) : null;
          return {
            id: v.id,
            scheduledDate: v.scheduledDate,
            status: v.status,
            contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : "Unknown",
            propertyAddress: prop?.streetAddress || "Unknown",
            servicePlanName: plan?.name || "Service",
          };
        });
      res.json(upcoming);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/company/weather", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      let lat = company?.startLatitude ? parseFloat(String(company.startLatitude)) : null;
      let lon = company?.startLongitude ? parseFloat(String(company.startLongitude)) : null;
      if (!lat || !lon) {
        return res.json({ available: false, reason: "No company location set" });
      }
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&temperature_unit=fahrenheit&timezone=auto&forecast_days=5`;
      const resp = await fetch(url);
      if (!resp.ok) {
        return res.json({ available: false, reason: "Weather service unavailable" });
      }
      const data = await resp.json() as any;
      const days = (data.daily?.time || []).map((date: string, i: number) => ({
        date,
        tempMax: data.daily.temperature_2m_max?.[i] ?? null,
        tempMin: data.daily.temperature_2m_min?.[i] ?? null,
        precipProbability: data.daily.precipitation_probability_max?.[i] ?? null,
        weatherCode: data.daily.weathercode?.[i] ?? null,
      }));
      res.json({ available: true, days });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/company/route-map-data", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      const tz = company?.timezone || "America/New_York";
      const routes = await storage.getRoutes(companyId);
      const now = new Date();
      const todayDow = now.toLocaleDateString("en-US", { weekday: "long", timeZone: tz }).toLowerCase();
      const todayDateStr = now.toLocaleDateString("en-CA", { timeZone: tz });
      const todayRoutes = routes.filter(r => {
        if (r.date) {
          const routeDateStr = typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().split('T')[0];
          return routeDateStr === todayDateStr;
        }
        return (r.dayOfWeek || "").toLowerCase() === todayDow;
      });
      const allProperties = await storage.getProperties(companyId);
      const propMap = new Map(allProperties.map(p => [p.id, p]));
      const routeData = await Promise.all(todayRoutes.map(async (route) => {
        const plans = await storage.getServicePlans(companyId, { routeId: route.id, isActive: true });
        const coordinates = plans
          .sort((a, b) => (a.stopOrder || 0) - (b.stopOrder || 0))
          .map(p => {
            const prop = propMap.get(p.propertyId);
            return prop ? {
              lat: prop.latitude ? parseFloat(String(prop.latitude)) : null,
              lng: prop.longitude ? parseFloat(String(prop.longitude)) : null,
              address: prop.streetAddress || "",
            } : null;
          })
          .filter((c): c is { lat: number; lng: number; address: string } => c !== null && c.lat !== null && c.lng !== null);
        return {
          id: route.id,
          name: route.name,
          color: route.color || "#4CAF50",
          stopCount: plans.length,
          coordinates,
        };
      }));
      res.json({
        routes: routeData,
        startLat: company?.startLatitude ? parseFloat(String(company.startLatitude)) : null,
        startLng: company?.startLongitude ? parseFloat(String(company.startLongitude)) : null,
      });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/company/pipeline", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      const tz = company?.timezone || "America/New_York";
      const today = getCompanyToday(tz);
      const weekStartStr = getCompanyWeekStart(tz);
      const weekEndStr = getCompanyWeekEnd(tz);
      const monthStart = getCompanyMonthStart(tz);
      const monthEnd = getCompanyMonthEnd(tz);

      const [
        activePlans,
        uninvoicedSummary,
        todaysVisitsList,
        invoiceRevenue,
        overdueVisits,
        monthCompletedVisits,
      ] = await Promise.all([
        storage.getServicePlans(companyId, { isActive: true }),
        storage.getUninvoicedSummary(companyId),
        storage.getTodaysVisits(companyId, today),
        storage.getRevenueForPeriod(companyId, monthStart, monthEnd, tz),
        storage.getOverdueVisits(companyId, today),
        storage.getVisitsForDateRange(companyId, monthStart, monthEnd),
      ]);

      let earnedRevenue = 0;
      if (invoiceRevenue === 0) {
        const allPlansForRevenue = activePlans.length > 0 ? activePlans : await storage.getServicePlans(companyId, {});
        const planPriceMap = new Map(allPlansForRevenue.map(p => [p.id, parseFloat(p.pricePerVisit) || 0]));
        for (const v of monthCompletedVisits) {
          if (v.status === "completed") {
            earnedRevenue += planPriceMap.get(v.servicePlanId) || 0;
          }
        }
      }
      const monthRevenue = invoiceRevenue > 0 ? invoiceRevenue : Math.round(earnedRevenue * 100) / 100;

      const dashboardVisits = [...overdueVisits, ...todaysVisitsList];

      let activePlansMonthlyValue = 0;
      for (const plan of activePlans.filter(p => !p.isStopOnly)) {
        const basePrice = parseFloat(plan.pricePerVisit) || 0;
        let visitsPerMonth = 0;
        switch (plan.frequency) {
          case "weekly": visitsPerMonth = 4.33; break;
          case "biweekly": visitsPerMonth = 2.17; break;
          case "monthly": visitsPerMonth = 1; break;
          default: visitsPerMonth = 0;
        }
        activePlansMonthlyValue += basePrice * visitsPerMonth;
      }

      const weekVisits = await storage.getVisitsForDateRange(companyId, weekStartStr, weekEndStr);
      const scheduledThisWeek = weekVisits.filter(v =>
        v.status === "scheduled" || v.status === "in_progress"
      ).length;

      const allInvoices = await storage.getInvoices(companyId);
      const awaitingPayment = allInvoices.filter(i => ["pending", "sent"].includes(i.status));
      const awaitingPaymentTotal = awaitingPayment.reduce((sum, i) => sum + (parseFloat(i.total) || 0), 0);

      const overdueInvoices = allInvoices.filter(i =>
        ["pending", "sent"].includes(i.status) && i.dueDate < today
      );
      const overdueTotal = overdueInvoices.reduce((sum, i) => sum + (parseFloat(i.total) || 0), 0);

      const receivablesByContact = new Map<string, { contactId: string; total: number }>();
      for (const inv of awaitingPayment) {
        const existing = receivablesByContact.get(inv.contactId) || { contactId: inv.contactId, total: 0 };
        existing.total += parseFloat(inv.total) || 0;
        receivablesByContact.set(inv.contactId, existing);
      }
      const sortedReceivables = Array.from(receivablesByContact.values()).sort((a, b) => b.total - a.total).slice(0, 5);
      const topReceivables = await Promise.all(sortedReceivables.map(async (r) => {
        const contact = await storage.getContact(r.contactId, companyId);
        return {
          contactId: r.contactId,
          contactName: contact ? `${contact.firstName} ${contact.lastName}` : "Unknown",
          total: Math.round(r.total * 100) / 100,
        };
      }));

      const allPlans = activePlans.length > 0 ? activePlans : await storage.getServicePlans(companyId, {});
      const planMap = new Map(allPlans.map(p => [p.id, p]));

      const contactIds = new Set<string>();
      const propertyIds = new Set<string>();
      for (const v of dashboardVisits) {
        const plan = planMap.get(v.servicePlanId);
        if (plan) contactIds.add(plan.contactId);
        propertyIds.add(v.propertyId);
      }

      const [contactCache, propertyCache] = await Promise.all([
        (async () => {
          const cache = new Map<string, { firstName: string; lastName: string }>();
          const results = await Promise.all(Array.from(contactIds).map(cId => storage.getContact(cId, companyId)));
          Array.from(contactIds).forEach((cId, i) => {
            if (results[i]) cache.set(cId, { firstName: results[i]!.firstName, lastName: results[i]!.lastName });
          });
          return cache;
        })(),
        (async () => {
          const cache = new Map<string, string>();
          const results = await Promise.all(Array.from(propertyIds).map(pId => storage.getProperty(pId, companyId)));
          Array.from(propertyIds).forEach((pId, i) => {
            if (results[i]) cache.set(pId, results[i]!.streetAddress);
          });
          return cache;
        })(),
      ]);

      const dashboardVisitsDetailed: {
        id: string;
        status: string;
        scheduledDate: string;
        contactName: string;
        contactId: string;
        propertyAddress: string;
        servicePlanName: string;
        serviceType: string;
        amount: number;
        completedAt: string | null;
        startedAt: string | null;
      }[] = [];

      for (const v of dashboardVisits) {
        const plan = planMap.get(v.servicePlanId);
        let contactName = "Unknown";
        let contactId = "";
        if (plan) {
          contactId = plan.contactId;
          const cached = contactCache.get(plan.contactId);
          if (cached) contactName = `${cached.firstName} ${cached.lastName}`;
        }
        const frequencyLabel = plan ? plan.frequency.charAt(0).toUpperCase() + plan.frequency.slice(1) : "";
        dashboardVisitsDetailed.push({
          id: v.id,
          status: v.status,
          scheduledDate: v.scheduledDate,
          contactName,
          contactId,
          propertyAddress: propertyCache.get(v.propertyId) || "",
          servicePlanName: plan ? `${frequencyLabel} Service` : "Service",
          serviceType: plan ? `${frequencyLabel} Cleanup` : "Cleanup",
          amount: plan && !plan.isStopOnly ? parseFloat(plan.pricePerVisit) || 0 : 0,
          completedAt: v.completedAt ? v.completedAt.toISOString() : null,
          startedAt: v.startedAt ? v.startedAt.toISOString() : null,
        });
      }

      const upcomingThisWeek = weekVisits.filter(v =>
        v.scheduledDate >= today && v.scheduledDate <= weekEndStr &&
        (v.status === "scheduled" || v.status === "in_progress")
      );
      let upcomingWeekValue = 0;
      for (const v of upcomingThisWeek) {
        const plan = planMap.get(v.servicePlanId);
        upcomingWeekValue += plan && !plan.isStopOnly ? (parseFloat(plan.pricePerVisit) || 0) : 0;
      }

      const nonStopOnlyPlans = activePlans.filter(p => !p.isStopOnly);
      res.json({
        activePlans: {
          count: nonStopOnlyPlans.length,
          monthlyValue: Math.round(activePlansMonthlyValue * 100) / 100,
        },
        scheduledVisits: {
          count: scheduledThisWeek,
        },
        requiresInvoicing: {
          count: uninvoicedSummary.count,
          totalDollars: uninvoicedSummary.totalDollars,
        },
        awaitingPayment: {
          count: awaitingPayment.length,
          totalDollars: Math.round(awaitingPaymentTotal * 100) / 100,
        },
        todaysVisits: dashboardVisitsDetailed,
        receivables: {
          total: Math.round(awaitingPaymentTotal * 100) / 100,
          overdueCount: overdueInvoices.length,
          overdueTotal: Math.round(overdueTotal * 100) / 100,
          topClients: topReceivables,
        },
        monthRevenue,
        upcomingThisWeek: {
          count: upcomingThisWeek.length,
          totalDollars: Math.round(upcomingWeekValue * 100) / 100,
        },
      });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/reports/summary", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      const tz = company?.timezone || "America/New_York";
      const period = (req.query.period as string) || "6m";
      const now = new Date();

      let lookbackMonths = 6;
      let projectionMonths = 0;
      let periodLabel = "Last 6 Months";

      if (period === "3m") { lookbackMonths = 3; periodLabel = "Last 3 Months"; }
      else if (period === "6m") { lookbackMonths = 6; periodLabel = "Last 6 Months"; }
      else if (period === "9m") { lookbackMonths = 9; periodLabel = "Last 9 Months"; }
      else if (period === "12m") { lookbackMonths = 12; periodLabel = "Last 12 Months"; }
      else if (period === "q1") {
        const yr = now.getFullYear();
        lookbackMonths = 0; periodLabel = `Q1 ${yr}`;
      } else if (period === "q2") {
        const yr = now.getFullYear();
        lookbackMonths = 0; periodLabel = `Q2 ${yr}`;
      } else if (period === "q3") {
        const yr = now.getFullYear();
        lookbackMonths = 0; periodLabel = `Q3 ${yr}`;
      } else if (period === "q4") {
        const yr = now.getFullYear();
        lookbackMonths = 0; periodLabel = `Q4 ${yr}`;
      } else if (period === "annual") {
        lookbackMonths = 0; periodLabel = `${now.getFullYear()} Annual`;
      } else if (period === "proj3") { lookbackMonths = 3; projectionMonths = 3; periodLabel = "3-Month Projection"; }
      else if (period === "proj6") { lookbackMonths = 6; projectionMonths = 6; periodLabel = "6-Month Projection"; }
      else if (period === "proj12") { lookbackMonths = 12; projectionMonths = 12; periodLabel = "12-Month Projection"; }

      let months: { year: number; month: number }[] = [];

      if (period.startsWith("q")) {
        const yr = now.getFullYear();
        const qNum = parseInt(period.slice(1));
        const startMonth = (qNum - 1) * 3;
        for (let m = startMonth; m < startMonth + 3; m++) {
          months.push({ year: yr, month: m });
        }
      } else if (period === "annual") {
        for (let m = 0; m < 12; m++) {
          months.push({ year: now.getFullYear(), month: m });
        }
      } else {
        for (let i = lookbackMonths - 1; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          months.push({ year: d.getFullYear(), month: d.getMonth() });
        }
      }

      const currentMonthIdx = now.getMonth();
      const currentYear = now.getFullYear();

      const monthlyRevenue: { month: string; revenue: number; projected?: boolean }[] = [];
      const revenueValues: number[] = [];

      for (const m of months) {
        const d = new Date(m.year, m.month, 1);
        const start = d.toISOString().split("T")[0];
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0];
        const isFuture = m.year > currentYear || (m.year === currentYear && m.month > currentMonthIdx);
        const isCurrent = m.year === currentYear && m.month === currentMonthIdx;

        if (isFuture) {
          monthlyRevenue.push({
            month: d.toLocaleString("default", { month: "short", year: "numeric" }),
            revenue: 0,
            projected: true,
          });
        } else {
          let revenue = await storage.getRevenueForPeriod(companyId, start, end, tz);
          if (revenue === 0) {
            const periodVisits = await storage.getVisitsForDateRange(companyId, start, end);
            const allPlansForChart = await storage.getServicePlans(companyId, {});
            const chartPlanMap = new Map(allPlansForChart.map(p => [p.id, parseFloat(p.pricePerVisit) || 0]));
            for (const v of periodVisits) {
              if (v.status === "completed") {
                revenue += chartPlanMap.get(v.servicePlanId) || 0;
              }
            }
            revenue = Math.round(revenue * 100) / 100;
          }
          revenueValues.push(revenue);
          monthlyRevenue.push({
            month: d.toLocaleString("default", { month: "short", year: "numeric" }) + (isCurrent ? " (current)" : ""),
            revenue,
          });
        }
      }

      let projections: { month: string; revenue: number; projected: boolean }[] = [];
      let projectedMonthlyValue: number | null = null;
      if (projectionMonths > 0) {
        const allActivePlansForProjection = await storage.getServicePlans(companyId, { isActive: true });
        let monthlyBookedEstimate = 0;
        for (const plan of allActivePlansForProjection.filter(p => !p.isStopOnly)) {
          const price = parseFloat(plan.pricePerVisit || "0");
          const planAddOns = await storage.getServicePlanAddOns(plan.id);
          const addOnsPrice = planAddOns.filter(a => a.isActive).reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
          const perVisit = price + addOnsPrice;
          if (plan.frequency === "weekly") monthlyBookedEstimate += perVisit * 4.33;
          else if (plan.frequency === "biweekly") monthlyBookedEstimate += perVisit * 2.17;
          else if (plan.frequency === "monthly") monthlyBookedEstimate += perVisit;
        }

        const recentAvg = revenueValues.length > 0
          ? revenueValues.slice(-3).reduce((a, b) => a + b, 0) / Math.min(revenueValues.length, 3)
          : 0;
        const projectedMonthly = Math.max(monthlyBookedEstimate, recentAvg);
        projectedMonthlyValue = Math.round(projectedMonthly * 100) / 100;

        for (let i = 1; i <= projectionMonths; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
          projections.push({
            month: d.toLocaleString("default", { month: "short", year: "numeric" }),
            revenue: Math.round(projectedMonthly * 100) / 100,
            projected: true,
          });
        }
      }

      const bookedRevenue = await (async () => {
        const thisStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
        const thisEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
        const pendingInvoices = await storage.getInvoices(companyId);
        let booked = 0;
        for (const inv of pendingInvoices) {
          if (inv.status === "pending" || inv.status === "draft") {
            const created = new Date(inv.createdAt!);
            if (created >= new Date(thisStart) && created <= new Date(thisEnd + "T23:59:59")) {
              booked += parseFloat(inv.total);
            }
          }
        }
        const activePlans = await storage.getServicePlans(companyId, { isActive: true });
        for (const plan of activePlans) {
          const price = parseFloat(plan.pricePerVisit || "0");
          const planAddOns = await storage.getServicePlanAddOns(plan.id);
          const addOnsPrice = planAddOns.filter(a => a.isActive).reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
          const perVisit = price + addOnsPrice;
          if (plan.frequency === "weekly") booked += perVisit * 4.33;
          else if (plan.frequency === "biweekly") booked += perVisit * 2.17;
          else if (plan.frequency === "monthly") booked += perVisit;
        }
        return Math.round(booked * 100) / 100;
      })();

      const allContacts = await storage.getContacts(companyId);
      const statusCounts: Record<string, number> = {};
      for (const c of allContacts) {
        statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
      }

      const allInvoices = await storage.getInvoices(companyId);
      const invoiceStatusCounts: Record<string, number> = {};
      let totalOutstanding = 0;
      let totalCollected = 0;
      for (const inv of allInvoices) {
        invoiceStatusCounts[inv.status] = (invoiceStatusCounts[inv.status] || 0) + 1;
        if (inv.status === "paid") totalCollected += parseFloat(inv.total);
        if (inv.status === "sent" || inv.status === "pending") totalOutstanding += parseFloat(inv.total);
      }

      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
      const thisMonthVisits = await storage.getVisitsForDateRange(companyId, thisMonthStart, thisMonthEnd);
      const visitsCompleted = thisMonthVisits.filter(v => v.status === "completed").length;
      const visitsScheduled = thisMonthVisits.filter(v => v.status === "scheduled").length;
      const visitsSkipped = thisMonthVisits.filter(v => v.status === "skipped").length;

      res.json({
        period,
        periodLabel,
        monthlyRevenue: [...monthlyRevenue, ...projections],
        projectedMonthly: projectedMonthlyValue,
        bookedRevenue,
        contactsByStatus: statusCounts,
        totalContacts: allContacts.length,
        invoicesByStatus: invoiceStatusCounts,
        totalInvoices: allInvoices.length,
        totalOutstanding,
        totalCollected,
        thisMonthVisits: {
          completed: visitsCompleted,
          scheduled: visitsScheduled,
          skipped: visitsSkipped,
          total: thisMonthVisits.length,
        },
      });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/analytics/dashboard", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      const tz = company?.timezone || "America/New_York";
      const now = new Date();

      const allContactsRaw = await storage.getContacts(companyId);
      const allInvoices = await storage.getInvoices(companyId);

      const allActivePlansForAnalytics = await storage.getServicePlans(companyId, { isActive: true });
      const stopOnlyContactIds = getStopOnlyOnlyContactIds(allActivePlansForAnalytics);
      const allContacts = allContactsRaw.filter(c => !stopOnlyContactIds.has(c.id));

      const allPlansForAnalyticsRevenue = await storage.getServicePlans(companyId, {});
      const analyticsPlanPriceMap = new Map(allPlansForAnalyticsRevenue.map(p => [p.id, parseFloat(p.pricePerVisit) || 0]));

      const monthlyRevenue: { month: string; revenue: number }[] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const start = d.toISOString().split("T")[0];
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0];
        let revenue = await storage.getRevenueForPeriod(companyId, start, end, tz);
        if (revenue === 0) {
          const periodVisits = await storage.getVisitsForDateRange(companyId, start, end);
          for (const v of periodVisits) {
            if (v.status === "completed") revenue += analyticsPlanPriceMap.get(v.servicePlanId) || 0;
          }
          revenue = Math.round(revenue * 100) / 100;
        }
        monthlyRevenue.push({
          month: d.toLocaleString("default", { month: "short", year: "2-digit" }),
          revenue,
        });
      }

      // --- Yearly Revenue (current + prior) ---
      const yearlyRevenue: { year: string; revenue: number }[] = [];
      for (let y = now.getFullYear() - 2; y <= now.getFullYear(); y++) {
        const yStart = `${y}-01-01`;
        const yEnd = `${y}-12-31`;
        const rev = await storage.getRevenueForPeriod(companyId, yStart, yEnd, tz);
        yearlyRevenue.push({ year: String(y), revenue: rev });
      }

      // --- Customer Acquisition (last 12 months) ---
      const customerAcquisition: { month: string; newClients: number; total: number }[] = [];
      let runningTotal = 0;
      const contactsByCreatedMonth: Record<string, number> = {};
      for (const c of allContacts) {
        const created = new Date(c.createdAt);
        const key = `${created.getFullYear()}-${String(created.getMonth()).padStart(2, "0")}`;
        contactsByCreatedMonth[key] = (contactsByCreatedMonth[key] || 0) + 1;
      }
      const contactsBeforeWindow = allContacts.filter(c => {
        const created = new Date(c.createdAt);
        const windowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        return created < windowStart;
      }).length;
      runningTotal = contactsBeforeWindow;
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
        const newClients = contactsByCreatedMonth[key] || 0;
        runningTotal += newClients;
        customerAcquisition.push({
          month: d.toLocaleString("default", { month: "short", year: "2-digit" }),
          newClients,
          total: runningTotal,
        });
      }

      // --- Route Performance (visits by day of week, last 30 days) ---
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentVisits = await storage.getVisitsForDateRange(
        companyId,
        thirtyDaysAgo.toISOString().split("T")[0],
        now.toISOString().split("T")[0],
      );
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const routePerformance = dayNames.map(day => ({
        day,
        completed: 0,
        scheduled: 0,
        skipped: 0,
        cancelled: 0,
      }));
      for (const v of recentVisits) {
        const parts = String(v.scheduledDate).split("-");
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        const dayIdx = d.getDay();
        const entry = routePerformance[dayIdx];
        if (v.status === "completed") entry.completed++;
        else if (v.status === "scheduled") entry.scheduled++;
        else if (v.status === "skipped") entry.skipped++;
        else if (v.status === "cancelled") entry.cancelled++;
      }

      // --- Weekly Visit Trends (last 8 weeks) ---
      const weeklyVisits: { week: string; completed: number; total: number; completionRate: number }[] = [];
      const currentMonday = new Date(now);
      const dayOfWeek = currentMonday.getDay();
      const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      currentMonday.setDate(currentMonday.getDate() - diffToMonday);
      currentMonday.setHours(0, 0, 0, 0);
      for (let w = 7; w >= 0; w--) {
        const weekStart = new Date(currentMonday);
        weekStart.setDate(weekStart.getDate() - (w * 7));
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const ws = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`;
        const we = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, "0")}-${String(weekEnd.getDate()).padStart(2, "0")}`;
        const weekVisits = await storage.getVisitsForDateRange(companyId, ws, we);
        const comp = weekVisits.filter(v => v.status === "completed").length;
        const tot = weekVisits.length;
        weeklyVisits.push({
          week: `${weekStart.toLocaleString("default", { month: "short" })} ${weekStart.getDate()}`,
          completed: comp,
          total: tot,
          completionRate: tot > 0 ? Math.round((comp / tot) * 100) : 0,
        });
      }

      // --- Client Retention ---
      const activeContacts = allContacts.filter(c => c.status === "active").length;
      const pausedContacts = allContacts.filter(c => c.status === "paused").length;
      const cancelledContacts = allContacts.filter(c => c.status === "cancelled").length;
      const leadContacts = allContacts.filter(c => c.status === "lead").length;
      const estimateContacts = allContacts.filter(c => c.status === "estimate").length;
      const totalContacts = allContacts.length;
      const retentionRate = totalContacts > 0
        ? Math.round(((activeContacts + pausedContacts) / totalContacts) * 100)
        : 0;

      const clientStatusBreakdown = [
        { status: "Active", count: activeContacts, color: "#22c55e" },
        { status: "Lead", count: leadContacts, color: "#3b82f6" },
        { status: "Estimate", count: estimateContacts, color: "#eab308" },
        { status: "Paused", count: pausedContacts, color: "#f97316" },
        { status: "Cancelled", count: cancelledContacts, color: "#ef4444" },
      ];

      // --- Average Service Cost ---
      const paidInvoices = allInvoices.filter(i => i.status === "paid");
      const totalPaidRevenue = paidInvoices.reduce((sum, i) => sum + parseFloat(i.total), 0);
      const avgInvoiceAmount = paidInvoices.length > 0 ? totalPaidRevenue / paidInvoices.length : 0;

      const allServicePlans = await storage.getServicePlans(companyId);
      const activeServicePlans = allServicePlans.filter(sp => sp.isActive && !sp.isStopOnly);
      const avgPricePerVisit = activeServicePlans.length > 0
        ? activeServicePlans.reduce((sum, sp) => sum + parseFloat(sp.pricePerVisit), 0) / activeServicePlans.length
        : 0;

      // --- Lead Source Distribution ---
      const leadSourceCounts: Record<string, number> = {};
      for (const c of allContacts) {
        const src = c.leadSource || "unknown";
        leadSourceCounts[src] = (leadSourceCounts[src] || 0) + 1;
      }
      const leadSourceDistribution = Object.entries(leadSourceCounts)
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count);

      // --- Revenue KPIs ---
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0];
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split("T")[0];
      const thisMonthRev = await storage.getRevenueForPeriod(companyId, thisMonthStart, thisMonthEnd, tz);
      const lastMonthRev = await storage.getRevenueForPeriod(companyId, lastMonthStart, lastMonthEnd, tz);
      const revenueGrowth = lastMonthRev > 0 ? Math.round(((thisMonthRev - lastMonthRev) / lastMonthRev) * 100) : 0;

      const totalOutstanding = allInvoices
        .filter(i => i.status === "sent" || i.status === "pending")
        .reduce((sum, i) => sum + parseFloat(i.total), 0);

      // --- Service Day Distribution ---
      const serviceDayCounts: Record<string, number> = {};
      const daysOrder = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
      for (const day of daysOrder) serviceDayCounts[day] = 0;
      for (const c of allContacts) {
        if (c.serviceDay) {
          serviceDayCounts[c.serviceDay] = (serviceDayCounts[c.serviceDay] || 0) + 1;
        }
      }
      const serviceDayDistribution = daysOrder.map(day => ({
        day: day.charAt(0).toUpperCase() + day.slice(1, 3),
        count: serviceDayCounts[day],
      }));

      res.json({
        monthlyRevenue,
        yearlyRevenue,
        customerAcquisition,
        routePerformance,
        weeklyVisits,
        clientRetention: {
          retentionRate,
          statusBreakdown: clientStatusBreakdown,
          total: totalContacts,
          active: activeContacts,
        },
        avgServiceCost: {
          avgPricePerVisit: Math.round(avgPricePerVisit * 100) / 100,
          avgInvoiceAmount: Math.round(avgInvoiceAmount * 100) / 100,
          totalPaidInvoices: paidInvoices.length,
          activeServicePlans: activeServicePlans.length,
        },
        leadSourceDistribution,
        serviceDayDistribution,
        kpis: {
          thisMonthRevenue: thisMonthRev,
          lastMonthRevenue: lastMonthRev,
          revenueGrowth,
          totalOutstanding,
          totalContacts,
          activeContacts,
          completionRate: recentVisits.length > 0
            ? Math.round((recentVisits.filter(v => v.status === "completed").length / recentVisits.length) * 100)
            : 0,
          totalVisitsLast30Days: recentVisits.length,
        },
      });
    } catch (err) { handleError(res, err); }
  });

  // ================ Contact Routes ================

  const csvContactHeaders = ["firstName", "lastName", "email", "phone", "streetAddress", "address2", "city", "state", "zipCode", "numberOfDogs", "yardSize", "serviceFrequency", "serviceDay", "leadSource", "referralSource", "status", "notes"];

  app.get("/api/contacts/export/csv", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contactsList = await storage.getContacts(companyId);
      const csvRows = [csvContactHeaders.join(",")];
      for (const c of contactsList) {
        csvRows.push(csvContactHeaders.map(h => {
          const val = (c as any)[h] ?? "";
          return `"${String(val).replace(/"/g, '""')}"`;
        }).join(","));
      }
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=contacts.csv");
      res.send(csvRows.join("\n"));
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/contacts/sample-csv", isAuthenticated, async (_req: Request, res: Response) => {
    const sampleRows = [
      csvContactHeaders.join(","),
      '"Jane","Doe","jane@example.com","555-123-4567","123 Main St","Apt 2","Springfield","IL","62701","2","medium","weekly","monday","website","John Smith","active","Backyard only"',
      '"Bob","Smith","bob@example.com","555-987-6543","456 Oak Ave","","Denver","CO","80202","1","large","biweekly","thursday","referral","Jane Doe","lead",""',
    ];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=contacts-sample.csv");
    res.send(sampleRows.join("\n"));
  });

  app.post("/api/contacts/validate-csv", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const csvText = typeof req.body === "string" ? req.body : req.body?.csv;
      if (!csvText) return res.status(400).json({ error: "No CSV data provided" });

      function parseCsvLine(line: string): string[] {
        const result: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let j = 0; j < line.length; j++) {
          const ch = line[j];
          if (inQuotes) {
            if (ch === '"' && line[j + 1] === '"') { current += '"'; j++; }
            else if (ch === '"') { inQuotes = false; }
            else { current += ch; }
          } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { result.push(current.trim()); current = ""; }
            else { current += ch; }
          }
        }
        result.push(current.trim());
        return result;
      }

      const lines = csvText.split(/\r?\n/).filter((l: string) => l.trim());
      if (lines.length < 2) return res.status(400).json({ error: "CSV must have headers and at least one row" });

      const rawHeaders = parseCsvLine(lines[0]).map((h: string) => h.replace(/"/g, "").trim());

      const knownFields = new Set(csvContactHeaders);
      const headerAliases: Record<string, string> = {
        "first name": "firstName", "first_name": "firstName", "firstname": "firstName", "first": "firstName",
        "last name": "lastName", "last_name": "lastName", "lastname": "lastName", "last": "lastName",
        "email address": "email", "e-mail": "email", "emailaddress": "email",
        "phone number": "phone", "phonenumber": "phone", "telephone": "phone", "tel": "phone", "mobile": "phone", "cell": "phone",
        "street address": "streetAddress", "street_address": "streetAddress", "address": "streetAddress", "address1": "streetAddress", "street": "streetAddress",
        "address 2": "address2", "apt": "address2", "suite": "address2", "unit": "address2",
        "zip": "zipCode", "zip_code": "zipCode", "postal": "zipCode", "postal_code": "zipCode", "postalcode": "zipCode", "zipcode": "zipCode",
        "dogs": "numberOfDogs", "number_of_dogs": "numberOfDogs", "numberof dogs": "numberOfDogs", "num dogs": "numberOfDogs", "# dogs": "numberOfDogs", "numdogs": "numberOfDogs",
        "yard": "yardSize", "yard_size": "yardSize",
        "frequency": "serviceFrequency", "service_frequency": "serviceFrequency", "svc frequency": "serviceFrequency",
        "day": "serviceDay", "service_day": "serviceDay", "svc day": "serviceDay",
        "lead source": "leadSource", "lead_source": "leadSource", "source": "leadSource",
        "referral source": "referralSource", "referral_source": "referralSource", "referral": "referralSource", "referred by": "referralSource",
        "note": "notes", "comment": "notes", "comments": "notes",
      };

      const columnMapping: { csvHeader: string; mappedField: string }[] = rawHeaders.map(h => {
        if (knownFields.has(h)) return { csvHeader: h, mappedField: h };
        const normalized = h.toLowerCase().replace(/[^a-z0-9 #]/g, "").trim();
        if (headerAliases[normalized]) return { csvHeader: h, mappedField: headerAliases[normalized] };
        return { csvHeader: h, mappedField: "" };
      });

      const existingSources = await storage.getLeadSources(companyId);
      const sourceNames = new Set(existingSources.map(s => s.name.toLowerCase()));

      const rows: any[] = [];
      const rawRows: string[][] = [];
      const issues: { row: number; field: string; message: string }[] = [];
      const newLeadSources: string[] = [];
      const newLeadSourceSet = new Set<string>();

      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i]).map(v => v.replace(/^"|"$/g, ""));
        rawRows.push(values);
        const row: Record<string, string> = {};
        columnMapping.forEach((col, idx) => {
          if (col.mappedField) {
            row[col.mappedField] = values[idx] || "";
          }
        });

        const rowIssues: string[] = [];
        if (!row.firstName) rowIssues.push("Missing first name");
        
        if (row.numberOfDogs && isNaN(parseInt(row.numberOfDogs, 10))) {
          rowIssues.push(`Invalid number of dogs: "${row.numberOfDogs}"`);
        }

        if (rowIssues.length > 0) {
          rowIssues.forEach(msg => issues.push({ row: i + 1, field: "", message: msg }));
        }

        if (row.leadSource && !sourceNames.has(row.leadSource.toLowerCase()) && !newLeadSourceSet.has(row.leadSource.toLowerCase())) {
          newLeadSources.push(row.leadSource);
          newLeadSourceSet.add(row.leadSource.toLowerCase());
        }

        rows.push(row);
      }

      const validCount = rows.filter(r => r.firstName && r.lastName).length;
      const invalidCount = rows.length - validCount;

      res.json({
        totalRows: rows.length,
        validCount,
        invalidCount,
        issues,
        newLeadSources,
        headers: csvContactHeaders,
        columnMapping,
        rows,
        rawRows,
        csvHeaders: rawHeaders,
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/contacts/import/json", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "No rows provided" });

      const existingSources = await storage.getLeadSources(companyId);
      const sourceNames = new Set(existingSources.map(s => s.name.toLowerCase()));
      const imported: any[] = [];
      const errors: string[] = [];
      const addedLeadSources: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row.firstName) {
          errors.push(`Row ${i + 1}: missing firstName, skipped`);
          continue;
        }

        if (row.leadSource && !sourceNames.has(row.leadSource.toLowerCase())) {
          await storage.createLeadSource({ companyId, name: row.leadSource });
          sourceNames.add(row.leadSource.toLowerCase());
          addedLeadSources.push(row.leadSource);
        }

        try {
          const contact = await storage.createContact({
            companyId,
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email || null,
            phone: row.phone || null,
            streetAddress: row.streetAddress || null,
            address2: row.address2 || null,
            city: row.city || null,
            state: row.state || null,
            zipCode: row.zipCode || null,
            numberOfDogs: row.numberOfDogs ? parseInt(row.numberOfDogs, 10) || null : null,
            yardSize: row.yardSize || null,
            serviceFrequency: row.serviceFrequency || null,
            serviceDay: row.serviceDay || null,
            leadSource: row.leadSource || null,
            referralSource: row.referralSource || null,
            status: row.status || "lead",
            notes: row.notes || null,
          } as any);

          if (contact.streetAddress && contact.city && contact.state && contact.zipCode) {
            await createPropertyWithGeocode({
              companyId,
              contactId: contact.id,
              streetAddress: contact.streetAddress,
              city: contact.city,
              state: contact.state,
              zipCode: contact.zipCode,
              numberOfDogs: contact.numberOfDogs ?? 1,
              yardSize: contact.yardSize ?? null,
            });
          }

          imported.push(contact);
        } catch (rowErr: any) {
          errors.push(`Row ${i + 1}: ${rowErr.message}`);
        }
      }

      res.json({ imported: imported.length, errors, addedLeadSources });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/contacts/import/csv", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const csvText = typeof req.body === "string" ? req.body : req.body?.csv;
      if (!csvText) return res.status(400).json({ error: "No CSV data provided" });

      function parseCsvLine(line: string): string[] {
        const result: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let j = 0; j < line.length; j++) {
          const ch = line[j];
          if (inQuotes) {
            if (ch === '"' && line[j + 1] === '"') { current += '"'; j++; }
            else if (ch === '"') { inQuotes = false; }
            else { current += ch; }
          } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { result.push(current.trim()); current = ""; }
            else { current += ch; }
          }
        }
        result.push(current.trim());
        return result;
      }

      const lines = csvText.split(/\r?\n/).filter((l: string) => l.trim());
      if (lines.length < 2) return res.status(400).json({ error: "CSV must have headers and at least one row" });

      const headers = parseCsvLine(lines[0]).map((h: string) => h.replace(/"/g, "").trim());
      const imported: any[] = [];
      const errors: string[] = [];
      const addedLeadSources: string[] = [];

      const existingSources = await storage.getLeadSources(companyId);
      const sourceNames = new Set(existingSources.map(s => s.name.toLowerCase()));

      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i]);
        const row: any = {};
        headers.forEach((h: string, idx: number) => { row[h] = values[idx] || ""; });

        if (!row.firstName) {
          errors.push(`Row ${i + 1}: missing firstName, skipped`);
          continue;
        }

        if (row.leadSource && !sourceNames.has(row.leadSource.toLowerCase())) {
          await storage.createLeadSource({ companyId, name: row.leadSource });
          sourceNames.add(row.leadSource.toLowerCase());
          addedLeadSources.push(row.leadSource);
        }

        try {
          const contact = await storage.createContact({
            companyId,
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email || null,
            phone: row.phone || null,
            streetAddress: row.streetAddress || null,
            address2: row.address2 || null,
            city: row.city || null,
            state: row.state || null,
            zipCode: row.zipCode || null,
            numberOfDogs: row.numberOfDogs ? parseInt(row.numberOfDogs, 10) || null : null,
            yardSize: row.yardSize || null,
            serviceFrequency: row.serviceFrequency || null,
            serviceDay: row.serviceDay || null,
            leadSource: row.leadSource || null,
            referralSource: row.referralSource || null,
            status: row.status || "lead",
            notes: row.notes || null,
          } as any);

          if (contact.streetAddress && contact.city && contact.state && contact.zipCode) {
            await createPropertyWithGeocode({
              companyId,
              contactId: contact.id,
              streetAddress: contact.streetAddress,
              city: contact.city,
              state: contact.state,
              zipCode: contact.zipCode,
              numberOfDogs: contact.numberOfDogs ?? 1,
              yardSize: contact.yardSize ?? null,
            });
          }

          imported.push(contact);
        } catch (rowErr: any) {
          errors.push(`Row ${i + 1}: ${rowErr.message}`);
        }
      }

      res.status(201).json({ imported: imported.length, errors, addedLeadSources, contacts: imported });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/contacts", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const filters: { status?: string; search?: string } = {};
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.search) filters.search = (req.query.search as string).replace(/\0/g, "");
      const contactsList = await storage.getContacts(companyId, filters);

      const activePlans = await storage.getServicePlans(companyId, { isActive: true });
      const stopOnlyOnlyIds = getStopOnlyOnlyContactIds(activePlans);
      const enriched = contactsList.map(c => ({
        ...c,
        isStopOnlyContact: stopOnlyOnlyIds.has(c.id),
      }));
      res.json(enriched);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/contacts/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      res.json(contact);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/contacts", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const parsed = insertContactSchema.parse({ ...req.body, companyId });
      const contact = await storage.createContact(parsed);

      let propertyCreated = false;
      const hasFullAddress = !!(contact.streetAddress && contact.city && contact.state && contact.zipCode);
      const hasPartialAddress = !!(contact.streetAddress) && !hasFullAddress;

      if (hasFullAddress) {
        await createPropertyWithGeocode({
          companyId,
          contactId: contact.id,
          streetAddress: contact.streetAddress!,
          city: contact.city,
          state: contact.state,
          zipCode: contact.zipCode,
          numberOfDogs: contact.numberOfDogs ?? 1,
          yardSize: contact.yardSize ?? null,
        });
        propertyCreated = true;
      }

      if (contact.email && isStripeConfigured()) {
        try {
          const companyForStripe = await storage.getCompany(companyId);
          const connectAcct = companyForStripe?.stripeConnectOnboarded ? companyForStripe.stripeConnectAccountId : null;
          const stripeCustomerId = await createStripeCustomer({
            email: contact.email,
            name: `${contact.firstName} ${contact.lastName}`.trim(),
            phone: contact.phone || undefined,
            metadata: { contactId: contact.id, companyId },
            stripeAccount: connectAcct,
          });
          await storage.updateContact(contact.id, companyId, { stripeCustomerId });
        } catch (stripeErr) {
          console.error("[auto-stripe] Customer creation failed:", stripeErr);
        }
      }

      if (contact.status === "lead") {
        notify(companyId, "new_lead", "New Lead", `${contact.firstName} ${contact.lastName} was added as a new lead.`, `/contacts/${contact.id}`);
      }

      if (contact.email && contact.status !== "lead") {
        provisionPortalAccess(contact.id, companyId, getBaseUrl(req)).catch((err) =>
          console.error("[auto-portal] Failed to provision portal access for new contact:", err)
        );
      }

      qboAutoSync(companyId, contact.id, "contact");
      res.status(201).json({ ...contact, _meta: { propertyCreated, hasPartialAddress } });
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/contacts/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const existing = await storage.getContact(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Contact not found" });
      const validStatuses = ["lead", "estimate", "active", "paused", "cancelled"];
      if (req.body.status && !validStatuses.includes(req.body.status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      }
      const { costOverrides: _stripCostOverrides, ...safeBody } = req.body;
      const contact = await storage.updateContact(req.params.id, companyId, safeBody);
      auditLog(companyId, userId, "contact", req.params.id, "update", { old: existing, new: contact }, req.ip);

      if (contact.streetAddress && contact.city && contact.state && contact.zipCode) {
        const existingProperties = await storage.getProperties(companyId, contact.id);
        if (existingProperties.length === 0) {
          await createPropertyWithGeocode({
            companyId,
            contactId: contact.id,
            streetAddress: contact.streetAddress,
            city: contact.city,
            state: contact.state,
            zipCode: contact.zipCode,
            numberOfDogs: contact.numberOfDogs ?? 1,
            yardSize: contact.yardSize ?? null,
          });
        }
      }

      if (
        req.body.status === "active" &&
        existing.status !== "active" &&
        contact.email &&
        !contact.hasPortalAccess
      ) {
        provisionPortalAccess(contact.id, companyId, getBaseUrl(req)).catch((err) =>
          console.error("[auto-portal] Failed to provision portal access on status change:", err)
        );
      }

      qboAutoSync(companyId, contact.id, "contact");
      res.json(contact);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/contacts/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const existing = await storage.getContact(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Contact not found" });
      await storage.deleteContact(req.params.id, companyId);
      auditLog(companyId, userId, "contact", req.params.id, "delete", { deleted: existing }, req.ip);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/contacts/bulk-update", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { ids, status, tagId } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array is required" });
      let updated = 0;
      for (const id of ids) {
        const existing = await storage.getContact(id, companyId);
        if (!existing) continue;
        if (status) {
          await storage.updateContact(id, companyId, { status });
          updated++;
        }
        if (tagId) {
          await storage.addTagToContact(id, tagId);
          updated++;
        }
      }
      res.json({ success: true, updated });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/contacts/bulk-delete", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array is required" });
      let deleted = 0;
      for (const id of ids) {
        const existing = await storage.getContact(id, companyId);
        if (!existing) continue;
        await storage.deleteContact(id, companyId);
        deleted++;
      }
      res.json({ success: true, deleted });
    } catch (err) { handleError(res, err); }
  });

  // ================ Tag Routes ================

  app.get("/api/tags", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const tagsList = await storage.getTags(companyId);
      res.json(tagsList);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/tags", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const parsed = insertTagSchema.parse({ ...req.body, companyId });
      const tag = await storage.createTag(parsed);
      res.status(201).json(tag);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/tags/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      await storage.deleteTag(req.params.id, companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  // ================ Lead Source Routes ================

  app.get("/api/lead-sources", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const sources = await storage.getLeadSources(companyId);
      res.json(sources);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/lead-sources", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { name } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Name is required" });
      }
      const source = await storage.createLeadSource({ companyId, name: name.trim() });
      res.status(201).json(source);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/lead-sources/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      await storage.deleteLeadSource(req.params.id, companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/contacts/:id/tags", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { tagId } = req.body;
      if (!tagId) return res.status(400).json({ error: "tagId is required" });
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const companyTags = await storage.getTags(companyId);
      if (!companyTags.find(t => t.id === tagId)) return res.status(404).json({ error: "Tag not found" });
      await storage.addTagToContact(req.params.id, tagId);
      res.status(201).json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/contacts/:id/tags/:tagId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      await storage.removeTagFromContact(req.params.id, req.params.tagId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/contacts/:id/activity", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const logs = await storage.getActivityLogs(companyId, req.params.id, limit, offset);
      res.json(logs);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/contacts/:id/tags", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const contactTags = await storage.getContactTags(req.params.id);
      res.json(contactTags);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/contacts/:id/services", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const { frequency, dayOfWeek, startDate, pricePerVisit, discount, propertyId, serviceName, addOns } = req.body;
      if (!frequency || !startDate || !pricePerVisit || !propertyId) {
        return res.status(400).json({ error: "frequency, startDate, pricePerVisit, and propertyId are required" });
      }

      const parsed = insertServicePlanSchema.parse({
        companyId,
        contactId: req.params.id,
        propertyId,
        frequency,
        dayOfWeek: dayOfWeek || null,
        startDate,
        pricePerVisit: sanitizeDecimal(pricePerVisit),
        discount: discount || null,
        serviceName: serviceName || null,
        isActive: true,
      });

      const plan = await storage.createServicePlan(parsed);
      auditLog(companyId, userId, "service_plan", plan.id, "create", { new: { contactId: req.params.id, frequency, dayOfWeek } }, req.ip || undefined);

      if (contact.status === "lead" || contact.status === "estimate") {
        await storage.updateContact(req.params.id, companyId, { status: "active" });
        if (contact.email && !contact.hasPortalAccess) {
          provisionPortalAccess(req.params.id, companyId, getBaseUrl(req)).catch((err) =>
            console.error("[auto-portal] Failed to provision portal access:", err)
          );
        }
      }

      if (!contact.stripeCustomerId && contact.email) {
        (async () => {
          try {
            const co = await storage.getCompany(companyId);
            const acct = co?.stripeConnectOnboarded ? co.stripeConnectAccountId : null;
            const stripeCustomerId = await createStripeCustomer({
              email: contact.email!,
              name: `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || contact.email!,
              metadata: { scoopilotContactId: contact.id, companyId },
              stripeAccount: acct,
            });
            await storage.updateContact(req.params.id, companyId, { stripeCustomerId });
          } catch (err) {
            console.error("[auto-stripe] Failed to auto-create Stripe customer:", err);
          }
        })();
      }

      let planAddOns: any[] = [];
      if (addOns && Array.isArray(addOns)) {
        const validatedAddOns = await validateAndResolveAddOns(addOns, companyId);
        planAddOns = await storage.setServicePlanAddOns(plan.id, validatedAddOns);
      }

      try {
        const { generateVisitsForPlans } = await import("./jobs/auto-visits");
        const today = new Date();
        const planStart = plan.startDate ? new Date(plan.startDate + "T00:00:00") : today;
        const anchor = planStart > today ? planStart : today;
        const sixMonthsOut = new Date(anchor);
        sixMonthsOut.setDate(sixMonthsOut.getDate() + 182);
        await generateVisitsForPlans(companyId, [plan.id], anchor.toISOString().split("T")[0], sixMonthsOut.toISOString().split("T")[0]);
      } catch (genErr) {
        console.error("[contact-service] Failed to auto-generate visits:", genErr);
      }

      res.status(201).json({ ...plan, addOns: planAddOns });
    } catch (err) { handleError(res, err); }
  });

  // ================ Property Routes ================

  app.get("/api/properties", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contactId = req.query.contactId as string | undefined;
      const propertiesList = await storage.getProperties(companyId, contactId);
      res.json(propertiesList);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/properties/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const property = await storage.getProperty(req.params.id, companyId);
      if (!property) return res.status(404).json({ error: "Property not found" });
      res.json(property);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/properties", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const parsed = insertPropertySchema.parse({ ...req.body, companyId });
      if (!parsed.latitude && !parsed.longitude && parsed.streetAddress) {
        const coords = await geocodeAddress(parsed.streetAddress, parsed.city, parsed.state, parsed.zipCode);
        if (coords) {
          (parsed as any).latitude = coords.latitude;
          (parsed as any).longitude = coords.longitude;
        }
      }
      const property = await storage.createProperty(parsed);
      res.status(201).json(property);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/properties/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getProperty(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Property not found" });
      const property = await storage.updateProperty(req.params.id, companyId, req.body);
      res.json(property);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/properties/geocode-all", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const allProperties = await storage.getProperties(companyId);
      const needsGeocode = allProperties.filter(p => p.streetAddress && (!p.latitude || !p.longitude));
      let geocoded = 0;
      for (const prop of needsGeocode) {
        const coords = await geocodeAddress(prop.streetAddress!, prop.city, prop.state, prop.zipCode);
        if (coords) {
          await storage.updateProperty(prop.id, companyId, { latitude: coords.latitude, longitude: coords.longitude });
          geocoded++;
        }
      }
      res.json({ total: allProperties.length, needsGeocode: needsGeocode.length, geocoded });
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/properties/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getProperty(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Property not found" });
      await storage.deleteProperty(req.params.id, companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  // ================ Route Routes ================

  app.get("/api/routes", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const dayOfWeek = req.query.dayOfWeek as string | undefined;
      const routesList = await storage.getRoutes(companyId, dayOfWeek);
      res.json(routesList);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/routes", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const body = { ...req.body, companyId };
      if (body.technicianId === "") body.technicianId = null;
      const parsed = insertRouteSchema.parse(body);
      const route = await storage.createRoute(parsed);
      res.status(201).json(route);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/routes/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getRoute(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Route not found" });
      const validDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
      if (req.body.dayOfWeek && !validDays.includes(req.body.dayOfWeek)) {
        return res.status(400).json({ error: `Invalid dayOfWeek. Must be one of: ${validDays.join(", ")}` });
      }
      const allowed = ["name", "dayOfWeek", "technicianId", "color"];
      const updates: any = {};
      for (const key of allowed) { if (req.body[key] !== undefined) updates[key] = req.body[key]; }
      const route = await storage.updateRoute(req.params.id, companyId, updates);
      res.json(route);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/routes/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getRoute(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Route not found" });
      await storage.deleteRoute(req.params.id, companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/routes/:id/unassign-all", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const route = await storage.getRoute(req.params.id, companyId);
      if (!route) return res.status(404).json({ error: "Route not found" });
      const count = await storage.unassignAllStops(route.id);
      res.json({ success: true, unassignedCount: count });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/route-credits", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      res.json({ credits: company?.routeCredits ?? 0 });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/route-credits/add", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (role !== "owner" && role !== "admin") return res.status(403).json({ error: "Only owners/admins can add credits" });
      const { amount } = req.body;
      if (!amount || typeof amount !== "number" || amount < 1) return res.status(400).json({ error: "Invalid amount" });
      const company = await storage.getCompany(companyId);
      const currentCredits = company?.routeCredits ?? 0;
      const updated = await storage.updateCompany(companyId, { routeCredits: currentCredits + amount } as any);
      res.json({ credits: updated.routeCredits });
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/routes/:id/lock", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const route = await storage.getRoute(req.params.id, companyId);
      if (!route) return res.status(404).json({ error: "Route not found" });

      const newLocked = !route.isLocked;
      const updated = await storage.updateRoute(req.params.id, companyId, { isLocked: newLocked });
      res.json(updated);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/routes/:id/optimize", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const route = await storage.getRoute(req.params.id, companyId);
      if (!route) return res.status(404).json({ error: "Route not found" });

      if (route.isLocked) {
        return res.status(409).json({ error: "Route is locked. Unlock it before optimizing." });
      }

      const plans = await storage.getServicePlans(companyId, { isActive: true });
      const routePlans = plans.filter(sp => sp.routeId === route.id);

      if (routePlans.length <= 1) {
        return res.json({ optimized: false, message: "Not enough stops to optimize", totalDistance: 0, stopCount: routePlans.length });
      }

      if (routePlans.length > 60) {
        return res.status(400).json({ error: "Route exceeds maximum of 60 stops. Please split into smaller routes." });
      }

      const creditsRequired = routePlans.length <= 30 ? 1 : 2;

      const company = await storage.getCompany(companyId);
      const currentCredits = company?.routeCredits ?? 0;
      if (currentCredits < creditsRequired) {
        return res.status(402).json({
          error: "Insufficient route credits",
          creditsRequired,
          creditsAvailable: currentCredits,
        });
      }

      const allProperties = await storage.getProperties(companyId);
      let propertyMap = new Map(allProperties.map(p => [p.id, p]));

      const needsGeocode = routePlans.filter(sp => {
        const prop = propertyMap.get(sp.propertyId);
        return prop && prop.streetAddress && (!prop.latitude || !prop.longitude);
      });
      if (needsGeocode.length > 0) {
        for (const sp of needsGeocode) {
          const prop = propertyMap.get(sp.propertyId)!;
          const coords = await geocodeAddress(prop.streetAddress!, prop.city, prop.state, prop.zipCode);
          if (coords) {
            const updated = await storage.updateProperty(prop.id, companyId, { latitude: coords.latitude, longitude: coords.longitude });
            propertyMap.set(prop.id, updated);
          }
        }
      }

      const stops = routePlans
        .map(sp => {
          const prop = propertyMap.get(sp.propertyId);
          if (!prop || !prop.latitude || !prop.longitude) return null;
          return {
            id: sp.id,
            latitude: parseFloat(String(prop.latitude)),
            longitude: parseFloat(String(prop.longitude)),
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      const ungeocoded = routePlans.length - stops.length;
      if (stops.length < 2) {
        return res.json({ optimized: false, message: `${ungeocoded} of ${routePlans.length} stops could not be geocoded. Ensure addresses are complete (street, city, state, zip).`, totalDistance: 0, stopCount: routePlans.length });
      }

      let startPoint: { latitude: number; longitude: number } | undefined;
      if (company?.startLatitude && company?.startLongitude) {
        startPoint = {
          latitude: parseFloat(String(company.startLatitude)),
          longitude: parseFloat(String(company.startLongitude)),
        };
      }

      const originalMapbox = await getMapboxRouteMetrics(stops, startPoint);
      const originalDistance = originalMapbox?.distance ?? calculateTotalDistance(stops, startPoint);
      const originalMinutes = originalMapbox?.duration ?? (originalDistance / 25) * 60;

      const result = optimizeRoute(stops, startPoint);

      const stopsById = new Map(stops.map(s => [s.id, s]));
      const optimizedStops = result.orderedIds.map(id => stopsById.get(id)!);

      for (let i = 0; i < result.orderedIds.length; i++) {
        await storage.updateServicePlan(result.orderedIds[i], companyId, { stopOrder: i + 1 });
      }

      const plansWithoutCoords = routePlans.filter(sp => {
        const prop = propertyMap.get(sp.propertyId);
        return !prop || !prop.latitude || !prop.longitude;
      });
      for (const plan of plansWithoutCoords) {
        await storage.updateServicePlan(plan.id, companyId, { stopOrder: result.orderedIds.length + 1 });
      }

      await storage.updateCompany(companyId, { routeCredits: currentCredits - creditsRequired } as any);

      const optimizedMapbox = await getMapboxRouteMetrics(optimizedStops, startPoint);
      const optimizedDistance = optimizedMapbox?.distance ?? result.totalDistance;
      const optimizedMinutes = optimizedMapbox?.duration ?? (result.totalDistance / 25) * 60;

      const milesSaved = Math.max(0, Math.round((originalDistance - optimizedDistance) * 10) / 10);
      const minutesSaved = Math.max(0, Math.round(originalMinutes - optimizedMinutes));

      try {
        const affectedPlanIds = routePlans.map(p => p.id);
        const tz = company?.timezone || "America/New_York";
        const today = getCompanyToday(tz);
        await storage.deleteFutureScheduledVisitsForPlans(affectedPlanIds, today);
        const { generateVisitsForPlans } = await import("./jobs/auto-visits");
        const startDate = new Date(today + "T00:00:00Z");
        startDate.setUTCDate(startDate.getUTCDate() + 1);
        const endDate = new Date(today + "T00:00:00Z");
        endDate.setUTCDate(endDate.getUTCDate() + 182);
        await generateVisitsForPlans(companyId, affectedPlanIds, startDate.toISOString().split("T")[0], endDate.toISOString().split("T")[0]);
      } catch (genErr) {
        console.error("[route-optimize] Failed to regenerate visits after optimization:", genErr);
      }

      res.json({
        optimized: true,
        totalDistance: Math.round(optimizedDistance * 10) / 10,
        originalDistance: Math.round(originalDistance * 10) / 10,
        milesSaved,
        minutesSaved,
        stopCount: routePlans.length,
        geocodedCount: stops.length,
        hasStartPoint: !!startPoint,
        order: result.orderedIds,
        creditsUsed: creditsRequired,
        creditsRemaining: currentCredits - creditsRequired,
        routingEngine: optimizedMapbox ? "mapbox" : "haversine",
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/routes/:id/split", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const route = await storage.getRoute(req.params.id, companyId);
      if (!route) return res.status(404).json({ error: "Route not found" });

      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const maxStops: number = req.body?.maxStops ?? company.maxStopsPerRoute ?? null;
      if (!maxStops || maxStops < 2) {
        return res.status(400).json({ error: "maxStops must be at least 2" });
      }

      const plans = await storage.getServicePlans(companyId, { isActive: true });
      const routePlans = plans.filter(sp => sp.routeId === route.id);

      // Use this week's visit count to determine oversized status and split factor
      const splitTz = company.timezone || "America/New_York";
      const splitWeekStart = getCompanyWeekStart(splitTz);
      const splitWeekStartObj = new Date(splitWeekStart + "T12:00:00Z");
      const splitWeekEndObj = new Date(splitWeekStartObj);
      splitWeekEndObj.setUTCDate(splitWeekEndObj.getUTCDate() + 6);
      const splitWeekEnd = splitWeekEndObj.toISOString().split("T")[0];
      const routeWeekVisits = await storage.getVisitsForDateRange(companyId, splitWeekStart, splitWeekEnd);
      const visitCountForRoute = routeWeekVisits.filter(v => v.routeId === route.id && v.status !== "cancelled").length;

      if (visitCountForRoute <= maxStops) {
        return res.json({ noOp: true, message: `Route has ${visitCountForRoute} scheduled appointments this week, at or under the limit of ${maxStops}` });
      }

      const allProperties = await storage.getProperties(companyId);
      const propertyMap = new Map(allProperties.map(p => [p.id, p]));

      const { kMeansClustering } = await import("./services/weekly-optimizer");
      const { optimizeRoute: optimizeCluster } = await import("./services/route-optimizer");

      const weeklyStops = routePlans
        .map(sp => {
          const prop = propertyMap.get(sp.propertyId);
          if (!prop || !prop.latitude || !prop.longitude) return null;
          return {
            id: sp.id,
            servicePlanId: sp.id,
            contactId: sp.contactId,
            contactName: "",
            propertyId: sp.propertyId,
            address: prop.streetAddress || "",
            latitude: parseFloat(String(prop.latitude)),
            longitude: parseFloat(String(prop.longitude)),
            currentDay: route.dayOfWeek || "tbd",
            currentRouteId: route.id,
            currentStopOrder: sp.stopOrder,
            zipCode: prop.zipCode || null,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      if (weeklyStops.length < 2) {
        return res.status(400).json({ error: "Not enough geocoded stops to split" });
      }

      const k = Math.ceil(visitCountForRoute / maxStops);
      const clusters = kMeansClustering(weeklyStops, k);

      const suffixLetters = "BCDEFGHIJKLMNOPQRSTUVWXYZ";
      const splitColors = ["#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316"];

      let startPoint: { latitude: number; longitude: number } | undefined;
      if (company.startLatitude && company.startLongitude) {
        startPoint = {
          latitude: parseFloat(String(company.startLatitude)),
          longitude: parseFloat(String(company.startLongitude)),
        };
      }

      const newRoutes: { id: string; name: string; stopCount: number }[] = [];
      const allAffectedPlanIds: string[] = [];

      for (let ci = 0; ci < clusters.length; ci++) {
        const cluster = clusters[ci];
        let targetRouteId: string;

        if (ci === 0) {
          targetRouteId = route.id;
        } else {
          const suffix = suffixLetters[ci - 1] || String(ci + 1);
          const newName = `${route.name}-${suffix}`;
          const newRoute = await storage.createRoute({
            companyId,
            name: newName,
            dayOfWeek: route.dayOfWeek || undefined,
            technicianId: route.technicianId || undefined,
            color: splitColors[(ci - 1) % splitColors.length],
          });
          targetRouteId = newRoute.id;
          newRoutes.push({ id: newRoute.id, name: newRoute.name, stopCount: cluster.length });
        }

        const clusterStops = cluster.map(s => ({ id: s.id, latitude: s.latitude, longitude: s.longitude }));
        const result = optimizeCluster(clusterStops, startPoint);

        for (let si = 0; si < result.orderedIds.length; si++) {
          await storage.updateServicePlan(result.orderedIds[si], companyId, {
            routeId: targetRouteId,
            stopOrder: si + 1,
          });
          allAffectedPlanIds.push(result.orderedIds[si]);
        }

        const unordered = cluster.filter(s => !result.orderedIds.includes(s.id));
        for (let si = 0; si < unordered.length; si++) {
          await storage.updateServicePlan(unordered[si].id, companyId, {
            routeId: targetRouteId,
            stopOrder: result.orderedIds.length + si + 1,
          });
          allAffectedPlanIds.push(unordered[si].id);
        }
      }

      try {
        const tz = company.timezone || "America/New_York";
        const today = getCompanyToday(tz);
        const uniquePlanIds = [...new Set(allAffectedPlanIds)];
        if (uniquePlanIds.length > 0) {
          await storage.deleteFutureScheduledVisitsForPlans(uniquePlanIds, today);
          const { generateVisitsForPlans } = await import("./jobs/auto-visits");
          const startDate = new Date(today + "T00:00:00Z");
          startDate.setUTCDate(startDate.getUTCDate() + 1);
          const endDate = new Date(today + "T00:00:00Z");
          endDate.setUTCDate(endDate.getUTCDate() + 182);
          await generateVisitsForPlans(companyId, uniquePlanIds, startDate.toISOString().split("T")[0], endDate.toISOString().split("T")[0]);
        }
      } catch (genErr) {
        console.error("[route-split] Failed to regenerate visits after split:", genErr);
      }

      res.json({
        routesCreated: newRoutes.length,
        newRoutes,
        originalRoute: { id: route.id, name: route.name, stopCount: clusters[0]?.length ?? routePlans.length },
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/routes/apply-max-stops", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);

      const rawMaxStops = req.body?.maxStops;
      const isClearing = rawMaxStops === null || rawMaxStops === undefined;

      if (!isClearing) {
        const n = Number(rawMaxStops);
        if (!Number.isInteger(n) || n < 2) {
          return res.status(400).json({ error: "maxStops must be an integer of 2 or greater" });
        }
      }

      const maxStops: number | null = isClearing ? null : Number(rawMaxStops);
      await storage.updateCompany(companyId, { maxStopsPerRoute: maxStops });

      if (isClearing) {
        return res.json({ cleared: true });
      }

      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const routes = await storage.getRoutes(companyId);
      const plans = await storage.getServicePlans(companyId, { isActive: true });

      const plansByRoute = new Map<string, typeof plans>();
      for (const route of routes) plansByRoute.set(route.id, []);
      for (const plan of plans) {
        if (plan.routeId && plansByRoute.has(plan.routeId)) {
          plansByRoute.get(plan.routeId)!.push(plan);
        }
      }

      // Determine effective stop count per route using this week's visit counts
      const bulkTz = company.timezone || "America/New_York";
      const bulkWeekStart = getCompanyWeekStart(bulkTz);
      const bulkWeekStartObj = new Date(bulkWeekStart + "T12:00:00Z");
      const bulkWeekEndObj = new Date(bulkWeekStartObj);
      bulkWeekEndObj.setUTCDate(bulkWeekEndObj.getUTCDate() + 6);
      const bulkWeekEnd = bulkWeekEndObj.toISOString().split("T")[0];
      const bulkWeekVisits = await storage.getVisitsForDateRange(companyId, bulkWeekStart, bulkWeekEnd);
      const visitCountByRoute = new Map<string, number>();
      for (const v of bulkWeekVisits) {
        if (v.routeId && v.status !== "cancelled") {
          visitCountByRoute.set(v.routeId, (visitCountByRoute.get(v.routeId) || 0) + 1);
        }
      }

      const oversized = routes.filter(r => (visitCountByRoute.get(r.id) || 0) > maxStops);

      if (oversized.length === 0) {
        return res.json({ routesSplit: 0, subRoutesCreated: 0, skipped: routes.length, errors: [] });
      }

      const { kMeansClustering } = await import("./services/weekly-optimizer");
      const { optimizeRoute: optimizeCluster } = await import("./services/route-optimizer");
      const allProperties = await storage.getProperties(companyId);
      const propertyMap = new Map(allProperties.map(p => [p.id, p]));

      let startPoint: { latitude: number; longitude: number } | undefined;
      if (company.startLatitude && company.startLongitude) {
        startPoint = {
          latitude: parseFloat(String(company.startLatitude)),
          longitude: parseFloat(String(company.startLongitude)),
        };
      }

      const suffixLetters = "BCDEFGHIJKLMNOPQRSTUVWXYZ";
      const splitColors = ["#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316"];
      const tz = company.timezone || "America/New_York";
      const today = getCompanyToday(tz);

      let routesSplit = 0;
      let subRoutesCreated = 0;
      const errors: string[] = [];
      const allAffectedPlanIds: string[] = [];

      for (const route of oversized) {
        try {
          const routePlans = plansByRoute.get(route.id) || [];

          const weeklyStops = routePlans
            .map(sp => {
              const prop = propertyMap.get(sp.propertyId);
              if (!prop || !prop.latitude || !prop.longitude) return null;
              return {
                id: sp.id,
                servicePlanId: sp.id,
                contactId: sp.contactId,
                contactName: "",
                propertyId: sp.propertyId,
                address: prop.streetAddress || "",
                latitude: parseFloat(String(prop.latitude)),
                longitude: parseFloat(String(prop.longitude)),
                currentDay: route.dayOfWeek || "tbd",
                currentRouteId: route.id,
                currentStopOrder: sp.stopOrder,
                zipCode: prop.zipCode || null,
              };
            })
            .filter((s): s is NonNullable<typeof s> => s !== null);

          if (weeklyStops.length < 2) {
            errors.push(`${route.name}: not enough geocoded stops`);
            continue;
          }

          const routeVisitCount = visitCountByRoute.get(route.id) || 0;
          const k = Math.ceil(routeVisitCount / maxStops);
          const clusters = kMeansClustering(weeklyStops, k);

          for (let ci = 0; ci < clusters.length; ci++) {
            const cluster = clusters[ci];
            let targetRouteId: string;

            if (ci === 0) {
              targetRouteId = route.id;
            } else {
              const suffix = suffixLetters[ci - 1] || String(ci + 1);
              const newRoute = await storage.createRoute({
                companyId,
                name: `${route.name}-${suffix}`,
                dayOfWeek: route.dayOfWeek || undefined,
                technicianId: route.technicianId || undefined,
                color: splitColors[(ci - 1) % splitColors.length],
              });
              targetRouteId = newRoute.id;
              subRoutesCreated++;
            }

            const clusterStops = cluster.map(s => ({ id: s.id, latitude: s.latitude, longitude: s.longitude }));
            const result = optimizeCluster(clusterStops, startPoint);

            for (let si = 0; si < result.orderedIds.length; si++) {
              await storage.updateServicePlan(result.orderedIds[si], companyId, {
                routeId: targetRouteId,
                stopOrder: si + 1,
              });
              allAffectedPlanIds.push(result.orderedIds[si]);
            }
            const unordered = cluster.filter(s => !result.orderedIds.includes(s.id));
            for (let si = 0; si < unordered.length; si++) {
              await storage.updateServicePlan(unordered[si].id, companyId, {
                routeId: targetRouteId,
                stopOrder: result.orderedIds.length + si + 1,
              });
              allAffectedPlanIds.push(unordered[si].id);
            }
          }
          routesSplit++;
        } catch (splitErr: any) {
          console.error(`[apply-max-stops] Failed to split route ${route.name}:`, splitErr);
          errors.push(route.name);
        }
      }

      try {
        const uniquePlanIds = [...new Set(allAffectedPlanIds)];
        if (uniquePlanIds.length > 0) {
          await storage.deleteFutureScheduledVisitsForPlans(uniquePlanIds, today);
          const { generateVisitsForPlans } = await import("./jobs/auto-visits");
          const startDate = new Date(today + "T00:00:00Z");
          startDate.setUTCDate(startDate.getUTCDate() + 1);
          const endDate = new Date(today + "T00:00:00Z");
          endDate.setUTCDate(endDate.getUTCDate() + 182);
          await generateVisitsForPlans(companyId, uniquePlanIds, startDate.toISOString().split("T")[0], endDate.toISOString().split("T")[0]);
        }
      } catch (genErr) {
        console.error("[apply-max-stops] Failed to regenerate visits:", genErr);
      }

      res.json({ routesSplit, subRoutesCreated, skipped: routes.length - oversized.length, errors });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/routes/optimize-weekly", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { respectZones = false, includeSaturday = false, weekStart } = req.body || {};

      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const tz = company.timezone || "America/New_York";

      // Determine the week range to analyse — defaults to current week
      const weekStartDate: string = (typeof weekStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(weekStart))
        ? weekStart
        : getCompanyWeekStart(tz);
      const weekStartObj = new Date(weekStartDate + "T12:00:00Z");
      const weekEndObj = new Date(weekStartObj);
      weekEndObj.setUTCDate(weekEndObj.getUTCDate() + 6);
      const weekEndDate = weekEndObj.toISOString().split("T")[0];

      // Fetch actual visits for this week — these are the appointments we will optimize
      const weekVisitsAll = await storage.getVisitsForDateRange(companyId, weekStartDate, weekEndDate);
      const activeWeekVisits = weekVisitsAll.filter(v => v.status !== "cancelled" && v.servicePlanId);

      if (activeWeekVisits.length < 3) {
        return res.status(400).json({ error: "Need at least 3 active appointments this week to optimize. Generate visits for this week first or select a different week." });
      }

      // Build plan + property maps for geographic data
      const uniquePlanIds = [...new Set(activeWeekVisits.map(v => v.servicePlanId!))];
      const allPlans = await storage.getServicePlans(companyId, { isActive: true });
      const planMap = new Map(allPlans.map(p => [p.id, p]));

      const allProperties = await storage.getProperties(companyId);
      let propertyMap = new Map(allProperties.map(p => [p.id, p]));

      // Geocode any missing properties referenced by this week's visits
      const plansNeedingGeocode = uniquePlanIds
        .map(id => planMap.get(id))
        .filter((sp): sp is NonNullable<typeof sp> => {
          if (!sp) return false;
          const prop = propertyMap.get(sp.propertyId);
          return !!(prop && prop.streetAddress && (!prop.latitude || !prop.longitude));
        });
      for (const sp of plansNeedingGeocode) {
        const prop = propertyMap.get(sp.propertyId)!;
        const coords = await geocodeAddress(prop.streetAddress!, prop.city, prop.state, prop.zipCode);
        if (coords) {
          const updated = await storage.updateProperty(prop.id, companyId, { latitude: coords.latitude, longitude: coords.longitude });
          propertyMap.set(prop.id, updated);
        }
      }

      const allContacts = await storage.getContacts(companyId);
      const contactMap = new Map(allContacts.map(c => [c.id, c]));

      const { analyzeWeeklySchedule } = await import("./services/weekly-optimizer");

      // Map each visit to a WeeklyStop — currentDay comes from the visit's actual scheduled date
      const DAYS_OF_WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const ACTIVE_DAYS_SET = includeSaturday
        ? new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"])
        : new Set(["monday", "tuesday", "wednesday", "thursday", "friday"]);

      // Filter to only visits on active days — prevents Saturday visits from being silently
      // reassigned to Monday inside the optimizer when includeSaturday is false
      let excludedWeekendCount = 0;
      const activeWeekVisitsFiltered = activeWeekVisits.filter(visit => {
        const dow = new Date(visit.scheduledDate + "T12:00:00Z").getUTCDay();
        const dayName = DAYS_OF_WEEK[dow];
        if (!ACTIVE_DAYS_SET.has(dayName)) {
          excludedWeekendCount++;
          return false;
        }
        return true;
      });

      const weeklyStops = activeWeekVisitsFiltered
        .map(visit => {
          const sp = visit.servicePlanId ? planMap.get(visit.servicePlanId) : undefined;
          if (!sp) return null;
          const prop = propertyMap.get(sp.propertyId);
          const contact = contactMap.get(sp.contactId);
          if (!prop || !prop.latitude || !prop.longitude) return null;
          const visitDow = new Date(visit.scheduledDate + "T12:00:00Z").getUTCDay();
          return {
            id: sp.id,
            servicePlanId: sp.id,
            contactId: sp.contactId,
            contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : "Unknown",
            propertyId: sp.propertyId,
            address: `${prop.streetAddress || ""}${prop.city ? `, ${prop.city}` : ""}`,
            latitude: parseFloat(String(prop.latitude)),
            longitude: parseFloat(String(prop.longitude)),
            currentDay: DAYS_OF_WEEK[visitDow] || "monday",
            currentRouteId: sp.routeId,
            currentStopOrder: sp.stopOrder,
            zipCode: prop.zipCode || null,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      if (weeklyStops.length < 3) {
        const note = excludedWeekendCount > 0 ? ` (${excludedWeekendCount} weekend stops excluded — enable "Include Saturday" to optimize them)` : "";
        return res.status(400).json({ error: `Not enough geocoded appointments to optimize${note}. Ensure property addresses are complete.` });
      }

      let startPoint: { latitude: number; longitude: number } | undefined;
      if (company.startLatitude && company.startLongitude) {
        startPoint = {
          latitude: parseFloat(String(company.startLatitude)),
          longitude: parseFloat(String(company.startLongitude)),
        };
      }

      let zones: { zipCode: string; dayOfWeek: string }[] = [];
      if (respectZones) {
        const serviceZoneRows = await storage.getServiceZones(companyId);
        zones = serviceZoneRows
          .filter(z => z.isActive)
          .map(z => ({ zipCode: z.zipCode, dayOfWeek: z.dayOfWeek }));
      }

      const maxStopsPerDay = company.maxStopsPerRoute && company.maxStopsPerRoute > 0
        ? company.maxStopsPerRoute
        : undefined;

      const result = analyzeWeeklySchedule(weeklyStops, startPoint, {
        respectZones,
        zones,
        includeSaturday,
        maxStopsPerDay,
      });

      const { calculateAllCustomerProfitability } = await import("./services/profitability-calculator");
      const allProfitability = await calculateAllCustomerProfitability(companyId);
      const profByPlan = new Map<string, { revenuePerVisitCents: number; costPerVisitCents: number; profitPerVisitCents: number }>();
      for (const cp of allProfitability) {
        for (const prop of cp.properties) {
          if (prop.servicePlanId) {
            profByPlan.set(prop.servicePlanId, {
              revenuePerVisitCents: prop.revenuePerVisitCents,
              costPerVisitCents: prop.costPerVisitCents,
              profitPerVisitCents: prop.profitPerVisitCents,
            });
          }
        }
      }

      function enrichRoutes(days: typeof result.current.days) {
        return days.map(d => ({
          ...d,
          routes: d.routes.map(r => {
            let totalRev = 0, totalCost = 0, totalProfit = 0;
            for (const stop of r.stops) {
              const sp = profByPlan.get(stop.servicePlanId);
              if (sp) {
                totalRev += sp.revenuePerVisitCents;
                totalCost += sp.costPerVisitCents;
                totalProfit += sp.profitPerVisitCents;
              }
            }
            return { ...r, totalRevenueCents: totalRev, totalCostCents: totalCost, totalProfitCents: totalProfit };
          }),
        }));
      }

      const enrichedCurrent = enrichRoutes(result.current.days);
      const enrichedProposed = enrichRoutes(result.proposed.days);


      const { getEffectivePricingConfig } = await import("./services/pricing-calculator");
      const pricingConfig = getEffectivePricingConfig(company.pricingConfig);

      let fuelCostCentsPerMile: number;
      let fuelCostSource: string;
      if (pricingConfig.vehicleMPG && pricingConfig.vehicleMPG > 0) {
        fuelCostCentsPerMile = pricingConfig.averageGasPriceCentsPerGallon / pricingConfig.vehicleMPG;
        fuelCostSource = "gas_mpg";
      } else if (pricingConfig.vehicleCostPerMileCents > 0) {
        fuelCostCentsPerMile = pricingConfig.vehicleCostPerMileCents;
        fuelCostSource = "cost_per_mile";
      } else {
        fuelCostCentsPerMile = 65;
        fuelCostSource = "default";
      }

      function computeRouteFuel(routes: { estimatedMiles: number; routeLabel: string; totalRevenueCents?: number; totalCostCents?: number; totalProfitCents?: number }[]) {
        return routes.map(r => ({
          routeLabel: r.routeLabel,
          fuelCostCents: Math.round(r.estimatedMiles * fuelCostCentsPerMile),
          miles: r.estimatedMiles,
          totalRevenueCents: r.totalRevenueCents ?? 0,
          totalCostCents: r.totalCostCents ?? 0,
          totalProfitCents: r.totalProfitCents ?? 0,
        }));
      }

      const currentFuelCostCents = Math.round(result.current.totalMiles * fuelCostCentsPerMile);
      const proposedFuelCostCents = Math.round(result.proposed.totalMiles * fuelCostCentsPerMile);
      const fuelCostSavedCents = currentFuelCostCents - proposedFuelCostCents;

      const laborCentsPerMinute = (pricingConfig.techHourlyWageCents * pricingConfig.burdenMultiplier) / 60;
      const currentLaborCents = Math.round(result.current.totalMinutes * laborCentsPerMinute);
      const proposedLaborCents = Math.round(result.proposed.totalMinutes * laborCentsPerMinute);
      const laborSavedCents = currentLaborCents - proposedLaborCents;

      res.json({
        ...result,
        excludedWeekendCount,
        laborCost: {
          centsPerMinute: Math.round(laborCentsPerMinute * 10) / 10,
          hourlyRateCents: pricingConfig.techHourlyWageCents,
          burdenMultiplier: pricingConfig.burdenMultiplier,
          burdenedHourlyRateCents: Math.round(pricingConfig.techHourlyWageCents * pricingConfig.burdenMultiplier),
          currentTotalCents: currentLaborCents,
          proposedTotalCents: proposedLaborCents,
          savedCents: laborSavedCents,
        },
        fuelCost: {
          centsPerMile: Math.round(fuelCostCentsPerMile * 10) / 10,
          source: fuelCostSource,
          gasPriceCentsPerGallon: pricingConfig.averageGasPriceCentsPerGallon,
          vehicleMPG: pricingConfig.vehicleMPG,
          currentTotalCents: currentFuelCostCents,
          proposedTotalCents: proposedFuelCostCents,
          savedCents: fuelCostSavedCents,
          currentPerDay: enrichedCurrent.map(d => ({
            day: d.day,
            fuelCostCents: Math.round(d.totalMiles * fuelCostCentsPerMile),
            routes: computeRouteFuel(d.routes),
          })),
          proposedPerDay: enrichedProposed.map(d => ({
            day: d.day,
            fuelCostCents: Math.round(d.totalMiles * fuelCostCentsPerMile),
            routes: computeRouteFuel(d.routes),
          })),
        },
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/routes/apply-weekly-plan", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);

      type DayOfWeekValue = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
      type PlanStop = { servicePlanId?: string; id?: string };
      type PlanRoute = { routeLabel?: string; stops?: PlanStop[] };
      type DayPlan = { day: DayOfWeekValue; routes: PlanRoute[] };

      const { acceptedDays, proposedDays } = req.body;
      if (!proposedDays || !Array.isArray(proposedDays)) {
        return res.status(400).json({ error: "proposedDays is required" });
      }

      const validDays: DayOfWeekValue[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
      for (const dp of proposedDays) {
        if (!dp.day || !validDays.includes(dp.day)) {
          return res.status(400).json({ error: `Invalid day: ${dp.day}` });
        }
        if (!Array.isArray(dp.routes)) {
          return res.status(400).json({ error: "Each day must have a routes array" });
        }
      }
      const typedDays = proposedDays as DayPlan[];

      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const daysToApply: DayPlan[] = acceptedDays && Array.isArray(acceptedDays)
        ? typedDays.filter(d => acceptedDays.includes(d.day))
        : typedDays;

      const companyPlans = await storage.getServicePlans(companyId, { isActive: true });
      const validPlanIds = new Set(companyPlans.map(p => p.id));

      const getStopId = (s: PlanStop): string | undefined => s.servicePlanId || s.id;

      let totalRoutes = 0;
      let totalStopsValidated = 0;
      for (const dayPlan of daysToApply) {
        for (const route of dayPlan.routes) {
          const routeStops = (route.stops || []).filter(s => {
            const spId = getStopId(s);
            return spId && validPlanIds.has(spId);
          });
          if (routeStops.length > 0) {
            totalRoutes++;
            totalStopsValidated += routeStops.length;
          }
        }
      }

      if (totalRoutes === 0) {
        return res.status(400).json({ error: "No valid stops to apply" });
      }

      const currentCredits = company.routeCredits ?? 0;
      if (currentCredits < totalRoutes) {
        return res.status(402).json({
          error: "Insufficient route credits",
          creditsRequired: totalRoutes,
          creditsAvailable: currentCredits,
        });
      }

      const existingRoutes = await storage.getRoutes(companyId);

      let routesCreated = 0;
      let stopsUpdated = 0;
      const updatedPlanIds: string[] = [];

      for (const dayPlan of daysToApply) {
        const day = dayPlan.day;
        let dayRouteIdx = 0;
        for (let rIdx = 0; rIdx < dayPlan.routes.length; rIdx++) {
          const proposedRoute = dayPlan.routes[rIdx];
          const validStops = (proposedRoute.stops || []).filter(s => {
            const spId = getStopId(s);
            return spId && validPlanIds.has(spId);
          });
          if (validStops.length === 0) continue;

          const routeLabel = proposedRoute.routeLabel || `${day.charAt(0).toUpperCase() + day.slice(1)} Route`;

          let existingRoute = dayRouteIdx === 0
            ? existingRoutes.find(r => r.dayOfWeek === day && !r.date && !r.isLocked)
            : null;
          if (!existingRoute) {
            const newRoute = await storage.createRoute({
              companyId,
              name: routeLabel,
              dayOfWeek: day,
              color: ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6"][routesCreated % 5],
            });
            existingRoute = newRoute;
            existingRoutes.push(newRoute);
            routesCreated++;
          }
          dayRouteIdx++;

          for (let sIdx = 0; sIdx < validStops.length; sIdx++) {
            const stop = validStops[sIdx];
            const spId = getStopId(stop)!;
            await storage.updateServicePlan(spId, companyId, {
              routeId: existingRoute.id,
              dayOfWeek: day,
              stopOrder: sIdx + 1,
            });
            updatedPlanIds.push(spId);
            stopsUpdated++;
          }
        }
      }

      const appliedDaySet = new Set(daysToApply.map(d => d.day));
      let routesRemoved = 0;
      const refreshedRoutes = await storage.getRoutes(companyId);
      const allPlans = await storage.getServicePlans(companyId, { isActive: true });
      for (const route of refreshedRoutes) {
        if (!route.dayOfWeek || route.date || route.isLocked) continue;
        if (!appliedDaySet.has(route.dayOfWeek)) continue;
        const assignedStops = allPlans.filter(p => p.routeId === route.id);
        if (assignedStops.length === 0) {
          try {
            await storage.deleteRoute(route.id, companyId);
            routesRemoved++;
          } catch (_e) {}
        }
      }

      await storage.updateCompany(companyId, { routeCredits: currentCredits - totalRoutes });

      try {
        const tz = company?.timezone || "America/New_York";
        const today = getCompanyToday(tz);
        const affectedPlanIds = [...new Set(updatedPlanIds)];
        if (affectedPlanIds.length > 0) {
          await storage.deleteFutureScheduledVisitsForPlans(affectedPlanIds, today);
          const { generateVisitsForPlans } = await import("./jobs/auto-visits");
          const startDate = new Date(today + "T00:00:00Z");
          startDate.setUTCDate(startDate.getUTCDate() + 1);
          const endDate = new Date(today + "T00:00:00Z");
          endDate.setUTCDate(endDate.getUTCDate() + 182);
          await generateVisitsForPlans(companyId, affectedPlanIds, startDate.toISOString().split("T")[0], endDate.toISOString().split("T")[0]);
        }
      } catch (genErr) {
        console.error("[apply-weekly-plan] Failed to regenerate visits after optimization:", genErr);
      }

      res.json({
        applied: true,
        routesCreated,
        routesRemoved,
        stopsUpdated,
        creditsUsed: totalRoutes,
        creditsRemaining: currentCredits - totalRoutes,
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/routes/:id/reverse", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const route = await storage.getRoute(req.params.id, companyId);
      if (!route) return res.status(404).json({ error: "Route not found" });

      if (route.isLocked) {
        return res.status(409).json({ error: "Route is locked. Unlock it before reversing." });
      }

      const plans = await storage.getServicePlans(companyId, { isActive: true });
      const routePlans = plans.filter(sp => sp.routeId === route.id).sort((a, b) => a.stopOrder - b.stopOrder);

      if (routePlans.length < 2) {
        return res.json({ reversed: false, message: "Not enough stops to reverse" });
      }

      const reversed = [...routePlans].reverse();
      for (let i = 0; i < reversed.length; i++) {
        await storage.updateServicePlan(reversed[i].id, companyId, { stopOrder: i + 1 });
      }

      res.json({ reversed: true, stopCount: routePlans.length });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/routes/:id/metrics", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const route = await storage.getRoute(req.params.id, companyId);
      if (!route) return res.status(404).json({ error: "Route not found" });

      const plans = await storage.getServicePlans(companyId, { isActive: true });
      const routePlans = plans.filter(sp => sp.routeId === route.id).sort((a, b) => a.stopOrder - b.stopOrder);

      if (routePlans.length < 2) {
        return res.json({ totalDistance: 0, totalDuration: 0, legs: [], stopCount: routePlans.length });
      }

      const allProperties = await storage.getProperties(companyId);
      const propMap = new Map(allProperties.map(p => [p.id, p]));

      const stops: { id: string; latitude: number; longitude: number }[] = [];
      const missingCoords: string[] = [];

      for (const sp of routePlans) {
        const prop = propMap.get(sp.propertyId);
        if (prop?.latitude && prop?.longitude) {
          stops.push({ id: sp.id, latitude: Number(prop.latitude), longitude: Number(prop.longitude) });
        } else {
          missingCoords.push(sp.id);
        }
      }

      if (stops.length < 2) {
        return res.json({ totalDistance: 0, totalDuration: 0, legs: [], stopCount: routePlans.length, missingCoords });
      }

      const company = await storage.getCompany(companyId);
      const startPoint = company?.startLatitude && company?.startLongitude
        ? { latitude: Number(company.startLatitude), longitude: Number(company.startLongitude) }
        : undefined;

      const metrics = await getRouteMetricsWithLegs(stops, startPoint);

      if (!metrics) {
        return res.json({ totalDistance: 0, totalDuration: 0, legs: [], stopCount: routePlans.length, missingCoords, error: "Unable to calculate driving metrics" });
      }

      res.json({
        totalDistance: Math.round(metrics.totalDistance * 10) / 10,
        totalDuration: Math.round(metrics.totalDuration),
        legs: metrics.legs.map(l => ({
          fromId: l.fromId,
          toId: l.toId,
          distance: Math.round(l.distance * 10) / 10,
          duration: Math.round(l.duration),
        })),
        stopCount: routePlans.length,
        missingCoords: missingCoords.length > 0 ? missingCoords : undefined,
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/routes/:id/dispatch", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const route = await storage.getRoute(req.params.id, companyId);
      if (!route) return res.status(404).json({ error: "Route not found" });
      if (!route.technicianId) return res.status(400).json({ error: "No technician assigned to this route" });

      const targetDate = req.body.date || new Date().toISOString().split("T")[0];

      const plans = await storage.getServicePlans(companyId, { isActive: true });
      const routePlans = plans.filter(sp => sp.routeId === route.id).sort((a, b) => a.stopOrder - b.stopOrder);

      if (routePlans.length === 0) {
        return res.status(400).json({ error: "No stops in this route to dispatch" });
      }

      const existingVisits = await storage.getVisits(companyId, { date: targetDate });
      const existingSet = new Set(existingVisits.map(v => `${v.servicePlanId}_${v.scheduledDate}`));

      const dayMap: Record<string, number> = {
        monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
        friday: 5, saturday: 6, sunday: 0,
      };

      let created = 0;
      let skipped = 0;
      for (const plan of routePlans) {
        const key = `${plan.id}_${targetDate}`;
        if (existingSet.has(key)) {
          skipped++;
          continue;
        }

        const targetDateObj = new Date(targetDate + "T00:00:00Z");
        const targetDayOfWeek = targetDateObj.getUTCDay();
        const planDayNum = plan.dayOfWeek ? dayMap[plan.dayOfWeek] : undefined;
        if (planDayNum !== undefined && targetDayOfWeek !== planDayNum) {
          skipped++;
          continue;
        }

        if (plan.startDate) {
          const planStartDate = new Date(plan.startDate + "T00:00:00Z");
          if (targetDateObj < planStartDate) {
            skipped++;
            continue;
          }
        }
        if (plan.endDate) {
          const planEndDate = new Date(plan.endDate + "T00:00:00Z");
          if (targetDateObj > planEndDate) {
            skipped++;
            continue;
          }
        }

        let shouldGenerate = true;
        if (plan.frequency !== "weekly" && !plan.startDate) {
          shouldGenerate = false;
        } else if (plan.frequency === "biweekly") {
          const planStartDate = new Date(plan.startDate + "T00:00:00Z");
          const diffMs = targetDateObj.getTime() - planStartDate.getTime();
          const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
          const diffWeeks = Math.floor(diffDays / 7);
          if (diffWeeks % 2 !== 0) shouldGenerate = false;
        } else if (plan.frequency === "monthly") {
          const planStartDate = new Date(plan.startDate + "T00:00:00Z");
          if (!(targetDateObj.getUTCMonth() === planStartDate.getUTCMonth() && targetDateObj.getUTCFullYear() === planStartDate.getUTCFullYear())) {
            const effectiveDayNum = planDayNum !== undefined ? planDayNum : targetDayOfWeek;
            const firstOfMonth = new Date(Date.UTC(targetDateObj.getUTCFullYear(), targetDateObj.getUTCMonth(), 1));
            let firstTargetDay = new Date(firstOfMonth);
            while (firstTargetDay.getUTCDay() !== effectiveDayNum) {
              firstTargetDay.setUTCDate(firstTargetDay.getUTCDate() + 1);
            }
            if (targetDateObj.getTime() !== firstTargetDay.getTime()) shouldGenerate = false;
          }
        } else if (plan.frequency === "onetime") {
          if (targetDate !== plan.startDate) shouldGenerate = false;
        }

        if (!shouldGenerate) {
          skipped++;
          continue;
        }

        await storage.createVisit({
          companyId,
          servicePlanId: plan.id,
          propertyId: plan.propertyId,
          routeId: route.id,
          scheduledDate: targetDate,
          status: "scheduled",
        });
        created++;
      }

      res.json({
        dispatched: true,
        technicianId: route.technicianId,
        date: targetDate,
        visitsCreated: created,
        visitsSkipped: skipped,
        totalStops: routePlans.length,
      });
    } catch (err) { handleError(res, err); }
  });

  // ================ Service Plan Routes ================

  app.get("/api/service-plans", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const hasFilters = req.query.contactId || req.query.propertyId || req.query.isActive !== undefined;
      const enriched = req.query.enriched === "true" || !hasFilters;

      const filters: { contactId?: string; propertyId?: string; isActive?: boolean } = {};
      if (req.query.contactId) filters.contactId = req.query.contactId as string;
      if (req.query.propertyId) filters.propertyId = req.query.propertyId as string;
      if (req.query.isActive !== undefined) filters.isActive = req.query.isActive === "true";

      const plans = await storage.getServicePlans(companyId, hasFilters ? filters : undefined);

      if (enriched && !hasFilters) {
        const allContacts = await storage.getContacts(companyId);
        const allProperties = await storage.getProperties(companyId);
        const allRoutes = await storage.getRoutes(companyId);

        const contactMap = new Map(allContacts.map(c => [c.id, c]));
        const propertyMap = new Map(allProperties.map(p => [p.id, p]));
        const routeMap = new Map(allRoutes.map(r => [r.id, r]));

        const enrichedPlans = await Promise.all(plans.map(async (plan) => {
          const addOns = await storage.getServicePlanAddOns(plan.id);
          const contact = contactMap.get(plan.contactId);
          const property = propertyMap.get(plan.propertyId);
          const route = plan.routeId ? routeMap.get(plan.routeId) : null;
          return {
            ...plan,
            addOns,
            contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : "Unknown",
            propertyAddress: property ? `${property.streetAddress || ""}${property.city ? `, ${property.city}` : ""}`.trim() : "Unknown",
            routeName: route?.name || null,
          };
        }));
        res.json(enrichedPlans);
      } else {
        const plansWithAddOns = await Promise.all(plans.map(async (plan) => {
          const addOns = await storage.getServicePlanAddOns(plan.id);
          return { ...plan, addOns };
        }));
        res.json(plansWithAddOns);
      }
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/service-plans/bulk", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const bulkSchema = z.object({
        ids: z.array(z.string().uuid()).min(1, "ids must be a non-empty array of UUIDs"),
        updates: z.object({
          priceAdjustment: z.object({
            type: z.enum(["flat", "percentage"]),
            amount: z.number().finite(),
          }).optional(),
          dayOfWeek: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]).optional(),
          isActive: z.boolean().optional(),
          routeId: z.string().nullable().optional(),
        }).strict(),
      });

      const parsed = bulkSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors.map(e => e.message).join("; ") });
      }
      const { ids, updates } = parsed.data;

      if (updates.routeId && updates.routeId !== "") {
        const companyRoutes = await storage.getRoutes(companyId);
        const routeExists = companyRoutes.some(r => r.id === updates.routeId);
        if (!routeExists) {
          return res.status(400).json({ error: "Route not found or does not belong to your company" });
        }
      }

      const allPlans = await storage.getServicePlans(companyId);
      const planMap = new Map(allPlans.map(p => [p.id, p]));
      const activePlans = allPlans.filter(p => p.isActive);

      let dayRoutes: Awaited<ReturnType<typeof storage.getRoutes>> | null = null;
      if (updates.dayOfWeek && !updates.routeId) {
        dayRoutes = await storage.getRoutes(companyId, updates.dayOfWeek);
      }

      const results: typeof allPlans = [];
      for (const planId of ids) {
        const existing = planMap.get(planId);
        if (!existing) continue;

        const safeUpdates: Partial<{
          pricePerVisit: string;
          isActive: boolean;
          pausedAt: Date | null;
          routeId: string | null;
          dayOfWeek: string;
        }> = {};

        if (updates.priceAdjustment) {
          const currentPrice = parseFloat(existing.pricePerVisit);
          if (updates.priceAdjustment.type === "flat") {
            safeUpdates.pricePerVisit = Math.max(0, currentPrice + updates.priceAdjustment.amount).toFixed(2);
          } else {
            safeUpdates.pricePerVisit = Math.max(0, currentPrice * (1 + updates.priceAdjustment.amount / 100)).toFixed(2);
          }
        }

        if (updates.isActive !== undefined) {
          safeUpdates.isActive = updates.isActive;
          safeUpdates.pausedAt = updates.isActive ? null : new Date();
        }

        if (updates.routeId !== undefined) {
          safeUpdates.routeId = updates.routeId === "" ? null : updates.routeId;
        }

        if (updates.dayOfWeek) {
          safeUpdates.dayOfWeek = updates.dayOfWeek;
          if (updates.dayOfWeek !== existing.dayOfWeek && !updates.routeId) {
            if (dayRoutes && dayRoutes.length > 0) {
              let bestRoute = dayRoutes[0];
              let bestCount = Infinity;
              for (const route of dayRoutes) {
                const stopCount = activePlans.filter(sp => sp.routeId === route.id && sp.id !== planId).length;
                if (stopCount < bestCount) {
                  bestCount = stopCount;
                  bestRoute = route;
                }
              }
              safeUpdates.routeId = bestRoute.id;
            } else {
              safeUpdates.routeId = null;
            }
          }
        }

        if (Object.keys(safeUpdates).length === 0) continue;
        const plan = await storage.updateServicePlan(planId, companyId, safeUpdates);
        if (plan) results.push(plan);
      }

      res.json({ updated: results.length, results });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/service-plans/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const plan = await storage.getServicePlan(req.params.id, companyId);
      if (!plan) return res.status(404).json({ error: "Scheduled service not found" });
      const addOns = await storage.getServicePlanAddOns(plan.id);
      res.json({ ...plan, addOns });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/service-plans", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const body = { ...req.body, companyId };
      if (!body.routeId || body.routeId === "") body.routeId = null;
      const parsed = insertServicePlanSchema.parse(body);

      const plan = await storage.createServicePlan(parsed);

      const { userId } = await getCompanyContext(req);
      auditLog(companyId, userId, "service_plan", plan.id, "create", { new: { contactId: parsed.contactId, frequency: parsed.frequency, dayOfWeek: parsed.dayOfWeek } }, req.ip || undefined);

      const contact = await storage.getContact(parsed.contactId, companyId);
      if (contact && (contact.status === "lead" || contact.status === "estimate")) {
        await storage.updateContact(parsed.contactId, companyId, { status: "active" });
        if (contact.email && !contact.hasPortalAccess) {
          provisionPortalAccess(parsed.contactId, companyId, getBaseUrl(req)).catch((err) =>
            console.error("[auto-portal] Failed to provision portal access on service plan creation:", err)
          );
        }
      }

      if (contact && !contact.stripeCustomerId && contact.email) {
        (async () => {
          try {
            const co = await storage.getCompany(companyId);
            const acct = co?.stripeConnectOnboarded ? co.stripeConnectAccountId : null;
            const stripeCustomerId = await createStripeCustomer({
              email: contact.email!,
              name: `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || contact.email!,
              metadata: { scoopilotContactId: contact.id, companyId },
              stripeAccount: acct,
            });
            await storage.updateContact(parsed.contactId, companyId, { stripeCustomerId });
          } catch (err) {
            console.error("[auto-stripe] Failed to auto-create Stripe customer:", err);
          }
        })();
      }

      let planAddOns: any[] = [];
      if (req.body.addOns && Array.isArray(req.body.addOns)) {
        const validatedAddOns = await validateAndResolveAddOns(req.body.addOns, companyId);
        planAddOns = await storage.setServicePlanAddOns(plan.id, validatedAddOns);
      }

      try {
        const { generateVisitsForPlans } = await import("./jobs/auto-visits");
        const today = new Date();
        const planStart = plan.startDate ? new Date(plan.startDate + "T00:00:00") : today;
        const anchor = planStart > today ? planStart : today;
        const sixMonthsOut = new Date(anchor);
        sixMonthsOut.setDate(sixMonthsOut.getDate() + 182);
        await generateVisitsForPlans(companyId, [plan.id], anchor.toISOString().split("T")[0], sixMonthsOut.toISOString().split("T")[0]);
      } catch (genErr) {
        console.error("[service-plan] Failed to auto-generate visits:", genErr);
      }

      res.status(201).json({ ...plan, addOns: planAddOns });
    } catch (err) { handleError(res, err); }
  });

  async function buildVisitLineItemsWithAddOns(
    visits: { id: string; scheduledDate: string; servicePlanId: string }[],
    planMap: Map<string, { pricePerVisit: string; name?: string | null; serviceName?: string | null; id: string }>,
  ): Promise<{ visitId: string; description: string; quantity: number; unitPrice: string; total: string }[]> {
    const planAddOnsCache = new Map<string, { name: string; price: string }[]>();
    const lineItems: { visitId: string; description: string; quantity: number; unitPrice: string; total: string }[] = [];
    for (const visit of visits) {
      const plan = planMap.get(visit.servicePlanId);
      const unitPrice = plan ? plan.pricePerVisit : "0";
      const planLabel = plan?.serviceName || plan?.name || "";
      lineItems.push({
        visitId: visit.id,
        description: `${planLabel ? planLabel + " - " : ""}Service on ${visit.scheduledDate}`,
        quantity: 1,
        unitPrice: unitPrice.toString(),
        total: unitPrice.toString(),
      });
      if (plan) {
        if (!planAddOnsCache.has(plan.id)) {
          const addOns = await storage.getServicePlanAddOns(plan.id);
          planAddOnsCache.set(plan.id, addOns.filter(a => a.isActive).map(a => ({ name: a.name, price: a.price })));
        }
        const addOns = planAddOnsCache.get(plan.id) || [];
        for (const addon of addOns) {
          lineItems.push({
            visitId: visit.id,
            description: `${addon.name} on ${visit.scheduledDate}`,
            quantity: 1,
            unitPrice: addon.price,
            total: addon.price,
          });
        }
      }
    }
    return lineItems;
  }

  async function validateAndResolveAddOns(addOns: any[], companyId: string) {
    if (!Array.isArray(addOns)) return [];
    const pricingItems = await storage.getServicePricing(companyId);
    const validAddOns: { servicePricingId: string; name: string; price: string }[] = [];
    const seen = new Set<string>();
    for (const addon of addOns) {
      if (!addon.servicePricingId || seen.has(addon.servicePricingId)) continue;
      const item = pricingItems.find(p => p.id === addon.servicePricingId && p.category === "add_on" && p.isActive);
      if (!item) continue;
      seen.add(addon.servicePricingId);
      validAddOns.push({
        servicePricingId: item.id,
        name: item.name,
        price: item.basePrice,
      });
    }
    return validAddOns;
  }

  app.patch("/api/service-plans/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getServicePlan(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Scheduled service not found" });
      const validFrequencies = ["weekly", "biweekly", "monthly", "onetime"];
      if (req.body.frequency && !validFrequencies.includes(req.body.frequency)) {
        return res.status(400).json({ error: `Invalid frequency. Must be one of: ${validFrequencies.join(", ")}` });
      }
      const validDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
      if (req.body.dayOfWeek && !validDays.includes(req.body.dayOfWeek)) {
        return res.status(400).json({ error: `Invalid dayOfWeek. Must be one of: ${validDays.join(", ")}` });
      }

      const allowedFields = [
        "frequency", "dayOfWeek", "pricePerVisit", "isActive", "startDate", "endDate",
        "routeId", "stopOrder", "serviceName", "jobType", "jobStatus", "startTime",
        "endTime", "anytime", "endsAfterCount", "endsAfterUnit", "visitInstructions",
        "assignedUserId", "isStopOnly", "pausedAt", "discount",
      ];
      const body: Record<string, any> = {};
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) body[key] = req.body[key];
      }
      if (body.routeId === "") body.routeId = null;
      if (body.pricePerVisit !== undefined) body.pricePerVisit = sanitizeDecimal(body.pricePerVisit);

      const dayChanged = body.dayOfWeek && body.dayOfWeek !== existing.dayOfWeek;
      if (dayChanged && !body.routeId) {
        const dayRoutes = await storage.getRoutes(companyId, body.dayOfWeek);
        if (dayRoutes.length > 0) {
          const allPlans = await storage.getServicePlans(companyId, { isActive: true });
          let bestRoute = dayRoutes[0];
          let bestCount = Infinity;
          for (const route of dayRoutes) {
            const stopCount = allPlans.filter(sp => sp.routeId === route.id && sp.id !== req.params.id).length;
            if (stopCount < bestCount) {
              bestCount = stopCount;
              bestRoute = route;
            }
          }
          body.routeId = bestRoute.id;
        }
      }

      if (body.routeId && body.routeId !== existing.routeId && body.stopOrder === undefined) {
        const routeStops = await storage.getServicePlans(companyId, { routeId: body.routeId, isActive: true });
        body.stopOrder = routeStops.length + 1;
      }

      if (body.routeId && !body.dayOfWeek) {
        const targetRoute = await storage.getRoute(body.routeId, companyId);
        if (targetRoute) {
          body.dayOfWeek = targetRoute.dayOfWeek;
        }
      }

      const { addOns: addOnsData, ...rawBody } = req.body;
      const updateBody = body;
      const plan = await storage.updateServicePlan(req.params.id, companyId, updateBody);
      const { userId } = await getCompanyContext(req);
      auditLog(companyId, userId, "service_plan", req.params.id, "update", { old: { frequency: existing.frequency, dayOfWeek: existing.dayOfWeek, routeId: existing.routeId }, new: updateBody }, req.ip || undefined);

      if (body.isActive === false && existing.isActive === true) {
        const today = new Date().toISOString().split("T")[0];
        const cancelledCount = await storage.cancelFutureVisitsForPlans([req.params.id], today);
        if (cancelledCount > 0) {
          console.log(`[admin-pause] Cancelled ${cancelledCount} future visits for plan ${req.params.id}`);
        }
      }

      const reactivated = body.isActive === true && existing.isActive === false;
      const scheduleChanged = (body.frequency && body.frequency !== existing.frequency) ||
                              (body.dayOfWeek && body.dayOfWeek !== existing.dayOfWeek);

      if (reactivated || scheduleChanged) {
        try {
          if (scheduleChanged && !reactivated) {
            const todayStr = new Date().toISOString().split("T")[0];
            await storage.cancelFutureVisitsForPlans([req.params.id], todayStr);
          }
          const { generateVisitsForPlans } = await import("./jobs/auto-visits");
          const today = new Date();
          const startDate = plan?.startDate ? new Date(plan.startDate + "T00:00:00") : today;
          const anchor = startDate > today ? startDate : today;
          const sixMonthsOut = new Date(anchor);
          sixMonthsOut.setDate(sixMonthsOut.getDate() + 182);
          const generated = await generateVisitsForPlans(companyId, [req.params.id], anchor.toISOString().split("T")[0], sixMonthsOut.toISOString().split("T")[0]);
          console.log(`[plan-update] ${reactivated ? "Reactivated" : "Schedule changed"}: generated ${generated} visits for plan ${req.params.id}`);
        } catch (genErr) {
          console.error("[plan-update] Failed to regenerate visits:", genErr);
        }
      }

      if (addOnsData && Array.isArray(addOnsData)) {
        const validatedAddOns = await validateAndResolveAddOns(addOnsData, companyId);
        const addOns = await storage.setServicePlanAddOns(req.params.id, validatedAddOns);
        const existingJob = await storage.getJobByServicePlanId(req.params.id);
        if (existingJob) await storage.setJobAddOns(existingJob.id, validatedAddOns);
        return res.json({ ...plan, addOns });
      }

      const addOns = await storage.getServicePlanAddOns(req.params.id);
      res.json({ ...plan, addOns });
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/service-plans/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getServicePlan(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Scheduled service not found" });

      await storage.deleteServicePlan(req.params.id, companyId);
      const { userId } = await getCompanyContext(req);
      auditLog(companyId, userId, "service_plan", req.params.id, "delete", { deleted: { contactId: existing.contactId, frequency: existing.frequency, dayOfWeek: existing.dayOfWeek } }, req.ip || undefined);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  // ================ Jobs API ================

  app.get("/api/jobs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const filters: { isActive?: boolean; routeId?: string; propertyId?: string; contactId?: string } = {};
      if (req.query.contactId) filters.contactId = req.query.contactId as string;
      if (req.query.propertyId) filters.propertyId = req.query.propertyId as string;
      if (req.query.isActive !== undefined) filters.isActive = req.query.isActive === "true";
      if (req.query.routeId) filters.routeId = req.query.routeId as string;
      const jobsList = await storage.getJobsWithAgreements(companyId, Object.keys(filters).length > 0 ? filters : undefined);
      const jobStatus = req.query.jobStatus as string | undefined;
      const jobType = req.query.jobType as string | undefined;
      let filtered = jobsList;
      if (jobStatus) filtered = filtered.filter(j => j.jobStatus === jobStatus);
      if (jobType) filtered = filtered.filter(j => j.jobType === jobType);
      res.json(filtered);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/jobs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const body = { ...req.body, companyId };
      if (!body.routeId || body.routeId === "") body.routeId = null;
      if (!body.jobType) body.jobType = body.frequency === "onetime" ? "one_off" : "recurring";
      if (!body.jobStatus) body.jobStatus = "active";
      if (body.anytime === undefined) body.anytime = true;
      const isActive = body.jobStatus === "active";

      let effectiveDay = body.dayOfWeek;
      if (!effectiveDay && body.startDate) {
        const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
        const d = new Date(body.startDate + "T12:00:00");
        effectiveDay = dayNames[d.getDay()];
        body.dayOfWeek = effectiveDay;
      }

      if (!body.routeId && effectiveDay && isActive) {
        const allRoutes = await storage.getRoutes(companyId);
        const dayRoute = allRoutes.find(r => r.dayOfWeek === effectiveDay && !r.date);
        if (dayRoute) {
          body.routeId = dayRoute.id;
        } else {
          const dayLabel = effectiveDay.charAt(0).toUpperCase() + effectiveDay.slice(1);
          const newRoute = await storage.createRoute({
            companyId,
            name: dayLabel,
            dayOfWeek: effectiveDay,
            date: null,
            technicianId: body.assignedUserId || null,
            color: "#3b82f6",
          });
          body.routeId = newRoute.id;
        }
      }

      const rawPrice = parseFloat(body.pricePerVisit);
      const safePrice = isNaN(rawPrice) ? "0.00" : rawPrice.toFixed(2);

      const sp = await storage.createServicePlan({
        companyId,
        contactId: body.contactId,
        propertyId: body.propertyId,
        frequency: body.frequency || "weekly",
        pricePerVisit: safePrice,
        isActive,
        startDate: body.startDate || new Date().toISOString().split("T")[0],
        endDate: body.endDate || null,
        endsAfterCount: body.endsAfterCount || null,
        endsAfterUnit: body.endsAfterUnit || null,
        estimateId: body.estimateId || null,
        routeId: body.routeId || null,
        stopOrder: body.stopOrder || 0,
        dayOfWeek: body.dayOfWeek || null,
        serviceName: body.serviceName || null,
        jobType: body.jobType,
        jobStatus: body.jobStatus,
        startTime: body.startTime || null,
        endTime: body.endTime || null,
        anytime: body.anytime,
        visitInstructions: body.visitInstructions || null,
        assignedUserId: body.assignedUserId || null,
        isStopOnly: body.isStopOnly || false,
      });

      try {
        const { generateVisitsForPlans } = await import("./jobs/auto-visits");
        const today = new Date();
        const jobStart = body.startDate ? new Date(body.startDate + "T00:00:00") : today;
        const anchor = jobStart > today ? jobStart : today;
        const sixMonthsOut = new Date(anchor);
        sixMonthsOut.setDate(sixMonthsOut.getDate() + 182);
        await generateVisitsForPlans(companyId, [sp.id], anchor.toISOString().split("T")[0], sixMonthsOut.toISOString().split("T")[0]);
      } catch (genErr) {
        console.error("[jobs] Failed to auto-generate visits:", genErr);
      }

      const contact = await storage.getContact(body.contactId, companyId);
      if (contact && (contact.status === "lead" || contact.status === "estimate")) {
        await storage.updateContact(body.contactId, companyId, { status: "active" });
        if (contact.email && !contact.hasPortalAccess) {
          provisionPortalAccess(body.contactId, companyId, getBaseUrl(req)).catch((err) =>
            console.error("[auto-portal] Failed to provision portal access on job creation:", err)
          );
        }
      }

      if (contact && !contact.stripeCustomerId && contact.email) {
        (async () => {
          try {
            const co = await storage.getCompany(companyId);
            const acct = co?.stripeConnectOnboarded ? co.stripeConnectAccountId : null;
            const stripeCustomerId = await createStripeCustomer({
              email: contact.email!,
              name: `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || contact.email!,
              metadata: { scoopilotContactId: contact.id, companyId },
              stripeAccount: acct,
            });
            await storage.updateContact(body.contactId, companyId, { stripeCustomerId });
          } catch (err) {
            console.error("[auto-stripe] Failed to auto-create Stripe customer:", err);
          }
        })();
      }

      const linkedJob = await storage.getJobByServicePlanId(sp.id);
      const linkedAgreement = await storage.getAgreementByServicePlanId(sp.id);
      res.status(201).json({ ...(linkedJob || {}), agreementId: linkedAgreement?.id, contactId: body.contactId, frequency: body.frequency, servicePlanId: sp.id });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/jobs/:id/approve", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const job = await storage.getJob(req.params.id, companyId);
      if (!job) return res.status(404).json({ error: "Job not found" });
      if (job.jobStatus !== "draft") {
        return res.status(400).json({ error: `Cannot approve a job with status '${job.jobStatus}'` });
      }

      const updated = await storage.updateJob(job.id, companyId, { jobStatus: "active" });
      const agreement = await storage.getAgreement(job.agreementId, companyId);
      if (agreement) {
        await storage.updateAgreement(agreement.id, companyId, { isActive: true });
      }

      if (job.servicePlanId) {
        await storage.updateServicePlan(job.servicePlanId, companyId, { jobStatus: "active", isActive: true });
        try {
          const { generateVisitsForPlans } = await import("./jobs/auto-visits");
          const today = new Date();
          const plan = await storage.getServicePlan(job.servicePlanId, companyId);
          const planStart = plan?.startDate ? new Date(plan.startDate + "T00:00:00") : today;
          const anchor = planStart > today ? planStart : today;
          const sixMonthsOut = new Date(anchor);
          sixMonthsOut.setDate(sixMonthsOut.getDate() + 182);
          const generated = await generateVisitsForPlans(companyId, [job.servicePlanId], anchor.toISOString().split("T")[0], sixMonthsOut.toISOString().split("T")[0]);
          console.log(`[job-approve] Generated ${generated} visits for approved job ${job.id}`);
        } catch (genErr) {
          console.error("[job-approve] Failed to generate visits:", genErr);
        }
      }

      res.json(updated);
    } catch (err) { handleError(res, err); }
  });

  // ================ Service Zone Routes ================

  app.get("/api/service-zones", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const zones = await storage.getServiceZones(companyId);
      res.json(zones);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/service-zones", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { zipCode, dayOfWeek, label, latitude, longitude, priceSurchargePercent } = req.body;
      if (!zipCode) return res.status(400).json({ error: "zipCode is required" });
      const zone = await storage.createServiceZone({
        companyId,
        zipCode,
        dayOfWeek: dayOfWeek || "tbd",
        label: label || null,
        priceSurchargePercent: Math.max(0, Math.min(200, Math.round(Number(priceSurchargePercent) || 0))),
        latitude: latitude || null,
        longitude: longitude || null,
      });
      res.status(201).json(zone);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/service-zones/bulk", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { zones } = req.body;
      if (!Array.isArray(zones) || zones.length === 0) return res.status(400).json({ error: "zones array is required" });
      const created = [];
      for (const z of zones) {
        if (!z.zipCode) continue;
        const zone = await storage.createServiceZone({
          companyId,
          zipCode: z.zipCode,
          dayOfWeek: z.dayOfWeek || "tbd",
          label: z.label || null,
          priceSurchargePercent: Math.max(0, Math.min(200, Math.round(Number(z.priceSurchargePercent) || 0))),
          latitude: z.latitude || null,
          longitude: z.longitude || null,
        });
        created.push(zone);
      }
      res.status(201).json(created);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/service-zones/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const zones = await storage.getServiceZones(companyId);
      const existing = zones.find(z => z.id === req.params.id);
      if (!existing) return res.status(404).json({ error: "Service zone not found" });
      const { dayOfWeek, label, isActive, priceSurchargePercent } = req.body;
      const updates: any = {};
      if (dayOfWeek !== undefined) updates.dayOfWeek = dayOfWeek;
      if (label !== undefined) updates.label = label;
      if (isActive !== undefined) updates.isActive = isActive;
      if (priceSurchargePercent !== undefined) {
        const pct = Math.max(0, Math.min(200, Math.round(Number(priceSurchargePercent) || 0)));
        updates.priceSurchargePercent = pct;
      }
      const zone = await storage.updateServiceZone(req.params.id, companyId, updates);
      res.json(zone);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/service-zones/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const zones = await storage.getServiceZones(companyId);
      const existing = zones.find(z => z.id === req.params.id);
      if (!existing) return res.status(404).json({ error: "Service zone not found" });
      await storage.deleteServiceZone(req.params.id, companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  // ================ Vacation Hold Routes ================

  app.get("/api/service-plans/:id/vacation-holds", isAuthenticated, async (req: Request, res: Response) => {
    try {
      await getCompanyContext(req);
      const holds = await storage.getVacationHolds(req.params.id);
      res.json(holds);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/service-plans/:id/vacation-holds", isAuthenticated, async (req: Request, res: Response) => {
    try {
      await getCompanyContext(req);
      const parsed = insertVacationHoldSchema.parse({ ...req.body, servicePlanId: req.params.id });
      const hold = await storage.createVacationHold(parsed);
      res.status(201).json(hold);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/vacation-holds/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      await storage.deleteVacationHold(req.params.id, companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  // ================ Visit Routes ================

  app.get("/api/visits/today", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role, userId } = await getCompanyContext(req);
      const dateParam = req.query.date as string | undefined;
      const targetDate = dateParam || new Date().toISOString().split("T")[0];
      let visitsList = await storage.getVisits(companyId, { date: targetDate });

      const isTech = role === "tech";
      const companyRoutes = await storage.getRoutes(companyId);
      const routeMap = new Map(companyRoutes.map(r => [r.id, r]));

      if (isTech) {
        const techRouteIds = new Set(companyRoutes.filter(r => r.technicianId === userId).map(r => r.id));
        visitsList = visitsList.filter(v => v.routeId && techRouteIds.has(v.routeId));
      }

      const enriched = await Promise.all(visitsList.map(async (v) => {
        const plan = v.servicePlanId ? await storage.getServicePlan(v.servicePlanId, companyId) : null;
        const addOns = plan ? await storage.getServicePlanAddOns(plan.id) : [];
        const prop = await storage.getProperty(v.propertyId, companyId);
        const contact = plan ? await storage.getContact(plan.contactId, companyId) : null;
        const route = v.routeId ? routeMap.get(v.routeId) : null;
        return {
          ...v,
          stopOrder: plan?.stopOrder ?? 999,
          routeName: route?.name ?? null,
          routeColor: route?.color ?? null,
          servicePlanName: plan?.serviceName || (plan?.frequency ? `${plan.frequency} service` : null),
          addOns: addOns.filter(a => a.isActive).map(a => ({ name: a.name, price: a.price })),
          property: prop ? {
            streetAddress: prop.streetAddress,
            city: prop.city,
            state: prop.state,
            gateCode: prop.gateCode,
            specialInstructions: prop.specialInstructions,
            measuredYardSqft: prop.measuredYardSqft,
            lotSize: prop.lotSize,
            numberOfDogs: prop.numberOfDogs,
            hasDangerousDog: prop.hasDangerousDog,
            dangerousDogNotes: prop.dangerousDogNotes,
          } : null,
          contact: contact ? {
            id: contact.id,
            firstName: contact.firstName,
            lastName: contact.lastName,
            phone: contact.phone,
          } : null,
        };
      }));

      enriched.sort((a, b) => {
        const routeA = a.routeName ?? "";
        const routeB = b.routeName ?? "";
        if (routeA !== routeB) return routeA.localeCompare(routeB);
        return (a.stopOrder ?? 999) - (b.stopOrder ?? 999);
      });

      res.json(enriched);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/visits/range", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const start = req.query.start as string;
      const end = req.query.end as string;
      if (!start || !end) return res.status(400).json({ error: "start and end query params required" });
      const visitsList = await storage.getVisitsForDateRange(companyId, start, end);
      res.json(visitsList);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/visits", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const filters: { date?: string; routeId?: string; status?: string } = {};
      if (req.query.date) filters.date = req.query.date as string;
      if (req.query.routeId) filters.routeId = req.query.routeId as string;
      if (req.query.status) filters.status = req.query.status as string;
      const visitsList = await storage.getVisits(companyId, filters);
      res.json(visitsList);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/visits/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const visit = await storage.getVisit(req.params.id, companyId);
      if (!visit) return res.status(404).json({ error: "Visit not found" });
      res.json(visit);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/visits", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const parsed = insertVisitSchema.parse({ ...req.body, companyId });
      const visit = await storage.createVisit(parsed);
      res.status(201).json(visit);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/visits/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId, role } = await getCompanyContext(req);
      const existing = await storage.getVisit(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Visit not found" });

      if (role === "tech") {
        if (!existing.routeId) {
          return res.status(403).json({ error: "Visit has no assigned route" });
        }
        const route = await storage.getRoute(existing.routeId, companyId);
        if (!route || route.technicianId !== userId) {
          return res.status(403).json({ error: "You are not assigned to this visit's route" });
        }
      }

      const validVisitStatuses = ["scheduled", "in_progress", "completed", "skipped", "cancelled"];
      if (req.body.status && !validVisitStatuses.includes(req.body.status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${validVisitStatuses.join(", ")}` });
      }
      const allowedTransitions: Record<string, string[]> = {
        scheduled: ["in_progress", "completed", "skipped", "cancelled"],
        in_progress: ["completed", "skipped", "cancelled"],
        completed: ["scheduled"],
        skipped: ["scheduled"],
        cancelled: ["scheduled"],
      };
      if (req.body.status && req.body.status !== existing.status) {
        const allowed = allowedTransitions[existing.status] || [];
        if (!allowed.includes(req.body.status)) {
          return res.status(400).json({ error: `Cannot transition from '${existing.status}' to '${req.body.status}'` });
        }
      }
      const allowedFields = ["status", "scheduledDate", "routeId", "startedAt", "completedAt",
        "proofOfServicePhoto", "proofOfServicePhotoBefore", "gateClosedPhoto", "extraPhotos", "technicianNotes"];
      const updates: any = {};
      for (const key of allowedFields) { if (req.body[key] !== undefined) updates[key] = req.body[key]; }
      if (req.body.status === "completed") {
        updates.completedBy = userId;
      }
      const timestampFields = ["startedAt", "completedAt"];
      for (const field of timestampFields) {
        if (field in updates && updates[field] !== null) {
          updates[field] = new Date(updates[field]);
        }
      }
      const visit = await storage.updateVisit(req.params.id, companyId, updates);

      if (req.body.status === "completed" && existing.status !== "completed") {
        try {
          const plan = await storage.getServicePlan(visit.servicePlanId, companyId);
          if (plan) {
            const contact = await storage.getContact(plan.contactId, companyId);
            if (contact && contact.autoInvoiceEnabled !== false && contact.invoiceTiming === "after_service" && contact.invoiceFrequency === "per_service") {
              const alreadyInvoiced = await storage.isVisitInvoiced(visit.id);
              if (!alreadyInvoiced) {
                const invoiceNumber = await storage.getNextInvoiceNumber(companyId);
                const planMap = new Map([[plan.id, plan]]);
                const lineItems = await buildVisitLineItemsWithAddOns([visit], planMap);
                const subtotal = lineItems.reduce((sum, li) => sum + parseFloat(li.total), 0);
                const autoInvoice = await storage.createInvoiceWithLineItems({
                  companyId,
                  contactId: plan.contactId,
                  invoiceNumber,
                  dueDate: new Date().toISOString().split("T")[0],
                  subtotal: subtotal.toFixed(2),
                  tax: "0",
                  total: subtotal.toFixed(2),
                  status: "draft",
                  autoGenerated: true,
                  paymentAttempts: 0,
                }, lineItems);
                await storage.updateVisit(visit.id, companyId, { invoiceId: autoInvoice.id });
              }
            }
          }
        } catch (autoErr) {
          console.error("Auto-invoice generation failed:", autoErr);
        }
        notify(companyId, "visit_completed", "Visit Completed", `Visit on ${visit.scheduledDate} has been marked as completed.`, `/scheduling`);
      }

      res.json(visit);
    } catch (err) { handleError(res, err); }
  });

  const onMyWayCooldowns = new Map<string, number>();

  app.post("/api/visits/:id/on-my-way", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId, role } = await getCompanyContext(req);
      const visit = await storage.getVisit(req.params.id, companyId);
      if (!visit) return res.status(404).json({ error: "Visit not found" });

      if (role === "tech") {
        if (!visit.routeId) return res.status(403).json({ error: "Visit has no assigned route" });
        const route = await storage.getRoute(visit.routeId, companyId);
        if (!route || route.technicianId !== userId) return res.status(403).json({ error: "You are not assigned to this visit's route" });
      }

      const lat = Number(req.body.latitude);
      const lon = Number(req.body.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return res.status(400).json({ error: "Valid latitude and longitude are required" });
      }

      const cooldownKey = `${companyId}:${req.params.id}`;
      const lastSent = onMyWayCooldowns.get(cooldownKey);
      if (lastSent && Date.now() - lastSent < 5 * 60 * 1000) {
        const waitSec = Math.ceil((5 * 60 * 1000 - (Date.now() - lastSent)) / 1000);
        return res.status(429).json({ error: `Please wait ${waitSec} seconds before sending another on-my-way SMS for this stop` });
      }

      const plan = await storage.getServicePlan(visit.servicePlanId, companyId);
      if (!plan) return res.status(404).json({ error: "Service plan not found" });

      const contact = await storage.getContact(plan.contactId, companyId);
      if (!contact?.phone) return res.status(400).json({ error: "Customer has no phone number" });

      const property = await storage.getProperty(visit.propertyId, companyId);
      if (!property) return res.status(404).json({ error: "Property not found" });

      const destLat = parseFloat(String(property.latitude));
      const destLon = parseFloat(String(property.longitude));
      if (!Number.isFinite(destLat) || !Number.isFinite(destLon)) return res.status(400).json({ error: "Property is not geocoded" });

      const company = await storage.getCompany(companyId);
      const companyName = company?.name || "Your service provider";

      let travelMinutes = 10;
      const mapbox = await fetchMapboxDirections([
        { longitude: lon, latitude: lat },
        { longitude: destLon, latitude: destLat },
      ]);
      if (mapbox) {
        travelMinutes = mapbox.duration;
      } else {
        const miles = haversineDistance(lat, lon, destLat, destLon);
        travelMinutes = (miles / 25) * 60;
      }

      const roundedMinutes = Math.max(5, Math.ceil(travelMinutes / 5) * 5);

      const smsReady = await isSmsConfiguredForCompany(companyId);
      if (!smsReady) return res.status(503).json({ error: "SMS is not configured" });

      const etaMsg = `Hi ${contact.firstName}, ${companyName} is on the way! Estimated arrival in about ${roundedMinutes} minutes. Please ensure your yard is accessible and any dogs are inside. See you soon!`;

      const smsResult = await sendSmsForCompany({ to: contact.phone, body: etaMsg, companyId, contactId: contact.id });
      if (!smsResult.success) return res.status(500).json({ error: smsResult.error || "Failed to send SMS" });

      onMyWayCooldowns.set(cooldownKey, Date.now());

      try {
        const fromPhone = await getFromPhoneForCompany(companyId);
        await storage.createMessage({
          companyId,
          contactId: contact.id,
          channel: "sms",
          direction: "outbound",
          status: "sent",
          fromAddress: fromPhone,
          toAddress: contact.phone,
          body: etaMsg,
          externalId: smsResult.messageSid,
        });
      } catch (logErr) {
        console.error("On-my-way message logging failed (SMS was sent):", logErr);
      }

      res.json({ sent: true, etaMinutes: roundedMinutes, contactName: `${contact.firstName} ${contact.lastName}` });
    } catch (err) { handleError(res, err); }
  });

  const customSmsCooldowns = new Map<string, number>();
  app.post("/api/visits/:id/send-custom-sms", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId, role } = await getCompanyContext(req);
      const visit = await storage.getVisit(req.params.id, companyId);
      if (!visit) return res.status(404).json({ error: "Visit not found" });

      if (role === "tech") {
        if (!visit.routeId) return res.status(403).json({ error: "Visit has no assigned route" });
        const route = await storage.getRoute(visit.routeId, companyId);
        if (!route || route.technicianId !== userId) {
          return res.status(403).json({ error: "You are not assigned to this visit's route" });
        }
      }

      if (typeof req.body.message !== "string") {
        return res.status(400).json({ error: "Message must be a string" });
      }
      const messageBody = req.body.message.trim();
      if (!messageBody || messageBody.length > 1000) {
        return res.status(400).json({ error: "Message is required and must be under 1000 characters" });
      }

      const cooldownKey = `${companyId}:${visit.id}`;
      const lastSent = customSmsCooldowns.get(cooldownKey);
      if (lastSent && Date.now() - lastSent < 5 * 60 * 1000) {
        const secsLeft = Math.ceil((5 * 60 * 1000 - (Date.now() - lastSent)) / 1000);
        return res.status(429).json({ error: `Please wait ${secsLeft}s before sending another message for this visit` });
      }

      const plan = await storage.getServicePlan(visit.servicePlanId, companyId);
      if (!plan) return res.status(404).json({ error: "Service plan not found" });

      const contact = await storage.getContact(plan.contactId, companyId);
      if (!contact?.phone) return res.status(400).json({ error: "Customer has no phone number on file" });

      const smsReady = await isSmsConfiguredForCompany(companyId);
      if (!smsReady) return res.status(503).json({ error: "SMS is not configured for your company" });

      const smsResult = await sendSmsForCompany({ to: contact.phone, body: messageBody, companyId, contactId: contact.id });
      if (!smsResult.success) return res.status(500).json({ error: smsResult.error || "Failed to send SMS" });

      customSmsCooldowns.set(cooldownKey, Date.now());

      try {
        const fromPhone = await getFromPhoneForCompany(companyId);
        await storage.createMessage({
          companyId,
          contactId: contact.id,
          channel: "sms",
          direction: "outbound",
          status: "sent",
          fromAddress: fromPhone,
          toAddress: contact.phone,
          body: messageBody,
          externalId: smsResult.messageSid,
        });
      } catch (logErr) {
        console.error("Custom visit SMS message logging failed (SMS was sent):", logErr);
      }

      res.json({ sent: true, contactName: `${contact.firstName} ${contact.lastName}` });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/visits/:id/complete-notify", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId, role } = await getCompanyContext(req);
      const existing = await storage.getVisit(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Visit not found" });

      if (role === "tech") {
        if (!existing.routeId) {
          return res.status(403).json({ error: "Visit has no assigned route" });
        }
        const route = await storage.getRoute(existing.routeId, companyId);
        if (!route || route.technicianId !== userId) {
          return res.status(403).json({ error: "You are not assigned to this visit's route" });
        }
      }

      if (existing.status === "completed") return res.json({ visit: existing, completionSms: null, etaSms: null, alreadyCompleted: true });
      if (existing.status !== "in_progress") {
        return res.status(400).json({ error: `Cannot complete visit from '${existing.status}' status. Visit must be started first.` });
      }

      const { gateClosedPhoto, extraPhotos, technicianNotes } = req.body;
      if (!gateClosedPhoto || typeof gateClosedPhoto !== "string") {
        return res.status(400).json({ error: "gateClosedPhoto is required" });
      }
      if (extraPhotos && !Array.isArray(extraPhotos)) {
        return res.status(400).json({ error: "extraPhotos must be an array of strings" });
      }

      const visit = await storage.updateVisit(req.params.id, companyId, {
        status: "completed",
        completedAt: new Date(),
        completedBy: userId,
        gateClosedPhoto: gateClosedPhoto || null,
        extraPhotos: extraPhotos || null,
        proofOfServicePhoto: gateClosedPhoto || existing.proofOfServicePhoto,
        technicianNotes: technicianNotes || existing.technicianNotes,
      });

      const plan = await storage.getServicePlan(visit.servicePlanId, companyId);
      if (!plan) return res.json({ visit, completionSms: null, etaSms: null });

      const contact = await storage.getContact(plan.contactId, companyId);
      const company = await storage.getCompany(companyId);
      if (!contact || !company) return res.json({ visit, completionSms: null, etaSms: null });

      if (contact.autoInvoiceEnabled !== false && contact.invoiceTiming === "after_service" && contact.invoiceFrequency === "per_service") {
        try {
          const alreadyInvoiced = await storage.isVisitInvoiced(visit.id);
          if (!alreadyInvoiced) {
            const invoiceNumber = await storage.getNextInvoiceNumber(companyId);
            const planMap = new Map([[plan.id, plan]]);
            const lineItems = await buildVisitLineItemsWithAddOns([visit], planMap);
            const subtotal = lineItems.reduce((sum, li) => sum + parseFloat(li.total), 0);
            const autoInv = await storage.createInvoiceWithLineItems({
              companyId,
              contactId: plan.contactId,
              invoiceNumber,
              dueDate: new Date().toISOString().split("T")[0],
              subtotal: subtotal.toFixed(2),
              tax: "0",
              total: subtotal.toFixed(2),
              status: "draft",
              autoGenerated: true,
              paymentAttempts: 0,
            }, lineItems);
            await storage.updateVisit(visit.id, companyId, { invoiceId: autoInv.id });
          }
        } catch (autoErr) {
          console.error("Auto-invoice generation failed:", autoErr);
        }
      }

      notify(companyId, "visit_completed", "Visit Completed", `Visit on ${visit.scheduledDate} has been marked as completed.`, `/scheduling`);

      let completionSmsResult: any = null;
      let etaSmsResult: any = null;

      const appBaseUrl = `https://${req.get("host")}`;
      const gatePhotoFullUrl = gateClosedPhoto ? `${appBaseUrl}${gateClosedPhoto}` : undefined;

      const completionSmsReady = await isSmsConfiguredForCompany(companyId);
      if (contact.phone && completionSmsReady) {
        const completionMsg = `Hi ${contact.firstName}. ${company.name} just finished your poop scoop service. Here is your gate closed image. Let us know if there is anything we can do.`;
        completionSmsResult = await sendSmsForCompany({
          to: contact.phone,
          body: completionMsg,
          mediaUrl: gatePhotoFullUrl,
          companyId,
          contactId: contact.id,
        });

        if (completionSmsResult.success) {
          const completionFrom = await getFromPhoneForCompany(companyId);
          await storage.createMessage({
            companyId,
            contactId: contact.id,
            channel: "sms",
            direction: "outbound",
            status: "sent",
            fromAddress: completionFrom,
            toAddress: contact.phone,
            body: completionMsg,
            externalId: completionSmsResult.messageSid,
          });
        }
      }

      if (visit.routeId) {
        try {
          const allPlansOnRoute = await storage.getServicePlans(companyId, { routeId: visit.routeId, isActive: true });
          const sorted = allPlansOnRoute.sort((a, b) => a.stopOrder - b.stopOrder);
          const currentIdx = sorted.findIndex(sp => sp.id === visit.servicePlanId);

          if (currentIdx >= 0) {
            const today = new Date().toISOString().split("T")[0];
            const todayVisits = await storage.getVisits(companyId, { date: today });

            let nextPlan = null;
            let nextVisit = null;
            for (let i = currentIdx + 1; i < sorted.length; i++) {
              const candidatePlan = sorted[i];
              const candidateVisit = todayVisits.find(v => v.servicePlanId === candidatePlan.id && (v.status === "scheduled" || v.status === "in_progress"));
              if (candidateVisit) {
                nextPlan = candidatePlan;
                nextVisit = candidateVisit;
                break;
              }
            }

            if (nextVisit && nextPlan) {
              const nextContact = await storage.getContact(nextPlan.contactId, companyId);
              const currentProperty = await storage.getProperty(visit.propertyId, companyId);
              const nextProperty = await storage.getProperty(nextVisit.propertyId, companyId);

              const nextSmsReady = await isSmsConfiguredForCompany(companyId);
              if (nextContact?.phone && currentProperty && nextProperty && nextSmsReady) {
                let travelMinutes = 10;

                const curLat = currentProperty.latitude ? parseFloat(currentProperty.latitude) : null;
                const curLon = currentProperty.longitude ? parseFloat(currentProperty.longitude) : null;
                const nxtLat = nextProperty.latitude ? parseFloat(nextProperty.latitude) : null;
                const nxtLon = nextProperty.longitude ? parseFloat(nextProperty.longitude) : null;

                if (curLat && curLon && nxtLat && nxtLon) {
                  const mapbox = await fetchMapboxDirections([
                    { longitude: curLon, latitude: curLat },
                    { longitude: nxtLon, latitude: nxtLat },
                  ]);

                  if (mapbox) {
                    travelMinutes = mapbox.duration;
                  } else {
                    const miles = haversineDistance(curLat, curLon, nxtLat, nxtLon);
                    travelMinutes = (miles / 25) * 60;
                  }
                }

                const roundedMinutes = Math.max(5, Math.floor(travelMinutes / 5) * 5);

                const etaMsg = `Hi ${nextContact.firstName}, ${company.name} is on its way to your house for your poop scoop appointment. We'll be there in about ${roundedMinutes} minutes. Please ensure your yard is accessible and any dogs are inside. See you soon!`;

                etaSmsResult = await sendSmsForCompany({
                  to: nextContact.phone,
                  body: etaMsg,
                  companyId,
                  contactId: nextContact.id,
                });

                if (etaSmsResult.success) {
                  const etaFrom = await getFromPhoneForCompany(companyId);
                  await storage.createMessage({
                    companyId,
                    contactId: nextContact.id,
                    channel: "sms",
                    direction: "outbound",
                    status: "sent",
                    fromAddress: etaFrom,
                    toAddress: nextContact.phone,
                    body: etaMsg,
                    externalId: etaSmsResult.messageSid,
                  });
                }
              }
            }
          }
        } catch (etaErr) {
          console.error("ETA notification failed:", etaErr);
        }
      }

      res.json({
        visit,
        completionSms: completionSmsResult,
        etaSms: etaSmsResult,
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/visits/generate", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { startDate, endDate } = req.body;
      if (!startDate || !endDate) {
        return res.status(400).json({ error: "startDate and endDate are required" });
      }

      const allPlans = await storage.getServicePlans(companyId, { isActive: true });
      const plans = allPlans.filter(p => !p.pausedAt);
      const existingVisits = await storage.getVisitsForDateRange(companyId, startDate, endDate);
      const existingKeys = new Set(
        existingVisits.map((v) => `${v.servicePlanId}_${v.scheduledDate}`)
      );

      const planIds = plans.map(p => p.id);
      const allHolds = await storage.getVacationHoldsForPlans(planIds);
      const holdsByPlan = new Map<string, typeof allHolds>();
      for (const hold of allHolds) {
        const existing = holdsByPlan.get(hold.servicePlanId) || [];
        existing.push(hold);
        holdsByPlan.set(hold.servicePlanId, existing);
      }

      const dayMap: Record<string, number> = {
        monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
        friday: 5, saturday: 6, sunday: 0,
      };

      const created: any[] = [];
      const start = new Date(startDate + "T00:00:00Z");
      const end = new Date(endDate + "T00:00:00Z");

      for (const plan of plans) {
        if (!plan.dayOfWeek) continue;
        const targetDay = dayMap[plan.dayOfWeek];
        if (targetDay === undefined) continue;

        const planStart = plan.startDate ? new Date(plan.startDate + "T00:00:00Z") : start;
        const planEnd = plan.endDate ? new Date(plan.endDate + "T00:00:00Z") : end;
        const effectiveStart = planStart > start ? planStart : start;
        const effectiveEnd = planEnd < end ? planEnd : end;

        const planHolds = holdsByPlan.get(plan.id) || [];

        const current = new Date(effectiveStart);
        while (current <= effectiveEnd) {
          if (current.getUTCDay() === targetDay) {
            const dateStr = current.toISOString().split("T")[0];
            const key = `${plan.id}_${dateStr}`;

            const inVacation = planHolds.some(h => dateStr >= h.startDate && dateStr <= h.endDate);

            if (!existingKeys.has(key) && !inVacation) {
              let shouldGenerate = true;

              if (plan.frequency === "biweekly") {
                const planStartDate = new Date(plan.startDate + "T00:00:00Z");
                const diffMs = current.getTime() - planStartDate.getTime();
                const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
                const diffWeeks = Math.floor(diffDays / 7);
                if (diffWeeks % 2 !== 0) shouldGenerate = false;
              } else if (plan.frequency === "monthly") {
                const planStartDate = new Date(plan.startDate + "T00:00:00Z");
                if (current.getUTCMonth() === planStartDate.getUTCMonth() && current.getUTCFullYear() === planStartDate.getUTCFullYear()) {
                  shouldGenerate = true;
                } else {
                  const firstOfMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
                  let firstTargetDay = new Date(firstOfMonth);
                  while (firstTargetDay.getUTCDay() !== targetDay) {
                    firstTargetDay.setUTCDate(firstTargetDay.getUTCDate() + 1);
                  }
                  if (current.getTime() !== firstTargetDay.getTime()) shouldGenerate = false;
                }
              } else if (plan.frequency === "onetime") {
                if (dateStr !== plan.startDate) {
                  shouldGenerate = false;
                }
              }

              if (shouldGenerate) {
                const visit = await storage.createVisit({
                  companyId,
                  servicePlanId: plan.id,
                  propertyId: plan.propertyId,
                  routeId: plan.routeId || null,
                  scheduledDate: dateStr,
                  status: "scheduled",
                });
                created.push(visit);
                existingKeys.add(key);
              }
            }

            if (plan.frequency === "weekly" || plan.frequency === "biweekly") {
              current.setUTCDate(current.getUTCDate() + 7);
              continue;
            }
          }
          current.setUTCDate(current.getUTCDate() + 1);
        }
      }

      res.json({ generated: created.length, visits: created });
    } catch (err) { handleError(res, err); }
  });

  // ================ Invoice Routes ================

  app.get("/api/invoices", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const filters: { contactId?: string; status?: string } = {};
      if (req.query.contactId) filters.contactId = req.query.contactId as string;
      if (req.query.status) filters.status = req.query.status as string;
      const invoicesList = await storage.getInvoices(companyId, filters);
      res.json(invoicesList);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/invoices/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const invoice = await storage.getInvoice(req.params.id, companyId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      const lineItems = await storage.getInvoiceLineItems(invoice.id);
      res.json({ ...invoice, lineItems });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/invoices", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { lineItems, taxRate, discountType, discountValue, ...invoiceData } = req.body;

      if (!invoiceData.contactId || !invoiceData.dueDate) {
        return res.status(400).json({ error: "contactId and dueDate are required" });
      }

      const contact = await storage.getContact(invoiceData.contactId, companyId);
      if (!contact) return res.status(400).json({ error: "Contact not found in your company" });

      if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
        return res.status(400).json({ error: "At least one line item is required" });
      }

      const invoiceNumber = await storage.getNextInvoiceNumber(companyId);

      let subtotal = 0;
      const processedLineItems: any[] = [];
      if (lineItems && Array.isArray(lineItems)) {
        for (const item of lineItems) {
          const qty = parseInt(item.quantity) || 1;
          const unitPrice = parseFloat(item.unitPrice) || 0;
          const lineTotal = qty * unitPrice;
          subtotal += lineTotal;
          processedLineItems.push({
            ...item,
            quantity: qty,
            unitPrice: unitPrice.toFixed(2),
            total: lineTotal.toFixed(2),
          });
        }
      }

      const parsedTaxRate = parseFloat(taxRate) || 0;
      const parsedDiscountValue = parseFloat(discountValue) || 0;
      let discountAmount = 0;
      if (discountType === "percent") {
        discountAmount = subtotal * (parsedDiscountValue / 100);
      } else if (discountType === "amount") {
        discountAmount = parsedDiscountValue;
      }
      const afterDiscount = Math.max(0, subtotal - discountAmount);
      const taxAmount = afterDiscount * (parsedTaxRate / 100);
      const total = afterDiscount + taxAmount;

      const parsed = insertInvoiceSchema.parse({
        ...invoiceData,
        companyId,
        invoiceNumber,
        subtotal: subtotal.toFixed(2),
        taxRate: parsedTaxRate.toFixed(2),
        tax: taxAmount.toFixed(2),
        discountType: discountType || null,
        discountValue: parsedDiscountValue.toFixed(2),
        discountAmount: discountAmount.toFixed(2),
        total: total.toFixed(2),
      });
      const invoice = await storage.createInvoice(parsed);

      const createdLineItems = [];
      for (const item of processedLineItems) {
        const parsedItem = insertInvoiceLineItemSchema.parse({ ...item, invoiceId: invoice.id });
        const lineItem = await storage.createInvoiceLineItem(parsedItem);
        createdLineItems.push(lineItem);
      }

      const visitIdsToMark = createdLineItems
        .map((li: any) => li.visitId)
        .filter((vid: string | null | undefined) => !!vid);
      if (visitIdsToMark.length > 0) {
        for (const vid of visitIdsToMark) {
          try {
            await storage.updateVisit(vid, companyId, { invoiceId: invoice.id } as any);
          } catch (_e) {}
        }
      }

      qboAutoSync(companyId, invoice.id, "invoice");
      const { userId: auditUserId } = await getCompanyContext(req);
      auditLog(companyId, auditUserId, "invoice", invoice.id, "create", { new: { invoiceNumber: invoice.invoiceNumber, total: invoice.total, contactId: invoice.contactId } }, req.ip || undefined);
      res.status(201).json({ ...invoice, lineItems: createdLineItems });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/invoices/generate", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { contactId, startDate, endDate, mode } = req.body;
      if (!contactId || !startDate || !endDate) {
        return res.status(400).json({ error: "contactId, startDate, and endDate required" });
      }
      const contact = await storage.getContact(contactId, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      let billableVisits: any[] = [];
      if (mode === "completed" || contact.invoiceTiming === "after_service") {
        billableVisits = await storage.getUninvoicedCompletedVisits(companyId, contactId, startDate, endDate);
      } else {
        billableVisits = await storage.getScheduledVisitsForRange(companyId, contactId, startDate, endDate);
      }

      if (billableVisits.length === 0) {
        return res.json({ message: "No billable visits found", invoice: null });
      }

      const plans = await storage.getServicePlans(companyId, { contactId });
      const planMap = new Map(plans.map(p => [p.id, p]));

      const lineItems = await buildVisitLineItemsWithAddOns(billableVisits, planMap);

      const subtotal = lineItems.reduce((sum, li) => sum + parseFloat(li.total), 0);
      const invoiceNumber = await storage.getNextInvoiceNumber(companyId);
      const invoice = await storage.createInvoiceWithLineItems({
        companyId,
        contactId,
        invoiceNumber,
        dueDate: endDate,
        subtotal: subtotal.toFixed(2),
        tax: "0",
        total: subtotal.toFixed(2),
        status: "draft",
        autoGenerated: true,
        paymentAttempts: 0,
      }, lineItems);

      for (const v of billableVisits) {
        await storage.updateVisit(v.id, companyId, { invoiceId: invoice.id });
      }

      qboAutoSync(companyId, invoice.id, "invoice");
      const { userId: auditUid } = await getCompanyContext(req);
      auditLog(companyId, auditUid, "invoice", invoice.id, "create", { new: { invoiceNumber: invoice.invoiceNumber, total: invoice.total, contactId, autoGenerated: true } }, req.ip || undefined);
      const items = await storage.getInvoiceLineItems(invoice.id);
      res.status(201).json({ ...invoice, lineItems: items });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/company/uninvoiced-summary", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const summary = await storage.getUninvoicedSummary(companyId);
      res.json(summary);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/contacts/:id/visits", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
      const result = await storage.getVisitsForContact(companyId, req.params.id, limit, offset);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/contacts/:id/uninvoiced-visits", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const result = await storage.getUninvoicedVisitsForContact(companyId, req.params.id);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/contacts/:id/unsent-invoices", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const drafts = await storage.getInvoices(companyId, { contactId: req.params.id, status: "draft" });
      const result = await Promise.all(drafts.map(async (inv) => {
        const items = await storage.getInvoiceLineItems(inv.id);
        return { ...inv, lineItems: items };
      }));
      res.json({ invoices: result });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/invoices/consolidate", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const { contactId, draftInvoiceIds, lineItems: submittedItems, dueDate, discountType, discountValue, notes } = req.body;
      if (!contactId || !draftInvoiceIds || !Array.isArray(draftInvoiceIds) || draftInvoiceIds.length === 0) {
        return res.status(400).json({ error: "contactId and draftInvoiceIds array required" });
      }
      if (!submittedItems || !Array.isArray(submittedItems) || submittedItems.length === 0) {
        return res.status(400).json({ error: "lineItems array required" });
      }
      const contact = await storage.getContact(contactId, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const voidedIds: string[] = [];
      for (const draftId of draftInvoiceIds) {
        const draftInv = await storage.getInvoice(draftId, companyId);
        if (!draftInv || draftInv.contactId !== contactId || draftInv.status !== "draft") continue;
        voidedIds.push(draftId);
      }

      const allLineItems = submittedItems.map((mi: any) => {
        const qty = parseInt(mi.quantity) || 1;
        const price = parseFloat(mi.unitPrice || "0");
        return {
          description: mi.description || "",
          quantity: qty,
          unitPrice: price.toFixed(2),
          total: (qty * price).toFixed(2),
          visitId: mi.visitId ?? undefined,
        };
      });

      let subtotal = allLineItems.reduce((sum: number, item: any) => sum + parseFloat(item.total), 0);
      let totalAmount = subtotal;
      const discVal = parseFloat(discountValue || "0");
      const discType = (discountType === "percent" || discountType === "percentage") ? "percent"
        : (discountType === "amount" || discountType === "fixed") ? "amount"
        : null;
      if (discType === "percent" && discVal > 0) {
        totalAmount = subtotal * (1 - discVal / 100);
      } else if (discType === "amount" && discVal > 0) {
        totalAmount = subtotal - discVal;
      }
      if (totalAmount < 0) totalAmount = 0;

      const invoiceNumber = await storage.getNextInvoiceNumber(companyId);
      const dueDateStr = dueDate || (() => {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        return d.toISOString().split("T")[0];
      })();

      const invoice = await storage.createInvoiceWithLineItems({
        companyId,
        contactId,
        invoiceNumber,
        dueDate: dueDateStr,
        subtotal: subtotal.toFixed(2),
        tax: "0",
        total: totalAmount.toFixed(2),
        status: "draft",
        autoGenerated: false,
        paymentAttempts: 0,
        discountType: discType || undefined,
        discountValue: discVal > 0 ? discVal.toFixed(2) : "0",
        notes: notes || null,
      }, allLineItems);

      const newVisitIds = new Set(allLineItems.filter((i: any) => i.visitId).map((i: any) => i.visitId));

      for (const draftId of voidedIds) {
        await storage.updateInvoice(draftId, companyId, { status: "voided" as any });
        const items = await storage.getInvoiceLineItems(draftId);
        for (const item of items) {
          if (item.visitId && !newVisitIds.has(item.visitId)) {
            await storage.updateVisit(item.visitId, companyId, { invoiceId: null as any });
          }
        }
      }

      for (const visitId of newVisitIds) {
        await storage.updateVisit(visitId as string, companyId, { invoiceId: invoice.id });
      }

      auditLog(companyId, userId, "invoice", invoice.id, "consolidated", { consolidatedFrom: voidedIds, lineItemCount: allLineItems.length });
      res.json(invoice);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/invoices/from-visits", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { contactId, visitIds, dueDate } = req.body;
      if (!contactId || !visitIds || !Array.isArray(visitIds) || visitIds.length === 0) {
        return res.status(400).json({ error: "contactId and visitIds array required" });
      }
      const contact = await storage.getContact(contactId, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const plans = await storage.getServicePlans(companyId, { contactId });
      const planMap = new Map(plans.map(p => [p.id, p]));
      const contactPlanIds = new Set(plans.map(p => p.id));

      const allVisits: Visit[] = [];
      for (const vid of visitIds) {
        const v = await storage.getVisit(vid, companyId);
        if (!v) return res.status(400).json({ error: `Visit ${vid} not found` });
        if (!contactPlanIds.has(v.servicePlanId)) return res.status(400).json({ error: `Visit ${vid} does not belong to this contact` });
        if (v.status !== "completed") return res.status(400).json({ error: `Visit ${vid} is not completed` });
        if (v.invoiceId || await storage.isVisitInvoiced(v.id)) return res.status(400).json({ error: `Visit on ${v.scheduledDate} has already been invoiced` });
        allVisits.push(v);
      }

      if (allVisits.length === 0) {
        return res.status(400).json({ error: "No valid completed visits found" });
      }

      const lineItems = await buildVisitLineItemsWithAddOns(allVisits, planMap);

      const subtotal = lineItems.reduce((sum, item) => sum + parseFloat(item.total), 0);
      const invoiceNumber = await storage.getNextInvoiceNumber(companyId);
      const dueDateStr = dueDate || (() => {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        return d.toISOString().split("T")[0];
      })();

      const invoice = await storage.createInvoiceWithLineItems({
        companyId,
        contactId,
        invoiceNumber,
        dueDate: dueDateStr,
        subtotal: subtotal.toFixed(2),
        tax: "0",
        total: subtotal.toFixed(2),
        status: "draft",
        autoGenerated: false,
        paymentAttempts: 0,
      }, lineItems);

      for (const visit of allVisits) {
        await storage.updateVisit(visit.id, companyId, { invoiceId: invoice.id });
      }

      qboAutoSync(companyId, invoice.id, "invoice");
      const { userId: auditUid2 } = await getCompanyContext(req);
      auditLog(companyId, auditUid2, "invoice", invoice.id, "create", { new: { invoiceNumber: invoice.invoiceNumber, total: invoice.total, contactId, visitCount: allVisits.length } }, req.ip || undefined);
      const items = await storage.getInvoiceLineItems(invoice.id);
      res.status(201).json({ ...invoice, lineItems: items });
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/contacts/:id/billing-preferences", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const { invoiceTiming, invoiceFrequency, autoInvoiceEnabled } = req.body;
      const validTimings = ["before_service", "after_service"];
      const validFrequencies = ["per_service", "per_week", "per_month"];
      if (invoiceTiming && !validTimings.includes(invoiceTiming)) {
        return res.status(400).json({ error: "Invalid invoice timing" });
      }
      if (invoiceFrequency && !validFrequencies.includes(invoiceFrequency)) {
        return res.status(400).json({ error: "Invalid invoice frequency" });
      }

      const updated = await storage.updateContact(req.params.id, companyId, {
        ...(invoiceTiming && { invoiceTiming }),
        ...(invoiceFrequency && { invoiceFrequency }),
        ...(typeof autoInvoiceEnabled === "boolean" && { autoInvoiceEnabled }),
      });
      res.json(updated);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/invoices/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getInvoice(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Invoice not found" });

      const { lineItems, status: newStatus, ...invoiceUpdates } = req.body;

      const contentFields = ["dueDate", "notes", "taxRate", "discountType", "discountValue", "subtotal", "total", "tax"];
      const hasContentEdits = (lineItems && Array.isArray(lineItems)) || contentFields.some(f => f in invoiceUpdates);
      const editableStatuses = ["draft", "sent", "pending"];

      if (hasContentEdits && !editableStatuses.includes(existing.status)) {
        return res.status(400).json({ error: "Cannot edit a paid, voided, or failed invoice" });
      }

      if (newStatus) {
        invoiceUpdates.status = newStatus;
      }

      if (lineItems && Array.isArray(lineItems)) {

        await storage.deleteInvoiceLineItems(req.params.id);

        let subtotal = 0;
        for (const item of lineItems) {
          const qty = parseInt(item.quantity) || 1;
          const unitPrice = parseFloat(item.unitPrice) || 0;
          const lineTotal = qty * unitPrice;
          subtotal += lineTotal;
          await storage.createInvoiceLineItem({
            invoiceId: req.params.id,
            description: item.description || "Service",
            quantity: qty,
            unitPrice: unitPrice.toFixed(2),
            total: lineTotal.toFixed(2),
            visitId: item.visitId || null,
            servicePricingId: item.servicePricingId || null,
          });
        }

        const taxRate = parseFloat(invoiceUpdates.taxRate ?? existing.taxRate ?? "0");
        const discountType = invoiceUpdates.discountType ?? existing.discountType;
        const discountVal = Math.abs(parseFloat(invoiceUpdates.discountValue ?? existing.discountValue ?? "0"));
        let discountAmount = 0;
        if (discountType === "percent") {
          discountAmount = subtotal * (discountVal / 100);
        } else if (discountType === "amount") {
          discountAmount = discountVal;
        }
        const afterDiscount = Math.max(0, subtotal - discountAmount);
        const taxAmount = afterDiscount * (taxRate / 100);
        const total = afterDiscount + taxAmount;

        invoiceUpdates.subtotal = subtotal.toFixed(2);
        invoiceUpdates.taxRate = taxRate.toFixed(2);
        invoiceUpdates.tax = taxAmount.toFixed(2);
        invoiceUpdates.discountType = discountType || null;
        invoiceUpdates.discountValue = discountVal.toFixed(2);
        invoiceUpdates.discountAmount = discountAmount.toFixed(2);
        invoiceUpdates.total = total.toFixed(2);
      } else if ("taxRate" in invoiceUpdates || "discountType" in invoiceUpdates || "discountValue" in invoiceUpdates) {
        const subtotal = parseFloat(existing.subtotal ?? "0");
        const taxRate = parseFloat(invoiceUpdates.taxRate ?? existing.taxRate ?? "0");
        const discountType = invoiceUpdates.discountType ?? existing.discountType;
        const discountVal = Math.abs(parseFloat(invoiceUpdates.discountValue ?? existing.discountValue ?? "0"));
        let discountAmount = 0;
        if (discountType === "percent") {
          discountAmount = subtotal * (discountVal / 100);
        } else if (discountType === "amount") {
          discountAmount = discountVal;
        }
        const afterDiscount = Math.max(0, subtotal - discountAmount);
        const taxAmount = afterDiscount * (taxRate / 100);
        const total = afterDiscount + taxAmount;

        invoiceUpdates.taxRate = taxRate.toFixed(2);
        invoiceUpdates.tax = taxAmount.toFixed(2);
        invoiceUpdates.discountType = discountType || null;
        invoiceUpdates.discountValue = discountVal.toFixed(2);
        invoiceUpdates.discountAmount = discountAmount.toFixed(2);
        invoiceUpdates.total = total.toFixed(2);
      }

      const invoice = await storage.updateInvoice(req.params.id, companyId, invoiceUpdates);
      const updatedLineItems = await storage.getInvoiceLineItems(req.params.id);
      qboAutoSync(companyId, invoice.id, "invoice");
      if (invoiceUpdates.status === "paid") {
        qboAutoSync(companyId, invoice.id, "payment");
      }
      const { userId } = await getCompanyContext(req);
      auditLog(companyId, userId, "invoice", req.params.id, "update", { old: { status: existing.status, total: existing.total }, new: { status: invoice.status, total: invoice.total } }, req.ip || undefined);
      res.json({ ...invoice, lineItems: updatedLineItems });
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/invoices/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const invoice = await storage.getInvoice(req.params.id, companyId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.status === "paid") return res.status(400).json({ error: "Cannot delete a paid invoice" });
      await storage.deleteInvoice(req.params.id, companyId);
      const { userId } = await getCompanyContext(req);
      auditLog(companyId, userId, "invoice", req.params.id, "delete", { deleted: { invoiceNumber: invoice.invoiceNumber, total: invoice.total, status: invoice.status } }, req.ip || undefined);
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  // ================ Automation Rule Routes ================

  app.get("/api/automation-rules", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const rules = await storage.getAutomationRules(companyId);
      res.json(rules);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/automation-rules", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const parsed = insertAutomationRuleSchema.parse({ ...req.body, companyId });
      const rule = await storage.createAutomationRule(parsed);
      res.status(201).json(rule);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/automation-rules/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getAutomationRules(companyId);
      if (!existing.find(r => r.id === req.params.id)) return res.status(404).json({ error: "Rule not found" });
      const rule = await storage.updateAutomationRule(req.params.id, companyId, req.body);
      res.json(rule);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/automation-rules/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      await storage.deleteAutomationRule(req.params.id, companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  // ================ API Key Routes ================

  app.get("/api/api-keys", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const keys = await storage.getApiKeys(companyId);
      const masked = keys.map(k => ({
        ...k,
        keyHash: undefined,
        keyPrefix: k.keyPrefix,
        maskedKey: `${k.keyPrefix}...`,
      }));
      res.json(masked);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/api-keys", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const rawKey = crypto.randomBytes(32).toString("hex");
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.substring(0, 8);

      const apiKey = await storage.createApiKey({
        companyId,
        name: req.body.name || "API Key",
        keyHash,
        keyPrefix,
        scopes: req.body.scopes || [],
        isActive: true,
        expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
      } as any);

      const { userId } = await getCompanyContext(req);
      auditLog(companyId, userId, "api_key", apiKey.id, "create", { new: { name: apiKey.name, keyPrefix, scopes: req.body.scopes || [] } }, req.ip || undefined);
      res.status(201).json({ ...apiKey, rawKey });
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/api-keys/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role, userId } = await getCompanyContext(req);
      requireRole(role);
      const existingKeys = await storage.getApiKeys(companyId);
      const existingKey = existingKeys.find(k => k.id === req.params.id);
      await storage.deleteApiKey(req.params.id, companyId);
      auditLog(companyId, userId, "api_key", req.params.id, "delete", { deleted: { name: existingKey?.name, keyPrefix: existingKey?.keyPrefix } }, req.ip || undefined);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  // ================ Retell AI Voice Agent Routes ================

  function verifyRetellApiKey(req: Request, res: Response): boolean {
    const apiKey = req.headers["x-retell-api-key"] || req.query.api_key;
    const expected = process.env.RETELL_API_KEY;
    if (!expected) {
      res.status(503).json({ error: "Retell API key not configured" });
      return false;
    }
    if (apiKey !== expected) {
      res.status(401).json({ error: "Invalid API key" });
      return false;
    }
    return true;
  }

  app.get("/api/retell/tenant-profile", async (req: Request, res: Response) => {
    if (!verifyRetellApiKey(req, res)) return;
    try {
      const to = req.query.to as string;
      if (!to) {
        return res.status(400).json({ error: "Missing 'to' query parameter (phone number)" });
      }

      const company = await storage.getCompanyByPhone(to);
      if (!company) {
        return res.status(404).json({ error: "Tenant not found for this phone number" });
      }

      const servicePricingItems = await storage.getServicePricing(company.id);
      const packages = await storage.getServicePackages(company.id);
      const serviceZones = await storage.getServiceZones(company.id);

      const pricingSummary = company.voiceAgentPricingSummary || servicePricingItems
        .filter(sp => sp.isActive)
        .map(sp => `${sp.name}: $${sp.basePrice}/${sp.unit.replace("per_", "")}`)
        .join("; ") || "Contact us for pricing";

      const packagesSummary = packages
        .filter(p => p.isActive)
        .map(p => `${p.name} (${p.frequency}): $${p.basePrice}`)
        .join("; ");

      const zipRouting: Record<string, string[]> = {};
      for (const zone of serviceZones.filter(z => z.isActive)) {
        if (!zipRouting[zone.zipCode]) zipRouting[zone.zipCode] = [];
        const dayLabel = zone.dayOfWeek.charAt(0).toUpperCase() + zone.dayOfWeek.slice(1);
        if (!zipRouting[zone.zipCode].includes(dayLabel)) {
          zipRouting[zone.zipCode].push(dayLabel);
        }
      }

      const policiesRaw = company.voiceAgentPolicies || "";
      const policies = policiesRaw
        ? policiesRaw.split(/\n+/).map(l => l.trim()).filter(Boolean)
        : [];

      res.json({
        tenantId: company.id,
        businessName: company.name,
        businessPhone: company.phone,
        businessEmail: company.email,
        serviceArea: company.voiceAgentServiceArea || company.address || "",
        zipRouting,
        pricingSummary,
        packages: packagesSummary || undefined,
        policies,
        specialLines: company.voiceAgentSpecialLines || "",
        greeting: company.voiceAgentGreeting || `Thank you for calling ${company.name}! How can I help you today?`,
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/retell/create-lead", async (req: Request, res: Response) => {
    if (!verifyRetellApiKey(req, res)) return;
    try {
      const { tenantId, firstName, lastName, email, phone, street, city, state, zipCode, notes, numberOfDogs } = req.body;
      if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
      if (!firstName) return res.status(400).json({ error: "firstName is required" });

      const company = await storage.getCompany(tenantId);
      if (!company) return res.status(404).json({ error: "Tenant not found" });

      const contact = await storage.createContact({
        companyId: tenantId,
        firstName,
        lastName: lastName || "",
        email: email || null,
        phone: phone || null,
        status: "lead",
        leadSource: "voice_agent",
        notes: notes || null,
      });

      if (street) {
        await createPropertyWithGeocode({
          companyId: tenantId,
          contactId: contact.id,
          streetAddress: street,
          city: city || null,
          state: state || null,
          zipCode: zipCode || null,
          numberOfDogs: numberOfDogs ? parseInt(numberOfDogs) : null,
        });
      }

      notify(tenantId, "new_lead", "New Lead (Voice Agent)", `${firstName} ${lastName || ""} called in and was added as a new lead.`.trim(), `/contacts/${contact.id}`);

      res.status(201).json({
        success: true,
        contactId: contact.id,
        message: `Lead created: ${firstName} ${lastName || ""}`.trim(),
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/retell/lookup-customer", async (req: Request, res: Response) => {
    if (!verifyRetellApiKey(req, res)) return;
    try {
      const { tenantId, phone, email } = req.body;
      if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
      if (!phone && !email) return res.status(400).json({ error: "phone or email is required" });

      const company = await storage.getCompany(tenantId);
      if (!company) return res.status(404).json({ error: "Tenant not found" });

      const allContacts = await storage.getContacts(tenantId);
      let match = null;

      if (phone) {
        const digits = phone.replace(/\D/g, "");
        match = allContacts.find(c => {
          const cDigits = (c.phone || "").replace(/\D/g, "");
          return cDigits.length >= 10 && digits.length >= 10 && digits.endsWith(cDigits.slice(-10));
        });
      }
      if (!match && email) {
        match = allContacts.find(c => c.email?.toLowerCase() === email.toLowerCase());
      }

      if (!match) {
        return res.json({ found: false });
      }

      const properties = await storage.getProperties(tenantId, match.id);
      const servicePlans = await storage.getServicePlans(tenantId, { contactId: match.id, isActive: true });

      res.json({
        found: true,
        customer: {
          id: match.id,
          firstName: match.firstName,
          lastName: match.lastName,
          email: match.email,
          phone: match.phone,
          status: match.status,
          properties: properties.map(p => ({
            address: p.streetAddress,
            city: p.city,
            numberOfDogs: p.numberOfDogs,
          })),
          servicePlans: servicePlans.map(sp => ({
            frequency: sp.frequency,
            dayOfWeek: sp.dayOfWeek,
            price: sp.price,
            isActive: sp.isActive,
          })),
        },
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/retell/log-call", async (req: Request, res: Response) => {
    if (!verifyRetellApiKey(req, res)) return;
    try {
      const { tenantId, contactId, callerPhone, summary, duration, outcome } = req.body;
      if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

      const company = await storage.getCompany(tenantId);
      if (!company) return res.status(404).json({ error: "Tenant not found" });

      if (contactId) {
        const contact = await storage.getContact(tenantId, contactId);
        if (!contact) return res.status(404).json({ error: "Contact not found in this tenant" });

        await storage.createMessage({
          companyId: tenantId,
          contactId,
          channel: "sms",
          direction: "inbound",
          status: "received",
          fromAddress: callerPhone || "voice_agent",
          toAddress: company.phone || "",
          body: `[Voice Agent Call] ${summary || "No summary"} | Duration: ${duration || "unknown"} | Outcome: ${outcome || "unknown"}`,
        });
      }

      notify(tenantId, "new_message", "Voice Agent Call", `Call ${outcome || "completed"}: ${summary || "No summary provided"}`, contactId ? `/contacts/${contactId}` : undefined);

      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/retell/create-booking", async (req: Request, res: Response) => {
    if (!verifyRetellApiKey(req, res)) return;
    try {
      const {
        tenantId, callerName, phone, email, address, zip,
        dogs, yardSize, fenced, serviceType, frequency,
        preferredDayOfWeek, accessNotes, specialInstructions,
      } = req.body;
      if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
      if (!callerName) return res.status(400).json({ error: "callerName is required" });

      const company = await storage.getCompany(tenantId);
      if (!company) return res.status(404).json({ error: "Tenant not found" });

      const nameParts = callerName.trim().split(/\s+/);
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(" ") || "";

      let contact: any = null;
      if (phone || email) {
        const allContacts = await storage.getContacts(tenantId);
        if (phone) {
          const digits = phone.replace(/\D/g, "");
          contact = allContacts.find(c => {
            const cDigits = (c.phone || "").replace(/\D/g, "");
            return cDigits.length >= 10 && digits.length >= 10 && digits.endsWith(cDigits.slice(-10));
          });
        }
        if (!contact && email) {
          contact = allContacts.find(c => c.email?.toLowerCase() === email.toLowerCase());
        }
      }

      if (!contact) {
        contact = await storage.createContact({
          companyId: tenantId,
          firstName,
          lastName,
          email: email || null,
          phone: phone || null,
          status: "lead",
          leadSource: "voice_agent",
          notes: null,
        });
      }

      const bookingNotes = [
        serviceType ? `Service: ${serviceType}` : null,
        frequency ? `Frequency: ${frequency}` : null,
        preferredDayOfWeek ? `Preferred day: ${preferredDayOfWeek}` : null,
        fenced != null ? `Fenced: ${fenced}` : null,
        accessNotes ? `Access: ${accessNotes}` : null,
        specialInstructions ? `Instructions: ${specialInstructions}` : null,
      ].filter(Boolean).join("\n");

      let property = null;
      if (address) {
        property = await createPropertyWithGeocode({
          companyId: tenantId,
          contactId: contact.id,
          streetAddress: address,
          zipCode: zip || null,
          numberOfDogs: dogs ? parseInt(dogs) : null,
          yardSize: yardSize || null,
          specialInstructions: bookingNotes || null,
        });
      }

      await storage.createMessage({
        companyId: tenantId,
        contactId: contact.id,
        channel: "sms",
        direction: "inbound",
        status: "received",
        fromAddress: phone || "voice_agent",
        toAddress: company.phone || "",
        body: `[Voice Agent Booking] ${callerName} requested a booking.\n${bookingNotes}`,
      });

      notify(
        tenantId,
        "new_lead",
        "New Booking Request (Voice Agent)",
        `${callerName} requested a booking via voice agent. Status: pending confirmation.`,
        `/contacts/${contact.id}`
      );

      res.json({
        status: "received",
        contactId: contact.id,
        propertyId: property?.id || null,
        message: "Booking request recorded; team will confirm by email.",
      });
    } catch (err) { handleError(res, err); }
  });

  // ================ Webhook Routes ================

  app.get("/api/webhooks", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const webhooksList = await storage.getWebhooks(companyId);
      res.json(webhooksList);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/webhooks", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const secret = crypto.randomBytes(32).toString("hex");
      const parsed = insertWebhookSchema.parse({ ...req.body, companyId, secret });
      const webhook = await storage.createWebhook(parsed);
      const { userId } = await getCompanyContext(req);
      auditLog(companyId, userId, "webhook", webhook.id, "create", { new: { url: parsed.url, events: parsed.events } }, req.ip || undefined);
      res.status(201).json(webhook);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/webhooks/deliveries", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const limit = parseInt(req.query.limit as string) || 100;
      const deliveries = await storage.getWebhookDeliveriesForCompany(companyId, limit);
      res.json(deliveries);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/webhooks/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const existingWebhooks = await storage.getWebhooks(companyId);
      const existingWh = existingWebhooks.find(w => w.id === req.params.id);
      if (!existingWh) return res.status(404).json({ error: "Webhook not found" });
      const webhook = await storage.updateWebhook(req.params.id, companyId, req.body);
      const { userId } = await getCompanyContext(req);
      auditLog(companyId, userId, "webhook", req.params.id, "update", { old: { url: existingWh.url, isActive: existingWh.isActive }, new: req.body }, req.ip || undefined);
      res.json(webhook);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/webhooks/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const allWebhooks = await storage.getWebhooks(companyId);
      const whToDelete = allWebhooks.find(w => w.id === req.params.id);
      await storage.deleteWebhook(req.params.id, companyId);
      const { userId } = await getCompanyContext(req);
      auditLog(companyId, userId, "webhook", req.params.id, "delete", { deleted: { url: whToDelete?.url, events: whToDelete?.events } }, req.ip || undefined);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/webhooks/:id/deliveries", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const existing = await storage.getWebhooks(companyId);
      if (!existing.find(w => w.id === req.params.id)) return res.status(404).json({ error: "Webhook not found" });
      const limit = parseInt(req.query.limit as string) || 50;
      const deliveries = await storage.getWebhookDeliveries(req.params.id, limit);
      res.json(deliveries);
    } catch (err) { handleError(res, err); }
  });

  // ================ Service Pricing ================
  app.get("/api/pricing", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const category = req.query.category as string | undefined;
      const items = await storage.getServicePricing(companyId, category);
      res.json(items);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/pricing", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const body = { ...req.body, companyId };
      if (body.basePrice !== undefined) body.basePrice = sanitizeDecimal(body.basePrice);
      const parsed = insertServicePricingSchema.parse(body);
      const item = await storage.createServicePricingItem(parsed);
      res.status(201).json(item);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/pricing/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const body = { ...req.body };
      if (body.basePrice !== undefined) body.basePrice = sanitizeDecimal(body.basePrice);
      const parsed = insertServicePricingSchema.partial().parse(body);
      const item = await storage.updateServicePricingItem(req.params.id, companyId, parsed);
      res.json(item);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/pricing/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      await storage.deleteServicePricingItem(req.params.id, companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/pricing/seed", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      await storage.seedDefaultPricing(companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/pricing/generate-from-rules", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);

      const rulesSchema = z.object({
        basePrices: z.object({
          weekly: z.number().min(0),
          biWeekly: z.number().min(0),
          twiceWeekly: z.number().min(0),
        }),
        perDogRule: z.object({
          incrementDogs: z.number().int().min(1),
          surchargeAmount: z.number().min(0),
          maxDogs: z.number().int().min(1).max(20),
        }),
        yardSizeTiers: z.array(z.object({
          upToAcres: z.number().min(0),
          surcharge: z.number().min(0),
        })),
      });

      const rules: PricingRulesConfig = rulesSchema.parse(req.body);

      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      const existingConfig: PricingConfig = { ...DEFAULT_PRICING_CONFIG, ...(company.pricingConfig || {}) };
      await storage.updateCompany(companyId, {
        pricingConfig: { ...existingConfig, pricingRules: rules },
      });

      const existingPricing = await storage.getServicePricing(companyId, "recurring_service");
      const existingByName = new Map<string, typeof existingPricing[0]>();
      for (const item of existingPricing) {
        existingByName.set(item.name, item);
      }

      const frequencies = [
        { key: "weekly", label: "Weekly Scooping", base: rules.basePrices.weekly, unit: "per_week" },
        { key: "twiceWeekly", label: "Twice Weekly Scooping", base: rules.basePrices.twiceWeekly, unit: "per_visit" },
        { key: "biWeekly", label: "Bi-Weekly Scooping", base: rules.basePrices.biWeekly, unit: "per_visit" },
      ];

      let sortOrder = 1;
      const generatedNames = new Set<string>();
      const inc = rules.perDogRule.incrementDogs;

      for (const freq of frequencies) {
        for (let dogs = 1; dogs <= rules.perDogRule.maxDogs; dogs++) {
          const surchargeSteps = Math.floor((dogs - 1) / inc);
          const price = freq.base + surchargeSteps * rules.perDogRule.surchargeAmount;
          const name = `${freq.label} ${dogs} ${dogs === 1 ? "Dog" : "Dogs"}`;
          generatedNames.add(name);

          const existing = existingByName.get(name);
          if (existing) {
            const isOverridden = (existing.metadata as Record<string, unknown>)?.manualOverride === true;
            if (!isOverridden) {
              await storage.updateServicePricingItem(existing.id, companyId, {
                basePrice: price.toFixed(2),
                sortOrder,
                unit: freq.unit,
                metadata: { ...((existing.metadata as Record<string, unknown>) || {}), callForQuote: false, ruleGenerated: true },
              });
            } else {
              await storage.updateServicePricingItem(existing.id, companyId, {
                sortOrder,
              });
            }
          } else {
            await storage.createServicePricingItem({
              companyId,
              category: "recurring_service",
              name,
              description: `${freq.label.replace("Scooping", "").trim()} service for ${dogs} ${dogs === 1 ? "dog" : "dogs"}`,
              basePrice: price.toFixed(2),
              unit: freq.unit,
              sortOrder,
              metadata: { ruleGenerated: true },
            });
          }
          sortOrder++;
        }

        const callName = `${freq.label} ${rules.perDogRule.maxDogs + 1}+ Dogs`;
        generatedNames.add(callName);
        const existingCall = existingByName.get(callName);
        if (existingCall) {
          await storage.updateServicePricingItem(existingCall.id, companyId, {
            sortOrder,
            metadata: { ...((existingCall.metadata as Record<string, unknown>) || {}), callForQuote: true, ruleGenerated: true },
          });
        } else {
          await storage.createServicePricingItem({
            companyId,
            category: "recurring_service",
            name: callName,
            description: `${freq.label.replace("Scooping", "").trim()} service for ${rules.perDogRule.maxDogs + 1}+ dogs - call for quote`,
            basePrice: "0.00",
            unit: freq.unit,
            sortOrder,
            metadata: { callForQuote: true, ruleGenerated: true },
          });
        }
        sortOrder++;
      }

      for (const item of existingPricing) {
        const meta = (item.metadata as Record<string, unknown>) || {};
        if (!generatedNames.has(item.name) && meta.ruleGenerated && !meta.manualOverride) {
          await storage.deleteServicePricingItem(item.id, companyId);
        }
      }

      const allAddOns = await storage.getServicePricing(companyId, "add_on");

      const parseLotAcres = (name: string): number | null => {
        const m = name.match(/Lot Size up to\s+([.\d]+)\s*Acre/i);
        return m ? parseFloat(m[1]) : null;
      };
      const existingLotByAcres = new Map<number, typeof allAddOns[0]>();
      const existingAddOnsByName = new Map<string, typeof allAddOns[0]>();
      for (const a of allAddOns) {
        existingAddOnsByName.set(a.name, a);
        const acres = parseLotAcres(a.name);
        if (acres !== null) existingLotByAcres.set(acres, a);
      }
      const generatedYardAcres = new Set<number>();
      let yardSort = 100;
      for (const tier of rules.yardSizeTiers) {
        const tierName = `Lot Size up to ${tier.upToAcres} Acre`;
        generatedYardAcres.add(tier.upToAcres);
        const existingAddon = existingLotByAcres.get(tier.upToAcres) || existingAddOnsByName.get(tierName);
        if (existingAddon) {
          const isOverridden = (existingAddon.metadata as Record<string, unknown>)?.manualOverride === true;
          if (!isOverridden) {
            await storage.updateServicePricingItem(existingAddon.id, companyId, {
              basePrice: tier.surcharge.toFixed(2),
              sortOrder: yardSort,
              metadata: { ...((existingAddon.metadata as Record<string, unknown>) || {}), ruleGenerated: true },
            });
          }
        } else {
          await storage.createServicePricingItem({
            companyId,
            category: "add_on",
            name: tierName,
            description: tier.surcharge === 0
              ? `No additional charge for lots up to ${tier.upToAcres} acre`
              : `Additional charge for lots up to ${tier.upToAcres} acre`,
            basePrice: tier.surcharge.toFixed(2),
            unit: "per_visit",
            sortOrder: yardSort,
            metadata: { ruleGenerated: true },
          });
        }
        yardSort++;
      }

      for (const addon of allAddOns) {
        const addonMeta = (addon.metadata as Record<string, unknown>) || {};
        const addonAcres = parseLotAcres(addon.name);
        if (
          addonAcres !== null &&
          !generatedYardAcres.has(addonAcres) &&
          addonMeta.ruleGenerated &&
          !addonMeta.manualOverride
        ) {
          await storage.deleteServicePricingItem(addon.id, companyId);
        }
      }

      const updatedPricing = await storage.getServicePricing(companyId, "recurring_service");
      res.json({ success: true, itemsGenerated: generatedNames.size, items: updatedPricing });
    } catch (err) { handleError(res, err); }
  });

  // ================ Service Packages ================
  app.get("/api/packages", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const packages = await storage.getServicePackages(companyId);
      res.json(packages);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/packages", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const parsed = insertServicePackageSchema.parse({ ...req.body, companyId });
      const pkg = await storage.createServicePackage(parsed);
      res.status(201).json(pkg);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/packages/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const parsed = insertServicePackageSchema.partial().parse(req.body);
      const pkg = await storage.updateServicePackage(req.params.id, companyId, parsed);
      res.json(pkg);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/packages/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      await storage.deleteServicePackage(req.params.id, companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/pricing/confirm-and-generate-packages", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const pricing = await storage.getServicePricing(companyId);
      const recurringItems = pricing.filter(
        (p) => p.category === "recurring_service" && p.isActive && !(p.metadata as any)?.callForQuote
      );

      const existingPackages = await storage.getServicePackages(companyId);
      for (const pkg of existingPackages) {
        await storage.deleteServicePackage(pkg.id, companyId);
      }

      const addOns = pricing.filter((p) => p.category === "add_on" && p.isActive);
      const lotAddOn = addOns.find((a) => a.name.toLowerCase().includes("lot size"));
      const wasteAddOn = addOns.find((a) => a.name.toLowerCase().includes("waste"));
      const deodorizingAddOn = addOns.find((a) => a.name.toLowerCase().includes("deodori"));

      const frequencyGroups: Record<string, typeof recurringItems> = {};
      for (const item of recurringItems) {
        const nameLower = item.name.toLowerCase();
        let freq = "weekly";
        if (nameLower.includes("twice")) freq = "twice_weekly";
        else if (nameLower.includes("bi-weekly") || nameLower.includes("biweekly")) freq = "biweekly";
        if (!frequencyGroups[freq]) frequencyGroups[freq] = [];
        frequencyGroups[freq].push(item);
      }

      let sortOrder = 1;
      for (const [freq, items] of Object.entries(frequencyGroups)) {
        const freqLabel = freq === "twice_weekly" ? "Twice Weekly" : freq === "biweekly" ? "Bi-Weekly" : "Weekly";
        const displayFreq = freq === "twice_weekly" ? "weekly" : freq;

        for (const item of items) {
          const includedItems: string[] = [item.name];
          if (lotAddOn) includedItems.push(lotAddOn.name);

          const dogMatch = item.name.match(/(\d+)\+?\s*Dogs?/i);
          const dogCount = dogMatch ? parseInt(dogMatch[1]) : 1;

          let totalPrice = parseFloat(item.basePrice);
          if (freq === "twice_weekly") totalPrice = totalPrice * 2;

          if (dogCount >= 3 && wasteAddOn) {
            includedItems.push(wasteAddOn.name);
            totalPrice += parseFloat(wasteAddOn.basePrice);
          }
          if (dogCount >= 4 && deodorizingAddOn) {
            includedItems.push(deodorizingAddOn.name);
            totalPrice += parseFloat(deodorizingAddOn.basePrice);
          }

          await storage.createServicePackage({
            companyId,
            name: `${freqLabel} - ${dogMatch ? dogMatch[0] : "1 Dog"}`,
            description: `${freqLabel} service for ${dogMatch ? dogMatch[0].toLowerCase() : "1 dog"}`,
            frequency: displayFreq,
            basePrice: totalPrice.toFixed(2),
            includedItems,
            sortOrder: sortOrder++,
          });
        }
      }

      const newPackages = await storage.getServicePackages(companyId);
      res.json({ success: true, packagesCreated: newPackages.length, packages: newPackages });
    } catch (err) { handleError(res, err); }
  });

  // ================ Pricing Calculator ================

  app.get("/api/pricing-config", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      const raw = { ...DEFAULT_PRICING_CONFIG, ...(company.pricingConfig || {}) };
      if (!raw.pricingRules) {
        raw.pricingRules = DEFAULT_PRICING_RULES;
      }
      res.json(raw);
    } catch (err) { handleError(res, err); }
  });

  const pricingRulesSchema = z.object({
    basePrices: z.object({
      weekly: z.number().min(0),
      biWeekly: z.number().min(0),
      twiceWeekly: z.number().min(0),
    }),
    perDogRule: z.object({
      incrementDogs: z.number().int().min(1),
      surchargeAmount: z.number().min(0),
      maxDogs: z.number().int().min(1).max(20),
    }),
    yardSizeTiers: z.array(z.object({
      upToAcres: z.number().min(0),
      surcharge: z.number().min(0),
    })),
  }).optional();

  const pricingConfigSchema = z.object({
    pricingRules: pricingRulesSchema,
    techHourlyWageCents: z.number().min(0).optional(),
    burdenMultiplier: z.number().min(1).max(5).optional(),
    averageGasPriceCentsPerGallon: z.number().min(0).optional(),
    vehicleMPG: z.number().min(0).nullable().optional(),
    vehicleCostPerMileCents: z.number().min(0).optional(),
    baseTimePerTenthAcreMinutes: z.number().min(1).max(120).optional(),
    extraDogMinutesAfterFirst: z.number().min(0).max(60).optional(),
    driveSpeedAverageMph: z.number().min(5).max(80).optional(),
    minimumServiceMinutesFloor: z.number().min(1).max(120).optional(),
    weeklyMultiplier: z.number().min(0.1).max(5).optional(),
    biweeklyMultiplier: z.number().min(0.1).max(5).optional(),
    monthlyMultiplier: z.number().min(0.1).max(5).optional(),
    oneTimeMultiplier: z.number().min(0.1).max(5).optional(),
    difficultyFlat: z.number().min(0.5).max(3).optional(),
    difficultyModerate: z.number().min(0.5).max(3).optional(),
    difficultyDifficult: z.number().min(0.5).max(3).optional(),
    advertisingCents: z.number().min(0).optional(),
    payrollProviderCents: z.number().min(0).optional(),
    benefitsCents: z.number().min(0).optional(),
    insuranceCents: z.number().min(0).optional(),
    softwareCents: z.number().min(0).optional(),
    otherOverheadCents: z.number().min(0).optional(),
    disinfectantCents: z.number().min(0).optional(),
    deodorizerCents: z.number().min(0).optional(),
    bagsCents: z.number().min(0).optional(),
    localMarketAverageWeeklyPriceCents: z.number().min(0).nullable().optional(),
    marketAnchorTolerancePct: z.number().min(0).max(100).optional(),
    targetProfitMarginPct: z.number().min(0).max(90).optional(),
    premiumMarginPct: z.number().min(0).max(90).optional(),
    pricingMode: z.enum(["aggressive", "standard", "premium"]).optional(),
    clusterDiscountPct: z.number().min(0).max(50).optional(),
    clusterDiscountPct2: z.number().min(0).max(50).optional(),
    estimatedMonthlyStops: z.number().min(1).optional(),
  });

  const calcInputSchema = z.object({
    yardSizeAcres: z.number().min(0.001).max(100).optional(),
    yardSizeSqft: z.number().min(0).optional(),
    yardSizeLabel: z.string().optional(),
    dogCount: z.number().int().min(1).max(50).default(1),
    serviceFrequency: z.enum(["weekly", "biweekly", "monthly", "onetime"]).default("weekly"),
    yardDifficulty: z.enum(["flat", "moderate", "difficult"]).default("flat"),
    distanceFromNearestStopMiles: z.number().min(0).max(100).default(1),
    routeStopsPerMile: z.number().min(0).optional(),
    currentPriceCents: z.number().min(0).optional(),
    propertyId: z.string().optional(),
    pricingModeOverride: z.enum(["aggressive", "standard", "premium"]).optional(),
    routeId: z.string().optional(),
  });

  app.put("/api/pricing-config", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      const existing = (company.pricingConfig || {}) as Record<string, unknown>;
      const config = pricingConfigSchema.parse(req.body);
      const merged: PricingConfig = { ...DEFAULT_PRICING_CONFIG, ...existing, ...config };
      await storage.updateCompany(companyId, { pricingConfig: merged });
      res.json(merged);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/pricing-config", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      const existing: PricingConfig = { ...DEFAULT_PRICING_CONFIG, ...(company.pricingConfig || {}) };
      const updates = pricingConfigSchema.parse(req.body);
      const merged: PricingConfig = { ...existing, ...updates };
      await storage.updateCompany(companyId, { pricingConfig: merged });
      res.json(merged);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/pricing/calculate", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const body = calcInputSchema.parse(req.body);

      let acres = body.yardSizeAcres;
      if (!acres && body.yardSizeSqft) acres = sqftToAcres(body.yardSizeSqft);
      if (!acres && body.yardSizeLabel) acres = yardSizeLabelToAcres(body.yardSizeLabel);
      if (!acres && body.propertyId) {
        const prop = await storage.getProperty(body.propertyId, companyId);
        if (prop) {
          acres = prop.measuredYardSqft ? sqftToAcres(prop.measuredYardSqft) : yardSizeLabelToAcres(prop.yardSize);
        }
      }
      if (!acres) acres = 0.1;

      let tenantConfig = { ...DEFAULT_PRICING_CONFIG, ...(company.pricingConfig || {}) };
      if (body.pricingModeOverride) {
        tenantConfig.pricingMode = body.pricingModeOverride;
      }

      const inputs: PriceCalculatorInputs = {
        yardSizeAcres: acres,
        dogCount: body.dogCount,
        serviceFrequency: body.serviceFrequency,
        yardDifficulty: body.yardDifficulty,
        distanceFromNearestStopMiles: body.distanceFromNearestStopMiles,
        routeStopsPerMile: body.routeStopsPerMile,
        currentPriceCents: body.currentPriceCents,
      };

      const result = calculatePrice(inputs, tenantConfig);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/pricing/calculate-and-save", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const body = calcInputSchema.parse(req.body);

      let acres = body.yardSizeAcres;
      if (!acres && body.yardSizeSqft) acres = sqftToAcres(body.yardSizeSqft);
      if (!acres && body.yardSizeLabel) acres = yardSizeLabelToAcres(body.yardSizeLabel);
      if (!acres && body.propertyId) {
        const prop = await storage.getProperty(body.propertyId, companyId);
        if (prop) {
          acres = prop.measuredYardSqft ? sqftToAcres(prop.measuredYardSqft) : yardSizeLabelToAcres(prop.yardSize);
        }
      }
      if (!acres) acres = 0.1;

      let tenantConfig = { ...DEFAULT_PRICING_CONFIG, ...(company.pricingConfig || {}) };
      if (body.pricingModeOverride) {
        tenantConfig.pricingMode = body.pricingModeOverride;
      }

      const inputs: PriceCalculatorInputs = {
        yardSizeAcres: acres,
        dogCount: body.dogCount,
        serviceFrequency: body.serviceFrequency,
        yardDifficulty: body.yardDifficulty,
        distanceFromNearestStopMiles: body.distanceFromNearestStopMiles,
        routeStopsPerMile: body.routeStopsPerMile,
        currentPriceCents: body.currentPriceCents,
      };

      const result = calculatePrice(inputs, tenantConfig);

      const rec = await storage.createPriceRecommendation({
        companyId,
        propertyId: body.propertyId || null,
        serviceFrequency: body.serviceFrequency,
        yardSizeAcres: String(acres),
        dogCount: body.dogCount,
        yardDifficulty: body.yardDifficulty,
        routeId: body.routeId || null,
        minimumPriceCents: result.minimumPriceCents,
        recommendedPriceCents: result.recommendedPriceCents,
        premiumPriceCents: result.premiumPriceCents,
        jobMinutes: String(result.derived.jobMinutes),
        serviceMinutes: String(result.breakdown.serviceMinutes),
        travelMinutes: String(result.breakdown.travelMinutes),
        densityMultiplier: String(result.breakdown.densityMultiplier),
        breakdownJson: result.breakdown as any,
        inputsJson: result.inputsUsed as any,
        calculationVersion: "1.0",
        createdByUserId: userId,
        source: "manual",
      });

      res.json({ ...result, recommendationId: rec.id });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/pricing/recommendations/:propertyId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const recs = await storage.getPriceRecommendations(companyId, req.params.propertyId);
      res.json(recs);
    } catch (err) { handleError(res, err); }
  });

  // ================ Customer Profitability ================

  app.get("/api/profitability/summary", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { calculateAllCustomerProfitability } = await import("./services/profitability-calculator");
      const results = await calculateAllCustomerProfitability(companyId);
      res.json(results);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/profitability/customer/:contactId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { calculateCustomerProfitability } = await import("./services/profitability-calculator");
      const result = await calculateCustomerProfitability(companyId, req.params.contactId);
      if (!result) return res.status(404).json({ message: "No profitability data for this customer" });
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/contacts/:id/cost-overrides", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      res.json({ costOverrides: contact.costOverrides || null });
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/contacts/:id/cost-overrides", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      const costOverridesSchema = z.object({
        techHourlyWageCents: z.number().min(0).optional().nullable(),
        burdenMultiplier: z.number().min(1).max(5).optional().nullable(),
        distanceFromNearestStopMiles: z.number().min(0).max(100).optional().nullable(),
        overheadAllocationCents: z.number().min(0).optional().nullable(),
      });
      const parsed = costOverridesSchema.parse(req.body);
      const cleaned: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v !== null && v !== undefined) cleaned[k] = v;
      }
      const overrides = Object.keys(cleaned).length > 0 ? cleaned : null;
      await storage.updateContact(req.params.id, companyId, { costOverrides: overrides });
      res.json({ costOverrides: overrides });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/overhead-costs/total", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const total = await storage.getTotalMonthlyOverheadCents(companyId);
      res.json({ totalMonthlyOverheadCents: total });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/profitability/route-summary", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { calculateAllCustomerProfitability } = await import("./services/profitability-calculator");
      const allProfitability = await calculateAllCustomerProfitability(companyId);
      const routes = await storage.getRoutes(companyId);
      const plans = await storage.getServicePlans(companyId, { isActive: true });

      const planRouteMap = new Map<string, string>();
      const planContactMap = new Map<string, string>();
      for (const plan of plans) {
        if (plan.routeId) planRouteMap.set(plan.id, plan.routeId);
        planContactMap.set(plan.id, plan.contactId);
      }

      const routeMap = new Map<string, { routeId: string; routeName: string; dayOfWeek: string; totalStops: number; totalRevenueCents: number; totalCostCents: number; totalProfitCents: number; customers: Array<{ contactId: string; firstName: string; lastName: string; revenueCents: number; costCents: number }> }>();

      for (const route of routes) {
        routeMap.set(route.id, {
          routeId: route.id,
          routeName: route.name,
          dayOfWeek: route.dayOfWeek,
          totalStops: 0,
          totalRevenueCents: 0,
          totalCostCents: 0,
          totalProfitCents: 0,
          customers: [],
        });
      }

      for (const customer of allProfitability) {
        for (const prop of customer.properties) {
          const routeId = planRouteMap.get(prop.servicePlanId);
          if (!routeId || !routeMap.has(routeId)) continue;
          const routeEntry = routeMap.get(routeId)!;
          routeEntry.totalStops++;
          routeEntry.totalRevenueCents += prop.revenuePerVisitCents;
          routeEntry.totalCostCents += prop.costPerVisitCents;
          routeEntry.totalProfitCents += prop.profitPerVisitCents;

          let existing = routeEntry.customers.find(c => c.contactId === customer.contactId);
          if (!existing) {
            existing = { contactId: customer.contactId, firstName: customer.contactName.split(" ")[0], lastName: customer.contactName.split(" ").slice(1).join(" "), revenueCents: 0, costCents: 0 };
            routeEntry.customers.push(existing);
          }
          existing.revenueCents += prop.revenuePerVisitCents;
          existing.costCents += prop.costPerVisitCents;
        }
      }

      const result = Array.from(routeMap.values())
        .filter(r => r.totalStops > 0)
        .map(r => ({
          ...r,
          avgMarginPct: r.totalRevenueCents > 0 ? Math.round((r.totalProfitCents / r.totalRevenueCents) * 10000) / 100 : 0,
        }));

      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/profitability/route-map", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { calculateAllCustomerProfitability } = await import("./services/profitability-calculator");
      const allProfitability = await calculateAllCustomerProfitability(companyId);
      const routes = await storage.getRoutes(companyId);
      const plans = await storage.getServicePlans(companyId, { isActive: true });
      const properties = await storage.getProperties(companyId);
      const contacts = await storage.getContacts(companyId);

      const propertyMap = new Map(properties.map(p => [p.id, p]));
      const contactMap = new Map(contacts.map(c => [c.id, c]));

      const plansByRoute = new Map<string, typeof plans>();
      for (const plan of plans) {
        if (!plan.routeId || plan.isStopOnly) continue;
        if (!plansByRoute.has(plan.routeId)) plansByRoute.set(plan.routeId, []);
        plansByRoute.get(plan.routeId)!.push(plan);
      }

      const profByContact = new Map<string, typeof allProfitability[0]>();
      for (const cp of allProfitability) {
        profByContact.set(cp.contactId, cp);
      }

      type MapStop = {
        propertyId: string;
        contactId: string;
        contactName: string;
        propertyAddress: string;
        latitude: number;
        longitude: number;
        frequency: string;
        dogCount: number;
        yardSize: string;
        revenuePerVisitCents: number;
        costPerVisitCents: number;
        profitPerVisitCents: number;
        profitMarginPct: number;
        status: "profitable" | "marginal" | "unprofitable";
        stopOrder: number;
      };

      type MapRoute = {
        routeId: string;
        routeName: string;
        dayOfWeek: string;
        color: string;
        totalStops: number;
        totalRevenueCents: number;
        totalCostCents: number;
        totalProfitCents: number;
        avgMarginPct: number;
        status: "profitable" | "marginal" | "unprofitable";
        stops: MapStop[];
      };

      const result: MapRoute[] = [];

      for (const route of routes) {
        const routePlans = plansByRoute.get(route.id) || [];
        const stops: MapStop[] = [];
        let totalRev = 0, totalCost = 0, totalProfit = 0;

        for (const plan of routePlans) {
          const prop = propertyMap.get(plan.propertyId);
          if (!prop || !prop.latitude || !prop.longitude) continue;
          const contact = contactMap.get(plan.contactId);
          const custProf = profByContact.get(plan.contactId);
          const propProf = custProf?.properties.find(p => p.servicePlanId === plan.id);

          const rev = propProf?.revenuePerVisitCents ?? 0;
          const cost = propProf?.costPerVisitCents ?? 0;
          const profit = propProf?.profitPerVisitCents ?? 0;
          const margin = rev > 0 ? (profit / rev) * 100 : 0;
          const status: "profitable" | "marginal" | "unprofitable" = margin > 15 ? "profitable" : margin >= 0 ? "marginal" : "unprofitable";

          totalRev += rev;
          totalCost += cost;
          totalProfit += profit;

          stops.push({
            propertyId: prop.id,
            contactId: plan.contactId,
            contactName: contact ? `${contact.firstName} ${contact.lastName}` : "Unknown",
            propertyAddress: prop.streetAddress || "Unknown",
            latitude: Number(prop.latitude),
            longitude: Number(prop.longitude),
            frequency: plan.frequency,
            dogCount: prop.numberOfDogs ?? 1,
            yardSize: prop.yardSize || "standard",
            revenuePerVisitCents: rev,
            costPerVisitCents: cost,
            profitPerVisitCents: profit,
            profitMarginPct: Math.round(margin * 10) / 10,
            status,
            stopOrder: plan.stopOrder ?? 0,
          });
        }

        if (stops.length === 0) continue;

        stops.sort((a, b) => a.stopOrder - b.stopOrder);
        const avgMargin = totalRev > 0 ? Math.round((totalProfit / totalRev) * 10000) / 100 : 0;
        const routeStatus: "profitable" | "marginal" | "unprofitable" = avgMargin > 15 ? "profitable" : avgMargin >= 0 ? "marginal" : "unprofitable";

        result.push({
          routeId: route.id,
          routeName: route.name,
          dayOfWeek: route.dayOfWeek,
          color: route.color || "#3b82f6",
          totalStops: stops.length,
          totalRevenueCents: totalRev,
          totalCostCents: totalCost,
          totalProfitCents: totalProfit,
          avgMarginPct: avgMargin,
          status: routeStatus,
          stops,
        });
      }

      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/profitability/recalculate", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { generateProfitabilitySnapshots } = await import("./services/profitability-calculator");
      const count = await generateProfitabilitySnapshots(companyId);
      res.json({ success: true, snapshotsCreated: count });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/profitability/history/:contactId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const snapshots = await storage.getProfitabilitySnapshots(companyId, {
        contactId: req.params.contactId,
      });
      res.json(snapshots);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/profitability/bulk-recommendations", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { calculateAllCustomerProfitability, generateBulkRecommendations } = await import("./services/profitability-calculator");
      const allProfitability = await calculateAllCustomerProfitability(companyId);
      const recommendations = generateBulkRecommendations(allProfitability);
      res.json(recommendations);
    } catch (err) { handleError(res, err); }
  });

  // ================ Pricing Simulator ================

  app.post("/api/pricing-simulator/simulate", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const schema = z.object({
        targetMarginPct: z.number().min(1).max(80),
        overheadAdjustmentPct: z.number().min(-50).max(100),
        laborRateAdjustmentPct: z.number().min(-50).max(100),
        travelCostFactor: z.number().min(0.1).max(5),
      });
      const params = schema.parse(req.body);
      const { runPricingSimulation } = await import("./services/pricing-simulator");
      const result = await runPricingSimulation(companyId, params);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/pricing-simulator/elasticity", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const schema = z.object({
        propertyId: z.string().optional(),
      });
      const { propertyId } = schema.parse(req.body);
      const { runPriceElasticitySimulation } = await import("./services/pricing-simulator");
      const result = await runPriceElasticitySimulation(companyId, propertyId || undefined);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/pricing-simulator/competitor-analysis", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const schema = z.object({
        zipCode: z.string().optional(),
      });
      const { zipCode } = schema.parse(req.body);
      const { runCompetitorAnalysis } = await import("./services/pricing-simulator");
      const result = await runCompetitorAnalysis(companyId, zipCode || undefined);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/pricing-simulator/zip-codes", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const props = await storage.getProperties(companyId);
      const zipSet = new Set(props.map(p => p.zipCode).filter(Boolean));
      res.json([...zipSet].sort());
    } catch (err) { handleError(res, err); }
  });

  // ================ Competitor Pricing ================

  app.get("/api/competitor-pricing", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const zipCode = req.query.zipCode as string | undefined;
      const items = await storage.getCompetitorPricing(companyId, zipCode);
      res.json(items);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/competitor-pricing", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const schema = z.object({
        zipCode: z.string().min(1),
        competitorName: z.string().min(1),
        frequency: z.enum(["weekly", "biweekly", "monthly", "onetime"]).default("weekly"),
        priceCents: z.number().int().min(0),
        dogCountRange: z.string().optional().default("1-2"),
        yardSizeCategory: z.string().optional().default("medium"),
        source: z.enum(["manual", "research"]).optional().default("manual"),
        notes: z.string().optional(),
      });
      const data = schema.parse(req.body);
      const item = await storage.createCompetitorPricing({ ...data, companyId });
      res.json(item);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/competitor-pricing/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { id } = req.params;
      const schema = z.object({
        zipCode: z.string().min(1).optional(),
        competitorName: z.string().min(1).optional(),
        frequency: z.enum(["weekly", "biweekly", "monthly", "onetime"]).optional(),
        priceCents: z.number().int().min(0).optional(),
        dogCountRange: z.string().optional(),
        yardSizeCategory: z.string().optional(),
        source: z.enum(["manual", "research"]).optional(),
        notes: z.string().optional(),
      });
      const data = schema.parse(req.body);
      const item = await storage.updateCompetitorPricing(id, companyId, data);
      res.json(item);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/competitor-pricing/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { id } = req.params;
      await storage.deleteCompetitorPricing(id, companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  // ================ Overhead Costs ================

  app.get("/api/overhead-costs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const items = await storage.getOverheadCosts(companyId);
      const totalMonthlyOverheadCents = items.reduce((sum, i) => sum + i.monthlyCostCents, 0);
      res.json({ items, totalMonthlyOverheadCents });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/overhead-costs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { category, name, monthlyCostCents, type, sortOrder } = req.body;
      if (!category || typeof category !== "string" || !name || typeof name !== "string") {
        return res.status(400).json({ error: "category and name are required strings" });
      }
      const costCents = typeof monthlyCostCents === "number" && monthlyCostCents >= 0 ? Math.round(monthlyCostCents) : 0;
      const validType = type === "variable" ? "variable" : "fixed";
      const item = await storage.createOverheadCost({
        companyId,
        category: category.trim(),
        name: name.trim(),
        monthlyCostCents: costCents,
        type: validType,
        isDefault: false,
        sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
      });
      res.json(item);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/overhead-costs/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { id } = req.params;
      const updates: Record<string, any> = {};
      if (typeof req.body.name === "string") updates.name = req.body.name.trim();
      if (typeof req.body.monthlyCostCents === "number" && req.body.monthlyCostCents >= 0) {
        updates.monthlyCostCents = Math.round(req.body.monthlyCostCents);
      }
      if (req.body.type === "fixed" || req.body.type === "variable") updates.type = req.body.type;
      if (typeof req.body.category === "string") updates.category = req.body.category.trim();
      if (typeof req.body.sortOrder === "number") updates.sortOrder = req.body.sortOrder;
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No valid fields to update" });
      const item = await storage.updateOverheadCost(id, companyId, updates);
      if (!item) return res.status(404).json({ error: "Item not found" });
      res.json(item);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/overhead-costs/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      await storage.deleteOverheadCost(req.params.id, companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/overhead-costs/seed-defaults", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getOverheadCosts(companyId);
      if (existing.length > 0) {
        return res.json({ seeded: false, message: "Items already exist", count: existing.length });
      }

      const company = await storage.getCompany(companyId);
      const { TIER_CONFIG } = await import("@shared/schema");
      const tier = (company?.subscriptionTier || "free_trial") as keyof typeof TIER_CONFIG;
      const subscriptionPriceCents = Math.round((TIER_CONFIG[tier]?.price ?? 0) * 100);

      const defaults: Array<{ category: string; name: string; type: "fixed" | "variable"; sortOrder: number; monthlyCostCents?: number }> = [
        { category: "Office + Admin", name: "Scheduling/CRM software", type: "fixed", sortOrder: 0 },
        { category: "Office + Admin", name: "Website hosting and domain", type: "fixed", sortOrder: 1 },
        { category: "Office + Admin", name: "Phone line/business number", type: "fixed", sortOrder: 2 },
        { category: "Office + Admin", name: "Email and workspace tools", type: "fixed", sortOrder: 3 },
        { category: "Office + Admin", name: "Bookkeeping/accounting software", type: "fixed", sortOrder: 4 },
        { category: "Office + Admin", name: "Payment processing fees", type: "variable", sortOrder: 5 },
        { category: "Office + Admin", name: "Business insurance", type: "fixed", sortOrder: 6 },
        { category: "Office + Admin", name: "Licenses and permits", type: "fixed", sortOrder: 7 },
        { category: "Office + Admin", name: "Legal and tax prep", type: "fixed", sortOrder: 8 },
        { category: "Office + Admin", name: "ScooPilot subscription", type: "fixed", sortOrder: 9, monthlyCostCents: subscriptionPriceCents },
        { category: "Marketing", name: "Google Ads", type: "variable", sortOrder: 0 },
        { category: "Marketing", name: "Facebook/Instagram ads", type: "variable", sortOrder: 1 },
        { category: "Marketing", name: "Yard signs", type: "variable", sortOrder: 2 },
        { category: "Marketing", name: "Flyers/door hangers", type: "variable", sortOrder: 3 },
        { category: "Marketing", name: "Vehicle magnets or wraps", type: "fixed", sortOrder: 4 },
        { category: "Marketing", name: "Referral rewards", type: "variable", sortOrder: 5 },
        { category: "Marketing", name: "Print materials and business cards", type: "variable", sortOrder: 6 },
        { category: "Vehicles + Transportation", name: "Fuel", type: "variable", sortOrder: 0 },
        { category: "Vehicles + Transportation", name: "Vehicle payment or lease", type: "fixed", sortOrder: 1 },
        { category: "Vehicles + Transportation", name: "Vehicle insurance", type: "fixed", sortOrder: 2 },
        { category: "Vehicles + Transportation", name: "Repairs and maintenance", type: "variable", sortOrder: 3 },
        { category: "Vehicles + Transportation", name: "Tires", type: "variable", sortOrder: 4 },
        { category: "Vehicles + Transportation", name: "Registration", type: "fixed", sortOrder: 5 },
        { category: "Vehicles + Transportation", name: "Route optimization software", type: "fixed", sortOrder: 6 },
        { category: "Tools + Field Supplies", name: "Rakes, bins, scoopers, bags", type: "variable", sortOrder: 0 },
        { category: "Tools + Field Supplies", name: "Gloves", type: "variable", sortOrder: 1 },
        { category: "Tools + Field Supplies", name: "Disinfectant and sanitizer", type: "variable", sortOrder: 2 },
        { category: "Tools + Field Supplies", name: "Boot spray/cleaning supplies", type: "variable", sortOrder: 3 },
        { category: "Tools + Field Supplies", name: "Uniforms/branded shirts", type: "fixed", sortOrder: 4 },
        { category: "Tools + Field Supplies", name: "Replacement tools from wear and tear", type: "variable", sortOrder: 5 },
        { category: "Labor", name: "Employee wages", type: "variable", sortOrder: 0 },
        { category: "Labor", name: "Payroll taxes", type: "variable", sortOrder: 1 },
        { category: "Labor", name: "Workers' comp", type: "fixed", sortOrder: 2 },
        { category: "Labor", name: "Training time", type: "variable", sortOrder: 3 },
        { category: "Labor", name: "Bonuses/incentives", type: "variable", sortOrder: 4 },
        { category: "Labor", name: "Hiring costs", type: "variable", sortOrder: 5 },
        { category: "Labor", name: "Background checks", type: "variable", sortOrder: 6 },
        { category: "Operations", name: "Mobile data plans", type: "fixed", sortOrder: 0 },
        { category: "Operations", name: "GPS/time tracking apps", type: "fixed", sortOrder: 1 },
        { category: "Operations", name: "Customer notification tools", type: "fixed", sortOrder: 2 },
        { category: "Operations", name: "Storage bins or small storage unit", type: "fixed", sortOrder: 3 },
        { category: "Operations", name: "Equipment cleaning area/supplies", type: "variable", sortOrder: 4 },
        { category: "Financial Overhead", name: "Bank fees", type: "fixed", sortOrder: 0 },
        { category: "Financial Overhead", name: "Merchant service fees", type: "variable", sortOrder: 1 },
        { category: "Financial Overhead", name: "Bad debt/unpaid invoices", type: "variable", sortOrder: 2 },
        { category: "Financial Overhead", name: "Refunds or service credits", type: "variable", sortOrder: 3 },
      ];

      for (const item of defaults) {
        await storage.createOverheadCost({
          companyId,
          category: item.category,
          name: item.name,
          monthlyCostCents: item.monthlyCostCents ?? 0,
          type: item.type,
          isDefault: true,
          sortOrder: item.sortOrder,
        });
      }

      const items = await storage.getOverheadCosts(companyId);
      res.json({ seeded: true, count: items.length, items });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/overhead-costs/monthly-fuel", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);

      const allRoutes = await storage.getRoutes(companyId);

      if (allRoutes.length === 0) {
        return res.json({ totalMiles: 0, weeklyMiles: 0, fuelCostCents: 0, routeCount: 0 });
      }

      const company = await storage.getCompany(companyId);
      const config = (company?.pricingConfig as any) || {};
      const gasPriceCents = config.averageGasPriceCentsPerGallon ?? 350;
      const mpg = config.vehicleMPG ?? null;
      const costPerMileCents = config.vehicleCostPerMileCents ?? 65;

      const effectiveCostPerMileCents = (mpg && mpg > 0)
        ? Math.round((gasPriceCents / mpg))
        : costPerMileCents;

      const allPlans = await storage.getServicePlans(companyId, { isActive: true });
      const allProperties = await storage.getProperties(companyId);
      const propMap = new Map(allProperties.map(p => [p.id, p]));
      const startPoint = company?.startLatitude && company?.startLongitude
        ? { latitude: Number(company.startLatitude), longitude: Number(company.startLongitude) }
        : undefined;

      let weeklyMiles = 0;
      let routeCount = 0;

      for (const route of allRoutes) {
        const routePlans = allPlans
          .filter(sp => sp.routeId === route.id)
          .sort((a, b) => a.stopOrder - b.stopOrder);

        if (routePlans.length < 2) continue;

        const stops: { id: string; latitude: number; longitude: number }[] = [];
        for (const sp of routePlans) {
          const prop = propMap.get(sp.propertyId);
          if (prop?.latitude && prop?.longitude) {
            stops.push({ id: sp.id, latitude: Number(prop.latitude), longitude: Number(prop.longitude) });
          }
        }

        if (stops.length < 2) continue;

        routeCount++;
        const metrics = await getRouteMetricsWithLegs(stops, startPoint);
        if (metrics) {
          weeklyMiles += metrics.totalDistance;
        } else {
          weeklyMiles += calculateTotalDistance(stops, startPoint);
        }
      }

      weeklyMiles = Math.round(weeklyMiles * 10) / 10;
      const WEEKS_PER_MONTH = 4.33;
      const totalMiles = Math.round(weeklyMiles * WEEKS_PER_MONTH * 10) / 10;
      const fuelCostCents = Math.round(totalMiles * effectiveCostPerMileCents);

      res.json({ totalMiles, weeklyMiles, fuelCostCents, routeCount });
    } catch (err) { handleError(res, err); }
  });

  // ================ Messages / Communications ================

  app.get("/api/messages", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const filters: { contactId?: string; channel?: string; direction?: string; isRead?: boolean; phone?: string; emailThreadId?: string } = {};
      if (req.query.contactId) filters.contactId = req.query.contactId as string;
      if (req.query.channel) filters.channel = req.query.channel as string;
      if (req.query.direction) filters.direction = req.query.direction as string;
      if (req.query.unread === "true") filters.isRead = false;
      if (req.query.phone) filters.phone = req.query.phone as string;
      if (req.query.emailThreadId) filters.emailThreadId = req.query.emailThreadId as string;
      const msgs = await storage.getMessages(companyId, filters);

      const contactCache = new Map<string, string>();
      const enriched = await Promise.all(msgs.map(async (m) => {
        let contactName = "";
        if (m.contactId) {
          if (contactCache.has(m.contactId)) {
            contactName = contactCache.get(m.contactId)!;
          } else {
            const contact = await storage.getContactById(m.contactId);
            contactName = contact ? `${contact.firstName} ${contact.lastName}` : "";
            contactCache.set(m.contactId, contactName);
          }
        }
        return { ...m, contactName };
      }));
      res.json(enriched);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/messages/:id/read", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const msg = await storage.markMessageRead(req.params.id, companyId);
      if (!msg) return res.status(404).json({ error: "Message not found" });
      res.json(msg);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/messages/read-by-contact/:contactId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      await storage.markMessagesReadByContact(req.params.contactId, companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/messages/read-by-phone", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ error: "phone is required" });
      await storage.markMessagesReadByPhone(phone, companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/messages/unread-sms-count", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const count = await storage.getUnreadSmsCount(companyId);
      res.json({ count });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/messages/conversations", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const channelFilter = req.query.channel as string | undefined;
      const contacts = await storage.getContacts(companyId);
      const contactMap = new Map(contacts.map(c => [c.id, c]));
      const company = await storage.getCompany(companyId);
      const retentionDays = company?.messageRetentionDays ?? 30;

      type ConvThread = { contactId: string; contactName: string; phone: string; email: string; lastMessage: Message; unreadCount: number; messageCount: number; channel: string; emailThreadId: string; subject: string };

      const threadMap = new Map<string, ConvThread>();

      if (!channelFilter || channelFilter === "sms") {
        const allSms = await storage.getMessages(companyId, { channel: "sms", retentionDays });
        for (const msg of allSms) {
          const key = `sms:${msg.contactId || `unknown:${msg.direction === "inbound" ? msg.fromAddress : msg.toAddress}`}`;
          const existing = threadMap.get(key);
          const contact = msg.contactId ? contactMap.get(msg.contactId) : null;
          const phone = msg.direction === "inbound" ? msg.fromAddress : msg.toAddress;
          const contactName = contact ? `${contact.firstName} ${contact.lastName}`.trim() : phone;

          if (!existing) {
            threadMap.set(key, {
              contactId: msg.contactId || "",
              contactName,
              phone,
              email: "",
              lastMessage: msg,
              unreadCount: (msg.direction === "inbound" && !msg.isRead) ? 1 : 0,
              messageCount: 1,
              channel: "sms",
              emailThreadId: "",
              subject: "",
            });
          } else {
            existing.messageCount++;
            if (msg.direction === "inbound" && !msg.isRead) existing.unreadCount++;
            if (new Date(msg.createdAt) > new Date(existing.lastMessage.createdAt)) {
              existing.lastMessage = msg;
            }
          }
        }
      }

      if (!channelFilter || channelFilter === "email") {
        const allEmail = await storage.getMessages(companyId, { channel: "email", retentionDays });
        for (const msg of allEmail) {
          const canonicalThreadId = msg.emailThreadId || msg.id;
          const key = `email:${canonicalThreadId}`;
          const existing = threadMap.get(key);
          const contact = msg.contactId ? contactMap.get(msg.contactId) : null;
          const emailAddr = msg.direction === "inbound" ? msg.fromAddress : msg.toAddress;
          const contactName = contact ? `${contact.firstName} ${contact.lastName}`.trim() : emailAddr;

          if (!existing) {
            threadMap.set(key, {
              contactId: msg.contactId || "",
              contactName,
              phone: "",
              email: emailAddr,
              lastMessage: msg,
              unreadCount: (msg.direction === "inbound" && !msg.isRead) ? 1 : 0,
              messageCount: 1,
              channel: "email",
              emailThreadId: canonicalThreadId,
              subject: msg.subject || "",
            });
          } else {
            existing.messageCount++;
            if (msg.direction === "inbound" && !msg.isRead) existing.unreadCount++;
            if (new Date(msg.createdAt) > new Date(existing.lastMessage.createdAt)) {
              existing.lastMessage = msg;
              if (msg.subject) existing.subject = msg.subject;
            }
          }
        }
      }

      const conversations = Array.from(threadMap.values()).sort((a, b) =>
        new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime()
      );
      res.json(conversations);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/messages/unread-email-count", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const count = await storage.getUnreadEmailCount(companyId);
      res.json({ count });
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/messages/read-by-email-thread/:threadId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      await storage.markMessagesReadByEmail(req.params.threadId, companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/messages/email", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const { contactId, to, subject, body, htmlBody, emailThreadId: existingThreadId } = req.body;
      if (!to || !subject || !body) {
        return res.status(400).json({ error: "to, subject, and body are required" });
      }

      if (contactId) {
        const contact = await storage.getContact(contactId, companyId);
        if (!contact) return res.status(400).json({ error: "Contact not found in your company" });
      }

      const company = await storage.getCompany(companyId);
      const fromAddress = company?.email || "jeremy@scoopilot.com";

      let emailThreadId = generateEmailThreadId();
      if (existingThreadId) {
        const existingThread = await storage.getMessagesByEmailThreadId(existingThreadId, companyId);
        if (existingThread.length > 0) {
          emailThreadId = existingThreadId;
        } else {
          const [legacyMsg] = await db.select().from(messagesTable)
            .where(and(
              eq(messagesTable.id, existingThreadId),
              eq(messagesTable.companyId, companyId),
              eq(messagesTable.channel, "email")
            )).limit(1);
          if (legacyMsg && !legacyMsg.emailThreadId) {
            await db.update(messagesTable)
              .set({ emailThreadId })
              .where(and(eq(messagesTable.id, existingThreadId), eq(messagesTable.companyId, companyId)));
          }
        }
      }

      const msg = await storage.createMessage({
        companyId,
        contactId: contactId || null,
        channel: "email",
        direction: "outbound",
        status: "queued",
        fromAddress,
        toAddress: to,
        subject,
        body,
        htmlBody: htmlBody || null,
        sentBy: userId,
        emailThreadId,
      });

      const result = await sendEmail({
        companyId: companyId,
        to,
        from: fromAddress,
        subject,
        text: body,
        html: htmlBody || body,
        senderName: company?.name || undefined,
        emailThreadId,
      });

      if (result.success) {
        const updated = await storage.updateMessageStatus(msg.id, "sent");
        res.json(updated);
      } else {
        const updated = await storage.updateMessageStatus(msg.id, "failed", result.error);
        res.status(500).json({ error: result.error, message: updated });
      }
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/messages/sms", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const { contactId, to, body, mediaUrl } = req.body;
      if (!to || !body) {
        return res.status(400).json({ error: "to and body are required" });
      }

      if (contactId) {
        const contact = await storage.getContact(contactId, companyId);
        if (!contact) return res.status(400).json({ error: "Contact not found in your company" });
      }

      const fromPhone = await getFromPhoneForCompany(companyId);

      const mediaUrls = mediaUrl ? [mediaUrl] : [];
      const msg = await storage.createMessage({
        companyId,
        contactId: contactId || null,
        channel: "sms",
        direction: "outbound",
        status: "queued",
        fromAddress: fromPhone,
        toAddress: to,
        body,
        sentBy: userId,
        mediaUrls,
        mediaCount: mediaUrls.length,
      });

      const result = await sendSmsForCompany({ to, body, companyId, contactId: contactId || undefined, mediaUrl });

      if (result.success) {
        const updated = await storage.updateMessageStatus(msg.id, "sent");
        res.json(updated);
      } else {
        const updated = await storage.updateMessageStatus(msg.id, "failed", result.error);
        res.status(500).json({ error: result.error, message: updated });
      }
    } catch (err) { handleError(res, err); }
  });

  const ALLOWED_MMS_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  const MMS_MAX_PER_FILE = parseInt(process.env.MMS_MAX_FILE_BYTES || String(5 * 1024 * 1024), 10);
  const MMS_MAX_TOTAL = parseInt(process.env.MMS_MAX_TOTAL_BYTES || String(10 * 1024 * 1024), 10);
  const MMS_MAX_ATTACHMENTS = parseInt(process.env.MMS_MAX_ATTACHMENTS || "5", 10);

  const mmsUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MMS_MAX_PER_FILE, files: MMS_MAX_ATTACHMENTS },
  });

  app.post("/api/messages/mms", isAuthenticated, (req: Request, res: Response, next: Function) => {
    mmsUpload.array("media", MMS_MAX_ATTACHMENTS)(req, res, (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ error: `File too large. Maximum per file: ${Math.round(MMS_MAX_PER_FILE / 1024 / 1024)}MB` });
        }
        if (err.code === "LIMIT_FILE_COUNT") {
          return res.status(400).json({ error: `Too many files. Maximum: ${MMS_MAX_ATTACHMENTS}` });
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          return res.status(400).json({ error: "Unexpected file field" });
        }
        return res.status(400).json({ error: err.message || "File upload error" });
      }
      next();
    });
  }, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const { contactId, to, body, originalSizes } = req.body;
      if (!to) return res.status(400).json({ error: "to is required" });

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) return res.status(400).json({ error: "At least one media file is required" });

      let totalBytes = 0;
      for (const file of files) {
        if (!ALLOWED_MMS_TYPES.includes(file.mimetype)) {
          return res.status(400).json({ error: `Unsupported file type: ${file.mimetype}. Allowed: JPG, PNG, WebP` });
        }
        totalBytes += file.size;
      }
      if (totalBytes > MMS_MAX_TOTAL) {
        return res.status(400).json({ error: `Total payload too large (${Math.round(totalBytes / 1024)}KB). Maximum: ${Math.round(MMS_MAX_TOTAL / 1024 / 1024)}MB` });
      }

      if (contactId) {
        const contact = await storage.getContact(contactId, companyId);
        if (!contact) return res.status(400).json({ error: "Contact not found in your company" });
      }

      const { ObjectStorageService } = await import("./replit_integrations/object_storage/objectStorage");
      const objStorage = new ObjectStorageService();
      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host || "localhost:5000";

      const storedPaths: string[] = [];
      const publicUrls: string[] = [];
      const parsedOriginals: number[] = (() => {
        try { return originalSizes ? JSON.parse(originalSizes) : []; } catch { return []; }
      })();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const uploadURL = await objStorage.getObjectEntityUploadURL();
        const objectPath = objStorage.normalizeObjectEntityPath(uploadURL);
        const putResponse = await fetch(uploadURL, {
          method: "PUT",
          body: file.buffer,
          headers: { "Content-Type": file.mimetype },
        });
        if (!putResponse.ok) {
          return res.status(500).json({ error: `Failed to upload media file ${i + 1} to storage` });
        }
        storedPaths.push(objectPath);
        publicUrls.push(`${protocol}://${host}${objectPath}`);
      }

      const fromPhone = await getFromPhoneForCompany(companyId);
      const messageBody = body || "";

      const msg = await storage.createMessage({
        companyId,
        contactId: contactId || null,
        channel: "sms",
        direction: "outbound",
        status: "queued",
        fromAddress: fromPhone,
        toAddress: to,
        body: messageBody,
        sentBy: userId,
        mediaUrls: storedPaths,
        mediaCount: storedPaths.length,
      });

      for (let i = 0; i < files.length; i++) {
        try {
          const origSize = (parsedOriginals[i] && parsedOriginals[i] > 0) ? parsedOriginals[i] : files[i].size;
          await storage.createMessageAttachment({
            messageId: msg.id,
            companyId,
            mimeType: files[i].mimetype,
            originalFilename: files[i].originalname,
            originalSizeBytes: origSize,
            compressedSizeBytes: files[i].size,
            storageUrl: storedPaths[i],
          });
        } catch (attachErr) {
          console.error(`[MMS] Failed to create attachment record ${i}:`, attachErr);
        }
      }

      const result = await sendSmsForCompany({ to, body: messageBody, companyId, contactId: contactId || undefined, mediaUrls: publicUrls });

      if (result.success) {
        const updated = await storage.updateMessageStatus(msg.id, "sent");
        res.json(updated);
      } else {
        const updated = await storage.updateMessageStatus(msg.id, "failed", result.error);
        res.status(500).json({ error: result.error, message: updated });
      }
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/messages/config", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const smsConfig = await getCompanySmsConfig(companyId);
      const { getSharedSmsNumber, isSharedNumber: isShared } = await import("./services/sms");
      const sharedNumber = getSharedSmsNumber();
      res.json({
        email: { configured: !!process.env.SENDGRID_API_KEY },
        sms: {
          configured: smsConfig.configured,
          phoneNumber: smsConfig.phoneNumber,
          provider: smsConfig.provider,
          isSharedNumber: !!sharedNumber && isShared(smsConfig.phoneNumber),
        },
      });
    } catch (err) { handleError(res, err); }
  });

  // ─── Message Exception Queue (tenant-scoped via candidateCompanyIds) ─
  app.get("/api/message-exceptions", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (role !== "owner" && role !== "admin") return res.status(403).json({ error: "Owner or admin access required" });
      const resolved = req.query.resolved === "true" ? true : req.query.resolved === "false" ? false : undefined;
      const exceptions = await storage.getMessageExceptions({ resolved, companyId });
      res.json(exceptions);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/message-exceptions/:id/resolve", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId, role } = await getCompanyContext(req);
      if (role !== "owner" && role !== "admin") return res.status(403).json({ error: "Owner or admin access required" });

      const targetCompanyId = req.body.companyId || companyId;
      if (targetCompanyId !== companyId) {
        return res.status(403).json({ error: "Cannot resolve exceptions for another company" });
      }

      const exception = await storage.resolveMessageException(req.params.id, userId, targetCompanyId);
      if (!exception) return res.status(404).json({ error: "Exception not found, already resolved, or not assigned to your company" });

      if (exception.body && exception.fromAddress) {
        try {
          const allContacts = await storage.getContacts(targetCompanyId);
          const fromDigits = exception.fromAddress.replace(/\D/g, "");
          const matchedContact = allContacts.find(c => {
            const cDigits = (c.phone || "").replace(/\D/g, "");
            return cDigits.length >= 10 && fromDigits.length >= 10 && fromDigits.endsWith(cDigits.slice(-10));
          });

          await storage.createMessage({
            companyId: targetCompanyId,
            contactId: matchedContact?.id || null,
            channel: "sms",
            direction: "inbound",
            status: "received",
            fromAddress: exception.fromAddress,
            toAddress: exception.toAddress,
            body: exception.body,
            externalId: exception.providerMessageId || undefined,
          });

          if (matchedContact) {
            const { isSharedNumber } = await import("./services/sms");
            if (isSharedNumber(exception.toAddress)) {
              await storage.upsertMessageRouting({
                sharedNumber: exception.toAddress,
                customerPhone: exception.fromAddress,
                companyId: targetCompanyId,
                contactId: matchedContact.id,
                channel: "sms",
                lastUsedAt: new Date(),
              });
            }
          }
        } catch (msgErr) {
          console.error(`[MessageException] Resolved exception ${req.params.id} but message delivery failed:`, msgErr);
        }
      }

      res.json(exception);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/message-exceptions/:id/dismiss", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId, role } = await getCompanyContext(req);
      if (role !== "owner" && role !== "admin") return res.status(403).json({ error: "Owner or admin access required" });
      const exception = await storage.dismissMessageException(req.params.id, userId, companyId);
      if (!exception) return res.status(404).json({ error: "Exception not found, already resolved, or not assigned to your company" });
      res.json(exception);
    } catch (err) { handleError(res, err); }
  });

  // Twilio incoming SMS webhook
  app.post("/api/webhooks/twilio/sms", async (req: Request, res: Response) => {
    try {
      const { From, Body, MessageSid } = req.body;
      if (!From || !Body) {
        return res.status(400).send("<Response></Response>");
      }

      const allCompanies = await storage.listCompanies();
      if (allCompanies.length > 0) {
        const companyId = allCompanies[0].id;
        const allContacts = await storage.getContacts(companyId);
        const digits = From.replace(/\D/g, "");
        const matchedContact = allContacts.find(c => {
          const cDigits = (c.phone || "").replace(/\D/g, "");
          return cDigits.length >= 10 && digits.endsWith(cDigits.slice(-10));
        });

        await storage.createMessage({
          companyId,
          contactId: matchedContact?.id || null,
          channel: "sms",
          direction: "inbound",
          status: "received",
          fromAddress: From,
          toAddress: await getFromPhoneForCompany(companyId),
          body: Body,
          externalId: MessageSid,
        });

        if (matchedContact) {
          notify(companyId, "new_message", "New Text Message", `${matchedContact.firstName} ${matchedContact.lastName} sent a text message.`, `/communications?contactId=${matchedContact.id}`);
        }
      }

      res.type("text/xml").send("<Response></Response>");
    } catch (err) {
      console.error("Twilio webhook error:", err);
      res.type("text/xml").send("<Response></Response>");
    }
  });

  app.post("/api/webhooks/telnyx/sms", async (req: Request, res: Response) => {
    try {
      const eventType = req.body?.data?.event_type;
      console.log(`[Telnyx SMS] Webhook received, event_type: ${eventType}`);

      if (eventType !== "message.received") {
        console.log(`[Telnyx SMS] Ignoring event type: ${eventType}`);
        return res.status(200).json({ ok: true });
      }

      const payload = req.body?.data?.payload;
      if (!payload) {
        console.log("[Telnyx SMS] No payload found in request body");
        return res.status(200).json({ ok: true });
      }

      console.log(`[Telnyx SMS] Payload shape: id=${payload.id}, from=${JSON.stringify(payload.from)}, to=${JSON.stringify(payload.to)}, text length=${payload.text?.length ?? 0}`);

      const fromNumber = payload.from?.phone_number;
      const textBody = payload.text;
      const messageId = payload.id;

      let toNumber = "";
      if (Array.isArray(payload.to)) {
        toNumber = payload.to[0]?.phone_number || "";
      } else if (payload.to && typeof payload.to === "object") {
        toNumber = payload.to.phone_number || "";
      } else if (typeof payload.to === "string") {
        toNumber = payload.to;
      }

      console.log(`[Telnyx SMS] Parsed: from=${fromNumber}, to=${toNumber}, messageId=${messageId}`);

      type TelnyxMedia = { url?: string; content_type?: string; size?: number };
      const rawMedia: TelnyxMedia[] = Array.isArray(payload.media) ? payload.media : [];
      const inboundMedia = rawMedia.filter(
        (m): m is TelnyxMedia & { url: string } => typeof m.url === "string" && m.url.startsWith("https://")
      );

      if (!fromNumber || (!textBody && inboundMedia.length === 0)) {
        console.log(`[Telnyx SMS] Missing required fields: fromNumber=${fromNumber}, textBody=${textBody ? "present" : "missing"}, media=${inboundMedia.length}`);
        return res.status(200).json({ ok: true });
      }

      const toDigits = toNumber.replace(/\D/g, "");
      const { isSharedNumber } = await import("./services/sms");

      const allCompanies = await storage.listCompanies();
      let matchedCompany: (typeof allCompanies)[number] | undefined;

      // Step 1: Try dedicated number match
      matchedCompany = allCompanies.find(c => {
        const cDigits = (c.telnyxPhoneNumber || "").replace(/\D/g, "");
        return cDigits.length >= 10 && toDigits.length >= 10 && toDigits.endsWith(cDigits.slice(-10));
      });
      if (!matchedCompany) {
        matchedCompany = allCompanies.find(c => {
          const cDigits = (c.dedicatedPhoneNumber || "").replace(/\D/g, "");
          return cDigits.length >= 10 && toDigits.length >= 10 && toDigits.endsWith(cDigits.slice(-10));
        });
      }

      // Step 2: If no dedicated match, check if this is a shared number
      if (!matchedCompany && isSharedNumber(toNumber)) {
        console.log(`[Telnyx SMS] Shared number detected, looking up routing table for from=${fromNumber}`);
        const routingEntries = await storage.findMessageRouting(toNumber, fromNumber);

        if (routingEntries.length === 1) {
          matchedCompany = allCompanies.find(c => c.id === routingEntries[0].companyId);
          if (matchedCompany) {
            console.log(`[Telnyx SMS] Shared number routed to company: ${matchedCompany.name} (via routing table)`);
          }
        } else if (routingEntries.length > 1) {
          console.warn(`[Telnyx SMS] Ambiguous routing: ${routingEntries.length} companies for from=${fromNumber} on shared number. Sending to exception queue.`);
          await storage.createMessageException({
            providerMessageId: messageId,
            fromAddress: fromNumber,
            toAddress: toNumber,
            body: textBody,
            rawPayload: payload as Record<string, unknown>,
            reason: `Ambiguous routing: ${routingEntries.length} tenants matched for sender ${fromNumber}`,
            candidateCompanyIds: routingEntries.map(r => r.companyId),
          });
          return res.status(200).json({ ok: true });
        } else {
          // No routing entry - try contact phone match across all companies
          const fromDigits = fromNumber.replace(/\D/g, "");
          const matchingCompanies: typeof allCompanies = [];
          for (const company of allCompanies) {
            const contacts = await storage.getContacts(company.id);
            const hasMatch = contacts.some(c => {
              const cDigits = (c.phone || "").replace(/\D/g, "");
              return cDigits.length >= 10 && fromDigits.length >= 10 && fromDigits.endsWith(cDigits.slice(-10));
            });
            if (hasMatch) matchingCompanies.push(company);
          }

          if (matchingCompanies.length === 1) {
            matchedCompany = matchingCompanies[0];
            console.log(`[Telnyx SMS] Shared number routed to company: ${matchedCompany.name} (via contact phone match)`);
          } else if (matchingCompanies.length > 1) {
            console.warn(`[Telnyx SMS] Ambiguous contact match: ${matchingCompanies.length} companies have a contact with phone ${fromNumber}. Sending to exception queue.`);
            await storage.createMessageException({
              providerMessageId: messageId,
              fromAddress: fromNumber,
              toAddress: toNumber,
              body: textBody,
              rawPayload: payload as Record<string, unknown>,
              reason: `Ambiguous contact match: ${matchingCompanies.length} tenants have a contact with phone ${fromNumber}`,
              candidateCompanyIds: matchingCompanies.map(c => c.id),
            });
            return res.status(200).json({ ok: true });
          } else {
            console.warn(`[Telnyx SMS] No routing or contact match for from=${fromNumber} on shared number. Sending to exception queue.`);
            await storage.createMessageException({
              providerMessageId: messageId,
              fromAddress: fromNumber,
              toAddress: toNumber,
              body: textBody,
              rawPayload: payload as Record<string, unknown>,
              reason: `No tenant match found for sender ${fromNumber} on shared number`,
              candidateCompanyIds: [],
            });
            return res.status(200).json({ ok: true });
          }
        }
      }

      if (!matchedCompany) {
        const checkedNumbers = allCompanies.map(c => `${c.name}: telnyx=${c.telnyxPhoneNumber || "none"}, dedicated=${c.dedicatedPhoneNumber || "none"}`).join("; ");
        console.warn(`[Telnyx SMS] WARNING: No company matched for to number: ${toNumber} (digits: ${toDigits}). Checked: ${checkedNumbers}`);
        return res.status(200).json({ ok: true });
      }

      console.log(`[Telnyx SMS] Matched company: ${matchedCompany.name} (id: ${matchedCompany.id})`);

      const companyId = matchedCompany.id;

      if (messageId) {
        const existing = await storage.getMessages(companyId, { phone: fromNumber });
        if (existing.some(m => m.externalId === messageId)) {
          console.log(`[Telnyx SMS] Duplicate message ${messageId}, skipping`);
          return res.status(200).json({ ok: true });
        }
      }

      const allContacts = await storage.getContacts(companyId);
      const fromDigits = fromNumber.replace(/\D/g, "");
      const matchedContact = allContacts.find(c => {
        const cDigits = (c.phone || "").replace(/\D/g, "");
        return cDigits.length >= 10 && fromDigits.length >= 10 && fromDigits.endsWith(cDigits.slice(-10));
      });

      console.log(`[Telnyx SMS] Contact match: ${matchedContact ? `${matchedContact.firstName} ${matchedContact.lastName} (id: ${matchedContact.id})` : "no match found"} for from number: ${fromNumber}`);

      const savedMsg = await storage.createMessage({
        companyId,
        contactId: matchedContact?.id || null,
        channel: "sms",
        direction: "inbound",
        status: "received",
        fromAddress: fromNumber,
        toAddress: toNumber,
        body: textBody || "",
        externalId: messageId,
        mediaUrls: [],
        mediaCount: 0,
      });

      if (inboundMedia.length > 0) {
        const { ObjectStorageService } = await import("./replit_integrations/object_storage/objectStorage");
        const ingestStorage = new ObjectStorageService();
        const storedPaths: string[] = [];
        const INBOUND_ALLOWED_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
        const INBOUND_MAX_BYTES = parseInt(process.env.MMS_INBOUND_MAX_FILE_BYTES || String(10 * 1024 * 1024), 10);
        const TELNYX_MEDIA_HOSTS = ["media.telnyx.com", "storage.telnyx.com", "telnyx-mms.s3.amazonaws.com"];

        for (const media of inboundMedia) {
          try {
            let mediaHost: string;
            try {
              mediaHost = new URL(media.url).hostname;
            } catch {
              console.warn(`[Telnyx MMS] Skipping invalid media URL: ${media.url}`);
              continue;
            }
            if (!TELNYX_MEDIA_HOSTS.some(allowed => mediaHost === allowed || mediaHost.endsWith(`.${allowed}`))) {
              console.warn(`[Telnyx MMS] Skipping media from disallowed host ${mediaHost}: ${media.url}`);
              continue;
            }

            if (media.size && media.size > INBOUND_MAX_BYTES) {
              console.warn(`[Telnyx MMS] Skipping oversized media (${media.size} bytes > ${INBOUND_MAX_BYTES}): ${media.url}`);
              continue;
            }

            if (media.content_type && !INBOUND_ALLOWED_MIME.includes(media.content_type)) {
              console.warn(`[Telnyx MMS] Skipping disallowed MIME type ${media.content_type}: ${media.url}`);
              continue;
            }

            const mediaResp = await fetch(media.url);
            if (!mediaResp.ok) {
              console.warn(`[Telnyx MMS] Failed to download media from ${media.url}: ${mediaResp.status}`);
              continue;
            }

            const contentLength = parseInt(mediaResp.headers.get("content-length") || "0", 10);
            if (contentLength > INBOUND_MAX_BYTES) {
              console.warn(`[Telnyx MMS] Skipping oversized media (content-length ${contentLength} > ${INBOUND_MAX_BYTES}): ${media.url}`);
              continue;
            }

            const mediaBuffer = Buffer.from(await mediaResp.arrayBuffer());
            if (mediaBuffer.length > INBOUND_MAX_BYTES) {
              console.warn(`[Telnyx MMS] Skipping oversized downloaded media (${mediaBuffer.length} bytes): ${media.url}`);
              continue;
            }

            const detectedMime = media.content_type || mediaResp.headers.get("content-type") || "application/octet-stream";
            if (!INBOUND_ALLOWED_MIME.includes(detectedMime)) {
              console.warn(`[Telnyx MMS] Skipping disallowed detected MIME ${detectedMime}: ${media.url}`);
              continue;
            }
            const mediaSize = mediaBuffer.length;

            const uploadURL = await ingestStorage.getObjectEntityUploadURL();
            const storagePath = ingestStorage.normalizeObjectEntityPath(uploadURL);

            const putResp = await fetch(uploadURL, {
              method: "PUT",
              body: mediaBuffer,
              headers: { "Content-Type": detectedMime },
            });
            if (!putResp.ok) {
              console.warn(`[Telnyx MMS] Failed to upload media to object storage: ${putResp.status}`);
              continue;
            }

            storedPaths.push(storagePath);

            await storage.createMessageAttachment({
              messageId: savedMsg.id,
              companyId,
              mimeType: detectedMime,
              originalFilename: media.url.split("/").pop()?.split("?")[0] || "media",
              originalSizeBytes: media.size || mediaSize,
              compressedSizeBytes: mediaSize,
              storageUrl: storagePath,
            });
          } catch (attachErr) {
            console.error(`[Telnyx MMS] Failed to ingest media from ${media.url}:`, attachErr);
          }
        }

        if (storedPaths.length > 0) {
          try {
            await db.update(messagesTable)
              .set({ mediaUrls: storedPaths, mediaCount: storedPaths.length })
              .where(eq(messagesTable.id, savedMsg.id));
          } catch (updateErr) {
            console.error("[Telnyx MMS] Failed to update message mediaUrls:", updateErr);
          }
          console.log(`[Telnyx MMS] Ingested ${storedPaths.length}/${inboundMedia.length} media to object storage for message ${savedMsg.id}`);
        }
      }

      console.log(`[Telnyx SMS] Message saved successfully for company ${matchedCompany.name}`);

      // Update routing table for shared number (so future inbound messages route correctly)
      if (isSharedNumber(toNumber) && matchedContact) {
        storage.upsertMessageRouting({
          sharedNumber: toNumber,
          customerPhone: fromNumber,
          companyId,
          contactId: matchedContact.id,
          channel: "sms",
          lastUsedAt: new Date(),
        }).catch((err) => console.error("[SMS Routing] Failed to upsert routing on inbound:", err));
      }

      if (matchedContact) {
        notify(companyId, "new_message", "New Text Message", `${matchedContact.firstName} ${matchedContact.lastName} sent a text message.`, `/communications?contactId=${matchedContact.id}`);
      }

      const { logSmsMessage } = await import("./services/sms");
      logSmsMessage(companyId, toNumber, fromNumber, "inbound", messageId, 1).catch(() => {});

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[Telnyx SMS] Webhook error:", err);
      res.status(200).json({ ok: true });
    }
  });

  const inboundEmailUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MMS_MAX_PER_FILE, files: MMS_MAX_ATTACHMENTS },
  });

  app.post("/api/webhooks/sendgrid/inbound", (req: Request, res: Response, next: Function) => {
    inboundEmailUpload.any()(req, res, (err: any) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          console.warn(`[Inbound Email] Attachment too large, processing body without attachments`);
          req.files = [];
          return next();
        }
        if (err.code === "LIMIT_FILE_COUNT") {
          console.warn(`[Inbound Email] Too many attachments, processing with already parsed files`);
          return next();
        }
        console.warn(`[Inbound Email] Multer error: ${err.code}`);
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      }
      if (err) {
        console.error(`[Inbound Email] Upload error:`, err);
        return res.status(400).json({ error: "Failed to parse inbound email" });
      }
      next();
    });
  }, async (req: Request, res: Response) => {
    try {
      const webhookToken = process.env.SENDGRID_INBOUND_WEBHOOK_TOKEN;
      if (!webhookToken && process.env.NODE_ENV === "production") {
        console.error("[Inbound Email] SENDGRID_INBOUND_WEBHOOK_TOKEN not set in production — rejecting request");
        return res.status(503).json({ error: "Inbound email not configured" });
      }
      if (webhookToken) {
        const providedToken = req.query.token || req.headers["x-webhook-token"];
        if (providedToken !== webhookToken) {
          console.warn("[Inbound Email] Invalid or missing webhook token");
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      const from = req.body.from || "";
      const subject = req.body.subject || "";
      const textBody = req.body.text || "";
      const htmlBody = req.body.html || "";

      const fromMatch = from.match(/<([^>]+)>/) || [null, from.trim()];
      const senderEmail = fromMatch[1]?.toLowerCase() || "";

      const allTo = (req.body.to || "").toLowerCase();
      let envelopeTo = "";
      try {
        const envelope = JSON.parse(req.body.envelope || "{}");
        envelopeTo = (Array.isArray(envelope.to) ? envelope.to.join(" ") : envelope.to || "").toLowerCase();
      } catch { /* ignore */ }

      const combinedTo = `${allTo} ${envelopeTo}`;
      let threadId: string | null = null;
      const replyPattern = /reply\+([a-f0-9]+)@/gi;
      let match;
      while ((match = replyPattern.exec(combinedTo)) !== null) {
        threadId = match[1];
        break;
      }

      if (!threadId) {
        console.log(`[Inbound Email] No thread ID found in to addresses: ${combinedTo.substring(0, 200)}`);
        return res.status(200).json({ ok: true });
      }

      if (!senderEmail) {
        console.log("[Inbound Email] No sender email found");
        return res.status(200).json({ ok: true });
      }

      console.log(`[Inbound Email] Processing reply from ${senderEmail}, threadId=${threadId}`);

      const threadMessages = await storage.getMessagesByEmailThreadId(threadId);
      if (threadMessages.length === 0) {
        console.warn(`[Inbound Email] No existing thread found for threadId=${threadId}`);
        return res.status(200).json({ ok: true });
      }

      const originalMsg = threadMessages[0];
      const companyId = originalMsg.companyId;
      const contactId = originalMsg.contactId;

      if (contactId) {
        const contact = await storage.getContact(contactId, companyId);
        if (contact?.email && contact.email.toLowerCase() !== senderEmail) {
          console.warn(`[Inbound Email] Sender mismatch: expected=${contact.email}, got=${senderEmail}, thread=${threadId}`);
        }
      }

      const inboundBody = textBody || htmlBody || "";
      const dedupeWindowMs = 60_000;
      const now = Date.now();
      const isDuplicate = threadMessages.some(m => {
        if (m.direction !== "inbound" || m.fromAddress !== senderEmail) return false;
        const msgAge = now - new Date(m.createdAt).getTime();
        return msgAge < dedupeWindowMs && m.body === inboundBody;
      });
      if (isDuplicate) {
        console.log(`[Inbound Email] Duplicate inbound email skipped (within ${dedupeWindowMs}ms) for thread ${threadId}`);
        return res.status(200).json({ ok: true });
      }

      const savedMsg = await storage.createMessage({
        companyId,
        contactId: contactId || null,
        channel: "email",
        direction: "inbound",
        status: "received",
        fromAddress: senderEmail,
        toAddress: originalMsg.fromAddress,
        subject: subject || originalMsg.subject || "",
        body: textBody || htmlBody || "",
        htmlBody: htmlBody || null,
        emailThreadId: threadId,
        isRead: false,
      });

      const files = req.files as Express.Multer.File[] | undefined;
      if (files && files.length > 0) {
        const ALLOWED_EMAIL_ATTACH_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
        const EMAIL_MAX_ATTACH_BYTES = parseInt(process.env.MMS_MAX_FILE_BYTES || String(5 * 1024 * 1024), 10);
        const EMAIL_MAX_ATTACHMENTS = parseInt(process.env.MMS_MAX_ATTACHMENTS || "5", 10);

        try {
          const { ObjectStorageService } = await import("./replit_integrations/object_storage/objectStorage");
          const objStorage = new ObjectStorageService();
          const storedUrls: string[] = [];

          let attachCount = 0;
          let totalBytes = 0;
          const EMAIL_MAX_TOTAL_BYTES = parseInt(process.env.MMS_MAX_TOTAL_BYTES || String(10 * 1024 * 1024), 10);
          for (const file of files) {
            if (attachCount >= EMAIL_MAX_ATTACHMENTS) {
              console.log(`[Inbound Email] Attachment limit reached (${EMAIL_MAX_ATTACHMENTS}), skipping remaining`);
              break;
            }
            if (totalBytes + file.size > EMAIL_MAX_TOTAL_BYTES) {
              console.log(`[Inbound Email] Total payload limit reached (${EMAIL_MAX_TOTAL_BYTES}), skipping remaining`);
              break;
            }
            if (!ALLOWED_EMAIL_ATTACH_MIME.includes(file.mimetype)) {
              console.log(`[Inbound Email] Skipping attachment with unsupported MIME: ${file.mimetype}`);
              continue;
            }
            if (file.size > EMAIL_MAX_ATTACH_BYTES) {
              console.log(`[Inbound Email] Skipping oversized attachment: ${file.size} bytes`);
              continue;
            }

            const uploadURL = await objStorage.getObjectEntityUploadURL();
            const storagePath = objStorage.normalizeObjectEntityPath(uploadURL);

            const putResp = await fetch(uploadURL, {
              method: "PUT",
              body: file.buffer,
              headers: { "Content-Type": file.mimetype },
            });
            if (!putResp.ok) {
              console.warn(`[Inbound Email] Failed to upload attachment: ${putResp.status}`);
              continue;
            }

            storedUrls.push(storagePath);
            attachCount++;
            totalBytes += file.size;
            await storage.createMessageAttachment({
              messageId: savedMsg.id,
              companyId,
              mimeType: file.mimetype,
              originalFilename: file.originalname || "attachment",
              originalSizeBytes: file.size,
              compressedSizeBytes: file.size,
              storageUrl: storagePath,
            });
          }

          if (storedUrls.length > 0) {
            await db.update(messagesTable)
              .set({ mediaUrls: storedUrls, mediaCount: storedUrls.length })
              .where(eq(messagesTable.id, savedMsg.id));
          }
        } catch (attachErr) {
          console.error("[Inbound Email] Attachment processing error:", attachErr);
        }
      }

      console.log(`[Inbound Email] Saved inbound email in thread ${threadId} for company ${companyId}`);

      if (contactId) {
        const contact = await storage.getContact(contactId, companyId);
        if (contact) {
          notify(companyId, "new_message", "New Email Reply", `${contact.firstName} ${contact.lastName} replied to an email.`, `/communications`);
        }
      }

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[Inbound Email] Webhook error:", err);
      res.status(200).json({ ok: true });
    }
  });

  app.post("/api/webhooks/quickbooks", async (req: Request, res: Response) => {
    try {
      const verifierToken = process.env.QBO_WEBHOOK_VERIFIER_TOKEN;
      const signature = req.headers["intuit-signature"] as string | undefined;

      if (verifierToken) {
        if (!signature) {
          console.warn("[QBO Webhook] Missing intuit-signature header");
          return res.status(401).json({ error: "Missing signature" });
        }
        const crypto = await import("crypto");
        const rawBody = (req as any).rawBody;
        const hash = crypto.createHmac("sha256", verifierToken)
          .update(rawBody)
          .digest("base64");
        const hashBuf = Buffer.from(hash);
        const sigBuf = Buffer.from(signature);
        if (hashBuf.length !== sigBuf.length || !crypto.timingSafeEqual(hashBuf, sigBuf)) {
          console.warn("[QBO Webhook] Signature mismatch");
          return res.status(401).json({ error: "Invalid signature" });
        }
      } else {
        if (process.env.NODE_ENV === "production") {
          console.error("[QBO Webhook] QBO_WEBHOOK_VERIFIER_TOKEN not set in production — rejecting request");
          return res.status(401).json({ error: "Webhook verification not configured" });
        }
        console.warn("[QBO Webhook] QBO_WEBHOOK_VERIFIER_TOKEN not set — skipping signature verification (dev only)");
      }

      const payload = req.body;
      if (payload?.eventNotifications) {
        const { lookupCompanyByRealmId, processWebhookEntity } = await import("./services/quickbooks");
        for (const notification of payload.eventNotifications) {
          const realmId = notification.realmId;
          const companyId = await lookupCompanyByRealmId(realmId);
          if (!companyId) {
            console.warn(`[QBO Webhook] No company found for realmId=${realmId}`);
            continue;
          }
          const entities = notification.dataChangeEvent?.entities || [];
          for (const entity of entities) {
            console.log(`[QBO Webhook] realmId=${realmId} company=${companyId} operation=${entity.operation} entity=${entity.name} id=${entity.id}`);
            processWebhookEntity(companyId, entity.name, String(entity.id), entity.operation)
              .catch((err: any) => console.error(`[QBO Webhook] Async processing failed:`, err.message));
          }
        }
      }

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[QBO Webhook] Error:", err);
      res.status(200).json({ ok: true });
    }
  });

  app.post("/api/webhooks/retell", async (req: Request, res: Response) => {
    try {
      const retellApiKey = process.env.RETELL_API_KEY;
      if (retellApiKey) {
        const signature = req.headers["x-retell-signature"] as string | undefined;
        if (!signature) {
          console.warn("[Retell Webhook] Missing x-retell-signature header");
          return res.status(200).json({ ok: true });
        }
        const crypto = await import("crypto");
        const rawBody = (req as any).rawBody || JSON.stringify(req.body);
        const expectedSignature = crypto.createHmac("sha256", retellApiKey)
          .update(rawBody)
          .digest("hex");
        const sigBuf = Buffer.from(signature);
        const expectedBuf = Buffer.from(expectedSignature);
        if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
          console.warn("[Retell Webhook] Signature mismatch");
          return res.status(200).json({ ok: true });
        }
      } else {
        console.warn("[Retell Webhook] RETELL_API_KEY not set — skipping signature verification");
      }

      const payload = req.body;
      const eventType = payload?.event;
      const callData = payload?.call;

      if (!callData || !eventType) {
        return res.status(200).json({ ok: true });
      }

      if (eventType !== "call_ended" && eventType !== "call_analyzed") {
        console.log(`[Retell Webhook] Ignoring event: ${eventType}`);
        return res.status(200).json({ ok: true });
      }

      const retellCallId = callData.call_id;
      if (!retellCallId) {
        return res.status(200).json({ ok: true });
      }

      const agentPhone = (callData.to_number || callData.agent_id || "").replace(/\D/g, "");
      const durationMs = callData.end_timestamp && callData.start_timestamp
        ? callData.end_timestamp - callData.start_timestamp
        : 0;
      const durationSeconds = Math.round(durationMs / 1000);
      const durationMinutes = durationSeconds > 0 ? Math.ceil(durationSeconds / 60) : 0;
      const outcome = callData.call_analysis?.call_successful ? "successful" : (callData.disconnection_reason || "unknown");
      const summary = callData.call_analysis?.call_summary || null;

      const existing = await storage.getVoiceCallByRetellId(retellCallId);

      if (existing) {
        if (eventType === "call_analyzed" && callData.call_analysis) {
          await storage.updateVoiceCall(existing.id, {
            outcome,
            summary,
            metadata: {
              ...(existing.metadata as Record<string, any> || {}),
              callAnalysis: callData.call_analysis,
            },
          });
          console.log(`[Retell Webhook] Updated analysis for call ${retellCallId}`);
        } else {
          console.log(`[Retell Webhook] Call ${retellCallId} already recorded, skipping`);
        }
        return res.status(200).json({ ok: true });
      }

      const allCompanies = await storage.listCompanies();
      const matchedCompany = allCompanies.find(c => {
        const cDigits = (c.dedicatedPhoneNumber || "").replace(/\D/g, "");
        return cDigits.length >= 10 && agentPhone.length >= 10 && agentPhone.endsWith(cDigits.slice(-10));
      });

      if (!matchedCompany) {
        console.warn(`[Retell Webhook] No company matched for agent phone ${agentPhone}, call ${retellCallId}`);
        return res.status(200).json({ ok: true });
      }

      const companyId = matchedCompany.id;

      await storage.createVoiceCall({
        companyId,
        retellCallId,
        callerPhone: callData.from_number || null,
        agentPhone: callData.to_number || null,
        durationSeconds,
        durationMinutes,
        outcome,
        summary,
        metadata: {
          disconnectionReason: callData.disconnection_reason,
          callAnalysis: callData.call_analysis,
        },
      });

      if (durationMinutes > 0) {
        await storage.createUsageEvent({
          companyId,
          eventType: "voice_minute",
          quantity: durationMinutes,
          metadata: { retellCallId, durationSeconds, callerPhone: callData.from_number },
        });

        const voiceSubId = matchedCompany.stripeVoiceSubscriptionId || matchedCompany.stripeSubscriptionId;
        if (voiceSubId) {
          reportMeteredUsage(voiceSubId, "voice_minute", durationMinutes).catch(err =>
            console.error(`[Retell Webhook] Failed to report metered usage:`, err.message)
          );
        }
      }

      console.log(`[Retell Webhook] Recorded call ${retellCallId} for company ${matchedCompany.name} (${companyId}): ${durationMinutes} min(s)`);
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[Retell Webhook] Error:", err);
      res.status(200).json({ ok: true });
    }
  });

  // Send invoice via email
  app.post("/api/invoices/:id/send-email", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const invoice = await storage.getInvoice(req.params.id, companyId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.status === "paid") return res.status(400).json({ error: "Invoice is already paid" });

      const contact = await storage.getContact(invoice.contactId, companyId);
      if (!contact?.email) return res.status(400).json({ error: "Contact has no email address" });

      const company = await storage.getCompany(companyId);
      const lineItems = await storage.getInvoiceLineItems(invoice.id);

      let paymentUrl: string | undefined;
      if (isStripeConfigured() && parseFloat(invoice.total) > 0) {
        try {
          let stripeCustomerId = contact.stripeCustomerId;
          const connectAccountId = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;
          const contactName = `${contact.firstName} ${contact.lastName}`.trim();
          const { customerId: resolvedCustId, wasRecreated } = await ensureConnectedCustomer({
            currentCustomerId: contact.stripeCustomerId,
            stripeAccount: connectAccountId,
            email: contact.email || undefined,
            name: contactName,
            metadata: { contactId: contact.id, companyId },
          });
          if (wasRecreated) {
            await storage.updateContact(contact.id, companyId, { stripeCustomerId: resolvedCustId });
          }
          stripeCustomerId = resolvedCustId;

          const baseUrl = getBaseUrl(req);
          const checkoutResult = await createCheckoutSession({
            customerId: stripeCustomerId,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            amount: parseFloat(invoice.total),
            successUrl: `${baseUrl}/portal?paid=${invoice.id}`,
            cancelUrl: `${baseUrl}/portal`,
            stripeConnectAccountId: connectAccountId,
            tenantId: companyId,
          });
          paymentUrl = checkoutResult.url;
        } catch (stripeErr: any) {
          console.error("[send-email] Could not generate Stripe checkout URL, sending without payment link:", stripeErr?.message || stripeErr);
        }
      }

      const properties = await storage.getProperties(companyId, contact.id);
      const serviceAddr = properties.length > 0 ? properties[0] : null;
      const taxRateNum = parseFloat(invoice.taxRate || "0") / 100;
      const discountNum = parseFloat(invoice.discountAmount || "0");
      const paidNum = invoice.paidAt ? parseFloat(invoice.total) : 0;
      const logoUrl = company?.logoUrl ? `${getBaseUrl(req)}${company.logoUrl}` : "";

      const fromAddress = company?.email || "jeremy@scoopilot.com";

      const emailFormattedDueDate = invoice.dueDate
        ? new Date(invoice.dueDate + "T12:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
        : "";

      const emailBillingAddr = contact.streetAddress ? {
        line1: contact.streetAddress,
        line2: contact.address2 || "",
        city: contact.city || "",
        state: contact.state || "",
        zip: contact.zipCode || "",
      } : null;
      const emailServiceAddr = serviceAddr ? {
        line1: serviceAddr.streetAddress || "",
        line2: "",
        city: serviceAddr.city || "",
        state: serviceAddr.state || "",
        zip: serviceAddr.zipCode || "",
      } : null;
      const emailBillingLine = emailBillingAddr ? `${emailBillingAddr.line1} ${emailBillingAddr.city} ${emailBillingAddr.state} ${emailBillingAddr.zip}`.trim() : "";
      const emailServiceLine = emailServiceAddr ? `${emailServiceAddr.line1} ${emailServiceAddr.city} ${emailServiceAddr.state} ${emailServiceAddr.zip}`.trim() : "";
      const emailShowServiceAddr = emailServiceAddr && emailServiceLine && emailServiceLine !== emailBillingLine;

      const invoiceData = {
        business: {
          name: company?.name || "",
          address: company?.address || "",
          phone: company?.phone || "",
          website: "",
          logo: logoUrl,
        },
        invoice: {
          number: invoice.invoiceNumber,
          status: invoice.status || "pending",
          issue_date: new Date(invoice.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
          due_date: emailFormattedDueDate,
          terms: "Net 30",
          service_period: "",
        },
        customer: {
          name: `${contact.firstName} ${contact.lastName || ""}`.trim(),
        },
        billing_address: emailBillingAddr,
        service_address: emailServiceAddr,
        show_service_address: emailShowServiceAddr ? emailServiceAddr : null,
        line_items: lineItems.map(li => ({
          description: li.description,
          details: "",
          qty: li.quantity,
          unit_price: parseFloat(li.unitPrice),
          line_total: parseFloat(li.total),
        })),
        totals: {
          subtotal: parseFloat(invoice.subtotal),
          discount: discountNum,
          tax_rate: taxRateNum,
          paid: paidNum,
        },
        visits: undefined as { date: string; time: string; status: string }[] | undefined,
        notes: "",
        payment_instructions: "",
        thank_you: "Thank you for your business!",
        hasFooter: true,
        paymentUrl: paymentUrl || "",
        venmoHandle: company?.venmoHandle || "",
        venmoHandleOnly: !paymentUrl && !!company?.venmoHandle ? company.venmoHandle : "",
      };

      const computed = computeInvoice(invoiceData);
      const tpl = loadTemplate(getDefaultTemplatePath());
      const defaultTheme = loadTheme(getDefaultThemePath());
      let theme = defaultTheme;
      if (company?.invoiceTheme) {
        try {
          const custom = JSON.parse(company.invoiceTheme);
          theme = { ...defaultTheme, ...custom };
        } catch {}
      }
      const renderedHtml = renderInvoice(tpl, theme, computed);

      const subject = `Invoice ${invoice.invoiceNumber} from ${company?.name || "ScooPilot"}`;
      const venmoTextLine = company?.venmoHandle ? `\nOr pay via Venmo: @${company.venmoHandle}` : "";
      const textBody = `Hi ${contact.firstName},\n\nYou have a new invoice from ${company?.name || "ScooPilot"}.\n\nInvoice #: ${invoice.invoiceNumber}\nDue Date: ${invoice.dueDate}\nTotal: $${invoice.total}\n\nItems:\n${lineItems.map(li => `  - ${li.description}: $${li.total}`).join("\n")}${paymentUrl ? `\n\nPay online: ${paymentUrl}` : ""}${venmoTextLine}\n\nThank you for your business!`;

      const msg = await storage.createMessage({
        companyId,
        contactId: contact.id,
        channel: "email",
        direction: "outbound",
        status: "queued",
        fromAddress,
        toAddress: contact.email,
        subject,
        body: textBody,
        htmlBody: renderedHtml,
        sentBy: userId,
        metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
      });

      console.log(`[send-email] Sending invoice ${invoice.invoiceNumber} to ${contact.email} from ${fromAddress}`);
      const result = await sendEmail({
        companyId: companyId,
        to: contact.email,
        from: fromAddress,
        subject,
        text: textBody,
        html: renderedHtml,
        senderName: company?.name || undefined,
        replyTo: company?.email || undefined,
      });

      if (result.success) {
        console.log(`[send-email] Successfully sent invoice ${invoice.invoiceNumber} to ${contact.email}`);
        await storage.updateMessageStatus(msg.id, "sent");
        if (invoice.status === "pending" || invoice.status === "draft") {
          await storage.updateInvoice(invoice.id, companyId, { status: "sent" });
        }
        res.json({ success: true, messageId: msg.id, paymentUrl: paymentUrl || null });
      } else {
        console.error(`[send-email] Failed to send invoice ${invoice.invoiceNumber}: ${result.error}`);
        await storage.updateMessageStatus(msg.id, "failed", result.error);
        res.status(500).json({ error: result.error });
      }
    } catch (err) { handleError(res, err); }
  });

  // ================ Stripe Payment Routes ================

  app.get("/api/stripe/config", isAuthenticated, async (_req: Request, res: Response) => {
    res.json({ configured: isStripeConfigured() });
  });

  app.post("/api/contacts/:id/stripe-customer", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      if (contact.stripeCustomerId) {
        return res.json({ stripeCustomerId: contact.stripeCustomerId, alreadyExists: true });
      }

      const company = await storage.getCompany(companyId);
      const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;
      const stripeCustomerId = await createStripeCustomer({
        email: contact.email || undefined,
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        phone: contact.phone || undefined,
        metadata: { contactId: contact.id, companyId },
        stripeAccount: connectAcct,
      });

      await storage.updateContact(req.params.id, companyId, { stripeCustomerId });
      res.json({ stripeCustomerId, alreadyExists: false });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/contacts/:id/send-payment-reminder", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const company = await storage.getCompany(companyId);
      const contactInvoices = await storage.getInvoices(companyId, { contactId: contact.id });
      const outstanding = contactInvoices.filter(inv => ["pending", "sent"].includes(inv.status));
      const totalOwed = outstanding.reduce((sum, inv) => sum + parseFloat(inv.total || "0"), 0);

      if (outstanding.length === 0) {
        return res.status(400).json({ error: "Contact has no outstanding invoices" });
      }

      const contactName = contact.firstName || "there";
      const companyName = company?.name || "Your service provider";
      const baseUrl = getBaseUrl(req);
      const portalUrl = `${baseUrl}/portal`;

      let smsSent = false;
      let emailSent = false;

      if (contact.phone && await isSmsConfiguredForCompany(companyId)) {
        const body = `Hi ${contactName}, you have an outstanding balance of $${totalOwed.toFixed(2)} with ${companyName}. Please visit ${portalUrl} to pay online. Reply STOP to opt out.`;
        await sendSmsForCompany({ to: contact.phone, body, companyId, contactId: contact.id });
        smsSent = true;
      }

      if (contact.email && !smsSent) {
        const subject = `Payment Reminder from ${companyName}`;
        const text = `Hi ${contactName},\n\nThis is a reminder that you have an outstanding balance of $${totalOwed.toFixed(2)} with ${companyName}.\n\nPay online at: ${portalUrl}\n\nThank you!`;
        const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;"><h3>Payment Reminder</h3><p>Hi ${contactName},</p><p>This is a friendly reminder that you have an outstanding balance of <strong>$${totalOwed.toFixed(2)}</strong> with ${companyName}.</p><p><a href="${portalUrl}" style="background:#2d8a5e;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block;">Pay Online</a></p><p>Thank you!</p></div>`;
        await sendEmail({ companyId, to: contact.email, subject, text, html, senderName: company?.name });
        emailSent = true;
      }

      if (!smsSent && !emailSent) {
        return res.status(400).json({ error: "Contact has no phone or email to send a reminder to" });
      }

      res.json({ success: true, smsSent, emailSent, totalOwed });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/contacts/:id/setup-intent", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      if (!contact.stripeCustomerId) return res.status(400).json({ error: "Contact has no Stripe customer. Create one first." });

      const company = await storage.getCompany(companyId);
      const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;
      const contactName = `${contact.firstName} ${contact.lastName}`.trim();
      const { customerId: resolvedCustId, wasRecreated } = await ensureConnectedCustomer({
        currentCustomerId: contact.stripeCustomerId,
        stripeAccount: connectAcct,
        email: contact.email || undefined,
        name: contactName,
        metadata: { contactId: contact.id, companyId },
      });
      if (wasRecreated) {
        await storage.updateContact(req.params.id, companyId, { stripeCustomerId: resolvedCustId });
      }
      const result = await createSetupIntent(resolvedCustId, connectAcct);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/contacts/:id/payment-methods", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      if (!contact.stripeCustomerId) return res.json([]);

      const company = await storage.getCompany(companyId);
      const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;
      const contactName = `${contact.firstName} ${contact.lastName}`.trim();
      const { customerId: resolvedCustId, wasRecreated } = await ensureConnectedCustomer({
        currentCustomerId: contact.stripeCustomerId,
        stripeAccount: connectAcct,
        email: contact.email || undefined,
        name: contactName,
        metadata: { contactId: contact.id, companyId },
      });
      if (wasRecreated) {
        await storage.updateContact(req.params.id, companyId, { stripeCustomerId: resolvedCustId });
      }
      const methods = await getCustomerPaymentMethods(resolvedCustId, connectAcct);
      res.json(methods);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/payment-methods/:pmId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contactId = req.query.contactId as string;
      if (!contactId) return res.status(400).json({ error: "contactId query parameter is required" });

      const contact = await storage.getContact(contactId, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      if (!contact.stripeCustomerId) return res.status(400).json({ error: "Contact has no payment methods" });

      const company = await storage.getCompany(companyId);
      const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;
      const contactName = `${contact.firstName} ${contact.lastName}`.trim();
      const { customerId: resolvedCustId, wasRecreated } = await ensureConnectedCustomer({
        currentCustomerId: contact.stripeCustomerId,
        stripeAccount: connectAcct,
        email: contact.email || undefined,
        name: contactName,
        metadata: { contactId: contact.id, companyId },
      });
      if (wasRecreated) {
        await storage.updateContact(contactId, companyId, { stripeCustomerId: resolvedCustId });
      }

      const methods = await getCustomerPaymentMethods(resolvedCustId, connectAcct);
      const owns = methods.some((m) => m.id === req.params.pmId);
      if (!owns) return res.status(403).json({ error: "Payment method not found for this contact" });

      await detachPaymentMethod(req.params.pmId, connectAcct);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/invoices/:id/charge", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const invoice = await storage.getInvoice(req.params.id, companyId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.status === "paid") return res.status(400).json({ error: "Invoice already paid" });

      const contact = await storage.getContact(invoice.contactId, companyId);
      if (!contact?.stripeCustomerId) return res.status(400).json({ error: "Contact has no payment method on file" });

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
      if (wasRecreated) {
        await storage.updateContact(contact.id, companyId, { stripeCustomerId: resolvedCustomerId });
      }

      const result = await chargeInvoiceAutomatically({
        customerId: resolvedCustomerId,
        amount: parseFloat(invoice.total),
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        stripeConnectAccountId: connectAcct,
        tenantId: companyId,
        currency: company?.currency || "usd",
      });

      const updateData: any = {
        paymentAttempts: (invoice.paymentAttempts || 0) + 1,
        lastPaymentAttempt: new Date(),
      };

      if (result.status === "succeeded") {
        updateData.status = "paid";
        updateData.paidAt = new Date();
        updateData.stripePaymentIntentId = result.paymentIntentId;
        notify(companyId, "invoice_paid", "Invoice Paid", `Invoice #${invoice.invoiceNumber} has been paid ($${invoice.total}).`, `/invoices`);
        qboAutoSync(companyId, invoice.id, "payment");
      } else {
        updateData.status = "failed";
        if (result.paymentIntentId) updateData.stripePaymentIntentId = result.paymentIntentId;
        notify(companyId, "payment_failed", "Payment Failed", `Payment failed for invoice #${invoice.invoiceNumber}.`, `/invoices`);
      }

      const updated = await storage.updateInvoice(invoice.id, companyId, updateData);
      const { userId: chargeUserId } = await getCompanyContext(req);
      auditLog(companyId, chargeUserId, "invoice", invoice.id, "update", {
        old: { status: invoice.status, paymentAttempts: invoice.paymentAttempts },
        new: { status: updated.status, paymentAttempts: updated.paymentAttempts, chargeResult: result.status },
      }, req.ip || undefined);
      res.json({ ...updated, chargeResult: result });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/invoices/:id/checkout", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const invoice = await storage.getInvoice(req.params.id, companyId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.status === "paid") return res.status(400).json({ error: "Invoice already paid" });

      const contact = await storage.getContact(invoice.contactId, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const company = await storage.getCompany(companyId);
      const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;

      const contactName = `${contact.firstName} ${contact.lastName}`.trim();
      const { customerId: stripeCustomerId, wasRecreated } = await ensureConnectedCustomer({
        currentCustomerId: contact.stripeCustomerId,
        stripeAccount: connectAcct,
        email: contact.email || undefined,
        name: contactName,
        metadata: { contactId: contact.id, companyId },
      });
      if (wasRecreated) {
        await storage.updateContact(contact.id, companyId, { stripeCustomerId });
      }

      const baseUrl = getBaseUrl(req);
      const result = await createCheckoutSession({
        customerId: stripeCustomerId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        amount: parseFloat(invoice.total),
        successUrl: `${baseUrl}/invoices?paid=${invoice.id}`,
        cancelUrl: `${baseUrl}/invoices`,
        stripeConnectAccountId: connectAcct,
        tenantId: companyId,
        currency: company?.currency || "usd",
      });

      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  // ================ Stripe Connect Routes ================

  app.post("/api/stripe-connect/onboard", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      if (!isStripeConfigured()) return res.status(400).json({ error: "Stripe is not configured" });

      let accountId = company.stripeConnectAccountId;

      if (!accountId) {
        accountId = await createConnectAccount(companyId, company.name, company.email || "");
        await storage.updateCompany(companyId, { stripeConnectAccountId: accountId } as any);
      }

      const protocol = req.get("host")?.includes("localhost") ? "http" : "https";
      const baseUrl = `${protocol}://${req.get("host")}`;
      const onboardingUrl = await createConnectAccountLink(
        accountId,
        `${baseUrl}/settings?stripe_connect=refresh`,
        `${baseUrl}/settings?stripe_connect=return`
      );

      res.json({ url: onboardingUrl, accountId });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/stripe-connect/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      if (!company.stripeConnectAccountId) {
        return res.json({ status: "not_started", chargesEnabled: false, detailsSubmitted: false, payoutsEnabled: false });
      }

      try {
        const accountStatus = await getConnectAccountStatus(company.stripeConnectAccountId);

        if (accountStatus.chargesEnabled !== company.stripeConnectOnboarded) {
          await storage.updateCompany(companyId, { stripeConnectOnboarded: accountStatus.chargesEnabled } as any);
        }

        return res.json({
          status: accountStatus.chargesEnabled ? "connected" : "pending",
          ...accountStatus,
        });
      } catch (stripeErr) {
        return res.json({ status: "error", chargesEnabled: false, detailsSubmitted: false, payoutsEnabled: false });
      }
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/stripe-connect/dashboard-link", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      if (!company.stripeConnectAccountId) return res.status(400).json({ error: "No Stripe Connect account" });

      try {
        const url = await createConnectLoginLink(company.stripeConnectAccountId);
        res.json({ url });
      } catch (err: any) {
        if (err.message?.includes("not a Standard account") || err.type === "StripeInvalidRequestError") {
          const protocol = req.get("host")?.includes("localhost") ? "http" : "https";
          const baseUrl = `${protocol}://${req.get("host")}`;
          const onboardingUrl = await createConnectAccountLink(
            company.stripeConnectAccountId,
            `${baseUrl}/settings?stripe_connect=refresh`,
            `${baseUrl}/settings?stripe_connect=return`
          );
          return res.json({ url: onboardingUrl, isOnboarding: true });
        }
        throw err;
      }
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/stripe-connect/disconnect", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      await storage.updateCompany(companyId, {
        stripeConnectAccountId: null,
        stripeConnectOnboarded: false,
      } as any);
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/webhooks/stripe", async (req: Request, res: Response) => {
    try {
      const sig = req.headers["stripe-signature"] as string;
      const secrets = [
        process.env.STRIPE_WEBHOOK_SECRET,
        process.env.STRIPE_WEBHOOK_SECRET_SCOOPILOT_SITE,
        process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
      ].filter(Boolean) as string[];

      if (!sig || secrets.length === 0) {
        return res.status(400).json({ error: "Missing signature or webhook secret" });
      }

      let event;
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      for (const secret of secrets) {
        try {
          event = constructWebhookEvent(rawBody, sig, secret);
          break;
        } catch {
        }
      }
      if (!event) {
        console.error("Stripe webhook signature verification failed against all configured secrets");
        return res.status(400).json({ error: "Webhook signature verification failed" });
      }

      const connectAccountId = (event as any).account as string | undefined;
      if (connectAccountId) {
        console.log(`[Stripe Webhook] Connect event ${event.id} (${event.type}) from account ${connectAccountId}`);
      }

      const [alreadyProcessed] = await db.select({ id: stripeEvents.id }).from(stripeEvents).where(eq(stripeEvents.id, event.id)).limit(1);
      if (alreadyProcessed) {
        console.log(`[Stripe Webhook] Duplicate event ${event.id} (${event.type}) — skipping`);
        return res.json({ received: true });
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as any;
        const meta = session.metadata || {};
        const tenantId = meta.tenant_id;

        if (meta.checkout_type === "voice_addon" && tenantId) {
          const voicePlan = meta.voice_plan as "voice_starter" | "voice_pro";
          if (voicePlan && VOICE_PLAN_CONFIG[voicePlan]) {
            const company = await storage.getCompany(tenantId);
            if (company) {
              const planConfig = VOICE_PLAN_CONFIG[voicePlan];
              const companyUpdates: Partial<typeof companies.$inferInsert> = {
                voicePlanTier: voicePlan,
                voicePlanStatus: "active",
                voicePlanIncludedMinutes: planConfig.includedMinutes,
                voicePlanOverageRate: String(planConfig.overageRate),
              };

              const customFields = (session.custom_fields ?? []) as Array<{ key: string; text?: { value?: string } }>;

              if (!company.dedicatedPhoneNumber) {
                const areaCodeField = customFields.find((f) => f.key === "preferred_area_code");
                const areaCode = areaCodeField?.text?.value?.trim() || "703";

                const dedicatedPhoneNumber = await provisionRetellNumber({ areaCode });
                companyUpdates.dedicatedPhoneNumber = dedicatedPhoneNumber;
                console.log(`[Retell] Provisioned number ${dedicatedPhoneNumber} for company "${company.name}" (${company.id})`);
              }

              const websiteField = customFields.find((f) => f.key === "business_website");
              const businessWebsite = websiteField?.text?.value?.trim() || "";

              let kbId: string | null = null;
              if (businessWebsite && company.retellAgentId) {
                try {
                  kbId = await seedRetellKnowledgeBase({
                    tenantId: company.id,
                    agentId: company.retellAgentId,
                    websiteUrl: businessWebsite,
                  });
                  console.log(`[Retell KB] Created knowledge base "${kbId}" for company "${company.name}" (${company.id}) from ${businessWebsite}`);
                } catch (kbErr: any) {
                  console.warn(`[Retell KB] Failed to seed knowledge base for company "${company.name}" (${company.id}): ${kbErr.message}`);
                  notify(tenantId, "system_warning", "Knowledge Base Setup Failed", `Voice plan activated but knowledge base creation from "${businessWebsite}" failed. Please set it up manually. Error: ${kbErr.message}`, `/settings`);
                }
              } else if (businessWebsite && !company.retellAgentId) {
                console.warn(`[Retell KB] Business website provided but no Retell agent ID found for company "${company.name}" (${company.id}). Skipping KB creation.`);
                notify(tenantId, "system_warning", "Knowledge Base Setup Skipped", `A business website was provided during checkout but no Retell agent is linked to your account. Please contact support to set up the knowledge base.`, `/settings`);
              }

              if (kbId) {
                (companyUpdates as Record<string, unknown>).retellKnowledgeBaseId = kbId;
              }

              await db.transaction(async (tx) => {
                await tx.update(companies).set({ ...companyUpdates, updatedAt: new Date() }).where(eq(companies.id, company.id));
              });

              console.log(`[Stripe Voice] checkout.session.completed: activated ${voicePlan} for company "${company.name}" (${company.id})`);
            }
          }
        }

        const invoiceId = meta.invoiceId;
        if (invoiceId) {
          const tipAmount = meta.tipAmount || "0";
          let resolved = false;

          if (tenantId) {
            const invoice = await storage.getInvoice(invoiceId, tenantId);
            if (invoice && invoice.status !== "paid") {
              await db.transaction(async (tx) => {
                await tx.update(invoices).set({
                  status: "paid" as const,
                  paidAt: new Date(),
                  stripePaymentIntentId: session.payment_intent,
                  tipAmount,
                  updatedAt: new Date(),
                }).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, tenantId)));
              });
              const tipNote = parseFloat(tipAmount) > 0 ? ` (includes $${tipAmount} tip)` : "";
              notify(tenantId, "invoice_paid", "Invoice Paid", `Invoice #${invoice.invoiceNumber} has been paid ($${invoice.total})${tipNote}.`, `/invoices`);
              qboAutoSync(tenantId, invoiceId, "payment");
              resolved = true;
            } else if (invoice && invoice.status === "paid") {
              console.log(`[Stripe Webhook] checkout.session.completed: invoice ${invoiceId} already paid — skipping (session ${session.id})`);
              resolved = true;
            }
          }

          if (!resolved && !tenantId && connectAccountId) {
            const connCompany = await storage.getCompanyByStripeConnectAccountId(connectAccountId);
            if (connCompany) {
              const invoice = await storage.getInvoice(invoiceId, connCompany.id);
              if (invoice && invoice.status !== "paid") {
                const resolvedTenantId = connCompany.id;
                await db.transaction(async (tx) => {
                  await tx.update(invoices).set({
                    status: "paid" as const,
                    paidAt: new Date(),
                    stripePaymentIntentId: session.payment_intent,
                    tipAmount,
                    updatedAt: new Date(),
                  }).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, resolvedTenantId)));
                });
                const tipNote = parseFloat(tipAmount) > 0 ? ` (includes $${tipAmount} tip)` : "";
                notify(resolvedTenantId, "invoice_paid", "Invoice Paid", `Invoice #${invoice.invoiceNumber} has been paid ($${invoice.total})${tipNote}.`, `/invoices`);
                qboAutoSync(resolvedTenantId, invoiceId, "payment");
                resolved = true;
                console.log(`[Stripe Webhook] checkout.session.completed: resolved tenant via Connect account ${connectAccountId} → ${connCompany.name} (${connCompany.id})`);
              } else if (invoice && invoice.status === "paid") {
                console.log(`[Stripe Webhook] checkout.session.completed: invoice ${invoiceId} already paid — skipping (session ${session.id})`);
                resolved = true;
              }
            }
          }

          if (!resolved) {
            console.warn(`[Stripe Webhook] checkout.session.completed: could not resolve invoice ${invoiceId} (session ${session.id}, tenant_id=${tenantId || "missing"}, connectAccount=${connectAccountId || "none"}). Manual resolution required.`);
          }
        }
      }

      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object as any;
        const invoiceId = pi.metadata?.invoiceId;
        if (invoiceId) {
          const piTenantId = pi.metadata?.tenant_id;
          let resolved = false;

          if (piTenantId) {
            const invoice = await storage.getInvoice(invoiceId, piTenantId);
            if (invoice && invoice.status !== "paid") {
              await storage.updateInvoice(invoiceId, piTenantId, {
                status: "paid",
                paidAt: new Date(),
                stripePaymentIntentId: pi.id,
              });
              auditLog(piTenantId, null, "invoice", invoiceId, "update", {
                old: { status: invoice.status },
                new: { status: "paid", paymentMethod: "stripe_webhook" },
                actor: "stripe_webhook",
              });
              notify(piTenantId, "invoice_paid", "Invoice Paid", `Invoice #${invoice.invoiceNumber} has been paid ($${invoice.total}).`, `/invoices`);
              qboAutoSync(piTenantId, invoiceId, "payment");
              resolved = true;
            } else if (invoice && invoice.status === "paid") {
              console.log(`[Stripe Webhook] payment_intent.succeeded: invoice ${invoiceId} already paid — skipping (pi ${pi.id})`);
              resolved = true;
            }
          }

          if (!resolved && !piTenantId && connectAccountId) {
            const connCompany = await storage.getCompanyByStripeConnectAccountId(connectAccountId);
            if (connCompany) {
              const invoice = await storage.getInvoice(invoiceId, connCompany.id);
              if (invoice && invoice.status !== "paid") {
                await storage.updateInvoice(invoiceId, connCompany.id, {
                  status: "paid",
                  paidAt: new Date(),
                  stripePaymentIntentId: pi.id,
                });
                auditLog(connCompany.id, null, "invoice", invoiceId, "update", {
                  old: { status: invoice.status },
                  new: { status: "paid", paymentMethod: "stripe_webhook" },
                  actor: "stripe_webhook",
                });
                notify(connCompany.id, "invoice_paid", "Invoice Paid", `Invoice #${invoice.invoiceNumber} has been paid ($${invoice.total}).`, `/invoices`);
                qboAutoSync(connCompany.id, invoiceId, "payment");
                resolved = true;
                console.log(`[Stripe Webhook] payment_intent.succeeded: resolved tenant via Connect account ${connectAccountId} → ${connCompany.name} (${connCompany.id})`);
              } else if (invoice && invoice.status === "paid") {
                console.log(`[Stripe Webhook] payment_intent.succeeded: invoice ${invoiceId} already paid — skipping (pi ${pi.id})`);
                resolved = true;
              }
            }
          }

          if (!resolved) {
            console.warn(`[Stripe Webhook] payment_intent.succeeded: could not resolve invoice ${invoiceId} (pi ${pi.id}, tenant_id=${piTenantId || "missing"}, connectAccount=${connectAccountId || "none"}). Manual resolution required.`);
          }
        }
      }

      if (event.type === "account.updated") {
        const account = event.data.object as any;
        const accountId = account.id;
        if (accountId) {
          const company = await storage.getCompanyByStripeConnectAccountId(accountId);
          if (company) {
            const isOnboarded = account.charges_enabled === true;
            if (isOnboarded !== company.stripeConnectOnboarded) {
              await storage.updateCompany(company.id, { stripeConnectOnboarded: isOnboarded } as any);
              console.log(`[Stripe Connect] Company ${company.name} (${company.id}) onboarded=${isOnboarded}`);
            }
          }
        }
      }

      const eventTs = new Date(event.created * 1000);

      const isStaleSubscriptionEvent = (company: { subscriptionUpdatedAt?: Date | null }): boolean => {
        if (!company.subscriptionUpdatedAt) return false;
        return eventTs <= company.subscriptionUpdatedAt;
      };

      if (event.type === "customer.subscription.created") {
        const subscription = event.data.object as { id: string; customer: string; status: string; metadata: Record<string, string>; trial_end?: number | null; items?: { data?: Array<{ id: string }> } };
        const meta = subscription.metadata || {};

        if (meta.checkout_type === "voice_addon") {
          const tenantId = meta.tenant_id;
          const voicePlan = meta.voice_plan as "voice_starter" | "voice_pro";
          if (tenantId && voicePlan) {
            const company = await storage.getCompany(tenantId);
            if (company) {
              const planConfig = VOICE_PLAN_CONFIG[voicePlan];
              const isSubscriber = company.subscriptionStatus === "active";
              await storage.updateCompany(company.id, {
                voicePlanTier: voicePlan,
                voicePlanStatus: "active",
                voicePlanIncludedMinutes: planConfig.includedMinutes,
                voicePlanOverageRate: String(planConfig.overageRate),
                stripeVoiceSubscriptionId: subscription.id,
              } as Partial<typeof companies.$inferInsert>);
              console.log(`[Stripe Voice] Activated ${voicePlan} for company "${company.name}" (${company.id}), subscriber=${isSubscriber}`);
            }
          }
          await db.insert(stripeEvents).values({ id: event.id, eventType: event.type }).onConflictDoNothing();
          res.json({ received: true });
          return;
        }

        const companyName = meta.company_name;
        const email = meta.email;
        const firstName = meta.first_name || "";
        const lastName = meta.last_name || "";
        const phone = meta.phone || "";
        const tierMap: Record<string, string> = {
          free_trial: "free_trial",
          tier_1: "tier_1",
          tier_1_3: "tier_1_3",
          tier_3_5: "tier_3_5",
          tier_6_10: "tier_6_10",
          tier_10_plus: "tier_10_plus",
        };
        const planTier = tierMap[meta.plan_tier] || "tier_1";

        if (meta.tenant_id) {
          const company = await storage.getCompany(meta.tenant_id);
          if (company) {
            if (isStaleSubscriptionEvent(company)) {
              console.log(`[Stripe Subscription] Skipping stale subscription.created for company "${company.name}" (event ${event.id} ts=${event.created})`);
              await db.insert(stripeEvents).values({ id: event.id, eventType: event.type }).onConflictDoNothing();
              res.json({ received: true });
              return;
            }
            const subStatus = subscription.status === "trialing" ? "trialing" : "active";
            const updateData: Record<string, unknown> = {
              stripeCustomerId: subscription.customer,
              stripeSubscriptionId: subscription.id,
              subscriptionTier: planTier,
              subscriptionStatus: subStatus,
              subscriptionUpdatedAt: eventTs,
            };
            if (subscription.trial_end) {
              updateData.trialEndsAt = new Date(subscription.trial_end * 1000);
            }
            await storage.updateCompany(company.id, updateData as Partial<typeof companies.$inferInsert>);
            console.log(`[Stripe Subscription] Updated company "${company.name}" via tenant_id (${company.id}) status=${subStatus}`);
            await db.insert(stripeEvents).values({ id: event.id, eventType: event.type }).onConflictDoNothing();
            res.json({ received: true });
            return;
          }
        }

        if (companyName && email && firstName) {
          const existingUser = await getUserByEmail(email);

          if (existingUser) {
            const existingCompanies = await storage.getCompaniesForUser(existingUser.id);
            if (existingCompanies.length > 0) {
              const company = await storage.getCompany(existingCompanies[0].companyId);
              if (company) {
                if (isStaleSubscriptionEvent(company)) {
                  console.log(`[Stripe Subscription] Skipping stale subscription.created for existing company "${company.name}" (event ${event.id} ts=${event.created})`);
                } else {
                  const subStatus = subscription.status === "trialing" ? "trialing" : "active";
                  const updateData: Record<string, unknown> = {
                    stripeCustomerId: subscription.customer,
                    stripeSubscriptionId: subscription.id,
                    subscriptionTier: planTier,
                    subscriptionStatus: subStatus,
                    subscriptionUpdatedAt: eventTs,
                  };
                  if (subscription.trial_end) {
                    updateData.trialEndsAt = new Date(subscription.trial_end * 1000);
                  }
                  await storage.updateCompany(company.id, updateData as Partial<typeof companies.$inferInsert>);
                  console.log(`[Stripe Subscription] Updated existing company "${company.name}" (${company.id}) for subscription ${subscription.id} status=${subStatus}`);
                }
              }
            } else {
              const subStatus2 = subscription.status === "trialing" ? "trialing" : "active";
              const createData: Record<string, unknown> = {
                name: companyName.trim(),
                email,
                phone,
                subscriptionTier: planTier,
                subscriptionStatus: subStatus2,
                stripeCustomerId: subscription.customer,
                stripeSubscriptionId: subscription.id,
                subscriptionUpdatedAt: eventTs,
              };
              if (subscription.trial_end) {
                createData.trialEndsAt = new Date(subscription.trial_end * 1000);
              }
              const company = await storage.createCompany(createData as typeof companies.$inferInsert);
              await storage.addUserToCompany(existingUser.id, company.id, "owner");
              await seedDefaultLeadSources(company.id);
              await storage.seedDefaultPricing(company.id);
              console.log(`[Stripe Subscription] Created company "${companyName}" (${company.id}) for existing user ${email} status=${subStatus2}`);
            }
          } else {
            const crypto = await import("crypto");
            const tempPassword = crypto.randomBytes(6).toString("base64url");
            const user = await createUserWithTempPassword(email, firstName, lastName, tempPassword);

            const subStatus3 = subscription.status === "trialing" ? "trialing" : "active";
            const createData2: Record<string, unknown> = {
              name: companyName.trim(),
              email,
              phone,
              subscriptionTier: planTier,
              subscriptionStatus: subStatus3,
              stripeCustomerId: subscription.customer,
              stripeSubscriptionId: subscription.id,
              subscriptionUpdatedAt: eventTs,
            };
            if (subscription.trial_end) {
              createData2.trialEndsAt = new Date(subscription.trial_end * 1000);
            }
            const company = await storage.createCompany(createData2 as typeof companies.$inferInsert);
            await storage.addUserToCompany(user.id, company.id, "owner");
            await seedDefaultLeadSources(company.id);
            await storage.seedDefaultPricing(company.id);

            try {
              const protocol = req.headers["x-forwarded-proto"] || "https";
              const host = req.headers.host || "localhost:5000";
              const appUrl = `${protocol}://${host}`;
              await sendEmail({
                companyId: company.id,
                to: email,
                subject: `Your ScooPilot account is ready`,
                text: `Hi ${firstName},\n\nYour ScooPilot account "${companyName}" has been created.\n\nLog in at: ${appUrl}\nEmail: ${email}\nTemporary Password: ${tempPassword}\n\nYou'll be asked to set a new password on your first login.`,
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                      <h1 style="color: white; margin: 0;">ScooPilot</h1>
                    </div>
                    <div style="padding: 20px; border: 1px solid #e5e7eb;">
                      <h2 style="margin-top: 0;">Welcome to ScooPilot!</h2>
                      <p>Hi ${firstName},</p>
                      <p>Your account <strong>"${companyName}"</strong> has been created and is ready to use.</p>
                      <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 4px 0;"><strong>Email:</strong> ${email}</p>
                        <p style="margin: 4px 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
                      </div>
                      <a href="${appUrl}" style="display: inline-block; background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Log In Now</a>
                    </div>
                  </div>`,
              });
              console.log(`[Stripe Subscription] Welcome email sent to ${email}`);
            } catch (emailErr) {
              console.error(`[Stripe Subscription] Failed to send welcome email to ${email}:`, emailErr);
            }

            console.log(`[Stripe Subscription] Provisioned new tenant "${companyName}" (${company.id}) for ${email}, subscription ${subscription.id}`);
          }
        } else {
          console.warn(`[Stripe Subscription] Missing required metadata (company_name, email, first_name) on subscription ${subscription.id}`);
        }
      }

      if (event.type === "customer.subscription.updated") {
        const subscription = event.data.object as { id: string; status: string; metadata: Record<string, string>; trial_end?: number | null; items?: { data?: Array<{ id: string; price?: { id: string } }> } };
        const stripeSubId = subscription.id;
        const meta = subscription.metadata || {};

        if (meta.checkout_type === "voice_addon") {
          const allCompanies = await storage.listCompanies();
          for (const company of allCompanies) {
            if (company.stripeVoiceSubscriptionId === stripeSubId) {
              const statusMap: Record<string, string> = {
                active: "active", past_due: "past_due", canceled: "cancelled", unpaid: "suspended",
              };
              const newVoiceStatus = statusMap[subscription.status] || subscription.status;
              const voiceUpdates: Record<string, unknown> = { voicePlanStatus: newVoiceStatus };

              const voicePriceEnvMap: Record<string, string> = {};
              if (process.env.STRIPE_PRICE_VOICE_STARTER) voicePriceEnvMap[process.env.STRIPE_PRICE_VOICE_STARTER] = "voice_starter";
              if (process.env.STRIPE_PRICE_VOICE_PRO) voicePriceEnvMap[process.env.STRIPE_PRICE_VOICE_PRO] = "voice_pro";

              const currentPriceId = subscription.items?.data?.[0]?.price?.id;
              const derivedPlan = currentPriceId ? voicePriceEnvMap[currentPriceId] : null;
              const resolvedPlan = derivedPlan || meta.voice_plan;

              if (resolvedPlan && VOICE_PLAN_CONFIG[resolvedPlan as keyof typeof VOICE_PLAN_CONFIG]) {
                const vc = VOICE_PLAN_CONFIG[resolvedPlan as keyof typeof VOICE_PLAN_CONFIG];
                voiceUpdates.voicePlanTier = resolvedPlan;
                voiceUpdates.voicePlanIncludedMinutes = vc.includedMinutes;
                voiceUpdates.voicePlanOverageRate = String(vc.overageRate);
              }
              if (newVoiceStatus === "cancelled") {
                voiceUpdates.voicePlanTier = null;
                voiceUpdates.voicePlanStatus = null;
                voiceUpdates.voicePlanIncludedMinutes = null;
                voiceUpdates.voicePlanOverageRate = null;
                voiceUpdates.stripeVoiceSubscriptionId = null;
              }
              await storage.updateCompany(company.id, voiceUpdates as Partial<typeof companies.$inferInsert>);
              console.log(`[Stripe Voice] Updated company "${company.name}" voice status=${newVoiceStatus} plan=${resolvedPlan || "unchanged"}`);
              break;
            }
          }
        } else {
          const allCompanies = await storage.listCompanies();
          for (const company of allCompanies) {
            if (company.stripeSubscriptionId === stripeSubId) {
              if (isStaleSubscriptionEvent(company)) {
                console.log(`[Stripe Subscription] Skipping stale subscription.updated for company "${company.name}" (event ${event.id} ts=${event.created})`);
                break;
              }
              const statusMap: Record<string, string> = {
                active: "active",
                past_due: "past_due",
                canceled: "cancelled",
                trialing: "trialing",
                unpaid: "suspended",
              };
              const newStatus = statusMap[subscription.status] || "active";
              const tierMap: Record<string, string> = {
                free_trial: "free_trial", tier_1: "tier_1", tier_1_3: "tier_1_3",
                tier_3_5: "tier_3_5", tier_6_10: "tier_6_10", tier_10_plus: "tier_10_plus",
              };
              const updates: Record<string, unknown> = { subscriptionStatus: newStatus, subscriptionUpdatedAt: eventTs };
              if (meta.plan_tier && tierMap[meta.plan_tier]) {
                updates.subscriptionTier = tierMap[meta.plan_tier];
              }
              if (newStatus === "active" && company.frozenAt) {
                updates.frozenAt = null;
              }
              if (subscription.trial_end) {
                updates.trialEndsAt = new Date(subscription.trial_end * 1000);
              }
              await storage.updateCompany(company.id, updates as Partial<typeof companies.$inferInsert>);
              console.log(`[Stripe Subscription] Updated company "${company.name}" status=${newStatus}`);
              break;
            }
          }
        }
      }

      if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object as { id: string; metadata?: Record<string, string> };
        const stripeSubId = subscription.id;
        const allCompanies = await storage.listCompanies();
        let handled = false;
        for (const company of allCompanies) {
          if (company.stripeVoiceSubscriptionId === stripeSubId) {
            await storage.updateCompany(company.id, {
              voicePlanTier: null,
              voicePlanStatus: null,
              voicePlanIncludedMinutes: null,
              voicePlanOverageRate: null,
              stripeVoiceSubscriptionId: null,
            } as Partial<typeof companies.$inferInsert>);
            console.log(`[Stripe Voice] Company "${company.name}" voice plan cancelled`);
            handled = true;
            break;
          }
        }
        if (!handled) {
          for (const company of allCompanies) {
            if (company.stripeSubscriptionId === stripeSubId) {
              if (isStaleSubscriptionEvent(company)) {
                console.log(`[Stripe Subscription] Skipping stale subscription.deleted for company "${company.name}" (event ${event.id} ts=${event.created})`);
                break;
              }
              await storage.updateCompany(company.id, { subscriptionStatus: "cancelled", canceledAt: new Date(), subscriptionUpdatedAt: eventTs } as Partial<typeof companies.$inferInsert>);
              console.log(`[Stripe Subscription] Company "${company.name}" subscription cancelled`);
              break;
            }
          }
        }
      }

      if (event.type === "customer.subscription.trial_will_end") {
        const subscription = event.data.object as { id: string; metadata: Record<string, string> };
        const meta = subscription.metadata || {};
        const email = meta.email;
        const companyName = meta.company_name || "your company";
        if (email) {
          try {
            const baseUrl = process.env.REPLIT_DEPLOYMENT_URL
              ? `https://${process.env.REPLIT_DEPLOYMENT_URL}`
              : process.env.REPLIT_DEV_DOMAIN
                ? `https://${process.env.REPLIT_DEV_DOMAIN}`
                : "https://scoopilot.replit.app";
            await sendEmail({
              companyId: company.id,
              to: email,
              subject: `Your ScooPilot trial ends soon`,
              text: `Hi,\n\nYour 14-day free trial for "${companyName}" ends in 3 days. Add a payment method to keep your account active.\n\nVisit ${baseUrl}/billing to update your billing.`,
              html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
                <div style="background-color:#2d8a5e;padding:20px;text-align:center"><h1 style="color:white;margin:0">ScooPilot</h1></div>
                <div style="padding:20px;border:1px solid #e5e7eb">
                  <h2 style="margin-top:0">Your trial ends in 3 days</h2>
                  <p>Your free trial for <strong>${companyName}</strong> is ending soon.</p>
                  <p>Add a payment method to keep your account active and avoid any service interruption.</p>
                  <a href="${baseUrl}/billing" style="display:inline-block;background-color:#2d8a5e;color:white;padding:12px 24px;text-decoration:none;border-radius:6px">Update Billing</a>
                </div></div>`,
            });
            console.log(`[Stripe Subscription] Trial ending email sent to ${email}`);
          } catch (e) {
            console.error(`[Stripe Subscription] Failed to send trial ending email to ${email}:`, e);
          }
        }
      }

      if (event.type === "invoice.payment_failed") {
        const invoice = event.data.object as { customer: string | { id: string }; attempt_count?: number; subscription?: string | null; billing_reason?: string };
        const stripeCustomerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        if (stripeCustomerId && invoice.subscription) {
          const allCompanies = await storage.listCompanies();
          for (const company of allCompanies) {
            if (company.stripeCustomerId === stripeCustomerId && company.stripeSubscriptionId === invoice.subscription) {
              if (isStaleSubscriptionEvent(company)) {
                console.log(`[Stripe Subscription] Skipping stale invoice.payment_failed for company "${company.name}" (event ${event.id} ts=${event.created})`);
                break;
              }
              await storage.updateCompany(company.id, {
                subscriptionStatus: "suspended",
                frozenAt: new Date(),
                subscriptionUpdatedAt: eventTs,
              } as Partial<typeof companies.$inferInsert>);
              const attemptCount = invoice.attempt_count || 1;
              console.log(`[Stripe Subscription] Company "${company.name}" SUSPENDED after subscription payment failure (attempt ${attemptCount})`);
              notify(company.id, "payment_failed", "Account Suspended",
                "Your subscription payment has failed. Please update your payment method to restore access.",
                "/billing");
              break;
            }
          }
        }
      }

      if (event.type === "invoice.payment_succeeded") {
        const stripeInvoice = event.data.object as { customer: string | { id: string }; subscription?: string | null; billing_reason?: string };
        const stripeCustomerId = typeof stripeInvoice.customer === "string" ? stripeInvoice.customer : stripeInvoice.customer?.id;
        if (stripeCustomerId && stripeInvoice.subscription) {
          const allCompanies = await storage.listCompanies();
          for (const company of allCompanies) {
            if (company.stripeCustomerId === stripeCustomerId && company.stripeSubscriptionId === stripeInvoice.subscription) {
              if (isStaleSubscriptionEvent(company)) {
                console.log(`[Stripe Subscription] Skipping stale invoice.payment_succeeded for company "${company.name}" (event ${event.id} ts=${event.created})`);
                break;
              }
              if (company.subscriptionStatus === "suspended" || company.frozenAt) {
                await storage.updateCompany(company.id, {
                  subscriptionStatus: "active",
                  frozenAt: null,
                  subscriptionUpdatedAt: eventTs,
                } as Partial<typeof companies.$inferInsert>);
                console.log(`[Stripe Subscription] Company "${company.name}" REACTIVATED after successful subscription payment`);
                notify(company.id, "general", "Payment Received",
                  "Your subscription payment was successful. Your account has been reactivated.",
                  "/billing");
              } else {
                console.log(`[Stripe Subscription] Company "${company.name}" subscription payment succeeded (status=${company.subscriptionStatus})`);
              }
              break;
            }
          }
        }
      }

      if (event.type === "payment_intent.payment_failed") {
        const pi = event.data.object as { id: string; metadata?: Record<string, string> };
        const invoiceId = pi.metadata?.invoiceId;
        if (invoiceId) {
          let resolvedCompanyId = pi.metadata?.tenant_id;

          if (!resolvedCompanyId && connectAccountId) {
            const connCompany = await storage.getCompanyByStripeConnectAccountId(connectAccountId);
            if (connCompany) {
              resolvedCompanyId = connCompany.id;
              console.log(`[Stripe Webhook] payment_intent.payment_failed: resolved tenant via Connect account ${connectAccountId} → ${connCompany.name} (${connCompany.id})`);
            }
          }

          if (resolvedCompanyId) {
            const invoice = await storage.getInvoice(invoiceId, resolvedCompanyId);
            if (invoice) {
              await storage.updateInvoice(invoiceId, resolvedCompanyId, {
                status: "failed",
                paymentAttempts: (invoice.paymentAttempts || 0) + 1,
                lastPaymentAttempt: new Date(),
              });
              notify(resolvedCompanyId, "payment_failed", "Payment Failed", `Payment failed for invoice #${invoice.invoiceNumber}.`, `/invoices`);
            } else {
              console.warn(`[Stripe Webhook] payment_intent.payment_failed: tenant ${resolvedCompanyId} resolved but invoice ${invoiceId} not found (pi ${pi.id}).`);
            }
          } else {
            console.warn(`[Stripe Webhook] payment_intent.payment_failed: could not resolve tenant for invoice ${invoiceId} (pi ${pi.id}, connectAccount=${connectAccountId || "none"}). Manual resolution required.`);
          }
        }
      }

      await db.insert(stripeEvents).values({ id: event.id, eventType: event.type }).onConflictDoNothing();

      res.json({ received: true });
    } catch (err) {
      console.error("Stripe webhook error:", err);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // ================ Tenant Provisioning (marketing site → app) ================

  app.post("/api/create-tenant", async (req: Request, res: Response) => {
    try {
      const apiKey = (req.headers["x-api-key"] || req.headers["authorization"]?.replace(/^Bearer\s+/i, "")) as string | undefined;
      const expectedKey = process.env.SCOOPILOT_API_KEY;
      console.log(`[Create Tenant] Auth check — header present: ${!!apiKey}, expected present: ${!!expectedKey}, key length: ${apiKey?.length || 0}, expected length: ${expectedKey?.length || 0}, match: ${apiKey === expectedKey}`);
      if (!expectedKey || !apiKey || apiKey !== expectedKey) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { email, first_name, last_name, company, phone, plan, domain, stripe_customer_id, stripe_subscription_id } = req.body;

      if (!email || !first_name || !company) {
        return res.status(400).json({ error: "Missing required fields: email, first_name, company" });
      }

      const existingUser = await getUserByEmail(email);

      if (existingUser) {
        const existingCompanies = await storage.getCompaniesForUser(existingUser.id);
        if (existingCompanies.length > 0) {
          const existingCompany = await storage.getCompany(existingCompanies[0].companyId);
          if (existingCompany) {
            const updateData: Record<string, unknown> = {};
            if (stripe_customer_id) updateData.stripeCustomerId = stripe_customer_id;
            if (stripe_subscription_id) updateData.stripeSubscriptionId = stripe_subscription_id;
            if (plan) updateData.subscriptionTier = plan;
            updateData.subscriptionStatus = "trialing";
            if (Object.keys(updateData).length > 0) {
              await storage.updateCompany(existingCompany.id, updateData as Partial<typeof companies.$inferInsert>);
            }
            console.log(`[Create Tenant] Updated existing company "${existingCompany.name}" (${existingCompany.id}) for ${email}`);
            return res.json({
              success: true,
              tenant_id: existingCompany.id,
              user_id: existingUser.id,
              existing: true,
            });
          }
        }
      }

      const crypto = await import("crypto");
      const tempPassword = crypto.randomBytes(6).toString("base64url");
      let user = existingUser;
      if (!user) {
        user = await createUserWithTempPassword(email, first_name, last_name || "", tempPassword);
      }

      const tierMap: Record<string, string> = {
        free_trial: "free_trial",
        tier_1: "tier_1",
        tier_1_3: "tier_1_3",
        tier_3_5: "tier_3_5",
        tier_6_10: "tier_6_10",
        tier_10_plus: "tier_10_plus",
      };
      const subscriptionTier = tierMap[plan] || "free_trial";

      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 14);

      const createData: Record<string, unknown> = {
        name: company.trim(),
        email,
        phone: phone || "",
        subscriptionTier,
        subscriptionStatus: "trialing",
        trialEndsAt: trialEnd,
      };
      if (stripe_customer_id) createData.stripeCustomerId = stripe_customer_id;
      if (stripe_subscription_id) createData.stripeSubscriptionId = stripe_subscription_id;
      if (domain) createData.website = domain;

      const newCompany = await storage.createCompany(createData as typeof companies.$inferInsert);
      await storage.addUserToCompany(user.id, newCompany.id, "owner");
      await seedDefaultLeadSources(newCompany.id);
      await storage.seedDefaultPricing(newCompany.id);

      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host || "app.scoopilot.com";
      const appUrl = `${protocol}://${host}`;

      try {
        await sendEmail({
          companyId: newCompany.id,
          to: email,
          subject: "Your ScooPilot account is ready",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">ScooPilot</h1>
              </div>
              <div style="padding: 20px; border: 1px solid #e5e7eb;">
                <h2 style="margin-top: 0;">Welcome to ScooPilot!</h2>
                <p>Hi ${first_name},</p>
                <p>Your account <strong>"${company}"</strong> has been created and is ready to use.</p>
                <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
                  <p style="margin: 4px 0;"><strong>Email:</strong> ${email}</p>
                  <p style="margin: 4px 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
                </div>
                <a href="${appUrl}" style="display: inline-block; background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Log In Now</a>
              </div>
            </div>`,
        });
        console.log(`[Create Tenant] Welcome email sent to ${email}`);
      } catch (emailErr) {
        console.error(`[Create Tenant] Failed to send welcome email to ${email}:`, emailErr);
      }

      console.log(`[Create Tenant] Provisioned new tenant "${company}" (${newCompany.id}) for ${email}`);
      return res.json({
        success: true,
        tenant_id: newCompany.id,
        user_id: user.id,
        existing: false,
      });
    } catch (err) {
      console.error("[Create Tenant] Error:", err);
      return res.status(500).json({ error: "Tenant creation failed" });
    }
  });

  // ================ Quotes ================

  app.post("/api/quotes/generate-yard-image", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { propertyId, zoom: requestedZoom, caption, polygon: directPolygon, lat: directLat, lng: directLng, sqft: directSqft } = req.body;

      let polygon: number[][] | null = null;
      let lat: number | null = null;
      let lng: number | null = null;
      let sqft: number | undefined;

      if (directPolygon && Array.isArray(directPolygon) && directPolygon.length >= 3 && directLat && directLng) {
        polygon = directPolygon;
        lat = parseFloat(String(directLat));
        lng = parseFloat(String(directLng));
        sqft = directSqft ? Number(directSqft) : undefined;
      } else if (propertyId) {
        const property = await storage.getProperty(propertyId, companyId);
        if (!property) {
          return res.status(404).json({ error: "Property not found" });
        }
        polygon = property.yardPolygon as number[][] | null;
        lat = property.latitude ? parseFloat(String(property.latitude)) : null;
        lng = property.longitude ? parseFloat(String(property.longitude)) : null;
        sqft = property.measuredYardSqft ? Number(property.measuredYardSqft) : undefined;
      }

      if (!polygon || polygon.length < 3 || !lat || !lng) {
        return res.status(400).json({ error: "Must provide a polygon with at least 3 points and coordinates" });
      }

      const mapboxToken = process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_SECRET_TOKEN;
      if (!mapboxToken) {
        return res.status(500).json({ error: "Mapbox token not configured" });
      }

      const width = 800;
      const height = 600;

      const closedPoly = [...polygon];
      if (closedPoly[0][0] !== closedPoly[closedPoly.length - 1][0] ||
          closedPoly[0][1] !== closedPoly[closedPoly.length - 1][1]) {
        closedPoly.push(closedPoly[0]);
      }

      const geoJson = {
        type: "Feature",
        properties: {
          "stroke": "#22c55e",
          "stroke-width": 3,
          "stroke-opacity": 0.9,
          "fill": "#22c55e",
          "fill-opacity": 0.25
        },
        geometry: {
          type: "Polygon",
          coordinates: [closedPoly]
        }
      };

      const geoJsonEncoded = encodeURIComponent(JSON.stringify(geoJson));
      const staticUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/geojson(${geoJsonEncoded})/auto/${width}x${height}@2x?padding=40&access_token=${mapboxToken}&attribution=false&logo=false`;

      const imgResponse = await fetch(staticUrl);
      if (!imgResponse.ok) {
        const errText = await imgResponse.text();
        console.error("Mapbox Static API error:", errText);
        return res.status(502).json({ error: "Failed to generate satellite image" });
      }

      const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());

      const { ObjectStorageService } = await import("./replit_integrations/object_storage/objectStorage");
      const objStorage = new ObjectStorageService();
      const uploadURL = await objStorage.getObjectEntityUploadURL();
      const objectPath = objStorage.normalizeObjectEntityPath(uploadURL);

      const putResponse = await fetch(uploadURL, {
        method: "PUT",
        body: imgBuffer,
        headers: { "Content-Type": "image/png" },
      });

      if (!putResponse.ok) {
        throw new Error(`Storage upload failed: ${putResponse.status}`);
      }

      const autoCaption = caption || `Yard measurement${sqft ? ` — ${Number(sqft).toLocaleString()} sqft` : ""}`;

      res.json({
        url: objectPath,
        caption: autoCaption,
        sqft: sqft || null,
        width,
        height,
      });
    } catch (err: any) {
      console.error("Error generating yard image:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/quotes/calculate-pricing", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      const companyQuoteDefaults = company?.quoteDefaults ?? null;

      const type = req.query.type as string;
      if (type === "residential") {
        const yardSize = (req.query.yardSize as string) || "small";
        const frequency = (req.query.frequency as string) || "weekly";
        const input: ResidentialQuoteInput = {
          type: "residential",
          dogCount: parseInt(req.query.dogCount as string) || 1,
          yardSize: yardSize as ResidentialQuoteInput["yardSize"],
          frequency: frequency as ResidentialQuoteInput["frequency"],
          isFirstTime: req.query.isFirstTime === "true",
        };
        const pricing = calculateQuotePricing(input, companyQuoteDefaults);
        res.json(pricing);
      } else if (type === "commercial") {
        const frequency = (req.query.frequency as string) || "1x_weekly";
        const input: CommercialQuoteInput = {
          type: "commercial",
          stationCount: (() => { const v = parseInt(req.query.stationCount as string); return isNaN(v) ? 0 : v; })(),
          commonAreaMinutes: parseInt(req.query.commonAreaMinutes as string) || 30,
          frequency: frequency as CommercialQuoteInput["frequency"],
          timePerStation: parseInt(req.query.timePerStation as string) || 10,
          mileageDistance: parseFloat(req.query.mileageDistance as string) || 0,
          dumpFee: Number.isFinite(parseFloat(req.query.dumpFee as string)) ? parseFloat(req.query.dumpFee as string) : 25,
          crewSize: parseInt(req.query.crewSize as string) || 1,
          siteSqft: parseInt(req.query.siteSqft as string) || 0,
          isInitialClean: req.query.isInitialClean === "true",
          markupPct: Number.isFinite(parseFloat(req.query.markupPct as string)) ? parseFloat(req.query.markupPct as string) : 20,
        };
        const pricing = calculateQuotePricing(input, companyQuoteDefaults);
        res.json(pricing);
      } else {
        res.status(400).json({ error: "Invalid quote type. Must be 'residential' or 'commercial'." });
      }
    } catch (err: any) {
      console.error("Error calculating pricing:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/quotes", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const filters: any = {};
      if (req.query.status) filters.status = req.query.status;
      if (req.query.type) filters.type = req.query.type;
      if (req.query.contactId) filters.contactId = req.query.contactId;
      const quotesList = await storage.getQuotes(companyId, filters);
      res.json(quotesList);
    } catch (err: any) {
      console.error("Error listing quotes:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/quotes/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const quote = await storage.getQuote(req.params.id, companyId);
      if (!quote) return res.status(404).json({ error: "Quote not found" });
      res.json(quote);
    } catch (err: any) {
      console.error("Error getting quote:", err);
      res.status(500).json({ error: err.message });
    }
  });

  function normalizeQuoteFrequency(freq: string | null | undefined): "weekly" | "biweekly" | "monthly" | "onetime" {
    switch (freq) {
      case "weekly":
      case "1x_weekly":
      case "2x_weekly":
      case "3x_weekly":
        return "weekly";
      case "biweekly":
        return "biweekly";
      case "monthly":
        return "monthly";
      case "onetime":
        return "onetime";
      default:
        return "weekly";
    }
  }

  const createQuoteBodySchema = z.object({
    type: z.enum(["residential", "commercial"]),
    quoteNumber: z.string().max(50).nullable().optional(),
    contactId: z.string().nullable().optional(),
    propertyId: z.string().nullable().optional(),
    contactName: z.string().min(1, "Contact name is required").max(255),
    contactEmail: z.string().email().max(255).nullable().optional(),
    contactPhone: z.string().max(50).nullable().optional(),
    propertyAddress: z.string().nullable().optional(),
    dogCount: z.number().int().min(0).max(50).nullable().optional(),
    yardSize: z.string().max(50).nullable().optional(),
    stationCount: z.number().int().min(0).max(200).nullable().optional(),
    commonAreaMinutes: z.number().int().min(0).max(600).nullable().optional(),
    timePerStation: z.number().int().min(0).max(120).nullable().optional(),
    mileageDistance: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
    dumpFee: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
    crewSize: z.number().int().min(1).max(20).nullable().optional(),
    siteSqft: z.number().int().min(0).nullable().optional(),
    frequency: z.string().max(50).nullable().optional(),
    isFirstTime: z.boolean().optional(),
    essentialPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
    premiumPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
    deluxePrice: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
    initialCleanFee: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
    essentialFeatures: z.array(z.string()).nullable().optional(),
    premiumFeatures: z.array(z.string()).nullable().optional(),
    deluxeFeatures: z.array(z.string()).nullable().optional(),
    pricingBreakdown: z.record(z.any()).nullable().optional(),
    images: z.array(z.object({ url: z.string(), caption: z.string(), sqft: z.number().nullable().optional() })).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    internalNotes: z.string().max(5000).nullable().optional(),
    expiresAt: z.string().nullable().optional(),
  });

  app.post("/api/quotes", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);

      const parsed = createQuoteBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid quote data", details: parsed.error.flatten() });
      }

      const quoteNumber = parsed.data.quoteNumber || await storage.getNextQuoteNumber(companyId);

      let contactId = parsed.data.contactId || null;
      if (!contactId && parsed.data.contactName) {
        try {
          const newContact = await storage.createContact({
            companyId,
            firstName: parsed.data.contactName.split(" ")[0],
            lastName: parsed.data.contactName.split(" ").slice(1).join(" ") || "",
            email: parsed.data.contactEmail || null,
            phone: parsed.data.contactPhone || null,
            status: "lead",
          });
          contactId = String(newContact.id);
        } catch (contactErr) {
          console.error("Failed to create lead from quote:", contactErr);
        }
      }

      let propertyId = parsed.data.propertyId || null;
      if (!propertyId && parsed.data.propertyAddress && contactId) {
        try {
          const newProperty = await storage.createProperty({
            companyId,
            contactId,
            address: parsed.data.propertyAddress,
            city: "",
            state: "",
            zip: "",
          });
          propertyId = String(newProperty.id);
        } catch (propErr) {
          console.error("Failed to create property from quote:", propErr);
        }
      }

      const quoteData = {
        ...parsed.data,
        companyId,
        quoteNumber,
        contactId,
        propertyId,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      };

      const quote = await storage.createQuote(quoteData);
      res.status(201).json(quote);
    } catch (err: any) {
      console.error("Error creating quote:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/quotes/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getQuote(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Quote not found" });

      const parsed = createQuoteBodySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid quote data", details: parsed.error.flatten() });
      }

      const updateData = { ...parsed.data } as Record<string, any>;
      if (updateData.quoteNumber === null || updateData.quoteNumber === undefined) {
        delete updateData.quoteNumber;
      }

      const quote = await storage.updateQuote(req.params.id, companyId, updateData as Partial<InsertQuote>);
      res.json(quote);
    } catch (err: any) {
      console.error("Error updating quote:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/quotes/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getQuote(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Quote not found" });
      await storage.deleteQuote(req.params.id, companyId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error deleting quote:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/quotes/:id/accept", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const quote = await storage.getQuote(req.params.id, companyId);
      if (!quote) return res.status(404).json({ error: "Quote not found" });

      const tier = req.body.tier as string;
      if (!tier || !["essential", "premium", "deluxe"].includes(tier)) {
        return res.status(400).json({ error: "Must select a tier: essential, premium, or deluxe" });
      }

      if (quote.status === "accepted") {
        return res.status(400).json({ error: "Quote already accepted" });
      }

      const priceMap: Record<string, string | null> = {
        essential: quote.essentialPrice,
        premium: quote.premiumPrice,
        deluxe: quote.deluxePrice,
      };
      const selectedPrice = priceMap[tier] || "0";

      const updatedQuote = await storage.updateQuote(req.params.id, companyId, {
        status: "accepted",
        selectedTier: tier as "essential" | "premium" | "deluxe",
        selectedPrice,
        acceptedAt: new Date(),
      });

      if (quote.contactId) {
        const contact = await storage.getContactById(quote.contactId);
        if (contact && contact.status === "lead") {
          await storage.updateContact(quote.contactId, companyId, { status: "active" });
        }
      }

      let servicePlan = null;
      if (quote.contactId && quote.propertyId) {
        try {
          const today = new Date().toISOString().split("T")[0];
          const svcName = `${tier.charAt(0).toUpperCase() + tier.slice(1)} Service (Quote #${quote.quoteNumber})`;
          servicePlan = await storage.createServicePlan({
            companyId,
            contactId: quote.contactId,
            propertyId: quote.propertyId,
            frequency: normalizeQuoteFrequency(quote.frequency),
            pricePerVisit: selectedPrice,
            startDate: today,
            isActive: true,
            serviceName: svcName,
            jobType: "recurring",
            jobStatus: "active",
            stopOrder: 0,
          });
        } catch (spErr) {
          console.error("Failed to create service plan from accepted quote:", spErr);
        }
      }

      res.json({ quote: updatedQuote, servicePlan });
    } catch (err: any) {
      console.error("Error accepting quote:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/quotes/:id/send", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const quote = await storage.getQuote(req.params.id, companyId);
      if (!quote) return res.status(404).json({ error: "Quote not found" });
      if (quote.status !== "draft" && quote.status !== "sent") {
        return res.status(400).json({ error: "Only draft or sent quotes can be sent" });
      }

      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const pricing = {
        essential: parseFloat(quote.essentialPrice || "0"),
        premium: parseFloat(quote.premiumPrice || "0"),
        deluxe: parseFloat(quote.deluxePrice || "0"),
        initialCleanFee: parseFloat(quote.initialCleanFee || "0"),
        essentialFeatures: (quote.essentialFeatures as string[]) || [],
        premiumFeatures: (quote.premiumFeatures as string[]) || [],
        deluxeFeatures: (quote.deluxeFeatures as string[]) || [],
        breakdown: (quote.pricingBreakdown as Record<string, any>) || {},
      };

      const slug = (company as any).slug || companyId;
      const acceptUrl = `${req.protocol}://${req.get("host")}/portal/${slug}/quotes/${quote.id}`;

      const logoUrl = company?.logoUrl ? `${getBaseUrl(req)}${company.logoUrl}` : undefined;

      const renderData = {
        companyName: company.name,
        companyEmail: (company as any).email || undefined,
        companyPhone: company.phone || undefined,
        companyLogo: logoUrl,
        contactName: quote.contactName || "Customer",
        quoteNumber: quote.quoteNumber,
        propertyAddress: quote.propertyAddress || undefined,
        pricing,
        frequency: quote.frequency || "weekly",
        expiresAt: quote.expiresAt?.toISOString() || undefined,
        notes: quote.notes || undefined,
        acceptUrl,
        images: (quote.images as { url: string; caption: string; sqft?: number }[]) || undefined,
        baseUrl: getBaseUrl(req),
      };

      const html = quote.type === "commercial"
        ? renderCommercialProposalHtml(renderData)
        : renderResidentialProposalHtml(renderData);

      const sendVia = req.body.sendVia || "email";
      const results: any = { sent: [] };

      if ((sendVia === "email" || sendVia === "both") && quote.contactEmail) {
        try {
          await sendEmail({
            companyId: companyId,
            to: quote.contactEmail,
            subject: `${company.name} — Service ${quote.type === "commercial" ? "Proposal" : "Quote"} #${quote.quoteNumber}`,
            html,
            senderName: company.name,
            replyTo: company.email || undefined,
          });
          results.sent.push("email");
        } catch (emailErr: any) {
          console.error("Failed to send quote email:", emailErr);
          results.emailError = emailErr.message;
        }
      }

      if ((sendVia === "sms" || sendVia === "both") && quote.contactPhone) {
        try {
          const smsText = renderQuoteSmsText({
            companyName: company.name,
            contactName: quote.contactName || "Customer",
            quoteNumber: quote.quoteNumber,
            pricing,
            type: quote.type,
            frequency: quote.frequency || "weekly",
            acceptUrl,
          });
          const smsConfigured = await isSmsConfiguredForCompany(companyId);
          if (smsConfigured) {
            await sendSmsForCompany({ to: quote.contactPhone, body: smsText, companyId, contactId: quote.contactId || undefined });
          }
          results.sent.push("sms");
        } catch (smsErr: any) {
          console.error("Failed to send quote SMS:", smsErr);
          results.smsError = smsErr.message;
        }
      }

      const expiresAt = quote.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const updatedQuote = await storage.updateQuote(req.params.id, companyId, {
        status: "sent",
        sentAt: new Date(),
        expiresAt,
      } as any);

      res.json({ ...results, quote: updatedQuote });
    } catch (err: any) {
      console.error("Error sending quote:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/quotes/:id/preview", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const quote = await storage.getQuote(req.params.id, companyId);
      if (!quote) return res.status(404).json({ error: "Quote not found" });
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const pricing = {
        essential: parseFloat(quote.essentialPrice || "0"),
        premium: parseFloat(quote.premiumPrice || "0"),
        deluxe: parseFloat(quote.deluxePrice || "0"),
        initialCleanFee: parseFloat(quote.initialCleanFee || "0"),
        essentialFeatures: (quote.essentialFeatures as string[]) || [],
        premiumFeatures: (quote.premiumFeatures as string[]) || [],
        deluxeFeatures: (quote.deluxeFeatures as string[]) || [],
        breakdown: (quote.pricingBreakdown as Record<string, any>) || {},
      };

      const logoUrl = company?.logoUrl ? `${getBaseUrl(req)}${company.logoUrl}` : undefined;

      const renderData = {
        companyName: company.name,
        companyEmail: (company as any).email || undefined,
        companyPhone: company.phone || undefined,
        companyLogo: logoUrl,
        contactName: quote.contactName || "Customer",
        quoteNumber: quote.quoteNumber,
        propertyAddress: quote.propertyAddress || undefined,
        pricing,
        frequency: quote.frequency || "weekly",
        expiresAt: quote.expiresAt?.toISOString() || undefined,
        notes: quote.notes || undefined,
        images: (quote.images as { url: string; caption: string; sqft?: number }[]) || undefined,
        baseUrl: getBaseUrl(req),
      };

      const html = quote.type === "commercial"
        ? renderCommercialProposalHtml(renderData)
        : renderResidentialProposalHtml(renderData);

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (err: any) {
      console.error("Error previewing quote:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/quotes/:id/download/:format", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const quote = await storage.getQuote(req.params.id, companyId);
      if (!quote) return res.status(404).json({ error: "Quote not found" });
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const pricing = {
        essential: parseFloat(quote.essentialPrice || "0"),
        premium: parseFloat(quote.premiumPrice || "0"),
        deluxe: parseFloat(quote.deluxePrice || "0"),
        initialCleanFee: parseFloat(quote.initialCleanFee || "0"),
        essentialFeatures: (quote.essentialFeatures as string[]) || [],
        premiumFeatures: (quote.premiumFeatures as string[]) || [],
        deluxeFeatures: (quote.deluxeFeatures as string[]) || [],
        breakdown: (quote.pricingBreakdown as Record<string, any>) || {},
      };

      const docData = {
        companyName: company.name,
        companyEmail: (company as any).email || undefined,
        companyPhone: company.phone || undefined,
        contactName: quote.contactName || "Customer",
        quoteNumber: quote.quoteNumber,
        propertyAddress: quote.propertyAddress || undefined,
        type: quote.type || "residential",
        frequency: quote.frequency || "weekly",
        expiresAt: quote.expiresAt?.toISOString() || undefined,
        notes: quote.notes || undefined,
        essentialPrice: pricing.essential,
        premiumPrice: pricing.premium,
        deluxePrice: pricing.deluxe,
        initialCleanFee: pricing.initialCleanFee,
        essentialFeatures: pricing.essentialFeatures,
        premiumFeatures: pricing.premiumFeatures,
        deluxeFeatures: pricing.deluxeFeatures,
        breakdown: pricing.breakdown,
        images: (quote.images as { url: string; caption: string; sqft?: number }[]) || undefined,
        baseUrl: getBaseUrl(req),
      };

      const safeName = `Quote-${quote.quoteNumber}`.replace(/[^a-zA-Z0-9-_]/g, "_");

      if (req.params.format === "pdf") {
        const pdfBuffer = await generateQuotePdf(docData);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
        res.send(pdfBuffer);
      } else if (req.params.format === "docx") {
        const docxBuffer = await generateQuoteDocx(docData);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}.docx"`);
        res.send(docxBuffer);
      } else {
        res.status(400).json({ error: "Invalid format. Use 'pdf' or 'docx'." });
      }
    } catch (err: any) {
      console.error("Error generating quote download:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ================ Client Portal Routes ================

  app.post("/api/portal/login", async (req: Request, res: Response) => {
    try {
      const { email: rawEmail, password } = req.body;
      if (!rawEmail || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }
      const email = String(rawEmail).trim().toLowerCase();

      const allCompanies = await storage.listCompanies();
      let foundContact = null;
      let hasAccessButNoPassword = false;
      for (const company of allCompanies) {
        const companyContacts = await storage.getContacts(company.id, { search: email });
        const match = companyContacts.find(
          (c) => c.email?.toLowerCase() === email && c.hasPortalAccess
        );
        if (match) {
          if (match.portalPasswordHash) {
            foundContact = match;
            break;
          } else {
            hasAccessButNoPassword = true;
          }
        }
      }

      if (!foundContact) {
        if (hasAccessButNoPassword) {
          return res.status(401).json({ error: "Your account needs a password. Please use 'Forgot Password' to set one up." });
        }
        return res.status(401).json({ error: "Invalid email or password" });
      }

      if (!foundContact.portalPasswordHash) {
        return res.status(401).json({ error: "Your account needs a password. Please use 'Forgot Password' to set one up." });
      }

      const [salt, hash] = foundContact.portalPasswordHash.split(":");
      const passwordValid = await new Promise<boolean>((resolve, reject) => {
        crypto.scrypt(password, salt, 64, (err, key) => {
          if (err) reject(err);
          resolve(key.toString("hex") === hash);
        });
      });
      if (!passwordValid) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await storage.createPortalSession({
        contactId: foundContact.id,
        companyId: foundContact.companyId,
        tokenHash,
        expiresAt,
      });

      await storage.deleteExpiredPortalSessions();

      res.json({ token, contactId: foundContact.id });
    } catch (err) { handleError(res, err); }
  });

  const resetRequestCounts = new Map<string, { count: number; resetAt: number }>();

  app.post("/api/portal/forgot-password", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "Email is required" });

      const normalizedEmail = String(email).trim().toLowerCase();

      const rateKey = normalizedEmail;
      const now = Date.now();
      const rateEntry = resetRequestCounts.get(rateKey);
      if (rateEntry && rateEntry.resetAt > now) {
        if (rateEntry.count >= 3) {
          return res.json({ success: true });
        }
        rateEntry.count++;
      } else {
        resetRequestCounts.set(rateKey, { count: 1, resetAt: now + 60 * 60 * 1000 });
      }

      const allCompanies = await storage.listCompanies();
      let foundContact = null;
      for (const company of allCompanies) {
        const companyContacts = await storage.getContacts(company.id, { search: normalizedEmail });
        const match = companyContacts.find(
          (c) => c.email?.toLowerCase() === normalizedEmail && c.hasPortalAccess
        );
        if (match) {
          foundContact = match;
          break;
        }
      }

      if (!foundContact) {
        return res.json({ success: true });
      }

      const resetTokenRaw = crypto.randomBytes(32).toString("hex");
      const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
      await storage.updateContact(foundContact.id, foundContact.companyId, {
        resetToken: resetTokenRaw,
        resetTokenExpiry,
      });

      const baseUrl = getBaseUrl(req);
      const resetLink = `${baseUrl}/portal/reset-password?token=${resetTokenRaw}`;
      const company = await storage.getCompany(foundContact.companyId);
      const companyName = company?.name || "Your Service Provider";

      const { sendEmail } = await import("./services/email");
      sendEmail({
        companyId: company.id,
        to: foundContact.email!,
        subject: `Reset your ${companyName} portal password`,
        senderName: company?.name || undefined,
        replyTo: company?.email || undefined,
        text: `Hi ${foundContact.firstName},\n\nWe received a request to reset your portal password.\n\nClick this link to set a new password (expires in 1 hour):\n${resetLink}\n\nIf you didn't request this, you can safely ignore this email.\n\n${companyName}`,
        html: `
          <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #1a7a4c; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 22px;">${companyName}</h1>
            </div>
            <div style="padding: 24px; background: #ffffff; border: 1px solid #e2e8f0; border-top: none;">
              <p>Hi ${foundContact.firstName},</p>
              <p>We received a request to reset your portal password.</p>
              <div style="text-align: center; margin: 28px 0;">
                <a href="${resetLink}" style="display: inline-block; background-color: #1a7a4c; color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 6px; font-size: 16px; font-weight: 600;">Reset Password</a>
              </div>
              <p style="font-size: 13px; color: #6b7280;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
            </div>
          </div>
        `,
      }).catch(console.error);

      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/portal/reset-password", async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) return res.status(400).json({ error: "Token and password are required" });
      if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

      const allCompanies = await storage.listCompanies();
      let foundContact = null;
      for (const company of allCompanies) {
        const contacts = await storage.getContacts(company.id, {});
        const match = contacts.find(
          (c) => c.resetToken === token && c.resetTokenExpiry && new Date(c.resetTokenExpiry) > new Date()
        );
        if (match) {
          foundContact = match;
          break;
        }
      }

      if (!foundContact) {
        return res.status(400).json({ error: "Invalid or expired reset link. Please request a new one." });
      }

      const salt = crypto.randomBytes(16).toString("hex");
      const portalPasswordHash = await new Promise<string>((resolve, reject) => {
        crypto.scrypt(String(password), salt, 64, (err, key) => {
          if (err) reject(err);
          resolve(`${salt}:${key.toString("hex")}`);
        });
      });

      await storage.updateContact(foundContact.id, foundContact.companyId, {
        portalPasswordHash,
        resetToken: null,
        resetTokenExpiry: null,
      });

      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/portal/verify-email", async (req: Request, res: Response) => {
    try {
      const token = String(req.query.token || "");
      if (!token) return res.status(400).json({ error: "Verification token is required" });

      const allCompanies = await storage.listCompanies();
      let foundContact = null;
      for (const company of allCompanies) {
        const contacts = await storage.getContacts(company.id, {});
        const match = contacts.find(
          (c) => c.emailVerificationToken === token && c.emailVerificationExpiry && new Date(c.emailVerificationExpiry) > new Date()
        );
        if (match) {
          foundContact = match;
          break;
        }
      }

      if (!foundContact || !foundContact.pendingEmail) {
        return res.status(400).json({ error: "Invalid or expired verification link." });
      }

      await storage.updateContact(foundContact.id, foundContact.companyId, {
        email: foundContact.pendingEmail,
        pendingEmail: null,
        emailVerificationToken: null,
        emailVerificationExpiry: null,
      });

      res.json({ success: true, email: foundContact.pendingEmail });
    } catch (err) { handleError(res, err); }
  });

  async function getPortalContext(req: Request) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw { status: 401, message: "Portal authentication required" };
    }
    const token = authHeader.slice(7);
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const session = await storage.getPortalSessionByToken(tokenHash);
    if (!session) {
      throw { status: 401, message: "Invalid or expired portal session" };
    }
    return { contactId: session.contactId, companyId: session.companyId, sessionId: session.id };
  }

  app.get("/api/portal/me", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const company = await storage.getCompany(companyId);
      res.json({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        streetAddress: contact.streetAddress || "",
        city: contact.city || "",
        state: contact.state || "",
        zipCode: contact.zipCode || "",
        companyName: company?.name || "",
        pendingEmail: contact.pendingEmail || null,
      });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/portal/schedule", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const plans = await storage.getServicePlans(companyId, { contactId });
      const today = new Date().toISOString().split("T")[0];
      const futureDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const upcomingVisits = await storage.getVisitsForDateRange(companyId, today, futureDate);

      const planIds = new Set(plans.map((p) => p.id));
      const myVisits = upcomingVisits.filter((v) => planIds.has(v.servicePlanId));

      const props = await storage.getProperties(companyId, contactId);

      res.json({
        servicePlans: plans.map((p) => ({
          id: p.id,
          frequency: p.frequency,
          dayOfWeek: p.dayOfWeek,
          pricePerVisit: p.pricePerVisit,
          isActive: p.isActive,
        })),
        upcomingVisits: myVisits.map((v: any) => ({
          id: v.id,
          scheduledDate: v.scheduledDate,
          status: v.status,
          propertyAddress: props.find((p) => p.id === v.propertyId)?.streetAddress || "",
        })),
      });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/portal/invoices", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const invoicesList = await storage.getInvoices(companyId, { contactId });
      const visibleStatuses = ["sent", "pending", "paid", "failed"];
      res.json(invoicesList.filter(inv => visibleStatuses.includes(inv.status)).map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        dueDate: inv.dueDate,
        total: inv.total,
        tipAmount: inv.tipAmount || "0",
        status: inv.status,
        createdAt: inv.createdAt,
      })));
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/portal/invoices/:id/pay", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const invoice = await storage.getInvoice(req.params.id, companyId);
      if (!invoice || invoice.contactId !== contactId) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.status === "paid") return res.status(400).json({ error: "Invoice already paid" });
      if (invoice.status === "draft") return res.status(400).json({ error: "This invoice has not been finalized yet" });
      if (invoice.status === "voided") return res.status(400).json({ error: "This invoice has been voided" });

      const tipAmount = Math.round(parseFloat(req.body?.tipAmount || "0") * 100) / 100;
      if (isNaN(tipAmount) || tipAmount < 0) return res.status(400).json({ error: "Invalid tip amount" });
      if (tipAmount > 500) return res.status(400).json({ error: "Tip amount exceeds maximum" });

      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const company = await storage.getCompany(companyId);
      const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;

      const contactName = `${contact.firstName} ${contact.lastName}`.trim();
      const { customerId: stripeCustomerId, wasRecreated } = await ensureConnectedCustomer({
        currentCustomerId: contact.stripeCustomerId,
        stripeAccount: connectAcct,
        email: contact.email || undefined,
        name: contactName,
        metadata: { contactId: contact.id, companyId },
      });
      if (wasRecreated) {
        await storage.updateContact(contact.id, companyId, { stripeCustomerId });
      }

      const chargeAmount = parseFloat(invoice.total) + tipAmount;
      const baseUrl = getBaseUrl(req);
      const result = await createCheckoutSession({
        customerId: stripeCustomerId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        amount: chargeAmount,
        successUrl: `${baseUrl}/portal/client?paid=${invoice.id}`,
        cancelUrl: `${baseUrl}/portal/client`,
        tipAmount: tipAmount.toFixed(2),
        stripeConnectAccountId: connectAcct,
        tenantId: companyId,
      });

      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/portal/pause", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      await storage.updateContact(contactId, companyId, { status: "paused" });

      const plans = await storage.getServicePlans(companyId, { contactId, isActive: true });
      const pausedPlanIds: string[] = [];
      for (const plan of plans) {
        await storage.updateServicePlan(plan.id, companyId, { isActive: false, pausedAt: new Date() });
        pausedPlanIds.push(plan.id);
      }

      const today = new Date().toISOString().split("T")[0];
      const cancelledCount = await storage.cancelFutureVisitsForPlans(pausedPlanIds, today);
      if (cancelledCount > 0) {
        console.log(`[portal-pause] Cancelled ${cancelledCount} future visits for contact ${contactId}`);
      }

      notify(companyId, "service_paused", "Service Paused", `${contact.firstName} ${contact.lastName} paused their service via the portal.`, `/contacts/${contactId}`);
      res.json({ success: true, status: "paused" });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/portal/resume", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      await storage.updateContact(contactId, companyId, { status: "active" });

      const plans = await storage.getServicePlans(companyId, { contactId });
      const reactivatedPlanIds: string[] = [];
      for (const plan of plans) {
        if (!plan.isActive && plan.pausedAt) {
          await storage.updateServicePlan(plan.id, companyId, { isActive: true, pausedAt: null });
          reactivatedPlanIds.push(plan.id);
        }
      }

      if (reactivatedPlanIds.length > 0) {
        const now = new Date();
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate());
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + 14);
        const startStr = startDate.toISOString().split("T")[0];
        const endStr = endDate.toISOString().split("T")[0];

        try {
          const { generateVisitsForPlans } = await import("./jobs/auto-visits");
          const created = await generateVisitsForPlans(companyId, reactivatedPlanIds, startStr, endStr);
          if (created > 0) {
            console.log(`[portal-resume] Generated ${created} visits for contact ${contactId}`);
          }
        } catch (genErr) {
          console.error("[portal-resume] Visit generation failed:", genErr);
        }
      }

      notify(companyId, "service_resumed", "Service Resumed", `${contact.firstName} ${contact.lastName} resumed their service via the portal.`, `/contacts/${contactId}`);
      res.json({ success: true, status: "active" });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/portal/visits/history", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const plans = await storage.getServicePlans(companyId, { contactId });
      const planIds = new Set(plans.map((p) => p.id));

      const pastDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const today = new Date().toISOString().split("T")[0];
      const allVisits = await storage.getVisitsForDateRange(companyId, pastDate, today);
      const pastVisits = allVisits
        .filter((v: any) => planIds.has(v.servicePlanId) && (v.status === "completed" || v.status === "skipped" || v.status === "cancelled"))
        .sort((a: any, b: any) => b.scheduledDate.localeCompare(a.scheduledDate));

      const props = await storage.getProperties(companyId, contactId);

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const start = (page - 1) * limit;

      res.json({
        visits: pastVisits.slice(start, start + limit).map((v: any) => ({
          id: v.id,
          scheduledDate: v.scheduledDate,
          status: v.status,
          propertyAddress: props.find((p) => p.id === v.propertyId)?.streetAddress || "",
          completedAt: v.completedAt || null,
          proofOfServicePhoto: v.proofOfServicePhoto || null,
          proofOfServicePhotoBefore: v.proofOfServicePhotoBefore || null,
        })),
        total: pastVisits.length,
        page,
        totalPages: Math.ceil(pastVisits.length / limit),
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/portal/contact-us", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const { subject, message } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });

      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const company = await storage.getCompany(companyId);
      const companyEmail = company?.email;
      if (!companyEmail) return res.status(400).json({ error: "Company does not have a contact email configured" });

      const emailSubject = subject || `Message from ${contact.firstName} ${contact.lastName}`;
      await sendEmail({
        companyId: companyId,
        to: companyEmail,
        subject: emailSubject,
        replyTo: contact.email || undefined,
        text: `Message from portal client: ${contact.firstName} ${contact.lastName} (${contact.email || "no email"})\n\n${message}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #2d8a5e; padding: 16px; text-align: center;">
              <h2 style="color: white; margin: 0;">Client Portal Message</h2>
            </div>
            <div style="padding: 20px; border: 1px solid #e5e7eb;">
              <p><strong>From:</strong> ${contact.firstName} ${contact.lastName}</p>
              <p><strong>Email:</strong> ${contact.email || "Not provided"}</p>
              <p><strong>Phone:</strong> ${contact.phone || "Not provided"}</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
              <p>${message.replace(/\n/g, "<br />")}</p>
            </div>
          </div>
        `,
      });

      await storage.createMessage({
        companyId,
        contactId,
        direction: "inbound",
        channel: "email",
        subject: emailSubject,
        body: message,
        fromAddress: contact.email || "",
        toAddress: companyEmail,
        status: "sent",
      });

      notify(companyId, "portal_message", `${contact.firstName} ${contact.lastName} -- Portal Message`, `${contact.firstName} ${contact.lastName} sent a message via the portal.`, `/#client-requests`);

      res.json({ success: true, message: "Your message has been sent." });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/portal/messages", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const msgs = await storage.getMessages(companyId, { contactId });
      res.json(msgs.map((m) => ({
        id: m.id,
        direction: m.direction,
        channel: m.channel,
        subject: m.subject,
        body: m.body,
        status: m.status,
        createdAt: m.createdAt,
      })));
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/portal/logout", async (req: Request, res: Response) => {
    try {
      const { sessionId } = await getPortalContext(req);
      await storage.deletePortalSession(sessionId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/portal/properties", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const properties = await storage.getProperties(companyId, contactId);
      res.json(properties);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/portal/profile", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const updates: any = {};
      if (req.body.numberOfDogs !== undefined) updates.numberOfDogs = Number(req.body.numberOfDogs);
      if (req.body.firstName !== undefined) updates.firstName = String(req.body.firstName).trim();
      if (req.body.lastName !== undefined) updates.lastName = String(req.body.lastName).trim();
      if (req.body.phone !== undefined) updates.phone = String(req.body.phone).trim() || null;
      if (req.body.streetAddress !== undefined) updates.streetAddress = String(req.body.streetAddress).trim();
      if (req.body.city !== undefined) updates.city = String(req.body.city).trim();
      if (req.body.state !== undefined) updates.state = String(req.body.state).trim();
      if (req.body.zipCode !== undefined) updates.zipCode = String(req.body.zipCode).trim();
      let pendingEmailChange: string | null = null;
      if (req.body.email !== undefined) {
        const newEmail = String(req.body.email).trim().toLowerCase();
        if (newEmail && newEmail !== contact.email) {
          pendingEmailChange = newEmail;
        }
      }
      if (Object.keys(updates).length > 0) {
        await storage.updateContact(contactId, companyId, updates);
      }
      if (req.body.properties && Array.isArray(req.body.properties)) {
        for (const prop of req.body.properties) {
          if (prop.id) {
            const existing = await storage.getProperty(prop.id, companyId);
            if (!existing || existing.contactId !== contactId) {
              return res.status(403).json({ error: "Not authorized to update this property" });
            }
            if (existing) {
              const propUpdates: any = {};
              if (prop.gateCode !== undefined) propUpdates.gateCode = prop.gateCode;
              if (prop.specialInstructions !== undefined) propUpdates.specialInstructions = prop.specialInstructions;
              if (prop.streetAddress !== undefined) propUpdates.streetAddress = String(prop.streetAddress).trim();
              if (prop.city !== undefined) propUpdates.city = String(prop.city).trim();
              if (prop.state !== undefined) propUpdates.state = String(prop.state).trim();
              if (prop.zipCode !== undefined) propUpdates.zipCode = String(prop.zipCode).trim();
              if (Object.keys(propUpdates).length > 0) {
                await storage.updateProperty(prop.id, companyId, propUpdates);
              }
            }
          }
        }
      }
      let emailVerificationSent = false;
      if (pendingEmailChange) {
        const verificationToken = crypto.randomBytes(32).toString("hex");
        const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await storage.updateContact(contactId, companyId, {
          pendingEmail: pendingEmailChange,
          emailVerificationToken: verificationToken,
          emailVerificationExpiry: verificationExpiry,
        });

        const baseUrl = getBaseUrl(req);
        const verifyLink = `${baseUrl}/portal/verify-email?token=${verificationToken}`;
        const company = await storage.getCompany(companyId);
        const companyName = company?.name || "Your Service Provider";

        const { sendEmail } = await import("./services/email");
        sendEmail({
          companyId: companyId,
          to: pendingEmailChange,
          subject: `Verify your new email address - ${companyName}`,
          senderName: company?.name || undefined,
          replyTo: company?.email || undefined,
          text: `Hi ${contact.firstName},\n\nYou requested to change your email address to ${pendingEmailChange}.\n\nClick this link to verify your new email (expires in 24 hours):\n${verifyLink}\n\nIf you didn't request this change, you can safely ignore this email.\n\n${companyName}`,
          html: `
            <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #1a7a4c; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 22px;">${companyName}</h1>
              </div>
              <div style="padding: 24px; background: #ffffff; border: 1px solid #e2e8f0; border-top: none;">
                <p>Hi ${contact.firstName},</p>
                <p>You requested to change your email address to <strong>${pendingEmailChange}</strong>.</p>
                <div style="text-align: center; margin: 28px 0;">
                  <a href="${verifyLink}" style="display: inline-block; background-color: #1a7a4c; color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 6px; font-size: 16px; font-weight: 600;">Verify Email</a>
                </div>
                <p style="font-size: 13px; color: #6b7280;">This link expires in 24 hours. Your current email remains active until you verify the new one.</p>
              </div>
            </div>
          `,
        }).catch(console.error);
        emailVerificationSent = true;
      }

      const updatedContact = await storage.getContactById(contactId);
      const company = await storage.getCompany(companyId);
      res.json({
        success: true,
        emailVerificationSent,
        pendingEmail: pendingEmailChange || undefined,
        profile: {
          id: updatedContact!.id,
          firstName: updatedContact!.firstName,
          lastName: updatedContact!.lastName,
          email: updatedContact!.email,
          phone: updatedContact!.phone,
          streetAddress: updatedContact!.streetAddress || "",
          city: updatedContact!.city || "",
          state: updatedContact!.state || "",
          zipCode: updatedContact!.zipCode || "",
          companyName: company?.name || "",
          numberOfDogs: updatedContact!.numberOfDogs,
          pendingEmail: updatedContact!.pendingEmail || null,
        },
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/portal/request-cleanup", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const { preferredDate, notes } = req.body;
      await storage.createNotification({
        companyId,
        type: "general",
        title: `${contact.firstName} ${contact.lastName} -- One-Time Cleanup Request`,
        message: `${contact.firstName} ${contact.lastName} requested a cleanup${preferredDate ? ` on ${preferredDate}` : ""}${notes ? `: ${notes}` : ""}`,
        linkUrl: "/#client-requests",
      });
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  // ================ Portal: Payment Methods (T001) ================

  app.post("/api/portal/setup-intent", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const company = await storage.getCompany(companyId);
      const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;

      const contactName = `${contact.firstName} ${contact.lastName}`.trim();
      const { customerId: stripeCustomerId, wasRecreated } = await ensureConnectedCustomer({
        currentCustomerId: contact.stripeCustomerId,
        stripeAccount: connectAcct,
        email: contact.email || undefined,
        name: contactName,
        metadata: { contactId: contact.id, companyId },
      });
      if (wasRecreated) {
        await storage.updateContact(contact.id, companyId, { stripeCustomerId });
      }

      const baseUrl = getBaseUrl(req);
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2025-04-30.basil" });
      const setupOpts: Stripe.RequestOptions = {};
      if (connectAcct) {
        setupOpts.stripeAccount = connectAcct;
      }
      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: "setup",
        payment_method_types: ["card"],
        success_url: `${baseUrl}/portal/client?card_added=1`,
        cancel_url: `${baseUrl}/portal/client`,
        metadata: { tenant_id: companyId, checkout_type: "portal_setup" },
      }, setupOpts);

      res.json({ url: session.url });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/portal/payment-methods", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      if (!contact.stripeCustomerId) return res.json({ methods: [], autoPayEnabled: contact.autoPayEnabled });

      const company = await storage.getCompany(companyId);
      const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;
      const contactName = `${contact.firstName} ${contact.lastName}`.trim();
      const { customerId: resolvedCustId, wasRecreated } = await ensureConnectedCustomer({
        currentCustomerId: contact.stripeCustomerId,
        stripeAccount: connectAcct,
        email: contact.email || undefined,
        name: contactName,
        metadata: { contactId: contact.id, companyId },
      });
      if (wasRecreated) {
        await storage.updateContact(contactId, companyId, { stripeCustomerId: resolvedCustId });
      }
      const methods = await getCustomerPaymentMethods(resolvedCustId, connectAcct);
      res.json({ methods, autoPayEnabled: contact.autoPayEnabled });
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/portal/payment-methods/:id", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact?.stripeCustomerId) return res.status(400).json({ error: "No payment methods on file" });

      const company = await storage.getCompany(companyId);
      const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;
      const contactName = `${contact.firstName} ${contact.lastName}`.trim();
      const { customerId: resolvedCustId, wasRecreated } = await ensureConnectedCustomer({
        currentCustomerId: contact.stripeCustomerId,
        stripeAccount: connectAcct,
        email: contact.email || undefined,
        name: contactName,
        metadata: { contactId: contact.id, companyId },
      });
      if (wasRecreated) {
        await storage.updateContact(contactId, companyId, { stripeCustomerId: resolvedCustId });
      }
      const methods = await getCustomerPaymentMethods(resolvedCustId, connectAcct);
      const owns = methods.some((m) => m.id === req.params.id);
      if (!owns) return res.status(403).json({ error: "Payment method not found" });

      await detachPaymentMethod(req.params.id, connectAcct);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/portal/auto-pay", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const { enabled } = req.body;
      await storage.updateContact(contactId, companyId, { autoPayEnabled: !!enabled });
      res.json({ success: true, autoPayEnabled: !!enabled });
    } catch (err) { handleError(res, err); }
  });

  // ================ Portal: Referral Program (T003) ================

  app.get("/api/portal/referral", async (req: Request, res: Response) => {
    try {
      const { contactId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const referralCount = contact.referralCode ? await storage.getReferralCount(contactId) : 0;
      res.json({
        referralCode: contact.referralCode || null,
        referralCount,
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/portal/referral/generate", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      if (contact.referralCode) return res.json({ referralCode: contact.referralCode });

      const code = `REF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      await storage.updateContact(contactId, companyId, { referralCode: code });
      res.json({ referralCode: code });
    } catch (err) { handleError(res, err); }
  });

  // ================ Portal: Estimates (T004) ================

  app.get("/api/portal/estimates", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const allEstimates = await storage.getEstimates(companyId, { contactId });
      res.json(allEstimates.map((e) => ({
        id: e.id,
        description: e.description,
        items: e.items,
        totalCents: e.totalCents,
        status: e.status,
        sentAt: e.sentAt,
        respondedAt: e.respondedAt,
        responseNote: e.responseNote,
        createdAt: e.createdAt,
      })));
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/portal/estimates/:id/approve", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const estimate = await storage.getEstimate(req.params.id, companyId);
      if (!estimate || estimate.contactId !== contactId) return res.status(404).json({ error: "Estimate not found" });
      if (estimate.status !== "pending") return res.status(400).json({ error: "Estimate is no longer pending" });

      await storage.updateEstimate(estimate.id, companyId, {
        status: "approved",
        respondedAt: new Date(),
        responseNote: req.body.note || null,
      });

      const contact = await storage.getContactById(contactId);
      const contactName = `${contact?.firstName || ""} ${contact?.lastName || ""}`.trim();

      if (estimate.propertyId) {
        try {
          await storage.createJobFromEstimate(estimate, contactId);
          notify(companyId, "general", "Draft Job Created from Estimate", `${contactName} approved estimate "${estimate.description}". A draft job has been created — review and approve the schedule.`, `/scheduling`);
        } catch (jobErr) {
          console.error("[estimate-approve] Failed to auto-create job:", jobErr);
          notify(companyId, "general", "Estimate Approved", `${contactName} approved estimate: ${estimate.description}`, `/contacts/${contactId}`);
        }
      } else {
        notify(companyId, "general", "Estimate Approved", `${contactName} approved estimate: ${estimate.description}`, `/contacts/${contactId}`);
      }

      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/portal/estimates/:id/decline", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const estimate = await storage.getEstimate(req.params.id, companyId);
      if (!estimate || estimate.contactId !== contactId) return res.status(404).json({ error: "Estimate not found" });
      if (estimate.status !== "pending") return res.status(400).json({ error: "Estimate is no longer pending" });

      await storage.updateEstimate(estimate.id, companyId, {
        status: "declined",
        respondedAt: new Date(),
        responseNote: req.body.reason || null,
      });

      const contact = await storage.getContactById(contactId);
      notify(companyId, "general", "Estimate Declined", `${contact?.firstName} ${contact?.lastName} declined estimate: ${estimate.description}${req.body.reason ? ` - Reason: ${req.body.reason}` : ""}`, `/contacts/${contactId}`);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  // ================ Portal: Quotes ================

  app.get("/api/portal/quotes/:id", async (req: Request, res: Response) => {
    try {
      const quoteId = req.params.id;
      const allQuotes = await db.execute(sql`SELECT * FROM quotes WHERE id = ${quoteId}`);
      const quoteRow = allQuotes.rows?.[0];
      if (!quoteRow) return res.status(404).json({ error: "Quote not found" });

      const isExpired = quoteRow.status === "expired" || (quoteRow.expires_at && new Date(quoteRow.expires_at as string) < new Date());

      const safeQuote = {
        id: quoteRow.id,
        quoteNumber: quoteRow.quote_number,
        type: quoteRow.type,
        status: isExpired ? "expired" : quoteRow.status,
        contactName: quoteRow.contact_name,
        propertyAddress: quoteRow.property_address,
        dogCount: quoteRow.dog_count,
        yardSize: quoteRow.yard_size,
        stationCount: quoteRow.station_count,
        commonAreaMinutes: quoteRow.common_area_minutes,
        frequency: quoteRow.frequency,
        essentialPrice: quoteRow.essential_price,
        premiumPrice: quoteRow.premium_price,
        deluxePrice: quoteRow.deluxe_price,
        initialCleanFee: quoteRow.initial_clean_fee,
        selectedTier: quoteRow.selected_tier,
        selectedPrice: quoteRow.selected_price,
        essentialFeatures: quoteRow.essential_features,
        premiumFeatures: quoteRow.premium_features,
        deluxeFeatures: quoteRow.deluxe_features,
        notes: quoteRow.notes,
        expiresAt: quoteRow.expires_at,
        sentAt: quoteRow.sent_at,
        acceptedAt: quoteRow.accepted_at,
        companyId: quoteRow.company_id,
      };

      const company = await storage.getCompany(quoteRow.company_id as string);
      res.json({ quote: safeQuote, companyName: company?.name || "Service Provider" });
    } catch (err: any) {
      console.error("Error fetching portal quote:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/portal/quotes/:id/accept", async (req: Request, res: Response) => {
    try {
      const quoteId = req.params.id;
      const { tier } = req.body;
      if (!tier || !["essential", "premium", "deluxe"].includes(tier)) {
        return res.status(400).json({ error: "Must select a tier: essential, premium, or deluxe" });
      }

      const result = await db.execute(sql`SELECT * FROM quotes WHERE id = ${quoteId}`);
      const quoteRow = result.rows?.[0];
      if (!quoteRow) return res.status(404).json({ error: "Quote not found" });

      if (quoteRow.status !== "sent" && quoteRow.status !== "draft") {
        return res.status(400).json({ error: "This quote has already been " + quoteRow.status });
      }

      if (quoteRow.expires_at && new Date(quoteRow.expires_at as string) < new Date()) {
        return res.status(400).json({ error: "This quote has expired" });
      }

      const priceKey = `${tier}_price` as string;
      const selectedPrice = quoteRow[priceKey] || "0";

      await db.execute(sql`
        UPDATE quotes SET
          status = 'accepted',
          selected_tier = ${tier},
          selected_price = ${selectedPrice},
          accepted_at = NOW(),
          updated_at = NOW()
        WHERE id = ${quoteId}
      `);

      const contactId = quoteRow.contact_id as number | null;
      const propertyId = quoteRow.property_id as number | null;
      const companyId = quoteRow.company_id as number;
      const quoteNumber = quoteRow.quote_number as string | null;
      const frequency = (quoteRow.frequency as string) || "weekly";

      if (contactId) {
        const contact = await storage.getContactById(contactId);
        if (contact && contact.status === "lead") {
          await storage.updateContact(contactId, companyId, { status: "active" });
        }
      }

      if (contactId && propertyId) {
        try {
          const today = new Date().toISOString().split("T")[0];
          const portalSvcName = `${tier.charAt(0).toUpperCase() + tier.slice(1)} Service (Quote #${quoteNumber || quoteId})`;
          const portalSp = await storage.createServicePlan({
            companyId,
            contactId,
            propertyId,
            frequency: normalizeQuoteFrequency(frequency),
            pricePerVisit: String(selectedPrice),
            startDate: today,
            isActive: true,
            serviceName: portalSvcName,
            jobType: "recurring",
            jobStatus: "active",
            stopOrder: 0,
          });
        } catch (spErr) {
          console.error("Failed to create service plan from portal quote acceptance:", spErr);
        }
      }

      res.json({ success: true, tier, price: selectedPrice });
    } catch (err: any) {
      console.error("Error accepting quote:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/portal/quotes/:id/decline", async (req: Request, res: Response) => {
    try {
      const quoteId = req.params.id;
      const result = await db.execute(sql`SELECT * FROM quotes WHERE id = ${quoteId}`);
      const quoteRow = result.rows?.[0];
      if (!quoteRow) return res.status(404).json({ error: "Quote not found" });

      if (quoteRow.status !== "sent" && quoteRow.status !== "draft") {
        return res.status(400).json({ error: "This quote has already been " + quoteRow.status });
      }

      await db.execute(sql`
        UPDATE quotes SET
          status = 'declined',
          declined_at = NOW(),
          updated_at = NOW()
        WHERE id = ${quoteId}
      `);

      res.json({ success: true });
    } catch (err: any) {
      console.error("Error declining quote:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ================ Portal: Notification Preferences (T005) ================

  app.get("/api/portal/notifications", async (req: Request, res: Response) => {
    try {
      const { contactId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      res.json(contact.reminderPreferences || { email: true, sms: false });
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/portal/notifications", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const prefs = req.body;
      const booleanKeys = ["email", "sms", "serviceReminder", "serviceCompleted", "invoiceReady", "invoiceDueReminder", "paymentConfirmation", "reminderOptOut"];
      const validChannels = ["sms", "email", "both"];
      const validTimings = ["24h_before", "2h_before", "morning_of"];
      const cleaned: Record<string, boolean | string | undefined> = {};
      for (const key of booleanKeys) {
        if (prefs[key] !== undefined) cleaned[key] = !!prefs[key];
      }
      if (prefs.preferredChannel !== undefined) {
        cleaned.preferredChannel = validChannels.includes(prefs.preferredChannel) ? prefs.preferredChannel : undefined;
      }
      if (prefs.preferredTiming !== undefined) {
        cleaned.preferredTiming = validTimings.includes(prefs.preferredTiming) ? prefs.preferredTiming : undefined;
      }
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const merged = { ...(contact.reminderPreferences || { email: true, sms: false }), ...cleaned };
      await storage.updateContact(contactId, companyId, { reminderPreferences: merged });
      res.json({ success: true, preferences: merged });
    } catch (err) { handleError(res, err); }
  });

  // ================ Portal: Service Change Requests (T006) ================

  app.post("/api/portal/service-change", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const { servicePlanId, requestType, requestedValue, note } = req.body;
      if (!requestType) return res.status(400).json({ error: "Request type is required" });

      let currentValue = "";
      if (servicePlanId) {
        const plan = await storage.getServicePlan(servicePlanId, companyId);
        if (plan && plan.contactId === contactId) {
          if (requestType === "frequency_change") currentValue = plan.frequency;
          else if (requestType === "day_change") currentValue = plan.dayOfWeek || "";
        }
      }

      const request = await storage.createServiceChangeRequest({
        companyId,
        contactId,
        servicePlanId: servicePlanId || null,
        requestType,
        currentValue,
        requestedValue: requestedValue || null,
        note: note || null,
        status: "pending",
      });

      const contact = await storage.getContactById(contactId);
      const senderName = `${contact?.firstName || ""} ${contact?.lastName || ""}`.trim() || "A client";
      notify(companyId, "general", `${senderName} -- Service Change Request`, `${senderName} requested a ${requestType.replace(/_/g, " ")}${note ? `: ${note}` : ""}`, `/#client-requests`);

      res.json({ success: true, id: request.id });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/portal/service-changes", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const requests = await storage.getServiceChangeRequests(companyId, { contactId });
      res.json(requests.map((r) => ({
        id: r.id,
        requestType: r.requestType,
        currentValue: r.currentValue,
        requestedValue: r.requestedValue,
        note: r.note,
        status: r.status,
        adminNote: r.adminNote,
        createdAt: r.createdAt,
        respondedAt: r.respondedAt,
      })));
    } catch (err) { handleError(res, err); }
  });

  // ================ Portal: Photo Gallery (T007) ================

  app.get("/api/portal/photos", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const plans = await storage.getServicePlans(companyId, { contactId });
      const planIds = new Set(plans.map((p) => p.id));

      const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const today = new Date().toISOString().split("T")[0];
      const allVisits = await storage.getVisitsForDateRange(companyId, sixMonthsAgo, today);
      const props = await storage.getProperties(companyId, contactId);

      const visitsWithPhotos = allVisits
        .filter((v: any) => planIds.has(v.servicePlanId) && (v.proofOfServicePhoto || v.proofOfServicePhotoBefore))
        .sort((a: any, b: any) => b.scheduledDate.localeCompare(a.scheduledDate))
        .slice(0, 50)
        .map((v: any) => ({
          id: v.id,
          scheduledDate: v.scheduledDate,
          propertyAddress: props.find((p) => p.id === v.propertyId)?.streetAddress || "",
          proofOfServicePhoto: v.proofOfServicePhoto || null,
          proofOfServicePhotoBefore: v.proofOfServicePhotoBefore || null,
        }));

      res.json(visitsWithPhotos);
    } catch (err) { handleError(res, err); }
  });

  // ================ Portal: Billing PDF Download (T008) ================

  app.get("/api/portal/invoices/:id/pdf", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const invoice = await storage.getInvoice(req.params.id, companyId);
      if (!invoice || invoice.contactId !== contactId) return res.status(404).json({ error: "Invoice not found" });

      const contact = await storage.getContactById(contactId);
      const company = await storage.getCompany(companyId);
      const lineItems = await storage.getInvoiceLineItems(invoice.id);

      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({ size: "LETTER", margin: 50 });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`);
      doc.pipe(res);

      doc.fontSize(20).text(company?.name || "Invoice", { align: "left" });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor("#666666").text(`${company?.address || ""} ${company?.city || ""} ${company?.state || ""}`);
      if (company?.phone) doc.text(`Phone: ${company.phone}`);
      if (company?.email) doc.text(`Email: ${company.email}`);
      doc.moveDown(1);

      doc.fontSize(16).fillColor("#000000").text(`Invoice ${invoice.invoiceNumber}`, { align: "right" });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor("#666666");
      doc.text(`Date: ${invoice.issuedDate || invoice.createdAt?.toISOString().split("T")[0] || ""}`, { align: "right" });
      doc.text(`Due: ${invoice.dueDate}`, { align: "right" });
      doc.text(`Status: ${invoice.status.toUpperCase()}`, { align: "right" });
      doc.moveDown(1);

      doc.fontSize(10).fillColor("#000000").text("Bill To:", { underline: true });
      doc.text(`${contact?.firstName || ""} ${contact?.lastName || ""}`);
      if (contact?.streetAddress) doc.text(contact.streetAddress);
      if (contact?.email) doc.text(contact.email);
      doc.moveDown(1);

      const tableTop = doc.y;
      doc.fontSize(9).fillColor("#333333");
      doc.text("Description", 50, tableTop, { width: 250 });
      doc.text("Qty", 310, tableTop, { width: 50, align: "center" });
      doc.text("Unit Price", 370, tableTop, { width: 80, align: "right" });
      doc.text("Total", 460, tableTop, { width: 80, align: "right" });
      doc.moveTo(50, tableTop + 15).lineTo(540, tableTop + 15).stroke("#cccccc");

      let yPos = tableTop + 25;
      for (const item of lineItems) {
        doc.fontSize(9).fillColor("#000000");
        doc.text(item.description, 50, yPos, { width: 250 });
        doc.text(String(item.quantity), 310, yPos, { width: 50, align: "center" });
        doc.text(`$${Number(item.unitPrice).toFixed(2)}`, 370, yPos, { width: 80, align: "right" });
        doc.text(`$${Number(item.total).toFixed(2)}`, 460, yPos, { width: 80, align: "right" });
        yPos += 20;
      }

      doc.moveTo(50, yPos).lineTo(540, yPos).stroke("#cccccc");
      yPos += 10;
      doc.fontSize(10).fillColor("#000000");
      if (Number(invoice.discountAmount) > 0) {
        doc.text(`Discount: -$${Number(invoice.discountAmount).toFixed(2)}`, 370, yPos, { width: 170, align: "right" });
        yPos += 18;
      }
      if (Number(invoice.tax) > 0) {
        doc.text(`Tax: $${Number(invoice.tax).toFixed(2)}`, 370, yPos, { width: 170, align: "right" });
        yPos += 18;
      }
      doc.fontSize(12).font("Helvetica-Bold").text(`Total: $${Number(invoice.total).toFixed(2)}`, 370, yPos, { width: 170, align: "right" });

      doc.end();
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/portal/billing-statement", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      const company = await storage.getCompany(companyId);

      const startDate = (req.query.startDate as string) || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const endDate = (req.query.endDate as string) || new Date().toISOString().split("T")[0];

      const allInvoices = await storage.getInvoices(companyId, { contactId });
      const filtered = allInvoices.filter((inv) => {
        if (inv.status === "voided") return false;
        const d = inv.dueDate || inv.createdAt?.toISOString().split("T")[0];
        return d >= startDate && d <= endDate;
      });

      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({ size: "LETTER", margin: 50 });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="billing-statement-${startDate}-to-${endDate}.pdf"`);
      doc.pipe(res);

      doc.fontSize(20).text(company?.name || "Billing Statement", { align: "left" });
      doc.moveDown(0.5);
      doc.fontSize(12).text("Billing Statement", { align: "left" });
      doc.fontSize(10).fillColor("#666666").text(`Period: ${startDate} to ${endDate}`);
      doc.moveDown(0.5);
      doc.text(`Client: ${contact?.firstName || ""} ${contact?.lastName || ""}`);
      if (contact?.email) doc.text(`Email: ${contact.email}`);
      doc.moveDown(1);

      const tableTop = doc.y;
      doc.fontSize(9).fillColor("#333333");
      doc.text("Invoice #", 50, tableTop, { width: 100 });
      doc.text("Date", 160, tableTop, { width: 80 });
      doc.text("Due Date", 250, tableTop, { width: 80 });
      doc.text("Status", 340, tableTop, { width: 70 });
      doc.text("Amount", 420, tableTop, { width: 100, align: "right" });
      doc.moveTo(50, tableTop + 15).lineTo(540, tableTop + 15).stroke("#cccccc");

      let yPos = tableTop + 25;
      let grandTotal = 0;
      for (const inv of filtered) {
        doc.fontSize(9).fillColor("#000000");
        doc.text(inv.invoiceNumber, 50, yPos, { width: 100 });
        doc.text(inv.issuedDate || inv.createdAt?.toISOString().split("T")[0] || "", 160, yPos, { width: 80 });
        doc.text(inv.dueDate, 250, yPos, { width: 80 });
        doc.text(inv.status, 340, yPos, { width: 70 });
        doc.text(`$${Number(inv.total).toFixed(2)}`, 420, yPos, { width: 100, align: "right" });
        grandTotal += Number(inv.total);
        yPos += 18;
        if (yPos > 700) {
          doc.addPage();
          yPos = 50;
        }
      }

      doc.moveTo(50, yPos).lineTo(540, yPos).stroke("#cccccc");
      yPos += 10;
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#000000");
      doc.text(`Total: $${grandTotal.toFixed(2)}`, 420, yPos, { width: 100, align: "right" });

      const paidTotal = filtered.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.total), 0);
      const outstandingTotal = grandTotal - paidTotal;
      yPos += 20;
      doc.fontSize(10).font("Helvetica").fillColor("#666666");
      doc.text(`Paid: $${paidTotal.toFixed(2)}`, 420, yPos, { width: 100, align: "right" });
      yPos += 15;
      doc.text(`Outstanding: $${outstandingTotal.toFixed(2)}`, 420, yPos, { width: 100, align: "right" });

      doc.end();
    } catch (err) { handleError(res, err); }
  });

  // ================ Admin: Estimates (T004) ================

  app.post("/api/estimates", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const { contactId, propertyId, description, items, totalCents } = req.body;
      if (!contactId || !description || !items || totalCents === undefined) {
        return res.status(400).json({ error: "contactId, description, items, and totalCents are required" });
      }

      const contact = await storage.getContact(contactId, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const estimate = await storage.createEstimate({
        companyId,
        contactId,
        propertyId: propertyId || null,
        description,
        items,
        totalCents,
        status: "pending",
        sentAt: new Date(),
      });

      if (contact.email) {
        const company = await storage.getCompany(companyId);
        const portalUrl = `${getBaseUrl(req)}/portal/client`;
        sendEmail({
          companyId: companyId,
          to: contact.email,
          subject: `New Estimate from ${company?.name || "Your Service Provider"}`,
          senderName: company?.name || undefined,
          replyTo: company?.email || undefined,
          text: `Hi ${contact.firstName},\n\nYou have a new estimate: ${description}\nTotal: $${(totalCents / 100).toFixed(2)}\n\nLog in to your portal to approve or decline: ${portalUrl}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">${company?.name || "ScooPilot"}</h1>
              </div>
              <div style="padding: 20px; border: 1px solid #e5e7eb;">
                <p>Hi ${contact.firstName},</p>
                <p>You have a new estimate for review:</p>
                <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
                  <p style="margin: 0; font-weight: bold;">${description}</p>
                  <p style="margin: 8px 0 0; font-size: 18px;">Total: $${(totalCents / 100).toFixed(2)}</p>
                </div>
                <a href="${portalUrl}" style="display: inline-block; background-color: #2d8a5e; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold;">Review Estimate</a>
              </div>
            </div>
          `,
        }).catch((err) => console.error("Failed to send estimate email:", err));
      }

      res.json(estimate);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/estimates", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const allEstimates = await storage.getEstimates(companyId, {
        status: req.query.status as string | undefined,
        contactId: req.query.contactId as string | undefined,
      });
      res.json(allEstimates);
    } catch (err) { handleError(res, err); }
  });

  // ================ Admin: Service Change Requests (T006) ================

  app.get("/api/service-change-requests", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const requests = await storage.getServiceChangeRequests(companyId, {
        status: req.query.status as string | undefined,
      });

      const enriched = await Promise.all(requests.map(async (r) => {
        const contact = await storage.getContactById(r.contactId);
        return {
          ...r,
          contactName: contact ? `${contact.firstName} ${contact.lastName}` : "Unknown",
        };
      }));

      res.json(enriched);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/service-change-requests/:id/approve", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const request = await storage.getServiceChangeRequest(req.params.id, companyId);
      if (!request) return res.status(404).json({ error: "Change request not found" });
      if (request.status !== "pending") return res.status(400).json({ error: "Request is not pending" });

      await storage.updateServiceChangeRequest(request.id, companyId, {
        status: "approved",
        adminNote: req.body.adminNote || null,
        respondedAt: new Date(),
      });

      if (request.requestType === "pause") {
        await storage.updateContact(request.contactId, companyId, { status: "paused" });
        const plans = await storage.getServicePlans(companyId, { contactId: request.contactId, isActive: true });
        for (const plan of plans) {
          await storage.updateServicePlan(plan.id, companyId, { isActive: false });
        }
      } else if (request.requestType === "cancel" && request.servicePlanId) {
        await storage.updateServicePlan(request.servicePlanId, companyId, { isActive: false });
      } else if (request.servicePlanId && request.requestedValue) {
        if (request.requestType === "frequency_change") {
          await storage.updateServicePlan(request.servicePlanId, companyId, { frequency: request.requestedValue as any });
        } else if (request.requestType === "day_change") {
          await storage.updateServicePlan(request.servicePlanId, companyId, { dayOfWeek: request.requestedValue as any });
        }
      }

      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/service-change-requests/:id/deny", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const request = await storage.getServiceChangeRequest(req.params.id, companyId);
      if (!request) return res.status(404).json({ error: "Change request not found" });
      if (request.status !== "pending") return res.status(400).json({ error: "Request is not pending" });

      await storage.updateServiceChangeRequest(request.id, companyId, {
        status: "denied",
        adminNote: req.body.adminNote || req.body.reason || null,
        respondedAt: new Date(),
      });

      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  async function provisionPortalAccess(contactId: string, companyId: string, portalBaseUrl: string): Promise<void> {
    const contact = await storage.getContact(contactId, companyId);
    if (!contact || !contact.email) return;

    const tempPassword = crypto.randomBytes(4).toString("hex") + "A1!";
    const salt = crypto.randomBytes(16).toString("hex");
    const portalPasswordHash = await new Promise<string>((resolve, reject) => {
      crypto.scrypt(tempPassword, salt, 64, (err, key) => {
        if (err) reject(err);
        resolve(`${salt}:${key.toString("hex")}`);
      });
    });

    await storage.updateContact(contactId, companyId, { hasPortalAccess: true, portalPasswordHash });

    const company = await storage.getCompany(companyId);
    const portalUrl = `${portalBaseUrl}/portal/login`;
    sendEmail({
      companyId: companyId,
      to: contact.email,
      subject: `Your ${company?.name || "ScooPilot"} Client Portal Access`,
      senderName: company?.name || undefined,
      replyTo: company?.email || undefined,
      text: `Hi ${contact.firstName},\n\nYou now have access to the client portal for ${company?.name || "ScooPilot"}.\n\nPortal Link: ${portalUrl}\nEmail: ${contact.email}\nTemporary Password: ${tempPassword}\n\nPlease log in and change your password.\n\nThank you!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">${company?.name || "ScooPilot"}</h1>
          </div>
          <div style="padding: 20px; border: 1px solid #e5e7eb;">
            <p>Hi ${contact.firstName},</p>
            <p>You now have access to the client portal.</p>
            <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p style="margin: 0 0 8px 0; font-weight: bold;">Your Login Credentials:</p>
              <p style="margin: 0;">Email: <strong>${contact.email}</strong></p>
              <p style="margin: 0;">Temporary Password: <strong>${tempPassword}</strong></p>
            </div>
            <a href="${portalUrl}" style="display: inline-block; background-color: #2d8a5e; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; margin: 16px 0;">Log In to Portal</a>
            <p style="color: #6b7280; font-size: 14px;">Or copy this link: ${portalUrl}</p>
            <p style="color: #6b7280; font-size: 14px;">View your service schedule, invoices, and manage your account.</p>
          </div>
        </div>
      `,
    }).catch((err) => console.error("Failed to send portal access email:", err));
  }

  // Admin route: generate portal invite link
  app.post("/api/contacts/:id/portal-access", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      if (!contact.email) return res.status(400).json({ error: "Contact must have an email address to enable portal access" });

      await provisionPortalAccess(req.params.id, companyId, getBaseUrl(req));

      res.json({ success: true, message: "Portal access enabled. Temporary password has been emailed to the customer." });
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/contacts/:id/portal-access", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      await storage.updateContact(req.params.id, companyId, { hasPortalAccess: false });
      res.json({ success: true, message: "Portal access disabled." });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/contacts/:id/portal-access/reset-password", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role, userId } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      if (!contact.hasPortalAccess) return res.status(400).json({ error: "Portal access is not enabled for this contact" });
      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      const salt = crypto.randomBytes(16).toString("hex");
      const portalPasswordHash = await new Promise<string>((resolve, reject) => {
        crypto.scrypt(newPassword, salt, 64, (err, key) => {
          if (err) reject(err);
          resolve(`${salt}:${key.toString("hex")}`);
        });
      });
      await storage.updateContact(req.params.id, companyId, { portalPasswordHash });
      auditLog(companyId, userId, "contact", req.params.id, "portal_password_reset", { resetBy: userId });
      res.json({ success: true, message: "Client portal password has been updated." });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/contacts/:id/portal-access/resend", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      if (!contact.email) return res.status(400).json({ error: "Contact must have an email address" });
      if (!contact.hasPortalAccess) return res.status(400).json({ error: "Portal access is not enabled for this contact. Enable it first." });

      const tempPassword = crypto.randomBytes(4).toString("hex") + "A1!";
      const salt = crypto.randomBytes(16).toString("hex");
      const portalPasswordHash = await new Promise<string>((resolve, reject) => {
        crypto.scrypt(tempPassword, salt, 64, (err, key) => {
          if (err) reject(err);
          resolve(`${salt}:${key.toString("hex")}`);
        });
      });

      await storage.updateContact(req.params.id, companyId, { portalPasswordHash });

      const company = await storage.getCompany(companyId);
      const portalUrl = `${getBaseUrl(req)}/portal/login`;
      sendEmail({
        companyId: companyId,
        to: contact.email,
        subject: `Your ${company?.name || "ScooPilot"} Portal Login`,
        senderName: company?.name || undefined,
        replyTo: company?.email || undefined,
        text: `Hi ${contact.firstName},\n\nHere is your client portal link for ${company?.name || "ScooPilot"}.\n\nPortal Link: ${portalUrl}\nEmail: ${contact.email}\nNew Password: ${tempPassword}\n\nThank you!`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">${company?.name || "ScooPilot"}</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #e5e7eb;">
              <p>Hi ${contact.firstName},</p>
              <p>Here is your updated login for the client portal.</p>
              <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
                <p style="margin: 0 0 8px 0; font-weight: bold;">Your Login Credentials:</p>
                <p style="margin: 0;">Email: <strong>${contact.email}</strong></p>
                <p style="margin: 0;">New Password: <strong>${tempPassword}</strong></p>
              </div>
              <a href="${portalUrl}" style="display: inline-block; background-color: #2d8a5e; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; margin: 16px 0;">Log In to Portal</a>
              <p style="color: #6b7280; font-size: 14px;">Or copy this link: ${portalUrl}</p>
              <p style="color: #6b7280; font-size: 14px;">View your service schedule, invoices, and manage your account.</p>
            </div>
          </div>
        `,
      }).catch((err) => console.error("Failed to send portal link email:", err));

      res.json({ success: true, message: "Portal link with new credentials has been emailed to the customer." });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/contacts/bulk/send-portal-link", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const { contactIds } = req.body;
      if (!Array.isArray(contactIds) || contactIds.length === 0) {
        return res.status(400).json({ error: "contactIds array is required" });
      }

      const company = await storage.getCompany(companyId);
      const portalUrl = `${getBaseUrl(req)}/portal/login`;
      let sent = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const contactId of contactIds) {
        try {
          const contact = await storage.getContact(contactId, companyId);
          if (!contact) { skipped++; continue; }
          if (!contact.email) { skipped++; errors.push(`${contact.firstName} ${contact.lastName}: no email`); continue; }

          let tempPassword: string | null = null;
          if (!contact.hasPortalAccess) {
            tempPassword = crypto.randomBytes(4).toString("hex") + "A1!";
            const salt = crypto.randomBytes(16).toString("hex");
            const portalPasswordHash = await new Promise<string>((resolve, reject) => {
              crypto.scrypt(tempPassword!, salt, 64, (err, key) => {
                if (err) reject(err);
                resolve(`${salt}:${key.toString("hex")}`);
              });
            });
            await storage.updateContact(contactId, companyId, { hasPortalAccess: true, portalPasswordHash });
          } else {
            tempPassword = crypto.randomBytes(4).toString("hex") + "A1!";
            const salt = crypto.randomBytes(16).toString("hex");
            const portalPasswordHash = await new Promise<string>((resolve, reject) => {
              crypto.scrypt(tempPassword!, salt, 64, (err, key) => {
                if (err) reject(err);
                resolve(`${salt}:${key.toString("hex")}`);
              });
            });
            await storage.updateContact(contactId, companyId, { portalPasswordHash });
          }

          sendEmail({
            companyId: companyId,
            to: contact.email,
            subject: `Your ${company?.name || "ScooPilot"} Portal Login`,
            senderName: company?.name || undefined,
            replyTo: company?.email || undefined,
            text: `Hi ${contact.firstName},\n\nHere is your client portal link for ${company?.name || "ScooPilot"}.\n\nPortal Link: ${portalUrl}\nEmail: ${contact.email}\nPassword: ${tempPassword}\n\nThank you!`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                  <h1 style="color: white; margin: 0;">${company?.name || "ScooPilot"}</h1>
                </div>
                <div style="padding: 20px; border: 1px solid #e5e7eb;">
                  <p>Hi ${contact.firstName},</p>
                  <p>Here is your login for the client portal.</p>
                  <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
                    <p style="margin: 0 0 8px 0; font-weight: bold;">Your Login Credentials:</p>
                    <p style="margin: 0;">Email: <strong>${contact.email}</strong></p>
                    <p style="margin: 0;">Password: <strong>${tempPassword}</strong></p>
                  </div>
                  <a href="${portalUrl}" style="display: inline-block; background-color: #2d8a5e; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; margin: 16px 0;">Log In to Portal</a>
                  <p style="color: #6b7280; font-size: 14px;">Or copy this link: ${portalUrl}</p>
                </div>
              </div>
            `,
          }).catch((err) => console.error(`Failed to send portal link to ${contact.email}:`, err));

          sent++;
        } catch (e: any) {
          skipped++;
          errors.push(e.message || "Unknown error");
        }
      }

      res.json({ success: true, sent, skipped, errors: errors.length > 0 ? errors : undefined });
    } catch (err) { handleError(res, err); }
  });

  // ── Invoice Theme Settings ─────────────────────────────────────────

  app.get("/api/invoice-theme", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      const defaultTheme = loadTheme(getDefaultThemePath());
      if (company?.invoiceTheme) {
        try {
          const custom = JSON.parse(company.invoiceTheme);
          res.json({ ...defaultTheme, ...custom });
        } catch {
          res.json(defaultTheme);
        }
      } else {
        res.json(defaultTheme);
      }
    } catch (err) { handleError(res, err); }
  });

  app.put("/api/invoice-theme", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const theme = req.body;
      const allowed = ["primaryColor", "accentColor", "textColor", "mutedColor", "borderColor", "backgroundColor", "cardColor", "fontFamily", "logoSize", "borderRadius", "showLogo", "logoPosition"];
      const filtered: any = {};
      for (const key of allowed) {
        if (theme[key] !== undefined) filtered[key] = theme[key];
      }
      if (filtered.logoPosition && !["left", "center", "right"].includes(filtered.logoPosition)) {
        return res.status(400).json({ error: "Invalid logoPosition" });
      }
      if (filtered.showLogo !== undefined) filtered.showLogo = Boolean(filtered.showLogo);
      await storage.updateCompany(companyId, { invoiceTheme: JSON.stringify(filtered) });
      const defaultTheme = loadTheme(getDefaultThemePath());
      res.json({ ...defaultTheme, ...filtered });
    } catch (err) { handleError(res, err); }
  });

  // ── Invoice Template Rendering ──────────────────────────────────────

  app.get("/invoice/example", (_req: Request, res: Response) => {
    try {
      const examplePath = path.join(process.cwd(), "server", "templates", "examples", "invoice.example.json");
      const rawData = JSON.parse(fs.readFileSync(examplePath, "utf-8"));
      const computed = computeInvoice(rawData);
      const tpl = loadTemplate(getDefaultTemplatePath());
      const theme = loadTheme(getDefaultThemePath());
      const html = renderInvoice(tpl, theme, computed);
      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/invoice/:invoiceId/render", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const invoice = await storage.getInvoice(req.params.invoiceId, companyId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });

      const lineItems = await storage.getInvoiceLineItems(invoice.id);
      const contact = await storage.getContact(invoice.contactId, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const properties = await storage.getProperties(companyId, contact.id);
      const company = await storage.getCompany(companyId);

      const serviceAddr = properties.length > 0 ? properties[0] : null;
      const statusRaw = invoice.status || "draft";
      const taxRateNum = parseFloat(invoice.taxRate || "0") / 100;
      const discountNum = parseFloat(invoice.discountAmount || "0");
      const paidNum = invoice.paidAt ? parseFloat(invoice.total) : 0;

      const logoUrl = company?.logoUrl ? `${getBaseUrl(req)}${company.logoUrl}` : "";
      const formattedDueDate = invoice.dueDate
        ? new Date(invoice.dueDate + "T12:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
        : "";

      const billingAddr = contact.streetAddress ? {
        line1: contact.streetAddress,
        line2: contact.address2 || "",
        city: contact.city || "",
        state: contact.state || "",
        zip: contact.zipCode || "",
      } : (contact.address ? {
        line1: contact.address,
        line2: "",
        city: "",
        state: "",
        zip: "",
      } : null);
      const serviceAddrObj = serviceAddr ? {
        line1: serviceAddr.streetAddress || serviceAddr.street || "",
        line2: "",
        city: serviceAddr.city || "",
        state: serviceAddr.state || "",
        zip: serviceAddr.zipCode || serviceAddr.zip || "",
      } : null;
      const billingLine = billingAddr ? `${billingAddr.line1} ${billingAddr.city} ${billingAddr.state} ${billingAddr.zip}`.trim() : "";
      const serviceLine = serviceAddrObj ? `${serviceAddrObj.line1} ${serviceAddrObj.city} ${serviceAddrObj.state} ${serviceAddrObj.zip}`.trim() : "";
      const showServiceAddress = serviceAddrObj && serviceLine && serviceLine !== billingLine;

      const hasStripe = isStripeConfigured() && parseFloat(invoice.total) > 0 && invoice.status !== "paid";
      const previewPaymentUrl = hasStripe ? "#preview" : "";

      const invoiceData: any = {
        business: {
          name: company?.name || "",
          address: company?.address || "",
          phone: company?.phone || "",
          website: "",
          logo: logoUrl,
        },
        invoice: {
          number: invoice.invoiceNumber,
          status: statusRaw,
          issue_date: new Date(invoice.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
          due_date: formattedDueDate,
          terms: "Net 30",
          service_period: "",
        },
        customer: {
          name: `${contact.firstName} ${contact.lastName || ""}`.trim(),
        },
        billing_address: billingAddr,
        service_address: serviceAddrObj,
        show_service_address: showServiceAddress ? serviceAddrObj : null,
        line_items: lineItems.map((li: any) => ({
          description: li.description,
          details: "",
          qty: li.quantity,
          unit_price: parseFloat(li.unitPrice),
          line_total: parseFloat(li.total),
        })),
        totals: {
          subtotal: parseFloat(invoice.subtotal),
          discount: discountNum,
          tax_rate: taxRateNum,
          paid: paidNum,
        },
        visits: undefined,
        notes: invoice.notes || "",
        payment_instructions: "",
        thank_you: "Thank you for your business!",
        hasFooter: true,
        paymentUrl: previewPaymentUrl,
        venmoHandle: company?.venmoHandle || "",
        venmoHandleOnly: !previewPaymentUrl && !!company?.venmoHandle ? company.venmoHandle : "",
      };

      const computed = computeInvoice(invoiceData);
      const tpl = loadTemplate(getDefaultTemplatePath());
      const defaultTheme = loadTheme(getDefaultThemePath());
      let theme = defaultTheme;
      if (company?.invoiceTheme) {
        try {
          const custom = JSON.parse(company.invoiceTheme);
          theme = { ...defaultTheme, ...custom };
        } catch {}
      }
      const html = renderInvoice(tpl, theme, computed);

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (err) { handleError(res, err); }
  });

  // ================ Time Entries ================

  app.get("/api/time-entries/active", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { userId } = await getCompanyContext(req);
      const entry = await storage.getActiveTimeEntry(userId);
      res.json(entry || null);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/time-entries/clock-in", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { userId, companyId } = await getCompanyContext(req);
      const existing = await storage.getActiveTimeEntry(userId);
      if (existing) {
        return res.status(400).json({ error: "Already clocked in" });
      }
      const entry = await storage.createTimeEntry({
        companyId,
        userId,
        routeId: req.body.routeId || null,
        clockIn: new Date(),
      });
      res.json(entry);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/time-entries/clock-out", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { userId, companyId } = await getCompanyContext(req);
      const active = await storage.getActiveTimeEntry(userId);
      if (!active) {
        return res.status(400).json({ error: "Not clocked in" });
      }
      const clockOut = new Date();
      const durationMinutes = Math.round((clockOut.getTime() - new Date(active.clockIn).getTime()) / 60000);
      const entry = await storage.updateTimeEntry(active.id, companyId, {
        clockOut,
        durationMinutes,
      });
      res.json(entry);
    } catch (err) { handleError(res, err); }
  });

  // ================ Global Search ================

  app.get("/api/search", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const q = String(req.query.q || "").trim();
      if (!q || q.length < 2) return res.json({ contacts: [], properties: [], invoices: [], routes: [] });
      const searchTerm = `%${q.toLowerCase()}%`;
      const [contacts, properties, invoices, routes] = await Promise.all([
        storage.searchContacts(companyId, searchTerm),
        storage.searchProperties(companyId, searchTerm),
        storage.searchInvoices(companyId, searchTerm),
        storage.searchRoutes(companyId, searchTerm),
      ]);
      res.json({ contacts, properties, invoices, routes });
    } catch (err) { handleError(res, err); }
  });

  // ================ Notifications ================

  app.get("/api/notifications", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const limit = parseInt(req.query.limit as string) || 50;
      let notifs = await storage.getNotifications(companyId, limit);
      if (req.query.unread === "true") {
        notifs = notifs.filter((n) => !n.isRead);
      }
      res.json(notifs);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/notifications/unread-count", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const totalCount = await storage.getUnreadNotificationCount(companyId);
      const allNotifs = await storage.getNotifications(companyId, 100);
      const clientRequestCount = allNotifs.filter((n) =>
        !n.isRead && (
          n.type === "portal_message" ||
          n.title.includes("Service Change Request") ||
          n.title.includes("One-Time Cleanup Request")
        )
      ).length;
      res.json({ count: totalCount, clientRequestCount });
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/notifications/:id/read", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const notif = await storage.markNotificationRead(req.params.id, companyId);
      if (!notif) return res.status(404).json({ error: "Notification not found" });
      res.json(notif);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/notifications/mark-all-read", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      await storage.markAllNotificationsRead(companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  // ================ System Messages ================
  app.get("/api/system-messages", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const includeDismissed = req.query.includeDismissed === "true";
      const messages = await storage.getSystemMessages(companyId, { includeDismissed });
      res.json(messages);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/system-messages/unread-count", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const count = await storage.getUnreadSystemMessageCount(companyId);
      res.json({ count });
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/system-messages/:id/read", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const msg = await storage.markSystemMessageRead(req.params.id, companyId);
      if (!msg) return res.status(404).json({ error: "System message not found" });
      res.json(msg);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/system-messages/:id/dismiss", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const msg = await storage.dismissSystemMessage(req.params.id, companyId);
      if (!msg) return res.status(404).json({ error: "System message not found" });
      res.json(msg);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/system-messages/dismiss-all", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      await storage.dismissAllSystemMessages(companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/notifications/bulk-schedule-change", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (role !== "owner" && role !== "admin") {
        return res.status(403).json({ error: "Only owners and admins can send bulk notifications" });
      }

      const bulkNotifySchema = z.object({
        template: z.string().min(1).max(1000),
        channel: z.enum(["sms", "email", "both"]),
        movedStops: z.array(z.object({
          stopId: z.string(),
          fromDay: z.string(),
          toDay: z.string(),
          contactName: z.string(),
        })).min(1).max(500),
      });

      const parsed = bulkNotifySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }
      const { template, channel, movedStops } = parsed.data;

      const allPlans = await storage.getServicePlans(companyId, { isActive: true });
      const planMap = new Map(allPlans.map(p => [p.id, p]));
      const allContacts = await storage.getContacts(companyId);
      const contactMap = new Map(allContacts.map(c => [c.id, c]));

      const company = await storage.getCompany(companyId);
      const companyName = company?.name || "Your Pet Waste Service";

      const results: { contactName: string; channel: string; success: boolean; error?: string }[] = [];

      const { sendSmsForCompany } = await import("./services/sms");
      const { sendEmail, logEmailSent } = await import("./services/email");

      const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

      for (const stop of movedStops) {
        const plan = planMap.get(stop.stopId);
        if (!plan) {
          results.push({ contactName: stop.contactName, channel: channel, success: false, error: "Service plan not found" });
          continue;
        }
        const contact = contactMap.get(plan.contactId);
        if (!contact) {
          results.push({ contactName: stop.contactName, channel: channel, success: false, error: "Contact not found" });
          continue;
        }

        const firstName = contact.firstName || stop.contactName.split(" ")[0] || "Customer";
        const personalizedMsg = template
          .replace(/\[Name\]/gi, firstName)
          .replace(/\[OldDay\]/gi, capitalize(stop.fromDay))
          .replace(/\[NewDay\]/gi, capitalize(stop.toDay));

        if ((channel === "sms" || channel === "both") && contact.phone) {
          try {
            const smsResult = await sendSmsForCompany({
              to: contact.phone,
              body: personalizedMsg,
              companyId,
              contactId: contact.id,
            });
            results.push({ contactName: stop.contactName, channel: "sms", success: smsResult.success, error: smsResult.error });
            if (!smsResult.success) {
              await storage.createSystemMessage({
                companyId,
                type: "bulk_notify_failure",
                severity: "error",
                title: `SMS failed: ${stop.contactName}`,
                body: `Could not send schedule change SMS to ${stop.contactName}${contact.phone ? ` (${contact.phone})` : ""}: ${smsResult.error || "Unknown error"}`,
                metadata: { contactId: contact.id, channel: "sms", stopId: stop.stopId },
              });
            }
          } catch (err: any) {
            results.push({ contactName: stop.contactName, channel: "sms", success: false, error: err.message });
            await storage.createSystemMessage({
              companyId,
              type: "bulk_notify_failure",
              severity: "error",
              title: `SMS failed: ${stop.contactName}`,
              body: `Exception sending SMS to ${stop.contactName}: ${err.message}`,
              metadata: { contactId: contact.id, channel: "sms", stopId: stop.stopId },
            });
          }
        } else if ((channel === "sms" || channel === "both") && !contact.phone) {
          results.push({ contactName: stop.contactName, channel: "sms", success: false, error: "No phone number on file" });
          await storage.createSystemMessage({
            companyId,
            type: "bulk_notify_failure",
            severity: "warning",
            title: `SMS skipped: ${stop.contactName}`,
            body: `${stop.contactName} has no phone number on file. Could not send schedule change notification via SMS.`,
            metadata: { contactId: contact.id, channel: "sms", stopId: stop.stopId },
          });
        }

        if ((channel === "email" || channel === "both") && contact.email) {
          try {
            const subject = `Service Day Change - ${companyName}`;
            const emailResult = await sendEmail({
              companyId: companyId,
              to: contact.email,
              subject,
              text: personalizedMsg,
              senderName: companyName,
            });
            results.push({ contactName: stop.contactName, channel: "email", success: emailResult.success, error: emailResult.error });
            if (emailResult.success) {
              await logEmailSent(companyId, contact.email, subject, "schedule_change", emailResult.messageId);
            } else {
              await storage.createSystemMessage({
                companyId,
                type: "bulk_notify_failure",
                severity: "error",
                title: `Email failed: ${stop.contactName}`,
                body: `Could not send schedule change email to ${stop.contactName} (${contact.email}): ${emailResult.error || "Unknown error"}`,
                metadata: { contactId: contact.id, channel: "email", stopId: stop.stopId },
              });
            }
          } catch (err: any) {
            results.push({ contactName: stop.contactName, channel: "email", success: false, error: err.message });
            await storage.createSystemMessage({
              companyId,
              type: "bulk_notify_failure",
              severity: "error",
              title: `Email failed: ${stop.contactName}`,
              body: `Exception sending email to ${stop.contactName}: ${err.message}`,
              metadata: { contactId: contact.id, channel: "email", stopId: stop.stopId },
            });
          }
        } else if ((channel === "email" || channel === "both") && !contact.email) {
          results.push({ contactName: stop.contactName, channel: "email", success: false, error: "No email on file" });
          await storage.createSystemMessage({
            companyId,
            type: "bulk_notify_failure",
            severity: "warning",
            title: `Email skipped: ${stop.contactName}`,
            body: `${stop.contactName} has no email on file. Could not send schedule change notification via email.`,
            metadata: { contactId: contact.id, channel: "email", stopId: stop.stopId },
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      await storage.createSystemMessage({
        companyId,
        type: "bulk_notify_summary",
        severity: failCount > 0 ? "warning" : "info",
        title: `Bulk Schedule Notifications Sent`,
        body: `${successCount} message${successCount !== 1 ? "s" : ""} sent successfully${failCount > 0 ? `, ${failCount} failed` : ""}. ${movedStops.length} customer${movedStops.length !== 1 ? "s" : ""} notified about day changes.`,
        metadata: { successCount, failCount, totalStops: movedStops.length, channel },
      });

      res.json({ success: true, results, summary: { sent: successCount, failed: failCount, total: results.length } });
    } catch (err) { handleError(res, err); }
  });

  // ================ Audit Trail ================
  app.get("/api/audit-trail", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { entityType, startDate, endDate } = req.query as { entityType?: string; startDate?: string; endDate?: string };
      const filters: { entityType?: string; startDate?: string; endDate?: string } = {};
      if (entityType) filters.entityType = entityType;
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;
      const entries = await storage.getAuditTrail(companyId, filters);
      res.json(entries);
    } catch (err) { handleError(res, err); }
  });

  // ================ Admin (Platform-level) Routes ================
  // Seed admin user on startup
  import("./services/admin-auth").then(({ seedAdminUser }) => {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_INITIAL_PASSWORD;
    if (email && password) {
      seedAdminUser(email, password).catch(console.error);
    }
  });

  async function isAdmin(req: Request, res: Response, next: Function) {
    const token = req.headers["x-admin-token"] as string;
    if (!token) return res.status(401).json({ error: "Admin authentication required" });
    const { validateAdminSession } = await import("./services/admin-auth");
    const session = await validateAdminSession(token);
    if (!session) return res.status(401).json({ error: "Invalid or expired session" });
    (req as any).adminUser = session;
    next();
  }

  app.post("/api/admin/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: "Email and password required" });
      const { loginAdmin } = await import("./services/admin-auth");
      const result = await loginAdmin(email, password);
      const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
      if ("error" in result) {
        await db.insert(adminAuditLogs).values({ adminEmail: email, action: "login_failed", ipAddress: ip }).catch(() => {});
        return res.status(401).json({ error: result.error });
      }
      const [adminUser] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, email));
      await db.insert(adminAuditLogs).values({ adminUserId: adminUser?.id, adminEmail: email, action: "login_success", ipAddress: ip }).catch(() => {});
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/admin/logout", async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-admin-token"] as string;
      if (token) {
        const { logoutAdmin } = await import("./services/admin-auth");
        await logoutAdmin(token);
      }
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/admin/change-password", isAdmin, async (req: Request, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) return res.status(400).json({ error: "Both passwords required" });
      const { changeAdminPassword } = await import("./services/admin-auth");
      const result = await changeAdminPassword((req as any).adminUser.userId, currentPassword, newPassword);
      if (result.error) return res.status(400).json({ error: result.error });
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/admin/check", isAdmin, async (req: Request, res: Response) => {
    const { isPasswordExpired } = await import("./services/admin-auth");
    const expired = await isPasswordExpired((req as any).adminUser.userId);
    res.json({ isAdmin: true, email: (req as any).adminUser.email, mustChangePassword: expired });
  });

  app.get("/api/admin/stats", isAdmin, async (_req: Request, res: Response) => {
    try {
      const stats = await storage.getPlatformStats();
      res.json(stats);
    } catch (err) { handleError(res, err); }
  });

  // Platform admin: view ALL message exceptions (including zero-candidate items)
  app.get("/api/admin/message-exceptions", isAdmin, async (req: Request, res: Response) => {
    try {
      const resolved = req.query.resolved === "true" ? true : req.query.resolved === "false" ? false : undefined;
      const exceptions = await storage.getMessageExceptions({ resolved });
      res.json(exceptions);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/admin/message-exceptions/:id/resolve", isAdmin, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ error: "companyId is required" });
      const adminUserId = (req as any).adminUser.userId;
      const exception = await storage.resolveMessageException(req.params.id, adminUserId, companyId, true);
      if (!exception) return res.status(404).json({ error: "Exception not found or already resolved" });

      if (exception.body && exception.fromAddress) {
        try {
          const allContacts = await storage.getContacts(companyId);
          const fromDigits = exception.fromAddress.replace(/\D/g, "");
          const matchedContact = allContacts.find(c => {
            const cDigits = (c.phone || "").replace(/\D/g, "");
            return cDigits.length >= 10 && fromDigits.length >= 10 && fromDigits.endsWith(cDigits.slice(-10));
          });

          await storage.createMessage({
            companyId,
            contactId: matchedContact?.id || null,
            channel: "sms",
            direction: "inbound",
            status: "received",
            fromAddress: exception.fromAddress,
            toAddress: exception.toAddress,
            body: exception.body,
            externalId: exception.providerMessageId || undefined,
          });

          if (matchedContact) {
            const { isSharedNumber } = await import("./services/sms");
            if (isSharedNumber(exception.toAddress)) {
              await storage.upsertMessageRouting({
                sharedNumber: exception.toAddress,
                customerPhone: exception.fromAddress,
                companyId,
                contactId: matchedContact.id,
                channel: "sms",
                lastUsedAt: new Date(),
              });
            }
          }
        } catch (msgErr) {
          console.error(`[Admin MessageException] Resolved exception ${req.params.id} but message delivery failed:`, msgErr);
        }
      }
      res.json(exception);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/admin/message-exceptions/:id/dismiss", isAdmin, async (req: Request, res: Response) => {
    try {
      const adminUserId = (req as any).adminUser.userId;
      const exception = await storage.dismissMessageException(req.params.id, adminUserId);
      if (!exception) return res.status(404).json({ error: "Exception not found or already resolved" });
      res.json(exception);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/admin/inactive-users", isAdmin, async (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const thresholds = [3, 5, 7, 14];
      const result: Record<string, any[]> = {};
      for (const days of thresholds) {
        const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        const rows = await db
          .select({
            userId: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            lastLoginAt: users.lastLoginAt,
            companyId: companyUsers.companyId,
            companyName: companies.name,
            role: companyUsers.role,
          })
          .from(users)
          .innerJoin(companyUsers, eq(companyUsers.userId, users.id))
          .innerJoin(companies, eq(companies.id, companyUsers.companyId))
          .where(
            sql`(${users.lastLoginAt} IS NULL OR ${users.lastLoginAt} < ${cutoff})`
          );
        result[`${days}d`] = rows;
      }
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/admin/companies", isAdmin, async (_req: Request, res: Response) => {
    try {
      const allCompanies = await storage.getAllCompanies();
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const { TIER_CONFIG: tierCfg } = await import("@shared/schema");

      const enriched = await Promise.all(allCompanies.map(async (c) => {
        const companyUsersList = await storage.getCompanyUsers(c.id);
        const activeUserCount = companyUsersList.filter(cu => cu.isActive).length;
        const contactList = await storage.getContacts(c.id);

        const smsResult = await db.select({ total: sql<number>`COALESCE(SUM(${usageEvents.quantity}), 0)` })
          .from(usageEvents)
          .where(and(eq(usageEvents.companyId, c.id), eq(usageEvents.eventType, "sms_segment"), gte(usageEvents.recordedAt, periodStart)));
        const voiceResult = await db.select({ total: sql<number>`COALESCE(SUM(${usageEvents.quantity}), 0)` })
          .from(usageEvents)
          .where(and(eq(usageEvents.companyId, c.id), eq(usageEvents.eventType, "voice_minute"), gte(usageEvents.recordedAt, periodStart)));

        const tierKey = c.subscriptionTier as keyof typeof tierCfg;
        const tierMaxUsers = tierCfg[tierKey]?.maxUsers || 1;
        const maxUsers = (c as any).customMaxUsers ?? tierMaxUsers;
        const nearLimit = activeUserCount >= Math.ceil(maxUsers * 0.8);

        return {
          ...c,
          userCount: companyUsersList.length,
          activeUserCount,
          maxUsers,
          nearUserLimit: nearLimit,
          contactCount: contactList.length,
          smsSegments: Number(smsResult[0]?.total || 0),
          voiceMinutes: Number(voiceResult[0]?.total || 0),
        };
      }));
      res.json(enriched);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/admin/companies/:id", isAdmin, async (req: Request, res: Response) => {
    try {
      const company = await storage.getCompany(req.params.id);
      if (!company) return res.status(404).json({ error: "Company not found" });
      const companyUserRecords = await storage.getCompanyUsers(company.id);
      const usersWithDetails = await Promise.all(
        companyUserRecords.map(async (cu) => {
          const user = await getUserById(cu.userId);
          return {
            ...cu,
            email: user?.email || "unknown",
            firstName: user?.firstName || "",
            lastName: user?.lastName || "",
            lastLoginAt: user?.lastLoginAt || null,
          };
        })
      );
      const contactList = await storage.getContacts(company.id);
      const invoiceList = await storage.getInvoices(company.id);
      const notes = await storage.getAdminNotes(company.id);
      res.json({ ...company, users: usersWithDetails, contacts: contactList, invoices: invoiceList, notes });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/admin/companies", isAdmin, async (req: Request, res: Response) => {
    try {
      const { companyName, ownerEmail, ownerFirstName, ownerLastName, subscriptionTier } = req.body;
      if (!companyName || !ownerEmail || !ownerFirstName) {
        return res.status(400).json({ error: "Company name, owner email, and owner first name are required" });
      }
      if (typeof companyName !== "string" || companyName.trim().length < 2) {
        return res.status(400).json({ error: "Company name must be at least 2 characters" });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(ownerEmail)) {
        return res.status(400).json({ error: "Invalid email address" });
      }
      const validTiers = ["free_trial", "tier_1", "tier_1_3", "tier_3_5", "tier_6_10", "tier_10_plus"];
      const tier = validTiers.includes(subscriptionTier) ? subscriptionTier : "tier_1";

      let user = await getUserByEmail(ownerEmail);
      let tempPassword: string | null = null;
      let isExistingUser = false;

      if (!user) {
        const crypto = await import("crypto");
        tempPassword = crypto.randomBytes(6).toString("base64url");
        user = await createUserWithTempPassword(ownerEmail, ownerFirstName, ownerLastName || "", tempPassword);
      } else {
        isExistingUser = true;
      }

      const existingCompanies = await storage.getCompaniesForUser(user.id);
      if (existingCompanies.length > 0) {
        return res.status(409).json({ error: "This user already belongs to a company" });
      }

      const company = await storage.createCompany({
        name: companyName.trim(),
        email: ownerEmail,
        subscriptionTier: tier,
        subscriptionStatus: tier === "free_trial" ? "trialing" : "active",
      });
      await storage.addUserToCompany(user.id, company.id, "owner");

      await seedDefaultLeadSources(company.id);

      let emailSent = false;
      try {
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = req.headers.host || "localhost:5000";
        const appUrl = `${protocol}://${host}`;

        if (tempPassword) {
          await sendEmail({
            companyId: company.id,
            to: ownerEmail,
            subject: `Your ScooPilot account is ready`,
            text: `Hi ${ownerFirstName},\n\nYour ScooPilot account "${companyName}" has been created.\n\nLog in at: ${appUrl}\nEmail: ${ownerEmail}\nTemporary Password: ${tempPassword}\n\nYou'll be asked to set a new password on your first login.`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                  <h1 style="color: white; margin: 0;">ScooPilot</h1>
                </div>
                <div style="padding: 20px; border: 1px solid #e5e7eb;">
                  <h2 style="margin-top: 0;">Welcome to ScooPilot!</h2>
                  <p>Hi ${ownerFirstName},</p>
                  <p>Your account <strong>"${companyName}"</strong> has been created and is ready to use.</p>
                  <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 4px 0;"><strong>Email:</strong> ${ownerEmail}</p>
                    <p style="margin: 4px 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
                  </div>
                  <div style="text-align: center; margin: 24px 0;">
                    <a href="${appUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log In Now</a>
                  </div>
                  <p style="color: #6b7280; font-size: 14px;">You'll be asked to set a new password when you first log in.</p>
                </div>
              </div>
            `,
          });
          emailSent = true;
        } else {
          await sendEmail({
            companyId: company.id,
            to: ownerEmail,
            subject: `You've been added to ${companyName} on ScooPilot`,
            text: `Hi,\n\nYou've been added as the owner of "${companyName}" on ScooPilot.\n\nLog in at: ${appUrl}`,
            html: `<p>Hi,</p><p>You've been added as the owner of <strong>"${companyName}"</strong> on ScooPilot.</p><p><a href="${appUrl}">Log in now</a></p>`,
          });
          emailSent = true;
        }
      } catch (emailErr) {
        console.error("[Admin] Failed to send welcome email:", emailErr);
      }

      sendAdminSignupNotification({
        companyName: companyName.trim(),
        ownerEmail,
        ownerName: [ownerFirstName, ownerLastName].filter(Boolean).join(" "),
        tier,
        source: "Admin Created",
      }).catch((err) => console.error("[Signup Notification] Failed during admin creation:", err));

      res.status(201).json({
        id: company.id,
        name: companyName.trim(),
        ownerEmail,
        subscriptionTier: tier,
        isExistingUser,
        emailSent,
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/admin/migrate-stripe-customers", isAdmin, async (req: Request, res: Response) => {
    try {
      if (!isStripeConfigured()) return res.status(400).json({ error: "Stripe is not configured" });

      const dryRun = req.body?.dryRun === true;
      const allCompanies = await storage.listCompanies();
      const results: Array<{ companyId: string; companyName: string; migratedContacts: number; skippedContacts: number; errors: string[] }> = [];

      for (const company of allCompanies) {
        if (!company.stripeConnectOnboarded || !company.stripeConnectAccountId) continue;

        const contacts = await storage.getContacts(company.id);
        const companyResult = { companyId: company.id, companyName: company.name, migratedContacts: 0, skippedContacts: 0, errors: [] as string[] };

        for (const contact of contacts) {
          if (!contact.stripeCustomerId) continue;

          if (dryRun) {
            const isPlatform = await isCustomerOnPlatform(contact.stripeCustomerId);
            if (isPlatform) {
              companyResult.migratedContacts++;
            } else {
              companyResult.skippedContacts++;
            }
            continue;
          }

          try {
            const migrationResult = await migrateCustomerToConnectedAccount({
              platformCustomerId: contact.stripeCustomerId,
              stripeAccount: company.stripeConnectAccountId!,
              email: contact.email || undefined,
              name: `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "Unknown",
              metadata: { contactId: contact.id, companyId: company.id },
            });

            if (migrationResult.status === "skipped") {
              companyResult.skippedContacts++;
              console.log(`[Stripe Migration] Skipped contact ${contact.id} — customer ${contact.stripeCustomerId} not found on platform (already migrated)`);
            } else {
              await storage.updateContact(contact.id, company.id, { stripeCustomerId: migrationResult.newCustomerId });
              companyResult.migratedContacts++;
              const statusLabel = migrationResult.status === "partial" ? " (PARTIAL — some payment methods failed)" : "";
              console.log(`[Stripe Migration] Migrated contact ${contact.id} (${contact.firstName} ${contact.lastName}): ${contact.stripeCustomerId} → ${migrationResult.newCustomerId} (${migrationResult.migratedPaymentMethods}/${migrationResult.totalPaymentMethods} payment methods)${statusLabel}`);
              if (migrationResult.failedPaymentMethods.length > 0) {
                companyResult.errors.push(`Contact ${contact.id}: partial PM migration — failed: ${migrationResult.failedPaymentMethods.join(", ")}`);
              }
            }
          } catch (migErr: any) {
            companyResult.errors.push(`Contact ${contact.id}: ${migErr.message}`);
            console.error(`[Stripe Migration] Failed to migrate contact ${contact.id}: ${migErr.message}`);
          }
        }

        results.push(companyResult);
      }

      const totalMigrated = results.reduce((sum, r) => sum + r.migratedContacts, 0);
      const totalSkipped = results.reduce((sum, r) => sum + r.skippedContacts, 0);
      const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
      res.json({ dryRun, totalMigrated, totalSkipped, totalErrors, results });
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/admin/companies/:id/subscription", isAdmin, async (req: Request, res: Response) => {
    try {
      const { tier, subscriptionStatus, trialEndsAt, customMaxUsers } = req.body;
      const validTiers = ["free_trial", "tier_1", "tier_1_3", "tier_3_5", "tier_6_10", "tier_10_plus"];
      if (!tier || !validTiers.includes(tier)) return res.status(400).json({ error: "Invalid tier" });
      const validStatuses = ["active", "trialing", "past_due", "cancelled", "suspended"];
      if (subscriptionStatus !== undefined && !validStatuses.includes(subscriptionStatus)) {
        return res.status(400).json({ error: "Invalid subscription status" });
      }
      const opts: { subscriptionStatus?: string; trialEndsAt?: Date | null; customMaxUsers?: number | null } = {};
      if (subscriptionStatus !== undefined) opts.subscriptionStatus = subscriptionStatus;
      if (trialEndsAt !== undefined) opts.trialEndsAt = trialEndsAt ? new Date(trialEndsAt) : null;
      if (customMaxUsers !== undefined) opts.customMaxUsers = customMaxUsers === null ? null : parseInt(customMaxUsers);
      const updated = await storage.updateCompanySubscription(req.params.id, tier, opts);
      await logAdminAudit(req, "change_subscription", "company", req.params.id, { tier, subscriptionStatus, trialEndsAt, customMaxUsers });
      res.json(updated);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/admin/companies/:id/users/:userId/reset-password", isAdmin, async (req: Request, res: Response) => {
    try {
      const { id: companyId, userId } = req.params;
      const { newPassword } = req.body;
      const companyUsers = await storage.getCompanyUsers(companyId);
      const cu = companyUsers.find((u) => u.userId === userId);
      if (!cu) return res.status(404).json({ error: "User not found in this company" });
      const user = await getUserById(userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      const crypto = await import("crypto");
      const password = newPassword && typeof newPassword === "string" && newPassword.length >= 8
        ? newPassword
        : crypto.randomBytes(6).toString("base64url");
      const { users: usersTable } = await import("@shared/schema");
      const salt = crypto.randomBytes(16).toString("hex");
      const SCRYPT_KEYLEN = 64;
      const hash = await new Promise<string>((resolve, reject) => {
        crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, key) => {
          if (err) reject(err);
          else resolve(`${salt}:${key.toString("hex")}`);
        });
      });
      await db.update(usersTable)
        .set({ passwordHash: hash, mustChangePassword: true })
        .where(eq(usersTable.id, userId));
      console.log(`[Admin] Password reset for user ${user.email} (${userId}) by ${(req as any).adminUser?.email}`);
      res.json({ ok: true, email: user.email, tempPassword: password });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/admin/companies/:id/users/:userId/send-reset-email", isAdmin, async (req: Request, res: Response) => {
    try {
      const { id: companyId, userId } = req.params;
      const companyUsers = await storage.getCompanyUsers(companyId);
      const cu = companyUsers.find((u) => u.userId === userId);
      if (!cu) return res.status(404).json({ error: "User not found in this company" });
      const user = await getUserById(userId);
      if (!user || !user.email) return res.status(404).json({ error: "User not found" });

      const result = await createPasswordResetToken(user.email);
      if ("error" in result) return res.status(400).json({ error: result.error });

      const host = req.headers.host || "localhost:5000";
      const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");
      const resetUrl = `${isLocalhost ? "http" : "https"}://${host}/reset-password?token=${result.token}`;

      const emailResult = await sendEmail({
        companyId: companyId,
        to: user.email,
        subject: "Reset your ScooPilot password",
        text: `Hi ${user.firstName || "there"},\n\nA password reset was requested for your account. Click the link below to set a new password:\n\n${resetUrl}\n\nThis link expires in 1 hour.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">ScooPilot</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #e5e7eb;">
              <h2 style="margin-top: 0;">Password Reset</h2>
              <p>Hi ${user.firstName || "there"},</p>
              <p>A password reset was requested for your account. Click the button below to set a new password:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
              </div>
              <p style="color: #6b7280; font-size: 14px;">This link expires in 1 hour.</p>
            </div>
          </div>
        `,
      });

      if (!emailResult.success) {
        return res.status(500).json({ error: "Failed to send email: " + emailResult.error });
      }

      console.log(`[Admin] Password reset email sent to ${user.email} by ${(req as any).adminUser?.email}`);
      res.json({ ok: true, email: user.email });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/admin/companies/:id/users/:userId/send-credentials", isAdmin, async (req: Request, res: Response) => {
    try {
      const { id: companyId, userId } = req.params;
      const companyUsers = await storage.getCompanyUsers(companyId);
      const cu = companyUsers.find((u) => u.userId === userId);
      if (!cu) return res.status(404).json({ error: "User not found in this company" });
      const user = await getUserById(userId);
      if (!user || !user.email) return res.status(404).json({ error: "User not found" });

      const crypto = await import("crypto");
      const tempPassword = crypto.randomBytes(6).toString("base64url");
      const { users: usersTable } = await import("@shared/schema");
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = await new Promise<string>((resolve, reject) => {
        crypto.scrypt(tempPassword, salt, 64, (err, key) => {
          if (err) reject(err);
          else resolve(`${salt}:${key.toString("hex")}`);
        });
      });

      const host = req.headers.host || "localhost:5000";
      const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");
      const appUrl = `${isLocalhost ? "http" : "https"}://${host}`;

      const emailResult = await sendEmail({
        companyId: companyId,
        to: user.email,
        subject: "Your ScooPilot login credentials",
        text: `Hi ${user.firstName || "there"},\n\nHere are your ScooPilot login credentials:\n\nLogin: ${appUrl}\nEmail: ${user.email}\nTemporary Password: ${tempPassword}\n\nYou'll be asked to set a new password on your first login.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">ScooPilot</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #e5e7eb;">
              <h2 style="margin-top: 0;">Your Login Credentials</h2>
              <p>Hi ${user.firstName || "there"},</p>
              <p>Here are your login credentials for ScooPilot:</p>
              <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 4px 0;"><strong>Email:</strong> ${user.email}</p>
                <p style="margin: 4px 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
              </div>
              <div style="text-align: center; margin: 24px 0;">
                <a href="${appUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log In Now</a>
              </div>
              <p style="color: #6b7280; font-size: 14px;">You'll be asked to set a new password when you first log in.</p>
            </div>
          </div>
        `,
      });

      if (!emailResult.success) {
        return res.status(500).json({ error: "Failed to send credentials email. Password was not changed." });
      }

      await db.update(usersTable)
        .set({ passwordHash: hash, mustChangePassword: true })
        .where(eq(usersTable.id, userId));

      console.log(`[Admin] Credentials sent to ${user.email} by ${(req as any).adminUser?.email}`);
      res.json({ ok: true, email: user.email });
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/admin/companies/:id", isAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = req.params.id;
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const { name, email, phone, address } = req.body;
      const updates: Record<string, any> = {};
      if (name !== undefined) {
        if (typeof name !== "string" || name.trim().length < 2) return res.status(400).json({ error: "Company name must be at least 2 characters" });
        updates.name = name.trim();
      }
      if (email !== undefined) {
        if (email && typeof email === "string" && email.trim()) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(email.trim())) return res.status(400).json({ error: "Invalid email address" });
          updates.email = email.trim();
        } else {
          updates.email = null;
        }
      }
      if (phone !== undefined) updates.phone = phone?.trim() || null;
      if (address !== undefined) updates.address = address?.trim() || null;

      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No fields to update" });

      const { companies: companiesTable } = await import("@shared/schema");
      await db.update(companiesTable).set(updates).where(eq(companiesTable.id, companyId));

      console.log(`[Admin] Company ${companyId} updated by ${(req as any).adminUser?.email}: ${JSON.stringify(updates)}`);
      res.json({ ok: true, ...updates });
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/admin/companies/:id/users/:userId", isAdmin, async (req: Request, res: Response) => {
    try {
      const { id: companyId, userId } = req.params;
      const companyUsers = await storage.getCompanyUsers(companyId);
      const cu = companyUsers.find((u) => u.userId === userId);
      if (!cu) return res.status(404).json({ error: "User not found in this company" });

      const { firstName, lastName, email, role } = req.body;
      const userUpdates: Record<string, any> = {};
      if (firstName !== undefined) userUpdates.firstName = firstName?.trim() || null;
      if (lastName !== undefined) userUpdates.lastName = lastName?.trim() || null;
      if (email !== undefined) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) return res.status(400).json({ error: "Invalid email address" });
        const existing = await getUserByEmail(email.toLowerCase());
        if (existing && existing.id !== userId) return res.status(409).json({ error: "Email already in use by another account" });
        userUpdates.email = email.toLowerCase().trim();
      }

      if (Object.keys(userUpdates).length > 0) {
        const { users: usersTable } = await import("@shared/schema");
        await db.update(usersTable).set(userUpdates).where(eq(usersTable.id, userId));
      }

      if (role !== undefined) {
        const validRoles = ["owner", "admin", "tech"];
        if (!validRoles.includes(role)) return res.status(400).json({ error: "Invalid role" });
        const { companyUsers: companyUsersTable } = await import("@shared/schema");
        await db.update(companyUsersTable)
          .set({ role })
          .where(and(eq(companyUsersTable.userId, userId), eq(companyUsersTable.companyId, companyId)));
      }

      const oldData: Record<string, any> = {};
      const newData: Record<string, any> = {};
      if (firstName !== undefined) { oldData.firstName = cu.firstName; newData.firstName = firstName?.trim() || null; }
      if (lastName !== undefined) { oldData.lastName = cu.lastName; newData.lastName = lastName?.trim() || null; }
      if (email !== undefined) { oldData.email = cu.email; newData.email = email.toLowerCase().trim(); }
      if (role !== undefined) { oldData.role = cu.role; newData.role = role; }
      auditLog(companyId, null, "user", userId, "update", { old: oldData, new: newData, actor: "platform_admin", adminEmail: (req as any).adminUser?.email }, req.ip || undefined);

      console.log(`[Admin] User ${userId} in company ${companyId} updated by ${(req as any).adminUser?.email}`);
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/admin/companies/:id", isAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = req.params.id;
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      const companyUsersList = await storage.getCompanyUsers(companyId);
      const { companies: companiesTable, users: usersTable, companyUsers: companyUsersTable } = await import("@shared/schema");

      await db.transaction(async (tx) => {
        await tx.delete(companiesTable).where(eq(companiesTable.id, companyId));
        for (const cu of companyUsersList) {
          const [remaining] = await tx.select({ count: sql<number>`count(*)` })
            .from(companyUsersTable)
            .where(eq(companyUsersTable.userId, cu.userId));
          if (!remaining || Number(remaining.count) === 0) {
            await tx.delete(usersTable).where(eq(usersTable.id, cu.userId));
          }
        }
      });

      console.log(`[Admin] Tenant "${company.name}" (${companyId}) deleted by ${(req as any).adminUser?.email}`);
      res.json({ ok: true, deletedCompany: company.name });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/admin/companies/:id/notes", isAdmin, async (req: Request, res: Response) => {
    try {
      const notes = await storage.getAdminNotes(req.params.id);
      res.json(notes);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/admin/companies/:id/notes", isAdmin, async (req: Request, res: Response) => {
    try {
      const { content } = req.body;
      if (!content) return res.status(400).json({ error: "Content required" });
      const note = await storage.createAdminNote({
        companyId: req.params.id,
        content,
        createdBy: (req as any).adminUser.email,
      });
      res.json(note);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/admin/notes/:noteId", isAdmin, async (req: Request, res: Response) => {
    try {
      await storage.deleteAdminNote(req.params.noteId);
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/admin/companies/:id/usage", isAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = req.params.id;
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const smsResult = await db.select({ total: sql<number>`COALESCE(SUM(${usageEvents.quantity}), 0)` })
        .from(usageEvents)
        .where(and(eq(usageEvents.companyId, companyId), eq(usageEvents.eventType, "sms_segment"), gte(usageEvents.recordedAt, periodStart)));
      const voiceResult = await db.select({ total: sql<number>`COALESCE(SUM(${usageEvents.quantity}), 0)` })
        .from(usageEvents)
        .where(and(eq(usageEvents.companyId, companyId), eq(usageEvents.eventType, "voice_minute"), gte(usageEvents.recordedAt, periodStart)));

      const companyUsersList = await storage.getCompanyUsers(companyId);
      const activeUsers = companyUsersList.filter(cu => cu.isActive).length;

      const { TIER_CONFIG: tierCfg } = await import("@shared/schema");
      const tierKey = company.subscriptionTier as keyof typeof tierCfg;
      const maxUsers = company.customMaxUsers ?? tierCfg[tierKey]?.maxUsers ?? 1;

      const apiCallResult = await db.select({ total: sql<number>`COALESCE(SUM(${usageEvents.quantity}), 0)` })
        .from(usageEvents)
        .where(and(eq(usageEvents.companyId, companyId), eq(usageEvents.eventType, "api_call"), gte(usageEvents.recordedAt, periodStart)));

      const msgCount = await db.select({ total: sql<number>`count(*)` })
        .from(messagesTable)
        .where(and(eq(messagesTable.companyId, companyId), gte(messagesTable.createdAt, periodStart)));

      const contactCount = await db.select({ total: sql<number>`count(*)` })
        .from(contacts)
        .where(eq(contacts.companyId, companyId));
      const visitCount = await db.select({ total: sql<number>`count(*)` })
        .from(visits)
        .where(eq(visits.companyId, companyId));

      res.json({
        periodStart: periodStart.toISOString(),
        smsSegments: Number(smsResult[0]?.total || 0),
        voiceMinutes: Number(voiceResult[0]?.total || 0),
        activeUsers,
        maxUsers,
        apiCalls: Number(apiCallResult[0]?.total || 0),
        messagesSent: Number(msgCount[0]?.total || 0),
        totalContacts: Number(contactCount[0]?.total || 0),
        totalVisits: Number(visitCount[0]?.total || 0),
      });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/admin/companies/:id/voice-calls", isAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = req.params.id;
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const calls = await storage.getVoiceCalls(companyId, limit);
      res.json(calls);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/admin/companies/:id/audit-logs", isAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = req.params.id;
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const entityType = req.query.entityType as string | undefined;

      let conditions = [eq(auditTrail.companyId, companyId)];
      if (entityType) conditions.push(eq(auditTrail.entityType, entityType));

      const [countResult] = await db.select({ total: sql<number>`count(*)` })
        .from(auditTrail)
        .where(and(...conditions));
      const logs = await db.select()
        .from(auditTrail)
        .where(and(...conditions))
        .orderBy(desc(auditTrail.createdAt))
        .limit(limit)
        .offset(offset);

      const userIds = [...new Set(logs.filter(l => l.userId).map(l => l.userId!))];
      const userMap = new Map<string, string>();
      for (const uid of userIds) {
        const user = await getUserById(uid);
        if (user) userMap.set(uid, user.email);
      }

      const enrichedLogs = logs.map(l => ({
        ...l,
        userEmail: l.userId ? userMap.get(l.userId) || "unknown" : null,
      }));

      res.json({ logs: enrichedLogs, total: Number(countResult?.total || 0) });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/admin/companies/:id/export", isAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = req.params.id;
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const contactList = await storage.getContacts(companyId);
      const allProperties = await db.select().from(properties).where(eq(properties.companyId, companyId));
      const plans = await storage.getServicePlans(companyId, {});
      const invoiceList = await storage.getInvoices(companyId);
      const allVisits = await db.select().from(visits).where(eq(visits.companyId, companyId));
      const allMessages = await db.select().from(messages).where(eq(messages.companyId, companyId));
      const companyUsersList = await storage.getCompanyUsers(companyId);
      const allRoutes = await db.select().from(routes).where(eq(routes.companyId, companyId));

      const exportData = {
        exportedAt: new Date().toISOString(),
        company: { id: company.id, name: company.name, subscriptionTier: company.subscriptionTier, createdAt: company.createdAt },
        users: companyUsersList,
        contacts: contactList,
        properties: allProperties,
        servicePlans: plans,
        routes: allRoutes,
        visits: allVisits,
        invoices: invoiceList,
        messages: allMessages,
      };

      auditLog(companyId, null, "data_export", companyId, "create", { tables: Object.keys(exportData).filter(k => k !== "exportedAt"), actor: "platform_admin", adminEmail: (req as any).adminUser?.email }, req.ip || undefined);

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="tenant-export-${companyId}-${new Date().toISOString().slice(0,10)}.json"`);
      res.json(exportData);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/admin/rollup", isAdmin, async (_req: Request, res: Response) => {
    try {
      const { runNightlyRollup } = await import("./jobs/nightly-rollup");
      await runNightlyRollup();
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/admin/debug/run-reminders", isAdmin, async (_req: Request, res: Response) => {
    try {
      const { runReminders } = await import("./jobs/reminders");
      await runReminders();
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/admin/debug/run-auto-visits", isAdmin, async (_req: Request, res: Response) => {
    try {
      const { runAutoVisits } = await import("./jobs/auto-visits");
      const result = await runAutoVisits();
      res.json({ ok: true, ...result });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/admin/debug/run-auto-invoice", isAdmin, async (_req: Request, res: Response) => {
    try {
      const { runAutoInvoice } = await import("./jobs/auto-invoice");
      const result = await runAutoInvoice();
      res.json({ ok: true, ...result });
    } catch (err) { handleError(res, err); }
  });

  // ================ Admin Security & Subscription Routes ================

  async function logAdminAudit(req: Request, action: string, resourceType?: string, resourceId?: string, details?: any) {
    const adminUser = (req as any).adminUser;
    if (!adminUser) return;
    const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    await db.insert(adminAuditLogs).values({
      adminUserId: adminUser.userId,
      adminEmail: adminUser.email,
      action,
      resourceType: resourceType || null,
      resourceId: resourceId || null,
      details: details || null,
      ipAddress: ip,
    });
  }

  app.get("/api/admin/security/sessions", isAdmin, async (_req: Request, res: Response) => {
    try {
      const sessions = await db
        .select({
          id: adminSessions.id,
          adminUserId: adminSessions.adminUserId,
          adminEmail: adminUsers.email,
          createdAt: adminSessions.createdAt,
          expiresAt: adminSessions.expiresAt,
        })
        .from(adminSessions)
        .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
        .where(sql`${adminSessions.expiresAt} > NOW()`)
        .orderBy(sql`${adminSessions.createdAt} DESC`);
      res.json(sessions);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/admin/security/sessions/:sessionId", isAdmin, async (req: Request, res: Response) => {
    try {
      await db.delete(adminSessions).where(eq(adminSessions.id, req.params.sessionId));
      await logAdminAudit(req, "revoke_session", "admin_session", req.params.sessionId);
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/admin/security/audit-log", isAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const logs = await db
        .select()
        .from(adminAuditLogs)
        .orderBy(sql`${adminAuditLogs.createdAt} DESC`)
        .limit(limit)
        .offset(offset);
      const [{ count: total }] = await db.select({ count: sql<number>`count(*)` }).from(adminAuditLogs);
      res.json({ logs, total: Number(total) });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/admin/security/admin-users", isAdmin, async (_req: Request, res: Response) => {
    try {
      const usrs = await db
        .select({
          id: adminUsers.id,
          email: adminUsers.email,
          passwordChangedAt: adminUsers.passwordChangedAt,
          createdAt: adminUsers.createdAt,
        })
        .from(adminUsers);
      const enriched = usrs.map(u => {
        const daysSinceChange = (Date.now() - new Date(u.passwordChangedAt).getTime()) / (1000 * 60 * 60 * 24);
        return { ...u, passwordExpired: daysSinceChange >= 90, daysSincePasswordChange: Math.floor(daysSinceChange) };
      });
      res.json(enriched);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/admin/subscription-tiers", isAdmin, async (_req: Request, res: Response) => {
    try {
      const tiers = await db.select().from(subscriptionTiers).orderBy(sql`${subscriptionTiers.price} ASC`);
      if (tiers.length === 0) {
        const defaults = Object.entries(TIER_CONFIG).map(([key, cfg]) => ({
          tierKey: key,
          name: cfg.name,
          maxUsers: cfg.maxUsers,
          price: cfg.price.toFixed(2),
          isActive: cfg.visible,
        }));
        for (const d of defaults) {
          await db.insert(subscriptionTiers).values(d).onConflictDoNothing();
        }
        const seeded = await db.select().from(subscriptionTiers).orderBy(sql`${subscriptionTiers.price} ASC`);
        return res.json(seeded);
      }
      res.json(tiers);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/admin/subscription-tiers/:id", isAdmin, async (req: Request, res: Response) => {
    try {
      const { name, maxUsers, price, isActive } = req.body;
      const updates: any = { updatedAt: new Date() };
      if (name !== undefined) updates.name = name;
      if (maxUsers !== undefined) updates.maxUsers = parseInt(maxUsers);
      if (price !== undefined) updates.price = parseFloat(price).toFixed(2);
      if (isActive !== undefined) updates.isActive = isActive;
      const [updated] = await db.update(subscriptionTiers).set(updates).where(eq(subscriptionTiers.id, req.params.id)).returning();
      if (!updated) return res.status(404).json({ error: "Tier not found" });
      await logAdminAudit(req, "update_subscription_tier", "subscription_tier", updated.tierKey, { name: updated.name, price: updated.price, maxUsers: updated.maxUsers });
      res.json(updated);
    } catch (err) { handleError(res, err); }
  });

  // ================ Import / Migration Routes ================
  const { parseSweepAndGoInvoices } = await import("./services/sweepandgo-parser");
  const { aiMapColumns, getDeterministicMapping, hashFileContent, CONTACT_FIELDS, INVOICE_FIELDS, ROUTE_FIELDS } = await import("./services/ai-mapper");
  const { applyTransformations, parseCSV: parseCSVUtil } = await import("./services/import-transforms");
  const { parseCompetitorCSV } = await import("./services/competitor-import");

  const VALID_PLATFORMS = ["sweepandgo", "jobber"] as const;

  app.post("/api/migrations/competitor/detect", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { csvText, platform } = req.body;
      if (!csvText || typeof csvText !== "string") return res.status(400).json({ error: "csvText is required" });
      if (platform && !VALID_PLATFORMS.includes(platform)) return res.status(400).json({ error: "Invalid platform" });
      const result = parseCompetitorCSV(csvText, platform || undefined);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/migrations/competitor/import", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { csvText, platform, duplicateHandling } = req.body;
      if (!csvText || typeof csvText !== "string") return res.status(400).json({ error: "csvText is required" });
      if (platform && !VALID_PLATFORMS.includes(platform)) return res.status(400).json({ error: "Invalid platform" });
      if (duplicateHandling && !["skip", "update"].includes(duplicateHandling)) return res.status(400).json({ error: "Invalid duplicateHandling value" });

      const result = parseCompetitorCSV(csvText, platform || undefined, 0);
      if (result.errors.some(e => e.row === 0)) {
        return res.status(400).json({ error: result.errors[0].message });
      }

      const fileHash = hashFileContent(csvText);
      const importRun = await storage.createImportRun({
        companyId,
        type: `${result.platform}_contacts`,
        status: "processing",
        fileName: `${result.platform}-contacts.csv`,
        fileHash,
        totalRows: result.totalRows,
        importedRows: 0,
        skippedRows: 0,
      });

      const allContacts = result.preview;
      const existingContacts = await storage.getContacts(companyId, {});
      const emailSet = new Set(existingContacts.map(c => c.email?.toLowerCase()).filter(Boolean));
      const addressSet = new Set(
        existingContacts.map(c => {
          if (c.streetAddress && c.city && c.state) {
            return `${c.streetAddress}|${c.city}|${c.state}|${c.zipCode}`.toLowerCase();
          }
          return null;
        }).filter(Boolean)
      );

      let imported = 0;
      let skipped = 0;
      let updated = 0;
      const importErrors: Array<{ row: number; message: string }> = [];

      const leadSourceName = result.platformLabel;
      let leadSourceRecord = (await storage.getLeadSources(companyId)).find(
        ls => ls.name.toLowerCase() === leadSourceName.toLowerCase()
      ) || null;
      if (!leadSourceRecord) {
        leadSourceRecord = await storage.createLeadSource({ companyId, name: leadSourceName });
      }

      for (let i = 0; i < allContacts.length; i++) {
        try {
          const pc = allContacts[i];
          const email = pc.email;
          const addressKey = pc.streetAddress && pc.city && pc.state
            ? `${pc.streetAddress}|${pc.city}|${pc.state}|${pc.zipCode}`.toLowerCase()
            : null;

          const isDuplicateEmail = email && emailSet.has(email);
          const isDuplicateAddress = addressKey && addressSet.has(addressKey);

          if (isDuplicateEmail || isDuplicateAddress) {
            if (duplicateHandling === "skip") {
              skipped++;
              continue;
            }
            if (duplicateHandling === "update") {
              let existing = isDuplicateEmail
                ? existingContacts.find(c => c.email?.toLowerCase() === email)
                : null;
              if (!existing && isDuplicateAddress) {
                existing = existingContacts.find(c => {
                  if (!c.streetAddress || !c.city || !c.state) return false;
                  return `${c.streetAddress}|${c.city}|${c.state}|${c.zipCode}`.toLowerCase() === addressKey;
                });
              }
              if (existing) {
                const updates: any = {};
                if (pc.phone && !existing.phone) updates.phone = pc.phone;
                if (pc.email && !existing.email) updates.email = pc.email;
                if (pc.streetAddress && !existing.streetAddress) updates.streetAddress = pc.streetAddress;
                if (pc.city && !existing.city) updates.city = pc.city;
                if (pc.state && !existing.state) updates.state = pc.state;
                if (pc.zipCode && !existing.zipCode) updates.zipCode = pc.zipCode;
                if (pc.numberOfDogs && !existing.numberOfDogs) updates.numberOfDogs = pc.numberOfDogs;
                if (pc.notes && !existing.notes) updates.notes = pc.notes;
                if (pc.serviceFrequency && !existing.serviceFrequency) updates.serviceFrequency = pc.serviceFrequency;
                if (pc.serviceDay && !existing.serviceDay) updates.serviceDay = pc.serviceDay;
                if (Object.keys(updates).length > 0) {
                  await storage.updateContact(existing.id, companyId, updates);
                }
                updated++;
                continue;
              }
            }
            skipped++;
            continue;
          }

          const contactLeadSource = pc.leadSource || leadSourceName;

          const contact = await storage.createContact({
            companyId,
            firstName: pc.firstName,
            lastName: pc.lastName || "",
            email: pc.email || undefined,
            phone: pc.phone || undefined,
            streetAddress: pc.streetAddress || undefined,
            address2: pc.address2 || undefined,
            city: pc.city || undefined,
            state: pc.state || undefined,
            zipCode: pc.zipCode || undefined,
            numberOfDogs: pc.numberOfDogs,
            yardSize: pc.yardSize || undefined,
            serviceFrequency: pc.serviceFrequency || undefined,
            serviceDay: (pc.serviceDay as any) || undefined,
            notes: pc.notes || undefined,
            leadSource: contactLeadSource || undefined,
            status: (pc.status as any) || "lead",
          });

          if (email) emailSet.add(email);
          if (addressKey) addressSet.add(addressKey);

          if (pc.streetAddress && pc.city && pc.state && pc.zipCode) {
            try {
              await createPropertyWithGeocode({
                companyId,
                contactId: contact.id,
                streetAddress: pc.streetAddress,
                city: pc.city,
                state: pc.state,
                zipCode: pc.zipCode,
                numberOfDogs: pc.numberOfDogs ?? 1,
                yardSize: pc.yardSize || null,
                gateCode: pc.gateCode || null,
              });
            } catch (propErr: any) {
              importErrors.push({ row: i + 2, message: `Contact created but property failed: ${propErr.message}` });
            }
          }

          imported++;
        } catch (rowErr: any) {
          skipped++;
          importErrors.push({ row: i + 2, message: rowErr.message });
        }
      }

      await storage.updateImportRun(importRun.id, {
        status: "completed",
        importedRows: imported,
        skippedRows: skipped,
        errors: importErrors.length > 0 ? importErrors : undefined,
        completedAt: new Date(),
      });

      res.json({
        importRunId: importRun.id,
        platform: result.platform,
        platformLabel: result.platformLabel,
        imported,
        updated,
        skipped,
        total: allContacts.length,
        errors: importErrors,
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/migrations/sweepandgo/parse-invoices", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { csvText } = req.body;
      if (!csvText || typeof csvText !== "string") return res.status(400).json({ error: "csvText is required" });

      const result = parseSweepAndGoInvoices(csvText);

      const sampleInvoices = result.invoices.slice(0, 10).map(inv => ({
        invoiceNumber: inv.invoiceNumber,
        contactName: inv.contactName,
        contactEmail: inv.contactEmail,
        status: inv.status,
        total: inv.total,
        lineItemCount: inv.lineItems.length,
        paymentCount: inv.payments.length,
      }));

      res.json({
        summary: result.summary,
        sampleInvoices,
        errors: result.errors,
        warnings: result.warnings,
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/migrations/sweepandgo/run-invoices", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { csvText, allowDuplicates, includeInReminders } = req.body;
      if (!csvText) return res.status(400).json({ error: "csvText is required" });

      const fileHash = hashFileContent(csvText);
      const importRun = await storage.createImportRun({
        companyId,
        type: "sweepandgo_invoices",
        status: "processing",
        fileName: "sweepandgo-invoices.csv",
        fileHash,
        totalRows: 0,
        importedRows: 0,
        skippedRows: 0,
      });

      const parseResult = parseSweepAndGoInvoices(csvText);

      if (parseResult.errors.length > 0 && !req.body.forceImport) {
        await storage.updateImportRun(importRun.id, {
          status: "failed",
          errors: parseResult.errors,
          totalRows: parseResult.invoices.length,
          completedAt: new Date(),
        });
        return res.status(400).json({
          importRunId: importRun.id,
          errors: parseResult.errors,
          message: "Validation errors found. Send forceImport: true to skip invalid rows.",
        });
      }

      let imported = 0;
      let skipped = 0;
      const importErrors: any[] = [];

      const allContacts = await storage.getContacts(companyId);

      for (const inv of parseResult.invoices) {
        try {
          const existing = await storage.getInvoiceByExternalId(companyId, "sweepandgo", inv.externalId);
          if (existing) {
            if (!allowDuplicates) {
              skipped++;
              continue;
            }
          }

          let contactId: string | null = null;
          if (inv.contactEmail) {
            const match = allContacts.find(c => c.email?.toLowerCase() === inv.contactEmail?.toLowerCase());
            if (match) contactId = match.id;
          }
          if (!contactId && inv.contactName) {
            const nameParts = inv.contactName.split(/\s+/);
            if (nameParts.length >= 2) {
              const match = allContacts.find(c =>
                c.firstName.toLowerCase() === nameParts[0].toLowerCase() &&
                c.lastName.toLowerCase() === nameParts.slice(1).join(" ").toLowerCase()
              );
              if (match) contactId = match.id;
            }
          }

          if (!contactId) {
            importErrors.push({ invoiceNumber: inv.invoiceNumber, message: "Could not match to existing contact" });
            skipped++;
            continue;
          }

          let invoiceNum = inv.invoiceNumber;
          if (existing && allowDuplicates) {
            invoiceNum = `${inv.invoiceNumber}-imp-${Date.now()}`;
          }

          const invoice = await storage.createInvoice({
            companyId,
            contactId,
            invoiceNumber: invoiceNum,
            dueDate: inv.dueDate,
            subtotal: String(inv.subtotal),
            taxRate: String(inv.taxRate),
            tax: String(inv.tax),
            discountAmount: String(inv.discountAmount),
            total: String(inv.total),
            status: inv.status as any,
            source: "imported",
            externalSource: "sweepandgo",
            externalId: inv.externalId,
            importRunId: importRun.id,
            issuedDate: inv.issuedDate || null,
            notes: inv.notes || null,
            excludeFromReminders: !includeInReminders,
            paidAt: inv.status === "paid" && inv.payments.length > 0 ? new Date(inv.payments[0].paidAt) : null,
          });

          for (const li of inv.lineItems) {
            await storage.createInvoiceLineItem({
              invoiceId: invoice.id,
              description: li.description,
              quantity: li.quantity,
              unitPrice: String(li.unitPrice),
              total: String(li.total),
            });
          }

          for (let pIdx = 0; pIdx < inv.payments.length; pIdx++) {
            const payment = inv.payments[pIdx];
            const paymentExtId = `sweepandgo-payment-${inv.externalId}-${pIdx}`;
            const existing = await storage.getInvoicePaymentByExternalId(companyId, paymentExtId);
            if (existing) continue;
            await storage.createInvoicePayment({
              companyId,
              invoiceId: invoice.id,
              amountCents: payment.amountCents,
              paidAt: new Date(payment.paidAt),
              method: "imported" as any,
              reference: payment.reference || null,
              source: "imported" as any,
              externalId: paymentExtId,
              importRunId: importRun.id,
            });
          }

          imported++;
        } catch (invErr: any) {
          importErrors.push({ invoiceNumber: inv.invoiceNumber, message: invErr.message });
          skipped++;
        }
      }

      await storage.updateImportRun(importRun.id, {
        status: "completed",
        totalRows: parseResult.invoices.length,
        importedRows: imported,
        skippedRows: skipped,
        errors: importErrors.length > 0 ? importErrors : null,
        completedAt: new Date(),
      });

      res.json({
        importRunId: importRun.id,
        imported,
        skipped,
        total: parseResult.invoices.length,
        errors: importErrors,
        summary: parseResult.summary,
      });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/migrations/:id/invoices-report", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const importRun = await storage.getImportRun(req.params.id, companyId);
      if (!importRun) return res.status(404).json({ error: "Import run not found" });
      res.json(importRun);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/invoices/:id/payments", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const invoice = await storage.getInvoice(req.params.id, companyId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      const payments = await storage.getInvoicePayments(req.params.id);
      res.json(payments);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/imports/ai-map", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { headers, sampleRows, targetSchema } = req.body;

      if (!headers || !Array.isArray(headers)) return res.status(400).json({ error: "headers array is required" });
      if (!sampleRows || !Array.isArray(sampleRows)) return res.status(400).json({ error: "sampleRows array is required" });

      const company = await storage.getCompany(companyId);
      const targetFields = targetSchema === "invoices" ? INVOICE_FIELDS
        : targetSchema === "routes" ? ROUTE_FIELDS
        : CONTACT_FIELDS;

      if (company?.aiImportMappingEnabled) {
        const result = await aiMapColumns(headers, sampleRows.slice(0, 25), targetSchema || "contacts", targetFields);
        res.json(result);
      } else {
        const result = getDeterministicMapping(headers, targetFields);
        res.json(result);
      }
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/imports/preview", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { targetSchema } = req.body;
      let headers: string[];
      let rows: string[][];
      let mappings: any[];
      let transformations: any[];

      if (req.body.csvText) {
        const parsed = parseCSVUtil(req.body.csvText);
        headers = parsed.headers;
        rows = parsed.rows;
        mappings = req.body.mappingConfig?.mappings || [];
        transformations = req.body.mappingConfig?.transformations || [];
      } else if (req.body.headers && req.body.rows) {
        headers = req.body.headers;
        rows = req.body.rows;
        mappings = req.body.mappings || req.body.mappingConfig?.mappings || [];
        transformations = req.body.transformations || req.body.mappingConfig?.transformations || [];
      } else {
        return res.status(400).json({ error: "Either csvText or headers+rows are required" });
      }

      const requiredFields = targetSchema === "invoices"
        ? ["invoiceNumber"]
        : targetSchema === "routes"
        ? ["routeName"]
        : ["firstName"];

      const transformed = applyTransformations(rows, headers, mappings, transformations, requiredFields);

      const preview = transformed.slice(0, 50);
      const validCount = transformed.filter(r => r.isValid).length;
      const invalidCount = transformed.filter(r => !r.isValid).length;
      const allErrors = transformed.flatMap(r => r.errors);

      res.json({
        totalRows: rows.length,
        validCount,
        invalidCount,
        rows: preview,
        preview,
        errors: allErrors.slice(0, 100),
        headers,
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/imports/apply", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { targetSchema } = req.body;
      let headers: string[];
      let rows: string[][];
      let mappings: any[];
      let transformations: any[];
      let fileHash: string;

      if (req.body.csvText) {
        const parsed = parseCSVUtil(req.body.csvText);
        headers = parsed.headers;
        rows = parsed.rows;
        mappings = req.body.mappingConfig?.mappings || [];
        transformations = req.body.mappingConfig?.transformations || [];
        fileHash = hashFileContent(req.body.csvText);
      } else if (req.body.headers && req.body.rows) {
        headers = req.body.headers;
        rows = req.body.rows;
        mappings = req.body.mappings || req.body.mappingConfig?.mappings || [];
        transformations = req.body.transformations || req.body.mappingConfig?.transformations || [];
        fileHash = hashFileContent(JSON.stringify({ headers, rows }));
      } else {
        return res.status(400).json({ error: "Either csvText or headers+rows are required" });
      }

      const importType = targetSchema === "invoices" ? "sweepandgo_invoices"
        : targetSchema === "routes" ? "csv_routes"
        : "csv_contacts";

      const mappingConfig = { mappings, transformations };
      const importRun = await storage.createImportRun({
        companyId,
        type: importType as any,
        status: "processing",
        fileName: req.body.fileName || "import.csv",
        fileHash,
        totalRows: rows.length,
        mappingConfig,
        aiSuggestions: req.body.aiSuggestions || null,
        userOverrides: req.body.userOverrides || null,
      });

      const skipSet = new Set(req.body.skipRowIndices || req.body.skippedRows || []);
      const editedCells = req.body.editedCells || {};
      for (const [key, value] of Object.entries(editedCells)) {
        const [rowIdx, colIdx] = key.split("-").map(Number);
        if (rows[rowIdx] && colIdx < (rows[rowIdx]?.length ?? 0)) {
          rows[rowIdx][colIdx] = String(value);
        }
      }
      const requiredFields = targetSchema === "invoices" ? ["invoiceNumber"]
        : targetSchema === "routes" ? ["routeName"]
        : ["firstName"];

      const transformed = applyTransformations(rows, headers, mappings, transformations, requiredFields);

      let imported = 0;
      let skipped = 0;
      const importErrors: any[] = [];

      for (const row of transformed) {
        if (skipSet.has(row.rowIndex)) { skipped++; continue; }
        if (!row.isValid) { skipped++; importErrors.push(...row.errors); continue; }

        try {
          if (targetSchema === "contacts" || !targetSchema) {
            const contactData: any = {
              companyId,
              firstName: row.transformed.firstName || "Unknown",
              lastName: row.transformed.lastName || "",
              email: row.transformed.email || null,
              phone: row.transformed.phone || null,
              streetAddress: row.transformed.streetAddress || null,
              address2: row.transformed.address2 || null,
              city: row.transformed.city || null,
              state: row.transformed.state || null,
              zipCode: row.transformed.zipCode || null,
              numberOfDogs: row.transformed.numberOfDogs ? parseInt(row.transformed.numberOfDogs) : null,
              yardSize: row.transformed.yardSize || null,
              serviceFrequency: row.transformed.serviceFrequency || null,
              leadSource: row.transformed.leadSource || null,
              status: row.transformed.status || "lead",
              notes: row.transformed.notes || null,
            };
            await storage.createContact(contactData);
            imported++;
          }
        } catch (err: any) {
          importErrors.push({ row: row.rowIndex, message: err.message });
          skipped++;
        }
      }

      await storage.updateImportRun(importRun.id, {
        status: "completed",
        importedRows: imported,
        skippedRows: skipped,
        errors: importErrors.length > 0 ? importErrors : null,
        completedAt: new Date(),
      });

      res.json({
        importRunId: importRun.id,
        imported,
        skipped,
        total: rows.length,
        errors: importErrors,
      });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/imports", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const runs = await storage.getImportRuns(companyId);
      res.json(runs);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/imports/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const run = await storage.getImportRun(req.params.id, companyId);
      if (!run) return res.status(404).json({ error: "Import run not found" });
      res.json(run);
    } catch (err) { handleError(res, err); }
  });

  // ================ Rover Chatbot Routes ================
  const roverRateLimiter = (await import("express-rate-limit")).default({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, default: true },
    keyGenerator: (req: Request) => {
      const apiKeyAuth = (req as any)._apiKeyAuth as { userId: string } | undefined;
      if (apiKeyAuth?.userId) return `api:${apiKeyAuth.userId}`;
      const sessionUserId = (req.session as any)?.userId;
      if (sessionUserId) return `session:${sessionUserId}`;
      return "unauthenticated";
    },
    message: { error: "Too many requests. Please wait a moment before trying again." },
  });

  app.get("/api/rover/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const aiKeyAvailable = !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
      const [company] = await db.select({ roverAiEnabled: companies.roverAiEnabled }).from(companies).where(eq(companies.id, companyId));
      res.json({
        aiAvailable: aiKeyAvailable && (company?.roverAiEnabled ?? false),
        aiEnabled: company?.roverAiEnabled ?? false,
        aiKeyConfigured: aiKeyAvailable,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/rover/chat", isAuthenticated, roverRateLimiter as any, async (req: Request, res: Response) => {
    try {
      const { userId, companyId } = await getCompanyContext(req);
      const { messages: chatMessages } = req.body;

      if (!Array.isArray(chatMessages) || chatMessages.length === 0) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      const lastMsg = chatMessages[chatMessages.length - 1];
      if (!lastMsg || lastMsg.role !== "user" || typeof lastMsg.content !== "string" || lastMsg.content.trim().length < 1) {
        return res.status(400).json({ error: "Last message must be a non-empty user message" });
      }

      const aiKeyAvailable = !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
      const [company] = await db.select({ roverAiEnabled: companies.roverAiEnabled }).from(companies).where(eq(companies.id, companyId));

      if (!company?.roverAiEnabled || !aiKeyAvailable) {
        return res.status(400).json({ error: "AI chat is disabled", fallback: true });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const sanitizedMessages = chatMessages.slice(-20).map((m: any) => ({
        role: m.role === "user" ? "user" as const : "assistant" as const,
        content: String(m.content).slice(0, 2000),
      }));

      const { streamRoverChat } = await import("./services/rover-ai");

      const abortSignal = { aborted: false };
      req.on("close", () => { abortSignal.aborted = true; });

      await streamRoverChat(
        sanitizedMessages,
        companyId,
        userId,
        (text: string) => {
          if (!abortSignal.aborted) {
            res.write(`data: ${JSON.stringify({ type: "chunk", content: text })}\n\n`);
          }
        },
        (fullText: string) => {
          if (!abortSignal.aborted) {
            res.write(`data: ${JSON.stringify({ type: "done", content: fullText })}\n\n`);
            res.end();
          }
        },
        (error: string) => {
          if (!abortSignal.aborted) {
            res.write(`data: ${JSON.stringify({ type: "error", content: error })}\n\n`);
            res.end();
          }
        },
        abortSignal
      );
    } catch (err) {
      if (!res.headersSent) {
        handleError(res, err);
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", content: "An error occurred" })}\n\n`);
        res.end();
      }
    }
  });

  const ROVER_KNOWLEDGE_BASE: { keywords: string[]; answer: string }[] = [
    { keywords: ["dashboard", "overview", "home", "main"], answer: "The Dashboard is your home screen showing key metrics like active clients, scheduled visits, revenue, and recent activity. It gives you a quick snapshot of your business operations." },
    { keywords: ["contact", "client", "crm", "lead", "customer"], answer: "The Contacts section is your CRM hub. You can add and manage clients, track their status (lead, estimate, active, paused, cancelled), assign properties, add tags, and manage their scheduled services. Use the search bar to find contacts quickly." },
    { keywords: ["property", "address", "yard", "dog", "location"], answer: "Properties are service locations tied to contacts. Each property can have details like address, gate code, yard size, number of dogs, and special instructions. Properties are geocoded automatically for route optimization." },
    { keywords: ["route", "routing", "optimize", "optimization", "dispatch"], answer: "Routes let you organize daily service stops. Use the Route Builder to drag-and-drop visits, optimize the order using our route optimization algorithm, and dispatch routes to technicians. You can optimize routes using credits from your account." },
    { keywords: ["schedule", "service plan", "recurring", "visit", "appointment", "job"], answer: "Jobs set up recurring or one-off schedules for your clients (weekly, biweekly, monthly, or one-time). Each job auto-generates visits that appear on routes and auto-assigns to the least-loaded route for their day." },
    { keywords: ["invoice", "billing", "payment", "charge", "stripe"], answer: "The Invoicing section lets you create and manage invoices with line items, tax, and discounts. Invoices can be sent to clients and paid via Stripe. You can also void invoices and track payment status." },
    { keywords: ["technician", "tech", "field", "mobile", "crew"], answer: "Technicians use a simplified mobile view showing only their assigned routes and client info. They can mark visits as complete, add notes, and upload proof-of-service photos. Invite technicians from the Settings page." },
    { keywords: ["portal", "client portal", "self-service"], answer: "The Client Portal gives your customers a self-service view where they can see their schedule, past visits, invoices, pause/resume service, and send messages to you. Enable portal access from a contact's detail page." },
    { keywords: ["email", "sms", "text", "message", "communicate"], answer: "Communication tools let you send emails and SMS messages to clients. All communications are logged in the Messages tab. You can set up automation rules to send messages automatically on events like new leads or completed services." },
    { keywords: ["automation", "rule", "trigger", "automatic"], answer: "Automation Rules let you automate actions based on events. For example, auto-send a welcome email when a new lead is created, or create a task when a service is completed. Set these up from the Automation section." },
    { keywords: ["settings", "account", "profile", "company"], answer: "Settings lets you manage your company profile, team members, service pricing, notification preferences, API keys, and integrations. You can also change your password and manage your subscription here." },
    { keywords: ["import", "csv", "upload", "bulk"], answer: "You can bulk-import contacts using CSV files. Go to Contacts, click Import, upload your CSV, map the columns, review the data, and import. Unknown lead sources from CSV files are automatically added." },
    { keywords: ["tag", "label", "categorize", "group"], answer: "Tags help you organize and categorize contacts. Create custom tags with colors, then assign them to contacts for easy filtering and grouping." },
    { keywords: ["notification", "alert", "bell"], answer: "The notification bell in the top bar shows real-time alerts for events like new leads, completed visits, overdue invoices, and portal messages. Click a notification to navigate to the relevant item." },
    { keywords: ["api", "webhook", "integration", "key"], answer: "ScooPilot has a REST API with scoped API keys for external integrations. You can also set up webhooks to receive real-time notifications when events occur in your account. Manage these from Settings > API & Webhooks." },
    { keywords: ["password", "login", "forgot", "reset", "change password"], answer: "To change your password, go to Settings and use the Change Password card. If you forgot your password, use the Forgot Password link on the login page to receive a reset email." },
    { keywords: ["subscription", "plan", "tier", "pricing", "upgrade"], answer: "Your subscription tier determines your user limit and features. Plans range from Free Trial to Enterprise. Contact your admin or check Settings to manage your subscription." },
    { keywords: ["map", "geocode", "mapbox", "directions"], answer: "ScooPilot uses maps for route visualization and optimization. Properties are automatically geocoded when created. The route optimizer uses real road distances to find the most efficient service order." },
    { keywords: ["proof", "photo", "picture", "evidence"], answer: "Technicians can upload proof-of-service photos when completing visits. These photos are attached to the visit record and visible in the visit history for the client's property." },
  ];

  function findAnswer(question: string): string | null {
    const q = question.toLowerCase();
    let bestMatch: { answer: string; score: number } | null = null;
    for (const entry of ROVER_KNOWLEDGE_BASE) {
      const score = entry.keywords.filter(kw => q.includes(kw)).length;
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { answer: entry.answer, score };
      }
    }
    return bestMatch?.answer || null;
  }

  app.post("/api/rover/ask", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { question } = req.body;
      if (!question || typeof question !== "string" || question.trim().length < 2) {
        return res.status(400).json({ error: "Please ask a question" });
      }

      const answer = findAnswer(question.trim());
      if (answer) {
        return res.json({ answer, matched: true });
      }

      res.json({
        answer: "I'm not sure about that one. Would you like to submit a trouble ticket or feature request? I'll make sure the team sees it.",
        matched: false,
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/rover/ticket", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { userId, companyId } = await getCompanyContext(req);
      const { type, subject, description } = req.body;
      if (!type || !["bug", "feature_request", "question"].includes(type)) {
        return res.status(400).json({ error: "Type must be bug, feature_request, or question" });
      }
      if (!subject || typeof subject !== "string" || subject.trim().length < 3) {
        return res.status(400).json({ error: "Subject must be at least 3 characters" });
      }
      if (!description || typeof description !== "string" || description.trim().length < 10) {
        return res.status(400).json({ error: "Description must be at least 10 characters" });
      }

      const { roverTickets } = await import("@shared/schema");
      const [ticket] = await db.insert(roverTickets).values({
        companyId,
        userId,
        type,
        subject: subject.trim(),
        description: description.trim(),
      }).returning();

      const typeLabel = type === "bug" ? "Trouble Ticket" : type === "feature_request" ? "Feature Request" : "Question";
      notify(companyId, "general", `New ${typeLabel}`, `${typeLabel}: ${subject.trim()}`, undefined);

      res.json({ ok: true, ticket });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/rover/tickets", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { roverTickets } = await import("@shared/schema");
      const tickets = await db.select().from(roverTickets)
        .where(eq(roverTickets.companyId, companyId))
        .orderBy(sql`${roverTickets.createdAt} DESC`)
        .limit(50);
      res.json(tickets);
    } catch (err) { handleError(res, err); }
  });

  // ================ Public Signup Routes (no auth required) ================
  const signupLimiter = (await import("express-rate-limit")).default({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === "production" ? 5 : 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many signup attempts, please try again later" },
  });

  app.post("/api/public/signup", signupLimiter, async (req: Request, res: Response) => {
    try {
      const { email, firstName, lastName, companyName } = req.body;
      if (!email || !firstName || !companyName) {
        return res.status(400).json({ error: "Email, first name, and company name are required" });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Invalid email address" });
      }
      if (typeof companyName !== "string" || companyName.trim().length < 2) {
        return res.status(400).json({ error: "Company name must be at least 2 characters" });
      }

      const existingUser = await getUserByEmail(email.toLowerCase());
      if (existingUser) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }

      const { emailVerificationTokens } = await import("@shared/models/auth");
      const { eq, and, gt } = await import("drizzle-orm");
      const pending = await db.select().from(emailVerificationTokens).where(
        and(
          eq(emailVerificationTokens.email, email.toLowerCase()),
          eq(emailVerificationTokens.used, false),
          gt(emailVerificationTokens.expiresAt, new Date())
        )
      );
      if (pending.length > 0) {
        return res.json({ success: true, message: "A verification email was already sent. Please check your inbox." });
      }

      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await db.insert(emailVerificationTokens).values({
        email: email.toLowerCase(),
        firstName: firstName.trim(),
        lastName: lastName?.trim() || null,
        companyName: companyName.trim(),
        tokenHash,
        expiresAt,
      });

      const host = req.headers.host || "localhost:5000";
      const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");
      const verifyUrl = `${isLocalhost ? "http" : "https"}://${host}/api/public/verify-email?token=${token}`;

      try {
        await sendEmail({
          to: email,
          subject: "Verify your email to start your ScooPilot free trial",
          text: `Hi ${firstName},\n\nThanks for signing up for ScooPilot! Please verify your email to activate your free trial:\n\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't sign up for ScooPilot, you can safely ignore this email.`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">ScooPilot</h1>
              </div>
              <div style="padding: 20px; border: 1px solid #e5e7eb;">
                <h2 style="margin-top: 0;">Verify Your Email</h2>
                <p>Hi ${firstName},</p>
                <p>Thanks for signing up for ScooPilot! Click the button below to verify your email and activate your free trial.</p>
                <div style="text-align: center; margin: 24px 0;">
                  <a href="${verifyUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Verify Email</a>
                </div>
                <p style="color: #6b7280; font-size: 14px;">This link expires in 24 hours. If you didn't sign up for ScooPilot, you can safely ignore this email.</p>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error("[Signup] Failed to send verification email:", emailErr);
        return res.status(500).json({ error: "Failed to send verification email. Please try again." });
      }

      res.json({ success: true, message: "Verification email sent. Please check your inbox." });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/public/verify-email", async (req: Request, res: Response) => {
    try {
      const { token } = req.query;
      if (!token || typeof token !== "string") {
        return res.send(verificationResultPage(false, "Missing verification token."));
      }

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const { emailVerificationTokens } = await import("@shared/models/auth");
      const { eq, and, gt } = await import("drizzle-orm");

      const [record] = await db.select().from(emailVerificationTokens).where(
        and(
          eq(emailVerificationTokens.tokenHash, tokenHash),
          eq(emailVerificationTokens.used, false),
          gt(emailVerificationTokens.expiresAt, new Date())
        )
      );

      if (!record) {
        return res.send(verificationResultPage(false, "This verification link is invalid or has expired. Please sign up again."));
      }

      const existingUser = await getUserByEmail(record.email);
      if (existingUser) {
        await db.update(emailVerificationTokens)
          .set({ used: true })
          .where(eq(emailVerificationTokens.id, record.id));
        return res.send(verificationResultPage(false, "An account with this email already exists. Please log in instead."));
      }

      const tempPassword = crypto.randomBytes(6).toString("base64url");

      const { user, company } = await db.transaction(async (tx) => {
        const txUser = await createUserWithTempPassword(record.email, record.firstName, record.lastName || "", tempPassword);

        const baseSlug = (record.companyName || "company").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "company";
        let slug = baseSlug;
        let slugSuffix = 1;
        while (true) {
          const existing = await storage.getCompanyBySlug(slug);
          if (!existing) break;
          slug = `${baseSlug}-${slugSuffix++}`;
        }

        const [txCompany] = await tx.insert((await import("@shared/schema")).companies).values({
          name: record.companyName,
          email: record.email,
          slug,
          subscriptionTier: "free_trial",
          subscriptionStatus: "trialing",
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        }).returning();

        await tx.insert((await import("@shared/schema")).companyUsers).values({
          userId: txUser.id,
          companyId: txCompany.id,
          role: "owner",
        });

        await tx.update(emailVerificationTokens)
          .set({ used: true })
          .where(eq(emailVerificationTokens.id, record.id));

        return { user: txUser, company: txCompany };
      });

      await seedDefaultLeadSources(company.id);
      await storage.seedDefaultPricing(company.id);

      const host = req.headers.host || "localhost:5000";
      const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");
      const appUrl = `${isLocalhost ? "http" : "https"}://${host}`;

      try {
        await sendEmail({
          companyId: company.id,
          to: record.email,
          subject: "Welcome to ScooPilot - Your login credentials",
          text: `Hi ${record.firstName},\n\nYour ScooPilot free trial is active!\n\nCompany: ${record.companyName}\nLogin: ${appUrl}\nEmail: ${record.email}\nTemporary Password: ${tempPassword}\n\nYou'll be asked to set a new password on your first login.`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">ScooPilot</h1>
              </div>
              <div style="padding: 20px; border: 1px solid #e5e7eb;">
                <h2 style="margin-top: 0;">Your Free Trial is Active!</h2>
                <p>Hi ${record.firstName},</p>
                <p>Your ScooPilot account <strong>"${record.companyName}"</strong> is ready to go.</p>
                <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
                  <p style="margin: 4px 0;"><strong>Email:</strong> ${record.email}</p>
                  <p style="margin: 4px 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
                </div>
                <div style="text-align: center; margin: 24px 0;">
                  <a href="${appUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log In Now</a>
                </div>
                <p style="color: #6b7280; font-size: 14px;">You'll be asked to set a new password when you first log in.</p>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error("[Signup] Failed to send welcome email:", emailErr);
      }

      sendAdminSignupNotification({
        companyName: record.companyName,
        ownerEmail: record.email,
        ownerName: [record.firstName, record.lastName].filter(Boolean).join(" "),
        tier: "free_trial",
        source: "Public Signup",
      }).catch((err) => console.error("[Signup Notification] Failed during public signup:", err));

      res.send(verificationResultPage(true, null, appUrl));
    } catch (err) {
      console.error("[Signup] Verification error:", err);
      res.send(verificationResultPage(false, "Something went wrong. Please try again or contact support."));
    }
  });

  function verificationResultPage(success: boolean, errorMessage?: string | null, loginUrl?: string): string {
    const title = success ? "Email Verified!" : "Verification Failed";
    const body = success
      ? `<h2 style="color: #2d8a5e; margin-top: 0;">Your account has been created!</h2>
         <p>Your free trial is now active. We've sent your login credentials to your email.</p>
         <div style="text-align: center; margin: 24px 0;">
           <a href="${loginUrl || "/"}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Go to Login</a>
         </div>
         <p style="color: #6b7280; font-size: 14px;">Check your email for your temporary password. You'll set a new one on first login.</p>`
      : `<h2 style="color: #dc2626; margin-top: 0;">Verification Failed</h2>
         <p>${errorMessage || "This link is invalid or has expired."}</p>
         <p style="color: #6b7280; font-size: 14px; margin-top: 16px;">Please try signing up again or contact support if you need help.</p>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - ScooPilot</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f9fafb; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.07); max-width: 480px; width: 90%; overflow: hidden; }
    .header { background-color: #2d8a5e; padding: 20px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 24px; }
    .content { padding: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header"><h1>ScooPilot</h1></div>
    <div class="content">${body}</div>
  </div>
</body>
</html>`;
  }

  app.get("/api/public/company/:slug", async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const company = await storage.getCompanyBySlug(slug);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const pricingItems = await storage.getServicePricing(company.id);
      const activePricing = pricingItems
        .filter(p => p.isActive && (p.category === "recurring_service" || p.category === "add_on"))
        .map(p => ({
          id: p.id,
          name: p.name,
          basePrice: p.basePrice,
          category: p.category,
          unit: p.unit,
          metadata: p.metadata,
          sortOrder: p.sortOrder,
        }));

      let primaryColor: string | null = null;
      if (company.invoiceTheme) {
        try {
          const theme = JSON.parse(company.invoiceTheme as string);
          if (theme.primaryColor) primaryColor = theme.primaryColor;
        } catch {}
      }

      res.json({
        name: company.name,
        logoUrl: company.logoUrl,
        pricing: activePricing,
        primaryColor,
        quoteFormLayout: company.quoteFormLayout || "stepper",
        country: company.country || "us",
      });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/public/check-zip/:slug/:zip", async (req: Request, res: Response) => {
    try {
      const { slug, zip } = req.params;
      const company = await storage.getCompanyBySlug(slug);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const isCanadian = company.country === "ca";
      const rawZip = zip.trim();

      let normalizedZip: string;
      if (isCanadian) {
        const caPostal = rawZip.replace(/\s/g, "").toUpperCase();
        if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(caPostal)) {
          return res.status(400).json({ error: "Invalid postal code format" });
        }
        normalizedZip = caPostal.slice(0, 3) + " " + caPostal.slice(3);
      } else {
        normalizedZip = rawZip.slice(0, 5);
        if (!/^\d{5}$/.test(normalizedZip)) {
          return res.status(400).json({ error: "Invalid ZIP code format" });
        }
      }

      const zones = await storage.getServiceZones(company.id);
      const activeZones = zones.filter(z => z.isActive);

      if (activeZones.length === 0) {
        return res.json({ inServiceArea: true, hasZones: false });
      }

      let matchingZone: typeof activeZones[0] | undefined;
      if (isCanadian) {
        const prefix = normalizedZip.replace(/\s/g, "").slice(0, 3).toUpperCase();
        matchingZone = activeZones.find(z => {
          const zoneCode = z.zipCode.replace(/\s/g, "").toUpperCase();
          return zoneCode === normalizedZip.replace(/\s/g, "") || zoneCode.startsWith(prefix);
        });
      } else {
        matchingZone = activeZones.find(z => z.zipCode.trim().slice(0, 5) === normalizedZip);
      }

      res.json({
        inServiceArea: !!matchingZone,
        hasZones: true,
        zoneSurchargePercent: matchingZone?.priceSurchargePercent ?? 0,
      });
    } catch (err) { handleError(res, err); }
  });

  const webhookLeadSchema = z.object({
    firstName: z.string().min(1).max(255),
    lastName: z.string().max(255).default(""),
    email: z.string().email().max(255).optional().or(z.literal("")),
    phone: z.string().max(50).regex(/^[+]?[\d\s\-().]{7,}$/, "Invalid phone number format").optional().or(z.literal("")),
    streetAddress: z.string().max(255).optional().or(z.literal("")),
    city: z.string().max(100).optional().or(z.literal("")),
    state: z.string().max(50).optional().or(z.literal("")),
    zipCode: z.string().max(20).optional().or(z.literal("")),
    numberOfDogs: z.union([z.number().int().min(1).max(20), z.string().regex(/^\d+$/).transform(Number)]).default(1),
    yardSize: z.enum(["small", "medium", "large", "extra-large"]).optional(),
    serviceFrequency: z.enum(["twice_weekly", "weekly", "biweekly", "monthly", "onetime"]).default("weekly"),
    serviceDay: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]).optional(),
    source: z.string().max(100).optional(),
    notes: z.string().max(2000).optional(),
  });

  const DEFAULT_SMS_QUOTE_TEMPLATE = "Hi {firstName}! Thanks for your interest in our pet waste removal service. Based on {dogs} dog(s) with {frequency} service, your estimated price is ${price}/visit. Reply YES to get started!";

  async function lookupRealPrice(companyId: string, dogs: number, frequency: string, yardSize?: string): Promise<{ priceCents: number; callForQuote: boolean }> {
    const pricingItems = await storage.getServicePricing(companyId);
    const activeRecurring = pricingItems.filter(p => p.isActive && p.category === "recurring_service");
    const activeAddOns = pricingItems.filter(p => p.isActive && p.category === "add_on");

    if (activeRecurring.length === 0) return { priceCents: 0, callForQuote: false };

    const freqMap: Record<string, string[]> = {
      twice_weekly: ["twice weekly", "twice-weekly", "two times", "2x", "twice per week"],
      weekly: ["weekly", "once a week", "once per week"],
      biweekly: ["bi-weekly", "bi weekly", "every other week", "biweekly"],
      monthly: ["monthly"],
      onetime: ["one-time", "one time", "onetime"],
    };
    const twiceWeeklyKeys = freqMap["twice_weekly"];

    const matchFreq = (name: string, freq: string): boolean => {
      const lower = name.toLowerCase();
      if (freq === "weekly") {
        if (twiceWeeklyKeys.some(k => lower.includes(k))) return false;
        if ((freqMap["biweekly"] || []).some(k => lower.includes(k))) return false;
      }
      return (freqMap[freq] || [freq]).some(k => lower.includes(k));
    };

    const freqItems = activeRecurring.filter(p => matchFreq(p.name, frequency));

    const matchDog = (name: string, d: number): boolean => {
      const lower = name.toLowerCase();
      const rangeMatch = lower.match(/(\d+)\s*[-–]\s*(\d+)\s*dog/);
      if (rangeMatch) return d >= parseInt(rangeMatch[1]) && d <= parseInt(rangeMatch[2]);
      const plusMatch = lower.match(/(\d+)\s*\+\s*dog/);
      if (plusMatch) return d >= parseInt(plusMatch[1]);
      if (lower.includes(`${d}+`) || lower.includes(`${d} +`)) return true;
      if (lower.includes(`${d} dog`)) return true;
      return false;
    };

    let matched = freqItems.find(p => matchDog(p.name, dogs));
    if (!matched) {
      const plusItems = freqItems.filter(p => { const m = p.name.match(/(\d+)\+/); return m && dogs >= parseInt(m[1]); });
      if (plusItems.length > 0) matched = plusItems[plusItems.length - 1];
    }

    if (!matched) return { priceCents: 0, callForQuote: false };
    const matchedMeta = matched.metadata as { callForQuote?: boolean } | null;
    if (matchedMeta?.callForQuote) return { priceCents: 0, callForQuote: true };

    let priceCents = Math.round(parseFloat(matched.basePrice) * 100);

    const lotSizeAddOns = activeAddOns.filter(p => p.name.toLowerCase().includes("lot size") || p.name.toLowerCase().includes("acre"));
    const yardAcreMap: Record<string, number> = { small: 0.1, medium: 0.35, large: 0.75, "extra-large": 1.0 };
    const acreage = yardAcreMap[yardSize || "medium"] || 0.35;
    let bestAddon: typeof activeAddOns[0] | null = null;
    for (const addon of lotSizeAddOns.sort((a, b) => a.sortOrder - b.sortOrder)) {
      const acreMatch = addon.name.match(/([\d.]+)\s*acre/i);
      if (acreMatch && acreage <= parseFloat(acreMatch[1])) { bestAddon = addon; break; }
    }
    if (!bestAddon && lotSizeAddOns.length > 0) bestAddon = lotSizeAddOns[lotSizeAddOns.length - 1];
    if (bestAddon && parseFloat(bestAddon.basePrice) > 0) priceCents += Math.round(parseFloat(bestAddon.basePrice) * 100);

    return { priceCents, callForQuote: false };
  }

  async function sendAutoQuoteSms(company: typeof companies.$inferSelect, contact: { firstName: string; phone: string | null; numberOfDogs: number | null; serviceFrequency: string | null }, yardSize?: string): Promise<boolean> {
    if (!contact.phone) return false;
    const smsOk = await isSmsConfiguredForCompany(company.id);
    if (!smsOk) return false;

    const dogs = contact.numberOfDogs ?? 1;
    const frequency = (contact.serviceFrequency || "weekly") as "weekly" | "biweekly" | "monthly" | "onetime";

    const pricingItems = await storage.getServicePricing(company.id);
    const hasActiveRecurring = pricingItems.some(p => p.isActive && p.category === "recurring_service");

    let priceDollars: string;
    if (hasActiveRecurring) {
      const realPrice = await lookupRealPrice(company.id, dogs, frequency, yardSize);
      if (realPrice.priceCents > 0 && !realPrice.callForQuote) {
        priceDollars = (realPrice.priceCents / 100).toFixed(2);
      } else {
        priceDollars = "Call for Quote";
      }
    } else {
      const yardSizeMap: Record<string, number> = { small: 0.05, medium: 0.1, large: 0.2, "extra-large": 0.35 };
      const pricingInputs: PriceCalculatorInputs = {
        yardSizeAcres: yardSizeMap[yardSize || "medium"] || 0.1,
        dogCount: dogs,
        serviceFrequency: frequency,
        yardDifficulty: "flat",
        distanceFromNearestStopMiles: 0.5,
      };
      const priceResult = calculatePrice(pricingInputs, company.pricingConfig);
      priceDollars = (priceResult.recommendedPriceCents / 100).toFixed(2);
    }

    const template = company.leadWebhookSmsTemplate || DEFAULT_SMS_QUOTE_TEMPLATE;
    const body = template
      .replace(/\{firstName\}/g, contact.firstName)
      .replace(/\{dogs\}/g, String(dogs))
      .replace(/\{frequency\}/g, frequency)
      .replace(/\{price\}/g, priceDollars);

    const result = await sendSmsForCompany({ to: contact.phone, body, companyId: company.id, contactId: contact.id });

    if (result.success) {
      return true;
    } else {
      console.error(`[webhook-lead-sms] Failed to send auto-quote SMS to ${contact.phone}:`, result.error);
      return false;
    }
  }

  app.post("/api/webhooks/leads", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const parsed = webhookLeadSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten().fieldErrors });
      const { firstName, lastName, email, phone, streetAddress, city, state, zipCode, numberOfDogs, yardSize, serviceFrequency, serviceDay, source, notes } = parsed.data;

      const leadSource = source || "webhook";

      const existingSources = await storage.getLeadSources(companyId);
      const sourceExists = existingSources.some(s => s.name.toLowerCase() === leadSource.toLowerCase());
      if (!sourceExists) {
        await storage.createLeadSource({ companyId, name: leadSource });
      }

      const contact = await storage.createContact({
        companyId,
        firstName,
        lastName,
        email: email || null,
        phone: phone || null,
        streetAddress: streetAddress || null,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        numberOfDogs,
        yardSize: yardSize || null,
        serviceFrequency,
        serviceDay: serviceDay || null,
        status: "lead",
        leadSource,
        notes: notes || null,
      });

      const hasFullAddress = !!(streetAddress && city && state && zipCode);
      if (hasFullAddress) {
        await createPropertyWithGeocode({
          companyId,
          contactId: contact.id,
          streetAddress: streetAddress!,
          city: city!,
          state: state!,
          zipCode: zipCode!,
          numberOfDogs,
          yardSize: yardSize || null,
        });
      }

      notify(companyId, "new_lead", "New Lead (Webhook)", `${firstName} ${lastName} submitted via ${leadSource}.`.trim(), `/contacts/${contact.id}`);

      const company = await storage.getCompany(companyId);
      let smsSent = false;
      if (phone && company) {
        try {
          smsSent = await sendAutoQuoteSms(company, { firstName, phone, numberOfDogs, serviceFrequency }, yardSize);
        } catch (err) {
          console.error("[webhook-lead] Auto-quote SMS error:", err);
        }
      }

      const yardSizeMap: Record<string, number> = { small: 0.05, medium: 0.1, large: 0.2, "extra-large": 0.35 };
      const pricingInputs: PriceCalculatorInputs = {
        yardSizeAcres: yardSizeMap[yardSize || "medium"] || 0.1,
        dogCount: numberOfDogs,
        serviceFrequency: serviceFrequency as "weekly" | "biweekly" | "monthly" | "onetime",
        yardDifficulty: "flat",
        distanceFromNearestStopMiles: 0.5,
      };
      const priceResult = calculatePrice(pricingInputs, company?.pricingConfig ?? null);

      res.status(201).json({
        contactId: contact.id,
        leadSource,
        quote: {
          recommendedPriceCents: priceResult.recommendedPriceCents,
          frequency: serviceFrequency,
        },
        smsSent,
      });
    } catch (err) { handleError(res, err); }
  });

  const webhookQuoteSchema = z.object({
    firstName: z.string().min(1).max(255),
    lastName: z.string().max(255).default(""),
    email: z.string().email().max(255).optional().or(z.literal("")),
    phone: z.string().max(50).optional().or(z.literal("")),
    streetAddress: z.string().max(255).optional().or(z.literal("")),
    city: z.string().max(100).optional().or(z.literal("")),
    state: z.string().max(50).optional().or(z.literal("")),
    zipCode: z.string().max(20).optional().or(z.literal("")),
    numberOfDogs: z.union([z.number().int().min(1).max(20), z.string().regex(/^\d+$/).transform(Number)]).default(1),
    yardSize: z.enum(["small", "medium", "large", "estate"]).default("medium"),
    frequency: z.enum(["weekly", "biweekly", "monthly", "onetime"]).default("weekly"),
    isFirstTime: z.boolean().default(true),
    source: z.string().max(100).optional(),
    notes: z.string().max(5000).optional(),
  });

  app.post("/api/webhooks/quotes", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const parsed = webhookQuoteSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten().fieldErrors });

      const { firstName, lastName, email, phone, streetAddress, city, state: st, zipCode, numberOfDogs, yardSize, frequency, isFirstTime, source, notes } = parsed.data;

      const leadSource = source || "website";

      const existingSources = await storage.getLeadSources(companyId);
      if (!existingSources.some(s => s.name.toLowerCase() === leadSource.toLowerCase())) {
        await storage.createLeadSource({ companyId, name: leadSource });
      }

      let contactId: string | null = null;
      const normalizedEmail = email ? email.trim().toLowerCase() : null;
      const normalizedPhone = phone ? phone.replace(/[^\d+]/g, "") : null;
      if (normalizedEmail) {
        const [existing] = await db.select().from(contacts)
          .where(and(eq(contacts.companyId, companyId), sql`LOWER(TRIM(${contacts.email})) = ${normalizedEmail}`))
          .limit(1);
        if (existing) contactId = existing.id;
      }
      if (!contactId && normalizedPhone) {
        const [existing] = await db.select().from(contacts)
          .where(and(eq(contacts.companyId, companyId), eq(contacts.phone, normalizedPhone)))
          .limit(1);
        if (existing) contactId = existing.id;
      }

      if (!contactId) {
        const newContact = await storage.createContact({
          companyId,
          firstName,
          lastName,
          email: normalizedEmail || null,
          phone: normalizedPhone || null,
          streetAddress: streetAddress || null,
          city: city || null,
          state: st || null,
          zipCode: zipCode || null,
          numberOfDogs,
          yardSize: yardSize || null,
          serviceFrequency: frequency,
          status: "lead",
          leadSource,
          notes: notes || null,
        });
        contactId = newContact.id;
      }

      let propertyId: string | null = null;
      const hasFullAddress = !!(streetAddress && city && st && zipCode);
      if (hasFullAddress && contactId) {
        try {
          const prop = await createPropertyWithGeocode({
            companyId,
            contactId,
            streetAddress: streetAddress!,
            city: city!,
            state: st!,
            zipCode: zipCode!,
            numberOfDogs,
            yardSize: yardSize || null,
          });
          propertyId = prop.id;
        } catch {
        }
      }

      const company = await storage.getCompany(companyId);
      const pricingInput: ResidentialQuoteInput = {
        type: "residential",
        dogCount: numberOfDogs,
        yardSize,
        frequency,
        isFirstTime,
      };
      const tierPricing = calculateQuotePricing(pricingInput, company?.quoteDefaults ?? null);

      const fullAddress = hasFullAddress ? `${streetAddress}, ${city}, ${st} ${zipCode}` : (streetAddress || "");

      const quoteNumber = await storage.getNextQuoteNumber(companyId);
      const quote = await storage.createQuote({
        companyId,
        type: "residential",
        quoteNumber,
        contactId,
        propertyId,
        contactName: `${firstName} ${lastName}`.trim(),
        contactEmail: email || null,
        contactPhone: phone || null,
        propertyAddress: fullAddress || null,
        dogCount: numberOfDogs,
        yardSize,
        frequency,
        isFirstTime,
        essentialPrice: tierPricing.essential.toFixed(2),
        premiumPrice: tierPricing.premium.toFixed(2),
        deluxePrice: tierPricing.deluxe.toFixed(2),
        initialCleanFee: tierPricing.initialCleanFee.toFixed(2),
        essentialFeatures: tierPricing.essentialFeatures,
        premiumFeatures: tierPricing.premiumFeatures,
        deluxeFeatures: tierPricing.deluxeFeatures,
        pricingBreakdown: tierPricing.breakdown,
        notes: notes || null,
        status: "draft",
      });

      notify(companyId, "new_quote", "New Quote (Webhook)", `Quote #${quoteNumber} created for ${firstName} ${lastName} via ${leadSource}.`.trim(), `/quotes/${quote.id}`);

      try {
        const { dispatchWebhooksForEvent } = await import("./services/webhook-dispatcher");
        await dispatchWebhooksForEvent(companyId, "quote.created", {
          quoteId: quote.id,
          quoteNumber,
          contactId,
          contactName: `${firstName} ${lastName}`.trim(),
          essentialPrice: tierPricing.essential,
          premiumPrice: tierPricing.premium,
          deluxePrice: tierPricing.deluxe,
          source: leadSource,
        });

        const matchedRules = await db.select().from(automationRules)
          .where(and(eq(automationRules.companyId, companyId), eq(automationRules.trigger, "quote_created"), eq(automationRules.isActive, true)));
        for (const rule of matchedRules) {
          await db.insert(automationEventLogs).values({
            companyId,
            ruleId: rule.id,
            trigger: "quote_created",
            payload: { quoteId: quote.id, contactId, source: leadSource },
            result: { success: true },
          });
        }
      } catch (autoErr) {
        console.error("[webhook-quote] Automation trigger error:", autoErr);
      }

      res.status(201).json({
        quoteId: quote.id,
        quoteNumber,
        contactId,
        propertyId,
        pricing: {
          essential: tierPricing.essential,
          premium: tierPricing.premium,
          deluxe: tierPricing.deluxe,
          initialCleanFee: tierPricing.initialCleanFee,
        },
        source: leadSource,
      });
    } catch (err) { handleError(res, err); }
  });

  const quoteTrackSchema = z.object({
    sessionId: z.string().min(8).max(64),
    event: z.enum(["form_loaded", "zip_entered", "zip_passed", "zip_failed", "step2_completed", "step3_started", "submitted", "quote_shown"]),
    step: z.number().int().min(0).max(4).optional(),
    zipCode: z.string().regex(/^\d{5}$/).optional(),
    isEmbed: z.boolean().optional(),
  });

  const quoteTrackRateLimit = new Map<string, { count: number; resetAt: number }>();

  app.post("/api/public/quote-events/:slug", async (req: Request, res: Response) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      const now = Date.now();
      const entry = quoteTrackRateLimit.get(clientIp);
      if (entry && entry.resetAt > now) {
        if (entry.count >= 100) {
          return res.status(429).json({ error: "Too many requests" });
        }
        entry.count++;
      } else {
        quoteTrackRateLimit.set(clientIp, { count: 1, resetAt: now + 60 * 60 * 1000 });
      }

      const { slug } = req.params;
      const company = await storage.getCompanyBySlug(slug);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const parsed = quoteTrackSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

      const { sessionId, event, step, zipCode, isEmbed } = parsed.data;
      await db.insert(quoteFormEvents).values({
        companyId: company.id,
        sessionId,
        event,
        step: step ?? null,
        zipCode: zipCode ?? null,
        isEmbed: isEmbed ?? false,
      });

      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

  const publicLeadSchema = z.object({
    firstName: z.string().min(1).max(255),
    lastName: z.string().max(255).default(""),
    email: z.string().email().max(255).optional().or(z.literal("")),
    phone: z.string().max(50).optional().or(z.literal("")),
    streetAddress: z.string().min(1).max(255),
    city: z.string().min(1).max(100),
    state: z.string().min(1).max(50),
    zipCode: z.string().min(1).max(20),
    numberOfDogs: z.union([z.number().int().min(1).max(20), z.string().regex(/^\d+$/).transform(Number)]).default(1),
    yardSize: z.enum(["small", "medium", "large", "extra-large"]).default("medium"),
    serviceFrequency: z.enum(["twice_weekly", "weekly", "biweekly", "monthly", "onetime"]).default("weekly"),
    serviceDay: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]).optional(),
    pricingItemId: z.string().uuid().optional(),
    lotAddonId: z.string().uuid().optional(),
    lastCleanup: z.enum(["1_week", "2_weeks", "3_weeks", "1_month", "2_months", "3_4_months", "never"]).optional(),
    notes: z.string().max(2000).optional(),
    smsOptIn: z.boolean().optional().default(false),
  });

  const publicLeadRateLimit = new Map<string, { count: number; resetAt: number }>();

  app.post("/api/public/leads/:slug", async (req: Request, res: Response) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      const now = Date.now();
      const entry = publicLeadRateLimit.get(clientIp);
      if (entry && entry.resetAt > now) {
        if (entry.count >= 10) {
          return res.status(429).json({ error: "Too many requests. Please try again later." });
        }
        entry.count++;
      } else {
        publicLeadRateLimit.set(clientIp, { count: 1, resetAt: now + 60 * 60 * 1000 });
      }

      const { slug } = req.params;
      const company = await storage.getCompanyBySlug(slug);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const parsed = publicLeadSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
      const { firstName, lastName, email, phone, streetAddress, city, state, zipCode, numberOfDogs, yardSize, serviceFrequency, serviceDay, pricingItemId, lotAddonId, lastCleanup, notes, smsOptIn } = parsed.data;

      const contact = await storage.createContact({
        companyId: company.id,
        firstName,
        lastName,
        email: email || null,
        phone: phone || null,
        streetAddress,
        city,
        state,
        zipCode,
        numberOfDogs,
        yardSize,
        serviceFrequency,
        serviceDay: serviceDay || null,
        notes: [
          lastCleanup ? `Last cleanup: ${lastCleanup}` : null,
          notes || null,
        ].filter(Boolean).join(". ") || null,
        status: "lead",
        leadSource: "website_widget",
      });

      const hasFullAddress = !!(streetAddress && city && state && zipCode);
      if (hasFullAddress) {
        await createPropertyWithGeocode({
          companyId: company.id,
          contactId: contact.id,
          streetAddress: streetAddress!,
          city,
          state,
          zipCode,
          numberOfDogs,
        });
      }

      notify(company.id, "new_lead", "New Lead", `${firstName} ${lastName} signed up via your website widget.`.trim(), `/contacts/${contact.id}`);

      let quotePriceCents: number | null = null;
      let callForQuote = false;

      const pricingItems = await storage.getServicePricing(company.id);
      const hasActiveRecurring = pricingItems.some(p => p.isActive && p.category === "recurring_service");

      if (pricingItemId) {
        const selectedItem = pricingItems.find(p => p.id === pricingItemId && p.isActive && p.category === "recurring_service");
        if (selectedItem) {
          const meta = selectedItem.metadata as { callForQuote?: boolean } | null;
          if (meta?.callForQuote) {
            callForQuote = true;
          } else {
            quotePriceCents = Math.round(parseFloat(selectedItem.basePrice) * 100);
          }
          if (lotAddonId && quotePriceCents !== null) {
            const lotItem = pricingItems.find(p => p.id === lotAddonId && p.isActive && p.category === "add_on");
            if (lotItem && parseFloat(lotItem.basePrice) > 0) {
              quotePriceCents += Math.round(parseFloat(lotItem.basePrice) * 100);
            }
          }
        }
      }

      if (quotePriceCents === null && !callForQuote && hasActiveRecurring) {
        const realPrice = await lookupRealPrice(company.id, numberOfDogs, serviceFrequency, yardSize);
        if (realPrice.callForQuote) {
          callForQuote = true;
        } else if (realPrice.priceCents > 0) {
          quotePriceCents = realPrice.priceCents;
        } else {
          callForQuote = true;
        }
      }

      if (quotePriceCents === null && !callForQuote && !hasActiveRecurring) {
        const yardSizeMap: Record<string, number> = { small: 0.05, medium: 0.1, large: 0.2, "extra-large": 0.35 };
        const pricingInputs: PriceCalculatorInputs = {
          yardSizeAcres: yardSizeMap[yardSize] || 0.1,
          dogCount: numberOfDogs,
          serviceFrequency,
          yardDifficulty: "flat",
          distanceFromNearestStopMiles: 0.5,
        };
        const priceResult = calculatePrice(pricingInputs, company.pricingConfig);
        quotePriceCents = priceResult.recommendedPriceCents;
      }

      let zoneSurchargePercent = 0;
      if (zipCode && quotePriceCents !== null && !callForQuote) {
        const normalizedZip = zipCode.trim().slice(0, 5);
        const zones = await storage.getServiceZones(company.id);
        const matchingZone = zones.find(z => z.zipCode.trim().slice(0, 5) === normalizedZip && z.isActive);
        if (matchingZone && matchingZone.priceSurchargePercent > 0) {
          zoneSurchargePercent = matchingZone.priceSurchargePercent;
          quotePriceCents = Math.round(quotePriceCents * (1 + zoneSurchargePercent / 100));
        }
      }

      res.status(201).json({
        contactId: contact.id,
        quote: {
          recommendedPriceCents: callForQuote ? 0 : (quotePriceCents || 0),
          frequency: serviceFrequency,
          callForQuote,
          zoneSurchargePercent,
        },
      });

      if (company.quoteAutoFollowUpEnabled) {
        const priceDollars = callForQuote ? "Call for Quote" : ((quotePriceCents || 0) / 100).toFixed(2);
        const companyName = company.name || "Our Company";
        const priceForMerge = callForQuote ? "a custom quote" : `$${priceDollars}/visit`;
        const mergeReplace = (tpl: string) =>
          tpl
            .replace(/\{firstName\}/g, firstName)
            .replace(/\{price\}/g, priceForMerge)
            .replace(/\{frequency\}/g, serviceFrequency)
            .replace(/\{companyName\}/g, companyName)
            .replace(/\{dogs\}/g, String(numberOfDogs));

        if (phone && smsOptIn) {
          (async () => {
            try {
              const smsConfigured = await isSmsConfiguredForCompany(company.id);
              if (!smsConfigured) return;
              const defaultSmsTpl = "Thanks {firstName}! Your estimated quote from {companyName} is {price} for {frequency} service. We'll be in touch to confirm your schedule!";
              const smsTpl = company.quoteFollowUpSmsTemplate || defaultSmsTpl;
              const smsBody = mergeReplace(smsTpl);
              const result = await sendSmsForCompany({ to: phone, body: smsBody, companyId: company.id, contactId: contact.id });
              if (!result.success) console.error(`[quote-followup-sms] Failed:`, result.error);
            } catch (err) {
              console.error("[quote-followup-sms] Error:", err);
            }
          })();
        }

        if (email && company.quoteFollowUpEmailEnabled) {
          (async () => {
            try {
              const safeCompanyName = escapeHtml(companyName);
              const safeFirstName = escapeHtml(firstName);
              const defaultEmailSubject = "Your Quote from {companyName}";
              const subject = mergeReplace(company.quoteFollowUpEmailSubject || defaultEmailSubject);
              const priceDisplay = callForQuote ? "Custom Quote" : `$${priceDollars}/visit`;
              const cleanupLabel = lastCleanup ? lastCleanup.replace(/_/g, " ") : null;
              const initialCleanupNote = cleanupLabel
                ? `<tr><td style="padding: 6px 0; color: #6b7280;">Initial Cleanup</td><td style="padding: 6px 0; text-align: right; font-weight: 600; color: #1f2937;">${escapeHtml(cleanupLabel)} since last service</td></tr>`
                : "";
              const logoHtml = company.logoUrl
                ? `<img src="${escapeHtml(company.logoUrl)}" alt="${safeCompanyName}" style="max-height: 48px; max-width: 200px; margin-bottom: 8px;" /><br/>`
                : "";
              const defaultEmailBody = `Hi {firstName},\n\nThank you for requesting a quote from {companyName}!\n\nYour estimated price for {frequency} service with {dogs} dog(s) is {price}.${cleanupLabel ? `\nInitial cleanup: ${cleanupLabel} since last service.` : ""}\n\nWe'll follow up shortly to confirm your schedule.\n\nBest regards,\n{companyName}`;
              const customBody = company.quoteFollowUpEmailBody;
              const text = mergeReplace(customBody || defaultEmailBody);
              const bodyHtml = escapeHtml(text).replace(/\n/g, "<br/>");
              const html = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background-color: #2d8a5e; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
                    ${logoHtml}
                    <h1 style="color: white; margin: 0; font-size: 22px;">${safeCompanyName}</h1>
                  </div>
                  <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none;">
                    <div style="margin: 0 0 20px; color: #4b5563; font-size: 14px; line-height: 1.6;">${bodyHtml}</div>
                    <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 0 0 20px;">
                      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <tr>
                          <td style="padding: 6px 0; color: #6b7280;">Service Frequency</td>
                          <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #1f2937;">${escapeHtml(serviceFrequency)}</td>
                        </tr>
                        <tr>
                          <td style="padding: 6px 0; color: #6b7280;">Number of Dogs</td>
                          <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #1f2937;">${numberOfDogs}</td>
                        </tr>
                        ${initialCleanupNote}
                        <tr style="border-top: 1px solid #d1fae5;">
                          <td style="padding: 10px 0 0; color: #6b7280; font-size: 15px;">Estimated Price</td>
                          <td style="padding: 10px 0 0; text-align: right; font-weight: 700; font-size: 20px; color: #16a34a;">${escapeHtml(priceDisplay)}</td>
                        </tr>
                      </table>
                    </div>
                    ${company.phone ? `<p style="margin: 0 0 16px;"><a href="tel:${escapeHtml(company.phone)}" style="display: inline-block; background-color: #16a34a; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600;">Contact Us</a></p>` : ""}
                  </div>
                  <div style="padding: 12px; text-align: center; font-size: 11px; color: #9ca3af;">
                    ${safeCompanyName}
                  </div>
                </div>`;
              const emailResult = await sendEmail({ to: email, subject, text, html, companyId: company.id, senderName: companyName, replyTo: company.email || undefined });
              if (emailResult.success) {
                await logEmailSent(company.id, email, subject, "quote_follow_up", emailResult.messageId, contact.id);
              } else {
                console.error("[quote-followup-email] Failed:", emailResult.error);
              }
            } catch (err) {
              console.error("[quote-followup-email] Error:", err);
            }
          })();
        }
      }
    } catch (err) { handleError(res, err); }
  });

  // ================ QuickBooks Online Integration ================

  app.get("/api/qbo/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { isQboConfigured, getQboSyncStatus } = await import("./services/quickbooks");
      if (!isQboConfigured()) {
        return res.json({ configured: false, connected: false, realmId: null, connectedAt: null, lastSync: null, totalSynced: 0, totalErrors: 0, recentLogs: [] });
      }
      const status = await getQboSyncStatus(companyId);
      return res.json({ configured: true, ...status });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/qbo/connect", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const { isQboConfigured, getQboAuthUrl, createOAuthState } = await import("./services/quickbooks");
      if (!isQboConfigured()) {
        return res.status(503).json({ error: "QuickBooks integration is not configured. Please add QBO_CLIENT_ID and QBO_CLIENT_SECRET." });
      }
      const baseUrl = getBaseUrl(req);
      const redirectUri = `${baseUrl}/api/qbo/callback`;
      const state = createOAuthState(companyId);
      const authUrl = getQboAuthUrl(redirectUri, state);
      return res.json({ url: authUrl });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/qbo/callback", async (req: Request, res: Response) => {
    try {
      const { code, state, realmId } = req.query as { code: string; state: string; realmId: string };
      if (!code || !state || !realmId) {
        return res.redirect("/settings?qbo=error&msg=missing_params");
      }
      const { exchangeQboCode, validateOAuthState, encryptToken } = await import("./services/quickbooks");
      const companyId = validateOAuthState(state);
      if (!companyId) {
        return res.redirect("/settings?qbo=error&msg=invalid_or_expired_state");
      }
      const baseUrl = getBaseUrl(req);
      const redirectUri = `${baseUrl}/api/qbo/callback`;
      const tokens = await exchangeQboCode(code, redirectUri);

      await db.update(companies).set({
        qboRealmId: realmId,
        qboAccessToken: encryptToken(tokens.access_token),
        qboRefreshToken: encryptToken(tokens.refresh_token),
        qboTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        qboConnectedAt: new Date(),
      }).where(eq(companies.id, companyId));

      return res.redirect("/settings?qbo=connected");
    } catch (err: any) {
      console.error("QBO callback error:", err);
      return res.redirect(`/settings?qbo=error&msg=${encodeURIComponent(err.message || "auth_failed")}`);
    }
  });

  app.post("/api/qbo/disconnect", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const { disconnectQbo } = await import("./services/quickbooks");
      await disconnectQbo(companyId);
      auditLog(companyId, (await getCompanyContext(req)).userId, "company", companyId, "qbo_disconnect");
      return res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/qbo/sync", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const { runFullSync } = await import("./services/quickbooks");
      const result = await runFullSync(companyId);
      auditLog(companyId, (await getCompanyContext(req)).userId, "company", companyId, "qbo_full_sync", { result });
      return res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/qbo/sync/contact/:contactId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const { syncContactToQbo } = await import("./services/quickbooks");
      const result = await syncContactToQbo(companyId, req.params.contactId);
      return res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/qbo/sync/invoice/:invoiceId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const { syncInvoiceToQbo } = await import("./services/quickbooks");
      const result = await syncInvoiceToQbo(companyId, req.params.invoiceId);
      return res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/qbo/retry/:logId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const logId = req.params.logId;
      const [logEntry] = await db.select().from(qboSyncLogs).where(and(eq(qboSyncLogs.id, logId), eq(qboSyncLogs.companyId, companyId)));
      if (!logEntry) return res.status(404).json({ error: "Sync log not found" });
      const { syncContactToQbo, syncInvoiceToQbo, syncPaymentToQbo } = await import("./services/quickbooks");
      try {
        if (logEntry.entityType === "contact") {
          await syncContactToQbo(companyId, logEntry.entityId);
        } else if (logEntry.entityType === "invoice") {
          await syncInvoiceToQbo(companyId, logEntry.entityId);
        } else if (logEntry.entityType === "payment") {
          await syncPaymentToQbo(companyId, logEntry.entityId);
        }
        return res.json({ success: true });
      } catch (retryErr: any) {
        return res.status(422).json({ error: retryErr.message });
      }
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/qbo/expense-accounts", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const { listQboExpenseAccounts } = await import("./services/quickbooks");
      const accounts = await listQboExpenseAccounts(companyId);
      res.json(accounts);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/qbo/fee-account", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const { accountId } = req.body;
      if (!accountId || typeof accountId !== "string") {
        return res.status(400).json({ error: "accountId is required" });
      }
      const { listQboExpenseAccounts } = await import("./services/quickbooks");
      const accounts = await listQboExpenseAccounts(companyId);
      const valid = accounts.some((a) => a.id === accountId);
      if (!valid) {
        return res.status(400).json({ error: "Invalid expense account ID" });
      }
      await db.update(companies).set({ qboFeeAccountRef: accountId }).where(eq(companies.id, companyId));
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  // ================ Voice Agent Scheduling API ================

  app.get("/api/voice/lookup", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (!(req as any)._apiKeyAuth) requireRole(role, ["owner", "admin"]);
      const phone = (req.query.phone as string || "").replace(/[^\d+]/g, "");
      if (!phone || phone.length < 7) {
        return res.json({ found: false, message: "No matching customer found" });
      }
      const allContacts = await storage.getContacts(companyId, { search: phone });
      const matched = allContacts.find(c => c.phone && c.phone.replace(/[^\d+]/g, "").includes(phone));
      if (!matched) {
        return res.json({ found: false, message: "No matching customer found" });
      }
      const plans = await storage.getServicePlans(companyId, { contactId: matched.id });
      const activePlans = plans.filter(p => p.isActive);
      const props = await storage.getProperties(companyId, matched.id);
      const today = new Date().toISOString().split("T")[0];
      let upcomingVisits: { scheduledDate: string; status: string; servicePlanName: string; propertyAddress: string }[] = [];
      if (activePlans.length > 0) {
        const visitsResult = await storage.getVisitsForContact(companyId, matched.id, 50, 0);
        upcomingVisits = visitsResult.visits
          .filter(v => v.scheduledDate >= today && v.status === "scheduled")
          .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
          .slice(0, 3)
          .map(v => ({ scheduledDate: v.scheduledDate, status: v.status, servicePlanName: v.servicePlanName, propertyAddress: v.propertyAddress }));
      }
      let activeHolds: { id: string; startDate: string; endDate: string; reason: string | null }[] = [];
      if (activePlans.length > 0) {
        const allHolds = await Promise.all(activePlans.map(p => storage.getVacationHolds(p.id)));
        activeHolds = allHolds.flat()
          .filter(h => h.endDate >= today)
          .map(h => ({ id: h.id, startDate: h.startDate, endDate: h.endDate, reason: h.reason }));
      }
      res.json({
        found: true,
        contact: {
          id: matched.id,
          firstName: matched.firstName,
          lastName: matched.lastName,
          phone: matched.phone,
          email: matched.email,
          status: matched.status,
        },
        properties: props.map(p => ({
          id: p.id,
          streetAddress: p.streetAddress,
          city: p.city,
          state: p.state,
          zipCode: p.zipCode,
          numberOfDogs: p.numberOfDogs,
        })),
        servicePlans: activePlans.map(sp => ({
          id: sp.id,
          frequency: sp.frequency,
          dayOfWeek: sp.dayOfWeek,
          pricePerVisit: sp.pricePerVisit,
          propertyId: sp.propertyId,
          serviceName: sp.serviceName,
        })),
        upcomingVisits,
        activeHolds,
      });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/voice/calls", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (!(req as any)._apiKeyAuth) requireRole(role, ["owner", "admin"]);
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const calls = await storage.getVoiceCalls(companyId, limit);
      res.json(calls);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/voice/availability", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (!(req as any)._apiKeyAuth) requireRole(role, ["owner", "admin"]);
      const dayFilter = req.query.dayOfWeek as string | undefined;
      const zipCode = req.query.zipCode as string | undefined;
      const allRoutes = await storage.getRoutes(companyId);
      const activePlans = await storage.getServicePlans(companyId, { isActive: true });

      let servedDays: Set<string> | null = null;
      if (zipCode) {
        const zones = await storage.getServiceZones(companyId);
        const matchingZones = zones.filter(z => z.isActive && z.zipCode === zipCode);
        if (matchingZones.length === 0) {
          return res.json({ availability: [], available_days: [], message: `No service zones found for zip code ${zipCode}` });
        }
        servedDays = new Set(matchingZones.map(z => z.dayOfWeek).filter(d => d !== "tbd"));
        if (servedDays.size === 0) servedDays = null;
      }

      const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
      const availability = days
        .filter(d => !dayFilter || d === dayFilter)
        .filter(d => !servedDays || servedDays.has(d))
        .map(day => {
          const dayRoutes = allRoutes.filter(r => r.dayOfWeek === day);
          const totalStops = dayRoutes.reduce((sum, r) => {
            return sum + activePlans.filter(sp => sp.routeId === r.id).length;
          }, 0);
          const totalCapacity = dayRoutes.length * 30;
          const openSlots = Math.max(0, totalCapacity - totalStops);
          return {
            dayOfWeek: day,
            routeCount: dayRoutes.length,
            currentStops: totalStops,
            openSlots,
            available: openSlots > 0,
          };
        });
      const available_days = availability.filter(d => d.available).map(d => d.dayOfWeek);
      res.json({ availability, available_days });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/voice/book", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (!(req as any)._apiKeyAuth) requireRole(role, ["owner", "admin"]);
      const { firstName, lastName, phone, email, streetAddress, city, state, zipCode, numberOfDogs, frequency, dayOfWeek, notes } = req.body;
      if (!firstName || typeof firstName !== "string" || !lastName || typeof lastName !== "string" || !phone || typeof phone !== "string") {
        return res.status(400).json({ error: "firstName, lastName, and phone are required (strings)" });
      }
      if (!streetAddress || !city || !state || !zipCode) {
        return res.status(400).json({ error: "streetAddress, city, state, and zipCode are required" });
      }
      type Frequency = "weekly" | "biweekly" | "monthly" | "onetime";
      const validFrequencies: Frequency[] = ["weekly", "biweekly", "monthly", "onetime"];
      const freq: Frequency = (frequency || "weekly") as Frequency;
      if (!validFrequencies.includes(freq)) {
        return res.status(400).json({ error: `frequency must be one of: ${validFrequencies.join(", ")}` });
      }
      const validDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
      type DayOfWeek = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday" | "tbd";
      const day: DayOfWeek = (dayOfWeek || "tbd") as DayOfWeek;
      if (day !== "tbd" && !validDays.includes(day)) {
        return res.status(400).json({ error: `dayOfWeek must be one of: ${validDays.join(", ")}, or omit for auto-assignment` });
      }
      const dogCount = numberOfDogs && Number.isInteger(Number(numberOfDogs)) && Number(numberOfDogs) > 0 ? Number(numberOfDogs) : 1;

      let routeId: string | null = null;
      if (day !== "tbd") {
        const dayRoutes = await storage.getRoutes(companyId, day);
        if (dayRoutes.length > 0) {
          const allPlans = await storage.getServicePlans(companyId, { isActive: true });
          let bestRoute = dayRoutes[0];
          let bestCount = Infinity;
          for (const route of dayRoutes) {
            const stopCount = allPlans.filter(sp => sp.routeId === route.id).length;
            if (stopCount < bestCount) {
              bestCount = stopCount;
              bestRoute = route;
            }
          }
          routeId = bestRoute.id;
        }
      }

      const result = await db.transaction(async (tx) => {
        const [contact] = await tx.insert(contacts).values({
          companyId,
          firstName,
          lastName,
          phone,
          email: email || null,
          status: "active",
          notes: notes || null,
        }).returning();

        const [property] = await tx.insert(properties).values({
          companyId,
          contactId: contact.id,
          streetAddress,
          city,
          state,
          zipCode,
          numberOfDogs: dogCount,
        }).returning();

        const [servicePlan] = await tx.insert(servicePlansTable).values({
          companyId,
          contactId: contact.id,
          propertyId: property.id,
          frequency: freq,
          dayOfWeek: day,
          pricePerVisit: "0",
          isActive: true,
          startDate: new Date().toISOString().split("T")[0],
          routeId,
          stopOrder: 0,
        }).returning();

        const [agreement] = await tx.insert(agreementsTable).values({
          companyId,
          contactId: contact.id,
          frequency: freq,
          pricePerVisit: "0",
          isActive: true,
          startDate: new Date().toISOString().split("T")[0],
          servicePlanId: servicePlan.id,
        }).returning();

        await tx.insert(jobsTable).values({
          companyId,
          agreementId: agreement.id,
          propertyId: property.id,
          routeId,
          stopOrder: 0,
          dayOfWeek: day !== "tbd" ? day : null,
          jobType: "recurring",
          jobStatus: "active",
          anytime: true,
          servicePlanId: servicePlan.id,
        });

        return { contact, property, servicePlan };
      });

      res.status(201).json({
        success: true,
        contactId: result.contact.id,
        propertyId: result.property.id,
        servicePlanId: result.servicePlan.id,
        routeAssigned: !!routeId,
        summary: `Booked ${freq} service for ${firstName} ${lastName} at ${streetAddress}, ${city}${day !== "tbd" ? ` on ${day}s` : ""}`,
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/voice/pause", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (!(req as any)._apiKeyAuth) requireRole(role, ["owner", "admin"]);
      const { contactId, servicePlanId, startDate, endDate, reason } = req.body;
      if (!startDate || !endDate) {
        return res.status(400).json({ error: "startDate and endDate are required (YYYY-MM-DD)" });
      }
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
        return res.status(400).json({ error: "Dates must be in YYYY-MM-DD format" });
      }
      if (startDate > endDate) {
        return res.status(400).json({ error: "startDate must be on or before endDate" });
      }
      let planIds: string[] = [];
      if (servicePlanId) {
        const sp = await storage.getServicePlan(servicePlanId, companyId);
        if (!sp) return res.status(404).json({ error: "Service plan not found" });
        planIds = [servicePlanId];
      } else if (contactId) {
        const plans = await storage.getServicePlans(companyId, { contactId, isActive: true });
        planIds = plans.map(p => p.id);
      } else {
        return res.status(400).json({ error: "Provide contactId or servicePlanId" });
      }
      if (planIds.length === 0) {
        return res.status(404).json({ error: "No active service plans found" });
      }
      const holds = await Promise.all(planIds.map(pid =>
        storage.createVacationHold({ servicePlanId: pid, startDate, endDate, reason: reason || null })
      ));
      res.status(201).json({
        success: true,
        holdsCreated: holds.length,
        startDate,
        endDate,
        summary: `Service paused from ${startDate} to ${endDate}`,
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/voice/resume", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (!(req as any)._apiKeyAuth) requireRole(role, ["owner", "admin"]);
      const { contactId, servicePlanId } = req.body;
      let planIds: string[] = [];
      if (servicePlanId) {
        const sp = await storage.getServicePlan(servicePlanId, companyId);
        if (!sp) return res.status(404).json({ error: "Service plan not found" });
        planIds = [servicePlanId];
      } else if (contactId) {
        const plans = await storage.getServicePlans(companyId, { contactId, isActive: true });
        planIds = plans.map(p => p.id);
      } else {
        return res.status(400).json({ error: "Provide contactId or servicePlanId" });
      }
      const today = new Date().toISOString().split("T")[0];
      let removedCount = 0;
      for (const pid of planIds) {
        const holds = await storage.getVacationHolds(pid);
        const activeHolds = holds.filter(h => h.endDate >= today);
        for (const hold of activeHolds) {
          await storage.deleteVacationHold(hold.id, companyId);
          removedCount++;
        }
      }
      res.json({
        success: true,
        holdsRemoved: removedCount,
        summary: removedCount > 0 ? `Removed ${removedCount} vacation hold(s). Service resumed.` : "No active holds found to remove.",
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/voice/reschedule", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (!(req as any)._apiKeyAuth) requireRole(role, ["owner", "admin"]);
      const { servicePlanId, contactId, newDayOfWeek } = req.body;
      const validDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
      if (!newDayOfWeek || !validDays.includes(newDayOfWeek)) {
        return res.status(400).json({ error: `newDayOfWeek is required and must be one of: ${validDays.join(", ")}` });
      }
      let plans: { id: string; dayOfWeek: string | null }[] = [];
      if (servicePlanId) {
        const sp = await storage.getServicePlan(servicePlanId, companyId);
        if (!sp) return res.status(404).json({ error: "Service plan not found" });
        plans = [sp];
      } else if (contactId) {
        const activePlans = await storage.getServicePlans(companyId, { contactId, isActive: true });
        plans = activePlans;
      } else {
        return res.status(400).json({ error: "Provide servicePlanId or contactId" });
      }
      if (plans.length === 0) {
        return res.status(404).json({ error: "No active service plans found" });
      }
      let newRouteId: string | null = null;
      const dayRoutes = await storage.getRoutes(companyId, newDayOfWeek);
      if (dayRoutes.length > 0) {
        const allPlans = await storage.getServicePlans(companyId, { isActive: true });
        let bestRoute = dayRoutes[0];
        let bestCount = Infinity;
        for (const route of dayRoutes) {
          const stopCount = allPlans.filter(sp => sp.routeId === route.id).length;
          if (stopCount < bestCount) {
            bestCount = stopCount;
            bestRoute = route;
          }
        }
        newRouteId = bestRoute.id;
      }
      for (const plan of plans) {
        await storage.updateServicePlan(plan.id, companyId, { dayOfWeek: newDayOfWeek as any, routeId: newRouteId });
      }
      res.json({
        success: true,
        plansUpdated: plans.length,
        newDayOfWeek,
        routeAssigned: !!newRouteId,
        summary: `Rescheduled ${plans.length} plan(s) to ${newDayOfWeek}s`,
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/voice/cancel", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (!(req as any)._apiKeyAuth) requireRole(role, ["owner", "admin"]);
      const { contactId, reason } = req.body;
      if (!contactId) {
        return res.status(400).json({ error: "contactId is required" });
      }
      const contact = await storage.getContact(contactId, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const plans = await storage.getServicePlans(companyId, { contactId, isActive: true });
      for (const plan of plans) {
        await storage.updateServicePlan(plan.id, companyId, { isActive: false, jobStatus: "cancelled" as any });
      }
      await storage.updateContact(contactId, companyId, {
        status: "cancelled" as any,
        notes: contact.notes
          ? `${contact.notes}\n[Voice agent] Cancelled: ${reason || "No reason provided"}`
          : `[Voice agent] Cancelled: ${reason || "No reason provided"}`,
      });
      res.json({
        success: true,
        plansDeactivated: plans.length,
        summary: `Service cancelled for ${contact.firstName} ${contact.lastName}. ${plans.length} plan(s) deactivated.`,
      });
    } catch (err) { handleError(res, err); }
  });

  const { registerAdminAnalyticsRoutes } = await import("./admin-analytics");
  registerAdminAnalyticsRoutes(app, isAdmin);

  import("./jobs/nightly-rollup").then(({ runNightlyRollup }) => {
    setTimeout(() => runNightlyRollup().catch(console.error), 30000);
    setInterval(() => runNightlyRollup().catch(console.error), 24 * 60 * 60 * 1000);
  });

  import("./jobs/message-cleanup").then(({ runMessageCleanup }) => {
    setTimeout(() => runMessageCleanup().catch(console.error), 120000);
    setInterval(() => runMessageCleanup().catch(console.error), 24 * 60 * 60 * 1000);
  });

  import("./jobs/stripe-event-cleanup").then(({ runStripeEventCleanup }) => {
    setTimeout(() => runStripeEventCleanup().catch(console.error), 60000);
    setInterval(() => runStripeEventCleanup().catch(console.error), 24 * 60 * 60 * 1000);
  });

  import("./jobs/reminders").then(({ runReminders }) => {
    setTimeout(() => runReminders().catch(console.error), 60000);
    setInterval(() => runReminders().catch(console.error), 10 * 60 * 1000);
  });

  import("./jobs/auto-invoice").then(({ runAutoInvoice }) => {
    setTimeout(() => runAutoInvoice().catch(console.error), 60000);
    setInterval(() => runAutoInvoice().catch(console.error), 24 * 60 * 60 * 1000);
  });

  import("./jobs/auto-visits").then(({ runAutoVisits }) => {
    setTimeout(() => runAutoVisits().catch(console.error), 90000);
    setInterval(() => runAutoVisits().catch(console.error), 24 * 60 * 60 * 1000);
  });

  import("./services/webhook-dispatcher").then(({ startWebhookRetryJob }) => {
    startWebhookRetryJob();
  });

  import("./jobs/demo-auto-complete").then(({ runDemoAutoComplete }) => {
    setTimeout(() => runDemoAutoComplete().catch(console.error), 45000);
    setInterval(() => runDemoAutoComplete().catch(console.error), 60 * 60 * 1000);
  });

  import("./jobs/trial-expiration").then(({ runTrialExpirationCheck }) => {
    setTimeout(() => runTrialExpirationCheck().catch(console.error), 90000);
    setInterval(() => runTrialExpirationCheck().catch(console.error), 60 * 60 * 1000);
  });

  async function syncSeatUsageToStripe(): Promise<void> {
    try {
      const allCompanies = await storage.listCompanies();
      for (const company of allCompanies) {
        if (!company.stripeSubscriptionId || company.subscriptionStatus === "cancelled") continue;
        const members = await storage.getCompanyUsers(company.id);
        const activeCount = members.filter(m => m.isActive !== false).length;
        await reportMeteredUsageSet(company.stripeSubscriptionId, "user_seat", activeCount).catch(() => {});
      }
      console.log(`[Seat Sync] Reported seat counts for ${allCompanies.filter(c => c.stripeSubscriptionId).length} companies`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Seat Sync] Error:", message);
    }
  }
  setTimeout(() => syncSeatUsageToStripe().catch(console.error), 120000);
  setInterval(() => syncSeatUsageToStripe().catch(console.error), 24 * 60 * 60 * 1000);

  return httpServer;
}
