import { db } from "../db";
import { smsMessages } from "@shared/schema";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || "+15715824054";

interface SendSmsOptions {
  to: string;
  body: string;
  from?: string;
  mediaUrl?: string;
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

export async function sendSms(options: SendSmsOptions): Promise<SendSmsResult> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return { success: false, error: "Twilio credentials not configured" };
  }

  try {
    const from = options.from || TWILIO_PHONE_NUMBER;
    const to = formatPhoneNumber(options.to);

    const params = new URLSearchParams({
      To: to,
      From: from,
      Body: options.body,
    });
    if (options.mediaUrl) {
      params.append("MediaUrl", options.mediaUrl);
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.message || `Twilio error: ${response.status}`,
      };
    }

    return {
      success: true,
      messageSid: data.sid,
    };
  } catch (err: any) {
    console.error("Twilio SMS error:", err.message);
    return { success: false, error: err.message };
  }
}

export function getTwilioPhoneNumber(): string {
  return TWILIO_PHONE_NUMBER;
}

export function isTwilioConfigured(): boolean {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN);
}

export async function logSmsMessage(companyId: string, to: string, from: string, direction: "inbound" | "outbound", twilioSid?: string, segments?: number): Promise<void> {
  await db.insert(smsMessages).values({
    companyId,
    toNumber: to,
    fromNumber: from,
    direction,
    twilioSid,
    segments: segments ?? 1,
  });
}
