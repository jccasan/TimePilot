import type { Express, Request, Response } from "express";
import { type Server } from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth";
import { authStorage } from "./replit_integrations/auth/storage";
import { registerAuthRoutes } from "./replit_integrations/auth";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { sendEmail, generateInvoiceEmailHtml } from "./services/email";
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
} from "./services/stripe";
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

async function getCompanyContext(req: Request) {
  const userId = (req as any).user?.claims?.sub;
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

function handleError(res: Response, err: any) {
  if (err && typeof err === "object" && "status" in err) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  registerAuthRoutes(app);
  registerObjectStorageRoutes(app);

  // ================ Setup / Onboarding ================

  app.post("/api/setup", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      const username = (req as any).user?.claims?.name || "User";
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const existing = await storage.getCompaniesForUser(userId);
      if (existing.length > 0) {
        return res.json({ companyId: existing[0].companyId, alreadySetup: true });
      }

      const company = await storage.createCompany({
        name: `${username}'s Company`,
        email: "",
        subscriptionTier: "tier_1",
        subscriptionStatus: "active",
      });
      await storage.addUserToCompany(userId, company.id, "owner");
      return res.json({ companyId: company.id, alreadySetup: false, created: true });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/onboarding/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contactsList = await storage.getContacts(companyId);
      const routesList = await storage.getRoutes(companyId);
      const plansList = await storage.getServicePlans(companyId);

      const hasContacts = contactsList.length > 0;
      const hasRoutes = routesList.length > 0;
      const hasServicePlans = plansList.length > 0;

      const steps = [
        { key: "contact", label: "Add your first client", completed: hasContacts },
        { key: "route", label: "Create a route", completed: hasRoutes },
        { key: "service_plan", label: "Set up a service plan", completed: hasServicePlans },
      ];

      const isComplete = steps.every(s => s.completed);
      res.json({ isComplete, steps, totalContacts: contactsList.length, totalRoutes: routesList.length, totalServicePlans: plansList.length });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/company/invite", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const { userId: targetUserId, targetRole } = req.body;
      if (!targetUserId) return res.status(400).json({ error: "userId is required" });
      const validRoles = ["admin", "tech"];
      if (!validRoles.includes(targetRole || "tech")) {
        return res.status(400).json({ error: "Invalid role" });
      }
      const existingMembership = await storage.getCompanyUser(companyId, targetUserId);
      if (existingMembership) {
        return res.status(409).json({ error: "User is already a member" });
      }
      const cu = await storage.addUserToCompany(targetUserId, companyId, targetRole || "tech");
      res.json(cu);
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
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const company = await storage.updateCompany(companyId, req.body);
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
          const user = await authStorage.getUser(cu.userId);
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

  app.post("/api/company/users", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const cu = await storage.createCompanyUser({ ...req.body, companyId });
      res.status(201).json(cu);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/company/stats", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const tier = company.subscriptionTier as keyof typeof TIER_CONFIG;
      const tierInfo = TIER_CONFIG[tier];
      const mrr = tierInfo?.price ?? 0;

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

      const [todaysVisits, todaysVisitsList, failedPayments, activeUsers, overdueInvoices, activeContacts, activeServicePlans, monthRevenue] = await Promise.all([
        storage.getTodaysVisitsCount(companyId),
        storage.getTodaysVisits(companyId),
        storage.getFailedPaymentsCount(companyId),
        storage.countActiveCompanyUsers(companyId),
        storage.getOverdueInvoicesCount(companyId),
        storage.getActiveContactsCount(companyId),
        storage.getActiveServicePlansCount(companyId),
        storage.getRevenueForPeriod(companyId, monthStart, monthEnd),
      ]);

      const completedToday = todaysVisitsList.filter(v => v.status === "completed").length;
      const scheduledToday = todaysVisitsList.filter(v => v.status === "scheduled").length;
      const inProgressToday = todaysVisitsList.filter(v => v.status === "in_progress").length;

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
        subscriptionTier: tier,
        tierName: tierInfo?.name ?? "Unknown",
      });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/reports/summary", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);

      const now = new Date();
      const monthlyRevenue: { month: string; revenue: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const start = d.toISOString().split("T")[0];
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0];
        const revenue = await storage.getRevenueForPeriod(companyId, start, end);
        monthlyRevenue.push({
          month: d.toLocaleString("default", { month: "short", year: "numeric" }),
          revenue,
        });
      }

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
        monthlyRevenue,
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

  // ================ Contact Routes ================

  app.get("/api/contacts/export/csv", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contactsList = await storage.getContacts(companyId);
      const headers = ["id", "firstName", "lastName", "email", "phone", "status", "notes"];
      const csvRows = [headers.join(",")];
      for (const c of contactsList) {
        csvRows.push(headers.map(h => {
          const val = (c as any)[h] ?? "";
          return `"${String(val).replace(/"/g, '""')}"`;
        }).join(","));
      }
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=contacts.csv");
      res.send(csvRows.join("\n"));
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/contacts/import/csv", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const csvText = typeof req.body === "string" ? req.body : req.body?.csv;
      if (!csvText) return res.status(400).json({ error: "No CSV data provided" });

      const lines = csvText.split("\n").filter((l: string) => l.trim());
      if (lines.length < 2) return res.status(400).json({ error: "CSV must have headers and at least one row" });

      const headers = lines[0].split(",").map((h: string) => h.trim().replace(/"/g, ""));
      const imported: any[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",").map((v: string) => v.trim().replace(/^"|"$/g, "").replace(/""/g, '"'));
        const row: any = {};
        headers.forEach((h: string, idx: number) => { row[h] = values[idx] || ""; });

        if (!row.firstName || !row.lastName) continue;

        const contact = await storage.createContact({
          companyId,
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email || null,
          phone: row.phone || null,
          status: row.status || "lead",
          notes: row.notes || null,
        } as any);
        imported.push(contact);
      }

      res.status(201).json({ imported: imported.length, contacts: imported });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/contacts", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const filters: { status?: string; search?: string } = {};
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.search) filters.search = req.query.search as string;
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

      if (contact.streetAddress && contact.city && contact.state && contact.zipCode) {
        await storage.createProperty({
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

      res.status(201).json(contact);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/contacts/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getContact(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Contact not found" });
      const contact = await storage.updateContact(req.params.id, req.body);

      if (contact.streetAddress && contact.city && contact.state && contact.zipCode) {
        const existingProperties = await storage.getProperties(companyId, contact.id);
        if (existingProperties.length === 0) {
          await storage.createProperty({
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
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getContact(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Contact not found" });
      await storage.deleteContact(req.params.id);
      res.json({ success: true });
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
      await getCompanyContext(req);
      await storage.deleteTag(req.params.id);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/contacts/:id/tags", isAuthenticated, async (req: Request, res: Response) => {
    try {
      await getCompanyContext(req);
      const { tagId } = req.body;
      if (!tagId) return res.status(400).json({ error: "tagId is required" });
      await storage.addTagToContact(req.params.id, tagId);
      res.status(201).json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/contacts/:id/tags/:tagId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      await getCompanyContext(req);
      await storage.removeTagFromContact(req.params.id, req.params.tagId);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/contacts/:id/tags", isAuthenticated, async (req: Request, res: Response) => {
    try {
      await getCompanyContext(req);
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
      const property = await storage.createProperty(parsed);
      res.status(201).json(property);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/properties/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getProperty(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Property not found" });
      const property = await storage.updateProperty(req.params.id, req.body);
      res.json(property);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/properties/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getProperty(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Property not found" });
      await storage.deleteProperty(req.params.id);
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
      const route = await storage.updateRoute(req.params.id, req.body);
      res.json(route);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/routes/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getRoute(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Route not found" });
      await storage.deleteRoute(req.params.id);
      res.json({ success: true });
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
      res.json(plans);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/service-plans/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const plan = await storage.getServicePlan(req.params.id, companyId);
      if (!plan) return res.status(404).json({ error: "Service plan not found" });
      res.json(plan);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/service-plans", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const body = { ...req.body, companyId };
      if (!body.routeId || body.routeId === "") body.routeId = null;
      const parsed = insertServicePlanSchema.parse(body);
      const plan = await storage.createServicePlan(parsed);
      res.status(201).json(plan);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/service-plans/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getServicePlan(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Service plan not found" });
      const body = { ...req.body };
      if (body.routeId === "" || body.routeId === undefined) body.routeId = null;
      const plan = await storage.updateServicePlan(req.params.id, body);
      res.json(plan);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/service-plans/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getServicePlan(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Service plan not found" });
      await storage.deleteServicePlan(req.params.id);
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
      await getCompanyContext(req);
      await storage.deleteVacationHold(req.params.id);
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  // ================ Visit Routes ================

  app.get("/api/visits/today", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const today = new Date().toISOString().split("T")[0];
      const visitsList = await storage.getVisits(companyId, { date: today });
      res.json(visitsList);
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
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getVisit(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Visit not found" });
      const visit = await storage.updateVisit(req.params.id, req.body);

      if (req.body.status === "completed" && existing.status !== "completed") {
        try {
          const plan = await storage.getServicePlan(visit.servicePlanId, companyId);
          if (plan) {
            const contact = await storage.getContact(plan.contactId, companyId);
            if (contact && contact.invoiceTiming === "after_service" && contact.invoiceFrequency === "per_service") {
              const alreadyInvoiced = await storage.isVisitInvoiced(visit.id);
              if (!alreadyInvoiced) {
                const invoiceNumber = await storage.getNextInvoiceNumber(companyId);
                const pricePerVisit = parseFloat(plan.pricePerVisit);
                const subtotal = pricePerVisit;
                const total = subtotal;
                await storage.createInvoiceWithLineItems({
                  companyId,
                  contactId: plan.contactId,
                  invoiceNumber,
                  dueDate: new Date().toISOString().split("T")[0],
                  subtotal: subtotal.toFixed(2),
                  tax: "0",
                  total: total.toFixed(2),
                  status: "pending",
                  autoGenerated: true,
                  paymentAttempts: 0,
                }, [{
                  visitId: visit.id,
                  description: `Service on ${visit.scheduledDate}`,
                  quantity: 1,
                  unitPrice: pricePerVisit.toFixed(2),
                  total: pricePerVisit.toFixed(2),
                }]);
              }
            }
          }
        } catch (autoErr) {
          console.error("Auto-invoice generation failed:", autoErr);
        }
      }

      res.json(visit);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/visits/generate", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { startDate, endDate } = req.body;
      if (!startDate || !endDate) {
        return res.status(400).json({ error: "startDate and endDate are required" });
      }

      const plans = await storage.getServicePlans(companyId, { isActive: true });
      const existingVisits = await storage.getVisitsForDateRange(companyId, startDate, endDate);
      const existingKeys = new Set(
        existingVisits.map((v) => `${v.servicePlanId}_${v.scheduledDate}`)
      );

      const dayMap: Record<string, number> = {
        monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
        friday: 5, saturday: 6, sunday: 0,
      };

      const created: any[] = [];
      const start = new Date(startDate);
      const end = new Date(endDate);

      for (const plan of plans) {
        if (!plan.dayOfWeek) continue;
        const targetDay = dayMap[plan.dayOfWeek];
        if (targetDay === undefined) continue;

        const planStart = plan.startDate ? new Date(plan.startDate) : start;
        const planEnd = plan.endDate ? new Date(plan.endDate) : end;
        const effectiveStart = planStart > start ? planStart : start;
        const effectiveEnd = planEnd < end ? planEnd : end;

        const current = new Date(effectiveStart);
        while (current <= effectiveEnd) {
          if (current.getDay() === targetDay) {
            const dateStr = current.toISOString().split("T")[0];
            const key = `${plan.id}_${dateStr}`;

            if (!existingKeys.has(key)) {
              let shouldGenerate = true;

              if (plan.frequency === "biweekly") {
                const planStartDate = new Date(plan.startDate);
                const diffDays = Math.floor((current.getTime() - planStartDate.getTime()) / (1000 * 60 * 60 * 24));
                const diffWeeks = Math.floor(diffDays / 7);
                if (diffWeeks % 2 !== 0) shouldGenerate = false;
              } else if (plan.frequency === "monthly") {
                const planStartDate = new Date(plan.startDate);
                if (current.getMonth() === planStartDate.getMonth() && current.getFullYear() === planStartDate.getFullYear()) {
                  shouldGenerate = true;
                } else {
                  const firstOfMonth = new Date(current.getFullYear(), current.getMonth(), 1);
                  let firstTargetDay = new Date(firstOfMonth);
                  while (firstTargetDay.getDay() !== targetDay) {
                    firstTargetDay.setDate(firstTargetDay.getDate() + 1);
                  }
                  if (current.getTime() !== firstTargetDay.getTime()) shouldGenerate = false;
                }
              } else if (plan.frequency === "onetime") {
                const planStartDate = new Date(plan.startDate);
                if (current.toISOString().split("T")[0] !== planStartDate.toISOString().split("T")[0]) {
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
              current.setDate(current.getDate() + 7);
              continue;
            }
          }
          current.setDate(current.getDate() + 1);
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

      const items = await storage.getInvoiceLineItems(invoice.id);
      res.status(201).json({ ...invoice, lineItems: items });
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/contacts/:id/billing-preferences", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const { invoiceTiming, invoiceFrequency } = req.body;
      const validTimings = ["before_service", "after_service"];
      const validFrequencies = ["per_service", "per_week", "per_month"];
      if (invoiceTiming && !validTimings.includes(invoiceTiming)) {
        return res.status(400).json({ error: "Invalid invoice timing" });
      }
      if (invoiceFrequency && !validFrequencies.includes(invoiceFrequency)) {
        return res.status(400).json({ error: "Invalid invoice frequency" });
      }

      const updated = await storage.updateContact(req.params.id, {
        ...(invoiceTiming && { invoiceTiming }),
        ...(invoiceFrequency && { invoiceFrequency }),
      });
      res.json(updated);
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/invoices/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const existing = await storage.getInvoice(req.params.id, companyId);
      if (!existing) return res.status(404).json({ error: "Invoice not found" });
      const invoice = await storage.updateInvoice(req.params.id, req.body);
      res.json(invoice);
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
      await getCompanyContext(req);
      const rule = await storage.updateAutomationRule(req.params.id, req.body);
      res.json(rule);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/automation-rules/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      await getCompanyContext(req);
      await storage.deleteAutomationRule(req.params.id);
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
      const { role } = await getCompanyContext(req);
      requireRole(role);
      await storage.deleteApiKey(req.params.id);
      res.json({ success: true });
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

  app.patch("/api/webhooks/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { role } = await getCompanyContext(req);
      requireRole(role);
      const webhook = await storage.updateWebhook(req.params.id, req.body);
      res.json(webhook);
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/webhooks/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { role } = await getCompanyContext(req);
      requireRole(role);
      await storage.deleteWebhook(req.params.id);
      res.json({ success: true });
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

  // ================ Messages / Communications ================

  app.get("/api/messages", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const filters: { contactId?: string; channel?: string; direction?: string } = {};
      if (req.query.contactId) filters.contactId = req.query.contactId as string;
      if (req.query.channel) filters.channel = req.query.channel as string;
      if (req.query.direction) filters.direction = req.query.direction as string;
      const msgs = await storage.getMessages(companyId, filters);
      res.json(msgs);
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
      const fromAddress = company?.email || "noreply@scoopilot.com";

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

      const contact = await storage.getContact(invoice.contactId, companyId);
      if (!contact?.email) return res.status(400).json({ error: "Contact has no email address" });

      const company = await storage.getCompany(companyId);
      const lineItems = await storage.getInvoiceLineItems(invoice.id);

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
      });

      const fromAddress = company?.email || "noreply@scoopilot.com";

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

      const result = await sendEmail({
        to: contact.email,
        from: fromAddress,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
      });

      if (result.success) {
        await storage.updateMessageStatus(msg.id, "sent");
        res.json({ success: true, messageId: msg.id });
      } else {
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

      await storage.updateContact(req.params.id, { stripeCustomerId });
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

      const result = await chargeInvoiceAutomatically({
        customerId: contact.stripeCustomerId,
        amount: parseFloat(invoice.total),
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      });

      const updateData: any = {
        paymentAttempts: (invoice.paymentAttempts || 0) + 1,
        lastPaymentAttempt: new Date(),
      };

      if (result.status === "succeeded") {
        updateData.status = "paid";
        updateData.paidAt = new Date();
        updateData.stripePaymentIntentId = result.paymentIntentId;
      } else {
        updateData.status = "failed";
        if (result.paymentIntentId) updateData.stripePaymentIntentId = result.paymentIntentId;
      }

      const updated = await storage.updateInvoice(invoice.id, updateData);
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
        await storage.updateContact(contact.id, { stripeCustomerId });
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const result = await createCheckoutSession({
        customerId: stripeCustomerId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        amount: parseFloat(invoice.total),
        successUrl: `${baseUrl}/invoices?paid=${invoice.id}`,
        cancelUrl: `${baseUrl}/invoices`,
      });

      res.json(result);
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
          const allCompanies = await storage.listCompanies();
          for (const company of allCompanies) {
            const invoice = await storage.getInvoice(invoiceId, company.id);
            if (invoice && invoice.status !== "paid") {
              await storage.updateInvoice(invoiceId, {
                status: "paid",
                paidAt: new Date(),
                stripePaymentIntentId: session.payment_intent,
              });
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
              await storage.updateInvoice(invoiceId, {
                status: "paid",
                paidAt: new Date(),
                stripePaymentIntentId: pi.id,
              });
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
              await storage.updateInvoice(invoiceId, {
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
      const { email, lastName } = req.body;
      if (!email || !lastName) {
        return res.status(400).json({ error: "Email and last name are required" });
      }

      const allCompanies = await storage.listCompanies();
      let foundContact = null;
      for (const company of allCompanies) {
        const companyContacts = await storage.getContacts(company.id, { search: email });
        const match = companyContacts.find(
          (c) => c.email?.toLowerCase() === email.toLowerCase() && c.lastName?.toLowerCase() === lastName.toLowerCase() && c.hasPortalAccess
        );
        if (match) {
          foundContact = match;
          break;
        }
      }

      if (!foundContact) {
        return res.status(401).json({ error: "No portal access found for this email and last name" });
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
        companyName: company?.name || "",
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

      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      let stripeCustomerId = contact.stripeCustomerId;
      if (!stripeCustomerId) {
        stripeCustomerId = await createStripeCustomer({
          email: contact.email || undefined,
          name: `${contact.firstName} ${contact.lastName}`.trim(),
          metadata: { contactId: contact.id, companyId },
        });
        await storage.updateContact(contact.id, { stripeCustomerId });
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const result = await createCheckoutSession({
        customerId: stripeCustomerId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        amount: parseFloat(invoice.total),
        successUrl: `${baseUrl}/portal/client?paid=${invoice.id}`,
        cancelUrl: `${baseUrl}/portal/client`,
      });

      res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/portal/pause", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      await storage.updateContact(contactId, { status: "paused" });

      const plans = await storage.getServicePlans(companyId, { contactId, isActive: true });
      for (const plan of plans) {
        await storage.updateServicePlan(plan.id, { isActive: false });
      }

      res.json({ success: true, status: "paused" });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/portal/resume", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      await storage.updateContact(contactId, { status: "active" });

      const plans = await storage.getServicePlans(companyId, { contactId });
      for (const plan of plans) {
        if (!plan.isActive) {
          await storage.updateServicePlan(plan.id, { isActive: true });
        }
      }

      res.json({ success: true, status: "active" });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/portal/logout", async (req: Request, res: Response) => {
    try {
      const { sessionId } = await getPortalContext(req);
      await storage.deletePortalSession(sessionId);
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

      await storage.updateContact(req.params.id, { hasPortalAccess: true });
      res.json({ success: true, message: "Portal access enabled. Customer can log in with their email and last name." });
    } catch (err) { handleError(res, err); }
  });

  app.delete("/api/contacts/:id/portal-access", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const contact = await storage.getContact(req.params.id, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      await storage.updateContact(req.params.id, { hasPortalAccess: false });
      res.json({ success: true, message: "Portal access disabled." });
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

      const invoiceData: any = {
        business: {
          name: company?.name || "",
          address: company?.address || "",
          phone: company?.phone || "",
          email: company?.email || "",
          website: "",
          logo: "",
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
      if ("error" in result) return res.status(401).json({ error: result.error });
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
      const users = await storage.getCompanyUsers(company.id);
      const contactList = await storage.getContacts(company.id);
      const invoiceList = await storage.getInvoices(company.id);
      const notes = await storage.getAdminNotes(company.id);
      res.json({ ...company, users, contacts: contactList, invoices: invoiceList, notes });
    } catch (err) { handleError(res, err); }
  });

  app.patch("/api/admin/companies/:id/subscription", isAdmin, async (req: Request, res: Response) => {
    try {
      const { tier } = req.body;
      const validTiers = ["tier_1", "tier_1_3", "tier_3_5", "tier_6_10", "tier_10_plus"];
      if (!tier || !validTiers.includes(tier)) return res.status(400).json({ error: "Invalid tier" });
      const updated = await storage.updateCompanySubscription(req.params.id, tier);
      res.json(updated);
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

  return httpServer;
}
