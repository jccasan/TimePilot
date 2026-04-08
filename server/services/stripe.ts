import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    stripeInstance = new Stripe(key, { apiVersion: "2025-04-30.basil" });
  }
  return stripeInstance;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export async function createStripeCustomer(params: {
  email?: string;
  name: string;
  phone?: string;
  metadata?: Record<string, string>;
}): Promise<string> {
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: params.email || undefined,
    name: params.name,
    phone: params.phone || undefined,
    metadata: params.metadata || {},
  });
  return customer.id;
}

export async function createSetupIntent(customerId: string): Promise<{
  clientSecret: string;
  setupIntentId: string;
}> {
  const stripe = getStripe();
  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
  });
  return {
    clientSecret: setupIntent.client_secret!,
    setupIntentId: setupIntent.id,
  };
}

export async function getCustomerPaymentMethods(customerId: string) {
  const stripe = getStripe();
  const methods = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
  });
  return methods.data.map((pm) => ({
    id: pm.id,
    brand: pm.card?.brand || "unknown",
    last4: pm.card?.last4 || "****",
    expMonth: pm.card?.exp_month || 0,
    expYear: pm.card?.exp_year || 0,
  }));
}

function getPlatformFeePercent(): number {
  const raw = process.env.PLATFORM_FEE_PERCENT;
  const parsed = raw ? parseFloat(raw) : NaN;
  if (!Number.isFinite(parsed)) return 2.9;
  return Math.max(0, Math.min(100, parsed));
}

function computeApplicationFee(amountCents: number): number {
  return Math.round(amountCents * (getPlatformFeePercent() / 100));
}

export async function createPaymentIntent(params: {
  customerId: string;
  amount: number;
  currency?: string;
  metadata?: Record<string, string>;
  paymentMethodId?: string;
  stripeConnectAccountId?: string | null;
}): Promise<{
  clientSecret: string;
  paymentIntentId: string;
  status: string;
}> {
  const stripe = getStripe();
  const amountCents = Math.round(params.amount * 100);

  const piParams: Stripe.PaymentIntentCreateParams = {
    customer: params.customerId,
    amount: amountCents,
    currency: params.currency || "usd",
    metadata: params.metadata || {},
    automatic_payment_methods: { enabled: true },
  };

  if (params.stripeConnectAccountId) {
    piParams.on_behalf_of = params.stripeConnectAccountId;
    piParams.transfer_data = { destination: params.stripeConnectAccountId };
    piParams.application_fee_amount = computeApplicationFee(amountCents);
  }

  if (params.paymentMethodId) {
    piParams.payment_method = params.paymentMethodId;
    piParams.confirm = true;
    piParams.off_session = true;
    piParams.automatic_payment_methods = undefined;
  }

  const paymentIntent = await stripe.paymentIntents.create(piParams);
  return {
    clientSecret: paymentIntent.client_secret!,
    paymentIntentId: paymentIntent.id,
    status: paymentIntent.status,
  };
}

export async function chargeInvoiceAutomatically(params: {
  customerId: string;
  amount: number;
  invoiceId: string;
  invoiceNumber: string;
  stripeConnectAccountId?: string | null;
}): Promise<{
  paymentIntentId: string;
  status: string;
  error?: string;
}> {
  const stripe = getStripe();

  const methods = await stripe.paymentMethods.list({
    customer: params.customerId,
    type: "card",
    limit: 1,
  });

  if (methods.data.length === 0) {
    return { paymentIntentId: "", status: "no_payment_method", error: "No payment method on file" };
  }

  const amountCents = Math.round(params.amount * 100);

  try {
    const piParams: Stripe.PaymentIntentCreateParams = {
      customer: params.customerId,
      amount: amountCents,
      currency: "usd",
      payment_method: methods.data[0].id,
      confirm: true,
      off_session: true,
      metadata: {
        invoiceId: params.invoiceId,
        invoiceNumber: params.invoiceNumber,
      },
    };

    if (params.stripeConnectAccountId) {
      piParams.on_behalf_of = params.stripeConnectAccountId;
      piParams.transfer_data = { destination: params.stripeConnectAccountId };
      piParams.application_fee_amount = computeApplicationFee(amountCents);
    }

    const pi = await stripe.paymentIntents.create(piParams);
    return { paymentIntentId: pi.id, status: pi.status };
  } catch (err: any) {
    return {
      paymentIntentId: err.raw?.payment_intent?.id || "",
      status: "failed",
      error: err.message,
    };
  }
}

