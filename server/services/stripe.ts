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

export async function createPaymentIntent(params: {
  customerId: string;
  amount: number;
  currency?: string;
  metadata?: Record<string, string>;
  paymentMethodId?: string;
}): Promise<{
  clientSecret: string;
  paymentIntentId: string;
  status: string;
}> {
  const stripe = getStripe();

  const piParams: Stripe.PaymentIntentCreateParams = {
    customer: params.customerId,
    amount: Math.round(params.amount * 100),
    currency: params.currency || "usd",
    metadata: params.metadata || {},
    automatic_payment_methods: { enabled: true },
  };

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

  try {
    const pi = await stripe.paymentIntents.create({
      customer: params.customerId,
      amount: Math.round(params.amount * 100),
      currency: "usd",
      payment_method: methods.data[0].id,
      confirm: true,
      off_session: true,
      metadata: {
        invoiceId: params.invoiceId,
        invoiceNumber: params.invoiceNumber,
      },
    });
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
}): Promise<{ url: string; sessionId: string }> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    customer: params.customerId,
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: Math.round(params.amount * 100),
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
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
  return { url: session.url!, sessionId: session.id };
}

export async function detachPaymentMethod(paymentMethodId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.paymentMethods.detach(paymentMethodId);
}
