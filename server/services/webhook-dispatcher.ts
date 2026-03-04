import crypto from "crypto";
import { db } from "../db";
import { eq, and, lte, lt } from "drizzle-orm";
import { webhooks, webhookDeliveries } from "@shared/schema";
import type { WebhookDelivery } from "@shared/schema";

const MAX_ATTEMPTS = 5;
const BACKOFF_DELAYS_MS = [
  60 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  2 * 60 * 60 * 1000,
];

function computeHmacSignature(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export async function dispatchWebhooksForEvent(companyId: string, event: string, payload: Record<string, any>) {
  try {
    const matchingWebhooks = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.companyId, companyId), eq(webhooks.isActive, true)));

    const filtered = matchingWebhooks.filter((w) => {
      const events = w.events as string[];
      return events && events.includes(event);
    });

    for (const webhook of filtered) {
      const [delivery] = await db
        .insert(webhookDeliveries)
        .values({
          webhookId: webhook.id,
          event,
          payload,
          status: "pending",
          attempts: 0,
          nextRetry: new Date(),
        })
        .returning();

      attemptDelivery(delivery, webhook.url, webhook.secret).catch(console.error);
    }
  } catch (err) {
    console.error("[WebhookDispatcher] Error dispatching webhooks:", err);
  }
}

async function attemptDelivery(delivery: WebhookDelivery, url: string, secret: string) {
  const payloadStr = JSON.stringify(delivery.payload);
  const signature = computeHmacSignature(secret, payloadStr);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  let responseCode: number | null = null;
  let responseBody: string | null = null;
  let success = false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Timestamp": timestamp,
        "X-Webhook-Event": delivery.event,
        "X-Webhook-Delivery-Id": delivery.id,
      },
      body: payloadStr,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    responseCode = response.status;
    responseBody = await response.text().catch(() => "");
    if (responseBody && responseBody.length > 2000) {
      responseBody = responseBody.substring(0, 2000);
    }
    success = response.ok;
  } catch (err: any) {
    responseBody = err?.message || "Request failed";
  }

  const newAttempts = (delivery.attempts || 0) + 1;

  if (success) {
    await db
      .update(webhookDeliveries)
      .set({
        status: "success",
        attempts: newAttempts,
        lastAttempt: new Date(),
        nextRetry: null,
        responseCode,
        responseBody,
      })
      .where(eq(webhookDeliveries.id, delivery.id));
  } else {
    const isFinal = newAttempts >= MAX_ATTEMPTS;
    const nextRetry = isFinal
      ? null
      : new Date(Date.now() + BACKOFF_DELAYS_MS[newAttempts - 1]);

    await db
      .update(webhookDeliveries)
      .set({
        status: isFinal ? "failed" : "pending",
        attempts: newAttempts,
        lastAttempt: new Date(),
        nextRetry,
        responseCode,
        responseBody,
      })
      .where(eq(webhookDeliveries.id, delivery.id));
  }
}

export async function retryFailedWebhookDeliveries() {
  try {
    const now = new Date();
    const pendingDeliveries = await db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.status, "pending"),
          lte(webhookDeliveries.nextRetry, now),
          lt(webhookDeliveries.attempts, MAX_ATTEMPTS)
        )
      );

    for (const delivery of pendingDeliveries) {
      const [webhook] = await db
        .select()
        .from(webhooks)
        .where(eq(webhooks.id, delivery.webhookId));

      if (!webhook || !webhook.isActive) {
        await db
          .update(webhookDeliveries)
          .set({ status: "failed", responseBody: "Webhook disabled or deleted" })
          .where(eq(webhookDeliveries.id, delivery.id));
        continue;
      }

      await attemptDelivery(delivery, webhook.url, webhook.secret);
    }
  } catch (err) {
    console.error("[WebhookDispatcher] Retry job error:", err);
  }
}

export function startWebhookRetryJob() {
  setInterval(() => retryFailedWebhookDeliveries().catch(console.error), 5 * 60 * 1000);
  console.log("[WebhookDispatcher] Retry job started (every 5 minutes)");
}
