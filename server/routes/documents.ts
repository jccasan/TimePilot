import type { Express, Request, Response } from "express";
import multer from "multer";
import crypto from "crypto";
import { storage } from "../storage";
import { isAuthenticated, getCompanyContext, p } from "./shared";
import { ObjectStorageService } from "../replit_integrations/object_storage";
import { sendEmail } from "../services/email";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const objStorage = new ObjectStorageService();

export async function registerDocumentsRoutes(app: Express): Promise<void> {
  // ─── Template management ───────────────────────────────────────────────────

  app.get("/api/document-templates", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const templates = await storage.listDocumentTemplates(companyId);
      res.json(templates);
    } catch (err) {
      console.error("[documents] listTemplates error:", err);
      res.status(500).json({ error: "Failed to load document templates" });
    }
  });

  app.post(
    "/api/document-templates",
    isAuthenticated,
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const file = req.file;
        if (!file) return res.status(400).json({ error: "No file provided" });

        const name: string = (req.body.name as string) || file.originalname;
        const isRequired: boolean = req.body.isRequired !== "false";

        const uploadURL = await objStorage.getObjectEntityUploadURL();
        const objectPath = objStorage.normalizeObjectEntityPath(uploadURL);

        const putRes = await fetch(uploadURL, {
          method: "PUT",
          body: file.buffer,
          headers: { "Content-Type": file.mimetype },
        });
        if (!putRes.ok) {
          return res.status(500).json({ error: "Failed to upload template file to storage" });
        }

        const template = await storage.createDocumentTemplate({
          companyId,
          name,
          filePath: objectPath,
          fileSize: file.size,
          mimeType: file.mimetype,
          isActive: true,
          isRequired,
          displayOrder: 0,
        });

        res.status(201).json(template);
      } catch (err) {
        console.error("[documents] createTemplate error:", err);
        res.status(500).json({ error: "Failed to create document template" });
      }
    }
  );

  app.patch("/api/document-templates/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const id = p(req.params.id);
      const { name, isActive, isRequired, displayOrder } = req.body;

      const existing = await storage.getDocumentTemplate(id, companyId);
      if (!existing) return res.status(404).json({ error: "Template not found" });

      const updated = await storage.updateDocumentTemplate(id, companyId, {
        ...(name !== undefined && { name }),
        ...(isActive !== undefined && { isActive }),
        ...(isRequired !== undefined && { isRequired }),
        ...(displayOrder !== undefined && { displayOrder }),
      });
      res.json(updated);
    } catch (err) {
      console.error("[documents] updateTemplate error:", err);
      res.status(500).json({ error: "Failed to update template" });
    }
  });

  app.delete(
    "/api/document-templates/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const id = p(req.params.id);
        const existing = await storage.getDocumentTemplate(id, companyId);
        if (!existing) return res.status(404).json({ error: "Template not found" });
        await storage.deleteDocumentTemplate(id, companyId);
        res.json({ success: true });
      } catch (err) {
        console.error("[documents] deleteTemplate error:", err);
        res.status(500).json({ error: "Failed to delete template" });
      }
    }
  );

  // ─── Document requests ─────────────────────────────────────────────────────

  app.get(
    "/api/contacts/:contactId/document-requests",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const contactId = p(req.params.contactId);
        const requests = await storage.listDocumentRequests(companyId, contactId);

        const withSigs = await Promise.all(
          requests.map(async (r) => {
            const signatures = await storage.getDocumentSignatures(r.id);
            return { ...r, signatures };
          })
        );
        res.json(withSigs);
      } catch (err) {
        console.error("[documents] listRequests error:", err);
        res.status(500).json({ error: "Failed to load document requests" });
      }
    }
  );

  app.post(
    "/api/contacts/:contactId/document-requests",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const contactId = p(req.params.contactId);

        const contact = await storage.getContact(contactId, companyId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });

        const templates = await storage.listDocumentTemplates(companyId);
        const activeTemplates = templates.filter((t) => t.isActive);
        if (activeTemplates.length === 0) {
          return res.status(400).json({ error: "No active document templates found" });
        }

        // Reuse an existing pending request if one exists, otherwise create new.
        const existingRequests = await storage.listDocumentRequests(companyId, contactId);
        const pending = existingRequests.find((r) => r.status === "pending");

        let docRequest;
        let token: string;
        if (pending) {
          docRequest = pending;
          token = pending.token;
        } else {
          token = crypto.randomBytes(48).toString("hex");
          docRequest = await storage.createDocumentRequest({
            companyId,
            contactId,
            token,
            status: "pending",
            sentAt: new Date(),
          });
        }

        const company = await storage.getCompany(companyId);
        const baseUrl = process.env.APP_BASE_URL || `https://${req.hostname}`;
        const signUrl = `${baseUrl}/sign/${token}`;

        if (contact.email) {
          await sendEmail({
            companyId,
            contactId,
            to: contact.email as string,
            subject: `Please sign your documents from ${company?.name || "your service provider"}`,
            senderName: company?.name || undefined,
            replyTo: company?.email || undefined,
            text: `Hi ${contact.firstName || "there"},\n\nPlease review and sign the required documents at the link below:\n\n${signUrl}\n\nThis link is unique to you. Thank you!`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                  <h1 style="color: white; margin: 0;">${company?.name || "Document Signing"}</h1>
                </div>
                <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none;">
                  <p>Hi ${contact.firstName || "there"},</p>
                  <p>Please review and sign the required documents using the button below.</p>
                  <div style="text-align: center; margin: 28px 0;">
                    <a href="${signUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                      Review & Sign Documents
                    </a>
                  </div>
                  <p style="color: #6b7280; font-size: 14px;">This link is unique to you. If you have any questions, please reply to this email.</p>
                </div>
              </div>
            `,
          });
        }

        res.status(201).json({ ...docRequest, signUrl });
      } catch (err) {
        console.error("[documents] createRequest error:", err);
        res.status(500).json({ error: "Failed to send document request" });
      }
    }
  );

  app.delete(
    "/api/contacts/:contactId/document-requests/:requestId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const contactId = p(req.params.contactId);
        const requestId = p(req.params.requestId);
        const existing = await storage.getDocumentRequestById(requestId, companyId);
        if (!existing || existing.contactId !== contactId) {
          return res.status(404).json({ error: "Request not found" });
        }
        await storage.updateDocumentRequest(requestId, { status: "cancelled" });
        res.json({ success: true });
      } catch (err) {
        console.error("[documents] cancelRequest error:", err);
        res.status(500).json({ error: "Failed to cancel document request" });
      }
    }
  );

  // ─── Public signing endpoints (token-authenticated) ────────────────────────

  app.get("/api/public/sign/:token", async (req: Request, res: Response) => {
    try {
      const token = p(req.params.token);
      const docRequest = await storage.getDocumentRequestByToken(token);
      if (!docRequest) return res.status(404).json({ error: "Signing request not found" });

      const contact = await storage.getContact(docRequest.contactId, docRequest.companyId);
      const company = await storage.getCompany(docRequest.companyId);
      const templates = await storage.listDocumentTemplates(docRequest.companyId);
      const activeTemplates = templates.filter((t) => t.isActive);
      const signatures = await storage.getDocumentSignatures(docRequest.id);

      res.json({
        request: docRequest,
        contact: contact
          ? {
              firstName: contact.firstName,
              lastName: contact.lastName,
              email: contact.email,
            }
          : null,
        company: company ? { name: company.name, logoUrl: company.logoUrl } : null,
        templates: activeTemplates,
        signatures,
      });
    } catch (err) {
      console.error("[documents] public sign info error:", err);
      res.status(500).json({ error: "Failed to load signing request" });
    }
  });

  app.post(
    "/api/public/sign/:token",
    upload.single("signatureImage"),
    async (req: Request, res: Response) => {
      try {
        const token = p(req.params.token);
        const docRequest = await storage.getDocumentRequestByToken(token);
        if (!docRequest) return res.status(404).json({ error: "Signing request not found" });
        if (docRequest.status === "completed") {
          return res.status(400).json({ error: "Documents already signed" });
        }
        if (docRequest.status === "cancelled") {
          return res.status(400).json({ error: "Signing request has been cancelled" });
        }

        const { signerName, templateId } = req.body;
        if (!signerName || !templateId) {
          return res.status(400).json({ error: "signerName and templateId are required" });
        }

        const template = await storage.getDocumentTemplate(templateId, docRequest.companyId);
        if (!template) return res.status(404).json({ error: "Template not found" });

        let signatureImagePath: string | undefined;
        if (req.file) {
          const uploadURL = await objStorage.getObjectEntityUploadURL();
          signatureImagePath = objStorage.normalizeObjectEntityPath(uploadURL);
          const putRes = await fetch(uploadURL, {
            method: "PUT",
            body: req.file.buffer,
            headers: { "Content-Type": req.file.mimetype },
          });
          if (!putRes.ok) {
            return res.status(500).json({ error: "Failed to upload signature image" });
          }
        }

        const signerIp =
          (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
          req.socket.remoteAddress ||
          "";

        await storage.createDocumentSignature({
          requestId: docRequest.id,
          templateId,
          signerName,
          signerIp,
          signatureImagePath,
        });

        const templates = await storage.listDocumentTemplates(docRequest.companyId);
        const activeTemplates = templates.filter((t) => t.isActive && t.isRequired);
        const allSignatures = await storage.getDocumentSignatures(docRequest.id);
        const signedTemplateIds = new Set(allSignatures.map((s) => s.templateId));
        const allSigned = activeTemplates.every((t) => signedTemplateIds.has(t.id));

        if (allSigned) {
          await storage.updateDocumentRequest(docRequest.id, {
            status: "completed",
            completedAt: new Date(),
          });
        }

        res.json({ success: true, allSigned });
      } catch (err) {
        console.error("[documents] submit signature error:", err);
        res.status(500).json({ error: "Failed to submit signature" });
      }
    }
  );
}
