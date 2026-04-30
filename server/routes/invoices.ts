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

import { isAuthenticated, isAdmin, getCompanyContext, requireRole, getBaseUrl, handleError, sanitizeDecimal, auditLog, p, computeStopHash, clearRouteOptimizationState, notify, qboAutoSync, resolveCoordinatesForAddress, createPropertyWithGeocode, getStopOnlyOnlyContactIds, escapeHtml, buildVisitLineItemsWithAddOns } from "./shared";


export async function registerInvoicesRoutes(app: Express): Promise<void> {
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
      const invoice = await storage.getInvoice(p(req.params.id), companyId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      const lineItems = await storage.getInvoiceLineItems(invoice.id);
      res.json({ ...invoice, lineItems });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/invoices", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const suppressNotifications = req.body.suppressNotifications === true;
      const { lineItems, taxRate, discountType, discountValue, suppressNotifications: _sn2, ...invoiceData } = req.body;

      if (!invoiceData.contactId || !invoiceData.dueDate) {
        return res.status(400).json({ error: "contactId and dueDate are required" });
      }

      const contact = await storage.getContact(invoiceData.contactId, companyId);
      if (!contact) return res.status(400).json({ error: "Contact not found in your company" });

      if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
        return res.status(400).json({ error: "At least one line item is required" });
      }

      const invoiceNumber = await storage.getNextInvoiceNumber(companyId);
      const company = await storage.getCompany(companyId);

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

      if (company?.passStripeFees) {
        const feeUnitPrice = Math.round((afterDiscount * 0.029 + 0.30) * 100) / 100;
        processedLineItems.push({
          description: "Payment Processing Fee",
          quantity: 1,
          unitPrice: feeUnitPrice.toFixed(2),
          total: feeUnitPrice.toFixed(2),
        });
        subtotal += feeUnitPrice;
      }

      const total = afterDiscount + taxAmount + (company?.passStripeFees ? (Math.round((afterDiscount * 0.029 + 0.30) * 100) / 100) : 0);

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
      if (!suppressNotifications) {
        try {
          const { fireAutomationTrigger } = await import("../services/automation-runner");
          await fireAutomationTrigger("invoice_created", companyId, { invoiceId: invoice.id, contactId: invoice.contactId, total: invoice.total });
        } catch (autoErr) { console.error("[automation] invoice_created trigger error:", autoErr); }
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
      const contact = await storage.getContact(p(req.params.id), companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
      const result = await storage.getVisitsForContact(companyId, p(req.params.id), limit, offset);
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/contacts/:id/uninvoiced-visits", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(p(req.params.id), companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const result = await storage.getUninvoicedVisitsForContact(companyId, p(req.params.id));
      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/contacts/:id/unsent-invoices", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(p(req.params.id), companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const drafts = await storage.getInvoices(companyId, { contactId: p(req.params.id), status: "draft" });
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

      for (const visitId of Array.from(newVisitIds)) {
        await storage.updateVisit(visitId as string, companyId, { invoiceId: invoice.id });
      }

      auditLog(companyId, userId, "invoice", invoice.id, "update", { action: "consolidated", consolidatedFrom: voidedIds, lineItemCount: allLineItems.length });
      res.json(invoice);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/invoices/from-visits", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const suppressNotifications = req.body.suppressNotifications === true; // reserved: no notification side effects currently in this route
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

  app.post("/api/invoices/generate-all-from-uninvoiced", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId: auditUserId } = await getCompanyContext(req);
      const suppressNotifications = req.body.suppressNotifications === true;
      const { contactIds, sendAfterGenerate, startDate, endDate } = req.body;

      const summary = await storage.getUninvoicedSummary(companyId);
      if (summary.count === 0) {
        return res.json({ created: 0, totalDollars: 0, sent: 0, failed: 0, invoices: [] });
      }

      const targetContacts = contactIds && Array.isArray(contactIds) && contactIds.length > 0
        ? summary.byContact.filter(c => contactIds.includes(c.contactId))
        : summary.byContact;

      if (targetContacts.length === 0) {
        return res.json({ created: 0, totalDollars: 0, sent: 0, failed: 0, invoices: [] });
      }

      const dueDate = (() => {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        return d.toISOString().split("T")[0];
      })();

      const createdInvoices: any[] = [];
      let sentCount = 0;
      let failedCount = 0;

      const company = sendAfterGenerate ? await storage.getCompany(companyId) : null;

      for (const contactEntry of targetContacts) {
        try {
          const result = await storage.getUninvoicedVisitsForContact(companyId, contactEntry.contactId);
          let visitsToInvoice = result.visits;

          // Filter by date range when generating by date range
          if (startDate && typeof startDate === "string") {
            visitsToInvoice = visitsToInvoice.filter(v => v.scheduledDate >= startDate);
          }
          if (endDate && typeof endDate === "string") {
            visitsToInvoice = visitsToInvoice.filter(v => v.scheduledDate <= endDate);
          }

          if (visitsToInvoice.length === 0) continue;

          const plans = await storage.getServicePlans(companyId, { contactId: contactEntry.contactId });
          const planMap = new Map(plans.map(p => [p.id, p]));

          const lineItems = await buildVisitLineItemsWithAddOns(visitsToInvoice, planMap);
          const subtotal = lineItems.reduce((sum, item) => sum + parseFloat(item.total), 0);
          const invoiceNumber = await storage.getNextInvoiceNumber(companyId);

          const invoice = await storage.createInvoiceWithLineItems({
            companyId,
            contactId: contactEntry.contactId,
            invoiceNumber,
            dueDate,
            subtotal: subtotal.toFixed(2),
            tax: "0",
            total: subtotal.toFixed(2),
            status: "draft",
            autoGenerated: true,
            paymentAttempts: 0,
          }, lineItems);

          for (const visit of visitsToInvoice) {
            await storage.updateVisit(visit.id, companyId, { invoiceId: invoice.id });
          }

          qboAutoSync(companyId, invoice.id, "invoice");
          auditLog(companyId, auditUserId, "invoice", invoice.id, "create", { new: { invoiceNumber: invoice.invoiceNumber, total: invoice.total, contactId: contactEntry.contactId, autoGenerated: true, bulk: true } }, req.ip || undefined);
          createdInvoices.push(invoice);

          if (sendAfterGenerate && !suppressNotifications) {
            try {
              const contact = await storage.getContact(contactEntry.contactId, companyId);
              if (!contact?.email) { failedCount++; continue; }

              const fromAddress = company?.email || "jeremy@scoopilot.com";
              const logoUrl = company?.logoUrl ? `${getBaseUrl(req)}${company.logoUrl}` : "";
              const properties = await storage.getProperties(companyId, contact.id);
              const serviceAddr = properties.length > 0 ? properties[0] : null;
              const taxRateNum = parseFloat(invoice.taxRate || "0") / 100;
              const discountNum = parseFloat(invoice.discountAmount || "0");

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

              let paymentUrl: string | undefined;
              if (isStripeConfigured()) {
                const invoiceTotal = parseFloat(invoice.total);
                const connectAccountId = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;
                if (invoiceTotal > 0) {
                  try {
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
                    const baseUrl = getBaseUrl(req);
                    const checkoutResult = await createCheckoutSession({
                      customerId: resolvedCustId,
                      invoiceId: invoice.id,
                      invoiceNumber: invoice.invoiceNumber,
                      amount: invoiceTotal,
                      successUrl: `${baseUrl}/portal?paid=${invoice.id}`,
                      cancelUrl: `${baseUrl}/portal`,
                      stripeConnectAccountId: connectAccountId,
                      tenantId: companyId,
                    });
                    paymentUrl = checkoutResult.url;
                  } catch {}
                } else {
                  // $0 invoice — link to tip page so customers can leave a tip
                  const baseUrl = getBaseUrl(req);
                  paymentUrl = `${baseUrl}/invoice/${invoice.id}/pay`;
                }
              }

              const invoiceData = {
                business: { name: company?.name || "", address: company?.address || "", phone: company?.phone || "", website: "", logo: logoUrl },
                invoice: {
                  number: invoice.invoiceNumber,
                  status: invoice.status || "pending",
                  issue_date: new Date(invoice.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
                  due_date: emailFormattedDueDate,
                  terms: "Net 30",
                  service_period: "",
                },
                customer: { name: `${contact.firstName} ${contact.lastName || ""}`.trim() },
                billing_address: emailBillingAddr,
                service_address: emailServiceAddr,
                show_service_address: emailShowServiceAddr ? emailServiceAddr : null,
                line_items: lineItems.map(li => ({ description: li.description, details: "", qty: li.quantity, unit_price: parseFloat(li.unitPrice), line_total: parseFloat(li.total) })),
                totals: { subtotal: parseFloat(invoice.subtotal), discount: discountNum, tax_rate: taxRateNum, paid: 0 },
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
                try { const custom = JSON.parse(company.invoiceTheme); theme = { ...defaultTheme, ...custom }; } catch {}
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
                sentBy: auditUserId,
                metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
              });

              const sendResult = await sendEmail({
                companyId,
                contactId: contact.id,
                to: contact.email,
                from: fromAddress,
                subject,
                text: textBody,
                html: renderedHtml,
                senderName: company?.name || undefined,
                replyTo: company?.email || undefined,
              });

              if (sendResult.success) {
                await storage.updateMessageStatus(msg.id, "sent");
                await storage.updateInvoice(invoice.id, companyId, { status: "sent" });
                sentCount++;
              } else {
                await storage.updateMessageStatus(msg.id, "failed", sendResult.error);
                failedCount++;
              }
            } catch (emailErr) {
              console.error(`Failed to send invoice email for contact ${contactEntry.contactId}:`, emailErr);
              failedCount++;
            }
          }
        } catch (err) {
          console.error(`Failed to generate invoice for contact ${contactEntry.contactId}:`, err);
        }
      }

      const totalDollars = createdInvoices.reduce((sum, inv) => sum + parseFloat(inv.total || "0"), 0);
      const response: Record<string, unknown> = { created: createdInvoices.length, totalDollars, invoices: createdInvoices };
      if (sendAfterGenerate) {
        response.sent = sentCount;
        response.failed = failedCount;
      }
      res.status(201).json(response);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/contacts/:id/billing-preferences", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(p(req.params.id), companyId);
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

      const updated = await storage.updateContact(p(req.params.id), companyId, {
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
      const existing = await storage.getInvoice(p(req.params.id), companyId);
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

      // Auto-set paidAt when marking as paid and not provided
      if (invoiceUpdates.status === "paid" && !invoiceUpdates.paidAt) {
        invoiceUpdates.paidAt = new Date();
      }

      // Convert any date/timestamp string fields to proper Date objects for Drizzle
      if (invoiceUpdates.paidAt && typeof invoiceUpdates.paidAt === "string") {
        invoiceUpdates.paidAt = new Date(invoiceUpdates.paidAt);
      }
      if (invoiceUpdates.lastPaymentAttempt && typeof invoiceUpdates.lastPaymentAttempt === "string") {
        invoiceUpdates.lastPaymentAttempt = new Date(invoiceUpdates.lastPaymentAttempt);
      }

      // Guard against empty-string dueDate which would fail the NOT NULL date column
      if ("dueDate" in invoiceUpdates && (invoiceUpdates.dueDate === "" || invoiceUpdates.dueDate === null || invoiceUpdates.dueDate === undefined)) {
        delete invoiceUpdates.dueDate;
      }

      if (lineItems && Array.isArray(lineItems)) {

        await storage.deleteInvoiceLineItems(p(req.params.id));

        let subtotal = 0;
        for (const item of lineItems) {
          const qty = parseInt(item.quantity) || 1;
          const unitPrice = parseFloat(item.unitPrice) || 0;
          const lineTotal = qty * unitPrice;
          subtotal += lineTotal;
          await storage.createInvoiceLineItem({
            invoiceId: p(req.params.id),
            description: item.description || "Service",
            quantity: qty,
            unitPrice: unitPrice.toFixed(2),
            total: lineTotal.toFixed(2),
            visitId: item.visitId || null,
            servicePricingId: item.servicePricingId || null,
          });
        }

        const taxRate = parseFloat(invoiceUpdates.taxRate ?? existing.taxRate ?? "0") || 0;
        const discountType = invoiceUpdates.discountType ?? existing.discountType;
        const discountVal = Math.abs(parseFloat(invoiceUpdates.discountValue ?? existing.discountValue ?? "0") || 0);
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
        const subtotal = parseFloat(existing.subtotal ?? "0") || 0;
        const taxRate = parseFloat(invoiceUpdates.taxRate ?? existing.taxRate ?? "0") || 0;
        const discountType = invoiceUpdates.discountType ?? existing.discountType;
        const discountVal = Math.abs(parseFloat(invoiceUpdates.discountValue ?? existing.discountValue ?? "0") || 0);
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

      const invoice = await storage.updateInvoice(p(req.params.id), companyId, invoiceUpdates);
      const updatedLineItems = await storage.getInvoiceLineItems(p(req.params.id));
      qboAutoSync(companyId, invoice.id, "invoice");
      if (invoiceUpdates.status === "paid") {
        qboAutoSync(companyId, invoice.id, "payment");
      }
      const { userId } = await getCompanyContext(req);
      auditLog(companyId, userId, "invoice", p(req.params.id), "update", { old: { status: existing.status, total: existing.total }, new: { status: invoice.status, total: invoice.total } }, req.ip || undefined);
      res.json({ ...invoice, lineItems: updatedLineItems });
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/invoices/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const invoice = await storage.getInvoice(p(req.params.id), companyId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.status === "paid") return res.status(400).json({ error: "Cannot delete a paid invoice" });
      await storage.deleteInvoice(p(req.params.id), companyId);
      const { userId } = await getCompanyContext(req);
      auditLog(companyId, userId, "invoice", p(req.params.id), "delete", { deleted: { invoiceNumber: invoice.invoiceNumber, total: invoice.total, status: invoice.status } }, req.ip || undefined);
      res.json({ ok: true });
    } catch (err) { handleError(res, err); }
  });

}