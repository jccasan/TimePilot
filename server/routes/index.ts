import type { Express, Request, Response } from "express";
import { type Server } from "http";
import crypto from "crypto";
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  registerObjectStorageRoutes,
  ObjectStorageService,
  ObjectNotFoundError,
} from "../replit_integrations/object_storage";
import type { RequestHandler } from "express";
import { validateStripeConfig, fetchStripePrices } from "../services/stripe";

import { isAuthenticated } from "./shared";

import { registerBillingRoutes } from "./billing";
import { registerAuthRoutes } from "./auth";
import { registerOnboardingRoutes } from "./onboarding";
import { registerCompanyRoutes } from "./company";
import { registerContactsRoutes } from "./contacts";
import { registerPropertiesRoutes } from "./properties";
import { registerRoutePlanningRoutes } from "./route-planning";
import { registerServicePlansRoutes } from "./service-plans";
import { registerVisitsRoutes } from "./visits";
import { registerInvoicesRoutes } from "./invoices";
import { registerAutomationRoutes } from "./automation";
import { registerVoiceRoutes } from "./voice";
import { registerPricingRoutes } from "./pricing";
import { registerMessagesRoutes } from "./messages";
import { registerStripeRoutes } from "./stripe";
import { registerQuotesRoutes } from "./quotes";
import { registerPortalRoutes } from "./portal";
import { registerMiscRoutes } from "./misc";
import { registerAdminRoutes } from "./admin";
import { registerPublicRoutes } from "./public-routes";
import { registerIntegrationsRoutes } from "./integrations";
import { registerErrorReportingRoutes } from "./error-reporting";
import { registerPlannerRoutes } from "./planner";
import { registerImportBatchesRoutes } from "./import-batches";
import { registerSmsAgentRoutes } from "./sms-agent";
import { registerCrmRoutes } from "./crm";
import { registerDocumentsRoutes } from "./documents";
import { registerCustomFieldsRoutes } from "./custom-fields";
import { registerLeadResponseRoutes, blockLeadResponseOperator } from "./lead-response";
import { registerCalendarRoutes } from "./calendar";
import { registerEmailInboundRoutes } from "./email-inbound";
import { registerFacebookWebhookRoutes } from "./facebook-webhook";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Object file download route — registered before registerObjectStorageRoutes so this
  // handler takes precedence and enforces ACL access control on private objects.
  const _objStorage = new ObjectStorageService();
  app.get("/objects/{*objectPath}", async (req: Request, res: Response) => {
    try {
      const objectFile = await _objStorage.getObjectEntityFile(req.path);

      // Resolve the caller's stable identity from all supported auth mechanisms.
      // For staff sessions the identity is the userId; for portal sessions it is
      // the contactId (set in session cookie at login so img-tag requests work).
      let callerUserId: string | undefined = req.session.userId || req.session.portalContactId;

      if (!callerUserId) {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) {
          const token = authHeader.slice(7);
          // Try staff Bearer session (mirrors isAuthenticated middleware logic)
          const sessionRow = await db.execute(
            sql`SELECT sess FROM sessions WHERE sid = ${token} AND expire > NOW()`
          );
          if (sessionRow.rows.length > 0) {
            const sessionData = sessionRow.rows[0].sess as Record<string, unknown>;
            if (typeof sessionData?.userId === "string") {
              callerUserId = sessionData.userId;
            }
          }
          if (!callerUserId) {
            // Try portal Bearer session — use contactId as the ACL identity
            const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
            const portalSession = await storage.getPortalSessionByToken(tokenHash);
            if (portalSession) {
              callerUserId = portalSession.contactId;
            }
          }
        }
      }

      // Company logos are always public assets (invoices, portals, signup widget).
      // If this object is currently set as any company's logoUrl, serve it without
      // requiring ACL metadata — ACL writes can silently fail in serverless Postgres
      // environments and we never want a broken logo from a stale ACL state.
      const isCompanyLogo = await db
        .execute(sql`SELECT 1 FROM companies WHERE logo_url = ${req.path} LIMIT 1`)
        .then((r) => r.rows.length > 0);

      if (!isCompanyLogo) {
        // Enforce ACL with the resolved identity.
        // Public objects (visibility="public") are always accessible.
        // Private objects require the caller to be the ACL owner.
        // Objects with no ACL metadata fail closed (denied).
        const canAccess = await _objStorage.canAccessObjectEntity({
          userId: callerUserId,
          objectFile,
        });
        if (!canAccess) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      await _objStorage.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error serving object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });

  registerObjectStorageRoutes(app, isAuthenticated);

  validateStripeConfig();
  fetchStripePrices().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Stripe Prices] Startup price fetch failed:", msg);
  });

  const GATE_EXEMPT_PREFIXES = [
    "/api/auth/",
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/user",
    "/api/auth/submit-verification-url",
    "/api/billing/",
    "/api/subscriptions/",
    "/api/webhooks/",
    "/api/portal/",
    "/api/password/",
    "/api/create-tenant",
    "/api/public/",
    "/api/review/",
  ];
  const GATE_READ_EXEMPT_PREFIXES = ["/api/company/stats"];

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
    const sessionUserId = req.session.userId;
    const hasApiKey = !!req.headers["x-api-key"];
    const authHeader = req.headers.authorization;
    const hasBearerToken = authHeader?.startsWith("Bearer ");
    if (!sessionUserId && !hasApiKey && !hasBearerToken) return next();
    try {
      let companyId: string | null = null;
      let resolvedUserId = sessionUserId;
      if (!resolvedUserId && hasBearerToken) {
        const token = authHeader!.substring(7);
        const sessionRow = await db.execute(
          sql`SELECT sess FROM sessions WHERE sid = ${token} AND expire > NOW()`
        );
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
        if (memberships.length > 0) {
          const pinnedId = req.session?.activeCompanyId;
          const pinned = pinnedId ? memberships.find((m) => m.companyId === pinnedId) : undefined;
          companyId = (pinned ?? memberships[0]).companyId;
        }
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
        if (
          company &&
          (company.subscriptionStatus === "suspended" || company.subscriptionStatus === "cancelled")
        ) {
          return res.status(402).json({
            error: "Account suspended",
            message: "Your subscription is inactive. Please update your billing to continue.",
            subscriptionStatus: company.subscriptionStatus,
          });
        }
        if (company && company.subscriptionStatus === "pending_approval") {
          return res.status(403).json({
            error: "Account pending approval",
            message: "Your account is under review. You will receive an email once approved.",
            subscriptionStatus: "pending_approval",
          });
        }
      }
    } catch (gateErr) {
      console.error("[SubscriptionGate] Error checking subscription status:", gateErr);
    }
    return next();
  };

  app.use("/api", subscriptionGate);
  app.use("/api", blockLeadResponseOperator);

  await registerBillingRoutes(app);
  await registerAuthRoutes(app);
  await registerOnboardingRoutes(app);
  await registerCompanyRoutes(app);
  await registerContactsRoutes(app);
  await registerPropertiesRoutes(app);
  await registerRoutePlanningRoutes(app);
  await registerServicePlansRoutes(app);
  await registerVisitsRoutes(app);
  await registerInvoicesRoutes(app);
  await registerAutomationRoutes(app);
  await registerVoiceRoutes(app);
  await registerPricingRoutes(app);
  await registerMessagesRoutes(app);
  await registerStripeRoutes(app);
  await registerQuotesRoutes(app);
  await registerPortalRoutes(app);
  await registerMiscRoutes(app);
  await registerAdminRoutes(app);
  await registerPublicRoutes(app);
  await registerIntegrationsRoutes(app);
  await registerErrorReportingRoutes(app);
  registerPlannerRoutes(app);
  await registerImportBatchesRoutes(app);
  await registerSmsAgentRoutes(app);
  await registerCrmRoutes(app);
  await registerDocumentsRoutes(app);
  registerCustomFieldsRoutes(app);
  await registerLeadResponseRoutes(app);
  await registerCalendarRoutes(app);
  await registerEmailInboundRoutes(app);
  await registerFacebookWebhookRoutes(app);

  return httpServer;
}
