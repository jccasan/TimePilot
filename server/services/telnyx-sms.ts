import { db } from "../db";
import { smsMessages, usageEvents } from "@shared/schema";

interface TelnyxSmsOptions {
  to: string;
  body: string;
  from: string;
  apiKey: string;
  messagingProfileId: string;
  companyId: string;
  mediaUrl?: string;
  mediaUrls?: string[];
}

interface SendSmsResult {
  success: boolean;
  messageSid?: string;
  error?: string;
}

function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.startsWith("+")) return phone;
  return `+${digits}`;
}

export async function sendTelnyxSms(options: TelnyxSmsOptions): Promise<SendSmsResult> {
  try {
    const to = formatPhoneNumber(options.to);
    const from = formatPhoneNumber(options.from);

    const response = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        text: options.body,
        messaging_profile_id: options.messagingProfileId,
        ...(options.mediaUrls && options.mediaUrls.length > 0
          ? { media_urls: options.mediaUrls }
          : options.mediaUrl
            ? { media_urls: [options.mediaUrl] }
            : {}),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data?.errors?.[0]?.detail || data?.errors?.[0]?.title || `Telnyx error: ${response.status}`;
      return { success: false, error: errMsg };
    }

    const messageId = data?.data?.id;
    const parts = data?.data?.parts || 1;

    logTelnyxSmsUsage(options.companyId, to, from, messageId, parts).catch(() => {});

    return { success: true, messageSid: messageId };
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    console.error("Telnyx SMS error:", errMessage);
    return { success: false, error: errMessage };
  }
}

async function logTelnyxSmsUsage(companyId: string, to: string, from: string, telnyxId?: string, segments: number = 1): Promise<void> {
  try {
    await db.insert(smsMessages).values({ companyId, toNumber: to, fromNumber: from, direction: "outbound", twilioSid: telnyxId, segments });
    await db.insert(usageEvents).values({ companyId, eventType: "sms_segment", quantity: segments, metadata: { provider: "telnyx", telnyxId, to, segments } });
    const { reportMeteredUsage } = await import("./stripe");
    const { storage } = await import("../storage");
    const company = await storage.getCompany(companyId);
    if (company?.stripeSubscriptionId) {
      reportMeteredUsage(company.stripeSubscriptionId, "sms_segment", segments).catch(() => {});
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Usage] Failed to log Telnyx SMS usage:", message);
  }
}
