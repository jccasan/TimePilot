import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { sendEmail } from "../services/email";
import { isAuthenticated, getCompanyContext, handleError, p } from "./shared";

export async function registerEmailInboundRoutes(app: Express): Promise<void> {
  app.get("/api/email/inbound-address", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });

      if (!company.inboundEmail && company.phone) {
        const { provisionInboundEmail } = await import("../services/inbound-email");
        await provisionInboundEmail(company);
        const updated = await storage.getCompany(companyId);
        return res.json({
          inbound_email: updated?.inboundEmail || null,
          pending: !updated?.inboundEmail,
        });
      }

      res.json({
        inbound_email: company.inboundEmail || null,
        pending: !company.inboundEmail,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/email/unmatched", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const includeIgnored = req.query.include_ignored === "true";

      if (page === undefined && limit === undefined) {
        const count = await storage.getUnmatchedEmailsCount(companyId);
        return res.json({ count });
      }

      const result = await storage.getUnmatchedEmails(
        companyId,
        page ?? 1,
        limit ?? 25,
        includeIgnored
      );
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/email/unmatched/:id/link",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const { contact_id } = req.body;
        if (!contact_id) return res.status(400).json({ error: "contact_id is required" });

        const contact = await storage.getContact(contact_id, companyId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });

        const email = await storage.getInboundEmailById(p(req.params.id), companyId);
        if (!email) return res.status(404).json({ error: "Inbound email not found" });

        const updated = await storage.linkInboundEmail(p(req.params.id), companyId, contact_id);

        try {
          await storage.createActivityLog({
            companyId,
            contactId: contact_id,
            action: "email_inbound",
            details: {
              inboundEmailId: email.id,
              subject: email.subject || "",
              fromName: email.fromName || "",
              fromAddress: email.fromAddress,
              preview: (email.bodyText || "").slice(0, 200),
            },
          });
        } catch (logErr) {
          console.warn("[email-inbound] Activity log insert failed (non-fatal):", logErr);
        }

        res.json(updated);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/email/unmatched/:id/ignore",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const updated = await storage.ignoreInboundEmail(p(req.params.id), companyId);
        if (!updated) return res.status(404).json({ error: "Inbound email not found" });
        res.json(updated);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get("/api/email/inbound/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const email = await storage.getInboundEmailById(p(req.params.id), companyId);
      if (!email) return res.status(404).json({ error: "Inbound email not found" });
      res.json(email);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/email/send-test", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const company = await storage.getCompany(companyId);
      if (!company) return res.status(404).json({ error: "Company not found" });
      if (!company.inboundEmail) {
        return res.status(400).json({ error: "Inbound email address not provisioned" });
      }

      const result = await sendEmail({
        to: company.inboundEmail,
        subject: "ScooPilot Email Forwarding Test",
        text: `This is a test email sent to verify your email forwarding is working correctly. If you see this in your ScooPilot activity timeline after forwarding it, the setup is complete! Sent at: ${new Date().toISOString()}`,
        html: `<p>This is a test email sent to verify your email forwarding is working correctly.</p><p>If you see this in your ScooPilot activity timeline after forwarding it, the setup is complete!</p><p>Sent at: ${new Date().toISOString()}</p>`,
        senderName: "ScooPilot",
      });

      if (!result.success) {
        return res.status(500).json({ error: result.error || "Failed to send test email" });
      }

      res.json({ success: true, sentAt: new Date().toISOString() });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/email/test-status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const sinceMs = 60 * 1000;
      const since = new Date(Date.now() - sinceMs);

      const result = await storage.getUnmatchedEmails(companyId, 1, 50, true);
      const recent = result.data.find(
        (e) =>
          e.createdAt >= since &&
          (e.subject?.includes("ScooPilot Email Forwarding Test") ||
            e.subject?.includes("Test") ||
            (e.fromAddress || "").includes("scoopilot"))
      );

      res.json({ received: !!recent });
    } catch (err) {
      handleError(res, err);
    }
  });
}
