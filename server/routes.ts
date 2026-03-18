import type { Express, Request, Response } from "express";
import { type Server } from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { db } from "./db";
import { sql, eq, and, lt, isNotNull, like, or, inArray, desc } from "drizzle-orm";
import { users, companyUsers, companies, contacts, properties, invoices, routes, DEFAULT_PRICING_CONFIG, type PricingConfig, adminUsers, adminSessions, adminAuditLogs, subscriptionTiers, type Visit, reminderLogs } from "@shared/schema";
import { calculatePrice, sqftToAcres, yardSizeLabelToAcres, type PriceCalculatorInputs } from "./services/pricing-calculator";
import { z } from "zod";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { registerUser, loginUser, getUserById, getUserByEmail, createPasswordResetToken, resetPasswordWithToken, createUserWithTempPassword, changePassword } from "./services/app-auth";
import type { RequestHandler } from "express";
import { sendEmail, generateInvoiceEmailHtml } from "./services/email";
import { getCompanyToday, getCompanyMonthStart, getCompanyMonthEnd, getCompanyWeekStart, getCompanyWeekEnd, getCompanyDayOfWeek } from "./utils/company-date";
import { sendSms, getTwilioPhoneNumber, isTwilioConfigured } from "./services/sms";
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
} from "./services/stripe";
import { optimizeRoute, calculateTotalDistance, getMapboxRouteMetrics, haversineDistance, fetchMapboxDirections, getRouteMetricsWithLegs } from "./services/route-optimizer";
import { geocodeAddress } from "./services/geocode";
import { computeInvoice, formatUSD } from "./invoice-engine/invoice.compute";
import { renderInvoice, loadTemplate, loadTheme, getDefaultTemplatePath, getDefaultThemePath } from "./invoice-engine/invoice.render";
import {
  TIER_CONFIG,
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
    const hasCookie = !!req.headers.cookie?.includes("connect.sid");
    const hasBearer = !!req.headers.authorization;
    const hasApiKey = !!req.headers["x-api-key"];
    console.log(`[auth] 401 on ${req.method} ${req.path} | cookie=${hasCookie} bearer=${hasBearer} apiKey=${hasApiKey} method=${authMethod} ua=${(req.headers["user-agent"] || "").substring(0, 80)}`);
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

function auditLog(companyId: string, userId: string, entityType: string, entityId: string, action: string, changes?: any, ipAddress?: string) {
  storage.createAuditEntry({ companyId, userId, entityType, entityId, action, changes: changes || {}, ipAddress: ipAddress || null }).catch(console.error);
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
          .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.role, "owner"), eq(companyUsers.isActive, true)));
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  registerObjectStorageRoutes(app, isAuthenticated);

  // ================ Geocode Proxy (Mapbox) ================

  app.get("/api/geocode/autocomplete", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const q = req.query.q as string;
      if (!q || q.length < 3) return res.json([]);

      const token = process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_SECRET_TOKEN;
      if (!token) return res.json([]);

      const params = new URLSearchParams({
        q,
        access_token: token,
        autocomplete: "true",
        country: "us",
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

      const params = new URLSearchParams({
        q,
        access_token: token,
        country: "us",
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

  // ================ Auth Routes ================

  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, firstName, lastName } = req.body;
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
      try {
        await ensureCompanySetup(result.user.id);
        setupDone = true;
      } catch (err) {
        console.error("Setup during register failed:", err);
      }

      const displayName = [firstName, lastName].filter(Boolean).join(" ") || "there";
      sendEmail({
        to: email,
        subject: "Welcome to ScooPilot",
        text: `Hi ${displayName},\n\nWelcome to ScooPilot! Your account has been created successfully.\n\nYou can now sign in and start managing your pet waste removal business.\n\nThank you for choosing ScooPilot!`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">ScooPilot</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #e5e7eb;">
              <h2 style="color: #2d8a5e;">Welcome, ${displayName}!</h2>
              <p>Your account has been created successfully.</p>
              <p>You can now sign in and start managing your pet waste removal business with ScooPilot.</p>
              <p style="margin-top: 20px; color: #6b7280; font-size: 14px;">Thank you for choosing ScooPilot!</p>
            </div>
          </div>
        `,
      }).catch((err) => console.error("Failed to send welcome email:", err));

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
      if (!checkResetRateLimit(`forgot:${ip}`, 5, 15 * 60 * 1000) ||
          !checkResetRateLimit(`forgot:${email.toLowerCase()}`, 3, 15 * 60 * 1000)) {
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
      if (!checkResetRateLimit(`reset:${ip}`, 10, 15 * 60 * 1000)) {
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

  async function ensureCompanySetup(userId: string): Promise<{ companyId: string; alreadySetup: boolean }> {
    const existing = await storage.getCompaniesForUser(userId);
    if (existing.length > 0) {
      return { companyId: existing[0].companyId, alreadySetup: true };
    }
    const user = await getUserById(userId);
    const username = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || "User" : "User";
    const company = await storage.createCompany({
      name: `${username}'s Company`,
      email: "",
      subscriptionTier: "tier_1",
      subscriptionStatus: "active",
    });
    await storage.addUserToCompany(userId, company.id, "owner");

    await seedDefaultLeadSources(company.id);

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
      const maxUsers = tierConfig[tier as keyof typeof tierConfig]?.maxUsers || 1;
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
          to: email,
          subject: `You've been invited to ${companyName} on ScooPilot`,
          text: `Hi ${firstName},\n\nYou've been added as a ${targetRole || "tech"} on ${companyName}'s ScooPilot account.\n\nLog in at: ${appUrl}\nEmail: ${email}\nTemporary Password: ${tempPassword}\n\nYou'll be asked to set a new password on your first login.\n\nFor the best experience on your phone, open the link above and install the app when prompted.`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">ScooPilot</h1>
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
          to: email,
          subject: `You've been added to ${companyName} on ScooPilot`,
          text: `Hi ${firstName},\n\nYou've been added as a ${targetRole || "tech"} on ${companyName}'s ScooPilot account. Log in with your existing credentials at: ${appUrl}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">ScooPilot</h1>
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

      res.json({ success: true, userId: existingUser.id, email, role: targetRole || "tech" });
    } catch (err) { handleError(res, err); }
  });

  // ================ Company Routes ================

  app.get("/api/company", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      res.json(company);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/company", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role, userId } = await getCompanyContext(req);
      requireRole(role);
      const existing = await storage.getCompany(companyId);
      const validTimezones = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];
      const allowed = ["name", "email", "phone", "address", "startAddress", "startLatitude", "startLongitude",
        "logoUrl", "chargeTiming", "invoiceTheme", "remindersEnabled", "autoVisitsEnabled", "dashboardLayout", "dashboardNotes", "timezone",
        "reminderSettings", "invoiceReminderSettings", "roverAiEnabled"];
      const updates: any = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      if (updates.timezone && !validTimezones.includes(updates.timezone)) {
        return res.status(400).json({ error: "Invalid timezone" });
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
      const company = await storage.updateCompany(companyId, updates);
      auditLog(companyId, userId, "company", companyId, "update", { old: existing, new: company }, req.ip);
      res.json(company);
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

      const [todaysVisits, todaysVisitsList, failedPayments, activeUsers, overdueInvoices, activeContacts, activeServicePlans, monthRevenue, smsCountThisMonth, emailCountThisMonth] = await Promise.all([
        storage.getTodaysVisitsCount(companyId, today),
        storage.getTodaysVisits(companyId, today),
        storage.getFailedPaymentsCount(companyId),
        storage.countActiveCompanyUsers(companyId),
        storage.getOverdueInvoicesCount(companyId, today),
        storage.getActiveContactsCount(companyId),
        storage.getActiveServicePlansCount(companyId),
        storage.getRevenueForPeriod(companyId, monthStart, monthEnd, tz),
        storage.getSmsCountForPeriod(companyId, monthStart, monthEnd),
        storage.getEmailCountForPeriod(companyId, monthStart, monthEnd),
      ]);

      const completedToday = todaysVisitsList.filter(v => v.status === "completed").length;
      const scheduledToday = todaysVisitsList.filter(v => v.status === "scheduled").length;
      const inProgressToday = todaysVisitsList.filter(v => v.status === "in_progress").length;

      const activePlans = await storage.getServicePlans(companyId, { isActive: true });
      let mrr = 0;
      for (const plan of activePlans) {
        const basePrice = parseFloat(plan.pricePerVisit) || 0;
        const addOns = await storage.getServicePlanAddOns(plan.id);
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
      const todayDow = new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: tz }).toLowerCase();
      const todayRoutes = routes.filter(r => (r.dayOfWeek || "").toLowerCase() === todayDow);
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
        monthRevenue,
        allVisitsForOverdue,
      ] = await Promise.all([
        storage.getServicePlans(companyId, { isActive: true }),
        storage.getUninvoicedSummary(companyId),
        storage.getTodaysVisits(companyId, today),
        storage.getRevenueForPeriod(companyId, monthStart, monthEnd, tz),
        storage.getVisits(companyId, {}),
      ]);

      const overdueVisits = allVisitsForOverdue.filter(v =>
        v.scheduledDate < today &&
        (v.status === "scheduled" || v.status === "in_progress")
      );

      const dashboardVisits = [...overdueVisits, ...todaysVisitsList];

      let activePlansMonthlyValue = 0;
      for (const plan of activePlans) {
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

      const scheduledThisWeek = allVisitsForOverdue.filter(v =>
        v.scheduledDate >= weekStartStr && v.scheduledDate <= weekEndStr &&
        (v.status === "scheduled" || v.status === "in_progress")
      ).length;

      const allInvoices = await storage.getInvoices(companyId);
      const awaitingPayment = allInvoices.filter(i => ["pending", "sent", "failed"].includes(i.status));
      const awaitingPaymentTotal = awaitingPayment.reduce((sum, i) => sum + (parseFloat(i.total) || 0), 0);

      const overdueInvoices = allInvoices.filter(i =>
        ["pending", "sent", "failed"].includes(i.status) && i.dueDate < today
      );
      const overdueTotal = overdueInvoices.reduce((sum, i) => sum + (parseFloat(i.total) || 0), 0);

      const receivablesByContact = new Map<string, { contactId: string; total: number }>();
      for (const inv of awaitingPayment) {
        const existing = receivablesByContact.get(inv.contactId) || { contactId: inv.contactId, total: 0 };
        existing.total += parseFloat(inv.total) || 0;
        receivablesByContact.set(inv.contactId, existing);
      }
      const topReceivables: { contactId: string; contactName: string; total: number }[] = [];
      const sortedReceivables = Array.from(receivablesByContact.values()).sort((a, b) => b.total - a.total).slice(0, 5);
      for (const r of sortedReceivables) {
        const contact = await storage.getContact(r.contactId, companyId);
        topReceivables.push({
          contactId: r.contactId,
          contactName: contact ? `${contact.firstName} ${contact.lastName}` : "Unknown",
          total: Math.round(r.total * 100) / 100,
        });
      }

      const allPlans = activePlans.length > 0 ? activePlans : await storage.getServicePlans(companyId, {});
      const planMap = new Map(allPlans.map(p => [p.id, p]));

      const contactIds = new Set<string>();
      const propertyIds = new Set<string>();
      for (const v of dashboardVisits) {
        const plan = planMap.get(v.servicePlanId);
        if (plan) contactIds.add(plan.contactId);
        propertyIds.add(v.propertyId);
      }

      const contactCache = new Map<string, { firstName: string; lastName: string }>();
      for (const cId of contactIds) {
        const c = await storage.getContact(cId, companyId);
        if (c) contactCache.set(cId, { firstName: c.firstName, lastName: c.lastName });
      }

      const propertyCache = new Map<string, string>();
      for (const pId of propertyIds) {
        const p = await storage.getProperty(pId, companyId);
        if (p) propertyCache.set(pId, p.streetAddress);
      }

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
          amount: plan ? parseFloat(plan.pricePerVisit) || 0 : 0,
          completedAt: v.completedAt ? v.completedAt.toISOString() : null,
          startedAt: v.startedAt ? v.startedAt.toISOString() : null,
        });
      }

      const upcomingThisWeek = allVisitsForOverdue.filter(v =>
        v.scheduledDate >= today && v.scheduledDate <= weekEndStr &&
        (v.status === "scheduled" || v.status === "in_progress")
      );
      let upcomingWeekValue = 0;
      for (const v of upcomingThisWeek) {
        const plan = planMap.get(v.servicePlanId);
        upcomingWeekValue += plan ? (parseFloat(plan.pricePerVisit) || 0) : 0;
      }

      res.json({
        activePlans: {
          count: activePlans.length,
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
          const revenue = await storage.getRevenueForPeriod(companyId, start, end, tz);
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
        const activePlans = await storage.getServicePlans(companyId, { isActive: true });
        let monthlyBookedEstimate = 0;
        for (const plan of activePlans) {
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

      const allContacts = await storage.getContacts(companyId);
      const allInvoices = await storage.getInvoices(companyId);

      // --- Monthly Revenue (last 12 months) ---
      const monthlyRevenue: { month: string; revenue: number }[] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const start = d.toISOString().split("T")[0];
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0];
        const revenue = await storage.getRevenueForPeriod(companyId, start, end, tz);
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
      const activeServicePlans = allServicePlans.filter(sp => sp.isActive);
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
      res.json(contactsList);
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
          const stripeCustomerId = await createStripeCustomer({
            email: contact.email,
            name: `${contact.firstName} ${contact.lastName}`.trim(),
            phone: contact.phone || undefined,
            metadata: { contactId: contact.id, companyId },
          });
          await storage.updateContact(contact.id, companyId, { stripeCustomerId });
        } catch (stripeErr) {
          console.error("[auto-stripe] Customer creation failed:", stripeErr);
        }
      }

      if (contact.status === "lead") {
        notify(companyId, "new_lead", "New Lead", `${contact.firstName} ${contact.lastName} was added as a new lead.`, `/contacts/${contact.id}`);
      }

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
      const contact = await storage.updateContact(req.params.id, companyId, req.body);
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

  app.post("/api/routes/:id/optimize", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const route = await storage.getRoute(req.params.id, companyId);
      if (!route) return res.status(404).json({ error: "Route not found" });

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
      const filters: { contactId?: string; propertyId?: string; isActive?: boolean } = {};
      if (req.query.contactId) filters.contactId = req.query.contactId as string;
      if (req.query.propertyId) filters.propertyId = req.query.propertyId as string;
      if (req.query.isActive !== undefined) filters.isActive = req.query.isActive === "true";
      const plans = await storage.getServicePlans(companyId, filters);
      const plansWithAddOns = await Promise.all(plans.map(async (plan) => {
        const addOns = await storage.getServicePlanAddOns(plan.id);
        return { ...plan, addOns };
      }));
      res.json(plansWithAddOns);
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

      if (!parsed.routeId && parsed.dayOfWeek) {
        const dayRoutes = await storage.getRoutes(companyId, parsed.dayOfWeek);
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
          parsed.routeId = bestRoute.id;
        }
      }

      const plan = await storage.createServicePlan(parsed);

      const contact = await storage.getContact(parsed.contactId, companyId);
      if (contact && (contact.status === "lead" || contact.status === "estimate")) {
        await storage.updateContact(parsed.contactId, companyId, { status: "active" });
      }

      if (req.body.addOns && Array.isArray(req.body.addOns)) {
        const validatedAddOns = await validateAndResolveAddOns(req.body.addOns, companyId);
        const addOns = await storage.setServicePlanAddOns(plan.id, validatedAddOns);
        return res.status(201).json({ ...plan, addOns });
      }

      res.status(201).json({ ...plan, addOns: [] });
    } catch (err) { handleError(res, err); }
  });

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
      const body = { ...req.body };
      if (body.routeId === "" || body.routeId === undefined) body.routeId = null;

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

      const { addOns: addOnsData, ...updateBody } = body;
      const plan = await storage.updateServicePlan(req.params.id, companyId, updateBody);

      if (addOnsData && Array.isArray(addOnsData)) {
        const validatedAddOns = await validateAndResolveAddOns(addOnsData, companyId);
        const addOns = await storage.setServicePlanAddOns(req.params.id, validatedAddOns);
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
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  // ================ Jobs API (thin wrappers over service_plans) ================

  app.get("/api/jobs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const filters: any = {};
      if (req.query.contactId) filters.contactId = req.query.contactId as string;
      if (req.query.propertyId) filters.propertyId = req.query.propertyId as string;
      if (req.query.isActive !== undefined) filters.isActive = req.query.isActive === "true";
      const plans = await storage.getServicePlans(companyId, filters);
      const jobStatus = req.query.jobStatus as string | undefined;
      const jobType = req.query.jobType as string | undefined;
      let filtered = plans;
      if (jobStatus) filtered = filtered.filter(p => p.jobStatus === jobStatus);
      if (jobType) filtered = filtered.filter(p => p.jobType === jobType);
      res.json(filtered);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/jobs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const body = { ...req.body, companyId };
      if (!body.routeId || body.routeId === "") body.routeId = null;
      if (!body.jobType) body.jobType = body.frequency === "onetime" ? "one_off" : "recurring";
      if (!body.jobStatus) body.jobStatus = "draft";
      if (body.anytime === undefined) body.anytime = true;
      body.isActive = body.jobStatus === "active";

      const parsed = insertServicePlanSchema.parse(body);
      const job = await storage.createServicePlan(parsed);

      res.status(201).json(job);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/jobs/:id/approve", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const job = await storage.getServicePlan(req.params.id, companyId);
      if (!job) return res.status(404).json({ error: "Job not found" });
      if (job.jobStatus !== "draft") {
        return res.status(400).json({ error: `Cannot approve a job with status '${job.jobStatus}'` });
      }

      const updated = await storage.updateServicePlan(job.id, companyId, {
        jobStatus: "active",
        isActive: true,
      });

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
      const { zipCode, dayOfWeek, label, latitude, longitude } = req.body;
      if (!zipCode) return res.status(400).json({ error: "zipCode is required" });
      const zone = await storage.createServiceZone({
        companyId,
        zipCode,
        dayOfWeek: dayOfWeek || "tbd",
        label: label || null,
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
      const { dayOfWeek, label, isActive } = req.body;
      const updates: any = {};
      if (dayOfWeek !== undefined) updates.dayOfWeek = dayOfWeek;
      if (label !== undefined) updates.label = label;
      if (isActive !== undefined) updates.isActive = isActive;
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
          servicePlanName: plan?.frequency ? `${plan.frequency} service` : null,
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
        completed: [],
        skipped: [],
        cancelled: [],
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
                const pricePerVisit = parseFloat(plan.pricePerVisit);
                const subtotal = pricePerVisit;
                const total = subtotal;
                const autoInvoice = await storage.createInvoiceWithLineItems({
                  companyId,
                  contactId: plan.contactId,
                  invoiceNumber,
                  dueDate: new Date().toISOString().split("T")[0],
                  subtotal: subtotal.toFixed(2),
                  tax: "0",
                  total: total.toFixed(2),
                  status: "draft",
                  autoGenerated: true,
                  paymentAttempts: 0,
                }, [{
                  visitId: visit.id,
                  description: `Service on ${visit.scheduledDate}`,
                  quantity: 1,
                  unitPrice: pricePerVisit.toFixed(2),
                  total: pricePerVisit.toFixed(2),
                }]);
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
            const pricePerVisit = parseFloat(plan.pricePerVisit);
            const autoInv = await storage.createInvoiceWithLineItems({
              companyId,
              contactId: plan.contactId,
              invoiceNumber,
              dueDate: new Date().toISOString().split("T")[0],
              subtotal: pricePerVisit.toFixed(2),
              tax: "0",
              total: pricePerVisit.toFixed(2),
              status: "draft",
              autoGenerated: true,
              paymentAttempts: 0,
            }, [{
              visitId: visit.id,
              description: `Service on ${visit.scheduledDate}`,
              quantity: 1,
              unitPrice: pricePerVisit.toFixed(2),
              total: pricePerVisit.toFixed(2),
            }]);
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

      if (contact.phone && isTwilioConfigured()) {
        const completionMsg = `Hi ${contact.firstName}. ${company.name} just finished your poop scoop service. Here is your gate closed image. Let us know if there is anything we can do.`;
        completionSmsResult = await sendSms({
          to: contact.phone,
          body: completionMsg,
          mediaUrl: gatePhotoFullUrl,
        });

        if (completionSmsResult.success) {
          await storage.createMessage({
            companyId,
            contactId: contact.id,
            channel: "sms",
            direction: "outbound",
            status: "sent",
            fromAddress: getTwilioPhoneNumber(),
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

              if (nextContact?.phone && currentProperty && nextProperty && isTwilioConfigured()) {
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

                etaSmsResult = await sendSms({
                  to: nextContact.phone,
                  body: etaMsg,
                });

                if (etaSmsResult.success) {
                  await storage.createMessage({
                    companyId,
                    contactId: nextContact.id,
                    channel: "sms",
                    direction: "outbound",
                    status: "sent",
                    fromAddress: getTwilioPhoneNumber(),
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
      const planPrices: Record<string, number> = {};
      for (const p of plans) {
        planPrices[p.id] = parseFloat(p.pricePerVisit);
      }

      const lineItems = billableVisits.map(v => ({
        visitId: v.id,
        description: `Service on ${v.scheduledDate}`,
        quantity: 1,
        unitPrice: (planPrices[v.servicePlanId] || 0).toFixed(2),
        total: (planPrices[v.servicePlanId] || 0).toFixed(2),
      }));

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
        status: "pending",
        autoGenerated: true,
        paymentAttempts: 0,
      }, lineItems);

      for (const v of billableVisits) {
        await storage.updateVisit(v.id, companyId, { invoiceId: invoice.id });
      }

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

      const lineItems: { visitId: string; description: string; quantity: number; unitPrice: string; total: string }[] = [];
      for (const visit of allVisits) {
        const plan = planMap.get(visit.servicePlanId);
        const unitPrice = plan ? plan.pricePerVisit : "0";
        lineItems.push({
          visitId: visit.id,
          description: `${plan ? plan.name + ' - ' : ''}Service on ${visit.scheduledDate}`,
          quantity: 1,
          unitPrice: unitPrice.toString(),
          total: unitPrice.toString(),
        });
      }

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
        status: "pending",
        autoGenerated: false,
        paymentAttempts: 0,
      }, lineItems);

      for (const visit of allVisits) {
        await storage.updateVisit(visit.id, companyId, { invoiceId: invoice.id });
      }

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
      res.json({ ...invoice, lineItems: updatedLineItems });
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

      res.status(201).json({ ...apiKey, rawKey });
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/api-keys/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      await storage.deleteApiKey(req.params.id, companyId);
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
      const existing = await storage.getWebhooks(companyId);
      if (!existing.find(w => w.id === req.params.id)) return res.status(404).json({ error: "Webhook not found" });
      const webhook = await storage.updateWebhook(req.params.id, companyId, req.body);
      res.json(webhook);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/webhooks/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      await storage.deleteWebhook(req.params.id, companyId);
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
      const parsed = insertServicePricingSchema.parse({ ...req.body, companyId });
      const item = await storage.createServicePricingItem(parsed);
      res.status(201).json(item);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/pricing/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const parsed = insertServicePricingSchema.partial().parse(req.body);
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
      const config = { ...DEFAULT_PRICING_CONFIG, ...(company.pricingConfig || {}) };
      res.json(config);
    } catch (err) { handleError(res, err); }
  });

  const pricingConfigSchema = z.object({
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
      const config = pricingConfigSchema.parse(req.body);
      const merged = { ...DEFAULT_PRICING_CONFIG, ...config };
      await storage.updateCompany(companyId, { pricingConfig: merged } as any);
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
        if (!plan.routeId) continue;
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

  // ================ Messages / Communications ================

  app.get("/api/messages", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const filters: { contactId?: string; channel?: string; direction?: string } = {};
      if (req.query.contactId) filters.contactId = req.query.contactId as string;
      if (req.query.channel) filters.channel = req.query.channel as string;
      if (req.query.direction) filters.direction = req.query.direction as string;
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

  app.post("/api/messages/email", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const { contactId, to, subject, body, htmlBody } = req.body;
      if (!to || !subject || !body) {
        return res.status(400).json({ error: "to, subject, and body are required" });
      }

      if (contactId) {
        const contact = await storage.getContact(contactId, companyId);
        if (!contact) return res.status(400).json({ error: "Contact not found in your company" });
      }

      const company = await storage.getCompany(companyId);
      const fromAddress = company?.email || "jeremy@scoopilot.com";

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
      });

      const result = await sendEmail({ to, from: fromAddress, subject, text: body, html: htmlBody || body });

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
      const { contactId, to, body } = req.body;
      if (!to || !body) {
        return res.status(400).json({ error: "to and body are required" });
      }

      if (contactId) {
        const contact = await storage.getContact(contactId, companyId);
        if (!contact) return res.status(400).json({ error: "Contact not found in your company" });
      }

      const fromPhone = getTwilioPhoneNumber();

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
      });

      const result = await sendSms({ to, body });

      if (result.success) {
        const updated = await storage.updateMessageStatus(msg.id, "sent");
        res.json(updated);
      } else {
        const updated = await storage.updateMessageStatus(msg.id, "failed", result.error);
        res.status(500).json({ error: result.error, message: updated });
      }
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/messages/config", isAuthenticated, async (_req: Request, res: Response) => {
    res.json({
      email: { configured: !!process.env.SENDGRID_API_KEY },
      sms: { configured: isTwilioConfigured(), phoneNumber: getTwilioPhoneNumber() },
    });
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
          toAddress: getTwilioPhoneNumber(),
          body: Body,
          externalId: MessageSid,
        });

        if (matchedContact) {
          notify(companyId, "new_message", "New Text Message", `${matchedContact.firstName} ${matchedContact.lastName} sent a text message.`, `/contacts/${matchedContact.id}`);
        }
      }

      res.type("text/xml").send("<Response></Response>");
    } catch (err) {
      console.error("Twilio webhook error:", err);
      res.type("text/xml").send("<Response></Response>");
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
          if (!stripeCustomerId) {
            stripeCustomerId = await createStripeCustomer({
              email: contact.email || undefined,
              name: `${contact.firstName} ${contact.lastName}`.trim(),
              metadata: { contactId: contact.id, companyId },
            });
            await storage.updateContact(contact.id, companyId, { stripeCustomerId });
          }

          const baseUrl = getBaseUrl(req);
          const checkoutResult = await createCheckoutSession({
            customerId: stripeCustomerId,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            amount: parseFloat(invoice.total),
            successUrl: `${baseUrl}/portal?paid=${invoice.id}`,
            cancelUrl: `${baseUrl}/portal`,
            stripeConnectAccountId: company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null,
          });
          paymentUrl = checkoutResult.url;
        } catch (stripeErr) {
          console.log("[send-email] Could not generate Stripe checkout URL, sending without payment link:", stripeErr);
        }
      }

      const emailContent = generateInvoiceEmailHtml({
        companyName: company?.name || "ScooPilot",
        contactName: `${contact.firstName} ${contact.lastName}`.trim(),
        invoiceNumber: invoice.invoiceNumber,
        dueDate: invoice.dueDate,
        total: invoice.total,
        lineItems: lineItems.map(li => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          total: li.total,
        })),
        paymentUrl,
      });

      const fromAddress = company?.email || "jeremy@scoopilot.com";

      const msg = await storage.createMessage({
        companyId,
        contactId: contact.id,
        channel: "email",
        direction: "outbound",
        status: "queued",
        fromAddress,
        toAddress: contact.email,
        subject: emailContent.subject,
        body: emailContent.text,
        htmlBody: emailContent.html,
        sentBy: userId,
        metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
      });

      console.log(`[send-email] Sending invoice ${invoice.invoiceNumber} to ${contact.email} from ${fromAddress}`);
      const result = await sendEmail({
        to: contact.email,
        from: fromAddress,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
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

      const stripeCustomerId = await createStripeCustomer({
        email: contact.email || undefined,
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        phone: contact.phone || undefined,
        metadata: { contactId: contact.id, companyId },
      });

      await storage.updateContact(req.params.id, companyId, { stripeCustomerId });
      res.json({ stripeCustomerId, alreadyExists: false });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/contacts/:id/setup-intent", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      if (!contact.stripeCustomerId) return res.status(400).json({ error: "Contact has no Stripe customer. Create one first." });

      const result = await createSetupIntent(contact.stripeCustomerId);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/contacts/:id/payment-methods", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      if (!contact.stripeCustomerId) return res.json([]);

      const methods = await getCustomerPaymentMethods(contact.stripeCustomerId);
      res.json(methods);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/payment-methods/:pmId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      await getCompanyContext(req);
      await detachPaymentMethod(req.params.pmId);
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
      const result = await chargeInvoiceAutomatically({
        customerId: contact.stripeCustomerId,
        amount: parseFloat(invoice.total),
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        stripeConnectAccountId: company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null,
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
      } else {
        updateData.status = "failed";
        if (result.paymentIntentId) updateData.stripePaymentIntentId = result.paymentIntentId;
        notify(companyId, "payment_failed", "Payment Failed", `Payment failed for invoice #${invoice.invoiceNumber}.`, `/invoices`);
      }

      const updated = await storage.updateInvoice(invoice.id, companyId, updateData);
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

      let stripeCustomerId = contact.stripeCustomerId;
      if (!stripeCustomerId) {
        stripeCustomerId = await createStripeCustomer({
          email: contact.email || undefined,
          name: `${contact.firstName} ${contact.lastName}`.trim(),
          metadata: { contactId: contact.id, companyId },
        });
        await storage.updateContact(contact.id, companyId, { stripeCustomerId });
      }

      const baseUrl = getBaseUrl(req);
      const company = await storage.getCompany(companyId);
      const result = await createCheckoutSession({
        customerId: stripeCustomerId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        amount: parseFloat(invoice.total),
        successUrl: `${baseUrl}/invoices?paid=${invoice.id}`,
        cancelUrl: `${baseUrl}/invoices`,
        stripeConnectAccountId: company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null,
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
      const { companyId } = await getCompanyContext(req);
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
      const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!sig || !endpointSecret) {
        return res.status(400).json({ error: "Missing signature or webhook secret" });
      }

      let event;
      try {
        const rawBody = (req as any).rawBody || JSON.stringify(req.body);
        event = constructWebhookEvent(rawBody, sig, endpointSecret);
      } catch (err: any) {
        console.error("Stripe webhook signature verification failed:", err.message);
        return res.status(400).json({ error: "Webhook signature verification failed" });
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as any;
        const invoiceId = session.metadata?.invoiceId;
        if (invoiceId) {
          const tipAmount = session.metadata?.tipAmount || "0";
          const allCompanies = await storage.listCompanies();
          for (const company of allCompanies) {
            const invoice = await storage.getInvoice(invoiceId, company.id);
            if (invoice && invoice.status !== "paid") {
              await storage.updateInvoice(invoiceId, company.id, {
                status: "paid",
                paidAt: new Date(),
                stripePaymentIntentId: session.payment_intent,
                tipAmount,
              });
              const tipNote = parseFloat(tipAmount) > 0 ? ` (includes $${tipAmount} tip)` : "";
              notify(company.id, "invoice_paid", "Invoice Paid", `Invoice #${invoice.invoiceNumber} has been paid ($${invoice.total})${tipNote}.`, `/invoices`);
              break;
            }
          }
        }
      }

      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object as any;
        const invoiceId = pi.metadata?.invoiceId;
        if (invoiceId) {
          const allCompanies = await storage.listCompanies();
          for (const company of allCompanies) {
            const invoice = await storage.getInvoice(invoiceId, company.id);
            if (invoice && invoice.status !== "paid") {
              await storage.updateInvoice(invoiceId, company.id, {
                status: "paid",
                paidAt: new Date(),
                stripePaymentIntentId: pi.id,
              });
              notify(company.id, "invoice_paid", "Invoice Paid", `Invoice #${invoice.invoiceNumber} has been paid ($${invoice.total}).`, `/invoices`);
              break;
            }
          }
        }
      }

      if (event.type === "account.updated") {
        const account = event.data.object as any;
        const accountId = account.id;
        if (accountId) {
          const allCompanies = await storage.listCompanies();
          for (const company of allCompanies) {
            if (company.stripeConnectAccountId === accountId) {
              const isOnboarded = account.charges_enabled === true;
              if (isOnboarded !== company.stripeConnectOnboarded) {
                await storage.updateCompany(company.id, { stripeConnectOnboarded: isOnboarded } as any);
                console.log(`[Stripe Connect] Company ${company.name} (${company.id}) onboarded=${isOnboarded}`);
              }
              break;
            }
          }
        }
      }

      if (event.type === "payment_intent.payment_failed") {
        const pi = event.data.object as any;
        const invoiceId = pi.metadata?.invoiceId;
        if (invoiceId) {
          const allCompanies = await storage.listCompanies();
          for (const company of allCompanies) {
            const invoice = await storage.getInvoice(invoiceId, company.id);
            if (invoice) {
              await storage.updateInvoice(invoiceId, company.id, {
                status: "failed",
                paymentAttempts: (invoice.paymentAttempts || 0) + 1,
                lastPaymentAttempt: new Date(),
              });
              break;
            }
          }
        }
      }

      res.json({ received: true });
    } catch (err) {
      console.error("Stripe webhook error:", err);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // ================ Client Portal Routes ================

  app.post("/api/portal/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const allCompanies = await storage.listCompanies();
      let foundContact = null;
      for (const company of allCompanies) {
        const companyContacts = await storage.getContacts(company.id, { search: email });
        const match = companyContacts.find(
          (c) => c.email?.toLowerCase() === email.toLowerCase() && c.hasPortalAccess && c.portalPasswordHash
        );
        if (match) {
          foundContact = match;
          break;
        }
      }

      if (!foundContact || !foundContact.portalPasswordHash) {
        return res.status(401).json({ error: "Invalid email or password" });
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
          (c) => c.email?.toLowerCase() === normalizedEmail && c.hasPortalAccess && c.portalPasswordHash
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
        to: foundContact.email!,
        subject: `Reset your ${companyName} portal password`,
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
      res.json(invoicesList.map((inv) => ({
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

      const tipAmount = Math.round(parseFloat(req.body?.tipAmount || "0") * 100) / 100;
      if (isNaN(tipAmount) || tipAmount < 0) return res.status(400).json({ error: "Invalid tip amount" });
      if (tipAmount > 500) return res.status(400).json({ error: "Tip amount exceeds maximum" });

      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      let stripeCustomerId = contact.stripeCustomerId;
      if (!stripeCustomerId) {
        stripeCustomerId = await createStripeCustomer({
          email: contact.email || undefined,
          name: `${contact.firstName} ${contact.lastName}`.trim(),
          metadata: { contactId: contact.id, companyId },
        });
        await storage.updateContact(contact.id, companyId, { stripeCustomerId });
      }

      const chargeAmount = parseFloat(invoice.total) + tipAmount;
      const baseUrl = getBaseUrl(req);
      const company = await storage.getCompany(companyId);
      const result = await createCheckoutSession({
        customerId: stripeCustomerId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        amount: chargeAmount,
        successUrl: `${baseUrl}/portal/client?paid=${invoice.id}`,
        cancelUrl: `${baseUrl}/portal/client`,
        tipAmount: tipAmount.toFixed(2),
        stripeConnectAccountId: company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null,
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
          to: pendingEmailChange,
          subject: `Verify your new email address - ${companyName}`,
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

      let stripeCustomerId = contact.stripeCustomerId;
      if (!stripeCustomerId) {
        stripeCustomerId = await createStripeCustomer({
          email: contact.email || undefined,
          name: `${contact.firstName} ${contact.lastName}`.trim(),
          metadata: { contactId: contact.id, companyId },
        });
        await storage.updateContact(contact.id, companyId, { stripeCustomerId });
      }

      const baseUrl = getBaseUrl(req);
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2025-04-30.basil" });
      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: "setup",
        payment_method_types: ["card"],
        success_url: `${baseUrl}/portal/client?card_added=1`,
        cancel_url: `${baseUrl}/portal/client`,
      });

      res.json({ url: session.url });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/portal/payment-methods", async (req: Request, res: Response) => {
    try {
      const { contactId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      if (!contact.stripeCustomerId) return res.json({ methods: [], autoPayEnabled: contact.autoPayEnabled });

      const methods = await getCustomerPaymentMethods(contact.stripeCustomerId);
      res.json({ methods, autoPayEnabled: contact.autoPayEnabled });
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/portal/payment-methods/:id", async (req: Request, res: Response) => {
    try {
      const { contactId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact?.stripeCustomerId) return res.status(400).json({ error: "No payment methods on file" });

      const methods = await getCustomerPaymentMethods(contact.stripeCustomerId);
      const owns = methods.some((m) => m.id === req.params.id);
      if (!owns) return res.status(403).json({ error: "Payment method not found" });

      await detachPaymentMethod(req.params.id);
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
          notify(companyId, "general", "Draft Job Created from Estimate", `${contactName} approved estimate "${estimate.description}". A draft job has been created — review and approve the schedule.`, `/jobs`);
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
          to: contact.email,
          subject: `New Estimate from ${company?.name || "Your Service Provider"}`,
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

  // Admin route: generate portal invite link
  app.post("/api/contacts/:id/portal-access", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      if (!contact.email) return res.status(400).json({ error: "Contact must have an email address to enable portal access" });

      const tempPassword = crypto.randomBytes(4).toString("hex") + "A1!";
      const salt = crypto.randomBytes(16).toString("hex");
      const portalPasswordHash = await new Promise<string>((resolve, reject) => {
        crypto.scrypt(tempPassword, salt, 64, (err, key) => {
          if (err) reject(err);
          resolve(`${salt}:${key.toString("hex")}`);
        });
      });

      await storage.updateContact(req.params.id, companyId, { hasPortalAccess: true, portalPasswordHash });

      const company = await storage.getCompany(companyId);
      const portalUrl = `${getBaseUrl(req)}/portal/login`;
      sendEmail({
        to: contact.email,
        subject: `Your ${company?.name || "ScooPilot"} Client Portal Access`,
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
        to: contact.email,
        subject: `Your ${company?.name || "ScooPilot"} Portal Login`,
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
            to: contact.email,
            subject: `Your ${company?.name || "ScooPilot"} Portal Login`,
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
      const allowed = ["primaryColor", "accentColor", "textColor", "mutedColor", "borderColor", "backgroundColor", "cardColor", "fontFamily", "logoSize", "borderRadius"];
      const filtered: any = {};
      for (const key of allowed) {
        if (theme[key] !== undefined) filtered[key] = theme[key];
      }
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
      const invoiceData: any = {
        business: {
          name: company?.name || "",
          address: company?.address || "",
          phone: company?.phone || "",
          email: company?.email || "",
          website: "",
          logo: logoUrl,
        },
        invoice: {
          number: invoice.invoiceNumber,
          status: statusRaw,
          issue_date: new Date(invoice.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
          due_date: invoice.dueDate,
          terms: "Net 30",
          service_period: "",
        },
        customer: {
          name: `${contact.firstName} ${contact.lastName || ""}`.trim(),
          email: contact.email || "",
          phone: contact.phone || "",
        },
        billing_address: contact.address ? {
          line1: contact.address,
          line2: "",
          city: "",
          state: "",
          zip: "",
        } : null,
        service_address: serviceAddr ? {
          line1: serviceAddr.street || "",
          line2: "",
          city: serviceAddr.city || "",
          state: serviceAddr.state || "",
          zip: serviceAddr.zip || "",
        } : null,
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
        visits: [],
        notes: "",
        payment_instructions: "",
        thank_you: "Thank you for your business!",
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
      const enriched = await Promise.all(allCompanies.map(async (c) => {
        const users = await storage.getCompanyUsers(c.id);
        const contactList = await storage.getContacts(c.id);
        return { ...c, userCount: users.length, contactCount: contactList.length };
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

  app.patch("/api/admin/companies/:id/subscription", isAdmin, async (req: Request, res: Response) => {
    try {
      const { tier } = req.body;
      const validTiers = ["free_trial", "tier_1", "tier_1_3", "tier_3_5", "tier_6_10", "tier_10_plus"];
      if (!tier || !validTiers.includes(tier)) return res.status(400).json({ error: "Invalid tier" });
      const updated = await storage.updateCompanySubscription(req.params.id, tier);
      await logAdminAudit(req, "change_subscription", "company", req.params.id, { tier });
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
          isActive: true,
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
      const { companyId } = getCompanyContext(req);
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
      const { companyId } = getCompanyContext(req);
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
      const { companyId } = getCompanyContext(req);
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
      const { companyId } = getCompanyContext(req);
      const importRun = await storage.getImportRun(req.params.id, companyId);
      if (!importRun) return res.status(404).json({ error: "Import run not found" });
      res.json(importRun);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/invoices/:id/payments", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = getCompanyContext(req);
      const invoice = await storage.getInvoice(req.params.id, companyId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      const payments = await storage.getInvoicePayments(req.params.id);
      res.json(payments);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/imports/ai-map", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = getCompanyContext(req);
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
      const { companyId } = getCompanyContext(req);
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
      const { companyId } = getCompanyContext(req);
      const runs = await storage.getImportRuns(companyId);
      res.json(runs);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/imports/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = getCompanyContext(req);
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
    max: 5,
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

        const [txCompany] = await tx.insert((await import("@shared/schema")).companies).values({
          name: record.companyName,
          email: record.email,
          subscriptionTier: "free_trial",
          subscriptionStatus: "trialing",
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

  const { registerAdminAnalyticsRoutes } = await import("./admin-analytics");
  registerAdminAnalyticsRoutes(app, isAdmin);

  import("./jobs/nightly-rollup").then(({ runNightlyRollup }) => {
    setTimeout(() => runNightlyRollup().catch(console.error), 30000);
    setInterval(() => runNightlyRollup().catch(console.error), 24 * 60 * 60 * 1000);
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

  return httpServer;
}
