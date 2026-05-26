import type { Express, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { verifyTelnyxSignature } from "../lib/telnyx-verify";
import { checkRateLimit } from "../lib/rate-limit";
import { loadSession, createSession, updateSession } from "../lib/sms-session";
import { sendAlert } from "../lib/alert";
import { isFallbackResponse, logFallback } from "../lib/fallback-log";
import { anthropic, isClaudeConfigured } from "../services/claude";
import { sendTelnyxSms } from "../services/telnyx-sms";

export async function registerSmsAgentRoutes(app: Express): Promise<void> {
  app.post("/api/sms/inbound", async (req: Request, res: Response) => {
    try {
      const rawBody: Buffer =
        (req as Request & { rawBody?: Buffer }).rawBody || Buffer.from(JSON.stringify(req.body));
      const signature = req.headers["telnyx-signature-ed25519"] as string | undefined;
      const timestamp = req.headers["telnyx-timestamp"] as string | undefined;

      if (!process.env.TELNYX_PUBLIC_KEY) {
        if (process.env.NODE_ENV === "production") {
          return res.status(401).json({ error: "Webhook verification not configured" });
        }
        console.warn("[SMS Agent] TELNYX_PUBLIC_KEY not set — skipping signature check (dev only)");
      } else {
        const signatureValid = verifyTelnyxSignature(rawBody, signature, timestamp);
        if (!signatureValid) {
          return res.status(401).json({ error: "Invalid signature" });
        }
      }

      const payload = req.body;
      const eventType = payload?.data?.event_type;
      if (eventType && eventType !== "message.received") {
        return res.sendStatus(200);
      }

      const fromNumber: string =
        payload?.data?.payload?.from?.phone_number || payload?.data?.payload?.from || "";
      const toNumber: string =
        payload?.data?.payload?.to?.[0]?.phone_number || payload?.data?.payload?.to || "";
      const userText: string = payload?.data?.payload?.text || payload?.data?.payload?.body || "";

      if (!fromNumber || !toNumber || !userText) {
        return res.sendStatus(200);
      }

      const rateResult = checkRateLimit(fromNumber);
      if (!rateResult.allowed) {
        return res.sendStatus(200);
      }

      const company = await storage.getCompanyByTelnyxNumber(toNumber);
      if (!company) {
        await sendAlert("SMS inbound: tenant not found for Telnyx number", {
          toNumber,
          fromNumber,
        });
        return res.sendStatus(200);
      }

      if (!isClaudeConfigured()) {
        console.warn("[SMS Agent] CLAUDE_API_KEY not configured — sending fallback reply");
        if (company.telnyxApiKey && company.telnyxPhoneNumber && company.telnyxMessagingProfileId) {
          await sendTelnyxSms({
            to: fromNumber,
            body: `Thanks for reaching out to ${company.name || "us"}! We'll be in touch soon.`,
            from: toNumber,
            apiKey: company.telnyxApiKey,
            messagingProfileId: company.telnyxMessagingProfileId,
            companyId: company.id,
          });
        }
        return res.sendStatus(200);
      }

      let session = await loadSession(fromNumber, toNumber);
      const messages: { role: string; content: string }[] = session?.messages
        ? [...session.messages]
        : [];

      messages.push({ role: "user", content: userText });

      const businessName = company.name || "our business";
      const serviceArea = company.voiceAgentServiceArea || "";
      const policies = company.voiceAgentPolicies || "";
      const pricingSummary = company.voiceAgentPricingSummary || "";

      const systemPrompt = `You are a helpful SMS assistant for ${businessName}, a pet waste removal company.
${serviceArea ? `Service area: ${serviceArea}` : ""}
${pricingSummary ? `Pricing: ${pricingSummary}` : ""}
${policies ? `Policies:\n${policies}` : ""}

When a customer provides their full name, phone number, and address and expresses interest in service, output EXACTLY on its own line: SUBMIT_LEAD:{"firstName":"...","lastName":"...","phone":"...","streetAddress":"...","zipcode":"...","email":"..."}

If you are not certain about something, say "I'm not certain about that" and offer to have someone follow up.
Keep responses brief and conversational for SMS. Do not use emojis.`;

      const response = await anthropic.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 300,
        system: systemPrompt,
        messages: messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      });

      const replyContent = response.content[0];
      let replyText = replyContent.type === "text" ? replyContent.text : "";

      let leadSubmitted = false;
      const submitMatch = replyText.match(/SUBMIT_LEAD:(\{[^}]+\})/);
      if (submitMatch) {
        try {
          const leadData = JSON.parse(submitMatch[1]);
          const internalRes = await fetch(
            `${process.env.APP_BASE_URL || "http://localhost:5000"}/api/retell/create-lead`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-retell-api-key": process.env.RETELL_API_KEY || "",
              },
              body: JSON.stringify({
                tenantId: company.id,
                firstName: leadData.firstName || "",
                lastName: leadData.lastName || "",
                phone: leadData.phone || fromNumber,
                email: leadData.email || "",
                street: leadData.streetAddress || "",
                zipCode: leadData.zipcode || "",
              }),
            }
          );
          if (internalRes.ok) {
            leadSubmitted = true;
          }
        } catch {}
        replyText = replyText.replace(/SUBMIT_LEAD:\{[^}]+\}/, "").trim();
      }

      if (!replyText) {
        replyText = leadSubmitted
          ? `Thanks! We've received your information and will be in touch soon.`
          : `Thanks for reaching out to ${businessName}! How can I help you?`;
      }

      if (isFallbackResponse(replyText)) {
        const precedingUser = messages.filter((m) => m.role === "user").slice(-1)[0]?.content;
        await logFallback({
          companyId: company.id,
          channel: "sms",
          triggerPhrase: precedingUser,
          agentResponse: replyText,
        });
      }

      messages.push({ role: "assistant", content: replyText });

      if (session) {
        await updateSession(fromNumber, toNumber, messages);
      } else {
        await createSession(company.id, fromNumber, toNumber, messages);
      }

      if (company.telnyxApiKey && company.telnyxPhoneNumber && company.telnyxMessagingProfileId) {
        await sendTelnyxSms({
          to: fromNumber,
          body: replyText,
          from: toNumber,
          apiKey: company.telnyxApiKey,
          messagingProfileId: company.telnyxMessagingProfileId,
          companyId: company.id,
        });
      }

      return res.sendStatus(200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sendAlert("SMS inbound: unhandled error", { error: msg });
      return res.sendStatus(200);
    }
  });

  app.get("/api/sms/cleanup", async (req: Request, res: Response) => {
    try {
      const secret = process.env.CLEANUP_SECRET;
      if (!secret || req.headers["x-cleanup-secret"] !== secret) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const result = await db.execute(
        sql`DELETE FROM sms_sessions WHERE updated_at < NOW() - INTERVAL '24 hours' RETURNING id`
      );
      return res.json({ deleted: result.rows.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: msg });
    }
  });
}
