/**
 * One-time setup script: Create the Lead Response Stripe product and price.
 *
 * Usage:
 *   npx tsx scripts/create-lead-response-product.ts
 *
 * After running, copy the printed LEAD_RESPONSE_PRICE_ID value and add it
 * to your environment secrets as LEAD_RESPONSE_PRICE_ID.
 *
 * This script is idempotent — it searches for an existing product named
 * "Lead Response" before creating a new one.
 */

import Stripe from "stripe";

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("Error: STRIPE_SECRET_KEY environment variable is not set.");
    process.exit(1);
  }

  const stripe = new Stripe(key, { apiVersion: "2024-06-20" });

  console.log("Searching for existing Lead Response product...");

  let productId: string | null = null;

  const products = await stripe.products.search({
    query: 'name:"Lead Response" AND active:"true"',
    limit: 5,
  });

  if (products.data.length > 0) {
    productId = products.data[0].id;
    console.log(`Found existing product: ${productId} (${products.data[0].name})`);
  } else {
    const product = await stripe.products.create({
      name: "Lead Response",
      description:
        "ScooPilot Lead Response — automated lead handling, SMS follow-up, and deposit collection for pet waste removal businesses.",
      metadata: { scoopilot_product: "lead_response" },
    });
    productId = product.id;
    console.log(`Created new product: ${productId}`);
  }

  console.log("Searching for existing $19/mo Lead Response price...");

  let priceId: string | null = null;

  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    type: "recurring",
    limit: 10,
  });

  const existing19 = prices.data.find(
    (p) => p.unit_amount === 1900 && p.currency === "usd" && p.recurring?.interval === "month"
  );

  if (existing19) {
    priceId = existing19.id;
    console.log(`Found existing $19/mo price: ${priceId}`);
  } else {
    const price = await stripe.prices.create({
      product: productId,
      unit_amount: 1900,
      currency: "usd",
      recurring: { interval: "month" },
      nickname: "Lead Response Monthly",
      metadata: { scoopilot_product: "lead_response" },
    });
    priceId = price.id;
    console.log(`Created $19/mo price: ${priceId}`);
  }

  console.log("\n========================================");
  console.log("ACTION REQUIRED — add to environment secrets:");
  console.log(`LEAD_RESPONSE_PRICE_ID=${priceId}`);
  console.log("========================================\n");
}

main().catch((err) => {
  console.error("Script failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
