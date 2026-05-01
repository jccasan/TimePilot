import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { z } from "zod";

import { isAuthenticated, getCompanyContext, handleError, p } from "./shared";

export async function registerMiscRoutes(app: Express): Promise<void> {
  // ================ Time Entries ================

  app.get("/api/time-entries/active", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { userId } = await getCompanyContext(req);
      const entry = await storage.getActiveTimeEntry(userId);
      res.json(entry || null);
    } catch (err) {
      handleError(res, err);
    }
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
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/time-entries/clock-out", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { userId, companyId } = await getCompanyContext(req);
      const active = await storage.getActiveTimeEntry(userId);
      if (!active) {
        return res.status(400).json({ error: "Not clocked in" });
      }
      const clockOut = new Date();
      const durationMinutes = Math.round(
        (clockOut.getTime() - new Date(active.clockIn).getTime()) / 60000
      );
      const entry = await storage.updateTimeEntry(active.id, companyId, {
        clockOut,
        durationMinutes,
      });
      res.json(entry);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Global Search ================

  app.get("/api/search", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const q = String(req.query.q || "").trim();
      if (!q || q.length < 2)
        return res.json({ contacts: [], properties: [], invoices: [], routes: [] });
      const searchTerm = `%${q.toLowerCase()}%`;
      const [contacts, properties, invoices, routes] = await Promise.all([
        storage.searchContacts(companyId, searchTerm),
        storage.searchProperties(companyId, searchTerm),
        storage.searchInvoices(companyId, searchTerm),
        storage.searchRoutes(companyId, searchTerm),
      ]);
      res.json({ contacts, properties, invoices, routes });
    } catch (err) {
      handleError(res, err);
    }
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
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(
    "/api/notifications/unread-count",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const totalCount = await storage.getUnreadNotificationCount(companyId);
        const allNotifs = await storage.getNotifications(companyId, 100);
        const clientRequestCount = allNotifs.filter(
          (n) =>
            !n.isRead &&
            (n.type === "portal_message" ||
              n.title.includes("Service Change Request") ||
              n.title.includes("One-Time Cleanup Request"))
        ).length;
        res.json({ count: totalCount, clientRequestCount });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.patch("/api/notifications/:id/read", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const notif = await storage.markNotificationRead(p(req.params.id), companyId);
      if (!notif) return res.status(404).json({ error: "Notification not found" });
      res.json(notif);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/notifications/mark-all-read",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        await storage.markAllNotificationsRead(companyId);
        res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ================ System Messages ================
  app.get("/api/system-messages", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const includeDismissed = req.query.includeDismissed === "true";
      const messages = await storage.getSystemMessages(companyId, { includeDismissed });
      res.json(messages);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(
    "/api/system-messages/unread-count",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const count = await storage.getUnreadSystemMessageCount(companyId);
        res.json({ count });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.patch(
    "/api/system-messages/:id/read",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const msg = await storage.markSystemMessageRead(p(req.params.id), companyId);
        if (!msg) return res.status(404).json({ error: "System message not found" });
        res.json(msg);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.patch(
    "/api/system-messages/:id/dismiss",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const msg = await storage.dismissSystemMessage(p(req.params.id), companyId);
        if (!msg) return res.status(404).json({ error: "System message not found" });
        res.json(msg);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/system-messages/dismiss-all",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        await storage.dismissAllSystemMessages(companyId);
        res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/notifications/bulk-schedule-change",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        if (role !== "owner" && role !== "admin") {
          return res
            .status(403)
            .json({ error: "Only owners and admins can send bulk notifications" });
        }

        const bulkNotifySchema = z.object({
          template: z.string().min(1).max(1000),
          channel: z.enum(["sms", "email", "both"]),
          movedStops: z
            .array(
              z.object({
                stopId: z.string(),
                fromDay: z.string(),
                toDay: z.string(),
                contactName: z.string(),
              })
            )
            .min(1)
            .max(500),
        });

        const parsed = bulkNotifySchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ error: "Invalid request", details: parsed.error.flatten() });
        }
        const { template, channel, movedStops } = parsed.data;

        const allPlans = await storage.getServicePlans(companyId, { isActive: true });
        const planMap = new Map(allPlans.map((p) => [p.id, p]));
        const allContacts = await storage.getContacts(companyId);
        const contactMap = new Map(allContacts.map((c) => [c.id, c]));

        const company = await storage.getCompany(companyId);
        const companyName = company?.name || "Your Pet Waste Service";

        const results: {
          contactName: string;
          channel: string;
          success: boolean;
          error?: string;
        }[] = [];

        const { sendSmsForCompany } = await import("../services/sms");
        const { sendEmail, logEmailSent } = await import("../services/email");

        const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

        for (const stop of movedStops) {
          const plan = planMap.get(stop.stopId);
          if (!plan) {
            results.push({
              contactName: stop.contactName,
              channel: channel,
              success: false,
              error: "Service plan not found",
            });
            continue;
          }
          const contact = contactMap.get(plan.contactId);
          if (!contact) {
            results.push({
              contactName: stop.contactName,
              channel: channel,
              success: false,
              error: "Contact not found",
            });
            continue;
          }

          const firstName = contact.firstName || stop.contactName.split(" ")[0] || "Customer";
          const personalizedMsg = template
            .replace(/\[Name\]/gi, firstName)
            .replace(/\[OldDay\]/gi, capitalize(stop.fromDay))
            .replace(/\[NewDay\]/gi, capitalize(stop.toDay));

          if ((channel === "sms" || channel === "both") && contact.phone) {
            try {
              const smsResult = await sendSmsForCompany({
                to: contact.phone,
                body: personalizedMsg,
                companyId,
                contactId: contact.id,
              });
              results.push({
                contactName: stop.contactName,
                channel: "sms",
                success: smsResult.success,
                error: smsResult.error,
              });
              if (!smsResult.success) {
                await storage.createSystemMessage({
                  companyId,
                  type: "bulk_notify_failure",
                  severity: "error",
                  title: `SMS failed: ${stop.contactName}`,
                  body: `Could not send schedule change SMS to ${stop.contactName}${contact.phone ? ` (${contact.phone})` : ""}: ${smsResult.error || "Unknown error"}`,
                  metadata: { contactId: contact.id, channel: "sms", stopId: stop.stopId },
                });
              }
            } catch (err: unknown) {
              results.push({
                contactName: stop.contactName,
                channel: "sms",
                success: false,
                error: err instanceof Error ? err.message : String(err),
              });
              await storage.createSystemMessage({
                companyId,
                type: "bulk_notify_failure",
                severity: "error",
                title: `SMS failed: ${stop.contactName}`,
                body: `Exception sending SMS to ${stop.contactName}: ${err instanceof Error ? err.message : String(err)}`,
                metadata: { contactId: contact.id, channel: "sms", stopId: stop.stopId },
              });
            }
          } else if ((channel === "sms" || channel === "both") && !contact.phone) {
            results.push({
              contactName: stop.contactName,
              channel: "sms",
              success: false,
              error: "No phone number on file",
            });
            await storage.createSystemMessage({
              companyId,
              type: "bulk_notify_failure",
              severity: "warning",
              title: `SMS skipped: ${stop.contactName}`,
              body: `${stop.contactName} has no phone number on file. Could not send schedule change notification via SMS.`,
              metadata: { contactId: contact.id, channel: "sms", stopId: stop.stopId },
            });
          }

          if ((channel === "email" || channel === "both") && contact.email) {
            try {
              const subject = `Service Day Change - ${companyName}`;
              const emailResult = await sendEmail({
                companyId: companyId,
                contactId: contact.id,
                to: contact.email,
                subject,
                text: personalizedMsg,
                senderName: companyName,
              });
              results.push({
                contactName: stop.contactName,
                channel: "email",
                success: emailResult.success,
                error: emailResult.error,
              });
              if (emailResult.success) {
                await logEmailSent(
                  companyId,
                  contact.email,
                  subject,
                  "schedule_change",
                  emailResult.messageId
                );
              } else {
                await storage.createSystemMessage({
                  companyId,
                  type: "bulk_notify_failure",
                  severity: "error",
                  title: `Email failed: ${stop.contactName}`,
                  body: `Could not send schedule change email to ${stop.contactName} (${contact.email}): ${emailResult.error || "Unknown error"}`,
                  metadata: { contactId: contact.id, channel: "email", stopId: stop.stopId },
                });
              }
            } catch (err: unknown) {
              results.push({
                contactName: stop.contactName,
                channel: "email",
                success: false,
                error: err instanceof Error ? err.message : String(err),
              });
              await storage.createSystemMessage({
                companyId,
                type: "bulk_notify_failure",
                severity: "error",
                title: `Email failed: ${stop.contactName}`,
                body: `Exception sending email to ${stop.contactName}: ${err instanceof Error ? err.message : String(err)}`,
                metadata: { contactId: contact.id, channel: "email", stopId: stop.stopId },
              });
            }
          } else if ((channel === "email" || channel === "both") && !contact.email) {
            results.push({
              contactName: stop.contactName,
              channel: "email",
              success: false,
              error: "No email on file",
            });
            await storage.createSystemMessage({
              companyId,
              type: "bulk_notify_failure",
              severity: "warning",
              title: `Email skipped: ${stop.contactName}`,
              body: `${stop.contactName} has no email on file. Could not send schedule change notification via email.`,
              metadata: { contactId: contact.id, channel: "email", stopId: stop.stopId },
            });
          }
        }

        const successCount = results.filter((r) => r.success).length;
        const failCount = results.filter((r) => !r.success).length;

        await storage.createSystemMessage({
          companyId,
          type: "bulk_notify_summary",
          severity: failCount > 0 ? "warning" : "info",
          title: `Bulk Schedule Notifications Sent`,
          body: `${successCount} message${successCount !== 1 ? "s" : ""} sent successfully${failCount > 0 ? `, ${failCount} failed` : ""}. ${movedStops.length} customer${movedStops.length !== 1 ? "s" : ""} notified about day changes.`,
          metadata: { successCount, failCount, totalStops: movedStops.length, channel },
        });

        res.json({
          success: true,
          results,
          summary: { sent: successCount, failed: failCount, total: results.length },
        });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // ================ Audit Trail ================
  app.get("/api/audit-trail", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { entityType, startDate, endDate } = req.query as {
        entityType?: string;
        startDate?: string;
        endDate?: string;
      };
      const filters: { entityType?: string; startDate?: string; endDate?: string } = {};
      if (entityType) filters.entityType = entityType;
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;
      const entries = await storage.getAuditTrail(companyId, filters);
      res.json(entries);
    } catch (err) {
      handleError(res, err);
    }
  });
}