export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
  endpointSecret: string
): Stripe.Event {
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(payload, signature, endpointSecret);
}

export async function createCheckoutSession(params: {
  customerId: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  successUrl: string;
  cancelUrl: string;
  tipAmount?: string;
  stripeConnectAccountId?: string | null;
  tenantId?: string;
}): Promise<{ url: string; sessionId: string }> {
  const stripe = getStripe();
  const amountCents = Math.round(params.amount * 100);

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    customer: params.customerId,
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: `Invoice ${params.invoiceNumber}`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      invoiceId: params.invoiceId,
      invoiceNumber: params.invoiceNumber,
      tipAmount: params.tipAmount || "0",
      ...(params.tenantId ? { tenant_id: params.tenantId } : {}),
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  };

  if (params.stripeConnectAccountId) {
    sessionParams.payment_intent_data = {
      on_behalf_of: params.stripeConnectAccountId,
      transfer_data: { destination: params.stripeConnectAccountId },
      application_fee_amount: computeApplicationFee(amountCents),
    };
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  return { url: session.url!, sessionId: session.id };
}

export async function detachPaymentMethod(paymentMethodId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.paymentMethods.detach(paymentMethodId);
}

export async function createConnectAccount(
  companyId: string,
  companyName: string,
  email: string
): Promise<string> {
  const stripe = getStripe();
  const account = await stripe.accounts.create({
    type: "express",
    email,
    business_profile: {
      name: companyName,
    },
    metadata: {
      companyId,
    },
  });
  return account.id;
}

export async function createConnectAccountLink(
  accountId: string,
  refreshUrl: string,
  returnUrl: string
): Promise<string> {
  const stripe = getStripe();
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
  return accountLink.url;
}

export async function getConnectAccountStatus(accountId: string): Promise<{
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
}> {
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(accountId);
  return {
    chargesEnabled: account.charges_enabled ?? false,
    detailsSubmitted: account.details_submitted ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
  };
}

export async function createConnectLoginLink(accountId: string): Promise<string> {
  const stripe = getStripe();
  const loginLink = await stripe.accounts.createLoginLink(accountId);
  return loginLink.url;
}

export async function createSubscriptionCheckout(params: {
  customerEmail: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  trialDays?: number;
  metadata?: Record<string, string>;
  customerId?: string;
}): Promise<{ url: string; sessionId: string }> {
  const stripe = getStripe();
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: params.metadata || {},
  };
  if (params.customerId) {
    sessionParams.customer = params.customerId;
  } else {
    sessionParams.customer_email = params.customerEmail;
  }
  if (params.trialDays && params.trialDays > 0) {
    sessionParams.subscription_data = {
      trial_period_days: params.trialDays,
      metadata: params.metadata || {},
    };
  } else {
    sessionParams.subscription_data = { metadata: params.metadata || {} };
  }
  const session = await stripe.checkout.sessions.create(sessionParams);
  return { url: session.url!, sessionId: session.id };
}

export async function createCustomerPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
  });
  return session.url;
}

export async function createUsageRecord(subscriptionItemId: string, quantity: number, timestamp?: number, action: "increment" | "set" = "increment"): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptionItems.createUsageRecord(subscriptionItemId, {
    quantity,
    timestamp: timestamp || Math.floor(Date.now() / 1000),
    action,
  });
}

export async function reportMeteredUsageSet(stripeSubscriptionId: string, eventType: string, quantity: number): Promise<void> {
  if (!isStripeConfigured() || !stripeSubscriptionId) return;
  try {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const meteredItem = subscription.items.data.find(item => {
      const price = item.price;
      const lookupKey = price.lookup_key || price.nickname || "";
      if (eventType === "user_seat" && (lookupKey.toLowerCase().includes("seat") || lookupKey.toLowerCase().includes("user"))) return true;
      return false;
    });
    if (meteredItem) {
      await createUsageRecord(meteredItem.id, quantity, undefined, "set");
      console.log(`[Stripe Usage] Set ${eventType} to ${quantity} on subscription item ${meteredItem.id}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Stripe Usage] Failed to set ${eventType}: ${message}`);
  }
}

const REQUIRED_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "account.updated",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.trial_will_end",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
];

