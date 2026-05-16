import type { Express, Request, Response, NextFunction } from "express";
import { maskEmail, maskPhone } from "../utils/pii";
import multer from "multer";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { messages as messagesTable, type Message } from "@shared/schema";
import { sendEmail, generateEmailThreadId } from "../services/email";
import { sendInvoiceEmail } from "../services/invoice-email";
import { sendSmsForCompany, getFromPhoneForCompany, getCompanySmsConfig } from "../services/sms";
import { reportRetellMinutes } from "../services/stripe";

import { isAuthenticated, getCompanyContext, getBaseUrl, handleError, p, notify } from "./shared";

export async function registerMessagesRoutes(app: Express): Promise<void> {
  // ================ Messages / Communications ================

  app.get("/api/messages", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const filters: {
        contactId?: string;
        channel?: string;
        direction?: string;
        isRead?: boolean;
        phone?: string;
        emailThreadId?: string;
      } = {};
      if (req.query.contactId) filters.contactId = req.query.contactId as string;
      if (req.query.channel) filters.channel = req.query.channel as string;
      if (req.query.direction) filters.direction = req.query.direction as string;
      if (req.query.unread === "true") filters.isRead = false;
      if (req.query.phone) filters.phone = req.query.phone as string;
      if (req.query.emailThreadId) filters.emailThreadId = req.query.emailThreadId as string;
      const msgs = await storage.getMessages(companyId, filters);

      const contactCache = new Map<string, string>();
      const enriched = await Promise.all(
        msgs.map(async (m) => {
          let contactName = "";
          if (m.contactId) {
            if (contactCache.has(m.contactId)) {
              contactName = contactCache.get(m.contactId)!;
            } else {
              const contact = await storage.getContactById(m.contactId);
              contactName = contact ? `${contact.firstName} ${contact.lastName}` : "";
              contactCache.set(m.contactId, contactName);
            }
          }
          return { ...m, contactName };
        })
      );
      res.json(enriched);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/messages/:id/read", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const msg = await storage.markMessageRead(p(req.params.id), companyId);
      if (!msg) return res.status(404).json({ error: "Message not found" });
      res.json(msg);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch(
    "/api/messages/read-by-contact/:contactId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        await storage.markMessagesReadByContact(p(req.params.contactId), companyId);
        res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.patch("/api/messages/read-by-phone", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ error: "phone is required" });
      await storage.markMessagesReadByPhone(phone, companyId);
      res.json({ success: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(
    "/api/messages/unread-sms-count",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const count = await storage.getUnreadSmsCount(companyId);
        res.json({ count });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get("/api/messages/conversations", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const channelFilter = req.query.channel as string | undefined;
      const contacts = await storage.getContacts(companyId);
      const contactMap = new Map(contacts.map((c) => [c.id, c]));
      const company = await storage.getCompany(companyId);
      const retentionDays = company?.messageRetentionDays ?? 30;

      type ConvThread = {
        contactId: string;
        contactName: string;
        phone: string;
        email: string;
        lastMessage: Message;
        unreadCount: number;
        messageCount: number;
        channel: string;
        emailThreadId: string;
        subject: string;
      };

      const threadMap = new Map<string, ConvThread>();

      if (!channelFilter || channelFilter === "sms") {
        const allSms = await storage.getMessages(companyId, { channel: "sms", retentionDays });
        for (const msg of allSms) {
          const key = `sms:${msg.contactId || `unknown:${msg.direction === "inbound" ? msg.fromAddress : msg.toAddress}`}`;
          const existing = threadMap.get(key);
          const contact = msg.contactId ? contactMap.get(msg.contactId) : null;
          const phone = msg.direction === "inbound" ? msg.fromAddress : msg.toAddress;
          const contactName = contact ? `${contact.firstName} ${contact.lastName}`.trim() : phone;

          if (!existing) {
            threadMap.set(key, {
              contactId: msg.contactId || "",
              contactName,
              phone,
              email: "",
              lastMessage: msg,
              unreadCount: msg.direction === "inbound" && !msg.isRead ? 1 : 0,
              messageCount: 1,
              channel: "sms",
              emailThreadId: "",
              subject: "",
            });
          } else {
            existing.messageCount++;
            if (msg.direction === "inbound" && !msg.isRead) existing.unreadCount++;
            if (new Date(msg.createdAt) > new Date(existing.lastMessage.createdAt)) {
              existing.lastMessage = msg;
            }
          }
        }
      }

      if (!channelFilter || channelFilter === "email") {
        const allEmail = await storage.getMessages(companyId, { channel: "email", retentionDays });
        for (const msg of allEmail) {
          const canonicalThreadId = msg.emailThreadId || msg.id;
          const key = `email:${canonicalThreadId}`;
          const existing = threadMap.get(key);
          const contact = msg.contactId ? contactMap.get(msg.contactId) : null;
          const emailAddr = msg.direction === "inbound" ? msg.fromAddress : msg.toAddress;
          const contactName = contact
            ? `${contact.firstName} ${contact.lastName}`.trim()
            : emailAddr;

          if (!existing) {
            threadMap.set(key, {
              contactId: msg.contactId || "",
              contactName,
              phone: "",
              email: emailAddr,
              lastMessage: msg,
              unreadCount: msg.direction === "inbound" && !msg.isRead ? 1 : 0,
              messageCount: 1,
              channel: "email",
              emailThreadId: canonicalThreadId,
              subject: msg.subject || "",
            });
          } else {
            existing.messageCount++;
            if (msg.direction === "inbound" && !msg.isRead) existing.unreadCount++;
            if (new Date(msg.createdAt) > new Date(existing.lastMessage.createdAt)) {
              existing.lastMessage = msg;
              if (msg.subject) existing.subject = msg.subject;
            }
          }
        }
      }

      const conversations = Array.from(threadMap.values()).sort(
        (a, b) =>
          new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime()
      );
      res.json(conversations);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get(
    "/api/messages/unread-email-count",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        const count = await storage.getUnreadEmailCount(companyId);
        res.json({ count });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.patch(
    "/api/messages/read-by-email-thread/:threadId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId } = await getCompanyContext(req);
        await storage.markMessagesReadByEmail(p(req.params.threadId), companyId);
        res.json({ success: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post("/api/messages/email", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const {
        contactId,
        to,
        subject,
        body,
        htmlBody,
        emailThreadId: existingThreadId,
        attachments,
      } = req.body;
      if (!to || !subject || !body) {
        return res.status(400).json({ error: "to, subject, and body are required" });
      }

      if (contactId) {
        const contact = await storage.getContact(contactId, companyId);
        if (!contact) return res.status(400).json({ error: "Contact not found in your company" });
      }

      const company = await storage.getCompany(companyId);
      const fromAddress = company?.email || "jeremy@scoopilot.com";

      let emailThreadId = generateEmailThreadId();
      if (existingThreadId) {
        const existingThread = await storage.getMessagesByEmailThreadId(
          existingThreadId,
          companyId
        );
        if (existingThread.length > 0) {
          emailThreadId = existingThreadId;
        } else {
          const [legacyMsg] = await db
            .select()
            .from(messagesTable)
            .where(
              and(
                eq(messagesTable.id, existingThreadId),
                eq(messagesTable.companyId, companyId),
                eq(messagesTable.channel, "email")
              )
            )
            .limit(1);
          if (legacyMsg && !legacyMsg.emailThreadId) {
            await db
              .update(messagesTable)
              .set({ emailThreadId })
              .where(
                and(eq(messagesTable.id, existingThreadId), eq(messagesTable.companyId, companyId))
              );
          }
        }
      }

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
        emailThreadId,
      });

      const safeAttachments =
        Array.isArray(attachments) && attachments.length > 0
          ? attachments.filter(
              (a: unknown) =>
                a &&
                typeof a === "object" &&
                typeof (a as Record<string, unknown>).content === "string" &&
                typeof (a as Record<string, unknown>).filename === "string" &&
                typeof (a as Record<string, unknown>).type === "string"
            )
          : undefined;

      const result = await sendEmail({
        companyId: companyId,
        contactId: contactId || undefined,
        to,
        from: fromAddress,
        subject,
        text: body,
        html: htmlBody || body,
        senderName: company?.name || undefined,
        emailThreadId,
        attachments: safeAttachments,
      });

      if (result.success) {
        const updated = await storage.updateMessageStatus(msg.id, "sent");
        res.json(updated);
      } else {
        const updated = await storage.updateMessageStatus(msg.id, "failed", result.error);
        res.status(500).json({ error: result.error, message: updated });
      }
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/messages/sms", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const { contactId, to, body, mediaUrl } = req.body;
      if (!to || !body) {
        return res.status(400).json({ error: "to and body are required" });
      }

      if (contactId) {
        const contact = await storage.getContact(contactId, companyId);
        if (!contact) return res.status(400).json({ error: "Contact not found in your company" });
      }

      const fromPhone = await getFromPhoneForCompany(companyId);

      const mediaUrls = mediaUrl ? [mediaUrl] : [];
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
        mediaUrls,
        mediaCount: mediaUrls.length,
      });

      const result = await sendSmsForCompany({
        to,
        body,
        companyId,
        contactId: contactId || undefined,
        mediaUrl,
      });

      if (result.success) {
        const updated = await storage.updateMessageStatus(msg.id, "sent");
        res.json(updated);
      } else {
        const updated = await storage.updateMessageStatus(msg.id, "failed", result.error);
        res.status(500).json({ error: result.error, message: updated });
      }
    } catch (err) {
      handleError(res, err);
    }
  });

  const ALLOWED_MMS_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  const MMS_MAX_PER_FILE = parseInt(process.env.MMS_MAX_FILE_BYTES || String(5 * 1024 * 1024), 10);
  const MMS_MAX_TOTAL = parseInt(process.env.MMS_MAX_TOTAL_BYTES || String(10 * 1024 * 1024), 10);
  const MMS_MAX_ATTACHMENTS = parseInt(process.env.MMS_MAX_ATTACHMENTS || "5", 10);

  const mmsUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MMS_MAX_PER_FILE, files: MMS_MAX_ATTACHMENTS },
  });

  app.post(
    "/api/messages/mms",
    isAuthenticated,
    (req: Request, res: Response, next: NextFunction) => {
      mmsUpload.array("media", MMS_MAX_ATTACHMENTS)(req, res, (err: unknown) => {
        if (err) {
          const uploadErr = err as { code?: string; message?: string };
          if (uploadErr.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({
              error: `File too large. Maximum per file: ${Math.round(MMS_MAX_PER_FILE / 1024 / 1024)}MB`,
            });
          }
          if (uploadErr.code === "LIMIT_FILE_COUNT") {
            return res
              .status(400)
              .json({ error: `Too many files. Maximum: ${MMS_MAX_ATTACHMENTS}` });
          }
          if (uploadErr.code === "LIMIT_UNEXPECTED_FILE") {
            return res.status(400).json({ error: "Unexpected file field" });
          }
          return res.status(400).json({ error: uploadErr.message || "File upload error" });
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      try {
        const { companyId, userId } = await getCompanyContext(req);
        const { contactId, to, body, originalSizes } = req.body;
        if (!to) return res.status(400).json({ error: "to is required" });

        const files = req.files as Express.Multer.File[] | undefined;
        if (!files || files.length === 0)
          return res.status(400).json({ error: "At least one media file is required" });

        let totalBytes = 0;
        for (const file of files) {
          if (!ALLOWED_MMS_TYPES.includes(file.mimetype)) {
            return res
              .status(400)
              .json({ error: `Unsupported file type: ${file.mimetype}. Allowed: JPG, PNG, WebP` });
          }
          totalBytes += file.size;
        }
        if (totalBytes > MMS_MAX_TOTAL) {
          return res.status(400).json({
            error: `Total payload too large (${Math.round(totalBytes / 1024)}KB). Maximum: ${Math.round(MMS_MAX_TOTAL / 1024 / 1024)}MB`,
          });
        }

        if (contactId) {
          const contact = await storage.getContact(contactId, companyId);
          if (!contact) return res.status(400).json({ error: "Contact not found in your company" });
        }

        const { ObjectStorageService } =
          await import("../replit_integrations/object_storage/objectStorage");
        const objStorage = new ObjectStorageService();
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = req.headers.host || "localhost:5000";

        const storedPaths: string[] = [];
        const publicUrls: string[] = [];
        const parsedOriginals: number[] = (() => {
          try {
            return originalSizes ? JSON.parse(originalSizes) : [];
          } catch {
            return [];
          }
        })();

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const uploadURL = await objStorage.getObjectEntityUploadURL();
          const objectPath = objStorage.normalizeObjectEntityPath(uploadURL);
          const putResponse = await fetch(uploadURL, {
            method: "PUT",
            body: file.buffer,
            headers: { "Content-Type": file.mimetype },
          });
          if (!putResponse.ok) {
            return res
              .status(500)
              .json({ error: `Failed to upload media file ${i + 1} to storage` });
          }
          storedPaths.push(objectPath);
          publicUrls.push(`${protocol}://${host}${objectPath}`);
        }

        const fromPhone = await getFromPhoneForCompany(companyId);
        const messageBody = body || "";

        const msg = await storage.createMessage({
          companyId,
          contactId: contactId || null,
          channel: "sms",
          direction: "outbound",
          status: "queued",
          fromAddress: fromPhone,
          toAddress: to,
          body: messageBody,
          sentBy: userId,
          mediaUrls: storedPaths,
          mediaCount: storedPaths.length,
        });

        for (let i = 0; i < files.length; i++) {
          try {
            const origSize =
              parsedOriginals[i] && parsedOriginals[i] > 0 ? parsedOriginals[i] : files[i].size;
            await storage.createMessageAttachment({
              messageId: msg.id,
              companyId,
              mimeType: files[i].mimetype,
              originalFilename: files[i].originalname,
              originalSizeBytes: origSize,
              compressedSizeBytes: files[i].size,
              storageUrl: storedPaths[i],
            });
          } catch (attachErr) {
            console.error(`[MMS] Failed to create attachment record ${i}:`, attachErr);
          }
        }

        const result = await sendSmsForCompany({
          to,
          body: messageBody,
          companyId,
          contactId: contactId || undefined,
          mediaUrls: publicUrls,
        });

        if (result.success) {
          const updated = await storage.updateMessageStatus(msg.id, "sent");
          res.json(updated);
        } else {
          const updated = await storage.updateMessageStatus(msg.id, "failed", result.error);
          res.status(500).json({ error: result.error, message: updated });
        }
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get("/api/messages/config", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const smsConfig = await getCompanySmsConfig(companyId);
      const { getSharedSmsNumber, isSharedNumber: isShared } = await import("../services/sms");
      const sharedNumber = getSharedSmsNumber();
      res.json({
        email: { configured: !!process.env.SENDGRID_API_KEY },
        sms: {
          configured: smsConfig.configured,
          phoneNumber: smsConfig.phoneNumber,
          provider: smsConfig.provider,
          isSharedNumber: !!sharedNumber && isShared(smsConfig.phoneNumber),
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ─── Message Exception Queue (tenant-scoped via candidateCompanyIds) ─
  app.get("/api/message-exceptions", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      if (role !== "owner" && role !== "admin")
        return res.status(403).json({ error: "Owner or admin access required" });
      const resolved =
        req.query.resolved === "true" ? true : req.query.resolved === "false" ? false : undefined;
      const exceptions = await storage.getMessageExceptions({ resolved, companyId });
      res.json(exceptions);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post(
    "/api/message-exceptions/:id/resolve",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, userId, role } = await getCompanyContext(req);
        if (role !== "owner" && role !== "admin")
          return res.status(403).json({ error: "Owner or admin access required" });

        const targetCompanyId = req.body.companyId || companyId;
        if (targetCompanyId !== companyId) {
          return res.status(403).json({ error: "Cannot resolve exceptions for another company" });
        }

        const exception = await storage.resolveMessageException(
          p(req.params.id),
          userId,
          targetCompanyId
        );
        if (!exception)
          return res.status(404).json({
            error: "Exception not found, already resolved, or not assigned to your company",
          });

        if (exception.body && exception.fromAddress) {
          try {
            const allContacts = await storage.getContacts(targetCompanyId);
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
              companyId: targetCompanyId,
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
                  companyId: targetCompanyId,
                  contactId: matchedContact.id,
                  channel: "sms",
                  lastUsedAt: new Date(),
                });
              }
            }
          } catch (msgErr) {
            console.error(
              `[MessageException] Resolved exception ${p(req.params.id)} but message delivery failed:`,
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
    "/api/message-exceptions/:id/dismiss",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { companyId, userId, role } = await getCompanyContext(req);
        if (role !== "owner" && role !== "admin")
          return res.status(403).json({ error: "Owner or admin access required" });
        const exception = await storage.dismissMessageException(
          p(req.params.id),
          userId,
          companyId
        );
        if (!exception)
          return res.status(404).json({
            error: "Exception not found, already resolved, or not assigned to your company",
          });
        res.json(exception);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  // Twilio incoming SMS webhook
  app.post("/api/webhooks/twilio/sms", async (req: Request, res: Response) => {
    try {
      const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
      if (twilioAuthToken) {
        const signature = req.headers["x-twilio-signature"] as string | undefined;
        if (!signature) {
          console.warn("[Twilio SMS Webhook] Missing x-twilio-signature header");
          return res.type("text/xml").send("<Response></Response>");
        }
        const cryptoMod = await import("crypto");
        const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
        const params = req.body as Record<string, string>;
        const sortedKeys = Object.keys(params).sort();
        const paramStr = sortedKeys.map((k) => `${k}${params[k]}`).join("");
        const expected = cryptoMod
          .createHmac("sha1", twilioAuthToken)
          .update(url + paramStr)
          .digest("base64");
        const sigBuf = Buffer.from(signature);
        const expectedBuf = Buffer.from(expected);
        if (
          sigBuf.length !== expectedBuf.length ||
          !cryptoMod.timingSafeEqual(sigBuf, expectedBuf)
        ) {
          console.warn("[Twilio SMS Webhook] Signature mismatch");
          return res.type("text/xml").send("<Response></Response>");
        }
      } else {
        if (process.env.NODE_ENV === "production") {
          console.error(
            "[Twilio SMS Webhook] TWILIO_AUTH_TOKEN not set in production — rejecting request"
          );
          return res.type("text/xml").send("<Response></Response>");
        }
        console.warn(
          "[Twilio SMS Webhook] TWILIO_AUTH_TOKEN not set — skipping signature verification (dev only)"
        );
      }

      const { From, Body, MessageSid } = req.body;
      if (!From || !Body) {
        return res.status(400).send("<Response></Response>");
      }

      const allCompanies = await storage.listCompanies();
      if (allCompanies.length > 0) {
        const companyId = allCompanies[0].id;
        const allContacts = await storage.getContacts(companyId);
        const digits = From.replace(/\D/g, "");
        const matchedContact = allContacts.find((c) => {
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
          toAddress: await getFromPhoneForCompany(companyId),
          body: Body,
          externalId: MessageSid,
        });

        if (matchedContact) {
          notify(
            companyId,
            "new_message",
            "New Text Message",
            `${matchedContact.firstName} ${matchedContact.lastName} sent a text message.`,
            `/communications?contactId=${matchedContact.id}`
          );
        }
      }

      res.type("text/xml").send("<Response></Response>");
    } catch (err) {
      console.error("Twilio webhook error:", err);
      res.type("text/xml").send("<Response></Response>");
    }
  });

  app.post("/api/webhooks/telnyx/sms", async (req: Request, res: Response) => {
    try {
      const telnyxPublicKey = process.env.TELNYX_PUBLIC_KEY;
      if (telnyxPublicKey) {
        const signature = req.headers["telnyx-signature-ed25519"] as string | undefined;
        const timestamp = req.headers["telnyx-timestamp"] as string | undefined;
        if (!signature || !timestamp) {
          console.warn("[Telnyx SMS] Missing telnyx-signature-ed25519 or telnyx-timestamp header");
          return res.status(401).json({ error: "Missing webhook signature headers" });
        }
        const cryptoMod = await import("crypto");
        const rawBodyStr =
          req.rawBody instanceof Buffer
            ? req.rawBody.toString("utf8")
            : String(req.rawBody ?? JSON.stringify(req.body));
        const signingPayload = Buffer.from(`${timestamp}|${rawBodyStr}`);
        const sigBuf = Buffer.from(signature, "base64");
        // Telnyx provides a raw 32-byte Ed25519 public key (base64-encoded).
        // Wrap it in the standard SPKI DER envelope so Node's crypto can consume it.
        const rawKeyBuf = Buffer.from(telnyxPublicKey, "base64");
        const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
        const spkiDer = Buffer.concat([spkiPrefix, rawKeyBuf]);
        let valid = false;
        try {
          const keyObj = cryptoMod.createPublicKey({ key: spkiDer, format: "der", type: "spki" });
          valid = cryptoMod.verify(null, signingPayload, keyObj, sigBuf);
        } catch {
          console.warn("[Telnyx SMS] Ed25519 key parse or verify error");
        }
        if (!valid) {
          console.warn("[Telnyx SMS] Signature mismatch");
          return res.status(401).json({ error: "Invalid webhook signature" });
        }
      } else {
        if (process.env.NODE_ENV === "production") {
          console.error("[Telnyx SMS] TELNYX_PUBLIC_KEY not set in production — rejecting request");
          return res.status(401).json({ error: "Webhook verification not configured" });
        }
        console.warn(
          "[Telnyx SMS] TELNYX_PUBLIC_KEY not set — skipping signature verification (dev only)"
        );
      }

      const eventType = req.body?.data?.event_type;
      console.log(`[Telnyx SMS] Webhook received, event_type: ${eventType}`);

      if (eventType !== "message.received") {
        console.log(`[Telnyx SMS] Ignoring event type: ${eventType}`);
        return res.status(200).json({ ok: true });
      }

      const payload = req.body?.data?.payload;
      if (!payload) {
        console.log("[Telnyx SMS] No payload found in request body");
        return res.status(200).json({ ok: true });
      }

      console.log(
        `[Telnyx SMS] Payload shape: id=${payload.id}, from=${JSON.stringify(payload.from)}, to=${JSON.stringify(payload.to)}, text length=${payload.text?.length ?? 0}`
      );

      const fromNumber = payload.from?.phone_number;
      const textBody = payload.text;
      const messageId = payload.id;

      let toNumber = "";
      if (Array.isArray(payload.to)) {
        toNumber = payload.to[0]?.phone_number || "";
      } else if (payload.to && typeof payload.to === "object") {
        toNumber = payload.to.phone_number || "";
      } else if (typeof payload.to === "string") {
        toNumber = payload.to;
      }

      console.log(
        `[Telnyx SMS] Parsed: from=${maskPhone(fromNumber)}, to=${maskPhone(toNumber)}, messageId=${messageId}`
      );

      type TelnyxMedia = { url?: string; content_type?: string; size?: number };
      const rawMedia: TelnyxMedia[] = Array.isArray(payload.media) ? payload.media : [];
      const inboundMedia = rawMedia.filter(
        (m): m is TelnyxMedia & { url: string } =>
          typeof m.url === "string" && m.url.startsWith("https://")
      );

      if (!fromNumber || (!textBody && inboundMedia.length === 0)) {
        console.log(
          `[Telnyx SMS] Missing required fields: fromNumber=${maskPhone(fromNumber)}, textBody=${textBody ? "present" : "missing"}, media=${inboundMedia.length}`
        );
        return res.status(200).json({ ok: true });
      }

      const toDigits = toNumber.replace(/\D/g, "");
      const { isSharedNumber } = await import("../services/sms");

      const allCompanies = await storage.listCompanies();
      let matchedCompany: (typeof allCompanies)[number] | undefined;

      // Step 1: Try dedicated number match
      matchedCompany = allCompanies.find((c) => {
        const cDigits = (c.telnyxPhoneNumber || "").replace(/\D/g, "");
        return (
          cDigits.length >= 10 && toDigits.length >= 10 && toDigits.endsWith(cDigits.slice(-10))
        );
      });
      if (!matchedCompany) {
        matchedCompany = allCompanies.find((c) => {
          const cDigits = (c.dedicatedPhoneNumber || "").replace(/\D/g, "");
          return (
            cDigits.length >= 10 && toDigits.length >= 10 && toDigits.endsWith(cDigits.slice(-10))
          );
        });
      }

      // Step 2: If no dedicated match, check if this is a shared number
      if (!matchedCompany && isSharedNumber(toNumber)) {
        console.log(
          `[Telnyx SMS] Shared number detected, looking up routing table for from=${fromNumber}`
        );
        const routingEntries = await storage.findMessageRouting(toNumber, fromNumber);

        if (routingEntries.length === 1) {
          matchedCompany = allCompanies.find((c) => c.id === routingEntries[0].companyId);
          if (matchedCompany) {
            console.log(
              `[Telnyx SMS] Shared number routed to company: ${matchedCompany.name} (via routing table)`
            );
          }
        } else if (routingEntries.length > 1) {
          console.warn(
            `[Telnyx SMS] Ambiguous routing: ${routingEntries.length} companies for from=${maskPhone(fromNumber)} on shared number. Sending to exception queue.`
          );
          await storage.createMessageException({
            providerMessageId: messageId,
            fromAddress: fromNumber,
            toAddress: toNumber,
            body: textBody,
            rawPayload: payload as Record<string, unknown>,
            reason: `Ambiguous routing: ${routingEntries.length} tenants matched for sender ${fromNumber}`,
            candidateCompanyIds: routingEntries.map((r) => r.companyId),
          });
          return res.status(200).json({ ok: true });
        } else {
          // No routing entry - try contact phone match across all companies
          const fromDigits = fromNumber.replace(/\D/g, "");
          const matchingCompanies: typeof allCompanies = [];
          for (const company of allCompanies) {
            const contacts = await storage.getContacts(company.id);
            const hasMatch = contacts.some((c) => {
              const cDigits = (c.phone || "").replace(/\D/g, "");
              return (
                cDigits.length >= 10 &&
                fromDigits.length >= 10 &&
                fromDigits.endsWith(cDigits.slice(-10))
              );
            });
            if (hasMatch) matchingCompanies.push(company);
          }

          if (matchingCompanies.length === 1) {
            matchedCompany = matchingCompanies[0];
            console.log(
              `[Telnyx SMS] Shared number routed to company: ${matchedCompany.name} (via contact phone match)`
            );
          } else if (matchingCompanies.length > 1) {
            console.warn(
              `[Telnyx SMS] Ambiguous contact match: ${matchingCompanies.length} companies have a contact with phone ${fromNumber}. Sending to exception queue.`
            );
            await storage.createMessageException({
              providerMessageId: messageId,
              fromAddress: fromNumber,
              toAddress: toNumber,
              body: textBody,
              rawPayload: payload as Record<string, unknown>,
              reason: `Ambiguous contact match: ${matchingCompanies.length} tenants have a contact with phone ${fromNumber}`,
              candidateCompanyIds: matchingCompanies.map((c) => c.id),
            });
            return res.status(200).json({ ok: true });
          } else {
            console.warn(
              `[Telnyx SMS] No routing or contact match for from=${fromNumber} on shared number. Sending to exception queue.`
            );
            await storage.createMessageException({
              providerMessageId: messageId,
              fromAddress: fromNumber,
              toAddress: toNumber,
              body: textBody,
              rawPayload: payload as Record<string, unknown>,
              reason: `No tenant match found for sender ${fromNumber} on shared number`,
              candidateCompanyIds: [],
            });
            return res.status(200).json({ ok: true });
          }
        }
      }

      if (!matchedCompany) {
        const checkedNumbers = allCompanies
          .map(
            (c) =>
              `${c.name}: telnyx=${c.telnyxPhoneNumber || "none"}, dedicated=${c.dedicatedPhoneNumber || "none"}`
          )
          .join("; ");
        console.warn(
          `[Telnyx SMS] WARNING: No company matched for to number: ${maskPhone(toNumber)}. Checked: ${checkedNumbers}`
        );
        return res.status(200).json({ ok: true });
      }

      console.log(
        `[Telnyx SMS] Matched company: ${matchedCompany.name} (id: ${matchedCompany.id})`
      );

      const companyId = matchedCompany.id;

      if (messageId) {
        const existing = await storage.getMessages(companyId, { phone: fromNumber });
        if (existing.some((m) => m.externalId === messageId)) {
          console.log(`[Telnyx SMS] Duplicate message ${messageId}, skipping`);
          return res.status(200).json({ ok: true });
        }
      }

      const allContacts = await storage.getContacts(companyId);
      const fromDigits = fromNumber.replace(/\D/g, "");
      const matchedContact = allContacts.find((c) => {
        const cDigits = (c.phone || "").replace(/\D/g, "");
        return (
          cDigits.length >= 10 && fromDigits.length >= 10 && fromDigits.endsWith(cDigits.slice(-10))
        );
      });

      console.log(
        `[Telnyx SMS] Contact match: ${matchedContact ? `${matchedContact.firstName} ${matchedContact.lastName} (id: ${matchedContact.id})` : "no match found"} for from number: ${fromNumber}`
      );

      const savedMsg = await storage.createMessage({
        companyId,
        contactId: matchedContact?.id || null,
        channel: "sms",
        direction: "inbound",
        status: "received",
        fromAddress: fromNumber,
        toAddress: toNumber,
        body: textBody || "",
        externalId: messageId,
        mediaUrls: [],
        mediaCount: 0,
      });

      if (inboundMedia.length > 0) {
        const { ObjectStorageService } =
          await import("../replit_integrations/object_storage/objectStorage");
        const ingestStorage = new ObjectStorageService();
        const storedPaths: string[] = [];
        const INBOUND_ALLOWED_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
        const INBOUND_MAX_BYTES = parseInt(
          process.env.MMS_INBOUND_MAX_FILE_BYTES || String(10 * 1024 * 1024),
          10
        );
        const TELNYX_MEDIA_HOSTS = [
          "media.telnyx.com",
          "storage.telnyx.com",
          "telnyx-mms.s3.amazonaws.com",
        ];

        for (const media of inboundMedia) {
          try {
            let mediaHost: string;
            try {
              mediaHost = new URL(media.url).hostname;
            } catch {
              console.warn(`[Telnyx MMS] Skipping invalid media URL: ${media.url}`);
              continue;
            }
            if (
              !TELNYX_MEDIA_HOSTS.some(
                (allowed) => mediaHost === allowed || mediaHost.endsWith(`.${allowed}`)
              )
            ) {
              console.warn(
                `[Telnyx MMS] Skipping media from disallowed host ${mediaHost}: ${media.url}`
              );
              continue;
            }

            if (media.size && media.size > INBOUND_MAX_BYTES) {
              console.warn(
                `[Telnyx MMS] Skipping oversized media (${media.size} bytes > ${INBOUND_MAX_BYTES}): ${media.url}`
              );
              continue;
            }

            if (media.content_type && !INBOUND_ALLOWED_MIME.includes(media.content_type)) {
              console.warn(
                `[Telnyx MMS] Skipping disallowed MIME type ${media.content_type}: ${media.url}`
              );
              continue;
            }

            const mediaResp = await fetch(media.url);
            if (!mediaResp.ok) {
              console.warn(
                `[Telnyx MMS] Failed to download media from ${media.url}: ${mediaResp.status}`
              );
              continue;
            }

            const contentLength = parseInt(mediaResp.headers.get("content-length") || "0", 10);
            if (contentLength > INBOUND_MAX_BYTES) {
              console.warn(
                `[Telnyx MMS] Skipping oversized media (content-length ${contentLength} > ${INBOUND_MAX_BYTES}): ${media.url}`
              );
              continue;
            }

            const mediaBuffer = Buffer.from(await mediaResp.arrayBuffer());
            if (mediaBuffer.length > INBOUND_MAX_BYTES) {
              console.warn(
                `[Telnyx MMS] Skipping oversized downloaded media (${mediaBuffer.length} bytes): ${media.url}`
              );
              continue;
            }

            const detectedMime =
              media.content_type ||
              mediaResp.headers.get("content-type") ||
              "application/octet-stream";
            if (!INBOUND_ALLOWED_MIME.includes(detectedMime)) {
              console.warn(
                `[Telnyx MMS] Skipping disallowed detected MIME ${detectedMime}: ${media.url}`
              );
              continue;
            }
            const mediaSize = mediaBuffer.length;

            const uploadURL = await ingestStorage.getObjectEntityUploadURL();
            const storagePath = ingestStorage.normalizeObjectEntityPath(uploadURL);

            const putResp = await fetch(uploadURL, {
              method: "PUT",
              body: mediaBuffer,
              headers: { "Content-Type": detectedMime },
            });
            if (!putResp.ok) {
              console.warn(
                `[Telnyx MMS] Failed to upload media to object storage: ${putResp.status}`
              );
              continue;
            }

            storedPaths.push(storagePath);

            await storage.createMessageAttachment({
              messageId: savedMsg.id,
              companyId,
              mimeType: detectedMime,
              originalFilename: media.url.split("/").pop()?.split("?")[0] || "media",
              originalSizeBytes: media.size || mediaSize,
              compressedSizeBytes: mediaSize,
              storageUrl: storagePath,
            });
          } catch (attachErr) {
            console.error(`[Telnyx MMS] Failed to ingest media from ${media.url}:`, attachErr);
          }
        }

        if (storedPaths.length > 0) {
          try {
            await db
              .update(messagesTable)
              .set({ mediaUrls: storedPaths, mediaCount: storedPaths.length })
              .where(eq(messagesTable.id, savedMsg.id));
          } catch (updateErr) {
            console.error("[Telnyx MMS] Failed to update message mediaUrls:", updateErr);
          }
          console.log(
            `[Telnyx MMS] Ingested ${storedPaths.length}/${inboundMedia.length} media to object storage for message ${savedMsg.id}`
          );
        }
      }

      console.log(`[Telnyx SMS] Message saved successfully for company ${matchedCompany.name}`);

      // Update routing table for shared number (so future inbound messages route correctly)
      if (isSharedNumber(toNumber) && matchedContact) {
        storage
          .upsertMessageRouting({
            sharedNumber: toNumber,
            customerPhone: fromNumber,
            companyId,
            contactId: matchedContact.id,
            channel: "sms",
            lastUsedAt: new Date(),
          })
          .catch((err) => console.error("[SMS Routing] Failed to upsert routing on inbound:", err));
      }

      if (matchedContact) {
        notify(
          companyId,
          "new_message",
          "New Text Message",
          `${matchedContact.firstName} ${matchedContact.lastName} sent a text message.`,
          `/communications?contactId=${matchedContact.id}`
        );
      }

      const { logSmsMessage } = await import("../services/sms");
      logSmsMessage(companyId, toNumber, fromNumber, "inbound", messageId, 1).catch(() => {});

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[Telnyx SMS] Webhook error:", err);
      res.status(200).json({ ok: true });
    }
  });

  const inboundEmailUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MMS_MAX_PER_FILE, files: MMS_MAX_ATTACHMENTS },
  });

  app.post(
    "/api/webhooks/sendgrid/inbound",
    (req: Request, res: Response, next: NextFunction) => {
      inboundEmailUpload.any()(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            console.warn(
              `[Inbound Email] Attachment too large, processing body without attachments`
            );
            req.files = [];
            return next();
          }
          if (err.code === "LIMIT_FILE_COUNT") {
            console.warn(
              `[Inbound Email] Too many attachments, processing with already parsed files`
            );
            return next();
          }
          console.warn(`[Inbound Email] Multer error: ${err.code}`);
          return res.status(400).json({ error: `Upload error: ${err.message}` });
        }
        if (err) {
          console.error(`[Inbound Email] Upload error:`, err);
          return res.status(400).json({ error: "Failed to parse inbound email" });
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      try {
        const webhookToken = process.env.SENDGRID_INBOUND_WEBHOOK_TOKEN;
        if (!webhookToken && process.env.NODE_ENV === "production") {
          console.error(
            "[Inbound Email] SENDGRID_INBOUND_WEBHOOK_TOKEN not set in production — rejecting request"
          );
          return res.status(503).json({ error: "Inbound email not configured" });
        }
        if (webhookToken) {
          const providedToken = req.query.token || req.headers["x-webhook-token"];
          if (providedToken !== webhookToken) {
            console.warn("[Inbound Email] Invalid or missing webhook token");
            return res.status(403).json({ error: "Forbidden" });
          }
        }

        const from = req.body.from || "";
        const subject = req.body.subject || "";
        const textBody = req.body.text || "";
        const htmlBody = req.body.html || "";

        const fromMatch = from.match(/<([^>]+)>/) || [null, from.trim()];
        const senderEmail = fromMatch[1]?.toLowerCase() || "";

        const allTo = (req.body.to || "").toLowerCase();
        let envelopeTo = "";
        try {
          const envelope = JSON.parse(req.body.envelope || "{}");
          envelopeTo = (
            Array.isArray(envelope.to) ? envelope.to.join(" ") : envelope.to || ""
          ).toLowerCase();
        } catch {
          /* ignore */
        }

        const combinedTo = `${allTo} ${envelopeTo}`;
        let threadId: string | null = null;
        const replyPattern = /reply\+([a-f0-9]+)@/gi;
        let match;
        while ((match = replyPattern.exec(combinedTo)) !== null) {
          threadId = match[1];
          break;
        }

        if (!threadId) {
          console.log(
            `[Inbound Email] No thread ID found in to addresses: ${combinedTo.substring(0, 200)}`
          );
          return res.status(200).json({ ok: true });
        }

        if (!senderEmail) {
          console.log("[Inbound Email] No sender email found");
          return res.status(200).json({ ok: true });
        }

        console.log(
          `[Inbound Email] Processing reply from ${maskEmail(senderEmail)}, threadId=${threadId}`
        );

        const threadMessages = await storage.getMessagesByEmailThreadId(threadId);
        if (threadMessages.length === 0) {
          console.warn(`[Inbound Email] No existing thread found for threadId=${threadId}`);
          return res.status(200).json({ ok: true });
        }

        const originalMsg = threadMessages[0];
        const companyId = originalMsg.companyId;
        const contactId = originalMsg.contactId;

        if (contactId) {
          const contact = await storage.getContact(contactId, companyId);
          if (contact?.email && contact.email.toLowerCase() !== senderEmail) {
            console.warn(
              `[Inbound Email] Sender mismatch: expected=${contact.email}, got=${senderEmail}, thread=${threadId}`
            );
          }
        }

        const inboundBody = textBody || htmlBody || "";
        const dedupeWindowMs = 60_000;
        const now = Date.now();
        const isDuplicate = threadMessages.some((m) => {
          if (m.direction !== "inbound" || m.fromAddress !== senderEmail) return false;
          const msgAge = now - new Date(m.createdAt).getTime();
          return msgAge < dedupeWindowMs && m.body === inboundBody;
        });
        if (isDuplicate) {
          console.log(
            `[Inbound Email] Duplicate inbound email skipped (within ${dedupeWindowMs}ms) for thread ${threadId}`
          );
          return res.status(200).json({ ok: true });
        }

        const savedMsg = await storage.createMessage({
          companyId,
          contactId: contactId || null,
          channel: "email",
          direction: "inbound",
          status: "received",
          fromAddress: senderEmail,
          toAddress: originalMsg.fromAddress,
          subject: subject || originalMsg.subject || "",
          body: textBody || htmlBody || "",
          htmlBody: htmlBody || null,
          emailThreadId: threadId,
          isRead: false,
        });

        const files = req.files as Express.Multer.File[] | undefined;
        if (files && files.length > 0) {
          const ALLOWED_EMAIL_ATTACH_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
          const EMAIL_MAX_ATTACH_BYTES = parseInt(
            process.env.MMS_MAX_FILE_BYTES || String(5 * 1024 * 1024),
            10
          );
          const EMAIL_MAX_ATTACHMENTS = parseInt(process.env.MMS_MAX_ATTACHMENTS || "5", 10);

          try {
            const { ObjectStorageService } =
              await import("../replit_integrations/object_storage/objectStorage");
            const objStorage = new ObjectStorageService();
            const storedUrls: string[] = [];

            let attachCount = 0;
            let totalBytes = 0;
            const EMAIL_MAX_TOTAL_BYTES = parseInt(
              process.env.MMS_MAX_TOTAL_BYTES || String(10 * 1024 * 1024),
              10
            );
            for (const file of files) {
              if (attachCount >= EMAIL_MAX_ATTACHMENTS) {
                console.log(
                  `[Inbound Email] Attachment limit reached (${EMAIL_MAX_ATTACHMENTS}), skipping remaining`
                );
                break;
              }
              if (totalBytes + file.size > EMAIL_MAX_TOTAL_BYTES) {
                console.log(
                  `[Inbound Email] Total payload limit reached (${EMAIL_MAX_TOTAL_BYTES}), skipping remaining`
                );
                break;
              }
              if (!ALLOWED_EMAIL_ATTACH_MIME.includes(file.mimetype)) {
                console.log(
                  `[Inbound Email] Skipping attachment with unsupported MIME: ${file.mimetype}`
                );
                continue;
              }
              if (file.size > EMAIL_MAX_ATTACH_BYTES) {
                console.log(`[Inbound Email] Skipping oversized attachment: ${file.size} bytes`);
                continue;
              }

              const uploadURL = await objStorage.getObjectEntityUploadURL();
              const storagePath = objStorage.normalizeObjectEntityPath(uploadURL);

              const putResp = await fetch(uploadURL, {
                method: "PUT",
                body: file.buffer,
                headers: { "Content-Type": file.mimetype },
              });
              if (!putResp.ok) {
                console.warn(`[Inbound Email] Failed to upload attachment: ${putResp.status}`);
                continue;
              }

              storedUrls.push(storagePath);
              attachCount++;
              totalBytes += file.size;
              await storage.createMessageAttachment({
                messageId: savedMsg.id,
                companyId,
                mimeType: file.mimetype,
                originalFilename: file.originalname || "attachment",
                originalSizeBytes: file.size,
                compressedSizeBytes: file.size,
                storageUrl: storagePath,
              });
            }

            if (storedUrls.length > 0) {
              await db
                .update(messagesTable)
                .set({ mediaUrls: storedUrls, mediaCount: storedUrls.length })
                .where(eq(messagesTable.id, savedMsg.id));
            }
          } catch (attachErr) {
            console.error("[Inbound Email] Attachment processing error:", attachErr);
          }
        }

        console.log(
          `[Inbound Email] Saved inbound email in thread ${threadId} for company ${companyId}`
        );

        if (contactId) {
          const contact = await storage.getContact(contactId, companyId);
          if (contact) {
            notify(
              companyId,
              "new_message",
              "New Email Reply",
              `${contact.firstName} ${contact.lastName} replied to an email.`,
              `/communications`
            );
          }
        }

        res.status(200).json({ ok: true });
      } catch (err) {
        console.error("[Inbound Email] Webhook error:", err);
        res.status(200).json({ ok: true });
      }
    }
  );

  app.post("/api/webhooks/quickbooks", async (req: Request, res: Response) => {
    try {
      const verifierToken = process.env.QBO_WEBHOOK_VERIFIER_TOKEN;
      const signature = req.headers["intuit-signature"] as string | undefined;

      if (verifierToken) {
        if (!signature) {
          console.warn("[QBO Webhook] Missing intuit-signature header");
          return res.status(401).json({ error: "Missing signature" });
        }
        const crypto = await import("crypto");
        const rawBody = (req as Request & { rawBody?: string }).rawBody;
        const hash = crypto
          .createHmac("sha256", verifierToken)
          .update(rawBody ?? "")
          .digest("base64");
        const hashBuf = Buffer.from(hash);
        const sigBuf = Buffer.from(signature);
        if (hashBuf.length !== sigBuf.length || !crypto.timingSafeEqual(hashBuf, sigBuf)) {
          console.warn("[QBO Webhook] Signature mismatch");
          return res.status(401).json({ error: "Invalid signature" });
        }
      } else {
        if (process.env.NODE_ENV === "production") {
          console.error(
            "[QBO Webhook] QBO_WEBHOOK_VERIFIER_TOKEN not set in production — rejecting request"
          );
          return res.status(401).json({ error: "Webhook verification not configured" });
        }
        console.warn(
          "[QBO Webhook] QBO_WEBHOOK_VERIFIER_TOKEN not set — skipping signature verification (dev only)"
        );
      }

      const payload = req.body;
      if (payload?.eventNotifications) {
        const { lookupCompanyByRealmId, processWebhookEntity } =
          await import("../services/quickbooks");
        for (const notification of payload.eventNotifications) {
          const realmId = notification.realmId;
          const companyId = await lookupCompanyByRealmId(realmId);
          if (!companyId) {
            console.warn(`[QBO Webhook] No company found for realmId=${realmId}`);
            continue;
          }
          const entities = notification.dataChangeEvent?.entities || [];
          for (const entity of entities) {
            console.log(
              `[QBO Webhook] realmId=${realmId} company=${companyId} operation=${entity.operation} entity=${entity.name} id=${entity.id}`
            );
            processWebhookEntity(companyId, entity.name, String(entity.id), entity.operation).catch(
              (err: unknown) =>
                console.error(
                  `[QBO Webhook] Async processing failed:`,
                  err instanceof Error ? err.message : String(err)
                )
            );
          }
        }
      }

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[QBO Webhook] Error:", err);
      res.status(200).json({ ok: true });
    }
  });

  app.post("/api/webhooks/retell", async (req: Request, res: Response) => {
    try {
      const retellApiKey = process.env.RETELL_API_KEY;
      if (retellApiKey) {
        const signature = req.headers["x-retell-signature"] as string | undefined;
        if (!signature) {
          console.warn("[Retell Webhook] Missing x-retell-signature header");
          return res.status(200).json({ ok: true });
        }
        const crypto = await import("crypto");
        const rawBody = (req as Request & { rawBody?: string }).rawBody || JSON.stringify(req.body);
        const expectedSignature = crypto
          .createHmac("sha256", retellApiKey)
          .update(rawBody)
          .digest("hex");
        const sigBuf = Buffer.from(signature);
        const expectedBuf = Buffer.from(expectedSignature);
        if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
          console.warn("[Retell Webhook] Signature mismatch");
          return res.status(200).json({ ok: true });
        }
      } else {
        console.warn("[Retell Webhook] RETELL_API_KEY not set — skipping signature verification");
      }

      const payload = req.body;
      const eventType = payload?.event;
      const callData = payload?.call;

      if (!callData || !eventType) {
        return res.status(200).json({ ok: true });
      }

      if (eventType !== "call_ended" && eventType !== "call_analyzed") {
        console.log(`[Retell Webhook] Ignoring event: ${eventType}`);
        return res.status(200).json({ ok: true });
      }

      const retellCallId = callData.call_id;
      if (!retellCallId) {
        return res.status(200).json({ ok: true });
      }

      const agentPhone = (callData.to_number || callData.agent_id || "").replace(/\D/g, "");
      const durationMs =
        callData.end_timestamp && callData.start_timestamp
          ? callData.end_timestamp - callData.start_timestamp
          : 0;
      const durationSeconds = Math.round(durationMs / 1000);
      const durationMinutes = durationSeconds > 0 ? Math.ceil(durationSeconds / 60) : 0;
      const outcome = callData.call_analysis?.call_successful
        ? "successful"
        : callData.disconnection_reason || "unknown";
      const summary = callData.call_analysis?.call_summary || null;

      const existing = await storage.getVoiceCallByRetellId(retellCallId);

      if (existing) {
        if (eventType === "call_analyzed" && callData.call_analysis) {
          await storage.updateVoiceCall(existing.id, {
            outcome,
            summary,
            metadata: {
              ...((existing.metadata as Record<string, unknown>) || {}),
              callAnalysis: callData.call_analysis,
            },
          });
          console.log(`[Retell Webhook] Updated analysis for call ${retellCallId}`);
        } else {
          console.log(`[Retell Webhook] Call ${retellCallId} already recorded, skipping`);
        }
        return res.status(200).json({ ok: true });
      }

      const allCompanies = await storage.listCompanies();
      const matchedCompany = allCompanies.find((c) => {
        const cDigits = (c.dedicatedPhoneNumber || "").replace(/\D/g, "");
        return (
          cDigits.length >= 10 && agentPhone.length >= 10 && agentPhone.endsWith(cDigits.slice(-10))
        );
      });

      if (!matchedCompany) {
        console.warn(
          `[Retell Webhook] No company matched for agent phone ${maskPhone(agentPhone)}, call ${retellCallId}`
        );
        return res.status(200).json({ ok: true });
      }

      const companyId = matchedCompany.id;

      const recordingUrl = callData.recording_url || callData.stereo_recording_url || null;

      // Try to link to an existing contact by caller phone
      let linkedContactId: string | null = null;
      if (callData.from_number) {
        try {
          const allContacts = await storage.getContacts(companyId);
          const digits = (callData.from_number as string).replace(/\D/g, "");
          const match = allContacts.find((c) => {
            const cDigits = (c.phone || "").replace(/\D/g, "");
            return (
              cDigits.length >= 10 && digits.length >= 10 && digits.endsWith(cDigits.slice(-10))
            );
          });
          if (match) linkedContactId = match.id;
        } catch {
          /* non-critical */
        }
      }

      await storage.createVoiceCall({
        companyId,
        contactId: linkedContactId,
        retellCallId,
        callerPhone: callData.from_number || null,
        agentPhone: callData.to_number || null,
        durationSeconds,
        durationMinutes,
        outcome,
        summary,
        recordingUrl,
        metadata: {
          disconnectionReason: callData.disconnection_reason,
          callAnalysis: callData.call_analysis,
        },
      });

      if (durationMinutes > 0) {
        await storage.createUsageEvent({
          companyId,
          eventType: "voice_minute",
          quantity: durationMinutes,
          metadata: { retellCallId, durationSeconds, callerPhone: callData.from_number },
        });

        if (matchedCompany.stripeCustomerId) {
          reportRetellMinutes(matchedCompany.stripeCustomerId, durationMinutes).catch((err) =>
            console.error(`[Retell Webhook] Failed to report metered usage:`, err.message)
          );
        }
      }

      console.log(
        `[Retell Webhook] Recorded call ${retellCallId} for company ${matchedCompany.name} (${companyId}): ${durationMinutes} min(s)`
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[Retell Webhook] Error:", err);
      res.status(200).json({ ok: true });
    }
  });

  // Send invoice via email
  app.post("/api/invoices/:id/send-email", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, userId } = await getCompanyContext(req);
      const invoiceId = p(req.params.id);
      console.log(`[send-email] Starting send for invoice ${invoiceId}`);
      const result = await sendInvoiceEmail(invoiceId, companyId, {
        sentBy: userId,
        baseUrl: getBaseUrl(req),
      });
      if (!result.success) {
        const status =
          result.error === "Invoice not found"
            ? 404
            : result.error === "Invoice already paid"
              ? 400
              : result.error === "Contact has no email address"
                ? 400
                : 500;
        return res.status(status).json({ error: result.error });
      }
      return res.json({
        success: true,
        messageId: result.messageId || null,
        paymentUrl: result.paymentUrl || null,
      });
    } catch (err) {
      console.error("[send-email] Unhandled error in send-email handler:", err);
      handleError(res, err);
    }
  });
}
