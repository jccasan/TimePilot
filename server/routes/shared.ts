import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { db } from "../db";
import { sql, eq, and, or } from "drizzle-orm";
import {
  users,
  companyUsers,
  companies,
  routes,
  qboSyncLogs,
  notifications,
  type InsertProperty,
} from "@shared/schema";
import { getUserById } from "../services/app-auth";
import type { RequestHandler } from "express";
import { sendEmail } from "../services/email";
import { geocodeAddress } from "../services/geocode";

// ─── Shared helpers used across all route modules ───────────────────────
export const CHANGE_PASSWORD_EXEMPT_PATHS = [
  "/api/auth/change-password",
  "/api/auth/user",
  "/api/auth/logout",
];

// Paths that API key authentication is permitted to reach.
// Everything else requires a human user session.
export const API_KEY_ALLOWED_PATH_PREFIXES = ["/api/voice/"];

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  let userId = req.session.userId;
  let authMethod = userId ? "session-cookie" : "none";
  if (!userId) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const sessionRow = await db.execute(
        sql`SELECT sess FROM sessions WHERE sid = ${token} AND expire > NOW()`
      );
      if (sessionRow.rows.length > 0) {
        const sess = sessionRow.rows[0].sess as { userId?: string };
        if (sess?.userId) {
          userId = sess.userId;
          req.session.userId = userId;
          authMethod = "bearer-token";
          // Update lastLoginAt at most once per day for bearer-token sessions so the
          // admin inactive-users dashboard reflects real activity even for users who
          // stay logged in via a long-lived session and never re-enter their password.
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          db.execute(
            sql`
            UPDATE users SET last_login_at = NOW()
            WHERE id = ${userId}
              AND (last_login_at IS NULL OR last_login_at < ${oneDayAgo})
          `
          ).catch(() => {});
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
        const isAllowedPath = API_KEY_ALLOWED_PATH_PREFIXES.some((prefix) =>
          req.path.startsWith(prefix)
        );
        if (!isAllowedPath) {
          return res.status(403).json({
            message:
              "API key access is not permitted for this endpoint. Use a user session or request the appropriate scope.",
          });
        }
        req._apiKeyAuth = {
          companyId: apiKey.companyId,
          scopes: (apiKey.scopes as string[]) ?? [],
          keyId: apiKey.id,
        };
        authMethod = "api-key";
        storage.updateApiKeyLastUsed(apiKey.id).catch(console.error);
      } else {
        return res.status(401).json({ message: "Invalid API key" });
      }
    }
  }
  if (!userId && !req._apiKeyAuth) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (authMethod !== "api-key" && userId && !CHANGE_PASSWORD_EXEMPT_PATHS.includes(req.path)) {
    const user = await getUserById(userId);
    if (user?.mustChangePassword) {
      return res.status(403).json({ error: "Password change required", mustChangePassword: true });
    }
  }
  return next();
};

