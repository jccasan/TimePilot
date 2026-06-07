import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import {
  companies,
  contacts,
  properties,
  qboSyncLogs,
  routes,
  servicePlans as servicePlansTable,
  agreements as agreementsTable,
  jobs as jobsTable,
} from "@shared/schema";
import { reportMeteredUsageSet } from "../services/stripe";
import { checkRetellWebhookSync } from "../services/retell";

import {
  isAuthenticated,
  isAdmin,
  getCompanyContext,
  requireRole,
  requireApiKeyScope,
  getBaseUrl,
  handleError,
  auditLog,
  p,
} from "./shared";

export async function registerIntegrationsRoutes(app: Express): Promise<void> {
  // ================ QuickBooks Online Integration ================

  app.get("/api/qbo/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { isQboConfigured, getQboSyncStatus } = await import("../services/quickbooks");
      if (!isQboConfigured()) {
        return res.json({
          configured: false,
          connected: false,
          realmId: null,
          connectedAt: null,
          lastSync: null,
          totalSynced: 0,
          totalErrors: 0,
          recentLogs: [],
        });
      }
      const status = await getQboSyncStatus(companyId);
      return res.json({ configured: true, ...status });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/qbo/connect", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const { isQboConfigured, getQboAuthUrl, createOAuthState } =
        await import("../services/quickbooks");
      if (!isQboConfigured()) {
        return res.status(503).json({
          error:
            "QuickBooks integration is not configured. Please add QBO_CLIENT_ID and QBO_CLIENT_SECRET.",
        });
      }
      const baseUrl = getBaseUrl(req);
      const redirectUri = process.env.QBO_REDIRECT_URI || `${baseUrl}/api/qbo/callback`;
      const state = createOAuthState(companyId);
      const authUrl = getQboAuthUrl(redirectUri, state);
      return res.json({ url: authUrl });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/qbo/callback", async (req: Request, res: Response) => {
    try {
      const { code, state, realmId } = req.query as {
        code: string;
        state: string;
        realmId: string;
      };
      if (!code || !state || !realmId) {
        return res.redirect("/settings?qbo=error&msg=missing_params");
      }
      const { exchangeQboCode, validateOAuthState, encryptToken } =
        await import("../services/quickbooks");
      const companyId = validateOAuthState(state);
      if (!companyId) {
        return res.redirect("/settings?qbo=error&msg=invalid_or_expired_state");
      }
      const baseUrl = getBaseUrl(req);
      const redirectUri = process.env.QBO_REDIRECT_URI || `${baseUrl}/api/qbo/callback`;
      const tokens = await exchangeQboCode(code, redirectUri);

      await db
        .update(companies)
        .set({
          qboRealmId: realmId,
          qboAccessToken: encryptToken(tokens.access_token),
          qboRefreshToken: encryptToken(tokens.refresh_token),
          qboTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          qboConnectedAt: new Date(),
        })
        .where(eq(companies.id, companyId));

      return res.redirect("/settings?qbo=connected");
    } catch (err: unknown) {
      console.error("QBO callback error:", err);
      return res.redirect(
        `/settings?qbo=error&msg=${encodeURIComponent((err instanceof Error ? err.message : String(err)) || "auth_failed")}`
      );
    }
  });

  app.post("/api/qbo/disconnect", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const { disconnectQbo } = await import("../services/quickbooks");
      await disconnectQbo(companyId);
      auditLog(companyId, (await getCompanyContext(req)).userId, "company", companyId, "update", {
        action: "qbo_disconnect",
      });
      return res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/qbo/sync", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const { runFullSync } = await import("../services/quickbooks");
      const result = await runFullSync(companyId);
      auditLog(companyId, (await getCompanyContext(req)).userId, "company", companyId, "update", {
        action: "qbo_full_sync",
        result,
      });
      return res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/qbo/sync/contact/:contactId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);
        const { syncContactToQbo } = await import("../services/quickbooks");
        const result = await syncContactToQbo(companyId, p(req.params.contactId));
        return res.json(result);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/qbo/sync/invoice/:invoiceId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);
        const { syncInvoiceToQbo } = await import("../services/quickbooks");
        const result = await syncInvoiceToQbo(companyId, p(req.params.invoiceId));
        return res.json(result);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post("/api/qbo/retry/:logId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const logId = p(req.params.logId);
      const [logEntry] = await db
        .select()
        .from(qboSyncLogs)
        .where(and(eq(qboSyncLogs.id, logId), eq(qboSyncLogs.companyId, companyId)));
      if (!logEntry) return res.status(404).json({ error: "Sync log not found" });
      const { syncContactToQbo, syncInvoiceToQbo, syncPaymentToQbo } =
        await import("../services/quickbooks");
      try {
        if (logEntry.entityType === "contact") {
          await syncContactToQbo(companyId, logEntry.entityId);
        } else if (logEntry.entityType === "invoice") {
          await syncInvoiceToQbo(companyId, logEntry.entityId);
        } else if (logEntry.entityType === "payment") {
          await syncPaymentToQbo(companyId, logEntry.entityId);
        }
        return res.json({ success: true });
      } catch (retryErr: unknown) {
        return res
          .status(422)
          .json({ error: retryErr instanceof Error ? retryErr.message : String(retryErr) });
      }
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/qbo/expense-accounts", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const { listQboExpenseAccounts } = await import("../services/quickbooks");
      const accounts = await listQboExpenseAccounts(companyId);
      res.json(accounts);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/qbo/fee-account", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const { accountId } = req.body;
      if (!accountId || typeof accountId !== "string") {
        return res.status(400).json({ error: "accountId is required" });
      }
      const { listQboExpenseAccounts } = await import("../services/quickbooks");
      const accounts = await listQboExpenseAccounts(companyId);
      const valid = accounts.some((a) => a.id === accountId);
      if (!valid) {
        return res.status(400).json({ error: "Invalid expense account ID" });
      }
      await db
        .update(companies)
        .set({ qboFeeAccountRef: accountId })
        .where(eq(companies.id, companyId));
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Voice Agent Scheduling API ================

  app.get("/api/voice/lookup", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (req._apiKeyAuth) {
        requireApiKeyScope(req, "voice:read");
      } else {
        requireRole(role, ["owner", "admin"]);
      }
      const phone = ((req.query.phone as string) || "").replace(/[^\d+]/g, "");
      if (!phone || phone.length < 7) {
        return res.json({ found: false, message: "No matching customer found" });
      }
      const allContacts = await storage.getContacts(companyId, { search: phone });
      const matched = allContacts.find(
        (c) => c.phone && c.phone.replace(/[^\d+]/g, "").includes(phone)
      );
      if (!matched) {
        return res.json({ found: false, message: "No matching customer found" });
      }
      const plans = await storage.getServicePlans(companyId, { contactId: matched.id });
      const activePlans = plans.filter((p) => p.isActive);
      const props = await storage.getProperties(companyId, matched.id);
      const today = new Date().toISOString().split("T")[0];
      let upcomingVisits: {
        scheduledDate: string;
        status: string;
        servicePlanName: string;
        propertyAddress: string;
      }[] = [];
      if (activePlans.length > 0) {
        const visitsResult = await storage.getVisitsForContact(companyId, matched.id, 50, 0);
        upcomingVisits = visitsResult.visits
          .filter((v) => v.scheduledDate >= today && v.status === "scheduled")
          .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
          .slice(0, 3)
          .map((v) => ({
            scheduledDate: v.scheduledDate,
            status: v.status,
            servicePlanName: v.servicePlanName,
            propertyAddress: v.propertyAddress,
          }));
      }
      let activeHolds: { id: string; startDate: string; endDate: string; reason: string | null }[] =
        [];
      if (activePlans.length > 0) {
        const allHolds = await Promise.all(activePlans.map((p) => storage.getVacationHolds(p.id)));
        activeHolds = allHolds
          .flat()
          .filter((h) => h.endDate >= today)
          .map((h) => ({ id: h.id, startDate: h.startDate, endDate: h.endDate, reason: h.reason }));
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
        properties: props.map((p) => ({
          id: p.id,
          streetAddress: p.streetAddress,
          city: p.city,
          state: p.state,
          zipCode: p.zipCode,
          numberOfDogs: p.numberOfDogs,
        })),
        servicePlans: activePlans.map((sp) => ({
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
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/voice/calls", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (req._apiKeyAuth) {
        requireApiKeyScope(req, "voice:read");
      } else {
        requireRole(role, ["owner", "admin"]);
      }
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const calls = await storage.getVoiceCalls(companyId, limit);
      res.json(calls);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/voice/availability", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (req._apiKeyAuth) {
        requireApiKeyScope(req, "voice:read");
      } else {
        requireRole(role, ["owner", "admin"]);
      }
      const dayFilter = req.query.dayOfWeek as string | undefined;
      const zipCode = req.query.zipCode as string | undefined;
      const allRoutes = await storage.getRoutes(companyId);
      const activePlans = await storage.getServicePlans(companyId, { isActive: true });

      let servedDays: Set<string> | null = null;
      if (zipCode) {
        const zones = await storage.getServiceZones(companyId);
        const matchingZones = zones.filter((z) => z.isActive && z.zipCode === zipCode);
        if (matchingZones.length === 0) {
          return res.json({
            availability: [],
            available_days: [],
            message: `No service zones found for zip code ${zipCode}`,
          });
        }
        servedDays = new Set(matchingZones.map((z) => z.dayOfWeek).filter((d) => d !== "tbd"));
        if (servedDays.size === 0) servedDays = null;
      }

      const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
      const availability = days
        .filter((d) => !dayFilter || d === dayFilter)
        .filter((d) => !servedDays || servedDays.has(d))
        .map((day) => {
          const dayRoutes = allRoutes.filter((r) => r.dayOfWeek === day);
          const totalStops = dayRoutes.reduce((sum, r) => {
            return sum + activePlans.filter((sp) => sp.routeId === r.id).length;
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
      const available_days = availability.filter((d) => d.available).map((d) => d.dayOfWeek);
      res.json({ availability, available_days });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/voice/book", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (req._apiKeyAuth) {
        requireApiKeyScope(req, "voice:write");
      } else {
        requireRole(role, ["owner", "admin"]);
      }
      const {
        firstName,
        lastName,
        phone,
        email,
        streetAddress,
        city,
        state,
        zipCode,
        numberOfDogs,
        frequency,
        dayOfWeek,
        notes,
      } = req.body;
      if (
        !firstName ||
        typeof firstName !== "string" ||
        !lastName ||
        typeof lastName !== "string" ||
        !phone ||
        typeof phone !== "string"
      ) {
        return res
          .status(400)
          .json({ error: "firstName, lastName, and phone are required (strings)" });
      }
      if (!streetAddress || !city || !state || !zipCode) {
        return res
          .status(400)
          .json({ error: "streetAddress, city, state, and zipCode are required" });
      }
      type Frequency = "weekly" | "biweekly" | "monthly" | "onetime";
      const validFrequencies: Frequency[] = ["weekly", "biweekly", "monthly", "onetime"];
      const freq: Frequency = (frequency || "weekly") as Frequency;
      if (!validFrequencies.includes(freq)) {
        return res
          .status(400)
          .json({ error: `frequency must be one of: ${validFrequencies.join(", ")}` });
      }
      const validDays = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ] as const;
      type DayOfWeek =
        | "monday"
        | "tuesday"
        | "wednesday"
        | "thursday"
        | "friday"
        | "saturday"
        | "sunday"
        | "tbd";
      const day: DayOfWeek = (dayOfWeek || "tbd") as DayOfWeek;
      if (day !== "tbd" && !validDays.includes(day)) {
        return res.status(400).json({
          error: `dayOfWeek must be one of: ${validDays.join(", ")}, or omit for auto-assignment`,
        });
      }
      const dogCount =
        numberOfDogs && Number.isInteger(Number(numberOfDogs)) && Number(numberOfDogs) > 0
          ? Number(numberOfDogs)
          : 1;

      let routeId: string | null = null;
      if (day !== "tbd") {
        const dayRoutes = await storage.getRoutes(companyId, day);
        if (dayRoutes.length > 0) {
          const allPlans = await storage.getServicePlans(companyId, { isActive: true });
          let bestRoute = dayRoutes[0];
          let bestCount = Infinity;
          for (const route of dayRoutes) {
            const stopCount = allPlans.filter((sp) => sp.routeId === route.id).length;
            if (stopCount < bestCount) {
              bestCount = stopCount;
              bestRoute = route;
            }
          }
          routeId = bestRoute.id;
        }
      }

      const result = await db.transaction(async (tx) => {
        const [contact] = await tx
          .insert(contacts)
          .values({
            companyId,
            firstName,
            lastName,
            phone,
            email: email || null,
            status: "active",
            notes: notes || null,
          })
          .returning();

        const [property] = await tx
          .insert(properties)
          .values({
            companyId,
            contactId: contact.id,
            streetAddress,
            city,
            state,
            zipCode,
            numberOfDogs: dogCount,
          })
          .returning();

        const [servicePlan] = await tx
          .insert(servicePlansTable)
          .values({
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
          })
          .returning();

        const [agreement] = await tx
          .insert(agreementsTable)
          .values({
            companyId,
            contactId: contact.id,
            frequency: freq,
            pricePerVisit: "0",
            isActive: true,
            startDate: new Date().toISOString().split("T")[0],
            servicePlanId: servicePlan.id,
          })
          .returning();

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
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/voice/pause", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (req._apiKeyAuth) {
        requireApiKeyScope(req, "voice:write");
      } else {
        requireRole(role, ["owner", "admin"]);
      }
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
        planIds = plans.map((p) => p.id);
      } else {
        return res.status(400).json({ error: "Provide contactId or servicePlanId" });
      }
      if (planIds.length === 0) {
        return res.status(404).json({ error: "No active service plans found" });
      }
      const holds = await Promise.all(
        planIds.map((pid) =>
          storage.createVacationHold({
            servicePlanId: pid,
            startDate,
            endDate,
            reason: reason || null,
          })
        )
      );
      res.status(201).json({
        success: true,
        holdsCreated: holds.length,
        startDate,
        endDate,
        summary: `Service paused from ${startDate} to ${endDate}`,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/voice/resume", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (req._apiKeyAuth) {
        requireApiKeyScope(req, "voice:write");
      } else {
        requireRole(role, ["owner", "admin"]);
      }
      const { contactId, servicePlanId } = req.body;
      let planIds: string[] = [];
      if (servicePlanId) {
        const sp = await storage.getServicePlan(servicePlanId, companyId);
        if (!sp) return res.status(404).json({ error: "Service plan not found" });
        planIds = [servicePlanId];
      } else if (contactId) {
        const plans = await storage.getServicePlans(companyId, { contactId, isActive: true });
        planIds = plans.map((p) => p.id);
      } else {
        return res.status(400).json({ error: "Provide contactId or servicePlanId" });
      }
      const today = new Date().toISOString().split("T")[0];
      let removedCount = 0;
      for (const pid of planIds) {
        const holds = await storage.getVacationHolds(pid);
        const activeHolds = holds.filter((h) => h.endDate >= today);
        for (const hold of activeHolds) {
          await storage.deleteVacationHold(hold.id, companyId);
          removedCount++;
        }
      }
      res.json({
        success: true,
        holdsRemoved: removedCount,
        summary:
          removedCount > 0
            ? `Removed ${removedCount} vacation hold(s). Service resumed.`
            : "No active holds found to remove.",
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/voice/reschedule", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (req._apiKeyAuth) {
        requireApiKeyScope(req, "voice:write");
      } else {
        requireRole(role, ["owner", "admin"]);
      }
      const { servicePlanId, contactId, newDayOfWeek } = req.body;
      const validDays = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ];
      if (!newDayOfWeek || !validDays.includes(newDayOfWeek)) {
        return res
          .status(400)
          .json({ error: `newDayOfWeek is required and must be one of: ${validDays.join(", ")}` });
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
          const stopCount = allPlans.filter((sp) => sp.routeId === route.id).length;
          if (stopCount < bestCount) {
            bestCount = stopCount;
            bestRoute = route;
          }
        }
        newRouteId = bestRoute.id;
      }
      for (const plan of plans) {
        await storage.updateServicePlan(plan.id, companyId, {
          dayOfWeek: newDayOfWeek as (typeof routes.$inferSelect)["dayOfWeek"],
          routeId: newRouteId,
        });
      }
      res.json({
        success: true,
        plansUpdated: plans.length,
        newDayOfWeek,
        routeAssigned: !!newRouteId,
        summary: `Rescheduled ${plans.length} plan(s) to ${newDayOfWeek}s`,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/voice/cancel", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (req._apiKeyAuth) {
        requireApiKeyScope(req, "voice:write");
      } else {
        requireRole(role, ["owner", "admin"]);
      }
      const { contactId, reason } = req.body;
      if (!contactId) {
        return res.status(400).json({ error: "contactId is required" });
      }
      const contact = await storage.getContact(contactId, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const plans = await storage.getServicePlans(companyId, { contactId, isActive: true });
      for (const plan of plans) {
        await storage.updateServicePlan(plan.id, companyId, {
          isActive: false,
          jobStatus: "cancelled" as (typeof servicePlansTable.$inferSelect)["jobStatus"],
        });
      }
      await storage.updateContact(contactId, companyId, {
        status: "cancelled" as (typeof contacts.$inferSelect)["status"],
        notes: contact.notes
          ? `${contact.notes}\n[Voice agent] Cancelled: ${reason || "No reason provided"}`
          : `[Voice agent] Cancelled: ${reason || "No reason provided"}`,
      });
      res.json({
        success: true,
        plansDeactivated: plans.length,
        summary: `Service cancelled for ${contact.firstName} ${contact.lastName}. ${plans.length} plan(s) deactivated.`,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  const { registerAdminAnalyticsRoutes } = await import("../admin-analytics");
  registerAdminAnalyticsRoutes(app, isAdmin);

  import("../jobs/nightly-rollup").then(({ runNightlyRollup }) => {
    setTimeout(() => runNightlyRollup().catch(console.error), 30000);
    setInterval(() => runNightlyRollup().catch(console.error), 24 * 60 * 60 * 1000);
  });

  setTimeout(() => {
    const retellAgentId = process.env.RETELL_AGENT_ID;
    const retellApiKey = process.env.RETELL_API_KEY;
    if (retellAgentId && retellApiKey) {
      checkRetellWebhookSync(retellAgentId).catch((err) =>
        console.warn("[Retell] Startup webhook sync check failed:", err.message)
      );
    }
  }, 15000);

  import("../jobs/message-cleanup").then(({ runMessageCleanup }) => {
    setTimeout(() => runMessageCleanup().catch(console.error), 120000);
    setInterval(() => runMessageCleanup().catch(console.error), 24 * 60 * 60 * 1000);
  });

  import("../jobs/stripe-event-cleanup").then(({ runStripeEventCleanup }) => {
    setTimeout(() => runStripeEventCleanup().catch(console.error), 60000);
    setInterval(() => runStripeEventCleanup().catch(console.error), 24 * 60 * 60 * 1000);
  });

  import("../jobs/reminders").then(({ runReminders }) => {
    setTimeout(() => runReminders().catch(console.error), 60000);
    setInterval(() => runReminders().catch(console.error), 10 * 60 * 1000);
  });

  import("../jobs/auto-invoice").then(({ runAutoInvoice }) => {
    setTimeout(() => runAutoInvoice().catch(console.error), 60000);
    setInterval(() => runAutoInvoice().catch(console.error), 24 * 60 * 60 * 1000);
  });

  // Beginning-of-month prepay billing (charge on the 1st for the month ahead).
  import("../jobs/prepay-billing").then(({ runPrepayBilling }) => {
    setTimeout(() => runPrepayBilling().catch(console.error), 75000);
    setInterval(() => runPrepayBilling().catch(console.error), 24 * 60 * 60 * 1000);
  });

  import("../jobs/auto-visits").then(({ runAutoVisits }) => {
    setTimeout(() => runAutoVisits().catch(console.error), 90000);
    setInterval(() => runAutoVisits().catch(console.error), 24 * 60 * 60 * 1000);
  });

  import("../services/webhook-dispatcher").then(({ startWebhookRetryJob }) => {
    startWebhookRetryJob();
  });

  import("../jobs/demo-auto-complete").then(({ runDemoAutoComplete }) => {
    setTimeout(() => runDemoAutoComplete().catch(console.error), 45000);
    setInterval(() => runDemoAutoComplete().catch(console.error), 60 * 60 * 1000);
  });

  import("../jobs/demo-auto-pay").then(({ runDemoAutoPay }) => {
    setTimeout(() => runDemoAutoPay().catch(console.error), 120000);
    setInterval(() => runDemoAutoPay().catch(console.error), 24 * 60 * 60 * 1000);
  });

  import("../jobs/trial-expiration").then(({ runTrialExpirationCheck }) => {
    setTimeout(() => runTrialExpirationCheck().catch(console.error), 150000);
    setInterval(() => runTrialExpirationCheck().catch(console.error), 60 * 60 * 1000);
  });

  import("../jobs/retell-webhook-check").then(({ runRetellWebhookCheck }) => {
    setTimeout(() => runRetellWebhookCheck().catch(console.error), 60000);
    setInterval(() => runRetellWebhookCheck().catch(console.error), 24 * 60 * 60 * 1000);
  });

  import("../jobs/stop-order-repair").then(({ runStopOrderRepair }) => {
    setTimeout(() => runStopOrderRepair().catch(console.error), 180000);
    setInterval(() => runStopOrderRepair().catch(console.error), 24 * 60 * 60 * 1000);
  });

  async function syncSeatUsageToStripe(): Promise<void> {
    try {
      const allCompanies = await storage.listCompanies();
      for (const company of allCompanies) {
        if (!company.stripeSubscriptionId || company.subscriptionStatus === "cancelled") continue;
        const members = await storage.getCompanyUsers(company.id);
        const activeCount = members.filter((m) => m.isActive !== false).length;
        await reportMeteredUsageSet(company.stripeSubscriptionId, "user_seat", activeCount).catch(
          () => {}
        );
      }
      console.log(
        `[Seat Sync] Reported seat counts for ${allCompanies.filter((c) => c.stripeSubscriptionId).length} companies`
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Seat Sync] Error:", message);
    }
  }
  setTimeout(() => syncSeatUsageToStripe().catch(console.error), 120000);
  setInterval(() => syncSeatUsageToStripe().catch(console.error), 24 * 60 * 60 * 1000);

  import("../jobs/system-health-check").then(({ runSystemHealthCheck }) => {
    // Startup run: update DB state but do not send email (avoids alert spam on every restart)
    setTimeout(() => runSystemHealthCheck({ sendEmail: false }).catch(console.error), 30000);
    // Scheduled daily run: send email only when there are issues
    setInterval(
      () => runSystemHealthCheck({ sendEmail: true }).catch(console.error),
      24 * 60 * 60 * 1000
    );
  });

  import("../jobs/lead-response-expiration").then(({ runLeadResponseExpirationJob }) => {
    setTimeout(() => runLeadResponseExpirationJob().catch(console.error), 210000);
    setInterval(() => runLeadResponseExpirationJob().catch(console.error), 24 * 60 * 60 * 1000);
  });
}
