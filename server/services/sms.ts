import { db } from "../db";
import { smsMessages, usageEvents } from "@shared/schema";

interface SendSmsResult {
  success: boolean;
  messageSid?: string;
  error?: string;
}

interface CompanySmsConfig {
  provider: "telnyx";
  configured: boolean;
  phoneNumber: string;
}

export async function getCompanySmsConfig(companyId: string): Promise<CompanySmsConfig> {
  const { storage } = await import("../storage");
  const company = await storage.getCompany(companyId);
  if (!company) return { provider: "telnyx", configured: false, phoneNumber: "" };

  const apiKey = company.telnyxApiKey || process.env.TELNYX_API_KEY;
  const configured = !!(apiKey && company.telnyxPhoneNumber && company.telnyxMessagingProfileId);
  return { provider: "telnyx", configured, phoneNumber: company.telnyxPhoneNumber || "" };
}

export async function isSmsConfiguredForCompany(companyId: string): Promise<boolean> {
  const config = await getCompanySmsConfig(companyId);
  return config.configured;
}

export async function getFromPhoneForCompany(companyId: string): Promise<string> {
  const config = await getCompanySmsConfig(companyId);
  return config.phoneNumber;
}

interface SendSmsForCompanyOptions {
  to: string;
  body: string;
  companyId: string;
  mediaUrl?: string;
}

export async function sendSmsForCompany(options: SendSmsForCompanyOptions): Promise<SendSmsResult> {
  const { storage } = await import("../storage");
  const company = await storage.getCompany(options.companyId);
  if (!company) {
    return { success: false, error: "Company not found" };
  }

  const apiKey = company.telnyxApiKey || process.env.TELNYX_API_KEY;
  if (!apiKey || !company.telnyxPhoneNumber || !company.telnyxMessagingProfileId) {
    return { success: false, error: "Telnyx SMS is not configured. Set API key, phone number, and messaging profile ID in Settings." };
  }

  const { sendTelnyxSms } = await import("./telnyx-sms");
  const { decrypt } = await import("../utils/encryption");
  let resolvedApiKey: string;
  if (company.telnyxApiKey) {
    try {
      resolvedApiKey = decrypt(company.telnyxApiKey);
    } catch {
      resolvedApiKey = company.telnyxApiKey;
    }
  } else {
    resolvedApiKey = process.env.TELNYX_API_KEY!;
  }

  return sendTelnyxSms({
    to: options.to,
    body: options.body,
    from: company.telnyxPhoneNumber,
    apiKey: resolvedApiKey,
    messagingProfileId: company.telnyxMessagingProfileId,
    companyId: options.companyId,
    mediaUrl: options.mediaUrl,
  });
}

export async function logSmsMessage(companyId: string, to: string, from: string, direction: "inbound" | "outbound", externalId?: string, segments?: number): Promise<void> {
  const segCount = segments ?? 1;
  await db.insert(smsMessages).values({
    companyId,
    toNumber: to,
    fromNumber: from,
    direction,
    twilioSid: externalId,
    segments: segCount,
  });
  if (direction === "outbound") {
    db.insert(usageEvents).values({
      companyId,
      eventType: "sms_segment",
      quantity: segCount,
      metadata: { externalId, to },
    }).then(async () => {
      const { reportMeteredUsage } = await import("./stripe");
      const { storage } = await import("../storage");
      const company = await storage.getCompany(companyId);
      if (company?.stripeSubscriptionId) {
        reportMeteredUsage(company.stripeSubscriptionId, "sms_segment", segCount).catch(() => {});
      }
    }).catch((err) => console.error("[Usage] Failed to log SMS usage:", err.message));
  }
}
