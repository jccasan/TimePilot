import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { provisionNewTenant } from "../lib/provision-tenant";
import { getBaseUrl } from "./shared";

interface FbFieldEntry {
  name: string;
  values: string[];
}

function verifyFacebookSignature(rawBody: Buffer | string, signature: string | undefined): boolean {
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appSecret || !signature) return false;
  const match = signature.match(/^sha256=([0-9a-f]{64})$/i);
  if (!match) return false;
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8");
  const expected = crypto.createHmac("sha256", appSecret).update(buf).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(match[1], "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function extractLeadFields(fieldData: FbFieldEntry[]): {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
} | null {
  const get = (name: string): string =>
    fieldData.find((f) => f.name === name)?.values?.[0]?.trim() ?? "";

  let firstName = get("first_name");
  let lastName = get("last_name");
  const fullName = get("full_name");

  if (!firstName && fullName) {
    const parts = fullName.split(/\s+/);
    firstName = parts[0] ?? "";
    lastName = parts.slice(1).join(" ");
  }

  const email = get("email");
  if (!email || !firstName) return null;

  const phone = get("phone_number") || get("phone") || undefined;
  return { firstName, lastName, email, phone };
}

export async function registerFacebookWebhookRoutes(app: Express): Promise<void> {
  if (!process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN) {
    console.warn(
      "[Facebook Webhook] FACEBOOK_WEBHOOK_VERIFY_TOKEN is not set — webhook endpoint verification will fail"
    );
  }
  if (!process.env.FACEBOOK_APP_SECRET) {
    console.warn(
      "[Facebook Webhook] FACEBOOK_APP_SECRET is not set — payload signature verification will fail"
    );
  }

  // ── GET /api/webhooks/facebook/leads ─────────────────────────────────────
  // Meta calls this to verify the endpoint during Webhook subscription setup.
  app.get("/api/webhooks/facebook/leads", (req: Request, res: Response) => {
    const mode = req.query["hub.mode"] as string | undefined;
    const token = req.query["hub.verify_token"] as string | undefined;
    const challenge = req.query["hub.challenge"] as string | undefined;

    const verifyToken = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;
    if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
      console.log("[Facebook Webhook] Endpoint verified by Meta");
      return res.status(200).send(challenge ?? "ok");
    }

    console.warn(
      `[Facebook Webhook] Verification failed — mode=${mode}, token match=${token === verifyToken}`
    );
    return res.status(403).json({ error: "Verification failed" });
  });

  // ── POST /api/webhooks/facebook/leads ────────────────────────────────────
  // Meta delivers lead events here. We verify the HMAC signature then
  // provision a new tenant for each unique email address in the payload.
  app.post("/api/webhooks/facebook/leads", async (req: Request, res: Response) => {
    try {
      const rawBody = (req as Request & { rawBody?: Buffer | string }).rawBody;
      const signature = req.headers["x-hub-signature-256"] as string | undefined;

      if (!rawBody || !verifyFacebookSignature(rawBody, signature)) {
        console.warn("[Facebook Webhook] Signature verification failed — rejecting payload");
        return res.status(403).json({ error: "Invalid signature" });
      }

      const appUrl = getBaseUrl(req);
      const payload = req.body as {
        object?: string;
        entry?: Array<{
          changes?: Array<{
            value?: {
              object?: string;
              field_data?: FbFieldEntry[];
              ad_id?: string;
              form_id?: string;
              leadgen_id?: string;
            };
          }>;
        }>;
      };

      const entries = Array.isArray(payload?.entry) ? payload.entry : [];
      let provisioned = 0;
      let skipped = 0;

      for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          const value = change?.value;
          if (!value) continue;

          const fieldData: FbFieldEntry[] = Array.isArray(value.field_data)
            ? (value.field_data as FbFieldEntry[])
            : [];

          const lead = extractLeadFields(fieldData);
          if (!lead) {
            console.warn(
              "[Facebook Webhook] Could not extract required fields (email/first_name) — skipping entry"
            );
            skipped++;
            continue;
          }

          const maskedEmail = lead.email.replace(/@.+/, "@***");
          console.log(`[Facebook Webhook] Processing lead ${maskedEmail}`);

          const result = await provisionNewTenant({
            firstName: lead.firstName,
            lastName: lead.lastName,
            email: lead.email,
            phone: lead.phone,
            source: "Facebook Lead Ad",
            appUrl,
          });

          if (result.alreadyExists) {
            console.log(`[Facebook Webhook] Duplicate account — skipped ${maskedEmail}`);
            skipped++;
          } else {
            console.log(
              `[Facebook Webhook] Provisioned account for ${maskedEmail} — company: "${result.company.name}"`
            );
            provisioned++;
          }
        }
      }

      console.log(
        `[Facebook Webhook] Batch complete — provisioned: ${provisioned}, skipped: ${skipped}`
      );
      // Always respond 200 even when skipping, so Meta does not retry.
      return res.status(200).json({ received: true, provisioned, skipped });
    } catch (err) {
      console.error("[Facebook Webhook] Unhandled error:", err);
      // Return 200 to prevent Meta from re-delivering the same payload.
      return res.status(200).json({ received: true, error: "Internal error — check server logs" });
    }
  });
}