const REQUIRED_PRICE_VARS = [
  "STRIPE_PRICE_TIER_1",
  "STRIPE_PRICE_TIER_1_3",
  "STRIPE_PRICE_TIER_3_5",
  "STRIPE_PRICE_TIER_6_10",
  "STRIPE_PRICE_TIER_10_PLUS",
];

let cachedStripePrices: Record<string, number> | null = null;
let lastPriceFetchAttempt = 0;
const PRICE_FETCH_RETRY_MS = 5 * 60 * 1000;

export function validateStripeConfig(): void {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("[Stripe Config] Startup validation");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.warn("[Stripe Config] ⚠ STRIPE_SECRET_KEY is NOT set — Stripe features disabled");
  } else {
    const mode = secretKey.startsWith("sk_live_") ? "LIVE" : secretKey.startsWith("sk_test_") ? "TEST" : "UNKNOWN";
    console.log(`[Stripe Config] ✓ STRIPE_SECRET_KEY present — running in ${mode} mode`);
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.warn("[Stripe Config] ⚠ STRIPE_WEBHOOK_SECRET is NOT set — webhook events will be rejected");
  } else {
    console.log("[Stripe Config] ✓ STRIPE_WEBHOOK_SECRET present");
  }

  const missingPrices: string[] = [];
  const presentPrices: string[] = [];
  for (const envVar of REQUIRED_PRICE_VARS) {
    if (process.env[envVar]) {
      presentPrices.push(envVar);
    } else {
      missingPrices.push(envVar);
    }
  }

  if (presentPrices.length > 0) {
    console.log(`[Stripe Config] ✓ ${presentPrices.length}/${REQUIRED_PRICE_VARS.length} price tier env vars set`);
  }
  if (missingPrices.length > 0) {
    console.warn(`[Stripe Config] ⚠ Missing price tier env vars: ${missingPrices.join(", ")}`);
  }

  const voicePriceVars = [
    "STRIPE_PRICE_VOICE_STARTER",
    "STRIPE_PRICE_VOICE_PRO",
  ];
  const missingVoice = voicePriceVars.filter(v => !process.env[v]);
  const presentVoice = voicePriceVars.filter(v => !!process.env[v]);
  if (presentVoice.length > 0) {
    console.log(`[Stripe Config] ✓ ${presentVoice.length}/${voicePriceVars.length} voice plan price env vars set`);
  }
  if (missingVoice.length > 0) {
    console.warn(`[Stripe Config] ⚠ Missing voice plan price env vars: ${missingVoice.join(", ")}`);
  }

  const voiceCouponVars = [
    "STRIPE_COUPON_VOICE_STARTER_SUBSCRIBER",
    "STRIPE_COUPON_VOICE_PRO_SUBSCRIBER",
  ];
  const missingCoupons = voiceCouponVars.filter(v => !process.env[v]);
  const presentCoupons = voiceCouponVars.filter(v => !!process.env[v]);
  if (presentCoupons.length > 0) {
    console.log(`[Stripe Config] ✓ ${presentCoupons.length}/${voiceCouponVars.length} voice subscriber coupon env vars set`);
  }
  if (missingCoupons.length > 0) {
    console.warn(`[Stripe Config] ⚠ Missing voice subscriber coupon env vars: ${missingCoupons.join(", ")}`);
  }

  console.log("[Stripe Config] Required webhook events for your Stripe dashboard:");
  for (const event of REQUIRED_WEBHOOK_EVENTS) {
    console.log(`[Stripe Config]   • ${event}`);
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  console.log("[Telnyx Config] Startup validation");
  const telnyxVars = ["TELNYX_API_KEY", "TELNYX_PHONE_NUMBER", "TELNYX_MESSAGING_PROFILE_ID"];
  const presentTelnyx = telnyxVars.filter(v => !!process.env[v]);
  const missingTelnyx = telnyxVars.filter(v => !process.env[v]);
  if (presentTelnyx.length === telnyxVars.length) {
    console.log(`[Telnyx Config] ✓ All ${telnyxVars.length} Telnyx env vars set (used as fallback for per-company config)`);
  } else if (presentTelnyx.length > 0) {
    console.log(`[Telnyx Config] ✓ ${presentTelnyx.length}/${telnyxVars.length} Telnyx env vars set`);
    console.log(`[Telnyx Config] ℹ Missing: ${missingTelnyx.join(", ")} — per-company config required in Settings for these`);
  } else {
    console.log("[Telnyx Config] ℹ No Telnyx env vars set — per-company config required in Settings");
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

}

export async function fetchStripePrices(): Promise<Record<string, number>> {
  if (cachedStripePrices) return cachedStripePrices;

  if (Date.now() - lastPriceFetchAttempt < PRICE_FETCH_RETRY_MS) {
    return {};
  }
  lastPriceFetchAttempt = Date.now();

  const prices: Record<string, number> = {};
  if (!isStripeConfigured()) return prices;

  const tierToEnv: Record<string, string> = {
    tier_1: "STRIPE_PRICE_TIER_1",
    tier_1_3: "STRIPE_PRICE_TIER_1_3",
    tier_3_5: "STRIPE_PRICE_TIER_3_5",
    tier_6_10: "STRIPE_PRICE_TIER_6_10",
    tier_10_plus: "STRIPE_PRICE_TIER_10_PLUS",
  };

  try {
    const stripe = getStripe();
    for (const [tier, envVar] of Object.entries(tierToEnv)) {
      const priceId = process.env[envVar];
      if (!priceId) continue;
      try {
        const price = await stripe.prices.retrieve(priceId);
        if (price.unit_amount !== null) {
          prices[tier] = price.unit_amount / 100;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Stripe Prices] Failed to fetch price for ${tier} (${priceId}): ${message}`);
      }
    }
    if (Object.keys(prices).length > 0) {
      cachedStripePrices = prices;
      console.log(`[Stripe Prices] Cached ${Object.keys(prices).length} tier prices from Stripe`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Stripe Prices] Failed to fetch prices: ${message}`);
  }

  return prices;
}

export function getCachedStripePrices(): Record<string, number> | null {
  return cachedStripePrices;
}

export async function createVoicePlanCheckout(params: {
  tenantId: string;
  voicePlan: "voice_starter" | "voice_pro";
  priceId: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  customerId?: string;
  couponId?: string;
}): Promise<{ url: string; sessionId: string }> {
  const stripe = getStripe();
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    custom_fields: [
      {
        key: "preferred_area_code",
        label: { type: "custom", custom: "Preferred Area Code" },
        type: "text",
        optional: true,
        text: { maximum_length: 3, minimum_length: 3 },
      },
      {
        key: "business_website",
        label: { type: "custom", custom: "Business Website (for AI training)" },
        type: "text",
        optional: true,
      },
    ],
    metadata: {
      tenant_id: params.tenantId,
      voice_plan: params.voicePlan,
      checkout_type: "voice_addon",
    },
    subscription_data: {
      metadata: {
        tenant_id: params.tenantId,
        voice_plan: params.voicePlan,
        checkout_type: "voice_addon",
      },
    },
  };
  if (params.couponId) {
    sessionParams.discounts = [{ coupon: params.couponId }];
  }
  if (params.customerId) {
    sessionParams.customer = params.customerId;
  } else {
    sessionParams.customer_email = params.customerEmail;
  }
  const session = await stripe.checkout.sessions.create(sessionParams);
  return { url: session.url!, sessionId: session.id };
}

export async function reportMeteredUsage(stripeSubscriptionId: string, eventType: string, quantity: number): Promise<void> {
  if (!isStripeConfigured() || !stripeSubscriptionId) return;
  try {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const meteredItem = subscription.items.data.find(item => {
      const price = item.price;
      const lookupKey = price.lookup_key || price.nickname || "";
      if (eventType === "sms_segment" && lookupKey.toLowerCase().includes("sms")) return true;
      if (eventType === "voice_minute" && lookupKey.toLowerCase().includes("voice")) return true;
      if (eventType === "user_seat" && (lookupKey.toLowerCase().includes("seat") || lookupKey.toLowerCase().includes("user"))) return true;
      return false;
    });
    if (meteredItem) {
      await createUsageRecord(meteredItem.id, quantity);
      console.log(`[Stripe Usage] Reported ${quantity} ${eventType} to subscription item ${meteredItem.id}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Stripe Usage] Failed to report ${eventType}: ${message}`);
  }
}
