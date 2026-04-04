import { db } from "../db";
import { lt, count } from "drizzle-orm";
import { stripeEvents } from "@shared/schema";

export async function runStripeEventCleanup() {
  const startTime = Date.now();
  console.log("[StripeEventCleanup] Starting cleanup of old stripe events...");

  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [{ total }] = await db
      .select({ total: count() })
      .from(stripeEvents)
      .where(lt(stripeEvents.processedAt, cutoff));

    await db.delete(stripeEvents).where(lt(stripeEvents.processedAt, cutoff));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[StripeEventCleanup] Completed in ${elapsed}s — deleted ${total} events older than 30 days`);
    return { deleted: total, elapsed };
  } catch (err) {
    console.error("[StripeEventCleanup] Error:", err);
    throw err;
  }
}
