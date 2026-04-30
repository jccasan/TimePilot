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


export async function registerPropertiesRoutes(app: Express): Promise<void> {
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
      const property = await storage.getProperty(p(req.params.id), companyId);
      if (!property) return res.status(404).json({ error: "Property not found" });
      res.json(property);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/properties", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const parsed = insertPropertySchema.parse({ ...req.body, companyId });
      let geocodeFailed = false;
      if (!parsed.latitude && !parsed.longitude && parsed.streetAddress) {
        const coords = await geocodeAddress(parsed.streetAddress, parsed.city, parsed.state, parsed.zipCode);
        if (coords) {
          (parsed as any).latitude = coords.latitude;
          (parsed as any).longitude = coords.longitude;
        } else {
          geocodeFailed = true;
        }
      }
      const property = await storage.createProperty(parsed);
      res.status(201).json({ ...property, geocodeFailed });
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/properties/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getProperty(p(req.params.id), companyId);
      if (!existing) return res.status(404).json({ error: "Property not found" });
      const addressChanged =
        (req.body.streetAddress !== undefined && req.body.streetAddress !== existing.streetAddress) ||
        (req.body.city !== undefined && req.body.city !== existing.city) ||
        (req.body.state !== undefined && req.body.state !== existing.state) ||
        (req.body.zipCode !== undefined && req.body.zipCode !== existing.zipCode);
      const updateData = { ...req.body };
      let geocodeFailed = false;
      if (addressChanged) {
        const merged = {
          streetAddress: req.body.streetAddress ?? existing.streetAddress,
          city: req.body.city ?? existing.city,
          state: req.body.state ?? existing.state,
          zipCode: req.body.zipCode ?? existing.zipCode,
        };
        if (merged.streetAddress) {
          const coords = await geocodeAddress(merged.streetAddress, merged.city, merged.state, merged.zipCode);
          if (coords) {
            updateData.latitude = coords.latitude;
            updateData.longitude = coords.longitude;
          } else {
            geocodeFailed = true;
          }
        }
      }
      const property = await storage.updateProperty(p(req.params.id), companyId, updateData);
      res.json({ ...property, geocodeFailed });
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
        const coords = await resolveCoordinatesForAddress(companyId, prop.streetAddress!, prop.city, prop.state, prop.zipCode, allProperties);
        if (coords) {
          await storage.updateProperty(prop.id, companyId, { latitude: coords.latitude, longitude: coords.longitude });
          prop.latitude = coords.latitude;
          prop.longitude = coords.longitude;
          geocoded++;
        }
      }
      res.json({ total: allProperties.length, needsGeocode: needsGeocode.length, geocoded });
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/properties/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getProperty(p(req.params.id), companyId);
      if (!existing) return res.status(404).json({ error: "Property not found" });
      await storage.deleteProperty(p(req.params.id), companyId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

}