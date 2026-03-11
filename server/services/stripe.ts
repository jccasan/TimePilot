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

const PLATFORM_FEE_PERCENT = 2.9;

function computeApplicationFee(amountCents: number): number {
  return Math.round(amountCents * (PLATFORM_FEE_PERCENT / 100));
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
}): Promise<{ url: string; sessionId: string }> {
  const stripe = getStripe();
  const amountCents = Math.round(params.amount * 100);

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    customer: params.customerId,
    payment_method_types: ["card"],
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
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  };

  if (params.stripeConnectAccountId) {
    sessionParams.payment_intent_data = {
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
