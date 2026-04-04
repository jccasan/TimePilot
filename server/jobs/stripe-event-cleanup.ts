import { db } from "../db";
import { lt } from "drizzle-orm";
import { stripeEvents } from "@shared/schema";

export async function runStripeEventCleanup() {
  const startTime = Date.now();
  console.log("[StripeEventCleanup] Starting cleanup of old stripe events...");

  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await db.delete(stripeEvents).where(lt(stripeEvents.processedAt, cutoff));
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const deleted = (result as any).rowCount ?? 0;
    console.log(`[StripeEventCleanup] Completed in ${elapsed}s — deleted ${deleted} events older than 30 days`);
    return { deleted, elapsed };
  } catch (err) {
    console.error("[StripeEventCleanup] Error:", err);
    throw err;
  }
}
