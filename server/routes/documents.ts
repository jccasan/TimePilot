import type { Express, Request, Response } from "express";
import multer from "multer";
import crypto from "crypto";
import { storage } from "../storage";
import { isAuthenticated, getCompanyContext, p } from "./shared";
import { ObjectStorageService } from "../replit_integrations/object_storage";
import { sendEmail } from "../services/email";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

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

  // ─── Resend / Revoke actions ───────────────────────────────────────────────

  app.post(
    "/api/document-requests/:id/resend",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const id = p(req.params.id);
        const docRequest = await storage.getDocumentRequestById(id, companyId);
        if (!docRequest) return res.status(404).json({ error: "Request not found" });
        if (docRequest.status !== "pending") {
          return res.status(400).json({ error: "Only pending requests can be resent" });
        }

        const contact = await storage.getContact(docRequest.contactId, companyId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });
        if (!contact.email) {
          return res.status(400).json({ error: "Contact has no email address" });
        }

        const company = await storage.getCompany(companyId);
        const baseUrl = process.env.APP_BASE_URL || `https://${req.hostname}`;
        const signUrl = `${baseUrl}/sign/${docRequest.token}`;

        await sendEmail({
          companyId,
          contactId: docRequest.contactId,
          to: contact.email as string,
          subject: `Please sign your documents from ${company?.name || "your service provider"}`,
          senderName: company?.name || undefined,
          replyTo: company?.email || undefined,
          text: `Hi ${contact.firstName || "there"},\n\nThis is a reminder to please review and sign the required documents at the link below:\n\n${signUrl}\n\nThis link is unique to you. Thank you!`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">${company?.name || "Document Signing"}</h1>
              </div>
              <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none;">
                <p>Hi ${contact.firstName || "there"},</p>
                <p>This is a reminder to please review and sign the required documents using the button below.</p>
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

        res.json({ success: true });
      } catch (err) {
        console.error("[documents] resend error:", err);
        res.status(500).json({ error: "Failed to resend signing request" });
      }
    }
  );

  app.patch(
    "/api/document-requests/:id/revoke",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const id = p(req.params.id);
        const docRequest = await storage.getDocumentRequestById(id, companyId);
        if (!docRequest) return res.status(404).json({ error: "Request not found" });
        if (docRequest.status !== "pending") {
          return res.status(400).json({ error: "Only pending requests can be revoked" });
        }
        const updated = await storage.updateDocumentRequest(id, { status: "cancelled" });
        res.json(updated);
      } catch (err) {
        console.error("[documents] revoke error:", err);
        res.status(500).json({ error: "Failed to revoke signing request" });
      }
    }
  );

  // ─── Staff certificate download (session-authenticated) ────────────────────

  app.get(
    "/api/document-requests/:id/certificate",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const id = p(req.params.id);
        const docRequest = await storage.getDocumentRequestById(id, companyId);
        if (!docRequest) return res.status(404).json({ error: "Request not found" });
        if (docRequest.status !== "completed" || !docRequest.certificateUrl) {
          return res.status(404).json({ error: "Certificate not available" });
        }
        const objectFile = await objStorage.getObjectEntityFile(docRequest.certificateUrl);
        res.setHeader("Content-Disposition", 'inline; filename="signed-document-certificate.pdf"');
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Cache-Control", "private, max-age=0");
        await objStorage.downloadObject(objectFile, res, 0);
      } catch (err) {
        console.error("[documents] staff certificate download error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to download certificate" });
        }
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
        const allActiveTemplates = templates.filter((t) => t.isActive);
        const requiredTemplates = allActiveTemplates.filter((t) => t.isRequired);
        const allSignatures = await storage.getDocumentSignatures(docRequest.id);
        const signedTemplateIds = new Set(allSignatures.map((s) => s.templateId));
        const allSigned = requiredTemplates.every((t) => signedTemplateIds.has(t.id));

        if (allSigned) {
          const company = await storage.getCompany(docRequest.companyId);
          const businessName = company?.name || "Your Service Provider";

          const certificateUrl = await generateSignedCertificate({
            objStorage,
            docRequest,
            allSignatures,
            templates: allActiveTemplates,
            signatureImageBuffer: req.file?.buffer,
            signerName,
            signerIp,
            businessName,
          });

          await storage.updateDocumentRequest(docRequest.id, {
            status: "completed",
            completedAt: new Date(),
            certificateUrl,
          });
        }

        res.json({ success: true, allSigned });
      } catch (err) {
        console.error("[documents] submit signature error:", err);
        res.status(500).json({ error: "Failed to submit signature" });
      }
    }
  );

  // ─── Token-gated certificate download ──────────────────────────────────────

  app.get("/api/public/sign/:token/certificate", async (req: Request, res: Response) => {
    try {
      const token = p(req.params.token);
      const docRequest = await storage.getDocumentRequestByToken(token);
      if (!docRequest) return res.status(404).json({ error: "Signing request not found" });
      if (!docRequest.certificateUrl) {
        return res.status(404).json({ error: "Certificate not yet available" });
      }

      const objectFile = await objStorage.getObjectEntityFile(docRequest.certificateUrl);
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="signed-document-certificate.pdf"'
      );
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "private, max-age=0");
      await objStorage.downloadObject(objectFile, res, 0);
    } catch (err) {
      console.error("[documents] certificate download error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to download certificate" });
      }
    }
  });
}

