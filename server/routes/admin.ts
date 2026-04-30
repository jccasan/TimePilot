import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { db } from "../db";
import { sql, eq, and, gte, desc } from "drizzle-orm";
import {
  users,
  companyUsers,
  companies,
  contacts,
  properties,
  routes,
  adminUsers,
  adminSessions,
  adminAuditLogs,
  subscriptionTiers,
  messages as messagesTable,
  messages,
  usageEvents,
  auditTrail,
  visits,
} from "@shared/schema";
import {
  getUserById,
  getUserByEmail,
  createPasswordResetToken,
  createUserWithTempPassword,
} from "../services/app-auth";
import {
  sendEmail,
  sendAdminSignupNotification,
  buildWelcomeEmailContent,
} from "../services/email";
import {
  isStripeConfigured,
  migrateCustomerToConnectedAccount,
  isCustomerOnPlatform,
} from "../services/stripe";
import { registerRetellWebhook, getRetellAgentWebhookUrl, getAppBaseUrl } from "../services/retell";
import { TIER_CONFIG } from "@shared/schema";

import {
  isAuthenticated,
  isAdmin,
  getCompanyContext,
  handleError,
  auditLog,
  p,
  notify,
  seedDefaultLeadSources,
} from "./shared";

export async function registerAdminRoutes(app: Express): Promise<void> {
  // ================ Admin (Platform-level) Routes ================
  // Seed admin user on startup
  import("../services/admin-auth").then(({ seedAdminUser }) => {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_INITIAL_PASSWORD;
    if (email && password) {
      seedAdminUser(email, password).catch(console.error);
    }
  });

  app.post("/api/admin/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password)
        return res.status(400).json({ error: "Email and password required" });
      const { loginAdmin } = await import("../services/admin-auth");
      const result = await loginAdmin(email, password);
      const ip =
        req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
        req.socket.remoteAddress ||
        "unknown";
      if ("error" in result) {
        await db
          .insert(adminAuditLogs)
          .values({ adminEmail: email, action: "login_failed", ipAddress: ip })
          .catch(() => {});
        return res.status(401).json({ error: result.error });
      }
      const [adminUser] = await db
        .select({ id: adminUsers.id })
        .from(adminUsers)
        .where(eq(adminUsers.email, email));
      await db
        .insert(adminAuditLogs)
        .values({
          adminUserId: adminUser?.id,
          adminEmail: email,
          action: "login_success",
          ipAddress: ip,
        })
        .catch(() => {});
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/admin/logout", async (req: Request, res: Response) => {
    try {
      const token = req.headers["x-admin-token"] as string;
      if (token) {
        const { logoutAdmin } = await import("../services/admin-auth");
        await logoutAdmin(token);
      }
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/admin/change-password", isAdmin, async (req: Request, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword)
        return res.status(400).json({ error: "Both passwords required" });
      const { changeAdminPassword } = await import("../services/admin-auth");
      const result = await changeAdminPassword(
        (req as any).adminUser.userId,
        currentPassword,
        newPassword
      );
      if (result.error) return res.status(400).json({ error: result.error });
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/admin/check", isAdmin, async (req: Request, res: Response) => {
    const { isPasswordExpired } = await import("../services/admin-auth");
    const expired = await isPasswordExpired((req as any).adminUser.userId);
    res.json({ isAdmin: true, email: (req as any).adminUser.email, mustChangePassword: expired });
  });

  app.get("/api/admin/stats", isAdmin, async (_req: Request, res: Response) => {
    try {
      const stats = await storage.getPlatformStats();
      res.json(stats);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Platform admin: view ALL message exceptions (including zero-candidate items)
  app.get("/api/admin/message-exceptions", isAdmin, async (req: Request, res: Response) => {
    try {
      const resolved =
        req.query.resolved === "true" ? true : req.query.resolved === "false" ? false : undefined;
      const exceptions = await storage.getMessageExceptions({ resolved });
      res.json(exceptions);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/admin/message-exceptions/:id/resolve",
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = req.body;
        if (!companyId) return res.status(400).json({ error: "companyId is required" });
        const adminUserId = (req as any).adminUser.userId;
        const exception = await storage.resolveMessageException(
          p(req.params.id),
          adminUserId,
          companyId,
          true
        );
        if (!exception)
          return res.status(404).json({ error: "Exception not found or already resolved" });

        if (exception.body && exception.fromAddress) {
          try {
            const allContacts = await storage.getContacts(companyId);
            const fromDigits = exception.fromAddress.replace(/\D/g, "");
            const matchedContact = allContacts.find((c) => {
              const cDigits = (c.phone || "").replace(/\D/g, "");
              return (
                cDigits.length >= 10 &&
                fromDigits.length >= 10 &&
                fromDigits.endsWith(cDigits.slice(-10))
              );
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
              const { isSharedNumber } = await import("../services/sms");
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
            console.error(
              `[Admin MessageException] Resolved exception ${p(req.params.id)} but message delivery failed:`,
              msgErr
            );
          }
        }
        res.json(exception);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/admin/message-exceptions/:id/dismiss",
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        const adminUserId = (req as any).adminUser.userId;
        const exception = await storage.dismissMessageException(p(req.params.id), adminUserId);
        if (!exception)
          return res.status(404).json({ error: "Exception not found or already resolved" });
        res.json(exception);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

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
            and(
              sql`(${users.lastLoginAt} IS NULL OR ${users.lastLoginAt} < ${cutoff})`,
              eq(companies.demoUnlimitedCredits, false)
            )
          );
        result[`${days}d`] = rows;
      }
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/admin/companies", isAdmin, async (_req: Request, res: Response) => {
    try {
      const allCompanies = await storage.getAllCompanies();
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const { TIER_CONFIG: tierCfg } = await import("@shared/schema");

      const enriched = await Promise.all(
        allCompanies.map(async (c) => {
          const companyUsersList = await storage.getCompanyUsers(c.id);
          const activeUserCount = companyUsersList.filter((cu) => cu.isActive).length;
          const contactList = await storage.getContacts(c.id);

          const smsResult = await db
            .select({ total: sql<number>`COALESCE(SUM(${usageEvents.quantity}), 0)` })
            .from(usageEvents)
            .where(
              and(
                eq(usageEvents.companyId, c.id),
                eq(usageEvents.eventType, "sms_segment"),
                gte(usageEvents.recordedAt, periodStart)
              )
            );
          const voiceResult = await db
            .select({ total: sql<number>`COALESCE(SUM(${usageEvents.quantity}), 0)` })
            .from(usageEvents)
            .where(
              and(
                eq(usageEvents.companyId, c.id),
                eq(usageEvents.eventType, "voice_minute"),
                gte(usageEvents.recordedAt, periodStart)
              )
            );

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
        })
      );
      res.json(enriched);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/admin/companies/:id", isAdmin, async (req: Request, res: Response) => {
    try {
      const company = await storage.getCompany(p(req.params.id));
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
      res.json({
        ...company,
        users: usersWithDetails,
        contacts: contactList,
        invoices: invoiceList,
        notes,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/admin/companies", isAdmin, async (req: Request, res: Response) => {
    try {
      const { companyName, ownerEmail, ownerFirstName, ownerLastName, subscriptionTier } = req.body;
      if (!companyName || !ownerEmail || !ownerFirstName) {
        return res
          .status(400)
          .json({ error: "Company name, owner email, and owner first name are required" });
      }
      if (typeof companyName !== "string" || companyName.trim().length < 2) {
        return res.status(400).json({ error: "Company name must be at least 2 characters" });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(ownerEmail)) {
        return res.status(400).json({ error: "Invalid email address" });
      }
      const validTiers = [
        "free_trial",
        "tier_starter",
        "tier_1",
        "tier_1_3",
        "tier_3_5",
        "tier_6_10",
        "tier_10_plus",
      ];
      const tier = validTiers.includes(subscriptionTier) ? subscriptionTier : "tier_1";

      let user = await getUserByEmail(ownerEmail);
      let tempPassword: string | null = null;
      let isExistingUser = false;

      if (!user) {
        const crypto = await import("crypto");
        tempPassword = crypto.randomBytes(6).toString("base64url");
        user = await createUserWithTempPassword(
          ownerEmail,
          ownerFirstName,
          ownerLastName || "",
          tempPassword
        );
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
          const _adminWelcome = buildWelcomeEmailContent({
            firstName: ownerFirstName,
            companyName,
            appUrl,
            email: ownerEmail,
            tempPassword,
          });
          await sendEmail({
            companyId: company.id,
            to: ownerEmail,
            subject: _adminWelcome.subject,
            text: _adminWelcome.text,
            html: _adminWelcome.html,
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
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/admin/migrate-stripe-customers", isAdmin, async (req: Request, res: Response) => {
    try {
      if (!isStripeConfigured()) return res.status(400).json({ error: "Stripe is not configured" });

      const dryRun = req.body?.dryRun === true;
      const allCompanies = await storage.listCompanies();
      const results: Array<{
        companyId: string;
        companyName: string;
        migratedContacts: number;
        skippedContacts: number;
        errors: string[];
      }> = [];

      for (const company of allCompanies) {
        if (!company.stripeConnectOnboarded || !company.stripeConnectAccountId) continue;

        const contacts = await storage.getContacts(company.id);
        const companyResult = {
          companyId: company.id,
          companyName: company.name,
          migratedContacts: 0,
          skippedContacts: 0,
          errors: [] as string[],
        };

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
              console.log(
                `[Stripe Migration] Skipped contact ${contact.id} — customer ${contact.stripeCustomerId} not found on platform (already migrated)`
              );
            } else {
              await storage.updateContact(contact.id, company.id, {
                stripeCustomerId: migrationResult.newCustomerId,
              });
              companyResult.migratedContacts++;
              const statusLabel =
                migrationResult.status === "partial"
                  ? " (PARTIAL — some payment methods failed)"
                  : "";
              console.log(
                `[Stripe Migration] Migrated contact ${contact.id} (${contact.firstName} ${contact.lastName}): ${contact.stripeCustomerId} → ${migrationResult.newCustomerId} (${migrationResult.migratedPaymentMethods}/${migrationResult.totalPaymentMethods} payment methods)${statusLabel}`
              );
              if (migrationResult.failedPaymentMethods.length > 0) {
                companyResult.errors.push(
                  `Contact ${contact.id}: partial PM migration — failed: ${migrationResult.failedPaymentMethods.join(", ")}`
                );
              }
            }
          } catch (migErr: any) {
            companyResult.errors.push(`Contact ${contact.id}: ${migErr.message}`);
            console.error(
              `[Stripe Migration] Failed to migrate contact ${contact.id}: ${migErr.message}`
            );
          }
        }

        results.push(companyResult);
      }

      const totalMigrated = results.reduce((sum, r) => sum + r.migratedContacts, 0);
      const totalSkipped = results.reduce((sum, r) => sum + r.skippedContacts, 0);
      const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
      res.json({ dryRun, totalMigrated, totalSkipped, totalErrors, results });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch(
    "/api/admin/companies/:id/notifications",
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        const company = await storage.getCompany(p(req.params.id));
        if (!company) return res.status(404).json({ error: "Company not found" });
        const { clientNotificationsSuppressed } = req.body;
        if (typeof clientNotificationsSuppressed !== "boolean") {
          return res.status(400).json({ error: "clientNotificationsSuppressed must be a boolean" });
        }
        await storage.updateCompany(p(req.params.id), { clientNotificationsSuppressed });
        console.log(
          `[admin] Set clientNotificationsSuppressed=${clientNotificationsSuppressed} for company ${p(req.params.id)} (${company.name})`
        );
        res.json({
          success: true,
          companyId: p(req.params.id),
          name: company.name,
          clientNotificationsSuppressed,
        });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/admin/companies/:id/resend-welcome",
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        const company = await storage.getCompany(p(req.params.id));
        if (!company) return res.status(404).json({ error: "Company not found" });
        const companyUserRecords = await storage.getCompanyUsers(company.id);
        const ownerEntry = companyUserRecords.find((cu: { role: string }) => cu.role === "owner");
        if (!ownerEntry) return res.status(404).json({ error: "No owner found for company" });
        const owner = await getUserById((ownerEntry as { userId: string }).userId);
        if (!owner || !owner.email)
          return res.status(404).json({ error: "Owner user record not found" });
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = req.headers.host || "app.scoopilot.com";
        const appUrl = `${protocol}://${host}`;
        const firstName = owner.firstName || owner.email.split("@")[0];
        const welcome = buildWelcomeEmailContent({ firstName, companyName: company.name, appUrl });
        const result = await sendEmail({
          companyId: company.id,
          to: owner.email,
          subject: welcome.subject,
          text: welcome.text,
          html: welcome.html,
        });
        if (!result.success) return res.status(500).json({ error: result.error });
        console.log(`[Admin] Resent welcome email to ${owner.email} for company "${company.name}"`);
        res.json({ success: true, sentTo: owner.email });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.patch(
    "/api/admin/companies/:id/subscription",
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        const { tier, subscriptionStatus, trialEndsAt, customMaxUsers } = req.body;
        const validTiers = [
          "free_trial",
          "tier_starter",
          "tier_1",
          "tier_1_3",
          "tier_3_5",
          "tier_6_10",
          "tier_10_plus",
        ];
        if (!tier || !validTiers.includes(tier))
          return res.status(400).json({ error: "Invalid tier" });
        const validStatuses = ["active", "trialing", "past_due", "cancelled", "suspended"];
        if (subscriptionStatus !== undefined && !validStatuses.includes(subscriptionStatus)) {
          return res.status(400).json({ error: "Invalid subscription status" });
        }
        const opts: {
          subscriptionStatus?: string;
          trialEndsAt?: Date | null;
          customMaxUsers?: number | null;
        } = {};
        if (subscriptionStatus !== undefined) opts.subscriptionStatus = subscriptionStatus;
        if (trialEndsAt !== undefined)
          opts.trialEndsAt = trialEndsAt ? new Date(trialEndsAt) : null;
        if (customMaxUsers !== undefined)
          opts.customMaxUsers = customMaxUsers === null ? null : parseInt(customMaxUsers);
        const updated = await storage.updateCompanySubscription(p(req.params.id), tier, opts);
        await logAdminAudit(req, "change_subscription", "company", p(req.params.id), {
          tier,
          subscriptionStatus,
          trialEndsAt,
          customMaxUsers,
        });
        res.json(updated);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post("/api/admin/companies/:id/cancel", isAdmin, async (req: Request, res: Response) => {
    try {
      const company = await storage.getCompany(p(req.params.id));
      if (!company) return res.status(404).json({ error: "Company not found" });
      if (company.subscriptionStatus === "cancelled") {
        return res.status(400).json({ error: "Account is already cancelled" });
      }
      if ((company as any).cancelAtPeriodEnd) {
        return res.status(400).json({ error: "Account cancellation is already scheduled" });
      }
      // Cancel Stripe subscription if one exists — schedule at period end so tenant keeps access
      if (company.stripeSubscriptionId) {
        let scheduledCancelAt: Date | null = null;
        try {
          const StripeLib = (await import("stripe")).default;
          const stripeKey = process.env.STRIPE_SECRET_KEY;
          if (stripeKey) {
            const stripeInstance = new StripeLib(stripeKey, {
              apiVersion: "2026-01-28.clover" as any,
            });
            const updated = await stripeInstance.subscriptions.update(
              company.stripeSubscriptionId,
              { cancel_at_period_end: true }
            );
            if (updated.cancel_at) scheduledCancelAt = new Date(updated.cancel_at * 1000);
            console.log(
              `[Admin] Scheduled Stripe subscription ${company.stripeSubscriptionId} for cancellation at period end (${scheduledCancelAt?.toISOString()}) for company "${company.name}"`
            );
          }
        } catch (stripeErr: any) {
          if (stripeErr?.code !== "resource_missing") {
            console.warn(
              `[Admin] Stripe cancel_at_period_end failed for ${company.name}:`,
              stripeErr.message
            );
          }
        }
        // Mark as pending cancellation in DB — status stays active so tenant keeps access
        await db
          .update(companies)
          .set({ cancelAtPeriodEnd: true, cancelAt: scheduledCancelAt } as any)
          .where(eq(companies.id, p(req.params.id)));
        await logAdminAudit(req, "cancel_account_scheduled", "company", p(req.params.id), {
          reason: req.body.reason || null,
          cancelAt: scheduledCancelAt,
        });
        console.log(
          `[Admin] Account "${company.name}" (${p(req.params.id)}) scheduled for cancellation at period end by ${(req as any).adminUser?.email}`
        );
        return res.json({ ok: true, companyName: company.name, scheduledCancelAt });
      }
      // No Stripe subscription — immediately cancel (manual billing)
      await storage.updateCompanySubscription(
        p(req.params.id),
        company.subscriptionTier || "free_trial",
        {
          subscriptionStatus: "cancelled",
        }
      );
      await db
        .update(companies)
        .set({ canceledAt: new Date() })
        .where(eq(companies.id, p(req.params.id)));
      await logAdminAudit(req, "cancel_account", "company", p(req.params.id), {
        reason: req.body.reason || null,
      });
      console.log(
        `[Admin] Account "${company.name}" (${p(req.params.id)}) cancelled immediately (no Stripe sub) by ${(req as any).adminUser?.email}`
      );
      res.json({ ok: true, companyName: company.name });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/admin/companies/:id/reactivate", isAdmin, async (req: Request, res: Response) => {
    try {
      const company = await storage.getCompany(p(req.params.id));
      if (!company) return res.status(404).json({ error: "Company not found" });
      if (!(company as any).cancelAtPeriodEnd) {
        return res
          .status(400)
          .json({ error: "Account does not have a scheduled cancellation to undo" });
      }
      if (company.stripeSubscriptionId) {
        const stripeKey = process.env.STRIPE_SECRET_KEY;
        if (stripeKey) {
          try {
            const StripeLib = (await import("stripe")).default;
            const stripeInstance = new StripeLib(stripeKey, {
              apiVersion: "2026-01-28.clover" as any,
            });
            await stripeInstance.subscriptions.update(company.stripeSubscriptionId, {
              cancel_at_period_end: false,
            });
            console.log(
              `[Admin] Reversed scheduled cancellation for Stripe subscription ${company.stripeSubscriptionId} for company "${company.name}"`
            );
          } catch (stripeErr: any) {
            if (stripeErr?.code === "resource_missing") {
              console.warn(
                `[Admin] Stripe subscription not found for ${company.name}, clearing local state only`
              );
            } else {
              console.error(
                `[Admin] Stripe reactivate failed for ${company.name}:`,
                stripeErr.message
              );
              return res.status(502).json({
                error:
                  "Failed to reverse cancellation in Stripe. Please try again or contact support.",
              });
            }
          }
        }
        await db
          .update(companies)
          .set({ cancelAtPeriodEnd: false, cancelAt: null } as any)
          .where(eq(companies.id, p(req.params.id)));
      } else {
        await storage.updateCompanySubscription(
          p(req.params.id),
          company.subscriptionTier || "free_trial",
          {
            subscriptionStatus: "active",
          }
        );
        await db
          .update(companies)
          .set({ cancelAtPeriodEnd: false, cancelAt: null, canceledAt: null } as any)
          .where(eq(companies.id, p(req.params.id)));
      }
      await logAdminAudit(req, "reactivate_account", "company", p(req.params.id), {});
      console.log(
        `[Admin] Account "${company.name}" (${p(req.params.id)}) reactivated by ${(req as any).adminUser?.email}`
      );
      return res.json({ ok: true, companyName: company.name });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Pending Approval Admin Routes ================

  app.get("/api/admin/pending-approvals", isAdmin, async (_req: Request, res: Response) => {
    try {
      const { eq } = await import("drizzle-orm");
      const pendingCompanies = await db
        .select()
        .from(companies)
        .where(eq(companies.subscriptionStatus, "pending_approval"));
      const result = await Promise.all(
        pendingCompanies.map(async (c) => {
          const companyUserRecords = await storage.getCompanyUsers(c.id);
          const ownerRecord =
            companyUserRecords.find((cu) => cu.role === "owner") || companyUserRecords[0];
          let ownerEmail: string | null = null;
          let ownerName: string | null = null;
          if (ownerRecord) {
            const ownerUser = await getUserById(ownerRecord.userId);
            if (ownerUser) {
              ownerEmail = ownerUser.email || null;
              ownerName =
                [ownerUser.firstName, ownerUser.lastName].filter(Boolean).join(" ") || null;
            }
          }
          return {
            id: c.id,
            name: c.name,
            email: c.email,
            ownerEmail,
            ownerName,
            signupCountry: c.signupCountry || null,
            verificationUrl: c.verificationUrl || null,
            createdAt: c.createdAt,
          };
        })
      );
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/admin/companies/:id/approve", isAdmin, async (req: Request, res: Response) => {
    try {
      const company = await storage.getCompany(p(req.params.id));
      if (!company) return res.status(404).json({ error: "Company not found" });
      if (company.subscriptionStatus !== "pending_approval") {
        return res.status(400).json({ error: "Account is not pending approval" });
      }

      const newTempPassword = crypto.randomBytes(6).toString("base64url");
      const newPasswordHash = await (async () => {
        const { scrypt, randomBytes } = await import("crypto");
        const salt = randomBytes(16).toString("hex");
        return new Promise<string>((resolve, reject) => {
          scrypt(newTempPassword, salt, 64, (err, key) => {
            if (err) reject(err);
            else resolve(`${salt}:${key.toString("hex")}`);
          });
        });
      })();

      const companyUserRecords = await storage.getCompanyUsers(company.id);
      const ownerRecord =
        companyUserRecords.find((cu) => cu.role === "owner") || companyUserRecords[0];
      if (ownerRecord) {
        await db
          .update((await import("@shared/models/auth")).users)
          .set({ passwordHash: newPasswordHash, mustChangePassword: true, updatedAt: new Date() })
          .where(eq((await import("@shared/models/auth")).users.id, ownerRecord.userId));
      }

      await db
        .update(companies)
        .set({
          subscriptionStatus: "trialing",
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        } as any)
        .where(eq(companies.id, p(req.params.id)));

      await logAdminAudit(req, "approve_account", "company", p(req.params.id), {});

      const host = req.headers.host || "localhost:5000";
      const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");
      const appUrl = `${isLocalhost ? "http" : "https"}://${host}`;

      if (ownerRecord) {
        const ownerUser = await getUserById(ownerRecord.userId);
        if (ownerUser?.email) {
          await sendEmail({
            companyId: company.id,
            to: ownerUser.email,
            subject: "Your ScooPilot account has been approved!",
            text: `Hi ${ownerUser.firstName || "there"},\n\nGreat news — your ScooPilot account has been approved!\n\nCompany: ${company.name}\nLogin: ${appUrl}\nEmail: ${ownerUser.email}\nTemporary Password: ${newTempPassword}\n\nYou'll be asked to set a new password on your first login.\n\nWelcome aboard!`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                  <h1 style="color: white; margin: 0;">ScooPilot</h1>
                </div>
                <div style="padding: 20px; border: 1px solid #e5e7eb;">
                  <h2 style="margin-top: 0; color: #2d8a5e;">Your Account is Approved!</h2>
                  <p>Hi ${ownerUser.firstName || "there"},</p>
                  <p>Your ScooPilot account <strong>"${company.name}"</strong> has been reviewed and approved. Your 14-day free trial starts now.</p>
                  <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 4px 0;"><strong>Email:</strong> ${ownerUser.email}</p>
                    <p style="margin: 4px 0;"><strong>Temporary Password:</strong> ${newTempPassword}</p>
                  </div>
                  <div style="text-align: center; margin: 24px 0;">
                    <a href="${appUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log In Now</a>
                  </div>
                  <p style="color: #6b7280; font-size: 14px;">You'll be asked to set a new password when you first log in.</p>
                </div>
              </div>
            `,
          }).catch((err) => console.error("[Admin Approve] Failed to send approval email:", err));
        }
      }

      console.log(
        `[Admin] Account "${company.name}" (${p(req.params.id)}) approved by ${(req as any).adminUser?.email}`
      );
      res.json({ ok: true, companyName: company.name });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/admin/companies/:id/reject", isAdmin, async (req: Request, res: Response) => {
    try {
      const company = await storage.getCompany(p(req.params.id));
      if (!company) return res.status(404).json({ error: "Company not found" });
      if (company.subscriptionStatus !== "pending_approval") {
        return res.status(400).json({ error: "Account is not pending approval" });
      }

      const { sendRejectionEmail = false, rejectionNote } = req.body as {
        sendRejectionEmail?: boolean;
        rejectionNote?: string;
      };

      const companyUserRecords = await storage.getCompanyUsers(company.id);
      const ownerRecord =
        companyUserRecords.find((cu) => cu.role === "owner") || companyUserRecords[0];

      if (sendRejectionEmail && ownerRecord) {
        const ownerUser = await getUserById(ownerRecord.userId);
        if (ownerUser?.email) {
          const note =
            rejectionNote?.trim() ||
            "We're currently focused on serving pet waste removal businesses in the US and Canada.";
          await sendEmail({
            to: ownerUser.email,
            subject: "Update on your ScooPilot application",
            text: `Hi ${ownerUser.firstName || "there"},\n\nThank you for your interest in ScooPilot.\n\nAfter reviewing your account, we're unable to approve access at this time.\n\n${note}\n\nIf you believe this is an error, please contact support@scoopilot.com.\n\nThank you for your understanding.`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                  <h1 style="color: white; margin: 0;">ScooPilot</h1>
                </div>
                <div style="padding: 20px; border: 1px solid #e5e7eb;">
                  <h2 style="margin-top: 0;">Application Update</h2>
                  <p>Hi ${ownerUser.firstName || "there"},</p>
                  <p>Thank you for your interest in ScooPilot.</p>
                  <p>After reviewing your account, we're unable to approve access at this time.</p>
                  <p style="background: #f3f4f6; padding: 12px; border-radius: 6px;">${note}</p>
                  <p>If you believe this is an error, please contact <a href="mailto:support@scoopilot.com">support@scoopilot.com</a>.</p>
                </div>
              </div>
            `,
          }).catch((err) => console.error("[Admin Reject] Failed to send rejection email:", err));
        }
      }

      const { eq: eqOp, inArray } = await import("drizzle-orm");
      const userIds = companyUserRecords.map((cu) => cu.userId);
      await db.delete(companies).where(eqOp(companies.id, p(req.params.id)));
      if (userIds.length > 0) {
        await db
          .delete((await import("@shared/models/auth")).users)
          .where(inArray((await import("@shared/models/auth")).users.id, userIds));
      }

      await logAdminAudit(req, "reject_account", "company", p(req.params.id), {
        sendRejectionEmail,
        rejectionNote: rejectionNote || null,
      });
      console.log(
        `[Admin] Account "${company.name}" (${p(req.params.id)}) rejected and deleted by ${(req as any).adminUser?.email}`
      );
      res.json({ ok: true, companyName: company.name });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/admin/companies/:id/regenerate-visits",
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        const company = await storage.getCompany(p(req.params.id));
        if (!company) return res.status(404).json({ error: "Company not found" });
        const { generateVisitsForCompany } = await import("../jobs/auto-visits");
        const { getCompanyToday } = await import("../utils/company-date");
        const companyToday = getCompanyToday(company.timezone || "America/New_York");
        // Look back 30 days to catch any missed past one-time visits, then forward 6 months
        const startDate = new Date(companyToday + "T00:00:00Z");
        startDate.setUTCDate(startDate.getUTCDate() - 30);
        const endDate = new Date(companyToday + "T00:00:00Z");
        endDate.setUTCDate(endDate.getUTCDate() + 182);
        const created = await generateVisitsForCompany(
          p(req.params.id),
          startDate.toISOString().split("T")[0],
          endDate.toISOString().split("T")[0]
        );
        await logAdminAudit(req, "regenerate_visits", "company", p(req.params.id), { created });
        console.log(
          `[Admin] Regenerated ${created} visits for "${company.name}" (${p(req.params.id)})`
        );
        return res.json({ ok: true, companyName: company.name, visitsCreated: created });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/admin/companies/:id/users/:userId/reset-password",
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        const companyId = p(req.params.id);
        const userId = p(req.params.userId);
        const { newPassword } = req.body;
        const companyUsers = await storage.getCompanyUsers(companyId);
        const cu = companyUsers.find((u) => u.userId === userId);
        if (!cu) return res.status(404).json({ error: "User not found in this company" });
        const user = await getUserById(userId);
        if (!user) return res.status(404).json({ error: "User not found" });
        const crypto = await import("crypto");
        const password =
          newPassword && typeof newPassword === "string" && newPassword.length >= 8
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
        await db
          .update(usersTable)
          .set({ passwordHash: hash, mustChangePassword: true })
          .where(eq(usersTable.id, userId));
        console.log(
          `[Admin] Password reset for user ${user.email} (${userId}) by ${(req as any).adminUser?.email}`
        );
        res.json({ ok: true, email: user.email, tempPassword: password });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/admin/companies/:id/users/:userId/send-reset-email",
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        const companyId = p(req.params.id);
        const userId = p(req.params.userId);
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

        console.log(
          `[Admin] Password reset email sent to ${user.email} by ${(req as any).adminUser?.email}`
        );
        res.json({ ok: true, email: user.email });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/admin/companies/:id/users/:userId/send-credentials",
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        const companyId = p(req.params.id);
        const userId = p(req.params.userId);
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
          return res
            .status(500)
            .json({ error: "Failed to send credentials email. Password was not changed." });
        }

        await db
          .update(usersTable)
          .set({ passwordHash: hash, mustChangePassword: true })
          .where(eq(usersTable.id, userId));

        console.log(
          `[Admin] Credentials sent to ${user.email} by ${(req as any).adminUser?.email}`
        );
        res.json({ ok: true, email: user.email });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.patch("/api/admin/companies/:id", isAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = p(req.params.id);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const { name, email, phone, address, routeCredits } = req.body;
      const updates: Record<string, any> = {};
      if (name !== undefined) {
        if (typeof name !== "string" || name.trim().length < 2)
          return res.status(400).json({ error: "Company name must be at least 2 characters" });
        updates.name = name.trim();
      }
      if (email !== undefined) {
        if (email && typeof email === "string" && email.trim()) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(email.trim()))
            return res.status(400).json({ error: "Invalid email address" });
          updates.email = email.trim();
        } else {
          updates.email = null;
        }
      }
      if (phone !== undefined) updates.phone = phone?.trim() || null;
      if (address !== undefined) updates.address = address?.trim() || null;
      if (routeCredits !== undefined) {
        const creditsStr = String(routeCredits);
        const credits = parseInt(creditsStr, 10);
        if (isNaN(credits) || credits < 0 || String(credits) !== creditsStr.trim())
          return res.status(400).json({ error: "Route credits must be a non-negative integer" });
        updates.routeCredits = credits;
      }

      if (Object.keys(updates).length === 0)
        return res.status(400).json({ error: "No fields to update" });

      const { companies: companiesTable } = await import("@shared/schema");
      await db.update(companiesTable).set(updates).where(eq(companiesTable.id, companyId));

      if (updates.routeCredits !== undefined) {
        const adminEmail = (req as any).adminUser?.email || "unknown";
        await db
          .insert(auditTrail)
          .values({
            companyId,
            userId: null,
            entityType: "company",
            entityId: companyId,
            action: "update",
            changes: {
              old: { routeCredits: company.routeCredits ?? 0 },
              new: { routeCredits: updates.routeCredits },
            },
            ipAddress: req.ip || null,
          })
          .catch(() => {});
        await db
          .insert(adminAuditLogs)
          .values({
            adminUserId: (req as any).adminUser?.id || null,
            adminEmail,
            action: "update_route_credits",
            resourceType: "company",
            resourceId: companyId,
            details: { old: company.routeCredits ?? 0, new: updates.routeCredits },
            ipAddress: req.ip || null,
          })
          .catch(() => {});
      }

      console.log(
        `[Admin] Company ${companyId} updated by ${(req as any).adminUser?.email}: ${JSON.stringify(updates)}`
      );
      res.json({ ok: true, ...updates });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch(
    "/api/admin/companies/:id/users/:userId",
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        const companyId = p(req.params.id);
        const userId = p(req.params.userId);
        const companyUsers = await storage.getCompanyUsers(companyId);
        const cu = companyUsers.find((u) => u.userId === userId);
        if (!cu) return res.status(404).json({ error: "User not found in this company" });

        const { firstName, lastName, email, role } = req.body;
        const userUpdates: Record<string, any> = {};
        if (firstName !== undefined) userUpdates.firstName = firstName?.trim() || null;
        if (lastName !== undefined) userUpdates.lastName = lastName?.trim() || null;
        if (email !== undefined) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(email))
            return res.status(400).json({ error: "Invalid email address" });
          const existing = await getUserByEmail(email.toLowerCase());
          if (existing && existing.id !== userId)
            return res.status(409).json({ error: "Email already in use by another account" });
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
          await db
            .update(companyUsersTable)
            .set({ role })
            .where(
              and(eq(companyUsersTable.userId, userId), eq(companyUsersTable.companyId, companyId))
            );
        }

        const oldData: Record<string, any> = {};
        const newData: Record<string, any> = {};
        if (firstName !== undefined) {
          oldData.firstName = (cu as any).firstName;
          newData.firstName = firstName?.trim() || null;
        }
        if (lastName !== undefined) {
          oldData.lastName = (cu as any).lastName;
          newData.lastName = lastName?.trim() || null;
        }
        if (email !== undefined) {
          oldData.email = (cu as any).email;
          newData.email = email.toLowerCase().trim();
        }
        if (role !== undefined) {
          oldData.role = cu.role;
          newData.role = role;
        }
        auditLog(
          companyId,
          null,
          "user",
          userId,
          "update",
          {
            old: oldData,
            new: newData,
            actor: "platform_admin",
            adminEmail: (req as any).adminUser?.email,
          },
          req.ip || undefined
        );

        console.log(
          `[Admin] User ${userId} in company ${companyId} updated by ${(req as any).adminUser?.email}`
        );
        res.json({ ok: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.delete("/api/admin/companies/:id", isAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = p(req.params.id);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      const companyUsersList = await storage.getCompanyUsers(companyId);
      const {
        companies: companiesTable,
        users: usersTable,
        companyUsers: companyUsersTable,
      } = await import("@shared/schema");

      await db.transaction(async (tx) => {
        await tx.delete(companiesTable).where(eq(companiesTable.id, companyId));
        for (const cu of companyUsersList) {
          const [remaining] = await tx
            .select({ count: sql<number>`count(*)` })
            .from(companyUsersTable)
            .where(eq(companyUsersTable.userId, cu.userId));
          if (!remaining || Number(remaining.count) === 0) {
            await tx.delete(usersTable).where(eq(usersTable.id, cu.userId));
          }
        }
      });

      console.log(
        `[Admin] Tenant "${company.name}" (${companyId}) deleted by ${(req as any).adminUser?.email}`
      );
      res.json({ ok: true, deletedCompany: company.name });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/admin/companies/:id/notes", isAdmin, async (req: Request, res: Response) => {
    try {
      const notes = await storage.getAdminNotes(p(req.params.id));
      res.json(notes);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/admin/companies/:id/notes", isAdmin, async (req: Request, res: Response) => {
    try {
      const { content } = req.body;
      if (!content) return res.status(400).json({ error: "Content required" });
      const note = await storage.createAdminNote({
        companyId: p(req.params.id),
        content,
        createdBy: (req as any).adminUser.email,
      });
      res.json(note);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/admin/notes/:noteId", isAdmin, async (req: Request, res: Response) => {
    try {
      await storage.deleteAdminNote(p(req.params.noteId));
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/admin/companies/:id/usage", isAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = p(req.params.id);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const smsResult = await db
        .select({ total: sql<number>`COALESCE(SUM(${usageEvents.quantity}), 0)` })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.companyId, companyId),
            eq(usageEvents.eventType, "sms_segment"),
            gte(usageEvents.recordedAt, periodStart)
          )
        );
      const voiceResult = await db
        .select({ total: sql<number>`COALESCE(SUM(${usageEvents.quantity}), 0)` })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.companyId, companyId),
            eq(usageEvents.eventType, "voice_minute"),
            gte(usageEvents.recordedAt, periodStart)
          )
        );

      const companyUsersList = await storage.getCompanyUsers(companyId);
      const activeUsers = companyUsersList.filter((cu) => cu.isActive).length;

      const { TIER_CONFIG: tierCfg } = await import("@shared/schema");
      const tierKey = company.subscriptionTier as keyof typeof tierCfg;
      const maxUsers = company.customMaxUsers ?? tierCfg[tierKey]?.maxUsers ?? 1;

      const apiCallResult = await db
        .select({ total: sql<number>`COALESCE(SUM(${usageEvents.quantity}), 0)` })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.companyId, companyId),
            eq(usageEvents.eventType, "api_call"),
            gte(usageEvents.recordedAt, periodStart)
          )
        );

      const msgCount = await db
        .select({ total: sql<number>`count(*)` })
        .from(messagesTable)
        .where(
          and(eq(messagesTable.companyId, companyId), gte(messagesTable.createdAt, periodStart))
        );

      const contactCount = await db
        .select({ total: sql<number>`count(*)` })
        .from(contacts)
        .where(eq(contacts.companyId, companyId));
      const visitCount = await db
        .select({ total: sql<number>`count(*)` })
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
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/admin/companies/:id/voice-calls", isAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = p(req.params.id);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const calls = await storage.getVoiceCalls(companyId, limit);
      res.json(calls);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/admin/companies/:id/audit-logs", isAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = p(req.params.id);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const entityType = req.query.entityType as string | undefined;

      let conditions = [eq(auditTrail.companyId, companyId)];
      if (entityType) conditions.push(eq(auditTrail.entityType, entityType));

      const [countResult] = await db
        .select({ total: sql<number>`count(*)` })
        .from(auditTrail)
        .where(and(...conditions));
      const logs = await db
        .select()
        .from(auditTrail)
        .where(and(...conditions))
        .orderBy(desc(auditTrail.createdAt))
        .limit(limit)
        .offset(offset);

      const userIds = Array.from(new Set(logs.filter((l) => l.userId).map((l) => l.userId!)));
      const userMap = new Map<string, string>();
      for (const uid of userIds) {
        const user = await getUserById(uid);
        if (user) userMap.set(uid, user.email || "");
      }

      const enrichedLogs = logs.map((l) => ({
        ...l,
        userEmail: l.userId ? userMap.get(l.userId) || "unknown" : null,
      }));

      res.json({ logs: enrichedLogs, total: Number(countResult?.total || 0) });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/admin/companies/:id/export", isAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = p(req.params.id);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const contactList = await storage.getContacts(companyId);
      const allProperties = await db
        .select()
        .from(properties)
        .where(eq(properties.companyId, companyId));
      const plans = await storage.getServicePlans(companyId, {});
      const invoiceList = await storage.getInvoices(companyId);
      const allVisits = await db.select().from(visits).where(eq(visits.companyId, companyId));
      const allMessages = await db.select().from(messages).where(eq(messages.companyId, companyId));
      const companyUsersList = await storage.getCompanyUsers(companyId);
      const allRoutes = await db.select().from(routes).where(eq(routes.companyId, companyId));

      const exportData = {
        exportedAt: new Date().toISOString(),
        company: {
          id: company.id,
          name: company.name,
          subscriptionTier: company.subscriptionTier,
          createdAt: company.createdAt,
        },
        users: companyUsersList,
        contacts: contactList,
        properties: allProperties,
        servicePlans: plans,
        routes: allRoutes,
        visits: allVisits,
        invoices: invoiceList,
        messages: allMessages,
      };

      auditLog(
        companyId,
        null,
        "data_export",
        companyId,
        "create",
        {
          tables: Object.keys(exportData).filter((k) => k !== "exportedAt"),
          actor: "platform_admin",
          adminEmail: (req as any).adminUser?.email,
        },
        req.ip || undefined
      );

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="tenant-export-${companyId}-${new Date().toISOString().slice(0, 10)}.json"`
      );
      res.json(exportData);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/admin/rollup", isAdmin, async (_req: Request, res: Response) => {
    try {
      const { runNightlyRollup } = await import("../jobs/nightly-rollup");
      await runNightlyRollup();
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/admin/retell/webhook-status", isAdmin, async (_req: Request, res: Response) => {
    try {
      const agentId = process.env.RETELL_AGENT_ID;
      if (!agentId) {
        return res.json({ configured: false, reason: "RETELL_AGENT_ID is not set" });
      }
      if (!process.env.RETELL_API_KEY) {
        return res.json({ configured: false, reason: "RETELL_API_KEY is not set" });
      }
      const baseUrl = getAppBaseUrl();
      const expectedUrl = baseUrl ? `${baseUrl}/api/webhooks/retell` : null;
      let registeredUrl: string | null = null;
      let fetchError: string | null = null;
      try {
        registeredUrl = await getRetellAgentWebhookUrl(agentId);
      } catch (err: unknown) {
        fetchError = err instanceof Error ? err.message : String(err);
      }
      const inSync =
        !fetchError && !!(expectedUrl && registeredUrl && registeredUrl === expectedUrl);
      res.json({ configured: true, agentId, registeredUrl, expectedUrl, inSync, fetchError });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/admin/retell/sync-webhook", isAdmin, async (req: Request, res: Response) => {
    try {
      const agentId = (req.body?.agentId as string | undefined) || process.env.RETELL_AGENT_ID;
      if (!agentId) {
        return res
          .status(400)
          .json({ error: "No Retell agent ID provided and RETELL_AGENT_ID is not set" });
      }
      const baseUrl = getAppBaseUrl();
      if (!baseUrl) {
        return res.status(400).json({
          error: "APP_BASE_URL is not configured — cannot determine the correct webhook URL",
        });
      }
      await registerRetellWebhook(agentId);
      const webhookUrl = `${baseUrl}/api/webhooks/retell`;
      res.json({ ok: true, agentId, webhookUrl });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/admin/debug/run-reminders", isAdmin, async (_req: Request, res: Response) => {
    try {
      const { runReminders } = await import("../jobs/reminders");
      await runReminders();
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/admin/debug/run-auto-visits", isAdmin, async (_req: Request, res: Response) => {
    try {
      const { runAutoVisits } = await import("../jobs/auto-visits");
      const result = await runAutoVisits();
      res.json({ ok: true, ...result });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/admin/debug/run-auto-invoice", isAdmin, async (_req: Request, res: Response) => {
    try {
      const { runAutoInvoice } = await import("../jobs/auto-invoice");
      const result = await runAutoInvoice();
      res.json({ ok: true, ...result });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Admin Security & Subscription Routes ================

  async function logAdminAudit(
    req: Request,
    action: string,
    resourceType?: string,
    resourceId?: string,
    details?: any
  ) {
    const adminUser = (req as any).adminUser;
    if (!adminUser) return;
    const ip =
      req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";
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
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete(
    "/api/admin/security/sessions/:sessionId",
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        await db.delete(adminSessions).where(eq(adminSessions.id, p(req.params.sessionId)));
        await logAdminAudit(req, "revoke_session", "admin_session", p(req.params.sessionId));
        res.json({ ok: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

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
      const [{ count: total }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(adminAuditLogs);
      res.json({ logs, total: Number(total) });
    } catch (err) {
      handleError(res, err);
    }
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
      const enriched = usrs.map((u) => {
        const daysSinceChange =
          (Date.now() - new Date(u.passwordChangedAt).getTime()) / (1000 * 60 * 60 * 24);
        return {
          ...u,
          passwordExpired: daysSinceChange >= 90,
          daysSincePasswordChange: Math.floor(daysSinceChange),
        };
      });
      res.json(enriched);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/admin/subscription-tiers", isAdmin, async (_req: Request, res: Response) => {
    try {
      const tiers = await db
        .select()
        .from(subscriptionTiers)
        .orderBy(sql`${subscriptionTiers.price} ASC`);
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
        const seeded = await db
          .select()
          .from(subscriptionTiers)
          .orderBy(sql`${subscriptionTiers.price} ASC`);
        return res.json(seeded);
      }
      res.json(tiers);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/admin/subscription-tiers/:id", isAdmin, async (req: Request, res: Response) => {
    try {
      const { name, maxUsers, price, isActive } = req.body;
      const updates: any = { updatedAt: new Date() };
      if (name !== undefined) updates.name = name;
      if (maxUsers !== undefined) updates.maxUsers = parseInt(maxUsers);
      if (price !== undefined) updates.price = parseFloat(price).toFixed(2);
      if (isActive !== undefined) updates.isActive = isActive;
      const [updated] = await db
        .update(subscriptionTiers)
        .set(updates)
        .where(eq(subscriptionTiers.id, p(req.params.id)))
        .returning();
      if (!updated) return res.status(404).json({ error: "Tier not found" });
      await logAdminAudit(req, "update_subscription_tier", "subscription_tier", updated.tierKey, {
        name: updated.name,
        price: updated.price,
        maxUsers: updated.maxUsers,
      });
      res.json(updated);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Import / Migration Routes ================
  const { parseSweepAndGoInvoices } = await import("../services/sweepandgo-parser");
  const {
    aiMapColumns,
    getDeterministicMapping,
    hashFileContent,
    CONTACT_FIELDS,
    INVOICE_FIELDS,
    ROUTE_FIELDS,
  } = await import("../services/ai-mapper");
  const { applyTransformations, parseCSV: parseCSVUtil } =
    await import("../services/import-transforms");
  const { parseCompetitorCSV } = await import("../services/competitor-import");
  const {
    enqueueCompetitorImport,
    enqueueCsvContactsImport,
    enqueueSweepAndGoInvoicesImport,
    enqueueCsvRoutesImport,
  } = await import("../services/import-runner");

  const VALID_PLATFORMS = ["sweepandgo", "jobber"] as const;

  app.post(
    "/api/migrations/competitor/detect",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { csvText, platform } = req.body;
        if (!csvText || typeof csvText !== "string")
          return res.status(400).json({ error: "csvText is required" });
        if (platform && !VALID_PLATFORMS.includes(platform))
          return res.status(400).json({ error: "Invalid platform" });
        const result = parseCompetitorCSV(csvText, platform || undefined);
        res.json(result);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/migrations/competitor/import",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const { csvText, platform, duplicateHandling } = req.body;
        if (!csvText || typeof csvText !== "string")
          return res.status(400).json({ error: "csvText is required" });
        if (platform && !VALID_PLATFORMS.includes(platform))
          return res.status(400).json({ error: "Invalid platform" });
        if (duplicateHandling && !["skip", "update"].includes(duplicateHandling))
          return res.status(400).json({ error: "Invalid duplicateHandling value" });

        const result = parseCompetitorCSV(csvText, platform || undefined, 0);
        if (result.errors.some((e) => e.row === 0)) {
          return res.status(400).json({ error: result.errors[0].message });
        }

        const fileHash = hashFileContent(csvText);
        const importRun = await storage.createImportRun({
          companyId,
          type: `${result.platform}_contacts` as any,
          status: "processing",
          fileName: `${result.platform}-contacts.csv`,
          fileHash,
          totalRows: result.totalRows,
          importedRows: 0,
          skippedRows: 0,
        });

        const leadSourceName = result.platformLabel;
        const leadSources = await storage.getLeadSources(companyId);
        if (!leadSources.find((ls) => ls.name.toLowerCase() === leadSourceName.toLowerCase())) {
          await storage.createLeadSource({ companyId, name: leadSourceName });
        }

        await enqueueCompetitorImport({
          companyId,
          jobId: importRun.id,
          contacts: result.preview,
          platform: result.platform,
          platformLabel: result.platformLabel,
          duplicateHandling: (duplicateHandling || "skip") as "skip" | "update",
          leadSourceName,
        });

        res.json({ jobId: importRun.id, totalRows: result.totalRows });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/migrations/sweepandgo/parse-invoices",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { csvText } = req.body;
        if (!csvText || typeof csvText !== "string")
          return res.status(400).json({ error: "csvText is required" });

        const result = parseSweepAndGoInvoices(csvText);

        const sampleInvoices = result.invoices.slice(0, 10).map((inv) => ({
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
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/migrations/sweepandgo/run-invoices",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const { csvText, allowDuplicates, includeInReminders } = req.body;
        if (!csvText) return res.status(400).json({ error: "csvText is required" });

        const parseResult = parseSweepAndGoInvoices(csvText);
        if (parseResult.errors.length > 0 && !req.body.forceImport) {
          return res.status(400).json({
            errors: parseResult.errors,
            message: "Validation errors found. Send forceImport: true to skip invalid rows.",
          });
        }

        const fileHash = hashFileContent(csvText);
        const importRun = await storage.createImportRun({
          companyId,
          type: "sweepandgo_invoices",
          status: "processing",
          fileName: "sweepandgo-invoices.csv",
          fileHash,
          totalRows: parseResult.invoices.length,
          importedRows: 0,
          skippedRows: 0,
        });

        await enqueueSweepAndGoInvoicesImport({
          companyId,
          jobId: importRun.id,
          csvText,
          allowDuplicates: !!allowDuplicates,
          includeInReminders: !!includeInReminders,
        });

        res.json({ jobId: importRun.id, totalRows: parseResult.invoices.length });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get(
    "/api/migrations/:id/invoices-report",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const importRun = await storage.getImportRun(p(req.params.id), companyId);
        if (!importRun) return res.status(404).json({ error: "Import run not found" });
        res.json(importRun);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get("/api/invoices/:id/payments", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const invoice = await storage.getInvoice(p(req.params.id), companyId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      const payments = await storage.getInvoicePayments(p(req.params.id));
      res.json(payments);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Document Import (AI Categorization) ================

  const DOCUMENT_CATEGORIES = [
    "Invoice",
    "Service Record",
    "Contract",
    "License",
    "Insurance Certificate",
    "Photo",
    "Other",
  ] as const;

  app.post("/api/documents/classify", isAuthenticated, async (req: Request, res: Response) => {
    try {
      await getCompanyContext(req);
      const { fileName, mimeType } = req.body;
      if (!fileName) return res.status(400).json({ error: "fileName is required" });

      const OpenAI = (await import("openai")).default;
      const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const prompt = `You are helping classify a document being imported into a field service management system.
Given the file name and MIME type, determine the most appropriate document category.

File name: ${fileName}
MIME type: ${mimeType || "unknown"}

Categories: ${DOCUMENT_CATEGORIES.join(", ")}

Respond with exactly one category from the list above and nothing else.`;

      const completion = await ai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 20,
        temperature: 0,
      });

      const raw = completion.choices[0]?.message?.content?.trim() || "";
      const category =
        DOCUMENT_CATEGORIES.find((c) => raw.toLowerCase().includes(c.toLowerCase())) || "Other";
      res.json({ category });
    } catch (err) {
      handleError(res, err);
    }
  });

  const ALLOWED_DOCUMENT_CATEGORIES = [
    "Invoice",
    "Service Record",
    "Contract",
    "License",
    "Insurance Certificate",
    "Photo",
    "Other",
  ] as const;

  app.post("/api/documents", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { fileName, fileUrl, fileType, fileSize, documentCategory, notes, contactId } =
        req.body;
      if (!fileName) return res.status(400).json({ error: "fileName is required" });
      if (!fileUrl) return res.status(400).json({ error: "fileUrl is required" });
      if (documentCategory && !ALLOWED_DOCUMENT_CATEGORIES.includes(documentCategory)) {
        return res.status(400).json({
          error: `Invalid documentCategory. Allowed values: ${ALLOWED_DOCUMENT_CATEGORIES.join(", ")}`,
        });
      }

      let resolvedContactId: string | null = null;
      if (contactId) {
        const contact = await storage.getContact(contactId, companyId);
        if (!contact)
          return res
            .status(400)
            .json({ error: "Contact not found or does not belong to this company" });
        resolvedContactId = contact.id;
      }

      const doc = await storage.createDocument({
        companyId,
        fileName,
        fileUrl,
        fileType: fileType || null,
        fileSize: fileSize || null,
        documentCategory: documentCategory || null,
        notes: notes || null,
        contactId: resolvedContactId,
        propertyId: null,
        visitId: null,
      });
      res.json(doc);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/documents", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const docs = await storage.getDocumentImports(companyId);
      const contactIds = Array.from(
        new Set(docs.filter((d) => d.contactId).map((d) => d.contactId!))
      );
      const contactMap: Record<
        string,
        { firstName: string; lastName: string; email: string | null }
      > = {};
      if (contactIds.length > 0) {
        const contactRecords = await storage.getContacts(companyId);
        for (const c of contactRecords) {
          if (contactIds.includes(c.id)) {
            contactMap[c.id] = {
              firstName: c.firstName,
              lastName: c.lastName,
              email: c.email ?? null,
            };
          }
        }
      }
      const result = docs.map((d) => ({
        ...d,
        contactName:
          d.contactId && contactMap[d.contactId]
            ? `${contactMap[d.contactId].firstName} ${contactMap[d.contactId].lastName}`.trim()
            : null,
        contactEmail: d.contactId ? (contactMap[d.contactId]?.email ?? null) : null,
      }));
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/imports/ai-map", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { headers, sampleRows, targetSchema } = req.body;

      if (!headers || !Array.isArray(headers))
        return res.status(400).json({ error: "headers array is required" });
      if (!sampleRows || !Array.isArray(sampleRows))
        return res.status(400).json({ error: "sampleRows array is required" });

      const company = await storage.getCompany(companyId);
      const targetFields =
        targetSchema === "invoices"
          ? INVOICE_FIELDS
          : targetSchema === "routes"
            ? ROUTE_FIELDS
            : CONTACT_FIELDS;

      if (company?.aiImportMappingEnabled) {
        const result = await aiMapColumns(
          headers,
          sampleRows.slice(0, 25),
          targetSchema || "contacts",
          targetFields
        );
        res.json(result);
      } else {
        const result = getDeterministicMapping(headers, targetFields);
        res.json(result);
      }
    } catch (err) {
      handleError(res, err);
    }
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

      const requiredFields =
        targetSchema === "invoices"
          ? ["invoiceNumber"]
          : targetSchema === "routes"
            ? ["routeName"]
            : ["firstName"];

      const transformed = applyTransformations(
        rows,
        headers,
        mappings,
        transformations,
        requiredFields
      );

      const preview = transformed.slice(0, 50);
      const validCount = transformed.filter((r) => r.isValid).length;
      const invalidCount = transformed.filter((r) => !r.isValid).length;
      const allErrors = transformed.flatMap((r) => r.errors);

      res.json({
        totalRows: rows.length,
        validCount,
        invalidCount,
        rows: preview,
        preview,
        errors: allErrors.slice(0, 100),
        headers,
      });
    } catch (err) {
      handleError(res, err);
    }
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

      const importType =
        targetSchema === "invoices"
          ? "sweepandgo_invoices"
          : targetSchema === "routes"
            ? "csv_routes"
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

      if (targetSchema === "contacts" || !targetSchema) {
        await enqueueCsvContactsImport({
          companyId,
          jobId: importRun.id,
          headers,
          rows,
          mappings,
          transformations,
          skippedRows: req.body.skipRowIndices || req.body.skippedRows || [],
          editedCells: req.body.editedCells || {},
        });
        return res.json({ jobId: importRun.id, totalRows: rows.length });
      }

      if (targetSchema === "routes") {
        await enqueueCsvRoutesImport({
          companyId,
          jobId: importRun.id,
          headers,
          rows,
          mappings,
          transformations,
          skippedRows: req.body.skipRowIndices || req.body.skippedRows || [],
          editedCells: req.body.editedCells || {},
        });
        return res.json({ jobId: importRun.id, totalRows: rows.length });
      }

      res.json({ jobId: importRun.id, totalRows: rows.length });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/imports", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const runs = await storage.getImportRuns(companyId);
      res.json(runs);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/imports/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const run = await storage.getImportRun(p(req.params.id), companyId);
      if (!run) return res.status(404).json({ error: "Import run not found" });
      res.json(run);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/imports/:jobId/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const run = await storage.getImportRun(p(req.params.jobId), companyId);
      if (!run) return res.status(404).json({ error: "Import run not found" });
      res.json(run);
    } catch (err) {
      handleError(res, err);
    }
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
      const aiKeyAvailable = !!(
        process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY
      );
      const [company] = await db
        .select({ roverAiEnabled: companies.roverAiEnabled })
        .from(companies)
        .where(eq(companies.id, companyId));
      res.json({
        aiAvailable: aiKeyAvailable && (company?.roverAiEnabled ?? false),
        aiEnabled: company?.roverAiEnabled ?? false,
        aiKeyConfigured: aiKeyAvailable,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(
    "/api/rover/chat",
    isAuthenticated,
    roverRateLimiter as any,
    async (req: Request, res: Response) => {
      try {
        const { userId, companyId } = await getCompanyContext(req);
        const { messages: chatMessages } = req.body;

        if (!Array.isArray(chatMessages) || chatMessages.length === 0) {
          return res.status(400).json({ error: "Messages array is required" });
        }

        const lastMsg = chatMessages[chatMessages.length - 1];
        if (
          !lastMsg ||
          lastMsg.role !== "user" ||
          typeof lastMsg.content !== "string" ||
          lastMsg.content.trim().length < 1
        ) {
          return res.status(400).json({ error: "Last message must be a non-empty user message" });
        }

        const aiKeyAvailable = !!(
          process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY
        );
        const [company] = await db
          .select({ roverAiEnabled: companies.roverAiEnabled })
          .from(companies)
          .where(eq(companies.id, companyId));

        if (!company?.roverAiEnabled || !aiKeyAvailable) {
          return res.status(400).json({ error: "AI chat is disabled", fallback: true });
        }

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const sanitizedMessages = chatMessages.slice(-20).map((m: any) => ({
          role: m.role === "user" ? ("user" as const) : ("assistant" as const),
          content: String(m.content).slice(0, 2000),
        }));

        const { streamRoverChat } = await import("../services/rover-ai");

        const abortSignal = { aborted: false };
        req.on("close", () => {
          abortSignal.aborted = true;
        });

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
    }
  );

  const ROVER_KNOWLEDGE_BASE: { keywords: string[]; answer: string }[] = [
    {
      keywords: ["dashboard", "overview", "home", "main"],
      answer:
        "The Dashboard is your home screen showing key metrics like active clients, scheduled visits, revenue, and recent activity. It gives you a quick snapshot of your business operations.",
    },
    {
      keywords: ["contact", "client", "crm", "lead", "customer"],
      answer:
        "The Contacts section is your CRM hub. You can add and manage clients, track their status (lead, estimate, active, paused, cancelled), assign properties, add tags, and manage their scheduled services. Use the search bar to find contacts quickly.",
    },
    {
      keywords: ["property", "address", "yard", "dog", "location"],
      answer:
        "Properties are service locations tied to contacts. Each property can have details like address, gate code, yard size, number of dogs, and special instructions. Properties are geocoded automatically for route optimization.",
    },
    {
      keywords: ["route", "routing", "optimize", "optimization", "dispatch"],
      answer:
        "Routes let you organize daily service stops. Use the Route Builder to drag-and-drop visits, optimize the order using our route optimization algorithm, and dispatch routes to technicians. You can optimize routes using credits from your account.",
    },
    {
      keywords: ["schedule", "service plan", "recurring", "visit", "appointment", "job"],
      answer:
        "Jobs set up recurring or one-off schedules for your clients (weekly, biweekly, monthly, or one-time). Each job auto-generates visits that appear on routes and auto-assigns to the least-loaded route for their day.",
    },
    {
      keywords: ["invoice", "billing", "payment", "charge", "stripe"],
      answer:
        "The Invoicing section lets you create and manage invoices with line items, tax, and discounts. Invoices can be sent to clients and paid via Stripe. You can also void invoices and track payment status.",
    },
    {
      keywords: ["technician", "tech", "field", "mobile", "crew"],
      answer:
        "Technicians use a simplified mobile view showing only their assigned routes and client info. They can mark visits as complete, add notes, and upload proof-of-service photos. Invite technicians from the Settings page.",
    },
    {
      keywords: ["portal", "client portal", "self-service"],
      answer:
        "The Client Portal gives your customers a self-service view where they can see their schedule, past visits, invoices, pause/resume service, and send messages to you. Enable portal access from a contact's detail page.",
    },
    {
      keywords: ["email", "sms", "text", "message", "communicate"],
      answer:
        "Communication tools let you send emails and SMS messages to clients. All communications are logged in the Messages tab. You can set up automation rules to send messages automatically on events like new leads or completed services.",
    },
    {
      keywords: ["automation", "rule", "trigger", "automatic"],
      answer:
        "Automation Rules let you automate actions based on events. For example, auto-send a welcome email when a new lead is created, or create a task when a service is completed. Set these up from the Automation section.",
    },
    {
      keywords: ["settings", "account", "profile", "company"],
      answer:
        "Settings lets you manage your company profile, team members, service pricing, notification preferences, API keys, and integrations. You can also change your password and manage your subscription here.",
    },
    {
      keywords: ["import", "csv", "upload", "bulk"],
      answer:
        "You can bulk-import contacts using CSV files. Go to Contacts, click Import, upload your CSV, map the columns, review the data, and import. Unknown lead sources from CSV files are automatically added.",
    },
    {
      keywords: ["tag", "label", "categorize", "group"],
      answer:
        "Tags help you organize and categorize contacts. Create custom tags with colors, then assign them to contacts for easy filtering and grouping.",
    },
    {
      keywords: ["notification", "alert", "bell"],
      answer:
        "The notification bell in the top bar shows real-time alerts for events like new leads, completed visits, overdue invoices, and portal messages. Click a notification to navigate to the relevant item.",
    },
    {
      keywords: ["api", "webhook", "integration", "key"],
      answer:
        "ScooPilot has a REST API with scoped API keys for external integrations. You can also set up webhooks to receive real-time notifications when events occur in your account. Manage these from Settings > API & Webhooks.",
    },
    {
      keywords: ["password", "login", "forgot", "reset", "change password"],
      answer:
        "To change your password, go to Settings and use the Change Password card. If you forgot your password, use the Forgot Password link on the login page to receive a reset email.",
    },
    {
      keywords: ["subscription", "plan", "tier", "pricing", "upgrade"],
      answer:
        "Your subscription tier determines your user limit and features. Plans range from Free Trial to Enterprise. Contact your admin or check Settings to manage your subscription.",
    },
    {
      keywords: ["map", "geocode", "mapbox", "directions"],
      answer:
        "ScooPilot uses maps for route visualization and optimization. Properties are automatically geocoded when created. The route optimizer uses real road distances to find the most efficient service order.",
    },
    {
      keywords: ["proof", "photo", "picture", "evidence"],
      answer:
        "Technicians can upload proof-of-service photos when completing visits. These photos are attached to the visit record and visible in the visit history for the client's property.",
    },
  ];

  function findAnswer(question: string): string | null {
    const q = question.toLowerCase();
    let bestMatch: { answer: string; score: number } | null = null;
    for (const entry of ROVER_KNOWLEDGE_BASE) {
      const score = entry.keywords.filter((kw) => q.includes(kw)).length;
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
        answer:
          "I'm not sure about that one. Would you like to submit a trouble ticket or feature request? I'll make sure the team sees it.",
        matched: false,
      });
    } catch (err) {
      handleError(res, err);
    }
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
      const [ticket] = await db
        .insert(roverTickets)
        .values({
          companyId,
          userId,
          type,
          subject: subject.trim(),
          description: description.trim(),
        })
        .returning();

      const typeLabel =
        type === "bug"
          ? "Trouble Ticket"
          : type === "feature_request"
            ? "Feature Request"
            : "Question";
      notify(
        companyId,
        "general",
        `New ${typeLabel}`,
        `${typeLabel}: ${subject.trim()}`,
        undefined
      );

      res.json({ ok: true, ticket });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/rover/tickets", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { roverTickets } = await import("@shared/schema");
      const tickets = await db
        .select()
        .from(roverTickets)
        .where(eq(roverTickets.companyId, companyId))
        .orderBy(sql`${roverTickets.createdAt} DESC`)
        .limit(50);
      res.json(tickets);
    } catch (err) {
      handleError(res, err);
    }
  });
}
