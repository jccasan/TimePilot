/**
 * Stripe Connect V2 Service
 *
 * All calls use a `new Stripe(key)` client instance pattern (never the legacy
 * global approach).  Every function includes detailed inline comments that
 * explain what is happening and why.
 *
 * Required environment variables (set in Replit Secrets):
 *   STRIPE_SECRET_KEY              – your platform's Stripe secret key
 *   STRIPE_CONNECT_WEBHOOK_SECRET  – webhook signing secret for the V2 thin-event endpoint
 *   STRIPE_V1_WEBHOOK_SECRET       – webhook signing secret for the V1 subscription endpoint
 *   CONNECT_PLATFORM_PRICE_ID      – price ID for the platform subscription plan
 *                                    (create one in your Stripe Dashboard under Products)
 *   CONNECT_APP_FEE_PERCENT        – optional integer, e.g. "5" = 5% application fee
 *
 * Stripe CLI listener commands (for local testing only – not needed in production):
 *   V2 thin events:
 *     stripe listen --forward-to localhost:5000/api/webhooks/stripe-connect-v2 \
 *       --events "v2.core.account[requirements].updated,v2.core.account[configuration.merchant].capability_status_updated"
 *
 *   V1 subscription events:
 *     stripe listen --forward-to localhost:5000/api/webhooks/stripe-v1-subscriptions \
 *       --events "customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.payment_succeeded,invoice.payment_failed"
 */

import Stripe from "stripe";

// ---------------------------------------------------------------------------
// V2 API type wrappers
// We use explicit interfaces instead of `any` to describe V2 response shapes
// that are not yet in the Stripe TypeScript declarations.
// ---------------------------------------------------------------------------

interface V2AccountCapabilityStatus {
  status: string;
}

interface V2AccountCapabilities {
  card_payments?: V2AccountCapabilityStatus;
}

interface V2AccountMerchantConfig {
  capabilities?: V2AccountCapabilities;
}

interface V2AccountConfiguration {
  merchant?: V2AccountMerchantConfig;
}

interface V2AccountRequirements {
  summary?: string;
}

interface V2Account {
  id: string;
  display_name?: string;
  contact_email?: string;
  configuration?: V2AccountConfiguration;
  requirements?: V2AccountRequirements;
}

interface V2AccountLink {
  url: string;
}

interface V2Event {
  id: string;
  type: string;
  data?: {
    id?: string;
    account?: string;
    capability?: string;
    status?: string;
    requirements?: { summary?: string };
  };
}

// Typed wrapper for accessing V2 APIs that are not yet in @types/stripe.
// We intentionally do NOT extend Stripe because the Stripe class declares its
// own v2 property type, causing TS conflicts. Instead we use a standalone
// interface that describes only the V2 surface we call.
interface V2CoreAccounts {
  create(params: V2AccountCreateParams): Promise<V2Account>;
  retrieve(id: string, params?: Record<string, unknown>): Promise<V2Account>;
}

interface V2CoreAccountLinks {
  create(params: V2AccountLinkCreateParams): Promise<V2AccountLink>;
}

interface V2CoreEvents {
  retrieve(id: string): Promise<V2Event>;
}

interface V2CoreNamespace {
  accounts: V2CoreAccounts;
  accountLinks: V2CoreAccountLinks;
  events: V2CoreEvents;
}

interface StripeWithV2 {
  // V1 surface re-exposed so callers can use stripe.checkout, stripe.prices, etc.
  checkout: Stripe["checkout"];
  prices: Stripe["prices"];
  products: Stripe["products"];
  subscriptions: Stripe["subscriptions"];
  billingPortal: Stripe["billingPortal"];
  webhooks: Stripe["webhooks"];
  parseThinEvent(rawBody: string | Buffer, signature: string, secret: string): { id: string; type: string };
  v2: {
    core: V2CoreNamespace;
  };
}

interface V2AccountDefaultsResponsibilities {
  fees_collector: string;
  losses_collector: string;
}

interface V2AccountDefaults {
  responsibilities: V2AccountDefaultsResponsibilities;
}

interface V2AccountMerchantConfigCreate {
  capabilities: {
    card_payments: { requested: boolean };
  };
}

