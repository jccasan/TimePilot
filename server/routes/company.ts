import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { sql, eq, and, lt, gte, isNotNull, inArray, desc } from "drizzle-orm";
import {
  contacts,
  invoices,
  routes,
  reminderLogs,
  messages as messagesTable,
  type Message,
  type InsertCompany,
  type InsertCompanyUser,
} from "@shared/schema";
import { ObjectStorageService } from "../replit_integrations/object_storage";
import { getUserById, changePassword } from "../services/app-auth";
import {
  getCompanyToday,
  getCompanyMonthStart,
  getCompanyMonthEnd,
  getCompanyWeekStart,
  getCompanyWeekEnd,
} from "../utils/company-date";
import { reportMeteredUsageSet } from "../services/stripe";
import { TIER_CONFIG } from "@shared/schema";

import {
  isAuthenticated,
  getCompanyContext,
  requireRole,
  getBaseUrl,
  handleError,
  auditLog,
  p,
  getStopOnlyOnlyContactIds,
  provisionPortalAccess,
  getDemoCompanyId,
} from "./shared";
const _backfilledLogoAcls = new Set<string>();
const _objStorage = new ObjectStorageService();

export async function registerCompanyRoutes(app: Express): Promise<void> {
  // ================ Company Routes ================

  function sanitizeCompany(company: Record<string, unknown>) {
    if (!company) return company;
    const {
      telnyxApiKey,
      qboAccessToken: _qboAccessToken,
      qboRefreshToken: _qboRefreshToken,
      ...safe
    } = company;
    return { ...safe, telnyxApiKey: telnyxApiKey ? "••••••••" : null };
  }

  app.get("/api/company", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      // Lazily backfill public ACL on existing logos that were saved before ACL
      // enforcement was in place, so they continue to render in the sidebar and
      // Settings preview without requiring a re-upload. The in-memory set ensures
      // the metadata write only happens once per server process, not on every request.
      if (
        company.logoUrl &&
        typeof company.logoUrl === "string" &&
        !_backfilledLogoAcls.has(company.logoUrl)
      ) {
        const logoUrlToBackfill = company.logoUrl;
        const publicAcl = { owner: userId, visibility: "public" as const };
        _objStorage
          .trySetObjectEntityAclPolicy(logoUrlToBackfill, publicAcl)
          .then(() => {
            _backfilledLogoAcls.add(logoUrlToBackfill);
          })
          .catch((err) => {
            console.warn("[Logo ACL backfill] Failed to set public ACL:", err?.message);
          });
      }
      const sanitized = sanitizeCompany(company) as Record<string, unknown>;
      // Demo bypass: expose unlimited tier and force all feature flags
      if ((company as Record<string, unknown>).demoBypassLimits) {
        const demoId = await getDemoCompanyId();
        if (demoId === companyId) {
          sanitized.subscriptionTier = "tier_10_plus";
          sanitized.subscriptionStatus = "active";
          sanitized.roverAiEnabled = true;
          sanitized.remindersEnabled = true;
          sanitized.aiImportMappingEnabled = true;
          sanitized.routeCredits = (company as Record<string, unknown>).demoUnlimitedCredits
            ? 999999
            : sanitized.routeCredits;
        }
      }
      res.json(sanitized);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(
    "/api/company/review-request-stats",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const [totalResult] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(reminderLogs)
          .where(
            and(
              eq(reminderLogs.companyId, companyId),
              eq(reminderLogs.reminderType, "review_request")
            )
          );
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const [monthResult] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(reminderLogs)
          .where(
            and(
              eq(reminderLogs.companyId, companyId),
              eq(reminderLogs.reminderType, "review_request"),
              gte(reminderLogs.sentAt, monthStart)
            )
          );
        const [reviewsLeftResult] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(contacts)
          .where(and(eq(contacts.companyId, companyId), eq(contacts.googleReviewLeft, true)));
        const positiveResult = await db.execute(sql`
        SELECT COUNT(*)::int AS count FROM review_responses rr
        JOIN review_tokens rt ON rt.id = rr.token_id
        WHERE rt.company_id = ${companyId} AND rr.branch = 'positive'
          AND rr.submitted_at >= ${monthStart}
      `);
        const negativeResult = await db.execute(sql`
        SELECT COUNT(*)::int AS count FROM review_responses rr
        JOIN review_tokens rt ON rt.id = rr.token_id
        WHERE rt.company_id = ${companyId} AND rr.branch = 'negative'
          AND rr.submitted_at >= ${monthStart}
      `);
        res.json({
          totalSent: totalResult?.count ?? 0,
          sentThisMonth: monthResult?.count ?? 0,
          totalReviewsLeft: reviewsLeftResult?.count ?? 0,
          positiveCount: Number((positiveResult?.rows?.[0] as Record<string, unknown>)?.count ?? 0),
          negativeCount: Number((negativeResult?.rows?.[0] as Record<string, unknown>)?.count ?? 0),
        });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // Preview: which clients will receive the onboarding welcome email
  app.get(
    "/api/company/onboarding-welcome-preview",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);
        const allContacts = await storage.getContacts(companyId);
        const eligible = allContacts
          .filter((c) => c.status === "active" && c.email)
          .map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim(), email: c.email }));
        res.json({ contacts: eligible, count: eligible.length });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // Batch-send onboarding welcome emails, then disable suppression flag
  app.post(
    "/api/company/send-onboarding-welcome",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);

        const company = await storage.getCompany(companyId);
        if (!company) return res.status(404).json({ error: "Company not found" });

        // Idempotency guard
        if (company.onboardingCompleteSentAt) {
          return res.status(409).json({
            error:
              "Onboarding welcome emails were already sent on " +
              new Date(company.onboardingCompleteSentAt).toLocaleDateString(),
          });
        }

        const baseUrl = getBaseUrl(req);
        const allContacts = await storage.getContacts(companyId);
        const eligible = allContacts.filter((c) => c.status === "active" && c.email);

        const results: {
          contactId: string;
          name: string;
          email: string;
          status: "sent" | "skipped";
        }[] = [];

        for (const contact of eligible) {
          try {
            // Gather service details for this contact
            let serviceDayOfWeek: string | undefined;
            let serviceFrequency: string | undefined;
            let servicePricePerVisit: string | undefined;
            let serviceNextVisitDate: string | undefined;

            try {
              const plans = await storage.getServicePlans(companyId, { contactId: contact.id });
              const activePlan = plans.find((p) => p.isActive) || plans[0];
              if (activePlan) {
                if (activePlan.dayOfWeek) {
                  // dayOfWeek is a string like "monday" — capitalize for display
                  serviceDayOfWeek =
                    activePlan.dayOfWeek.charAt(0).toUpperCase() + activePlan.dayOfWeek.slice(1);
                }
                serviceFrequency = activePlan.frequency ?? undefined;
                servicePricePerVisit = activePlan.pricePerVisit ?? undefined;
              }
            } catch (planErr) {
              console.warn(
                `[onboarding-welcome] Could not fetch service plan for contact ${contact.id}:`,
                planErr instanceof Error ? planErr.message : String(planErr)
              );
            }

            try {
              const { visits } = await storage.getVisitsForContact(companyId, contact.id, 50, 0);
              const upcomingVisit = visits
                .filter((v) => v.status === "scheduled" && v.scheduledDate)
                .sort(
                  (a, b) =>
                    new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()
                )[0];
              if (upcomingVisit?.scheduledDate) {
                serviceNextVisitDate = new Date(upcomingVisit.scheduledDate).toLocaleDateString(
                  "en-US",
                  { weekday: "long", year: "numeric", month: "long", day: "numeric" }
                );
              }
            } catch (visitErr) {
              console.warn(
                `[onboarding-welcome] Could not fetch visits for contact ${contact.id}:`,
                visitErr instanceof Error ? visitErr.message : String(visitErr)
              );
            }

            // Force email send even if suppressed (this is the batch welcome send)
            const provision = await provisionPortalAccess(contact.id, companyId, baseUrl, {
              sendEmail: true,
              serviceDetails: {
                dayOfWeek: serviceDayOfWeek,
                frequency: serviceFrequency,
                pricePerVisit: servicePricePerVisit,
                nextVisitDate: serviceNextVisitDate,
              },
            });

            results.push({
              contactId: contact.id,
              name: `${contact.firstName} ${contact.lastName}`.trim(),
              email: contact.email!,
              status: provision.emailSent ? "sent" : "skipped",
            });
          } catch (err) {
            console.error(`[onboarding-welcome] Failed to send for contact ${contact.id}:`, err);
            results.push({
              contactId: contact.id,
              name: `${contact.firstName} ${contact.lastName}`.trim(),
              email: contact.email!,
              status: "skipped",
            });
          }
        }

        const sentCount = results.filter((r) => r.status === "sent").length;
        const skippedCount = results.filter((r) => r.status === "skipped").length;

        // Mark as sent and disable suppression
        await storage.updateCompany(companyId, {
          clientNotificationsSuppressed: false,
          onboardingCompleteSentAt: new Date(),
        });

        res.json({
          success: true,
          sent: sentCount,
          skipped: skippedCount,
          total: eligible.length,
          results,
        });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.patch("/api/company", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role, userId } = await getCompanyContext(req);
      requireRole(role);
      const existing = await storage.getCompany(companyId);
      const validTimezones = [
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "America/Anchorage",
        "Pacific/Honolulu",
      ];
      const allowed = [
        "name",
        "email",
        "phone",
        "address",
        "startAddress",
        "startLatitude",
        "startLongitude",
        "logoUrl",
        "chargeTiming",
        "invoiceTheme",
        "remindersEnabled",
        "autoVisitsEnabled",
        "dashboardLayout",
        "settingsLayout",
        "dashboardNotes",
        "timezone",
        "reminderSettings",
        "invoiceReminderSettings",
        "roverAiEnabled",
        "slug",
        "leadWebhookSmsTemplate",
        "quoteAutoFollowUpEnabled",
        "quoteFollowUpSmsTemplate",
        "quoteFollowUpEmailEnabled",
        "quoteFollowUpEmailSubject",
        "quoteFollowUpEmailBody",
        "quoteFormLayout",
        "telnyxApiKey",
        "telnyxPhoneNumber",
        "telnyxMessagingProfileId",
        "venmoHandle",
        "maxStopsPerRoute",
        "country",
        "currency",
        "taxRatePercent",
        "billingCadence",
        "billingTrigger",
        "defaultPaymentBehavior",
        "reviewRequestEnabled",
        "googleReviewUrl",
        "reviewRequestAfterVisits",
        "reviewRequestCustomMessage",
        "reviewRouterEnabled",
        "clientNotificationsSuppressed",
        "onboardingCompleteSentAt",
        "passStripeFees",
        "requireCardOnSignup",
      ];
      const updates: Partial<Record<keyof InsertCompany, unknown>> = {};
      for (const key of allowed as (keyof InsertCompany)[]) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      if (updates.timezone && !validTimezones.includes(updates.timezone as string)) {
        return res.status(400).json({ error: "Invalid timezone" });
      }
      const validBillingCadences = ["per_visit", "weekly", "monthly", "manual"];
      const validBillingTriggers = ["after_job", "end_of_week", "end_of_month", "manual"];
      const validPaymentBehaviors = [
        "autopay_immediate",
        "autopay_scheduled",
        "send_invoice",
        "review_only",
      ];
      if (
        updates.billingCadence &&
        !validBillingCadences.includes(updates.billingCadence as string)
      ) {
        return res.status(400).json({ error: "Invalid billingCadence" });
      }
      if (
        updates.billingTrigger &&
        !validBillingTriggers.includes(updates.billingTrigger as string)
      ) {
        return res.status(400).json({ error: "Invalid billingTrigger" });
      }
      if (
        updates.defaultPaymentBehavior &&
        !validPaymentBehaviors.includes(updates.defaultPaymentBehavior as string)
      ) {
        return res.status(400).json({ error: "Invalid defaultPaymentBehavior" });
      }
      if (updates.slug !== undefined) {
        const cleanSlug = String(updates.slug)
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "")
          .replace(/^-|-$/g, "");
        if (!cleanSlug || cleanSlug.length < 3)
          return res.status(400).json({ error: "Slug must be at least 3 characters" });
        if (cleanSlug.length > 60)
          return res.status(400).json({ error: "Slug must be 60 characters or fewer" });
        const existingSlug = await storage.getCompanyBySlug(cleanSlug);
        if (existingSlug && existingSlug.id !== companyId)
          return res.status(409).json({ error: "This slug is already taken" });
        updates.slug = cleanSlug;
      }
      if (
        updates.telnyxApiKey &&
        typeof updates.telnyxApiKey === "string" &&
        updates.telnyxApiKey.length > 0
      ) {
        const { encrypt } = await import("../utils/encryption");
        updates.telnyxApiKey = encrypt(updates.telnyxApiKey);
      }
      if (updates.reminderSettings) {
        const validTimings = ["24h_before", "2h_before", "morning_of", "custom"];
        const validChannels = ["email", "sms", "both"];
        if (!Array.isArray(updates.reminderSettings)) {
          return res.status(400).json({ error: "reminderSettings must be an array" });
        }
        for (const rule of updates.reminderSettings) {
          if (!rule.id || typeof rule.id !== "string")
            return res.status(400).json({ error: "Each rule must have a string id" });
          if (!validTimings.includes(rule.timing))
            return res.status(400).json({ error: `Invalid timing: ${rule.timing}` });
          if (!validChannels.includes(rule.channel))
            return res.status(400).json({ error: `Invalid channel: ${rule.channel}` });
          if (!rule.template || typeof rule.template !== "string")
            return res.status(400).json({ error: "Each rule must have a template string" });
          if (
            rule.timing === "custom" &&
            (typeof rule.customHours !== "number" ||
              rule.customHours < 0.5 ||
              rule.customHours > 72)
          ) {
            return res
              .status(400)
              .json({ error: "Custom timing requires customHours between 0.5 and 72" });
          }
        }
      }
      if (updates.invoiceReminderSettings) {
        const s = updates.invoiceReminderSettings as Record<string, unknown>;
        if (
          !Array.isArray(s.preDueDays) ||
          s.preDueDays.some((d: unknown) => typeof d !== "number" || d < 0)
        ) {
          return res
            .status(400)
            .json({ error: "preDueDays must be an array of non-negative numbers" });
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
        const raw = String(updates.venmoHandle)
          .trim()
          .replace(/^@+/, "")
          .replace(/[^a-zA-Z0-9_.\-]/g, "");
        if (raw.length > 0 && raw.length > 50) {
          return res.status(400).json({ error: "Venmo handle must be 50 characters or fewer" });
        }
        updates.venmoHandle = raw || null;
      }
      const company = await storage.updateCompany(companyId, updates as Partial<InsertCompany>);
      // Mark the new logo as public so it can be served via /objects/ without auth.
      // Awaited so the ACL is committed before the response reaches the client,
      // preventing a transient 403 on the very first image load after upload.
      // Company logos are intentionally customer-facing (invoices, quotes, portal).
      if (updates.logoUrl && typeof updates.logoUrl === "string") {
        const publicAcl = { owner: userId, visibility: "public" as const };
        await _objStorage.trySetObjectEntityAclPolicy(updates.logoUrl, publicAcl).catch((err) => {
          console.warn("[Logo ACL] Failed to set public ACL on upload:", err?.message);
        });
      }
      auditLog(
        companyId,
        userId,
        "company",
        companyId,
        "update",

        {
          old: sanitizeCompany(existing as unknown as Record<string, unknown>),
          new: sanitizeCompany(company as unknown as Record<string, unknown>),
        },
        req.ip
      );
      res.json(sanitizeCompany(company));
    } catch (err) {
      handleError(res, err);
    }
  });

  // ── Demo Mode API ────────────────────────────────────────────────────────

  app.get("/api/demo/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const demoId = await getDemoCompanyId();
      const isDemo = demoId === companyId;
      if (!isDemo) return res.json({ isDemo: false });
      const company = await storage.getCompany(companyId);
      res.json({
        isDemo: true,
        settings: {
          unlimitedCredits: !!(company as Record<string, unknown>).demoUnlimitedCredits,
          bypassLimits: !!(company as Record<string, unknown>).demoBypassLimits,
          autoCompleteToday: !!(company as Record<string, unknown>).demoAutoCompleteToday,
          autoPayInvoices: !!(company as Record<string, unknown>).demoAutoPayInvoices,
          livePlaybackEnabled: !!(company as Record<string, unknown>).demoLivePlaybackEnabled,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/demo/settings", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const demoId = await getDemoCompanyId();
      if (demoId !== companyId) return res.status(403).json({ error: "Not a demo account" });
      const allowed = [
        "unlimitedCredits",
        "bypassLimits",
        "autoCompleteToday",
        "autoPayInvoices",
        "livePlaybackEnabled",
      ];
      const keyMap: Record<string, string> = {
        unlimitedCredits: "demoUnlimitedCredits",
        bypassLimits: "demoBypassLimits",
        autoCompleteToday: "demoAutoCompleteToday",
        autoPayInvoices: "demoAutoPayInvoices",
        livePlaybackEnabled: "demoLivePlaybackEnabled",
      };
      const updates: Partial<Record<keyof InsertCompany, unknown>> = {};
      for (const k of allowed) {
        const col = keyMap[k] as keyof InsertCompany;
        if (req.body[k] !== undefined) updates[col] = !!req.body[k];
      }
      const company = await storage.updateCompany(companyId, updates as Partial<InsertCompany>);
      res.json({ ok: true, company: sanitizeCompany(company) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/demo/run-auto-complete", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const demoId = await getDemoCompanyId();
      if (demoId !== companyId) return res.status(403).json({ error: "Not a demo account" });
      const { runDemoAutoComplete } = await import("../jobs/demo-auto-complete");
      await runDemoAutoComplete();
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/demo/run-auto-pay", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const demoId = await getDemoCompanyId();
      if (demoId !== companyId) return res.status(403).json({ error: "Not a demo account" });
      const { runDemoAutoPay } = await import("../jobs/demo-auto-pay");
      await runDemoAutoPay();
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });
  // ── End Demo Mode API ────────────────────────────────────────────────────

  app.get("/api/company/users", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const companyUsersList = await storage.getCompanyUsers(companyId);
      res.json(companyUsersList);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/company/team", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const companyUsersList = await storage.getCompanyUsers(companyId);
      const teamMembers = await Promise.all(
        companyUsersList
          .filter((cu) => cu.isActive)
          .map(async (cu) => {
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
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/company/team/:userId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role, userId: currentUserId } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const targetUserId = p(req.params.userId);
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
          const activeCount = activeMembers.filter((m) => m.isActive !== false).length;
          const company = await storage.getCompany(companyId);
          if (company?.stripeSubscriptionId) {
            reportMeteredUsageSet(company.stripeSubscriptionId, "user_seat", activeCount).catch(
              () => {}
            );
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[Usage] Failed to log seat removal:", message);
        }
      })();

      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/company/users", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const { email, name, role: userRole, phone } = req.body;
      const cu = await storage.createCompanyUser({
        email,
        name,
        role: userRole,
        phone,
        companyId,
      } as unknown as InsertCompanyUser);
      res.status(201).json(cu);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/company/team/:userId/reset-password",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role, userId: currentUserId } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);
        const targetUserId = p(req.params.userId);
        if (targetUserId === currentUserId) {
          return res
            .status(400)
            .json({ error: "Use the change password form to update your own password" });
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
        auditLog(companyId, currentUserId, "user", targetUserId, "update", {
          action: "password_reset",
          resetBy: currentUserId,
        });
        res.json({ success: true, message: "Password has been updated." });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

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

      const [
        todaysVisitsList,
        ,
        failedPayments,
        activeUsers,
        overdueInvoices,
        invoiceMonthRevenue,
        smsCountThisMonth,
        emailCountThisMonth,
        monthVisitsForRevenue,
      ] = await Promise.all([
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

      const todaysVisits = todaysVisitsList.length;

      const completedToday = todaysVisitsList.filter((v) => v.status === "completed").length;
      const scheduledToday = todaysVisitsList.filter((v) => v.status === "scheduled").length;
      const inProgressToday = todaysVisitsList.filter((v) => v.status === "in_progress").length;

      // Count distinct techs working today (via routes linked to today's visits)
      const todayRouteIds = Array.from(
        new Set(todaysVisitsList.map((v) => v.routeId).filter(Boolean))
      ) as string[];
      let techsWorking = 0;
      if (todayRouteIds.length > 0) {
        const techResult = await db
          .selectDistinct({ technicianId: routes.technicianId })
          .from(routes)
          .where(
            and(
              eq(routes.companyId, companyId),
              inArray(routes.id, todayRouteIds),
              isNotNull(routes.technicianId)
            )
          );
        techsWorking = techResult.length;
      }

      // Today's invoicing total (invoices created today)
      const todayStart = new Date(today + "T00:00:00");
      const tomorrowStart = new Date(today + "T00:00:00");
      tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      const todayInvoiceRows = await db
        .select({ total: sql<string>`COALESCE(SUM(${invoices.total}::numeric), 0)` })
        .from(invoices)
        .where(
          and(
            eq(invoices.companyId, companyId),
            gte(invoices.createdAt, todayStart),
            lt(invoices.createdAt, tomorrowStart)
          )
        );
      const todayInvoiceTotal = parseFloat(todayInvoiceRows[0]?.total ?? "0");

      const allActivePlans = await storage.getServicePlans(companyId, { isActive: true });
      const activePlans = allActivePlans.filter((p) => !p.isStopOnly);

      const stopOnlyOnlyContactIds = getStopOnlyOnlyContactIds(allActivePlans);
      const allActiveStatusContacts = await storage.getContacts(companyId, { status: "active" });
      const activeContacts = allActiveStatusContacts.filter(
        (c) => !stopOnlyOnlyContactIds.has(c.id)
      ).length;
      const activeServicePlans = activePlans.length;

      const allAddOnsMap = await storage.getAllServicePlanAddOnsForCompany(
        activePlans.map((p) => p.id)
      );
      let mrr = 0;
      for (const plan of activePlans) {
        const basePrice = parseFloat(plan.pricePerVisit) || 0;
        const addOns = allAddOnsMap.get(plan.id) || [];
        const addOnsTotal = addOns
          .filter((a) => a.isActive)
          .reduce((sum, a) => sum + (parseFloat(a.price) || 0), 0);
        const perVisit = basePrice + addOnsTotal;

        let visitsPerMonth = 0;
        switch (plan.frequency) {
          case "weekly":
            visitsPerMonth = 4.33;
            break;
          case "biweekly":
            visitsPerMonth = 2.17;
            break;
          case "monthly":
            visitsPerMonth = 1;
            break;
          case "onetime":
            visitsPerMonth = 0;
            break;
          default:
            visitsPerMonth = 4.33;
        }
        mrr += perVisit * visitsPerMonth;
      }
      mrr = Math.round(mrr * 100) / 100;

      let monthRevenue = invoiceMonthRevenue;
      if (monthRevenue === 0) {
        const planPriceMap = new Map(
          allActivePlans.map((p) => [p.id, parseFloat(p.pricePerVisit) || 0])
        );
        let earned = 0;
        for (const v of monthVisitsForRevenue) {
          if (v.status === "completed") earned += planPriceMap.get(v.servicePlanId) || 0;
        }
        monthRevenue = Math.round(earned * 100) / 100;
      }

      res.json({
        mrr,
        todaysVisits,
        todaysVisitBreakdown: {
          completed: completedToday,
          scheduled: scheduledToday,
          inProgress: inProgressToday,
        },
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
        techsWorking,
        todayInvoiceTotal,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(
    "/api/company/reminder-settings",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const company = await storage.getCompany(companyId);
        const reminderSettings = company?.reminderSettings || [
          {
            id: "default_24h",
            timing: "24h_before",
            channel: "sms",
            template:
              "Hi {firstName}, your service with {companyName} is scheduled for tomorrow at {propertyAddress}. Thank you!",
            isActive: true,
          },
        ];
        const invoiceReminderSettings = company?.invoiceReminderSettings || {
          preDueDays: [7, 2, 1, 0],
          overdueIntervalDays: 2,
          maxReminders: 10,
        };
        res.json({
          reminderSettings,
          invoiceReminderSettings,
          remindersEnabled: company?.remindersEnabled || false,
        });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get("/api/company/reminder-logs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = (page - 1) * limit;
      const [logs, countResult] = await Promise.all([
        db
          .select({
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
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(reminderLogs)
          .where(eq(reminderLogs.companyId, companyId)),
      ]);

      const contactIds = Array.from(new Set(logs.map((l) => l.contactId)));
      let contactMap = new Map<string, string>();
      if (contactIds.length > 0) {
        const contactRows = await db
          .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
          .from(contacts)
          .where(inArray(contacts.id, contactIds));
        contactMap = new Map(contactRows.map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim()]));
      }

      const enrichedLogs = logs.map((l) => ({
        ...l,
        contactName: contactMap.get(l.contactId) || "Unknown",
      }));

      res.json({ logs: enrichedLogs, total: countResult[0]?.total || 0, page, limit });
    } catch (err) {
      handleError(res, err);
    }
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
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/company/recent-activity", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const notifications = await storage.getNotifications(companyId, 10);
      res.json(
        notifications.map((n) => ({
          id: n.id,
          title: n.title,
          message: n.message,
          type: n.type,
          linkUrl: n.linkUrl,
          isRead: n.isRead,
          createdAt: n.createdAt,
        }))
      );
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(
    "/api/company/recent-communications",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);

        const [smsRows, emailRows] = await Promise.all([
          db
            .select()
            .from(messagesTable)
            .where(and(eq(messagesTable.companyId, companyId), eq(messagesTable.channel, "sms")))
            .orderBy(desc(messagesTable.createdAt))
            .limit(5),
          db
            .select()
            .from(messagesTable)
            .where(and(eq(messagesTable.companyId, companyId), eq(messagesTable.channel, "email")))
            .orderBy(desc(messagesTable.createdAt))
            .limit(5),
        ]);

        const contactCache = new Map<string, string>();
        const enrichWithContact = async (m: Message) => {
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
        };

        const recentSms = await Promise.all(smsRows.map(enrichWithContact));
        const recentEmails = await Promise.all(emailRows.map(enrichWithContact));

        res.json({ sms: recentSms, emails: recentEmails });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

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
      const planMap = new Map(allPlans.map((p) => [p.id, p]));
      const contactMap = new Map(allContacts.map((c) => [c.id, c]));
      const propMap = new Map(allProperties.map((p) => [p.id, p]));
      const upcoming = visits
        .filter((v) => v.status === "scheduled" && v.scheduledDate >= today)
        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
        .slice(0, 10)
        .map((v) => {
          const plan = planMap.get(v.servicePlanId!);
          const contact = plan ? contactMap.get(plan.contactId) : null;
          const prop = plan ? propMap.get(plan.propertyId) : null;
          return {
            id: v.id,
            scheduledDate: v.scheduledDate,
            status: v.status,
            contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : "Unknown",
            propertyAddress: prop?.streetAddress || "Unknown",
            servicePlanName: plan?.serviceName || "Service",
          };
        });
      res.json(upcoming);
    } catch (err) {
      handleError(res, err);
    }
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
      const data = (await resp.json()) as Record<string, unknown>;
      const daily = data.daily as Record<string, unknown[]> | undefined;
      const days = (daily?.time || []).map((date: unknown, i: number) => ({
        date: date as string,
        tempMax: daily?.temperature_2m_max?.[i] ?? null,
        tempMin: daily?.temperature_2m_min?.[i] ?? null,
        precipProbability: daily?.precipitation_probability_max?.[i] ?? null,
        weatherCode: daily?.weathercode?.[i] ?? null,
      }));
      res.json({ available: true, days });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/company/route-map-data", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      const tz = company?.timezone || "America/New_York";
      const routes = await storage.getRoutes(companyId);
      const now = new Date();
      const todayDow = now
        .toLocaleDateString("en-US", { weekday: "long", timeZone: tz })
        .toLowerCase();
      const todayDateStr = now.toLocaleDateString("en-CA", { timeZone: tz });
      const todayRoutes = routes.filter((r) => {
        if (r.date) {
          const routeDateStr =
            typeof r.date === "string" ? r.date : new Date(r.date).toISOString().split("T")[0];
          return routeDateStr === todayDateStr;
        }
        return (r.dayOfWeek || "").toLowerCase() === todayDow;
      });
      const allProperties = await storage.getProperties(companyId);
      const propMap = new Map(allProperties.map((p) => [p.id, p]));
      const routeData = await Promise.all(
        todayRoutes.map(async (route) => {
          const plans = await storage.getServicePlans(companyId, {
            routeId: route.id,
            isActive: true,
          });
          const coordinates = plans
            .sort((a, b) => (a.stopOrder || 0) - (b.stopOrder || 0))
            .map((p) => {
              const prop = propMap.get(p.propertyId);
              return prop
                ? {
                    lat: prop.latitude ? parseFloat(String(prop.latitude)) : null,
                    lng: prop.longitude ? parseFloat(String(prop.longitude)) : null,
                    address: prop.streetAddress || "",
                  }
                : null;
            })
            .filter(
              (c): c is { lat: number; lng: number; address: string } =>
                c !== null && c.lat !== null && c.lng !== null
            );
          return {
            id: route.id,
            name: route.name,
            color: route.color || "#4CAF50",
            stopCount: plans.length,
            coordinates,
          };
        })
      );
      res.json({
        routes: routeData,
        startLat: company?.startLatitude ? parseFloat(String(company.startLatitude)) : null,
        startLng: company?.startLongitude ? parseFloat(String(company.startLongitude)) : null,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(
    "/api/company/growth-opportunities",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const { getGrowthOpportunities } = await import("../services/opportunity-engine");
        const results = await getGrowthOpportunities(companyId, 10);
        const totalCount = results.reduce((s, r) => s + r.count, 0);
        const totalUplift = results.reduce((s, r) => s + r.totalUplift, 0);
        res.json({ contacts: results, totalCount, totalUplift });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

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
        const allPlansForRevenue =
          activePlans.length > 0 ? activePlans : await storage.getServicePlans(companyId, {});
        const planPriceMap = new Map(
          allPlansForRevenue.map((p) => [p.id, parseFloat(p.pricePerVisit) || 0])
        );
        for (const v of monthCompletedVisits) {
          if (v.status === "completed") {
            earnedRevenue += planPriceMap.get(v.servicePlanId) || 0;
          }
        }
      }
      const monthRevenue =
        invoiceRevenue > 0 ? invoiceRevenue : Math.round(earnedRevenue * 100) / 100;

      const dashboardVisits = [...overdueVisits, ...todaysVisitsList];

      let activePlansMonthlyValue = 0;
      for (const plan of activePlans.filter((p) => !p.isStopOnly)) {
        const basePrice = parseFloat(plan.pricePerVisit) || 0;
        let visitsPerMonth = 0;
        switch (plan.frequency) {
          case "weekly":
            visitsPerMonth = 4.33;
            break;
          case "biweekly":
            visitsPerMonth = 2.17;
            break;
          case "monthly":
            visitsPerMonth = 1;
            break;
          default:
            visitsPerMonth = 0;
        }
        activePlansMonthlyValue += basePrice * visitsPerMonth;
      }

      const weekVisits = await storage.getVisitsForDateRange(companyId, weekStartStr, weekEndStr);
      const scheduledThisWeek = weekVisits.filter(
        (v) => v.status === "scheduled" || v.status === "in_progress"
      ).length;

      const allInvoices = await storage.getInvoices(companyId);
      const awaitingPayment = allInvoices.filter((i) => ["pending", "sent"].includes(i.status));
      const awaitingPaymentTotal = awaitingPayment.reduce(
        (sum, i) => sum + (parseFloat(i.total) || 0),
        0
      );

      const overdueInvoices = allInvoices.filter(
        (i) => ["pending", "sent"].includes(i.status) && i.dueDate < today
      );
      const overdueTotal = overdueInvoices.reduce((sum, i) => sum + (parseFloat(i.total) || 0), 0);

      const receivablesByContact = new Map<string, { contactId: string; total: number }>();
      for (const inv of awaitingPayment) {
        const existing = receivablesByContact.get(inv.contactId) || {
          contactId: inv.contactId,
          total: 0,
        };
        existing.total += parseFloat(inv.total) || 0;
        receivablesByContact.set(inv.contactId, existing);
      }
      const sortedReceivables = Array.from(receivablesByContact.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);
      const topReceivables = await Promise.all(
        sortedReceivables.map(async (r) => {
          const contact = await storage.getContact(r.contactId, companyId);
          return {
            contactId: r.contactId,
            contactName: contact ? `${contact.firstName} ${contact.lastName}` : "Unknown",
            total: Math.round(r.total * 100) / 100,
          };
        })
      );

      const allPlans =
        activePlans.length > 0 ? activePlans : await storage.getServicePlans(companyId, {});
      const planMap = new Map(allPlans.map((p) => [p.id, p]));

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
          const results = await Promise.all(
            Array.from(contactIds).map((cId) => storage.getContact(cId, companyId))
          );
          Array.from(contactIds).forEach((cId, i) => {
            if (results[i])
              cache.set(cId, { firstName: results[i]!.firstName, lastName: results[i]!.lastName });
          });
          return cache;
        })(),
        (async () => {
          const cache = new Map<string, string>();
          const results = await Promise.all(
            Array.from(propertyIds).map((pId) => storage.getProperty(pId, companyId))
          );
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
        const frequencyLabel = plan
          ? plan.frequency.charAt(0).toUpperCase() + plan.frequency.slice(1)
          : "";
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

      const upcomingThisWeek = weekVisits.filter(
        (v) =>
          v.scheduledDate >= today &&
          v.scheduledDate <= weekEndStr &&
          (v.status === "scheduled" || v.status === "in_progress")
      );
      let upcomingWeekValue = 0;
      for (const v of upcomingThisWeek) {
        const plan = planMap.get(v.servicePlanId);
        upcomingWeekValue += plan && !plan.isStopOnly ? parseFloat(plan.pricePerVisit) || 0 : 0;
      }

      const nonStopOnlyPlans = activePlans.filter((p) => !p.isStopOnly);
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
    } catch (err) {
      handleError(res, err);
    }
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

      if (period === "3m") {
        lookbackMonths = 3;
        periodLabel = "Last 3 Months";
      } else if (period === "6m") {
        lookbackMonths = 6;
        periodLabel = "Last 6 Months";
      } else if (period === "9m") {
        lookbackMonths = 9;
        periodLabel = "Last 9 Months";
      } else if (period === "12m") {
        lookbackMonths = 12;
        periodLabel = "Last 12 Months";
      } else if (period === "q1") {
        const yr = now.getFullYear();
        lookbackMonths = 0;
        periodLabel = `Q1 ${yr}`;
      } else if (period === "q2") {
        const yr = now.getFullYear();
        lookbackMonths = 0;
        periodLabel = `Q2 ${yr}`;
      } else if (period === "q3") {
        const yr = now.getFullYear();
        lookbackMonths = 0;
        periodLabel = `Q3 ${yr}`;
      } else if (period === "q4") {
        const yr = now.getFullYear();
        lookbackMonths = 0;
        periodLabel = `Q4 ${yr}`;
      } else if (period === "annual") {
        lookbackMonths = 0;
        periodLabel = `${now.getFullYear()} Annual`;
      } else if (period === "proj3") {
        lookbackMonths = 3;
        projectionMonths = 3;
        periodLabel = "3-Month Projection";
      } else if (period === "proj6") {
        lookbackMonths = 6;
        projectionMonths = 6;
        periodLabel = "6-Month Projection";
      } else if (period === "proj12") {
        lookbackMonths = 12;
        projectionMonths = 12;
        periodLabel = "12-Month Projection";
      }

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
        const isFuture =
          m.year > currentYear || (m.year === currentYear && m.month > currentMonthIdx);
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
            const chartPlanMap = new Map(
              allPlansForChart.map((p) => [p.id, parseFloat(p.pricePerVisit) || 0])
            );
            for (const v of periodVisits) {
              if (v.status === "completed") {
                revenue += chartPlanMap.get(v.servicePlanId) || 0;
              }
            }
            revenue = Math.round(revenue * 100) / 100;
          }
          revenueValues.push(revenue);
          monthlyRevenue.push({
            month:
              d.toLocaleString("default", { month: "short", year: "numeric" }) +
              (isCurrent ? " (current)" : ""),
            revenue,
          });
        }
      }

      let projections: { month: string; revenue: number; projected: boolean }[] = [];
      let projectedMonthlyValue: number | null = null;
      if (projectionMonths > 0) {
        const allActivePlansForProjection = await storage.getServicePlans(companyId, {
          isActive: true,
        });
        let monthlyBookedEstimate = 0;
        for (const plan of allActivePlansForProjection.filter((p) => !p.isStopOnly)) {
          const price = parseFloat(plan.pricePerVisit || "0");
          const planAddOns = await storage.getServicePlanAddOns(plan.id);
          const addOnsPrice = planAddOns
            .filter((a) => a.isActive)
            .reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
          const perVisit = price + addOnsPrice;
          if (plan.frequency === "weekly") monthlyBookedEstimate += perVisit * 4.33;
          else if (plan.frequency === "biweekly") monthlyBookedEstimate += perVisit * 2.17;
          else if (plan.frequency === "monthly") monthlyBookedEstimate += perVisit;
        }

        const recentAvg =
          revenueValues.length > 0
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
        const thisStart = new Date(now.getFullYear(), now.getMonth(), 1)
          .toISOString()
          .split("T")[0];
        const thisEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
          .toISOString()
          .split("T")[0];
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
          const addOnsPrice = planAddOns
            .filter((a) => a.isActive)
            .reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
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
        if (inv.status === "sent" || inv.status === "pending")
          totalOutstanding += parseFloat(inv.total);
      }

      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split("T")[0];
      const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        .toISOString()
        .split("T")[0];
      const thisMonthVisits = await storage.getVisitsForDateRange(
        companyId,
        thisMonthStart,
        thisMonthEnd
      );
      const visitsCompleted = thisMonthVisits.filter((v) => v.status === "completed").length;
      const visitsScheduled = thisMonthVisits.filter((v) => v.status === "scheduled").length;
      const visitsSkipped = thisMonthVisits.filter((v) => v.status === "skipped").length;

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
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/analytics/dashboard", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      const tz = company?.timezone || "America/New_York";
      const now = new Date();

      const allContactsRaw = await storage.getContacts(companyId);
      const allInvoices = await storage.getInvoices(companyId);

      const allActivePlansForAnalytics = await storage.getServicePlans(companyId, {
        isActive: true,
      });
      const stopOnlyContactIds = getStopOnlyOnlyContactIds(allActivePlansForAnalytics);
      const allContacts = allContactsRaw.filter((c) => !stopOnlyContactIds.has(c.id));

      const allPlansForAnalyticsRevenue = await storage.getServicePlans(companyId, {});
      const analyticsPlanPriceMap = new Map(
        allPlansForAnalyticsRevenue.map((p) => [p.id, parseFloat(p.pricePerVisit) || 0])
      );

      const monthlyRevenue: { month: string; revenue: number }[] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const start = d.toISOString().split("T")[0];
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0];
        let revenue = await storage.getRevenueForPeriod(companyId, start, end, tz);
        if (revenue === 0) {
          const periodVisits = await storage.getVisitsForDateRange(companyId, start, end);
          for (const v of periodVisits) {
            if (v.status === "completed")
              revenue += analyticsPlanPriceMap.get(v.servicePlanId) || 0;
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
      const contactsBeforeWindow = allContacts.filter((c) => {
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
        now.toISOString().split("T")[0]
      );
      const dayNames = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const routePerformance = dayNames.map((day) => ({
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
      const weeklyVisits: {
        week: string;
        completed: number;
        total: number;
        completionRate: number;
      }[] = [];
      const currentMonday = new Date(now);
      const dayOfWeek = currentMonday.getDay();
      const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      currentMonday.setDate(currentMonday.getDate() - diffToMonday);
      currentMonday.setHours(0, 0, 0, 0);
      for (let w = 7; w >= 0; w--) {
        const weekStart = new Date(currentMonday);
        weekStart.setDate(weekStart.getDate() - w * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const ws = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`;
        const we = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, "0")}-${String(weekEnd.getDate()).padStart(2, "0")}`;
        const weekVisits = await storage.getVisitsForDateRange(companyId, ws, we);
        const comp = weekVisits.filter((v) => v.status === "completed").length;
        const tot = weekVisits.length;
        weeklyVisits.push({
          week: `${weekStart.toLocaleString("default", { month: "short" })} ${weekStart.getDate()}`,
          completed: comp,
          total: tot,
          completionRate: tot > 0 ? Math.round((comp / tot) * 100) : 0,
        });
      }

      // --- Client Retention ---
      const activeContacts = allContacts.filter((c) => c.status === "active").length;
      const pausedContacts = allContacts.filter((c) => c.status === "paused").length;
      const cancelledContacts = allContacts.filter((c) => c.status === "cancelled").length;
      const leadContacts = allContacts.filter((c) => c.status === "lead").length;
      const estimateContacts = allContacts.filter((c) => c.status === "estimate").length;
      const totalContacts = allContacts.length;
      const retentionRate =
        totalContacts > 0
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
      const paidInvoices = allInvoices.filter((i) => i.status === "paid");
      const totalPaidRevenue = paidInvoices.reduce((sum, i) => sum + parseFloat(i.total), 0);
      const avgInvoiceAmount = paidInvoices.length > 0 ? totalPaidRevenue / paidInvoices.length : 0;

      const allServicePlans = await storage.getServicePlans(companyId);
      const activeServicePlans = allServicePlans.filter((sp) => sp.isActive && !sp.isStopOnly);
      const avgPricePerVisit =
        activeServicePlans.length > 0
          ? activeServicePlans.reduce((sum, sp) => sum + parseFloat(sp.pricePerVisit), 0) /
            activeServicePlans.length
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
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split("T")[0];
      const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        .toISOString()
        .split("T")[0];
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        .toISOString()
        .split("T")[0];
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
        .toISOString()
        .split("T")[0];
      const thisMonthRev = await storage.getRevenueForPeriod(
        companyId,
        thisMonthStart,
        thisMonthEnd,
        tz
      );
      const lastMonthRev = await storage.getRevenueForPeriod(
        companyId,
        lastMonthStart,
        lastMonthEnd,
        tz
      );
      const revenueGrowth =
        lastMonthRev > 0 ? Math.round(((thisMonthRev - lastMonthRev) / lastMonthRev) * 100) : 0;

      const totalOutstanding = allInvoices
        .filter((i) => i.status === "sent" || i.status === "pending")
        .reduce((sum, i) => sum + parseFloat(i.total), 0);

      // --- Service Day Distribution ---
      const serviceDayCounts: Record<string, number> = {};
      const daysOrder = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ];
      for (const day of daysOrder) serviceDayCounts[day] = 0;
      for (const c of allContacts) {
        if (c.serviceDay) {
          serviceDayCounts[c.serviceDay] = (serviceDayCounts[c.serviceDay] || 0) + 1;
        }
      }
      const serviceDayDistribution = daysOrder.map((day) => ({
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
          completionRate:
            recentVisits.length > 0
              ? Math.round(
                  (recentVisits.filter((v) => v.status === "completed").length /
                    recentVisits.length) *
                    100
                )
              : 0,
          totalVisitsLast30Days: recentVisits.length,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/analytics/timing-metrics", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { sql: sqlTag } = await import("drizzle-orm");
      const result = await db.execute(sqlTag`
        SELECT
          ROUND(AVG(EXTRACT(EPOCH FROM (started_at - en_route_at)) / 60)::numeric, 1) AS avg_travel_minutes,
          COUNT(*) FILTER (WHERE en_route_at IS NOT NULL AND started_at IS NOT NULL AND started_at > en_route_at) AS travel_sample_size,
          ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60)::numeric, 1) AS avg_yard_minutes,
          COUNT(*) FILTER (WHERE started_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at > started_at) AS yard_sample_size
        FROM visits
        WHERE company_id = ${companyId}
          AND status = 'completed'
      `);
      const row = (result.rows?.[0] ?? {}) as Record<string, unknown>;
      res.json({
        avgTravelMinutes: row.avg_travel_minutes != null ? Number(row.avg_travel_minutes) : null,
        travelSampleSize: Number(row.travel_sample_size ?? 0),
        avgYardMinutes: row.avg_yard_minutes != null ? Number(row.avg_yard_minutes) : null,
        yardSampleSize: Number(row.yard_sample_size ?? 0),
      });
    } catch (err) {
      handleError(res, err);
    }
  });
}