export async function getCompanyContext(req: Request) {
  const apiKeyAuth = req._apiKeyAuth;
  if (apiKeyAuth) {
    return {
      userId: `apikey_${apiKeyAuth.keyId}`,
      companyId: apiKeyAuth.companyId,
      role: "api_key",
    };
  }
  const userId = req.session.userId;
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

export function requireRole(role: string, allowed: string[] = ["owner", "admin"]) {
  if (!allowed.includes(role)) {
    throw { status: 403, message: "Insufficient permissions" };
  }
}

export function requireApiKeyScope(req: Request, required: string): void {
  const apiKeyAuth = req._apiKeyAuth;
  if (!apiKeyAuth) {
    throw { status: 403, message: "Scope check requires API key authentication" };
  }
  if (!apiKeyAuth.scopes.includes(required)) {
    throw {
      status: 403,
      message: `API key missing required scope: ${required}`,
    };
  }
}

export function getBaseUrl(req: Request): string {
  const host = req.get("host") || "localhost";
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  return `${proto === "http" && !host.startsWith("localhost") ? "https" : proto}://${host}`;
}

export function handleError(res: Response, err: unknown) {
  const e = err as Record<string, unknown>;
  if (e && typeof e === "object" && typeof e.status === "number") {
    return res.status(e.status).json({ error: e.message });
  }
  if (e?.name === "ZodError" || (e?.constructor as { name?: string })?.name === "ZodError") {
    const rawIssues = (e?.issues ?? e?.errors ?? []) as Array<{
      path?: string[];
      message: string;
    }>;
    const message = rawIssues.map((i) => `${i.path?.join(".")}: ${i.message}`).join("; ");
    return res.status(400).json({ error: message || "Validation error" });
  }
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
}

export function sanitizeDecimal(value: unknown): string {
  const n = parseFloat(String(value));
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

export function auditLog(
  companyId: string,
  userId: string | null,
  entityType: string,
  entityId: string,
  action: string,
  changes?: Record<string, unknown>,
  ipAddress?: string
) {
  storage
    .createAuditEntry({
      companyId,
      userId: userId || null,
      entityType,
      entityId,
      action: action as "create" | "update" | "delete" | "void",
      changes: (changes || {}) as { old?: Record<string, unknown>; new?: Record<string, unknown> },
      ipAddress: ipAddress || null,
    })
    .catch(console.error);
}

export function p(v: string | string[]): string {
  return Array.isArray(v) ? v[0] : v;
}

export function computeStopHash(stopIds: string[]): string {
  const sorted = [...stopIds].sort().join(",");
  return crypto.createHash("sha256").update(sorted).digest("hex").substring(0, 64);
}

export async function clearRouteOptimizationState(
  routeId: string,
  companyId: string
): Promise<void> {
  try {
    await db
      .update(routes)
      .set({ lastOptimizedAt: null, optimizedStopHash: null, updatedAt: new Date() })
      .where(and(eq(routes.id, routeId), eq(routes.companyId, companyId)));
  } catch (err) {
    console.error("[route-opt] Failed to clear optimization state for route", routeId, err);
  }
}

export const EMAIL_NOTIFY_TYPES = new Set([
  "portal_message",
  "new_message",
  "service_paused",
  "service_resumed",
  "payment_failed",
  "invoice_paid",
  "new_lead",
  "general",
]);

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function notify(
  companyId: string,
  type: string,
  title: string,
  message: string,
  linkUrl?: string
) {
  storage
    .createNotification({
      companyId,
      type: type as (typeof notifications.$inferSelect)["type"],
      title,
      message,
      isRead: false,
      linkUrl: linkUrl || null,
    })
    .catch(console.error);

  if (EMAIL_NOTIFY_TYPES.has(type)) {
    (async () => {
      try {
        const ownerRows = await db
          .select({ email: users.email, firstName: users.firstName })
          .from(companyUsers)
          .innerJoin(users, eq(companyUsers.userId, users.id))
          .where(
            and(
              eq(companyUsers.companyId, companyId),
              or(eq(companyUsers.role, "owner"), eq(companyUsers.role, "admin")),
              eq(companyUsers.isActive, true)
            )
          );
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
          .filter((r) => {
            if (!r.email) return false;
            const key = r.email.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map((row) =>
            sendEmail({
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
            })
          );
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
    import("../services/webhook-dispatcher").then(({ dispatchWebhooksForEvent }) => {
      dispatchWebhooksForEvent(companyId, webhookEvent, { type, title, message, linkUrl }).catch(
        console.error
      );
    });
  }
}

export function qboAutoSync(
  companyId: string,
  entityId: string,
  type: "invoice" | "payment" | "contact"
) {
  import("../services/quickbooks")
    .then(async ({ isQboConfigured, syncInvoiceToQbo, syncPaymentToQbo, syncContactToQbo }) => {
      if (!isQboConfigured()) return;
      const company = await storage.getCompany(companyId);
      if (!company?.qboRealmId || !company?.qboAccessToken) return;
      try {
        if (type === "invoice") await syncInvoiceToQbo(companyId, entityId);
        else if (type === "payment") await syncPaymentToQbo(companyId, entityId);
        else if (type === "contact") await syncContactToQbo(companyId, entityId);
      } catch (err: unknown) {
        console.error(`[QBO auto-sync] ${type} ${entityId} failed:`, err);
        db.insert(qboSyncLogs)
          .values({
            companyId,
            entityType: type,
            entityId,
            action: "auto_sync",
            status: "error",
            errorMessage: err instanceof Error ? err.message : String(err),
          })
          .catch(console.error);
      }
    })
    .catch(console.error);
}

export async function resolveCoordinatesForAddress(
  companyId: string,
  streetAddress: string,
  city?: string | null,
  state?: string | null,
  zipCode?: string | null,
  existingProperties?: {
    streetAddress?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
    latitude?: string | null;
    longitude?: string | null;
  }[]
): Promise<{ latitude: string; longitude: string } | null> {
  const properties = existingProperties ?? (await storage.getProperties(companyId));
  const normalizedStreet = streetAddress.trim().toLowerCase();
  const match = properties.find(
    (p) =>
      p.streetAddress?.trim().toLowerCase() === normalizedStreet &&
      (p.city?.trim().toLowerCase() ?? "") === (city?.trim().toLowerCase() ?? "") &&
      (p.state?.trim().toLowerCase() ?? "") === (state?.trim().toLowerCase() ?? "") &&
      (p.zipCode?.trim() ?? "") === (zipCode?.trim() ?? "") &&
      p.latitude &&
      p.longitude
  );
  if (match) {
    return { latitude: match.latitude!, longitude: match.longitude! };
  }
  return geocodeAddress(streetAddress, city, state, zipCode);
}

export async function createPropertyWithGeocode(data: {
  companyId: string;
  contactId: string;
  streetAddress: string;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  numberOfDogs?: number | null;
  yardSize?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  gateCode?: string | null;
  specialInstructions?: string | null;
}) {
  if (!data.latitude && !data.longitude && data.streetAddress) {
    const coords = await resolveCoordinatesForAddress(
      data.companyId,
      data.streetAddress,
      data.city,
      data.state,
      data.zipCode
    );
    if (coords) {
      data.latitude = coords.latitude;
      data.longitude = coords.longitude;
    }
  }
  return storage.createProperty(data as InsertProperty);
}

export function getStopOnlyOnlyContactIds(
  activePlans: { contactId: string; isStopOnly: boolean }[]
): Set<string> {
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

// isAdmin middleware (platform-level admin auth)
export async function isAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.headers["x-admin-token"] as string;
  if (!token) return res.status(401).json({ error: "Admin authentication required" });
  const { validateAdminSession } = await import("../services/admin-auth");
  const session = await validateAdminSession(token);
  if (!session) return res.status(401).json({ error: "Invalid or expired session" });
  req.adminUser = session;
  next();
}

// ─── Cross-domain helper functions ───────────────────────────────────────────
// Defined here so they can be imported by any domain module that needs them.

export async function ensureCompanySetup(
  userId: string,
  companyName?: string
): Promise<{ companyId: string; alreadySetup: boolean }> {
  const existing = await storage.getCompaniesForUser(userId);
  if (existing.length > 0) {
    return { companyId: existing[0].companyId, alreadySetup: true };
  }
  const user = await getUserById(userId);
  const username = user
    ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || "User"
    : "User";
  const resolvedName = companyName?.trim() || `${username}'s Company`;

  const baseSlug =
    resolvedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "company";
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

export async function seedDefaultLeadSources(companyId: string): Promise<void> {
  const defaultLeadSources = [
    "Referral",
    "Nextdoor",
    "Facebook",
    "Yelp",
    "Instagram",
    "Google Ad",
    "Organic Search",
    "Bing",
    "Yard Sign",
    "Local Advertising",
  ];
  for (const name of defaultLeadSources) {
    await storage.createLeadSource({ companyId, name });
  }
}

export async function getDemoCompanyId(): Promise<string | null> {
  const row = await db.execute(sql`
    SELECT c.id FROM users u
    JOIN company_users cu ON cu.user_id = u.id
    JOIN companies c ON c.id = cu.company_id
    WHERE u.email = 'demo@scoopilot.com' LIMIT 1
  `);
  return (row.rows?.[0]?.id as string) ?? null;
}

export async function buildVisitLineItemsWithAddOns(
  visits: { id: string; scheduledDate: string; servicePlanId: string }[],
  planMap: Map<
    string,
    { pricePerVisit: string; name?: string | null; serviceName?: string | null; id: string }
  >
): Promise<
  { visitId: string; description: string; quantity: number; unitPrice: string; total: string }[]
> {
  const planAddOnsCache = new Map<string, { name: string; price: string }[]>();
  const lineItems: {
    visitId: string;
    description: string;
    quantity: number;
    unitPrice: string;
    total: string;
  }[] = [];
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
        planAddOnsCache.set(
          plan.id,
          addOns.filter((a) => a.isActive).map((a) => ({ name: a.name, price: a.price }))
        );
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

export async function validateAndResolveAddOns(addOns: unknown[], companyId: string) {
  if (!Array.isArray(addOns)) return [];
  const pricingItems = await storage.getServicePricing(companyId);
  const validAddOns: { servicePricingId: string; name: string; price: string }[] = [];
  const seen = new Set<string>();
  for (const raw of addOns) {
    const addon = raw as { servicePricingId?: string };
    if (!addon.servicePricingId || seen.has(addon.servicePricingId)) continue;
    const item = pricingItems.find(
      (p) => p.id === addon.servicePricingId && p.category === "add_on" && p.isActive
    );
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

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function suggestServiceDay(
  companyId: string,
  lat: number,
  lng: number
): Promise<{ day: string; routeName: string; distanceKm: number } | null> {
  const routes = await storage.getRoutes(companyId);
  const recurringRoutes = routes.filter((r) => r.dayOfWeek && !r.date);
  if (!recurringRoutes.length) return null;

  const plans = await storage.getServicePlans(companyId, { isActive: true });
  const properties = await storage.getProperties(companyId);
  const propMap = new Map(properties.map((p) => [p.id, p]));

  // For each recurring route, find the distance to the nearest stop
  type DayBest = { day: string; routeName: string; distanceKm: number };
  const dayBest = new Map<string, DayBest>();

  for (const route of recurringRoutes) {
    if (!route.dayOfWeek) continue;
    const routePlans = plans.filter((sp) => sp.routeId === route.id);
    for (const sp of routePlans) {
      if (!sp.propertyId) continue;
      const prop = propMap.get(sp.propertyId);
      if (!prop?.latitude || !prop?.longitude) continue;
      const km = haversineKm(lat, lng, Number(prop.latitude), Number(prop.longitude));
      const existing = dayBest.get(route.dayOfWeek);
      if (!existing || km < existing.distanceKm) {
        dayBest.set(route.dayOfWeek, {
          day: route.dayOfWeek,
          routeName: route.name || route.dayOfWeek,
          distanceKm: km,
        });
      }
    }
  }

  if (!dayBest.size) {
    // No stops with coordinates — fall back to day with most stops
    const dayCounts = new Map<string, number>();
    for (const route of recurringRoutes) {
      if (!route.dayOfWeek) continue;
      const count = plans.filter((sp) => sp.routeId === route.id).length;
      dayCounts.set(route.dayOfWeek, (dayCounts.get(route.dayOfWeek) || 0) + count);
    }
    if (!dayCounts.size) return null;
    const bestDay = [...dayCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const route = recurringRoutes.find((r) => r.dayOfWeek === bestDay);
    return { day: bestDay, routeName: route?.name || bestDay, distanceKm: -1 };
  }

  return [...dayBest.values()].sort((a, b) => a.distanceKm - b.distanceKm)[0];
}

export async function provisionPortalAccess(
  contactId: string,
  companyId: string,
  portalBaseUrl: string,
  opts?: {
    sendEmail?: boolean;
    serviceDetails?: {
      dayOfWeek?: string;
      frequency?: string;
      pricePerVisit?: string;
      nextVisitDate?: string;
    };
  }
): Promise<{ tempPassword: string; emailSent: boolean }> {
  const contact = await storage.getContact(contactId, companyId);
  if (!contact || !contact.email) return { tempPassword: "", emailSent: false };

  const tempPassword = crypto.randomBytes(4).toString("hex") + "A1!";
  const salt = crypto.randomBytes(16).toString("hex");
  const portalPasswordHash = await new Promise<string>((resolve, reject) => {
    crypto.scrypt(tempPassword, salt, 64, (err, key) => {
      if (err) return reject(err);
      resolve(`${salt}:${key.toString("hex")}`);
    });
  });

  try {
    await storage.updateContact(contactId, companyId, {
      hasPortalAccess: true,
      portalPasswordHash,
    });
  } catch (dbErr: unknown) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    const stack = dbErr instanceof Error ? dbErr.stack : undefined;
    console.error("[provisionPortalAccess] Failed to update contact:", {
      contactId,
      companyId,
      message: msg,
      stack,
    });
    throw new Error(`Failed to save portal credentials: ${msg}`);
  }

  const company = await storage.getCompany(companyId);

  // Check suppression flag — skip email if company has client notifications suppressed.
  // sendEmail: true → force send (bypasses suppression, used by batch onboarding send)
  // sendEmail: false → never send
  // sendEmail: undefined → respect suppression flag
  const shouldSend =
    opts?.sendEmail === true
      ? true
      : opts?.sendEmail === false
        ? false
        : !company?.clientNotificationsSuppressed;
  if (!shouldSend) {
    console.log(
      `[provisionPortalAccess] Email suppressed (clientNotificationsSuppressed=true) for contact ${contactId}`
    );
    return { tempPassword, emailSent: false };
  }

  const portalUrl = `${portalBaseUrl}/portal/login`;
  const serviceDetails = opts?.serviceDetails;

  const serviceSection = serviceDetails
    ? `
        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p style="margin: 0 0 10px 0; font-weight: bold; color: #166534;">Your Service Details:</p>
          ${serviceDetails.dayOfWeek ? `<p style="margin: 4px 0;">📅 <strong>Service Day:</strong> ${serviceDetails.dayOfWeek}</p>` : ""}
          ${serviceDetails.frequency ? `<p style="margin: 4px 0;">🔄 <strong>Frequency:</strong> ${serviceDetails.frequency}</p>` : ""}
          ${serviceDetails.pricePerVisit ? `<p style="margin: 4px 0;">💵 <strong>Price per Visit:</strong> $${serviceDetails.pricePerVisit}</p>` : ""}
          ${serviceDetails.nextVisitDate ? `<p style="margin: 4px 0;">📆 <strong>Next Visit:</strong> ${serviceDetails.nextVisitDate}</p>` : ""}
        </div>`
    : "";

  const serviceText = serviceDetails
    ? [
        serviceDetails.dayOfWeek ? `Service Day: ${serviceDetails.dayOfWeek}` : "",
        serviceDetails.frequency ? `Frequency: ${serviceDetails.frequency}` : "",
        serviceDetails.pricePerVisit ? `Price per Visit: $${serviceDetails.pricePerVisit}` : "",
        serviceDetails.nextVisitDate ? `Next Visit: ${serviceDetails.nextVisitDate}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const sendResult = await sendEmail({
    companyId: companyId,
    contactId: contactId,
    bypassClientSuppression: opts?.sendEmail === true,
    to: contact.email,
    subject: `Your ${company?.name || "ScooPilot"} Client Portal Access`,
    senderName: company?.name || undefined,
    replyTo: company?.email || undefined,
    text: `Hi ${contact.firstName},\n\nYou now have access to the client portal for ${company?.name || "ScooPilot"}.\n\nPortal Link: ${portalUrl}\nEmail: ${contact.email}\nTemporary Password: ${tempPassword}\n\n${serviceText ? "Your Service Details:\n" + serviceText + "\n\n" : ""}Please log in and change your password.\n\nThank you!`,
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
          ${serviceSection}
          <a href="${portalUrl}" style="display: inline-block; background-color: #2d8a5e; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; margin: 16px 0;">Log In to Portal</a>
          <p style="color: #6b7280; font-size: 14px;">Or copy this link: ${portalUrl}</p>
          <p style="color: #6b7280; font-size: 14px;">View your service schedule, invoices, and manage your account.</p>
        </div>
      </div>
    `,
  }).catch((err) => {
    console.error("Failed to send portal access email:", err);
    return { success: false as const, error: String(err), suppressed: false as const };
  });

  const emailSent = sendResult.success && !sendResult.suppressed;

  // Auto-send document signing request if enabled and active templates exist.
  if (company?.requireDocumentSigning && contact.email) {
    try {
      const templates = await storage.listDocumentTemplates(companyId);
      const activeTemplates = templates.filter((t) => t.isActive);
      if (activeTemplates.length > 0) {
        const token = crypto.randomBytes(48).toString("hex");
        await storage.createDocumentRequest({
          companyId,
          contactId,
          token,
          status: "pending",
          sentAt: new Date(),
        });

        const baseUrl = process.env.APP_BASE_URL || `https://${companyId}.scoopilot.com`;
        const signUrl = `${baseUrl}/sign/${token}`;

        await sendEmail({
          companyId,
          contactId,
          bypassClientSuppression: opts?.sendEmail === true,
          to: contact.email,
          subject: `Please sign your documents from ${company?.name || "your service provider"}`,
          senderName: company?.name || undefined,
          replyTo: company?.email || undefined,
          text: `Hi ${contact.firstName || "there"},\n\nPlease review and sign the required documents at:\n\n${signUrl}\n\nThank you!`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">${company?.name || "Document Signing"}</h1>
              </div>
              <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none;">
                <p>Hi ${contact.firstName || "there"},</p>
                <p>Please review and sign the required documents using the button below.</p>
                <div style="text-align: center; margin: 28px 0;">
                  <a href="${signUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                    Review &amp; Sign Documents
                  </a>
                </div>
                <p style="color: #6b7280; font-size: 14px;">This link is unique to you.</p>
              </div>
            </div>
          `,
        }).catch((err) => {
          console.error("[provisionPortalAccess] Failed to send document signing email:", err);
        });
      }
    } catch (signingErr) {
      console.error("[provisionPortalAccess] Error creating document signing request:", signingErr);
    }
  }

  return { tempPassword, emailSent };
}

export function normalizeQuoteFrequency(
  freq: string | null | undefined
): "weekly" | "biweekly" | "monthly" | "onetime" {
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
