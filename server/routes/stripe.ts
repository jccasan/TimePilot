import type { Express, Request, Response } from "express";
import { maskEmail, maskPhone } from "../utils/pii";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { companies, invoices, stripeEvents } from "@shared/schema";
import {
  getUserByEmail,
  createUserWithTempPassword,
  claimOnboardingEmailSend,
  resetOnboardingEmailSent,
} from "../services/app-auth";
import { sendEmail, buildWelcomeEmailContent } from "../services/email";
import { sendSmsForCompany, isSmsConfiguredForCompany } from "../services/sms";
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
  ensureConnectedCustomer,
} from "../services/stripe";
import {
  seedRetellKnowledgeBase,
  provisionRetellNumber,
  registerRetellWebhook,
  cloneRetellAgent,
  getAppBaseUrl,
} from "../services/retell";
import { VOICE_PLAN_CONFIG } from "@shared/schema";

import {
  isAuthenticated,
  getCompanyContext,
  requireRole,
  getBaseUrl,
  handleError,
  auditLog,
  p,
  notify,
  qboAutoSync,
  seedDefaultLeadSources,
} from "./shared";

export async function registerStripeRoutes(app: Express): Promise<void> {
  // ================ Stripe Payment Routes ================

  app.get("/api/stripe/config", isAuthenticated, async (_req: Request, res: Response) => {
    res.json({ configured: isStripeConfigured() });
  });

  app.post(
    "/api/contacts/:id/stripe-customer",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);
        const contact = await storage.getContact(p(req.params.id), companyId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });

        if (contact.stripeCustomerId) {
          return res.json({ stripeCustomerId: contact.stripeCustomerId, alreadyExists: true });
        }

        const company = await storage.getCompany(companyId);
        const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;
        const stripeCustomerId = await createStripeCustomer({
          email: contact.email || undefined,
          name: `${contact.firstName} ${contact.lastName}`.trim(),
          phone: contact.phone || undefined,
          metadata: { contactId: contact.id, companyId },
          stripeAccount: connectAcct,
        });

        await storage.updateContact(p(req.params.id), companyId, { stripeCustomerId });
        res.json({ stripeCustomerId, alreadyExists: false });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/contacts/:id/send-payment-reminder",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const contact = await storage.getContact(p(req.params.id), companyId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });

        const company = await storage.getCompany(companyId);
        const contactInvoices = await storage.getInvoices(companyId, { contactId: contact.id });
        const outstanding = contactInvoices.filter((inv) =>
          ["pending", "sent"].includes(inv.status)
        );
        const totalOwed = outstanding.reduce((sum, inv) => sum + parseFloat(inv.total || "0"), 0);

        if (outstanding.length === 0) {
          return res.status(400).json({ error: "Contact has no outstanding invoices" });
        }

        const contactName = contact.firstName || "there";
        const companyName = company?.name || "Your service provider";
        const baseUrl = getBaseUrl(req);
        const portalUrl = `${baseUrl}/portal`;

        const emailSuppressed = !!company?.clientNotificationsSuppressed;
        if (emailSuppressed) {
          console.log(
            `[send-payment-reminder] Email suppressed for contact ${p(req.params.id)} — Import Mode on; SMS still active`
          );
        }

        let smsSent = false;
        let emailSent = false;

        if (contact.phone && (await isSmsConfiguredForCompany(companyId))) {
          const body = `Hi ${contactName}, you have an outstanding balance of $${totalOwed.toFixed(2)} with ${companyName}. Please visit ${portalUrl} to pay online. Reply STOP to opt out.`;
          await sendSmsForCompany({ to: contact.phone, body, companyId, contactId: contact.id });
          smsSent = true;
        }

        if (contact.email && !smsSent && !emailSuppressed) {
          const subject = `Payment Reminder from ${companyName}`;
          const text = `Hi ${contactName},\n\nThis is a reminder that you have an outstanding balance of $${totalOwed.toFixed(2)} with ${companyName}.\n\nPay online at: ${portalUrl}\n\nThank you!`;
          const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;"><h3>Payment Reminder</h3><p>Hi ${contactName},</p><p>This is a friendly reminder that you have an outstanding balance of <strong>$${totalOwed.toFixed(2)}</strong> with ${companyName}.</p><p><a href="${portalUrl}" style="background:#2d8a5e;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block;">Pay Online</a></p><p>Thank you!</p></div>`;
          await sendEmail({
            companyId,
            to: contact.email,
            subject,
            text,
            html,
            senderName: company?.name,
          });
          emailSent = true;
        }

        if (!smsSent && !emailSent && !emailSuppressed) {
          return res
            .status(400)
            .json({ error: "Contact has no phone or email to send a reminder to" });
        }

        res.json({
          success: true,
          smsSent,
          emailSent,
          suppressed: emailSuppressed && !smsSent,
          totalOwed,
        });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/contacts/:id/setup-intent",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role);
        const contact = await storage.getContact(p(req.params.id), companyId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });
        if (!contact.stripeCustomerId)
          return res
            .status(400)
            .json({ error: "Contact has no Stripe customer. Create one first." });

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
          await storage.updateContact(p(req.params.id), companyId, {
            stripeCustomerId: resolvedCustId,
          });
        }
        const result = await createSetupIntent(resolvedCustId, connectAcct);
        res.json(result);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get(
    "/api/contacts/:id/payment-methods",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const contact = await storage.getContact(p(req.params.id), companyId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });
        if (!contact.stripeCustomerId) return res.json([]);

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
          await storage.updateContact(p(req.params.id), companyId, {
            stripeCustomerId: resolvedCustId,
          });
        }
        const methods = await getCustomerPaymentMethods(resolvedCustId, connectAcct);
        res.json(methods);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.delete("/api/payment-methods/:pmId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contactId = req.query.contactId as string;
      if (!contactId)
        return res.status(400).json({ error: "contactId query parameter is required" });

      const contact = await storage.getContact(contactId, companyId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      if (!contact.stripeCustomerId)
        return res.status(400).json({ error: "Contact has no payment methods" });

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
      const owns = methods.some((m) => m.id === p(req.params.pmId));
      if (!owns)
        return res.status(403).json({ error: "Payment method not found for this contact" });

      await detachPaymentMethod(p(req.params.pmId), connectAcct);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/invoices/:id/charge", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const invoice = await storage.getInvoice(p(req.params.id), companyId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.status === "paid") return res.status(400).json({ error: "Invoice already paid" });

      const contact = await storage.getContact(invoice.contactId, companyId);
      if (!contact?.stripeCustomerId)
        return res.status(400).json({ error: "Contact has no payment method on file" });

      const company = await storage.getCompany(companyId);
      const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;

      const contactName = `${contact.firstName} ${contact.lastName}`.trim();
      const { customerId: resolvedCustomerId, wasRecreated } = await ensureConnectedCustomer({
        currentCustomerId: contact.stripeCustomerId,
        stripeAccount: connectAcct,
        email: contact.email || undefined,
        name: contactName,
        metadata: { contactId: contact.id, companyId },
      });
      if (wasRecreated) {
        await storage.updateContact(contact.id, companyId, {
          stripeCustomerId: resolvedCustomerId,
        });
      }

      const result = await chargeInvoiceAutomatically({
        customerId: resolvedCustomerId,
        amount: parseFloat(invoice.total),
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        stripeConnectAccountId: connectAcct,
        tenantId: companyId,
        currency: company?.currency || "usd",
      });

      const updateData: any = {
        paymentAttempts: (invoice.paymentAttempts || 0) + 1,
        lastPaymentAttempt: new Date(),
      };

      if (result.status === "succeeded") {
        updateData.status = "paid";
        updateData.paidAt = new Date();
        updateData.stripePaymentIntentId = result.paymentIntentId;
        notify(
          companyId,
          "invoice_paid",
          "Invoice Paid",
          `Invoice #${invoice.invoiceNumber} has been paid ($${invoice.total}).`,
          `/invoices`
        );
        qboAutoSync(companyId, invoice.id, "payment");
      } else if (result.status === "no_payment_method") {
        updateData.status = invoice.status === "draft" ? "draft" : "sent";
        notify(
          companyId,
          "payment_failed",
          "No Payment Method",
          `No payment method on file for ${contactName} (invoice #${invoice.invoiceNumber}). Send them a payment link to collect their card.`,
          `/invoices`
        );
      } else {
        updateData.status = "failed";
        if (result.paymentIntentId) updateData.stripePaymentIntentId = result.paymentIntentId;
        notify(
          companyId,
          "payment_failed",
          "Payment Failed",
          `Payment failed for invoice #${invoice.invoiceNumber}. The card on file was declined.`,
          `/invoices`
        );
      }

      const updated = await storage.updateInvoice(invoice.id, companyId, updateData);
      const { userId: chargeUserId } = await getCompanyContext(req);
      auditLog(
        companyId,
        chargeUserId,
        "invoice",
        invoice.id,
        "update",
        {
          old: { status: invoice.status, paymentAttempts: invoice.paymentAttempts },
          new: {
            status: updated.status,
            paymentAttempts: updated.paymentAttempts,
            chargeResult: result.status,
          },
        },
        req.ip || undefined
      );
      res.json({ ...updated, chargeResult: result });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/invoices/:id/checkout", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const invoice = await storage.getInvoice(p(req.params.id), companyId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.status === "paid") return res.status(400).json({ error: "Invoice already paid" });

      const contact = await storage.getContact(invoice.contactId, companyId);
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
      const result = await createCheckoutSession({
        customerId: stripeCustomerId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        amount: parseFloat(invoice.total),
        successUrl: `${baseUrl}/invoices?paid=${invoice.id}`,
        cancelUrl: `${baseUrl}/invoices`,
        stripeConnectAccountId: connectAcct,
        tenantId: companyId,
        currency: company?.currency || "usd",
      });

      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Stripe Connect Routes ================

  app.post("/api/stripe-connect/onboard", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      if (!isStripeConfigured()) return res.status(400).json({ error: "Stripe is not configured" });

      let accountId = company.stripeConnectAccountId;

      if (!accountId) {
        accountId = await createConnectAccount(companyId, company.name, company.email || "");
        await storage.updateCompany(companyId, { stripeConnectAccountId: accountId } as any);
      }

      const protocol = req.get("host")?.includes("localhost") ? "http" : "https";
      const baseUrl = `${protocol}://${req.get("host")}`;
      const onboardingUrl = await createConnectAccountLink(
        accountId,
        `${baseUrl}/settings?stripe_connect=refresh`,
        `${baseUrl}/settings?stripe_connect=return`
      );

      res.json({ url: onboardingUrl, accountId });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/stripe-connect/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      if (!company.stripeConnectAccountId) {
        return res.json({
          status: "not_started",
          chargesEnabled: false,
          detailsSubmitted: false,
          payoutsEnabled: false,
        });
      }

      try {
        const accountStatus = await getConnectAccountStatus(company.stripeConnectAccountId);

        if (accountStatus.chargesEnabled !== company.stripeConnectOnboarded) {
          await storage.updateCompany(companyId, {
            stripeConnectOnboarded: accountStatus.chargesEnabled,
          } as any);
        }

        return res.json({
          status: accountStatus.chargesEnabled ? "connected" : "pending",
          ...accountStatus,
        });
      } catch (stripeErr) {
        return res.json({
          status: "error",
          chargesEnabled: false,
          detailsSubmitted: false,
          payoutsEnabled: false,
        });
      }
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(
    "/api/stripe-connect/dashboard-link",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);
        const company = await storage.getCompany(companyId);
        if (!company) return res.status(404).json({ error: "Company not found" });
        if (!company.stripeConnectAccountId)
          return res.status(400).json({ error: "No Stripe Connect account" });

        try {
          const url = await createConnectLoginLink(company.stripeConnectAccountId);
          res.json({ url });
        } catch (err: any) {
          if (
            err.message?.includes("not a Standard account") ||
            err.type === "StripeInvalidRequestError"
          ) {
            const protocol = req.get("host")?.includes("localhost") ? "http" : "https";
            const baseUrl = `${protocol}://${req.get("host")}`;
            const onboardingUrl = await createConnectAccountLink(
              company.stripeConnectAccountId,
              `${baseUrl}/settings?stripe_connect=refresh`,
              `${baseUrl}/settings?stripe_connect=return`
            );
            return res.json({ url: onboardingUrl, isOnboarding: true });
          }
          throw err;
        }
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/stripe-connect/disconnect",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, role } = await getCompanyContext(req);
        requireRole(role, ["owner", "admin"]);
        await storage.updateCompany(companyId, {
          stripeConnectAccountId: null,
          stripeConnectOnboarded: false,
        } as any);
        res.json({ ok: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post("/api/webhooks/stripe", async (req: Request, res: Response) => {
    try {
      const sig = req.headers["stripe-signature"] as string;
      const secrets = [
        process.env.STRIPE_WEBHOOK_SECRET,
        process.env.STRIPE_WEBHOOK_SECRET_SCOOPILOT_SITE,
        process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
      ].filter(Boolean) as string[];

      if (!sig || secrets.length === 0) {
        return res.status(400).json({ error: "Missing signature or webhook secret" });
      }

      let event;
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      for (const secret of secrets) {
        try {
          event = constructWebhookEvent(rawBody, sig, secret);
          break;
        } catch {}
      }
      if (!event) {
        console.error(
          "Stripe webhook signature verification failed against all configured secrets"
        );
        return res.status(400).json({ error: "Webhook signature verification failed" });
      }

      const connectAccountId = (event as any).account as string | undefined;
      if (connectAccountId) {
        console.log(
          `[Stripe Webhook] Connect event ${event.id} (${event.type}) from account ${connectAccountId}`
        );
      }

      const [alreadyProcessed] = await db
        .select({ id: stripeEvents.id })
        .from(stripeEvents)
        .where(eq(stripeEvents.id, event.id))
        .limit(1);
      if (alreadyProcessed) {
        console.log(`[Stripe Webhook] Duplicate event ${event.id} (${event.type}) — skipping`);
        return res.json({ received: true });
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as any;
        const meta = session.metadata || {};
        const tenantId = meta.tenant_id;

        if (meta.checkout_type === "voice_addon" && tenantId) {
          const voicePlan = meta.voice_plan as "voice_bootstrap" | "voice_starter" | "voice_pro";
          if (voicePlan && VOICE_PLAN_CONFIG[voicePlan]) {
            const company = await storage.getCompany(tenantId);
            if (company) {
              const planConfig = VOICE_PLAN_CONFIG[voicePlan];
              const companyUpdates: Partial<typeof companies.$inferInsert> = {
                voicePlanTier: voicePlan,
                voicePlanStatus: "active",
                voicePlanIncludedMinutes: planConfig.includedMinutes,
                voicePlanOverageRate: String(planConfig.overageRate),
              };

              const customFields = (session.custom_fields ?? []) as Array<{
                key: string;
                text?: { value?: string };
                dropdown?: { value?: string };
              }>;

              // ── Step 1: Clone a per-tenant Retell agent from the template ──
              let effectiveAgentId = company.retellAgentId || null;
              if (!effectiveAgentId) {
                try {
                  const webhookUrl = getAppBaseUrl()
                    ? `${getAppBaseUrl()}/api/webhooks/retell`
                    : undefined;
                  effectiveAgentId = await cloneRetellAgent({
                    companyName: company.name,
                    webhookUrl,
                  });
                  (companyUpdates as Record<string, unknown>).retellAgentId = effectiveAgentId;
                  console.log(
                    `[Retell] Cloned agent "${effectiveAgentId}" for company "${company.name}" (${company.id})`
                  );
                } catch (agentErr: any) {
                  console.warn(
                    `[Retell] Failed to clone agent for company "${company.name}" (${company.id}): ${agentErr.message}`
                  );
                  effectiveAgentId = process.env.RETELL_AGENT_ID || null;
                  notify(
                    tenantId,
                    "system_warning",
                    "Voice Agent Setup Incomplete",
                    `Your voice plan is active but a dedicated AI agent could not be created (${agentErr.message}). Your account is using the shared agent in the meantime. Please contact support to resolve this.`,
                    `/settings`
                  );
                }
              }

              // ── Step 2: Phone number — new provisioning or port request ──
              const numberSetupField = customFields.find((f) => f.key === "number_setup");
              const numberSetup = numberSetupField?.dropdown?.value ?? "new";
              const phoneOrAreaCodeField = customFields.find((f) => f.key === "phone_or_area_code");
              const phoneOrAreaCodeValue = phoneOrAreaCodeField?.text?.value?.trim() || "";

              if (!company.dedicatedPhoneNumber) {
                if (numberSetup === "port") {
                  // Store the porting request; actual porting requires carrier paperwork
                  const numberToPort = phoneOrAreaCodeValue || "(not provided)";
                  (companyUpdates as Record<string, unknown>).portingPhoneNumber = numberToPort;
                  console.log(
                    `[Retell] Port request received for company "${company.name}" (${company.id}): ${maskPhone(numberToPort)}`
                  );
                  notify(
                    tenantId,
                    "system_warning",
                    "Number Porting Request Received",
                    `We received your request to port ${numberToPort} to ScooPilot. Number porting typically takes 2–4 weeks and requires a Letter of Authorization from your current carrier. Our team will contact you within one business day to begin the process.`,
                    `/settings`
                  );
                  // Admin notification (logged; team monitors server logs for port requests)
                  console.warn(
                    `[Retell PORT REQUEST] Company "${company.name}" (${company.id}) wants to port ${numberToPort}. Manual porting process required.`
                  );
                } else {
                  // Provision a new number
                  const areaCode = phoneOrAreaCodeValue.replace(/\D/g, "").slice(0, 3) || "703";
                  try {
                    const dedicatedPhoneNumber = await provisionRetellNumber({
                      areaCode,
                      agentId: effectiveAgentId ?? undefined,
                    });
                    companyUpdates.dedicatedPhoneNumber = dedicatedPhoneNumber;
                    console.log(
                      `[Retell] Provisioned number ${maskPhone(dedicatedPhoneNumber)} for company "${company.name}" (${company.id})`
                    );
                  } catch (phoneErr: any) {
                    console.warn(
                      `[Retell] Failed to provision phone number for company "${company.name}" (${company.id}): ${phoneErr.message}`
                    );
                    notify(
                      tenantId,
                      "system_warning",
                      "Phone Number Setup Failed",
                      `Your voice plan is active but we could not automatically provision a phone number (${phoneErr.message}). Please contact support to complete setup.`,
                      `/settings`
                    );
                  }
                }
              }

              // ── Step 3: Knowledge base ──
              const websiteField = customFields.find((f) => f.key === "business_website");
              const businessWebsite = websiteField?.text?.value?.trim() || "";

              let kbId: string | null = null;
              if (businessWebsite && effectiveAgentId) {
                try {
                  kbId = await seedRetellKnowledgeBase({
                    tenantId: company.id,
                    agentId: effectiveAgentId,
                    websiteUrl: businessWebsite,
                  });
                  console.log(
                    `[Retell KB] Created knowledge base "${kbId}" for company "${company.name}" (${company.id}) from ${businessWebsite}`
                  );
                } catch (kbErr: any) {
                  console.warn(
                    `[Retell KB] Failed to seed knowledge base for company "${company.name}" (${company.id}): ${kbErr.message}`
                  );
                  notify(
                    tenantId,
                    "system_warning",
                    "Knowledge Base Setup Failed",
                    `Voice plan activated but knowledge base creation from "${businessWebsite}" failed. Please set it up manually. Error: ${kbErr.message}`,
                    `/settings`
                  );
                }
              }

              if (kbId) {
                (companyUpdates as Record<string, unknown>).retellKnowledgeBaseId = kbId;
              }

              // ── Step 4: Register webhook if KB didn't already do it ──
              if (!kbId && effectiveAgentId) {
                try {
                  await registerRetellWebhook(effectiveAgentId);
                } catch (whErr: any) {
                  console.warn(
                    `[Retell] Failed to register webhook for agent ${effectiveAgentId}: ${whErr.message}`
                  );
                  notify(
                    tenantId,
                    "system_warning",
                    "Call Tracking Setup Incomplete",
                    `Voice plan activated but the call-event webhook could not be registered (agent: ${effectiveAgentId}). Call tracking may not work until this is resolved. Please contact support or check Settings. Error: ${whErr.message}`,
                    `/settings`
                  );
                }
              }

              await db.transaction(async (tx) => {
                await tx
                  .update(companies)
                  .set({ ...companyUpdates, updatedAt: new Date() })
                  .where(eq(companies.id, company.id));
              });

              console.log(
                `[Stripe Voice] checkout.session.completed: activated ${voicePlan} for company "${company.name}" (${company.id})`
              );
            }
          }
        }

        const invoiceId = meta.invoiceId;
        if (invoiceId) {
          const tipAmount = meta.tipAmount || "0";
          let resolved = false;

          if (tenantId) {
            const invoice = await storage.getInvoice(invoiceId, tenantId);
            if (invoice && invoice.status !== "paid") {
              await db.transaction(async (tx) => {
                await tx
                  .update(invoices)
                  .set({
                    status: "paid" as const,
                    paidAt: new Date(),
                    stripePaymentIntentId: session.payment_intent,
                    tipAmount,
                    updatedAt: new Date(),
                  })
                  .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, tenantId)));
              });
              const tipNote = parseFloat(tipAmount) > 0 ? ` (includes $${tipAmount} tip)` : "";
              notify(
                tenantId,
                "invoice_paid",
                "Invoice Paid",
                `Invoice #${invoice.invoiceNumber} has been paid ($${invoice.total})${tipNote}.`,
                `/invoices`
              );
              qboAutoSync(tenantId, invoiceId, "payment");
              resolved = true;
            } else if (invoice && invoice.status === "paid") {
              console.log(
                `[Stripe Webhook] checkout.session.completed: invoice ${invoiceId} already paid — skipping (session ${session.id})`
              );
              resolved = true;
            }
          }

          if (!resolved && !tenantId && connectAccountId) {
            const connCompany = await storage.getCompanyByStripeConnectAccountId(connectAccountId);
            if (connCompany) {
              const invoice = await storage.getInvoice(invoiceId, connCompany.id);
              if (invoice && invoice.status !== "paid") {
                const resolvedTenantId = connCompany.id;
                await db.transaction(async (tx) => {
                  await tx
                    .update(invoices)
                    .set({
                      status: "paid" as const,
                      paidAt: new Date(),
                      stripePaymentIntentId: session.payment_intent,
                      tipAmount,
                      updatedAt: new Date(),
                    })
                    .where(
                      and(eq(invoices.id, invoiceId), eq(invoices.companyId, resolvedTenantId))
                    );
                });
                const tipNote = parseFloat(tipAmount) > 0 ? ` (includes $${tipAmount} tip)` : "";
                notify(
                  resolvedTenantId,
                  "invoice_paid",
                  "Invoice Paid",
                  `Invoice #${invoice.invoiceNumber} has been paid ($${invoice.total})${tipNote}.`,
                  `/invoices`
                );
                qboAutoSync(resolvedTenantId, invoiceId, "payment");
                resolved = true;
                console.log(
                  `[Stripe Webhook] checkout.session.completed: resolved tenant via Connect account ${connectAccountId} → ${connCompany.name} (${connCompany.id})`
                );
              } else if (invoice && invoice.status === "paid") {
                console.log(
                  `[Stripe Webhook] checkout.session.completed: invoice ${invoiceId} already paid — skipping (session ${session.id})`
                );
                resolved = true;
              }
            }
          }

          if (!resolved) {
            console.warn(
              `[Stripe Webhook] checkout.session.completed: could not resolve invoice ${invoiceId} (session ${session.id}, tenant_id=${tenantId || "missing"}, connectAccount=${connectAccountId || "none"}). Manual resolution required.`
            );
          }
        }

        // Seat add-on purchase
        if (meta.type === "seat_purchase" && meta.companyId) {
          try {
            const seatCompany = await storage.getCompany(meta.companyId);
            if (seatCompany) {
              const qty = (session as any).line_items?.data?.[0]?.quantity ?? 1;
              const tierConfig = (await import("@shared/schema")).TIER_CONFIG;
              const tierMax =
                tierConfig[seatCompany.subscriptionTier as keyof typeof tierConfig]?.maxUsers || 1;
              const currentMax = seatCompany.customMaxUsers ?? tierMax;
              await storage.updateCompany(meta.companyId, {
                customMaxUsers: currentMax + qty,
              } as any);
              console.log(
                `[Stripe Seats] Added ${qty} seat(s) to company "${seatCompany.name}" (${meta.companyId}). New max: ${currentMax + qty}`
              );
            } else {
              console.warn(
                `[Stripe Seats] seat_purchase: company ${meta.companyId} not found (session ${session.id})`
              );
            }
          } catch (seatErr: any) {
            console.error(
              `[Stripe Seats] Failed to process seat purchase (session ${session.id}): ${seatErr.message}`
            );
          }
        }

        // Route credit purchase via Stripe Pricing Table
        // Products in the pricing table must have metadata: { type: "route_credits", credits: "N" }
        // The pricing table element sets client-reference-id to the company ID
        const refCompanyId = session.client_reference_id as string | null;
        if (refCompanyId && !meta.invoiceId && meta.checkout_type !== "voice_addon") {
          try {
            const { default: StripeLib } = await import("stripe");
            const stripeLib = new StripeLib(process.env.STRIPE_SECRET_KEY!, {
              apiVersion: "2026-01-28.clover" as any,
            });
            const fullSession = await stripeLib.checkout.sessions.retrieve(session.id, {
              expand: ["line_items.data.price.product"],
            });
            let creditsToAdd = 0;
            for (const item of fullSession.line_items?.data ?? []) {
              const product = (item.price as any)?.product;
              if (
                product &&
                typeof product === "object" &&
                product.metadata?.type === "route_credits"
              ) {
                const credits = parseInt(product.metadata.credits ?? "0", 10);
                creditsToAdd += credits * (item.quantity ?? 1);
              }
            }
            if (creditsToAdd > 0) {
              const company = await storage.getCompany(refCompanyId);
              if (company) {
                const newTotal = (company.routeCredits ?? 0) + creditsToAdd;
                await storage.updateCompany(refCompanyId, { routeCredits: newTotal } as any);
                console.log(
                  `[Stripe Credits] Added ${creditsToAdd} route credits to company "${company.name}" (${refCompanyId}). New total: ${newTotal}`
                );
              } else {
                console.warn(
                  `[Stripe Credits] checkout.session.completed: company ${refCompanyId} not found (session ${session.id})`
                );
              }
            }
          } catch (creditErr: any) {
            console.error(
              `[Stripe Credits] Failed to process route credit purchase (session ${session.id}): ${creditErr.message}`
            );
          }
        }
      }

      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object as any;
        const invoiceId = pi.metadata?.invoiceId;
        if (invoiceId) {
          const piTenantId = pi.metadata?.tenant_id;
          let resolved = false;

          if (piTenantId) {
            const invoice = await storage.getInvoice(invoiceId, piTenantId);
            if (invoice && invoice.status !== "paid") {
              await storage.updateInvoice(invoiceId, piTenantId, {
                status: "paid",
                paidAt: new Date(),
                stripePaymentIntentId: pi.id,
              });
              auditLog(piTenantId, null, "invoice", invoiceId, "update", {
                old: { status: invoice.status },
                new: { status: "paid", paymentMethod: "stripe_webhook" },
                actor: "stripe_webhook",
              });
              notify(
                piTenantId,
                "invoice_paid",
                "Invoice Paid",
                `Invoice #${invoice.invoiceNumber} has been paid ($${invoice.total}).`,
                `/invoices`
              );
              qboAutoSync(piTenantId, invoiceId, "payment");
              resolved = true;
            } else if (invoice && invoice.status === "paid") {
              console.log(
                `[Stripe Webhook] payment_intent.succeeded: invoice ${invoiceId} already paid — skipping (pi ${pi.id})`
              );
              resolved = true;
            }
          }

          if (!resolved && !piTenantId && connectAccountId) {
            const connCompany = await storage.getCompanyByStripeConnectAccountId(connectAccountId);
            if (connCompany) {
              const invoice = await storage.getInvoice(invoiceId, connCompany.id);
              if (invoice && invoice.status !== "paid") {
                await storage.updateInvoice(invoiceId, connCompany.id, {
                  status: "paid",
                  paidAt: new Date(),
                  stripePaymentIntentId: pi.id,
                });
                auditLog(connCompany.id, null, "invoice", invoiceId, "update", {
                  old: { status: invoice.status },
                  new: { status: "paid", paymentMethod: "stripe_webhook" },
                  actor: "stripe_webhook",
                });
                notify(
                  connCompany.id,
                  "invoice_paid",
                  "Invoice Paid",
                  `Invoice #${invoice.invoiceNumber} has been paid ($${invoice.total}).`,
                  `/invoices`
                );
                qboAutoSync(connCompany.id, invoiceId, "payment");
                resolved = true;
                console.log(
                  `[Stripe Webhook] payment_intent.succeeded: resolved tenant via Connect account ${connectAccountId} → ${connCompany.name} (${connCompany.id})`
                );
              } else if (invoice && invoice.status === "paid") {
                console.log(
                  `[Stripe Webhook] payment_intent.succeeded: invoice ${invoiceId} already paid — skipping (pi ${pi.id})`
                );
                resolved = true;
              }
            }
          }

          if (!resolved) {
            console.warn(
              `[Stripe Webhook] payment_intent.succeeded: could not resolve invoice ${invoiceId} (pi ${pi.id}, tenant_id=${piTenantId || "missing"}, connectAccount=${connectAccountId || "none"}). Manual resolution required.`
            );
          }
        }
      }

      if (event.type === "account.updated") {
        const account = event.data.object as any;
        const accountId = account.id;
        if (accountId) {
          const company = await storage.getCompanyByStripeConnectAccountId(accountId);
          if (company) {
            const isOnboarded = account.charges_enabled === true;
            if (isOnboarded !== company.stripeConnectOnboarded) {
              await storage.updateCompany(company.id, {
                stripeConnectOnboarded: isOnboarded,
              } as any);
              console.log(
                `[Stripe Connect] Company ${company.name} (${company.id}) onboarded=${isOnboarded}`
              );
            }
          }
        }
      }

      const eventTs = new Date(event.created * 1000);

      const isStaleSubscriptionEvent = (company: {
        subscriptionUpdatedAt?: Date | null;
      }): boolean => {
        if (!company.subscriptionUpdatedAt) return false;
        return eventTs <= company.subscriptionUpdatedAt;
      };

      if (event.type === "customer.subscription.created") {
        const subscription = event.data.object as {
          id: string;
          customer: string;
          status: string;
          metadata: Record<string, string>;
          trial_end?: number | null;
          items?: { data?: Array<{ id: string }> };
        };
        const meta = subscription.metadata || {};

        if (meta.checkout_type === "voice_addon") {
          const tenantId = meta.tenant_id;
          const voicePlan = meta.voice_plan as "voice_bootstrap" | "voice_starter" | "voice_pro";
          if (tenantId && voicePlan) {
            const company = await storage.getCompany(tenantId);
            if (company) {
              const planConfig = VOICE_PLAN_CONFIG[voicePlan];
              const isSubscriber = company.subscriptionStatus === "active";
              await storage.updateCompany(company.id, {
                voicePlanTier: voicePlan,
                voicePlanStatus: "active",
                voicePlanIncludedMinutes: planConfig.includedMinutes,
                voicePlanOverageRate: String(planConfig.overageRate),
                stripeVoiceSubscriptionId: subscription.id,
              } as Partial<typeof companies.$inferInsert>);
              console.log(
                `[Stripe Voice] Activated ${voicePlan} for company "${company.name}" (${company.id}), subscriber=${isSubscriber}`
              );
            }
          }
          await db
            .insert(stripeEvents)
            .values({ id: event.id, eventType: event.type })
            .onConflictDoNothing();
          res.json({ received: true });
          return;
        }

        const companyName = meta.company_name;
        const email = meta.email;
        const firstName = meta.first_name || "";
        const lastName = meta.last_name || "";
        const phone = meta.phone || "";
        const tierMap: Record<string, string> = {
          free_trial: "free_trial",
          tier_starter: "tier_starter",
          tier_1: "tier_1",
          tier_1_3: "tier_1_3",
          tier_3_5: "tier_3_5",
          tier_6_10: "tier_6_10",
          tier_10_plus: "tier_10_plus",
        };
        const planTier = tierMap[meta.plan_tier] || "tier_1";

        if (meta.tenant_id) {
          const company = await storage.getCompany(meta.tenant_id);
          if (company) {
            if (isStaleSubscriptionEvent(company)) {
              console.log(
                `[Stripe Subscription] Skipping stale subscription.created for company "${company.name}" (event ${event.id} ts=${event.created})`
              );
              await db
                .insert(stripeEvents)
                .values({ id: event.id, eventType: event.type })
                .onConflictDoNothing();
              res.json({ received: true });
              return;
            }
            const subStatus = subscription.status === "trialing" ? "trialing" : "active";
            const updateData: Record<string, unknown> = {
              stripeCustomerId: subscription.customer,
              stripeSubscriptionId: subscription.id,
              subscriptionTier: planTier,
              subscriptionStatus: subStatus,
              subscriptionUpdatedAt: eventTs,
            };
            if (subscription.trial_end) {
              updateData.trialEndsAt = new Date(subscription.trial_end * 1000);
            }
            await storage.updateCompany(
              company.id,
              updateData as Partial<typeof companies.$inferInsert>
            );
            console.log(
              `[Stripe Subscription] Updated company "${company.name}" via tenant_id (${company.id}) status=${subStatus}`
            );
            await db
              .insert(stripeEvents)
              .values({ id: event.id, eventType: event.type })
              .onConflictDoNothing();
            res.json({ received: true });
            return;
          }
        }

        if (companyName && email && firstName) {
          const existingUser = await getUserByEmail(email);

          if (existingUser) {
            const existingCompanies = await storage.getCompaniesForUser(existingUser.id);
            if (existingCompanies.length > 0) {
              const company = await storage.getCompany(existingCompanies[0].companyId);
              if (company) {
                if (isStaleSubscriptionEvent(company)) {
                  console.log(
                    `[Stripe Subscription] Skipping stale subscription.created for existing company "${company.name}" (event ${event.id} ts=${event.created})`
                  );
                } else {
                  const subStatus = subscription.status === "trialing" ? "trialing" : "active";
                  const updateData: Record<string, unknown> = {
                    stripeCustomerId: subscription.customer,
                    stripeSubscriptionId: subscription.id,
                    subscriptionTier: planTier,
                    subscriptionStatus: subStatus,
                    subscriptionUpdatedAt: eventTs,
                  };
                  if (subscription.trial_end) {
                    updateData.trialEndsAt = new Date(subscription.trial_end * 1000);
                  }
                  await storage.updateCompany(
                    company.id,
                    updateData as Partial<typeof companies.$inferInsert>
                  );
                  console.log(
                    `[Stripe Subscription] Updated existing company "${company.name}" (${company.id}) for subscription ${subscription.id} status=${subStatus}`
                  );
                }
              }
            } else {
              const subStatus2 = subscription.status === "trialing" ? "trialing" : "active";
              const createData: Record<string, unknown> = {
                name: companyName.trim(),
                email,
                phone,
                subscriptionTier: planTier,
                subscriptionStatus: subStatus2,
                stripeCustomerId: subscription.customer,
                stripeSubscriptionId: subscription.id,
                subscriptionUpdatedAt: eventTs,
              };
              if (subscription.trial_end) {
                createData.trialEndsAt = new Date(subscription.trial_end * 1000);
              }
              const company = await storage.createCompany(
                createData as typeof companies.$inferInsert
              );
              await storage.addUserToCompany(existingUser.id, company.id, "owner");
              await seedDefaultLeadSources(company.id);
              await storage.seedDefaultPricing(company.id);
              console.log(
                `[Stripe Subscription] Created company "${companyName}" (${company.id}) for existing user ${email} status=${subStatus2}`
              );
            }
          } else {
            const crypto = await import("crypto");
            const tempPassword = crypto.randomBytes(6).toString("base64url");
            const user = await createUserWithTempPassword(email, firstName, lastName, tempPassword);

            const subStatus3 = subscription.status === "trialing" ? "trialing" : "active";
            const createData2: Record<string, unknown> = {
              name: companyName.trim(),
              email,
              phone,
              subscriptionTier: planTier,
              subscriptionStatus: subStatus3,
              stripeCustomerId: subscription.customer,
              stripeSubscriptionId: subscription.id,
              subscriptionUpdatedAt: eventTs,
            };
            if (subscription.trial_end) {
              createData2.trialEndsAt = new Date(subscription.trial_end * 1000);
            }
            const company = await storage.createCompany(
              createData2 as typeof companies.$inferInsert
            );
            await storage.addUserToCompany(user.id, company.id, "owner");
            await seedDefaultLeadSources(company.id);
            await storage.seedDefaultPricing(company.id);

            const claimed = await claimOnboardingEmailSend(user.id).catch(() => false);
            if (!claimed) {
              console.log(
                `[Stripe Subscription] Onboarding email already sent for ${maskEmail(email)}, skipping.`
              );
            } else {
              try {
                const protocol = req.headers["x-forwarded-proto"] || "https";
                const host = req.headers.host || "localhost:5000";
                const appUrl = `${protocol}://${host}`;
                const _stripeWelcome = buildWelcomeEmailContent({
                  firstName,
                  companyName,
                  appUrl,
                  email,
                  tempPassword,
                });
                await sendEmail({
                  companyId: company.id,
                  to: email,
                  subject: _stripeWelcome.subject,
                  text: _stripeWelcome.text,
                  html: _stripeWelcome.html,
                });
                console.log(`[Stripe Subscription] Welcome email sent to ${maskEmail(email)}`);
              } catch (emailErr) {
                console.error(
                  `[Stripe Subscription] Failed to send welcome email to ${maskEmail(email)}, resetting flag:`,
                  emailErr
                );
                await resetOnboardingEmailSent(user.id).catch(() => {});
              }
            }

            console.log(
              `[Stripe Subscription] Provisioned new tenant "${companyName}" (${company.id}) for ${maskEmail(email)}, subscription ${subscription.id}`
            );
          }
        } else {
          console.warn(
            `[Stripe Subscription] Missing required metadata (company_name, email, first_name) on subscription ${subscription.id}`
          );
        }
      }

      if (event.type === "customer.subscription.updated") {
        const subscription = event.data.object as {
          id: string;
          status: string;
          metadata: Record<string, string>;
          trial_end?: number | null;
          cancel_at_period_end?: boolean;
          cancel_at?: number | null;
          items?: { data?: Array<{ id: string; price?: { id: string } }> };
        };
        const stripeSubId = subscription.id;
        const meta = subscription.metadata || {};

        if (meta.checkout_type === "voice_addon") {
          const allCompanies = await storage.listCompanies();
          for (const company of allCompanies) {
            if (company.stripeVoiceSubscriptionId === stripeSubId) {
              const statusMap: Record<string, string> = {
                active: "active",
                past_due: "past_due",
                canceled: "cancelled",
                unpaid: "suspended",
              };
              const newVoiceStatus = statusMap[subscription.status] || subscription.status;
              const voiceUpdates: Record<string, unknown> = { voicePlanStatus: newVoiceStatus };

              const voicePriceEnvMap: Record<string, string> = {};
              if (process.env.STRIPE_PRICE_VOICE_BOOTSTRAP)
                voicePriceEnvMap[process.env.STRIPE_PRICE_VOICE_BOOTSTRAP] = "voice_bootstrap";
              if (process.env.STRIPE_PRICE_VOICE_STARTER)
                voicePriceEnvMap[process.env.STRIPE_PRICE_VOICE_STARTER] = "voice_starter";
              if (process.env.STRIPE_PRICE_VOICE_PRO)
                voicePriceEnvMap[process.env.STRIPE_PRICE_VOICE_PRO] = "voice_pro";

              const currentPriceId = subscription.items?.data?.[0]?.price?.id;
              const derivedPlan = currentPriceId ? voicePriceEnvMap[currentPriceId] : null;
              const resolvedPlan = derivedPlan || meta.voice_plan;

              if (
                resolvedPlan &&
                VOICE_PLAN_CONFIG[resolvedPlan as keyof typeof VOICE_PLAN_CONFIG]
              ) {
                const vc = VOICE_PLAN_CONFIG[resolvedPlan as keyof typeof VOICE_PLAN_CONFIG];
                voiceUpdates.voicePlanTier = resolvedPlan;
                voiceUpdates.voicePlanIncludedMinutes = vc.includedMinutes;
                voiceUpdates.voicePlanOverageRate = String(vc.overageRate);
              }
              if (newVoiceStatus === "cancelled") {
                voiceUpdates.voicePlanTier = null;
                voiceUpdates.voicePlanStatus = null;
                voiceUpdates.voicePlanIncludedMinutes = null;
                voiceUpdates.voicePlanOverageRate = null;
                voiceUpdates.stripeVoiceSubscriptionId = null;
              }
              await storage.updateCompany(
                company.id,
                voiceUpdates as Partial<typeof companies.$inferInsert>
              );
              console.log(
                `[Stripe Voice] Updated company "${company.name}" voice status=${newVoiceStatus} plan=${resolvedPlan || "unchanged"}`
              );
              break;
            }
          }
        } else {
          const allCompanies = await storage.listCompanies();
          for (const company of allCompanies) {
            if (company.stripeSubscriptionId === stripeSubId) {
              if (isStaleSubscriptionEvent(company)) {
                console.log(
                  `[Stripe Subscription] Skipping stale subscription.updated for company "${company.name}" (event ${event.id} ts=${event.created})`
                );
                break;
              }
              const statusMap: Record<string, string> = {
                active: "active",
                past_due: "past_due",
                canceled: "cancelled",
                trialing: "trialing",
                unpaid: "suspended",
              };
              const newStatus = statusMap[subscription.status] || "active";
              const tierMap: Record<string, string> = {
                free_trial: "free_trial",
                tier_starter: "tier_starter",
                tier_1: "tier_1",
                tier_1_3: "tier_1_3",
                tier_3_5: "tier_3_5",
                tier_6_10: "tier_6_10",
                tier_10_plus: "tier_10_plus",
              };
              const updates: Record<string, unknown> = {
                subscriptionStatus: newStatus,
                subscriptionUpdatedAt: eventTs,
              };
              if (meta.plan_tier && tierMap[meta.plan_tier]) {
                updates.subscriptionTier = tierMap[meta.plan_tier];
              }
              if (newStatus === "active" && company.frozenAt) {
                updates.frozenAt = null;
              }
              if (subscription.trial_end) {
                updates.trialEndsAt = new Date(subscription.trial_end * 1000);
              }
              // Sync cancel_at_period_end state from Stripe
              if (subscription.cancel_at_period_end) {
                updates.cancelAtPeriodEnd = true;
                updates.cancelAt = subscription.cancel_at
                  ? new Date(subscription.cancel_at * 1000)
                  : null;
              } else {
                updates.cancelAtPeriodEnd = false;
                updates.cancelAt = null;
              }
              await storage.updateCompany(
                company.id,
                updates as Partial<typeof companies.$inferInsert>
              );
              console.log(
                `[Stripe Subscription] Updated company "${company.name}" status=${newStatus} cancelAtPeriodEnd=${!!subscription.cancel_at_period_end}`
              );
              break;
            }
          }
        }
      }

      if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object as { id: string; metadata?: Record<string, string> };
        const stripeSubId = subscription.id;
        const allCompanies = await storage.listCompanies();
        let handled = false;
        for (const company of allCompanies) {
          if (company.stripeVoiceSubscriptionId === stripeSubId) {
            await storage.updateCompany(company.id, {
              voicePlanTier: null,
              voicePlanStatus: null,
              voicePlanIncludedMinutes: null,
              voicePlanOverageRate: null,
              stripeVoiceSubscriptionId: null,
            } as Partial<typeof companies.$inferInsert>);
            console.log(`[Stripe Voice] Company "${company.name}" voice plan cancelled`);
            handled = true;
            break;
          }
        }
        if (!handled) {
          for (const company of allCompanies) {
            if (company.stripeSubscriptionId === stripeSubId) {
              if (isStaleSubscriptionEvent(company)) {
                console.log(
                  `[Stripe Subscription] Skipping stale subscription.deleted for company "${company.name}" (event ${event.id} ts=${event.created})`
                );
                break;
              }
              await storage.updateCompany(company.id, {
                subscriptionStatus: "cancelled",
                canceledAt: new Date(),
                subscriptionUpdatedAt: eventTs,
                cancelAtPeriodEnd: false,
                cancelAt: null,
              } as Partial<typeof companies.$inferInsert>);
              console.log(
                `[Stripe Subscription] Company "${company.name}" subscription cancelled (period end reached)`
              );
              break;
            }
          }
        }
      }

      if (event.type === "customer.subscription.trial_will_end") {
        const subscription = event.data.object as { id: string; metadata: Record<string, string> };
        const meta = subscription.metadata || {};
        const email = meta.email;
        const companyName = meta.company_name || "your company";
        const trialCompanyId = meta.company_id || "";
        if (email) {
          try {
            const baseUrl = process.env.REPLIT_DEPLOYMENT_URL
              ? `https://${process.env.REPLIT_DEPLOYMENT_URL}`
              : process.env.REPLIT_DEV_DOMAIN
                ? `https://${process.env.REPLIT_DEV_DOMAIN}`
                : "https://scoopilot.replit.app";
            await sendEmail({
              companyId: trialCompanyId,
              to: email,
              subject: `Your ScooPilot trial ends soon`,
              text: `Hi,\n\nYour 14-day free trial for "${companyName}" ends in 3 days. Add a payment method to keep your account active.\n\nVisit ${baseUrl}/billing to update your billing.`,
              html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
                <div style="background-color:#2d8a5e;padding:20px;text-align:center"><h1 style="color:white;margin:0">ScooPilot</h1></div>
                <div style="padding:20px;border:1px solid #e5e7eb">
                  <h2 style="margin-top:0">Your trial ends in 3 days</h2>
                  <p>Your free trial for <strong>${companyName}</strong> is ending soon.</p>
                  <p>Add a payment method to keep your account active and avoid any service interruption.</p>
                  <a href="${baseUrl}/billing" style="display:inline-block;background-color:#2d8a5e;color:white;padding:12px 24px;text-decoration:none;border-radius:6px">Update Billing</a>
                </div></div>`,
            });
            console.log(`[Stripe Subscription] Trial ending email sent to ${email}`);
          } catch (e) {
            console.error(
              `[Stripe Subscription] Failed to send trial ending email to ${email}:`,
              e
            );
          }
        }
      }

      if (event.type === "invoice.payment_failed") {
        const invoice = event.data.object as {
          customer: string | { id: string };
          attempt_count?: number;
          subscription?: string | null;
          billing_reason?: string;
        };
        const stripeCustomerId =
          typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        if (stripeCustomerId && invoice.subscription) {
          const allCompanies = await storage.listCompanies();
          for (const company of allCompanies) {
            if (
              company.stripeCustomerId === stripeCustomerId &&
              company.stripeSubscriptionId === invoice.subscription
            ) {
              if (isStaleSubscriptionEvent(company)) {
                console.log(
                  `[Stripe Subscription] Skipping stale invoice.payment_failed for company "${company.name}" (event ${event.id} ts=${event.created})`
                );
                break;
              }
              await storage.updateCompany(company.id, {
                subscriptionStatus: "suspended",
                frozenAt: new Date(),
                subscriptionUpdatedAt: eventTs,
              } as Partial<typeof companies.$inferInsert>);
              const attemptCount = invoice.attempt_count || 1;
              console.log(
                `[Stripe Subscription] Company "${company.name}" SUSPENDED after subscription payment failure (attempt ${attemptCount})`
              );
              notify(
                company.id,
                "payment_failed",
                "Account Suspended",
                "Your subscription payment has failed. Please update your payment method to restore access.",
                "/billing"
              );
              break;
            }
          }
        }
      }

      if (event.type === "invoice.payment_succeeded") {
        const stripeInvoice = event.data.object as {
          customer: string | { id: string };
          subscription?: string | null;
          billing_reason?: string;
        };
        const stripeCustomerId =
          typeof stripeInvoice.customer === "string"
            ? stripeInvoice.customer
            : stripeInvoice.customer?.id;
        if (stripeCustomerId && stripeInvoice.subscription) {
          const allCompanies = await storage.listCompanies();
          for (const company of allCompanies) {
            if (
              company.stripeCustomerId === stripeCustomerId &&
              company.stripeSubscriptionId === stripeInvoice.subscription
            ) {
              if (isStaleSubscriptionEvent(company)) {
                console.log(
                  `[Stripe Subscription] Skipping stale invoice.payment_succeeded for company "${company.name}" (event ${event.id} ts=${event.created})`
                );
                break;
              }
              if (company.subscriptionStatus === "suspended" || company.frozenAt) {
                await storage.updateCompany(company.id, {
                  subscriptionStatus: "active",
                  frozenAt: null,
                  subscriptionUpdatedAt: eventTs,
                } as Partial<typeof companies.$inferInsert>);
                console.log(
                  `[Stripe Subscription] Company "${company.name}" REACTIVATED after successful subscription payment`
                );
                notify(
                  company.id,
                  "general",
                  "Payment Received",
                  "Your subscription payment was successful. Your account has been reactivated.",
                  "/billing"
                );
              } else {
                console.log(
                  `[Stripe Subscription] Company "${company.name}" subscription payment succeeded (status=${company.subscriptionStatus})`
                );
              }
              break;
            }
          }
        }
      }

      if (event.type === "payment_intent.payment_failed") {
        const pi = event.data.object as { id: string; metadata?: Record<string, string> };
        const invoiceId = pi.metadata?.invoiceId;
        if (invoiceId) {
          let resolvedCompanyId = pi.metadata?.tenant_id;

          if (!resolvedCompanyId && connectAccountId) {
            const connCompany = await storage.getCompanyByStripeConnectAccountId(connectAccountId);
            if (connCompany) {
              resolvedCompanyId = connCompany.id;
              console.log(
                `[Stripe Webhook] payment_intent.payment_failed: resolved tenant via Connect account ${connectAccountId} → ${connCompany.name} (${connCompany.id})`
              );
            }
          }

          if (resolvedCompanyId) {
            const invoice = await storage.getInvoice(invoiceId, resolvedCompanyId);
            if (invoice) {
              await storage.updateInvoice(invoiceId, resolvedCompanyId, {
                status: "failed",
                paymentAttempts: (invoice.paymentAttempts || 0) + 1,
                lastPaymentAttempt: new Date(),
              });
              notify(
                resolvedCompanyId,
                "payment_failed",
                "Payment Failed",
                `Payment failed for invoice #${invoice.invoiceNumber}.`,
                `/invoices`
              );
            } else {
              console.warn(
                `[Stripe Webhook] payment_intent.payment_failed: tenant ${resolvedCompanyId} resolved but invoice ${invoiceId} not found (pi ${pi.id}).`
              );
            }
          } else {
            console.warn(
              `[Stripe Webhook] payment_intent.payment_failed: could not resolve tenant for invoice ${invoiceId} (pi ${pi.id}, connectAccount=${connectAccountId || "none"}). Manual resolution required.`
            );
          }
        }
      }

      await db
        .insert(stripeEvents)
        .values({ id: event.id, eventType: event.type })
        .onConflictDoNothing();

      res.json({ received: true });
    } catch (err) {
      console.error("Stripe webhook error:", err);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });
}