// ─── PDF Certificate Generation ────────────────────────────────────────────

interface CertificateOptions {
  objStorage: ObjectStorageService;
  docRequest: { id: string; companyId: string; contactId: string };
  allSignatures: Array<{
    signerName: string;
    signerIp: string | null;
    signedAt: Date;
    signatureImagePath?: string | null;
  }>;
  templates: Array<{ name: string }>;
  signatureImageBuffer?: Buffer;
  signerName: string;
  signerIp: string;
  businessName: string;
}

async function generateSignedCertificate(opts: CertificateOptions): Promise<string> {
  const {
    objStorage,
    allSignatures,
    templates,
    signatureImageBuffer,
    signerName,
    signerIp,
    businessName,
  } = opts;

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const { width, height } = page.getSize();

  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const green = rgb(0.176, 0.541, 0.369);
  const darkGray = rgb(0.2, 0.2, 0.2);
  const midGray = rgb(0.45, 0.45, 0.45);
  const lightGray = rgb(0.85, 0.85, 0.85);

  const margin = 48;
  let y = height - margin;

  page.drawRectangle({
    x: 0,
    y: height - 80,
    width,
    height: 80,
    color: green,
  });

  page.drawText("Electronic Signature Certificate", {
    x: margin,
    y: height - 52,
    size: 22,
    font: boldFont,
    color: rgb(1, 1, 1),
  });

  page.drawText(
    "This document certifies that the agreement was reviewed and signed electronically.",
    {
      x: margin,
      y: height - 72,
      size: 9,
      font: regularFont,
      color: rgb(0.9, 0.9, 0.9),
    }
  );

  y = height - 110;

  const drawSectionHeader = (label: string) => {
    page.drawRectangle({
      x: margin,
      y: y - 2,
      width: width - margin * 2,
      height: 20,
      color: rgb(0.95, 0.97, 0.95),
    });
    page.drawText(label, { x: margin + 6, y: y + 2, size: 10, font: boldFont, color: green });
    y -= 28;
  };

  const drawRow = (label: string, value: string) => {
    page.drawText(label, { x: margin + 6, y, size: 9, font: boldFont, color: midGray });
    page.drawText(value, { x: margin + 140, y, size: 9, font: regularFont, color: darkGray });
    y -= 16;
  };

  const signedAt = allSignatures[0]?.signedAt ?? new Date();
  const timestamp = signedAt.toUTCString();

  drawSectionHeader("Signer Information");
  drawRow("Business", businessName);
  drawRow("Full Name", signerName);
  drawRow("IP Address", signerIp || "Unknown");
  drawRow("Timestamp (UTC)", timestamp);
  y -= 8;

  drawSectionHeader("Documents Signed");
  for (const tpl of templates) {
    page.drawText(`  \u2022  ${tpl.name}`, {
      x: margin + 6,
      y,
      size: 9,
      font: regularFont,
      color: darkGray,
    });
    y -= 15;
  }
  y -= 8;

  if (signatureImageBuffer) {
    const sigImage = await pdfDoc.embedPng(signatureImageBuffer);
    const sigDims = sigImage.scaleToFit(200, 80);

    drawSectionHeader("Drawn Signature");
    page.drawRectangle({
      x: margin + 6,
      y: y - sigDims.height - 4,
      width: sigDims.width + 8,
      height: sigDims.height + 8,
      borderColor: lightGray,
      borderWidth: 1,
    });
    page.drawImage(sigImage, {
      x: margin + 10,
      y: y - sigDims.height,
      width: sigDims.width,
      height: sigDims.height,
    });
    y -= sigDims.height + 20;
  }

  y -= 8;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.5,
    color: lightGray,
  });
  y -= 14;
  page.drawText(
    "This certificate was generated automatically by Scoopilot upon completion of the electronic signature workflow.",
    { x: margin, y, size: 7.5, font: regularFont, color: midGray }
  );
  y -= 12;
  page.drawText(`Certificate generated: ${new Date().toUTCString()}`, {
    x: margin,
    y,
    size: 7.5,
    font: regularFont,
    color: midGray,
  });

  const pdfBytes = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);

  const uploadURL = await objStorage.getObjectEntityUploadURL();
  const objectPath = objStorage.normalizeObjectEntityPath(uploadURL);
  const putRes = await fetch(uploadURL, {
    method: "PUT",
    body: pdfBuffer,
    headers: { "Content-Type": "application/pdf" },
  });
  if (!putRes.ok) {
    throw new Error("Failed to upload certificate PDF to storage");
  }

  return objectPath;
}