interface V2AccountConfigurationCreate {
  merchant: V2AccountMerchantConfigCreate;
  // customer config is required when the account_onboarding configurations
  // list includes "customer" (which it does in createV2AccountLink).
  customer?: Record<string, never>;
}

interface V2AccountCreateParams {
  display_name: string;
  contact_email: string;
  identity: { country: string };
  dashboard: string;
  defaults: V2AccountDefaults;
  configuration: V2AccountConfigurationCreate;
}

interface V2AccountLinkCreateParams {
  account: string;
  use_case: {
    type: string;
    account_onboarding: {
      // configurations is an array of configuration names to include in the
      // onboarding flow (e.g., "merchant", "customer").
      configurations: string[];
      // return_url and refresh_url are nested here (not at the top level)
      // so Stripe knows where to redirect after onboarding completes or expires.
      return_url: string;
      refresh_url: string;
    };
  };
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Returns a Stripe client instance authenticated with the platform secret key.
 * We instantiate a new client each call rather than caching so that tests and
 * hot-reloads pick up env var changes automatically.
 */
function getStripeClient(): StripeWithV2 {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    // Fail loudly – callers should check isStripeConfigured() before calling.
    throw new Error(
      "[stripe-connect-v2] STRIPE_SECRET_KEY is not set. " +
      "Add it to your Replit Secrets before using Stripe Connect V2 features."
    );
  }
  // Use the basil API version which supports the V2 Connect APIs.
  // The apiVersion string is cast to satisfy the package's type declaration
  // (the installed @types/stripe declares a newer version constant) while
  // keeping our runtime behaviour unchanged – the same pattern used throughout
  // the existing server/services/stripe.ts module.
  return new Stripe(key, { apiVersion: "2025-04-30.basil" as Stripe.LatestApiVersion }) as unknown as StripeWithV2;
}

/** Application fee percentage charged by the platform on every direct charge. */
function getAppFeePercent(): number {
  const raw = process.env.CONNECT_APP_FEE_PERCENT;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  // Default to 5 % if not configured or invalid.
  return Number.isFinite(parsed) ? parsed : 5;
}

function computeAppFee(amountCents: number): number {
  return Math.round(amountCents * (getAppFeePercent() / 100));
}

// ---------------------------------------------------------------------------
// Account management
// ---------------------------------------------------------------------------

/**
 * Creates a new V2 connected account.
 *
 * V2 accounts do NOT use `type: 'express'` or `type: 'standard'`.  Instead
 * capabilities, country, and dashboard access are specified via the
 * `configuration` and `identity` parameters.
 *
 * @returns The new Stripe account ID (e.g. "acct_xxx").
 */
export async function createV2ConnectedAccount(params: {
  displayName: string;
  contactEmail: string;
  country: string;
}): Promise<string> {
  const client = getStripeClient();

  const account = await client.v2.core.accounts.create({
    display_name: params.displayName,
    contact_email: params.contactEmail,
    identity: {
      // Country where the account holder is incorporated / operating.
      country: params.country,
    },
    // Full dashboard access lets the connected account log in to their own
    // Stripe dashboard and manage their own settings.
    dashboard: "full",
    defaults: {
      // The platform collects fees and absorbs losses for connected accounts
      // in the standard Connect setup.
      responsibilities: {
        fees_collector: "stripe",
        losses_collector: "stripe",
      },
    },
    configuration: {
      merchant: {
        // Request card_payments capability up-front.  Stripe may require
        // additional information before activating it (handled via onboarding).
        capabilities: {
          card_payments: { requested: true },
        },
      },
      // customer config is included so the account onboarding flow can
      // cover both merchant and customer configurations (see createV2AccountLink).
      customer: {},
    },
  });

  return account.id;
}

/**
 * Generates a hosted onboarding link for a V2 connected account.
 *
 * The connected account owner visits this URL to complete Stripe's
 * Know-Your-Customer (KYC) process and satisfy any outstanding requirements.
 * The URL expires after ~1 hour and is single-use.
 *
 * @returns The URL to redirect or display to the user.
 */
