import type { Express, Request, Response } from "express";
import { maskEmail, maskPhone } from "../utils/pii";
import { type Server } from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import { storage } from "../storage";
import { db } from "../db";
import { sql, eq, and, lt, gte, isNotNull, or, inArray, desc } from "drizzle-orm";
import { users, companyUsers, companies, contacts, properties, invoices, routes, DEFAULT_PRICING_CONFIG, type PricingConfig, type PricingRulesConfig, DEFAULT_PRICING_RULES, adminUsers, adminSessions, adminAuditLogs, subscriptionTiers, type Visit, reminderLogs, qboSyncLogs, servicePlans as servicePlansTable, messages as messagesTable, messages, usageEvents, auditTrail, visits, type Message, agreements as agreementsTable, jobs as jobsTable, stripeEvents, automationRules, automationEventLogs, quoteFormEvents } from "@shared/schema";
import { calculatePrice, sqftToAcres, yardSizeLabelToAcres, parseLotSizeStringToAcres, type PriceCalculatorInputs } from "../services/pricing-calculator";
import { z } from "zod";
import { registerObjectStorageRoutes, ObjectStorageService, ObjectNotFoundError } from "../replit_integrations/object_storage";
import { registerUser, loginUser, getUserById, getUserByEmail, createPasswordResetToken, resetPasswordWithToken, createUserWithTempPassword, changePassword, claimOnboardingEmailSend, resetOnboardingEmailSent } from "../services/app-auth";
import type { RequestHandler } from "express";
import { sendEmail, sendAdminSignupNotification, generateEmailThreadId, logEmailSent, buildWelcomeEmailContent } from "../services/email";
import { sendInvoiceEmail } from "../services/invoice-email";
import { getCompanyToday, getCompanyMonthStart, getCompanyMonthEnd, getCompanyWeekStart, getCompanyWeekEnd } from "../utils/company-date";
import { sendSmsForCompany, isSmsConfiguredForCompany, getFromPhoneForCompany, getCompanySmsConfig } from "../services/sms";
import {
  isStripeConfigured,
  createStripeCustomer,
  createSetupIntent,
  getCustomerPaymentMethods,
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
  createCustomerSession,
  reportRetellMinutes,
} from "../services/stripe";
import { seedRetellKnowledgeBase, provisionRetellNumber, registerRetellWebhook, checkRetellWebhookSync, getRetellAgentWebhookUrl, getAppBaseUrl } from "../services/retell";
import { checkIpRisk, getClientIp, getCountryCode } from "../services/ip-risk";
import { optimizeRoute, calculateTotalDistance, getMapboxRouteMetrics, haversineDistance, fetchMapboxDirections, getRouteMetricsWithLegs } from "../services/route-optimizer";
import { geocodeAddress, getAutocompleteCached, setAutocompleteCache } from "../services/geocode";
import { trackApiCall, getApiUsageStats } from "../services/api-usage";
import { computeInvoice } from "../invoice-engine/invoice.compute";
import { renderInvoice, loadTemplate, loadTheme, getDefaultTemplatePath, getDefaultThemePath } from "../invoice-engine/invoice.render";
import { calculateQuotePricing, renderResidentialProposalHtml, renderCommercialProposalHtml, renderQuoteSmsText, type ResidentialQuoteInput, type CommercialQuoteInput } from "../services/quote-pricing";
import { generateQuotePdf, generateQuoteDocx } from "../services/quote-document";
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
  type InsertJob,
  type InsertAgreement,
  reviewTokens,
  reviewResponses,
} from "@shared/schema";

import { isAuthenticated, isAdmin, getCompanyContext, requireRole, getBaseUrl, handleError, sanitizeDecimal, auditLog, p, computeStopHash, clearRouteOptimizationState, notify, qboAutoSync, resolveCoordinatesForAddress, createPropertyWithGeocode, getStopOnlyOnlyContactIds, escapeHtml } from "./shared";


export async function registerAutomationRoutes(app: Express): Promise<void> {
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
      if (!existing.find(r => r.id === p(req.params.id))) return res.status(404).json({ error: "Rule not found" });
      const rule = await storage.updateAutomationRule(p(req.params.id), companyId, req.body);
      res.json(rule);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/automation-rules/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      await storage.deleteAutomationRule(p(req.params.id), companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/automation-rules/:id/logs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const ruleId = p(req.params.id);
      const logs = await db
        .select()
        .from(automationEventLogs)
        .where(
          and(
            eq(automationEventLogs.companyId, companyId),
            eq(automationEventLogs.ruleId, ruleId)
          )
        )
        .orderBy(automationEventLogs.createdAt);
      res.json(logs);
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
      const existingKey = existingKeys.find(k => k.id === p(req.params.id));
      await storage.deleteApiKey(p(req.params.id), companyId);
      auditLog(companyId, userId, "api_key", p(req.params.id), "delete", { deleted: { name: existingKey?.name, keyPrefix: existingKey?.keyPrefix } }, req.ip || undefined);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  // ================ Route Day Suggestion ================

  function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function suggestServiceDay(
    companyId: string,
    lat: number,
    lng: number
  ): Promise<{ day: string; routeName: string; distanceKm: number } | null> {
    const routes = await storage.getRoutes(companyId);
    const recurringRoutes = routes.filter(r => r.dayOfWeek && !r.date);
    if (!recurringRoutes.length) return null;

    const plans = await storage.getServicePlans(companyId, { isActive: true });
    const properties = await storage.getProperties(companyId);
    const propMap = new Map(properties.map(p => [p.id, p]));

    // For each recurring route, find the distance to the nearest stop
    type DayBest = { day: string; routeName: string; distanceKm: number };
    const dayBest = new Map<string, DayBest>();

    for (const route of recurringRoutes) {
      if (!route.dayOfWeek) continue;
      const routePlans = plans.filter(sp => sp.routeId === route.id);
      for (const sp of routePlans) {
        if (!sp.propertyId) continue;
        const prop = propMap.get(sp.propertyId);
        if (!prop?.latitude || !prop?.longitude) continue;
        const km = haversineKm(lat, lng, Number(prop.latitude), Number(prop.longitude));
        const existing = dayBest.get(route.dayOfWeek);
        if (!existing || km < existing.distanceKm) {
          dayBest.set(route.dayOfWeek, { day: route.dayOfWeek, routeName: route.name || route.dayOfWeek, distanceKm: km });
        }
      }
    }

    if (!dayBest.size) {
      // No stops with coordinates — fall back to day with most stops
      const dayCounts = new Map<string, number>();
      for (const route of recurringRoutes) {
        if (!route.dayOfWeek) continue;
        const count = plans.filter(sp => sp.routeId === route.id).length;
        dayCounts.set(route.dayOfWeek, (dayCounts.get(route.dayOfWeek) || 0) + count);
      }
      if (!dayCounts.size) return null;
      const bestDay = [...dayCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const route = recurringRoutes.find(r => r.dayOfWeek === bestDay);
      return { day: bestDay, routeName: route?.name || bestDay, distanceKm: -1 };
    }

    return [...dayBest.values()].sort((a, b) => a.distanceKm - b.distanceKm)[0];
  }

  app.get("/api/routes/suggest-day", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: "lat and lng are required" });
      const result = await suggestServiceDay(companyId, lat, lng);
      res.json(result ?? null);
    } catch (err) { handleError(res, err); }
  });

}