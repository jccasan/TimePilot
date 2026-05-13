import type { Express, Request, Response } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  servicePlans as servicePlansTable,
  type InsertContact,
  type InsertProperty,
  type Visit,
  type InvoiceLineItem,
} from "@shared/schema";
import { sendEmail } from "../services/email";
import {
  isStripeConfigured,
  getCustomerPaymentMethods,
  createCheckoutSession,
  detachPaymentMethod,
  ensureConnectedCustomer,
} from "../services/stripe";
import { computeInvoice } from "../invoice-engine/invoice.compute";
import {
  renderInvoice,
  loadTemplate,
  loadTheme,
  getDefaultTemplatePath,
  getDefaultThemePath,
} from "../invoice-engine/invoice.render";

import {
  isAuthenticated,
  getCompanyContext,
  requireRole,
  getBaseUrl,
  handleError,
  auditLog,
  p,
  notify,
  escapeHtml,
  normalizeQuoteFrequency,
  provisionPortalAccess,
} from "./shared";

export async function registerPortalRoutes(app: Express): Promise<void> {
  // ================ Client Portal Routes ================

  const loginFailCounts = new Map<string, { count: number; resetAt: number }>();

  app.post("/api/portal/login", async (req: Request, res: Response) => {
    try {
      const { email: rawEmail, password } = req.body;
      if (!rawEmail || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }
      const email = String(rawEmail).trim().toLowerCase();

      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      const rateLimitKey = `${clientIp}:${email}`;
      const now = Date.now();
      const failEntry = loginFailCounts.get(rateLimitKey);
      if (failEntry && failEntry.resetAt > now && failEntry.count >= 5) {
        return res.status(429).json({
          error: "Too many failed login attempts. Please try again later.",
        });
      }

      const allCompanies = await storage.listCompanies();
      let foundContact = null;
      let hasAccessButNoPassword = false;
      for (const company of allCompanies) {
        const companyContacts = await storage.getContacts(company.id, { search: email });
        const match = companyContacts.find(
          (c) =>
            (c.email || "")
              .toLowerCase()
              .split(",")
              .map((e) => e.trim())
              .includes(email) && c.hasPortalAccess
        );
        if (match) {
          if (match.portalPasswordHash) {
            foundContact = match;
            break;
          } else {
            hasAccessButNoPassword = true;
          }
        }
      }

      const recordFailedAttempt = () => {
        const nowTs = Date.now();
        const existing = loginFailCounts.get(rateLimitKey);
        if (existing && existing.resetAt > nowTs) {
          existing.count++;
        } else {
          loginFailCounts.set(rateLimitKey, { count: 1, resetAt: nowTs + 15 * 60 * 1000 });
        }
      };

      if (!foundContact) {
        recordFailedAttempt();
        if (hasAccessButNoPassword) {
          return res.status(401).json({
            error: "Your account needs a password. Please use 'Forgot Password' to set one up.",
          });
        }
        return res.status(401).json({ error: "Invalid email or password" });
      }

      if (!foundContact.portalPasswordHash) {
        recordFailedAttempt();
        return res.status(401).json({
          error: "Your account needs a password. Please use 'Forgot Password' to set one up.",
        });
      }

      const [salt, hash] = foundContact.portalPasswordHash.split(":");
      const passwordValid = await new Promise<boolean>((resolve, reject) => {
        crypto.scrypt(password, salt, 64, (err, key) => {
          if (err) reject(err);
          resolve(key.toString("hex") === hash);
        });
      });
      if (!passwordValid) {
        recordFailedAttempt();
        return res.status(401).json({ error: "Invalid email or password" });
      }

      loginFailCounts.delete(rateLimitKey);

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

      // Store contactId in session cookie so browser img tag requests (which cannot
      // send Authorization headers) are still authenticated for /objects/ downloads.
      req.session.portalContactId = foundContact.id;
      await new Promise<void>((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve()))
      );

      res.json({ token, contactId: foundContact.id });
    } catch (err) {
      handleError(res, err);
    }
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
          (c) =>
            (c.email || "")
              .toLowerCase()
              .split(",")
              .map((e) => e.trim())
              .includes(normalizedEmail) && c.hasPortalAccess
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

      const { sendEmail } = await import("../services/email");
      // Use the exact email the user typed in case the contact has multiple emails stored
      const resetEmailTo = normalizedEmail;
      sendEmail({
        companyId: company?.id || foundContact.companyId,
        contactId: foundContact.id,
        to: resetEmailTo,
        subject: `Reset your ${companyName} portal password`,
        senderName: company?.name || undefined,
        replyTo: company?.email || undefined,
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
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/portal/reset-password", async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body;
      if (!token || !password)
        return res.status(400).json({ error: "Token and password are required" });
      if (String(password).length < 10)
        return res.status(400).json({ error: "Password must be at least 10 characters" });

      const allCompanies = await storage.listCompanies();
      let foundContact = null;
      for (const company of allCompanies) {
        const contacts = await storage.getContacts(company.id, {});
        const match = contacts.find(
          (c) =>
            c.resetToken === token &&
            c.resetTokenExpiry &&
            new Date(c.resetTokenExpiry) > new Date()
        );
        if (match) {
          foundContact = match;
          break;
        }
      }

      if (!foundContact) {
        return res
          .status(400)
          .json({ error: "Invalid or expired reset link. Please request a new one." });
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
    } catch (err) {
      handleError(res, err);
    }
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
          (c) =>
            c.emailVerificationToken === token &&
            c.emailVerificationExpiry &&
            new Date(c.emailVerificationExpiry) > new Date()
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
    } catch (err) {
      handleError(res, err);
    }
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
        currency: company?.currency || "usd",
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/portal/schedule", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const plans = await storage.getServicePlans(companyId, { contactId });
      const today = new Date().toISOString().split("T")[0];
      const futureDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
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
        upcomingVisits: myVisits.map((v: Visit) => ({
          id: v.id,
          scheduledDate: v.scheduledDate,
          status: v.status,
          propertyAddress: props.find((p) => p.id === v.propertyId)?.streetAddress || "",
        })),
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/portal/invoices", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const invoicesList = await storage.getInvoices(companyId, { contactId });
      const visibleStatuses = ["sent", "pending", "paid", "failed"];
      res.json(
        invoicesList
          .filter((inv) => visibleStatuses.includes(inv.status))
          .map((inv) => ({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            dueDate: inv.dueDate,
            total: inv.total,
            tipAmount: inv.tipAmount || "0",
            status: inv.status,
            createdAt: inv.createdAt,
          }))
      );
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/portal/invoices/:id/pay", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const invoice = await storage.getInvoice(p(req.params.id), companyId);
      if (!invoice || invoice.contactId !== contactId)
        return res.status(404).json({ error: "Invoice not found" });
      if (invoice.status === "paid") return res.status(400).json({ error: "Invoice already paid" });
      if (invoice.status === "draft")
        return res.status(400).json({ error: "This invoice has not been finalized yet" });
      if (invoice.status === "voided")
        return res.status(400).json({ error: "This invoice has been voided" });

      const tipAmount = Math.round(parseFloat(req.body?.tipAmount || "0") * 100) / 100;
      if (isNaN(tipAmount) || tipAmount < 0)
        return res.status(400).json({ error: "Invalid tip amount" });
      if (tipAmount > 500) return res.status(400).json({ error: "Tip amount exceeds maximum" });

      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const company = await storage.getCompany(companyId);
      const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;

      const contactName = `${contact.firstName} ${contact.lastName}`.trim();
      const { customerId: stripeCustomerId, wasRecreated } = await ensureConnectedCustomer({
        currentCustomerId: contact.stripeCustomerId,
        stripeAccount: connectAcct,
        email: contact.email || undefined,
        name: contactName,
        metadata: { contactId: contact.id, companyId },
      });
      if (wasRecreated) {
        await storage.updateContact(contact.id, companyId, { stripeCustomerId });
      }

      const chargeAmount = parseFloat(invoice.total) + tipAmount;
      const baseUrl = getBaseUrl(req);
      const result = await createCheckoutSession({
        customerId: stripeCustomerId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        amount: chargeAmount,
        clientName: contactName,
        successUrl: `${baseUrl}/portal/client?paid=${invoice.id}`,
        cancelUrl: `${baseUrl}/portal/client`,
        tipAmount: tipAmount.toFixed(2),
        stripeConnectAccountId: connectAcct,
        tenantId: companyId,
      });

      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
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
        await storage.updateServicePlan(plan.id, companyId, {
          isActive: false,
          pausedAt: new Date(),
        });
        pausedPlanIds.push(plan.id);
      }

      const today = new Date().toISOString().split("T")[0];
      const cancelledCount = await storage.cancelFutureVisitsForPlans(pausedPlanIds, today);
      if (cancelledCount > 0) {
        console.log(
          `[portal-pause] Cancelled ${cancelledCount} future visits for contact ${contactId}`
        );
      }

      notify(
        companyId,
        "service_paused",
        "Service Paused",
        `${contact.firstName} ${contact.lastName} paused their service via the portal.`,
        `/contacts/${contactId}`
      );
      res.json({ success: true, status: "paused" });
    } catch (err) {
      handleError(res, err);
    }
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
          const { generateVisitsForPlans } = await import("../jobs/auto-visits");
          const created = await generateVisitsForPlans(
            companyId,
            reactivatedPlanIds,
            startStr,
            endStr
          );
          if (created > 0) {
            console.log(`[portal-resume] Generated ${created} visits for contact ${contactId}`);
          }
        } catch (genErr) {
          console.error("[portal-resume] Visit generation failed:", genErr);
        }
      }

      notify(
        companyId,
        "service_resumed",
        "Service Resumed",
        `${contact.firstName} ${contact.lastName} resumed their service via the portal.`,
        `/contacts/${contactId}`
      );
      res.json({ success: true, status: "active" });
    } catch (err) {
      handleError(res, err);
    }
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
        .filter(
          (v: Visit) =>
            planIds.has(v.servicePlanId) &&
            (v.status === "completed" || v.status === "skipped" || v.status === "cancelled")
        )
        .sort((a: Visit, b: Visit) => (b.scheduledDate ?? "").localeCompare(a.scheduledDate ?? ""));

      const props = await storage.getProperties(companyId, contactId);

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const start = (page - 1) * limit;

      res.json({
        visits: pastVisits.slice(start, start + limit).map((v: Visit) => ({
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
    } catch (err) {
      handleError(res, err);
    }
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
      if (!companyEmail)
        return res.status(400).json({ error: "Company does not have a contact email configured" });

      const emailSubject = subject || `Message from ${contact.firstName} ${contact.lastName}`;
      await sendEmail({
        companyId: companyId,
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

      notify(
        companyId,
        "portal_message",
        `${contact.firstName} ${contact.lastName} -- Portal Message`,
        `${contact.firstName} ${contact.lastName} sent a message via the portal.`,
        `/#client-requests`
      );

      res.json({ success: true, message: "Your message has been sent." });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/portal/messages", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const msgs = await storage.getMessages(companyId, { contactId });
      res.json(
        msgs.map((m) => ({
          id: m.id,
          direction: m.direction,
          channel: m.channel,
          subject: m.subject,
          body: m.body,
          status: m.status,
          createdAt: m.createdAt,
        }))
      );
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/portal/logout", async (req: Request, res: Response) => {
    try {
      const { sessionId } = await getPortalContext(req);
      await storage.deletePortalSession(sessionId);
      // Clear portal identity from session cookie to revoke object download access.
      delete req.session.portalContactId;
      await new Promise<void>((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve()))
      );
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/portal/properties", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const properties = await storage.getProperties(companyId, contactId);
      res.json(properties);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/portal/profile", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const updates: Partial<Record<string, unknown>> = {};
      if (req.body.firstName !== undefined) updates.firstName = String(req.body.firstName).trim();
      if (req.body.lastName !== undefined) updates.lastName = String(req.body.lastName).trim();
      if (req.body.phone !== undefined) updates.phone = String(req.body.phone).trim() || null;
      if (req.body.streetAddress !== undefined)
        updates.streetAddress = String(req.body.streetAddress).trim();
      if (req.body.city !== undefined) updates.city = String(req.body.city).trim();
      if (req.body.state !== undefined) updates.state = String(req.body.state).trim();
      if (req.body.zipCode !== undefined) updates.zipCode = String(req.body.zipCode).trim();
      if (req.body.numberOfDogs !== undefined) updates.numberOfDogs = Number(req.body.numberOfDogs);
      let pendingEmailChange: string | null = null;
      if (req.body.email !== undefined) {
        const newEmail = String(req.body.email).trim().toLowerCase();
        if (newEmail && newEmail !== contact.email) {
          pendingEmailChange = newEmail;
        }
      }
      if (Object.keys(updates).length > 0) {
        await storage.updateContact(contactId, companyId, updates as Partial<InsertContact>);
      }
      if (req.body.properties && Array.isArray(req.body.properties)) {
        for (const prop of req.body.properties) {
          if (prop.id) {
            const existing = await storage.getProperty(prop.id, companyId);
            if (!existing || existing.contactId !== contactId) {
              return res.status(403).json({ error: "Not authorized to update this property" });
            }
            if (existing) {
              const propUpdates: Partial<InsertProperty> = {};
              if (prop.gateCode !== undefined) propUpdates.gateCode = prop.gateCode;
              if (prop.specialInstructions !== undefined)
                propUpdates.specialInstructions = prop.specialInstructions;
              if (prop.streetAddress !== undefined)
                propUpdates.streetAddress = String(prop.streetAddress).trim();
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

        const { sendEmail } = await import("../services/email");
        sendEmail({
          companyId: companyId,
          contactId: contactId,
          to: pendingEmailChange,
          subject: `Verify your new email address - ${companyName}`,
          senderName: company?.name || undefined,
          replyTo: company?.email || undefined,
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
          currency: company?.currency || "usd",
        },
      });
    } catch (err) {
      handleError(res, err);
    }
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
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Portal: Payment Methods (T001) ================

  app.post("/api/portal/setup-intent", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const company = await storage.getCompany(companyId);
      const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;

      const contactName = `${contact.firstName} ${contact.lastName}`.trim();
      const { customerId: stripeCustomerId, wasRecreated } = await ensureConnectedCustomer({
        currentCustomerId: contact.stripeCustomerId,
        stripeAccount: connectAcct,
        email: contact.email || undefined,
        name: contactName,
        metadata: { contactId: contact.id, companyId },
      });
      if (wasRecreated) {
        await storage.updateContact(contact.id, companyId, { stripeCustomerId });
      }

      const baseUrl = getBaseUrl(req);
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: "2025-04-30.basil" as unknown as import("stripe").Stripe.LatestApiVersion,
      });
      const setupOpts: { stripeAccount?: string } = {};
      if (connectAcct) {
        setupOpts.stripeAccount = connectAcct;
      }
      const session = await stripe.checkout.sessions.create(
        {
          customer: stripeCustomerId,
          mode: "setup",
          payment_method_types: ["card"],
          success_url: `${baseUrl}/portal/client?card_added=1`,
          cancel_url: `${baseUrl}/portal/client`,
          metadata: { tenant_id: companyId, checkout_type: "portal_setup" },
        },
        setupOpts
      );

      res.json({ url: session.url });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/portal/payment-methods", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      if (!contact.stripeCustomerId)
        return res.json({ methods: [], autoPayEnabled: contact.autoPayEnabled });

      const company = await storage.getCompany(companyId);
      const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;
      const contactName = `${contact.firstName} ${contact.lastName}`.trim();
      const { customerId: resolvedCustId, wasRecreated } = await ensureConnectedCustomer({
        currentCustomerId: contact.stripeCustomerId,
        stripeAccount: connectAcct,
        email: contact.email || undefined,
        name: contactName,
        metadata: { contactId: contact.id, companyId },
      });
      if (wasRecreated) {
        await storage.updateContact(contactId, companyId, { stripeCustomerId: resolvedCustId });
      }
      const methods = await getCustomerPaymentMethods(resolvedCustId, connectAcct);
      res.json({ methods, autoPayEnabled: contact.autoPayEnabled });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.delete("/api/portal/payment-methods/:id", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact?.stripeCustomerId)
        return res.status(400).json({ error: "No payment methods on file" });

      const company = await storage.getCompany(companyId);
      const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;
      const contactName = `${contact.firstName} ${contact.lastName}`.trim();
      const { customerId: resolvedCustId, wasRecreated } = await ensureConnectedCustomer({
        currentCustomerId: contact.stripeCustomerId,
        stripeAccount: connectAcct,
        email: contact.email || undefined,
        name: contactName,
        metadata: { contactId: contact.id, companyId },
      });
      if (wasRecreated) {
        await storage.updateContact(contactId, companyId, { stripeCustomerId: resolvedCustId });
      }
      const methods = await getCustomerPaymentMethods(resolvedCustId, connectAcct);
      const owns = methods.some((m) => m.id === p(req.params.id));
      if (!owns) return res.status(403).json({ error: "Payment method not found" });

      await detachPaymentMethod(p(req.params.id), connectAcct);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/portal/auto-pay", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const { enabled } = req.body;
      await storage.updateContact(contactId, companyId, { autoPayEnabled: !!enabled });
      res.json({ success: true, autoPayEnabled: !!enabled });
    } catch (err) {
      handleError(res, err);
    }
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
    } catch (err) {
      handleError(res, err);
    }
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
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Portal: Estimates (T004) ================

  app.get("/api/portal/estimates", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const allEstimates = await storage.getEstimates(companyId, { contactId });
      res.json(
        allEstimates.map((e) => ({
          id: e.id,
          description: e.description,
          items: e.items,
          totalCents: e.totalCents,
          status: e.status,
          sentAt: e.sentAt,
          respondedAt: e.respondedAt,
          responseNote: e.responseNote,
          createdAt: e.createdAt,
        }))
      );
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/portal/estimates/:id/approve", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const estimate = await storage.getEstimate(p(req.params.id), companyId);
      if (!estimate || estimate.contactId !== contactId)
        return res.status(404).json({ error: "Estimate not found" });
      if (estimate.status !== "pending")
        return res.status(400).json({ error: "Estimate is no longer pending" });

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
          notify(
            companyId,
            "general",
            "Draft Job Created from Estimate",
            `${contactName} approved estimate "${estimate.description}". A draft job has been created — review and approve the schedule.`,
            `/scheduling`
          );
        } catch (jobErr) {
          console.error("[estimate-approve] Failed to auto-create job:", jobErr);
          notify(
            companyId,
            "general",
            "Estimate Approved",
            `${contactName} approved estimate: ${estimate.description}`,
            `/contacts/${contactId}`
          );
        }
      } else {
        notify(
          companyId,
          "general",
          "Estimate Approved",
          `${contactName} approved estimate: ${estimate.description}`,
          `/contacts/${contactId}`
        );
      }

      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/portal/estimates/:id/decline", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const estimate = await storage.getEstimate(p(req.params.id), companyId);
      if (!estimate || estimate.contactId !== contactId)
        return res.status(404).json({ error: "Estimate not found" });
      if (estimate.status !== "pending")
        return res.status(400).json({ error: "Estimate is no longer pending" });

      await storage.updateEstimate(estimate.id, companyId, {
        status: "declined",
        respondedAt: new Date(),
        responseNote: req.body.reason || null,
      });

      const contact = await storage.getContactById(contactId);
      notify(
        companyId,
        "general",
        "Estimate Declined",
        `${contact?.firstName} ${contact?.lastName} declined estimate: ${estimate.description}${req.body.reason ? ` - Reason: ${req.body.reason}` : ""}`,
        `/contacts/${contactId}`
      );
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Portal: Quotes ================

  app.get("/api/portal/quotes/:id", async (req: Request, res: Response) => {
    try {
      const quoteId = p(req.params.id);
      const requestToken = typeof req.query.token === "string" ? req.query.token.trim() : "";
      const allQuotes = await db.execute(sql`SELECT * FROM quotes WHERE id = ${quoteId}`);
      const quoteRow = allQuotes.rows?.[0];
      if (!quoteRow) return res.status(404).json({ error: "Quote not found" });

      const storedToken = quoteRow.quote_token as string | null;
      if (!storedToken || !requestToken || storedToken !== requestToken) {
        return res.status(403).json({ error: "Invalid or missing quote access token" });
      }

      const isExpired =
        quoteRow.status === "expired" ||
        (quoteRow.expires_at && new Date(quoteRow.expires_at as string) < new Date());

      const safeQuote = {
        id: quoteRow.id,
        quoteNumber: quoteRow.quote_number,
        type: quoteRow.type,
        status: isExpired ? "expired" : quoteRow.status,
        contactName: quoteRow.contact_name,
        propertyAddress: quoteRow.property_address,
        dogCount: quoteRow.dog_count,
        yardSize: quoteRow.yard_size,
        stationCount: quoteRow.station_count,
        commonAreaMinutes: quoteRow.common_area_minutes,
        frequency: quoteRow.frequency,
        essentialPrice: quoteRow.essential_price,
        premiumPrice: quoteRow.premium_price,
        deluxePrice: quoteRow.deluxe_price,
        initialCleanFee: quoteRow.initial_clean_fee,
        selectedTier: quoteRow.selected_tier,
        selectedPrice: quoteRow.selected_price,
        essentialFeatures: quoteRow.essential_features,
        premiumFeatures: quoteRow.premium_features,
        deluxeFeatures: quoteRow.deluxe_features,
        notes: quoteRow.notes,
        expiresAt: quoteRow.expires_at,
        sentAt: quoteRow.sent_at,
        acceptedAt: quoteRow.accepted_at,
        companyId: quoteRow.company_id,
        lineItems: quoteRow.line_items || null,
      };

      const company = await storage.getCompany(quoteRow.company_id as string);
      const companyName = company?.name || "Service Provider";
      if (!company) {
        console.warn(
          `[portal/quotes] Company not found for quote ${quoteId}, company_id=${quoteRow.company_id}`
        );
      } else if (!company.name || company.name === "User's Company") {
        console.warn(
          `[portal/quotes] Company ${company.id} has placeholder name "${company.name}" — owner should update it in Settings`
        );
      }
      const logoUrl = company?.logoUrl
        ? company.logoUrl.startsWith("http")
          ? company.logoUrl
          : `${getBaseUrl(req)}${company.logoUrl}`
        : undefined;
      res.json({
        quote: safeQuote,
        companyName,
        companyCurrency: company?.currency || "usd",
        companyLogoUrl: logoUrl,
      });
    } catch (err: unknown) {
      console.error("Error fetching portal quote:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/portal/quotes/:id/accept", async (req: Request, res: Response) => {
    try {
      const quoteId = p(req.params.id);
      const requestToken = typeof req.query.token === "string" ? req.query.token.trim() : "";
      const { tier } = req.body;
      if (!tier || !["essential", "premium", "deluxe"].includes(tier)) {
        return res.status(400).json({ error: "Must select a tier: essential, premium, or deluxe" });
      }

      const result = await db.execute(sql`SELECT * FROM quotes WHERE id = ${quoteId}`);
      const quoteRow = result.rows?.[0];
      if (!quoteRow) return res.status(404).json({ error: "Quote not found" });

      const storedToken = quoteRow.quote_token as string | null;
      if (!storedToken || !requestToken || storedToken !== requestToken) {
        return res.status(403).json({ error: "Invalid or missing quote access token" });
      }

      if (quoteRow.status !== "sent" && quoteRow.status !== "draft") {
        return res.status(400).json({ error: "This quote has already been " + quoteRow.status });
      }

      if (quoteRow.expires_at && new Date(quoteRow.expires_at as string) < new Date()) {
        return res.status(400).json({ error: "This quote has expired" });
      }

      const priceKey = `${tier}_price` as string;
      const selectedPrice = quoteRow[priceKey] || "0";

      await db.execute(sql`
        UPDATE quotes SET
          status = 'accepted',
          selected_tier = ${tier},
          selected_price = ${selectedPrice},
          accepted_at = NOW(),
          updated_at = NOW()
        WHERE id = ${quoteId}
      `);

      const contactId = quoteRow.contact_id as string | null;
      const propertyId = quoteRow.property_id as string | null;
      const companyId = quoteRow.company_id as string;
      const quoteNumber = quoteRow.quote_number as string | null;
      const frequency = (quoteRow.frequency as string) || "weekly";

      if (contactId) {
        const contact = await storage.getContactById(contactId);
        if (contact && contact.status === "lead") {
          await storage.updateContact(contactId, companyId, { status: "active" });
        }
      }

      if (contactId && propertyId) {
        try {
          const today = new Date().toISOString().split("T")[0];
          const portalSvcName = `${tier.charAt(0).toUpperCase() + tier.slice(1)} Service (Quote #${quoteNumber || quoteId})`;
          await storage.createServicePlan({
            companyId,
            contactId,
            propertyId,
            frequency: normalizeQuoteFrequency(frequency),
            pricePerVisit: String(selectedPrice),
            startDate: today,
            isActive: true,
            serviceName: portalSvcName,
            jobType: "recurring",
            jobStatus: "active",
            stopOrder: 0,
          });
        } catch (spErr) {
          console.error("Failed to create service plan from portal quote acceptance:", spErr);
        }
      }

      res.json({ success: true, tier, price: selectedPrice });
    } catch (err: unknown) {
      console.error("Error accepting quote:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/portal/quotes/:id/decline", async (req: Request, res: Response) => {
    try {
      const quoteId = p(req.params.id);
      const requestToken = typeof req.query.token === "string" ? req.query.token.trim() : "";
      const result = await db.execute(sql`SELECT * FROM quotes WHERE id = ${quoteId}`);
      const quoteRow = result.rows?.[0];
      if (!quoteRow) return res.status(404).json({ error: "Quote not found" });

      const storedToken = quoteRow.quote_token as string | null;
      if (!storedToken || !requestToken || storedToken !== requestToken) {
        return res.status(403).json({ error: "Invalid or missing quote access token" });
      }

      if (quoteRow.status !== "sent" && quoteRow.status !== "draft") {
        return res.status(400).json({ error: "This quote has already been " + quoteRow.status });
      }

      await db.execute(sql`
        UPDATE quotes SET
          status = 'declined',
          declined_at = NOW(),
          updated_at = NOW()
        WHERE id = ${quoteId}
      `);

      res.json({ success: true });
    } catch (err: unknown) {
      console.error("Error declining quote:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ================ Portal: Notification Preferences (T005) ================

  app.get("/api/portal/notifications", async (req: Request, res: Response) => {
    try {
      const { contactId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      res.json(contact.reminderPreferences || { email: true, sms: false });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/portal/notifications", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const prefs = req.body;
      const booleanKeys = [
        "email",
        "sms",
        "serviceReminder",
        "serviceCompleted",
        "invoiceReady",
        "invoiceDueReminder",
        "paymentConfirmation",
        "reminderOptOut",
      ];
      const validChannels = ["sms", "email", "both"];
      const validTimings = ["24h_before", "2h_before", "morning_of"];
      const cleaned: Record<string, boolean | string | undefined> = {};
      for (const key of booleanKeys) {
        if (prefs[key] !== undefined) cleaned[key] = !!prefs[key];
      }
      if (prefs.preferredChannel !== undefined) {
        cleaned.preferredChannel = validChannels.includes(prefs.preferredChannel)
          ? prefs.preferredChannel
          : undefined;
      }
      if (prefs.preferredTiming !== undefined) {
        cleaned.preferredTiming = validTimings.includes(prefs.preferredTiming)
          ? prefs.preferredTiming
          : undefined;
      }
      const contact = await storage.getContactById(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      const merged = {
        ...(contact.reminderPreferences || { email: true, sms: false }),
        ...cleaned,
      };
      await storage.updateContact(contactId, companyId, { reminderPreferences: merged });
      res.json({ success: true, preferences: merged });
    } catch (err) {
      handleError(res, err);
    }
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
      const senderName =
        `${contact?.firstName || ""} ${contact?.lastName || ""}`.trim() || "A client";
      notify(
        companyId,
        "general",
        `${senderName} -- Service Change Request`,
        `${senderName} requested a ${requestType.replace(/_/g, " ")}${note ? `: ${note}` : ""}`,
        `/#client-requests`
      );

      res.json({ success: true, id: request.id });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/portal/service-changes", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const requests = await storage.getServiceChangeRequests(companyId, { contactId });
      res.json(
        requests.map((r) => ({
          id: r.id,
          requestType: r.requestType,
          currentValue: r.currentValue,
          requestedValue: r.requestedValue,
          note: r.note,
          status: r.status,
          adminNote: r.adminNote,
          createdAt: r.createdAt,
          respondedAt: r.respondedAt,
        }))
      );
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Portal: Photo Gallery (T007) ================

  app.get("/api/portal/photos", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const plans = await storage.getServicePlans(companyId, { contactId });
      const planIds = new Set(plans.map((p) => p.id));

      const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
      const today = new Date().toISOString().split("T")[0];
      const allVisits = await storage.getVisitsForDateRange(companyId, sixMonthsAgo, today);
      const props = await storage.getProperties(companyId, contactId);

      const visitsWithPhotos = allVisits
        .filter(
          (v: Visit) =>
            planIds.has(v.servicePlanId) && (v.proofOfServicePhoto || v.proofOfServicePhotoBefore)
        )
        .sort((a: Visit, b: Visit) => (b.scheduledDate ?? "").localeCompare(a.scheduledDate ?? ""))
        .slice(0, 50)
        .map((v: Visit) => ({
          id: v.id,
          scheduledDate: v.scheduledDate,
          propertyAddress: props.find((p) => p.id === v.propertyId)?.streetAddress || "",
          proofOfServicePhoto: v.proofOfServicePhoto || null,
          proofOfServicePhotoBefore: v.proofOfServicePhotoBefore || null,
        }));

      res.json(visitsWithPhotos);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Portal: Billing PDF Download (T008) ================

  app.get("/api/portal/invoices/:id/pdf", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const invoice = await storage.getInvoice(p(req.params.id), companyId);
      if (!invoice || invoice.contactId !== contactId)
        return res.status(404).json({ error: "Invoice not found" });

      const contact = await storage.getContactById(contactId);
      const company = await storage.getCompany(companyId);
      const lineItems = await storage.getInvoiceLineItems(invoice.id);

      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({ size: "LETTER", margin: 50 });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`
      );
      doc.pipe(res);

      doc.fontSize(20).text(company?.name || "Invoice", { align: "left" });
      doc.moveDown(0.5);
      doc
        .fontSize(10)
        .fillColor("#666666")
        .text(`${company?.address || ""}`);
      if (company?.phone) doc.text(`Phone: ${company.phone}`);
      if (company?.email) doc.text(`Email: ${company.email}`);
      doc.moveDown(1);

      doc
        .fontSize(16)
        .fillColor("#000000")
        .text(`Invoice ${invoice.invoiceNumber}`, { align: "right" });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor("#666666");
      doc.text(
        `Date: ${invoice.issuedDate || invoice.createdAt?.toISOString().split("T")[0] || ""}`,
        { align: "right" }
      );
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
      doc
        .moveTo(50, tableTop + 15)
        .lineTo(540, tableTop + 15)
        .stroke("#cccccc");

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
        doc.text(`Discount: -$${Number(invoice.discountAmount).toFixed(2)}`, 370, yPos, {
          width: 170,
          align: "right",
        });
        yPos += 18;
      }
      if (Number(invoice.tax) > 0) {
        doc.text(`Tax: $${Number(invoice.tax).toFixed(2)}`, 370, yPos, {
          width: 170,
          align: "right",
        });
        yPos += 18;
      }
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text(`Total: $${Number(invoice.total).toFixed(2)}`, 370, yPos, {
          width: 170,
          align: "right",
        });

      doc.end();
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/portal/billing-statement", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const contact = await storage.getContactById(contactId);
      const company = await storage.getCompany(companyId);

      const startDate =
        (req.query.startDate as string) ||
        new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
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
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="billing-statement-${startDate}-to-${endDate}.pdf"`
      );
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
      doc
        .moveTo(50, tableTop + 15)
        .lineTo(540, tableTop + 15)
        .stroke("#cccccc");

      let yPos = tableTop + 25;
      let grandTotal = 0;
      for (const inv of filtered) {
        doc.fontSize(9).fillColor("#000000");
        doc.text(inv.invoiceNumber, 50, yPos, { width: 100 });
        doc.text(inv.issuedDate || inv.createdAt?.toISOString().split("T")[0] || "", 160, yPos, {
          width: 80,
        });
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

      const paidTotal = filtered
        .filter((i) => i.status === "paid")
        .reduce((s, i) => s + Number(i.total), 0);
      const outstandingTotal = grandTotal - paidTotal;
      yPos += 20;
      doc.fontSize(10).font("Helvetica").fillColor("#666666");
      doc.text(`Paid: $${paidTotal.toFixed(2)}`, 420, yPos, { width: 100, align: "right" });
      yPos += 15;
      doc.text(`Outstanding: $${outstandingTotal.toFixed(2)}`, 420, yPos, {
        width: 100,
        align: "right",
      });

      doc.end();
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Admin: Estimates (T004) ================

  app.post("/api/estimates", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role);
      const { contactId, propertyId, description, items, totalCents } = req.body;
      if (!contactId || !description || !items || totalCents === undefined) {
        return res
          .status(400)
          .json({ error: "contactId, description, items, and totalCents are required" });
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
          companyId: companyId,
          contactId: contactId,
          to: contact.email,
          subject: `New Estimate from ${company?.name || "Your Service Provider"}`,
          senderName: company?.name || undefined,
          replyTo: company?.email || undefined,
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
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/estimates", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const allEstimates = await storage.getEstimates(companyId, {
        status: req.query.status as string | undefined,
        contactId: req.query.contactId as string | undefined,
      });
      res.json(allEstimates);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Admin: Service Change Requests (T006) ================

  app.get("/api/service-change-requests", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const requests = await storage.getServiceChangeRequests(companyId, {
        status: req.query.status as string | undefined,
      });

      const enriched = await Promise.all(
        requests.map(async (r) => {
          const contact = await storage.getContactById(r.contactId);
          return {
            ...r,
            contactName: contact ? `${contact.firstName} ${contact.lastName}` : "Unknown",
          };
        })
      );

      res.json(enriched);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/service-change-requests/:id/approve",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);
        const request = await storage.getServiceChangeRequest(p(req.params.id), companyId);
        if (!request) return res.status(404).json({ error: "Change request not found" });
        if (request.status !== "pending")
          return res.status(400).json({ error: "Request is not pending" });

        await storage.updateServiceChangeRequest(request.id, companyId, {
          status: "approved",
          adminNote: req.body.adminNote || null,
          respondedAt: new Date(),
        });

        if (request.requestType === "pause") {
          await storage.updateContact(request.contactId, companyId, { status: "paused" });
          const plans = await storage.getServicePlans(companyId, {
            contactId: request.contactId,
            isActive: true,
          });
          for (const plan of plans) {
            await storage.updateServicePlan(plan.id, companyId, { isActive: false });
          }
        } else if (request.requestType === "cancel" && request.servicePlanId) {
          await storage.updateServicePlan(request.servicePlanId, companyId, { isActive: false });
        } else if (request.servicePlanId && request.requestedValue) {
          if (request.requestType === "frequency_change") {
            await storage.updateServicePlan(request.servicePlanId, companyId, {
              frequency:
                request.requestedValue as (typeof servicePlansTable.$inferSelect)["frequency"],
            });
          } else if (request.requestType === "day_change") {
            await storage.updateServicePlan(request.servicePlanId, companyId, {
              dayOfWeek:
                request.requestedValue as (typeof servicePlansTable.$inferSelect)["dayOfWeek"],
            });
          }
        }

        res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/service-change-requests/:id/deny",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);
        const request = await storage.getServiceChangeRequest(p(req.params.id), companyId);
        if (!request) return res.status(404).json({ error: "Change request not found" });
        if (request.status !== "pending")
          return res.status(400).json({ error: "Request is not pending" });

        await storage.updateServiceChangeRequest(request.id, companyId, {
          status: "denied",
          adminNote: req.body.adminNote || req.body.reason || null,
          respondedAt: new Date(),
        });

        res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // Admin route: generate portal invite link
  app.post(
    "/api/contacts/:id/portal-access",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);
        const contact = await storage.getContact(p(req.params.id), companyId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });
        if (!contact.email)
          return res
            .status(400)
            .json({ error: "Contact must have an email address to enable portal access" });

        await provisionPortalAccess(p(req.params.id), companyId, getBaseUrl(req));

        res.json({
          success: true,
          message: "Portal access enabled. Temporary password has been emailed to the customer.",
        });
      } catch (err: unknown) {
        const e = err as Partial<Error>;
        console.error("[portal-access/provision] Unhandled error:", {
          message: e.message,
          stack: e.stack,
          name: e.name,
        });
        handleError(res, err);
      }
    }
  );

  app.delete(
    "/api/contacts/:id/portal-access",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);
        const contact = await storage.getContact(p(req.params.id), companyId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });

        await storage.updateContact(p(req.params.id), companyId, { hasPortalAccess: false });
        res.json({ success: true, message: "Portal access disabled." });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/contacts/:id/portal-access/reset-password",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role, userId } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);
        const contact = await storage.getContact(p(req.params.id), companyId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });
        if (!contact.hasPortalAccess)
          return res.status(400).json({ error: "Portal access is not enabled for this contact" });
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 8) {
          return res.status(400).json({ error: "Password must be at least 8 characters" });
        }
        const salt = crypto.randomBytes(16).toString("hex");
        const portalPasswordHash = await new Promise<string>((resolve, reject) => {
          crypto.scrypt(newPassword, salt, 64, (err, key) => {
            if (err) return reject(err);
            resolve(`${salt}:${key.toString("hex")}`);
          });
        });
        await storage.updateContact(p(req.params.id), companyId, { portalPasswordHash });
        auditLog(companyId, userId, "contact", p(req.params.id), "update", {
          action: "portal_password_reset",
          resetBy: userId,
        });
        res.json({ success: true, message: "Client portal password has been updated." });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/contacts/:id/portal-access/resend",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);
        const contact = await storage.getContact(p(req.params.id), companyId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });
        if (!contact.email)
          return res
            .status(400)
            .json({ error: "Contact must have an email address to send a portal link" });
        if (!contact.hasPortalAccess)
          return res
            .status(400)
            .json({ error: "Portal access is not enabled for this contact. Enable it first." });

        const tempPassword = crypto.randomBytes(4).toString("hex") + "A1!";
        const salt = crypto.randomBytes(16).toString("hex");
        const portalPasswordHash = await new Promise<string>((resolve, reject) => {
          crypto.scrypt(tempPassword, salt, 64, (err, key) => {
            if (err) return reject(err);
            resolve(`${salt}:${key.toString("hex")}`);
          });
        });

        try {
          await storage.updateContact(p(req.params.id), companyId, { portalPasswordHash });
        } catch (dbErr: unknown) {
          console.error("[portal-access/resend] Failed to update contact:", {
            contactId: p(req.params.id),
            companyId,
            message: dbErr instanceof Error ? dbErr.message : String(dbErr),
            stack: dbErr instanceof Error ? dbErr.stack : undefined,
            name: dbErr instanceof Error ? dbErr.name : undefined,
          });
          throw new Error(
            `Failed to save new portal credentials: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`
          );
        }

        const company = await storage.getCompany(companyId);
        const portalUrl = `${getBaseUrl(req)}/portal/login`;
        sendEmail({
          companyId: companyId,
          contactId: p(req.params.id),
          to: contact.email,
          subject: `Your ${company?.name || "ScooPilot"} Portal Login`,
          senderName: company?.name || undefined,
          replyTo: company?.email || undefined,
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
        }).catch((err) =>
          console.error("[portal-access/resend] Failed to send portal link email:", err)
        );

        res.json({
          success: true,
          message: "Portal link with new credentials has been emailed to the customer.",
        });
      } catch (err: unknown) {
        const e2 = err as Partial<Error>;
        console.error("[portal-access/resend] Unhandled error:", {
          message: e2.message,
          stack: e2.stack,
          name: e2.name,
        });
        handleError(res, err);
      }
    }
  );

  // ================ Client Onboarding Form ================

  app.post(
    "/api/contacts/:id/send-onboarding",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role, userId } = await getCompanyContext(req);
        requireRole(role);
        const contact = await storage.getContact(p(req.params.id), companyId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });

        const propertiesList = await storage.getProperties(companyId, p(req.params.id));
        if (!propertiesList || propertiesList.length === 0) {
          return res.status(400).json({
            error:
              "This contact has no properties. Add a property before sending an onboarding form.",
          });
        }

        const property = propertiesList[0];
        let token = property.onboardingToken;

        if (!token) {
          token = crypto.randomUUID();
          await storage.updateProperty(property.id, companyId, { onboardingToken: token });
        }

        const baseUrl = getBaseUrl(req);
        const onboardingUrl = `${baseUrl}/onboarding/${token}`;

        let emailed = false;

        if (contact.email) {
          const company = await storage.getCompany(companyId);
          if (company?.clientNotificationsSuppressed) {
            console.log(
              `[send-onboarding] Email suppressed for contact ${p(req.params.id)} — Import Mode on`
            );
          } else {
            const emailResult = await sendEmail({
              companyId,
              to: contact.email,
              subject: `${company?.name || "Your Service Provider"} — Please Complete Your Onboarding Form`,
              senderName: company?.name || undefined,
              replyTo: company?.email || undefined,
              text: `Hi ${contact.firstName},\n\nWelcome! To prepare for your first service visit, please take a few minutes to fill out our onboarding form.\n\nOnboarding Form: ${onboardingUrl}\n\nThis helps our technicians know about your dogs, gate access, and how to best serve you.\n\nThank you!`,
              html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                  <h1 style="color: white; margin: 0;">${escapeHtml(company?.name || "Your Service Provider")}</h1>
                </div>
                <div style="padding: 20px; border: 1px solid #e5e7eb;">
                  <p>Hi ${escapeHtml(contact.firstName)},</p>
                  <p>Welcome! To prepare for your first service visit, please take a few minutes to fill out our onboarding form.</p>
                  <p>This helps our technicians know about your dogs, gate access, and how to best serve you.</p>
                  <a href="${escapeHtml(onboardingUrl)}" style="display: inline-block; background-color: #2d8a5e; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; margin: 16px 0;">Complete Onboarding Form</a>
                  <p style="color: #6b7280; font-size: 14px;">Or copy this link: ${escapeHtml(onboardingUrl)}</p>
                </div>
              </div>
            `,
            }).catch((err) => {
              console.error("Failed to send onboarding email:", err);
              return { success: false, error: String(err) };
            });
            emailed = emailResult.success === true;
          }
        }

        storage
          .createActivityLog({
            companyId,
            contactId: p(req.params.id),
            userId,
            action: "email_sent",
            details: {
              type: emailed ? "onboarding_email_sent" : "onboarding_link_generated",
              url: onboardingUrl,
              propertyId: property.id,
              ...(emailed && { sentTo: contact.email }),
            },
          })
          .catch(console.error);

        res.json({ success: true, url: onboardingUrl, emailed, noEmail: !contact.email });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/contacts/:id/regenerate-onboarding",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role, userId } = await getCompanyContext(req);
        requireRole(role);
        const contact = await storage.getContact(p(req.params.id), companyId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });

        const propertiesList = await storage.getProperties(companyId, p(req.params.id));
        if (!propertiesList || propertiesList.length === 0) {
          return res.status(400).json({ error: "This contact has no properties." });
        }

        const property = propertiesList[0];
        const newToken = crypto.randomUUID();
        await storage.updateProperty(property.id, companyId, { onboardingToken: newToken });

        const baseUrl = getBaseUrl(req);
        const onboardingUrl = `${baseUrl}/onboarding/${newToken}`;

        storage
          .createActivityLog({
            companyId,
            contactId: p(req.params.id),
            userId,
            action: "email_sent",
            details: {
              type: "onboarding_link_regenerated",
              url: onboardingUrl,
              propertyId: property.id,
            },
          })
          .catch(console.error);

        if (contact.email) {
          const company = await storage.getCompany(companyId);
          if (company?.clientNotificationsSuppressed) {
            console.log(
              `[regenerate-onboarding] Email suppressed for contact ${p(req.params.id)} — Import Mode on`
            );
          } else {
            sendEmail({
              companyId,
              to: contact.email,
              subject: `${company?.name || "Your Service Provider"} — New Onboarding Link`,
              senderName: company?.name || undefined,
              replyTo: company?.email || undefined,
              text: `Hi ${contact.firstName},\n\nA new onboarding link has been generated for your account. Please use the link below (your previous link is no longer valid).\n\nOnboarding Form: ${onboardingUrl}\n\nThank you!`,
              html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                  <h1 style="color: white; margin: 0;">${escapeHtml(company?.name || "Your Service Provider")}</h1>
                </div>
                <div style="padding: 20px; border: 1px solid #e5e7eb;">
                  <p>Hi ${escapeHtml(contact.firstName)},</p>
                  <p>A new onboarding link has been generated for your account. Please use the link below — your previous link is no longer valid.</p>
                  <a href="${escapeHtml(onboardingUrl)}" style="display: inline-block; background-color: #2d8a5e; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; margin: 16px 0;">Complete Onboarding Form</a>
                  <p style="color: #6b7280; font-size: 14px;">Or copy this link: ${escapeHtml(onboardingUrl)}</p>
                </div>
              </div>
            `,
            }).catch((err) => console.error("Failed to send regenerated onboarding email:", err));
          }
        }

        res.json({ success: true, url: onboardingUrl, emailed: !!contact.email });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  interface OnboardingGetRow {
    id: string;
    contact_id: string;
    company_id: string;
    street_address: string;
    city: string;
    state: string;
    zip_code: string;
    number_of_dogs: number;
    gate_code: string | null;
    special_instructions: string | null;
    has_dangerous_dog: boolean;
    dangerous_dog_notes: string | null;
    dog_names: string | null;
    dog_breeds: string | null;
    onboarding_completed_at: string | null;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    company_name: string;
    logo_url: string | null;
  }

  app.get("/api/public/onboarding/:token", async (req: Request, res: Response) => {
    try {
      const { token: _token } = req.params;
      const token = p(_token);
      const rows = await db.execute(sql`
        SELECT p.id, p.contact_id, p.company_id, p.street_address, p.city, p.state, p.zip_code,
               p.number_of_dogs, p.gate_code, p.special_instructions,
               p.has_dangerous_dog, p.dangerous_dog_notes, p.dog_names, p.dog_breeds,
               p.onboarding_completed_at,
               c.first_name, c.last_name, c.email, c.phone,
               co.name as company_name, co.logo_url
        FROM properties p
        JOIN contacts c ON c.id = p.contact_id
        JOIN companies co ON co.id = p.company_id
        WHERE p.onboarding_token = ${token}
        LIMIT 1
      `);
      if (!rows.rows.length)
        return res.status(404).json({ error: "Onboarding link not found or expired" });
      const row = rows.rows[0] as unknown as OnboardingGetRow;
      res.json({
        contact: {
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          phone: row.phone,
        },
        property: {
          id: row.id,
          streetAddress: row.street_address,
          city: row.city,
          state: row.state,
          zipCode: row.zip_code,
          numberOfDogs: row.number_of_dogs,
          gateCode: row.gate_code,
          specialInstructions: row.special_instructions,
          hasDangerousDog: row.has_dangerous_dog,
          dangerousDogNotes: row.dangerous_dog_notes,
          dogNames: row.dog_names,
          dogBreeds: row.dog_breeds,
        },
        company: {
          name: row.company_name,
          logoUrl: row.logo_url,
          primaryColor: null,
        },
        alreadyCompleted: !!row.onboarding_completed_at,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/public/onboarding/:token", async (req: Request, res: Response) => {
    try {
      const { token: _token } = req.params;
      const token = p(_token);
      const rows = await db.execute(sql`
        SELECT p.id, p.company_id, p.contact_id, p.onboarding_completed_at
        FROM properties p
        WHERE p.onboarding_token = ${token}
        LIMIT 1
      `);
      if (!rows.rows.length) return res.status(404).json({ error: "Onboarding link not found" });
      const row = rows.rows[0] as {
        id: string;
        company_id: string;
        contact_id: string;
        onboarding_completed_at: string | null;
      };
      if (row.onboarding_completed_at) {
        return res.status(400).json({ error: "This onboarding form has already been submitted" });
      }

      const {
        dogNames,
        dogBreeds,
        hasDangerousDog,
        dangerousDogNotes,
        gateCode,
        specialInstructions,
        techInstructions,
        preferredContactMethod,
        bestContactTime,
      } = req.body;

      const combinedInstructions =
        [specialInstructions || "", techInstructions ? `Technician notes: ${techInstructions}` : ""]
          .filter(Boolean)
          .join("\n\n") || null;

      await db.execute(sql`
        UPDATE properties SET
          dog_names = ${dogNames || null},
          dog_breeds = ${dogBreeds || null},
          has_dangerous_dog = ${!!hasDangerousDog},
          dangerous_dog_notes = ${dangerousDogNotes || null},
          gate_code = ${gateCode || null},
          special_instructions = ${combinedInstructions},
          onboarding_completed_at = NOW(),
          onboarding_token = NULL,
          updated_at = NOW()
        WHERE id = ${row.id}
      `);

      if (preferredContactMethod || bestContactTime) {
        const contact = await storage.getContact(row.contact_id, row.company_id);
        if (contact) {
          const existing = (contact.reminderPreferences as Record<string, unknown>) || {};
          const updated: Record<string, unknown> = { ...existing };
          if (preferredContactMethod) {
            updated.contactMethod = preferredContactMethod;
            if (preferredContactMethod === "text") updated.preferredChannel = "sms";
            else if (preferredContactMethod === "email") updated.preferredChannel = "email";
          }
          if (bestContactTime) {
            updated.bestContactTime = bestContactTime;
            if (bestContactTime === "morning") updated.preferredTiming = "morning_of";
            else if (bestContactTime === "afternoon" || bestContactTime === "evening")
              updated.preferredTiming = "24h_before";
          }
          await storage.updateContact(row.contact_id, row.company_id, {
            reminderPreferences: updated as unknown as NonNullable<
              import("@shared/schema").Contact["reminderPreferences"]
            >,
          });
        }
      }

      storage
        .createActivityLog({
          companyId: row.company_id,
          contactId: row.contact_id,
          userId: null,
          action: "updated",
          details: { type: "onboarding_completed", propertyId: row.id },
        })
        .catch(console.error);

      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/contacts/bulk/send-portal-link",
    isAuthenticated,
    async (req: Request, res: Response) => {
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
            if (!contact) {
              skipped++;
              continue;
            }
            if (!contact.email) {
              skipped++;
              errors.push(`${contact.firstName} ${contact.lastName}: no email`);
              continue;
            }

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
              await storage.updateContact(contactId, companyId, {
                hasPortalAccess: true,
                portalPasswordHash,
              });
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
              companyId: companyId,
              contactId: contactId,
              to: contact.email,
              subject: `Your ${company?.name || "ScooPilot"} Portal Login`,
              senderName: company?.name || undefined,
              replyTo: company?.email || undefined,
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
            }).catch((err) =>
              console.error(`Failed to send portal link to ${contact.email}:`, err)
            );

            sent++;
          } catch (e: unknown) {
            skipped++;
            errors.push(e instanceof Error ? e.message : "Unknown error");
          }
        }

        res.json({ success: true, sent, skipped, errors: errors.length > 0 ? errors : undefined });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

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
    } catch (err) {
      handleError(res, err);
    }
  });

  app.put("/api/invoice-theme", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const theme = req.body;
      const allowed = [
        "primaryColor",
        "accentColor",
        "textColor",
        "mutedColor",
        "borderColor",
        "backgroundColor",
        "cardColor",
        "fontFamily",
        "logoSize",
        "borderRadius",
        "showLogo",
        "logoPosition",
      ];
      const filtered: Record<string, unknown> = {};
      const typedTheme = theme as Record<string, unknown>;
      for (const key of allowed) {
        if (typedTheme[key] !== undefined) filtered[key] = typedTheme[key];
      }
      if (
        filtered.logoPosition &&
        !["left", "center", "right"].includes(filtered.logoPosition as string)
      ) {
        return res.status(400).json({ error: "Invalid logoPosition" });
      }
      if (filtered.showLogo !== undefined) filtered.showLogo = Boolean(filtered.showLogo);
      await storage.updateCompany(companyId, { invoiceTheme: JSON.stringify(filtered) });
      const defaultTheme = loadTheme(getDefaultThemePath());
      res.json({ ...defaultTheme, ...filtered });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ── Invoice Template Rendering ──────────────────────────────────────

  app.get("/invoice/example", (_req: Request, res: Response) => {
    try {
      const examplePath = path.join(
        process.cwd(),
        "server",
        "templates",
        "examples",
        "invoice.example.json"
      );
      const rawData = JSON.parse(fs.readFileSync(examplePath, "utf-8"));
      const computed = computeInvoice(rawData);
      const tpl = loadTemplate(getDefaultTemplatePath());
      const theme = loadTheme(getDefaultThemePath());
      const html = renderInvoice(tpl, theme, computed);
      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/invoice/:invoiceId/render", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const invoice = await storage.getInvoice(p(req.params.invoiceId), companyId);
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
      const formattedDueDate = invoice.dueDate
        ? new Date(invoice.dueDate + "T12:00:00").toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : "";

      const billingAddr = contact.streetAddress
        ? {
            line1: contact.streetAddress,
            line2: contact.address2 || "",
            city: contact.city || "",
            state: contact.state || "",
            zip: contact.zipCode || "",
          }
        : null;
      const serviceAddrObj = serviceAddr
        ? {
            line1: serviceAddr.streetAddress || "",
            line2: "",
            city: serviceAddr.city || "",
            state: serviceAddr.state || "",
            zip: serviceAddr.zipCode || "",
          }
        : null;
      const billingLine = billingAddr
        ? `${billingAddr.line1} ${billingAddr.city} ${billingAddr.state} ${billingAddr.zip}`.trim()
        : "";
      const serviceLine = serviceAddrObj
        ? `${serviceAddrObj.line1} ${serviceAddrObj.city} ${serviceAddrObj.state} ${serviceAddrObj.zip}`.trim()
        : "";
      const showServiceAddress = serviceAddrObj && serviceLine && serviceLine !== billingLine;

      const hasStripe =
        isStripeConfigured() && parseFloat(invoice.total) > 0 && invoice.status !== "paid";
      const previewPaymentUrl = hasStripe ? "#preview" : "";

      const invoiceData: Record<string, unknown> = {
        business: {
          name: company?.name || "",
          address: company?.address || "",
          phone: company?.phone || "",
          website: "",
          logo: logoUrl,
        },
        invoice: {
          number: invoice.invoiceNumber,
          status: statusRaw,
          issue_date: new Date(invoice.createdAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
          due_date: formattedDueDate,
          terms: "Net 30",
          service_period: "",
        },
        customer: {
          name: `${contact.firstName} ${contact.lastName || ""}`.trim(),
        },
        billing_address: billingAddr,
        service_address: serviceAddrObj,
        show_service_address: showServiceAddress ? serviceAddrObj : null,
        line_items: lineItems.map((li: InvoiceLineItem) => ({
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
        visits: undefined,
        notes: invoice.notes || "",
        payment_instructions: "",
        thank_you: "Thank you for your business!",
        hasFooter: true,
        paymentUrl: previewPaymentUrl,
        venmoHandle: company?.venmoHandle || "",
        venmoHandleOnly: !previewPaymentUrl && !!company?.venmoHandle ? company.venmoHandle : "",
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
    } catch (err) {
      handleError(res, err);
    }
  });

  // ─── Documents ─────────────────────────────────────────────────────────────

  app.get("/api/portal/documents", async (req: Request, res: Response) => {
    try {
      const { contactId, companyId } = await getPortalContext(req);
      const requests = await storage.listDocumentRequests(companyId, contactId);
      const withSigs = await Promise.all(
        requests.map(async (r) => {
          const signatures = await storage.getDocumentSignatures(r.id);
          return { ...r, signatures };
        })
      );
      res.json(withSigs);
    } catch (err) {
      handleError(res, err);
    }
  });
}