export async function createV2AccountLink(params: {
  accountId: string;
  returnUrl: string;
  refreshUrl: string;
}): Promise<string> {
  const client = getStripeClient();

  const link = await client.v2.core.accountLinks.create({
    account: params.accountId,
    // use_case.type must be "account_onboarding" for onboarding flows.
    // configurations is the list of configuration types to include in the flow
    // (e.g. "merchant" for payment acceptance, "customer" for tax/billing).
    // return_url and refresh_url are nested inside account_onboarding so Stripe
    // knows where to redirect after completion or on link expiry.
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["merchant", "customer"],
        return_url: params.returnUrl,
        refresh_url: params.refreshUrl,
      },
    },
  });

  return link.url;
}

/**
 * Retrieves the live onboarding / capability status for a V2 account directly
 * from the Stripe API (not from the database).
 *
 * We check:
 *   - configuration.merchant.capabilities.card_payments.status  → "active" | "inactive" | etc.
 *   - requirements.summary  → whether there are outstanding requirements.
 */
export async function getV2AccountStatus(accountId: string): Promise<{
  cardPaymentsStatus: string;
  requirementsSummary: string;
  displayName: string;
  email: string | null;
}> {
  const client = getStripeClient();

  // Retrieve the full V2 account object, explicitly requesting configuration
  // and requirements sub-resources. Without include, some API versions return
  // these fields only partially or not at all.
  const account = await client.v2.core.accounts.retrieve(accountId, {
    include: [
      "configuration.merchant.capabilities",
      "requirements",
    ],
  } as Record<string, unknown>);

  const cardPaymentsStatus =
    account?.configuration?.merchant?.capabilities?.card_payments?.status ?? "inactive";

  const requirementsSummary =
    account?.requirements?.summary ?? "none";

  return {
    cardPaymentsStatus,
    requirementsSummary,
    displayName: account.display_name ?? "",
    email: account.contact_email ?? null,
  };
}

// ---------------------------------------------------------------------------
// Product / price management on connected accounts
// ---------------------------------------------------------------------------

/**
 * Creates a Stripe Product + Price on a connected account, setting the new
 * price as the product's `default_price` so the storefront can always find
 * a purchasable price by reading `product.default_price`.
 *
 * We use the `stripeAccount` option (passed as a request header by the Stripe
 * Node library) to scope the API call to the connected account instead of the
 * platform account.
 *
 * @returns An object containing the product ID and price ID.
 */
export async function createProductOnConnectedAccount(params: {
  connectedAccountId: string;
  name: string;
  description: string;
  priceCents: number;
  currency?: string;
}): Promise<{ productId: string; priceId: string }> {
  const client = getStripeClient();

  // Step 1 – Create the product on the connected account using inline
  // default_price_data.  This atomically sets the default_price so the
  // storefront listing always has a non-null priceId.
  const product = await client.products.create(
    {
      name: params.name,
      description: params.description || undefined,
      active: true,
      default_price_data: {
        unit_amount: params.priceCents,
        currency: params.currency ?? "usd",
      },
    },
    // This header tells Stripe to act on behalf of the connected account.
    { stripeAccount: params.connectedAccountId }
  );

  // The default_price field is populated because we used default_price_data.
  // It can be a string ID or an expanded Price object depending on the request.
  const priceId = typeof product.default_price === "string"
    ? product.default_price
    : product.default_price?.id ?? "";

  return { productId: product.id, priceId };
}

/**
 * Lists active products (with their default prices) on a connected account.
 * Each product is enriched with price information so the storefront can
 * display pricing without making a separate API call.
 *
 * We expand default_price so we get price details (unit_amount, currency)
 * in a single request.
 */
export async function listProductsOnConnectedAccount(
  connectedAccountId: string
): Promise<
  {
    productId: string;
    name: string;
    description: string | null;
    priceId: string | null;
    priceCents: number | null;
    currency: string | null;
  }[]
> {
  const client = getStripeClient();

  // Retrieve the first 100 active products, expanding default_price so we
  // avoid a round-trip per product to get pricing data.
  const products = await client.products.list(
    { active: true, limit: 100, expand: ["data.default_price"] },
    { stripeAccount: connectedAccountId }
  );

  return products.data.map((p) => {
    const dp = p.default_price as Stripe.Price | null;
    return {
      productId: p.id,
      name: p.name,
      description: p.description,
      priceId: dp?.id ?? null,
      priceCents: dp?.unit_amount ?? null,
      currency: dp?.currency ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Hosted Checkout – direct charges
// ---------------------------------------------------------------------------

/**
 * Retrieves a Price object from a connected account and validates it is active.
 *
 * This is used server-side before creating a Checkout session so we compute
 * the application fee from the authoritative Stripe price amount, not from
 * client-supplied data (which could be manipulated to reduce platform fees).
 *
 * @throws if the price does not exist on the connected account, is inactive,
 *         or has a null unit_amount (e.g., custom / tiered pricing).
 */
export async function retrieveConnectedAccountPrice(
  connectedAccountId: string,
  priceId: string
): Promise<{ priceCents: number; currency: string }> {
  const client = getStripeClient();

  // Retrieve the price directly from the connected account.
  const price = await client.prices.retrieve(
    priceId,
    {},
    { stripeAccount: connectedAccountId }
  );

  if (!price.active) {
    throw new Error(`Price ${priceId} is not active on account ${connectedAccountId}`);
  }

  if (price.unit_amount === null || price.unit_amount === undefined) {
    throw new Error(
      `Price ${priceId} has no unit_amount (custom/tiered pricing not supported for storefront).`
    );
  }

  return { priceCents: price.unit_amount, currency: price.currency };
}

/**
 * Creates a hosted Checkout session for a customer to purchase a product on a
 * connected account via a **direct charge**.
 *
 * Direct charge model:
 *   - The charge appears on the connected account's Stripe dashboard.
 *   - The platform collects an application_fee_amount.
 *   - The connected account must have card_payments capability active.
 *
 * The application fee is computed server-side from the authoritative Stripe
 * price object — never from client-supplied data — to prevent fee tampering.
 *
 * IMPORTANT: In production, replace `:accountId` in the storefront URL with a
 * slug or opaque identifier rather than exposing the raw Stripe account ID.
 *
 * @returns The Checkout session URL.
 */
export async function createStorefrontCheckout(params: {
  connectedAccountId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}): Promise<{ url: string; sessionId: string }> {
  const client = getStripeClient();

  // Retrieve the price server-side to get the authoritative amount.
  // This prevents clients from supplying a manipulated priceCents value
  // that would reduce the platform's application_fee_amount.
  const { priceCents } = await retrieveConnectedAccountPrice(
    params.connectedAccountId,
    params.priceId
  );

  // Compute the application fee from the server-authoritative price amount.
  const applicationFeeAmount = computeAppFee(priceCents);

  // The checkout session is created ON the connected account (via stripeAccount
  // header) so the charge flows directly to them.
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [{ price: params.priceId, quantity: 1 }],
    // The application_fee_amount is deducted before the funds reach the
    // connected account and held by the platform.
    payment_intent_data: {
      application_fee_amount: applicationFeeAmount,
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    ...(params.customerEmail ? { customer_email: params.customerEmail } : {}),
  };

  // Create the session on the connected account.
  const session = await client.checkout.sessions.create(
    sessionParams,
    { stripeAccount: params.connectedAccountId }
  );

  return { url: session.url!, sessionId: session.id };
}

// ---------------------------------------------------------------------------
// Platform subscription for connected accounts
// ---------------------------------------------------------------------------

/**
 * Creates a platform subscription Checkout session for a connected account.
 *
 * We use `customer_account` (not `customer`) to link the subscription to the
 * connected account as the subscriber.  This requires the V2-capable API.
 *
 * The price ID comes from the CONNECT_PLATFORM_PRICE_ID environment variable.
 * Create the plan product + price in your Stripe Dashboard and paste the
 * price_xxx ID into Replit Secrets as CONNECT_PLATFORM_PRICE_ID.
 */
export async function createPlatformSubscriptionCheckout(params: {
  connectedAccountId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string }> {
  const client = getStripeClient();

  const priceId = process.env.CONNECT_PLATFORM_PRICE_ID;
  if (!priceId) {
    throw new Error(
      "[stripe-connect-v2] CONNECT_PLATFORM_PRICE_ID is not set. " +
      "Create a subscription product in your Stripe Dashboard and add its " +
      "price ID to Replit Secrets as CONNECT_PLATFORM_PRICE_ID."
    );
  }

  // The session is created on the PLATFORM account (no stripeAccount header).
  // `customer_account` links the subscription to the connected Stripe account,
  // not a regular customer object.  Available in the 2025-04-30.basil API.
  // We pass the extra field via object spread so TypeScript does not complain
  // about a field not yet in the SDK declarations.
  const baseParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: {
      connected_account_id: params.connectedAccountId,
      subscription_type: "platform_connect_v2",
    },
  };

  const sessionParamsWithAccountField = {
    ...baseParams,
    // customer_account is a V2 field not yet in @types/stripe.
    customer_account: params.connectedAccountId,
  };

  const session = await client.checkout.sessions.create(sessionParamsWithAccountField as Stripe.Checkout.SessionCreateParams);

  return { url: session.url!, sessionId: session.id };
}

/**
 * Creates a Billing Portal session so a connected account can manage their
 * platform subscription (cancel, update payment method, view invoices, etc.).
 *
 * The portal is opened on the PLATFORM account; `customer_account` tells
 * Stripe which connected account is the customer.
 */
export async function createConnectedAccountPortalSession(params: {
  connectedAccountId: string;
  returnUrl: string;
}): Promise<string> {
  const client = getStripeClient();

  // customer_account is a V2 field not yet in @types/stripe.
  const portalParams = {
    customer_account: params.connectedAccountId,
    return_url: params.returnUrl,
  };

  const session = await client.billingPortal.sessions.create(
    portalParams as Stripe.BillingPortal.SessionCreateParams
  );

  return session.url;
}

// ---------------------------------------------------------------------------
// Webhook helpers
// ---------------------------------------------------------------------------

/**
 * Verifies and parses a V2 thin-event webhook payload.
 *
 * V2 thin events contain only the event ID and type; you must call
 * `client.v2.core.events.retrieve(id)` to get the full event data.
 *
 * Dashboard setup instructions:
 *   1. Go to Stripe Dashboard → Developers → Webhooks → Add endpoint.
 *   2. Set the endpoint URL to https://<your-domain>/api/webhooks/stripe-connect-v2
 *   3. Select "V2 events" and subscribe to:
 *        v2.core.account[requirements].updated
 *        v2.core.account[configuration.merchant].capability_status_updated
 *   4. Copy the signing secret into Replit Secrets as STRIPE_CONNECT_WEBHOOK_SECRET.
 */
export function parseV2ThinEvent(
  rawBody: string | Buffer,
  signature: string
): { id: string; type: string } {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "[stripe-connect-v2] STRIPE_CONNECT_WEBHOOK_SECRET is not set. " +
      "Copy the signing secret from your Stripe Dashboard webhook endpoint " +
      "and add it to Replit Secrets."
    );
  }

  const client = getStripeClient();

  // parseThinEvent validates the Stripe-Signature header and returns the
  // event metadata without the full payload (thin event pattern).
  const thinEvent = client.parseThinEvent(rawBody, signature, secret);
  return { id: thinEvent.id, type: thinEvent.type };
}

/**
 * Retrieves the full V2 event data for a thin event ID.
 * Call this after parseV2ThinEvent to get the complete event payload.
 */
export async function retrieveV2Event(eventId: string): Promise<V2Event> {
  const client = getStripeClient();
  return client.v2.core.events.retrieve(eventId);
}

/**
 * Verifies and constructs a V1 webhook event.
 * Used for subscription lifecycle events from the standard Stripe webhook.
 *
 * Dashboard setup instructions:
 *   1. Go to Stripe Dashboard → Developers → Webhooks → Add endpoint.
 *   2. Set the endpoint URL to https://<your-domain>/api/webhooks/stripe-v1-subscriptions
 *   3. Subscribe to:
 *        customer.subscription.created
 *        customer.subscription.updated
 *        customer.subscription.deleted
 *        invoice.payment_succeeded
 *        invoice.payment_failed
 *   4. Copy the signing secret into Replit Secrets as STRIPE_V1_WEBHOOK_SECRET.
 */
export function constructV1WebhookEvent(
  rawBody: string | Buffer,
  signature: string
): Stripe.Event {
  const secret = process.env.STRIPE_V1_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "[stripe-connect-v2] STRIPE_V1_WEBHOOK_SECRET is not set. " +
      "Copy the signing secret from your V1 subscription webhook endpoint " +
      "and add it to Replit Secrets."
    );
  }
  const client = getStripeClient();
  return client.webhooks.constructEvent(rawBody, signature, secret);
}
