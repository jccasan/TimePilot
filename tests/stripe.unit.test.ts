import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Stripe SDK mock ---
// We build a flexible mock that records every call made so tests can assert
// that reqOpts() never passes an empty {} as the second argument.

const mockCustomerCreate = vi.fn();
const mockCustomerRetrieve = vi.fn();
const mockPaymentMethodsList = vi.fn();
const mockPaymentMethodsDetach = vi.fn();
const mockPaymentIntentsCreate = vi.fn();
const mockPaymentIntentsRetrieve = vi.fn();
const mockSetupIntentsCreate = vi.fn();
const mockCheckoutSessionsCreate = vi.fn();

vi.mock("stripe", () => {
  function MockStripe() {
    return {
      customers: {
        create: mockCustomerCreate,
        retrieve: mockCustomerRetrieve,
      },
      paymentMethods: {
        list: mockPaymentMethodsList,
        detach: mockPaymentMethodsDetach,
        create: vi.fn(),
        attach: vi.fn(),
      },
      paymentIntents: {
        create: mockPaymentIntentsCreate,
        retrieve: mockPaymentIntentsRetrieve,
      },
      setupIntents: { create: mockSetupIntentsCreate },
      accounts: { create: vi.fn(), retrieve: vi.fn(), createLoginLink: vi.fn() },
      accountLinks: { create: vi.fn() },
      checkout: { sessions: { create: mockCheckoutSessionsCreate } },
      webhooks: { constructEvent: vi.fn() },
      billingPortal: { sessions: { create: vi.fn() } },
      billing: { meterEvents: { create: vi.fn() } },
      subscriptions: { retrieve: vi.fn() },
    };
  }
  return { default: MockStripe };
});

// Set the required env var so getStripe() doesn't throw
process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_unit_tests";

// Import AFTER mocks are registered
const {
  reqOpts,
  createStripeCustomer,
  createPaymentIntent,
  chargeInvoiceAutomatically,
  createSetupIntent,
  getCustomerPaymentMethods,
  createCheckoutSession,
  detachPaymentMethod,
  ensureConnectedCustomer,
  retrievePaymentIntentFees,
} = await import("../server/services/stripe.js");

// =============================================================================
// reqOpts() unit tests
// =============================================================================

describe("reqOpts()", () => {
  it("returns undefined when stripeAccount is undefined", () => {
    expect(reqOpts(undefined)).toBeUndefined();
  });

  it("returns undefined when stripeAccount is null", () => {
    expect(reqOpts(null)).toBeUndefined();
  });

  it("returns undefined when stripeAccount is an empty string", () => {
    expect(reqOpts("")).toBeUndefined();
  });

  it("returns { stripeAccount } when a non-empty account id is provided", () => {
    expect(reqOpts("acct_123abc")).toEqual({ stripeAccount: "acct_123abc" });
  });

  it("never returns an empty object {} — would crash SDK v20", () => {
    const result = reqOpts(undefined);
    // The crashing case: {} is not undefined and not a valid options hash
    expect(result).not.toEqual({});
  });
});

// =============================================================================
// createStripeCustomer() integration tests (Stripe SDK mocked)
// =============================================================================

describe("createStripeCustomer()", () => {
  beforeEach(() => {
    mockCustomerCreate.mockResolvedValue({ id: "cus_test123" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes undefined (not {}) as request options when no stripeAccount", async () => {
    await createStripeCustomer({ name: "John Doe" });

    expect(mockCustomerCreate).toHaveBeenCalledOnce();
    const [, opts] = mockCustomerCreate.mock.calls[0];
    expect(opts).toBeUndefined();
    expect(opts).not.toEqual({});
  });

  it("passes { stripeAccount } as request options when stripeAccount is provided", async () => {
    await createStripeCustomer({
      name: "Jane Doe",
      stripeAccount: "acct_abc",
    });

    const [, opts] = mockCustomerCreate.mock.calls[0];
    expect(opts).toEqual({ stripeAccount: "acct_abc" });
  });

  it("returns the Stripe customer id", async () => {
    const id = await createStripeCustomer({ name: "Test User" });
    expect(id).toBe("cus_test123");
  });

  it("passes undefined options when stripeAccount is null", async () => {
    await createStripeCustomer({ name: "Null Account", stripeAccount: null });

    const [, opts] = mockCustomerCreate.mock.calls[0];
    expect(opts).toBeUndefined();
  });
});

// =============================================================================
// createPaymentIntent() integration tests (Stripe SDK mocked)
// =============================================================================

describe("createPaymentIntent()", () => {
  beforeEach(() => {
    mockPaymentIntentsCreate.mockResolvedValue({
      id: "pi_test123",
      client_secret: "pi_test123_secret",
      status: "requires_payment_method",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes undefined (not {}) as request options when no stripeConnectAccountId", async () => {
    await createPaymentIntent({
      customerId: "cus_abc",
      amount: 100,
    });

    expect(mockPaymentIntentsCreate).toHaveBeenCalledOnce();
    const [, opts] = mockPaymentIntentsCreate.mock.calls[0];
    expect(opts).toBeUndefined();
    expect(opts).not.toEqual({});
  });

  it("passes { stripeAccount } as request options when stripeConnectAccountId is provided", async () => {
    await createPaymentIntent({
      customerId: "cus_abc",
      amount: 100,
      stripeConnectAccountId: "acct_connect",
    });

    const [, opts] = mockPaymentIntentsCreate.mock.calls[0];
    expect(opts).toEqual({ stripeAccount: "acct_connect" });
  });

  it("passes undefined options when stripeConnectAccountId is null", async () => {
    await createPaymentIntent({
      customerId: "cus_abc",
      amount: 50,
      stripeConnectAccountId: null,
    });

    const [, opts] = mockPaymentIntentsCreate.mock.calls[0];
    expect(opts).toBeUndefined();
  });

  it("includes application_fee_amount when stripeConnectAccountId is present", async () => {
    await createPaymentIntent({
      customerId: "cus_abc",
      amount: 100,
      stripeConnectAccountId: "acct_connect",
    });

    const [params] = mockPaymentIntentsCreate.mock.calls[0];
    expect(params.application_fee_amount).toBeGreaterThan(0);
  });

  it("does not include application_fee_amount when no connected account", async () => {
    await createPaymentIntent({
      customerId: "cus_abc",
      amount: 100,
    });

    const [params] = mockPaymentIntentsCreate.mock.calls[0];
    expect(params.application_fee_amount).toBeUndefined();
  });

  it("returns the paymentIntentId, clientSecret, and status", async () => {
    const result = await createPaymentIntent({
      customerId: "cus_abc",
      amount: 50,
    });
    expect(result.paymentIntentId).toBe("pi_test123");
    expect(result.clientSecret).toBe("pi_test123_secret");
    expect(result.status).toBe("requires_payment_method");
  });
});

// =============================================================================
// chargeInvoiceAutomatically() integration tests (Stripe SDK mocked)
// =============================================================================

describe("chargeInvoiceAutomatically()", () => {
  const fakePm = { id: "pm_card_visa" };

  beforeEach(() => {
    mockPaymentMethodsList.mockResolvedValue({ data: [fakePm] });
    mockPaymentIntentsCreate.mockResolvedValue({
      id: "pi_auto_123",
      client_secret: "pi_auto_secret",
      status: "succeeded",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes undefined (not {}) as request options to paymentMethods.list when no connected account", async () => {
    await chargeInvoiceAutomatically({
      customerId: "cus_abc",
      amount: 75,
      invoiceId: "inv_1",
      invoiceNumber: "INV-001",
    });

    expect(mockPaymentMethodsList).toHaveBeenCalledOnce();
    const [, opts] = mockPaymentMethodsList.mock.calls[0];
    expect(opts).toBeUndefined();
    expect(opts).not.toEqual({});
  });

  it("passes undefined (not {}) as request options to paymentIntents.create when no connected account", async () => {
    await chargeInvoiceAutomatically({
      customerId: "cus_abc",
      amount: 75,
      invoiceId: "inv_1",
      invoiceNumber: "INV-001",
    });

    expect(mockPaymentIntentsCreate).toHaveBeenCalledOnce();
    const [, opts] = mockPaymentIntentsCreate.mock.calls[0];
    expect(opts).toBeUndefined();
    expect(opts).not.toEqual({});
  });

  it("passes { stripeAccount } to both list and create when connected account is provided", async () => {
    await chargeInvoiceAutomatically({
      customerId: "cus_abc",
      amount: 75,
      invoiceId: "inv_1",
      invoiceNumber: "INV-001",
      stripeConnectAccountId: "acct_connect",
    });

    const [, listOpts] = mockPaymentMethodsList.mock.calls[0];
    expect(listOpts).toEqual({ stripeAccount: "acct_connect" });

    const [, createOpts] = mockPaymentIntentsCreate.mock.calls[0];
    expect(createOpts).toEqual({ stripeAccount: "acct_connect" });
  });

  it("returns no_payment_method status when customer has no cards on file", async () => {
    mockPaymentMethodsList.mockResolvedValue({ data: [] });

    const result = await chargeInvoiceAutomatically({
      customerId: "cus_abc",
      amount: 75,
      invoiceId: "inv_1",
      invoiceNumber: "INV-001",
    });

    expect(result.status).toBe("no_payment_method");
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("returns paymentIntentId and status on success", async () => {
    const result = await chargeInvoiceAutomatically({
      customerId: "cus_abc",
      amount: 75,
      invoiceId: "inv_1",
      invoiceNumber: "INV-001",
    });

    expect(result.paymentIntentId).toBe("pi_auto_123");
    expect(result.status).toBe("succeeded");
    expect(result.error).toBeUndefined();
  });

  it("returns failed status and error message when Stripe throws", async () => {
    mockPaymentIntentsCreate.mockRejectedValue(
      Object.assign(new Error("Card declined"), { raw: { payment_intent: { id: "pi_failed" } } })
    );

    const result = await chargeInvoiceAutomatically({
      customerId: "cus_abc",
      amount: 75,
      invoiceId: "inv_1",
      invoiceNumber: "INV-001",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Card declined");
    expect(result.paymentIntentId).toBe("pi_failed");
  });

  it("includes invoice metadata in the payment intent params", async () => {
    await chargeInvoiceAutomatically({
      customerId: "cus_abc",
      amount: 75,
      invoiceId: "inv_999",
      invoiceNumber: "INV-999",
      tenantId: "tenant_xyz",
    });

    const [params] = mockPaymentIntentsCreate.mock.calls[0];
    expect(params.metadata.invoiceId).toBe("inv_999");
    expect(params.metadata.invoiceNumber).toBe("INV-999");
    expect(params.metadata.tenant_id).toBe("tenant_xyz");
  });
});

// =============================================================================
// createSetupIntent() integration tests (Stripe SDK mocked)
// =============================================================================

describe("createSetupIntent()", () => {
  beforeEach(() => {
    mockSetupIntentsCreate.mockResolvedValue({
      id: "seti_test123",
      client_secret: "seti_test123_secret",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes undefined (not {}) as request options when no stripeAccount", async () => {
    await createSetupIntent("cus_abc");

    expect(mockSetupIntentsCreate).toHaveBeenCalledOnce();
    const [, opts] = mockSetupIntentsCreate.mock.calls[0];
    expect(opts).toBeUndefined();
    expect(opts).not.toEqual({});
  });

  it("passes { stripeAccount } as request options when stripeAccount is provided", async () => {
    await createSetupIntent("cus_abc", "acct_connect");

    const [, opts] = mockSetupIntentsCreate.mock.calls[0];
    expect(opts).toEqual({ stripeAccount: "acct_connect" });
  });

  it("passes undefined options when stripeAccount is null", async () => {
    await createSetupIntent("cus_abc", null);

    const [, opts] = mockSetupIntentsCreate.mock.calls[0];
    expect(opts).toBeUndefined();
  });

  it("returns the setupIntentId and clientSecret", async () => {
    const result = await createSetupIntent("cus_abc");
    expect(result.setupIntentId).toBe("seti_test123");
    expect(result.clientSecret).toBe("seti_test123_secret");
  });
});

// =============================================================================
// getCustomerPaymentMethods() integration tests (Stripe SDK mocked)
// =============================================================================

describe("getCustomerPaymentMethods()", () => {
  beforeEach(() => {
    mockPaymentMethodsList.mockResolvedValue({
      data: [
        {
          id: "pm_visa",
          card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2028 },
        },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes undefined (not {}) as request options when no stripeAccount", async () => {
    await getCustomerPaymentMethods("cus_abc");

    expect(mockPaymentMethodsList).toHaveBeenCalledOnce();
    const [, opts] = mockPaymentMethodsList.mock.calls[0];
    expect(opts).toBeUndefined();
    expect(opts).not.toEqual({});
  });

  it("passes { stripeAccount } as request options when stripeAccount is provided", async () => {
    await getCustomerPaymentMethods("cus_abc", "acct_connect");

    const [, opts] = mockPaymentMethodsList.mock.calls[0];
    expect(opts).toEqual({ stripeAccount: "acct_connect" });
  });

  it("passes undefined options when stripeAccount is null", async () => {
    await getCustomerPaymentMethods("cus_abc", null);

    const [, opts] = mockPaymentMethodsList.mock.calls[0];
    expect(opts).toBeUndefined();
  });

  it("returns mapped payment method data", async () => {
    const result = await getCustomerPaymentMethods("cus_abc");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("pm_visa");
    expect(result[0].brand).toBe("visa");
    expect(result[0].last4).toBe("4242");
  });
});

// =============================================================================
// createCheckoutSession() integration tests (Stripe SDK mocked)
// =============================================================================

describe("createCheckoutSession()", () => {
  const baseParams = {
    customerId: "cus_abc",
    invoiceId: "inv_1",
    invoiceNumber: "INV-001",
    amount: 100,
    successUrl: "https://example.com/success",
    cancelUrl: "https://example.com/cancel",
  };

  beforeEach(() => {
    mockCheckoutSessionsCreate.mockResolvedValue({
      id: "cs_test123",
      url: "https://checkout.stripe.com/pay/cs_test123",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes undefined (not {}) as request options when no stripeConnectAccountId", async () => {
    await createCheckoutSession(baseParams);

    expect(mockCheckoutSessionsCreate).toHaveBeenCalledOnce();
    const [, opts] = mockCheckoutSessionsCreate.mock.calls[0];
    expect(opts).toBeUndefined();
    expect(opts).not.toEqual({});
  });

  it("passes { stripeAccount } as request options when stripeConnectAccountId is provided", async () => {
    await createCheckoutSession({ ...baseParams, stripeConnectAccountId: "acct_connect" });

    const [, opts] = mockCheckoutSessionsCreate.mock.calls[0];
    expect(opts).toEqual({ stripeAccount: "acct_connect" });
  });

  it("passes undefined options when stripeConnectAccountId is null", async () => {
    await createCheckoutSession({ ...baseParams, stripeConnectAccountId: null });

    const [, opts] = mockCheckoutSessionsCreate.mock.calls[0];
    expect(opts).toBeUndefined();
  });

  it("includes application_fee_amount when stripeConnectAccountId is provided", async () => {
    await createCheckoutSession({ ...baseParams, stripeConnectAccountId: "acct_connect" });

    const [params] = mockCheckoutSessionsCreate.mock.calls[0];
    expect(params.payment_intent_data?.application_fee_amount).toBeGreaterThan(0);
  });

  it("does not include application_fee_amount when no connected account", async () => {
    await createCheckoutSession(baseParams);

    const [params] = mockCheckoutSessionsCreate.mock.calls[0];
    expect(params.payment_intent_data).toBeUndefined();
  });

  it("returns the sessionId and url", async () => {
    const result = await createCheckoutSession(baseParams);
    expect(result.sessionId).toBe("cs_test123");
    expect(result.url).toBe("https://checkout.stripe.com/pay/cs_test123");
  });
});

// =============================================================================
// detachPaymentMethod() integration tests (Stripe SDK mocked)
// =============================================================================

describe("detachPaymentMethod()", () => {
  beforeEach(() => {
    mockPaymentMethodsDetach.mockResolvedValue({ id: "pm_detached" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes undefined (not {}) as request options when no stripeAccount", async () => {
    await detachPaymentMethod("pm_card_123");

    expect(mockPaymentMethodsDetach).toHaveBeenCalledOnce();
    const [, opts] = mockPaymentMethodsDetach.mock.calls[0];
    expect(opts).toBeUndefined();
    expect(opts).not.toEqual({});
  });

  it("passes { stripeAccount } as request options when stripeAccount is provided", async () => {
    await detachPaymentMethod("pm_card_123", "acct_connect");

    const [, opts] = mockPaymentMethodsDetach.mock.calls[0];
    expect(opts).toEqual({ stripeAccount: "acct_connect" });
  });

  it("passes undefined options when stripeAccount is null", async () => {
    await detachPaymentMethod("pm_card_123", null);

    const [, opts] = mockPaymentMethodsDetach.mock.calls[0];
    expect(opts).toBeUndefined();
  });

  it("passes the payment method id as the first argument", async () => {
    await detachPaymentMethod("pm_card_xyz", "acct_connect");

    const [pmId] = mockPaymentMethodsDetach.mock.calls[0];
    expect(pmId).toBe("pm_card_xyz");
  });
});

// =============================================================================
// ensureConnectedCustomer() integration tests (Stripe SDK mocked)
// =============================================================================

describe("ensureConnectedCustomer()", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new customer (with undefined options) when currentCustomerId is null and no stripeAccount", async () => {
    mockCustomerCreate.mockResolvedValue({ id: "cus_new" });

    const result = await ensureConnectedCustomer({
      currentCustomerId: null,
      stripeAccount: null,
      name: "New Customer",
    });

    expect(result.customerId).toBe("cus_new");
    expect(result.wasRecreated).toBe(true);
    const [, opts] = mockCustomerCreate.mock.calls[0];
    expect(opts).toBeUndefined();
    expect(opts).not.toEqual({});
  });

  it("creates a new customer with { stripeAccount } when currentCustomerId is null and stripeAccount provided", async () => {
    mockCustomerCreate.mockResolvedValue({ id: "cus_new_connected" });

    const result = await ensureConnectedCustomer({
      currentCustomerId: null,
      stripeAccount: "acct_connect",
      name: "New Connected Customer",
    });

    expect(result.customerId).toBe("cus_new_connected");
    expect(result.wasRecreated).toBe(true);
    const [, opts] = mockCustomerCreate.mock.calls[0];
    expect(opts).toEqual({ stripeAccount: "acct_connect" });
  });

  it("returns existing customerId without SDK call when stripeAccount is null", async () => {
    const result = await ensureConnectedCustomer({
      currentCustomerId: "cus_existing",
      stripeAccount: null,
      name: "Existing Customer",
    });

    expect(result.customerId).toBe("cus_existing");
    expect(result.wasRecreated).toBe(false);
    expect(mockCustomerRetrieve).not.toHaveBeenCalled();
  });

  it("passes { stripeAccount } to customers.retrieve when verifying existing customer", async () => {
    mockCustomerRetrieve.mockResolvedValue({ id: "cus_existing", deleted: false });

    const result = await ensureConnectedCustomer({
      currentCustomerId: "cus_existing",
      stripeAccount: "acct_connect",
      name: "Existing Customer",
    });

    expect(result.customerId).toBe("cus_existing");
    expect(result.wasRecreated).toBe(false);
    const [, opts] = mockCustomerRetrieve.mock.calls[0];
    expect(opts).toEqual({ stripeAccount: "acct_connect" });
    expect(opts).not.toEqual({});
  });
});

// =============================================================================
// retrievePaymentIntentFees() integration tests (Stripe SDK mocked)
// =============================================================================

describe("retrievePaymentIntentFees()", () => {
  const fakePI = {
    id: "pi_fees_123",
    latest_charge: {
      balance_transaction: {
        fee: 320,
        net: 6680,
        amount: 7000,
      },
    },
  };

  beforeEach(() => {
    mockPaymentIntentsRetrieve.mockResolvedValue(fakePI);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes undefined (not {}) as request options when no stripeAccount", async () => {
    await retrievePaymentIntentFees("pi_fees_123");

    expect(mockPaymentIntentsRetrieve).toHaveBeenCalledOnce();
    const [, , opts] = mockPaymentIntentsRetrieve.mock.calls[0];
    expect(opts).toBeUndefined();
    expect(opts).not.toEqual({});
  });

  it("passes { stripeAccount } as request options when stripeAccount is provided", async () => {
    await retrievePaymentIntentFees("pi_fees_123", "acct_connect");

    const [, , opts] = mockPaymentIntentsRetrieve.mock.calls[0];
    expect(opts).toEqual({ stripeAccount: "acct_connect" });
  });

  it("passes undefined options when stripeAccount is null", async () => {
    await retrievePaymentIntentFees("pi_fees_123", null);

    const [, , opts] = mockPaymentIntentsRetrieve.mock.calls[0];
    expect(opts).toBeUndefined();
  });

  it("returns feeCents, netCents, and grossCents from balance_transaction", async () => {
    const result = await retrievePaymentIntentFees("pi_fees_123");
    expect(result).not.toBeNull();
    expect(result!.feeCents).toBe(320);
    expect(result!.netCents).toBe(6680);
    expect(result!.grossCents).toBe(7000);
  });

  it("returns null when latest_charge is a string (unexpanded)", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({ id: "pi_fees_123", latest_charge: "ch_abc" });
    const result = await retrievePaymentIntentFees("pi_fees_123");
    expect(result).toBeNull();
  });

  it("returns null when balance_transaction is a string (unexpanded)", async () => {
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: "pi_fees_123",
      latest_charge: { balance_transaction: "txn_abc" },
    });
    const result = await retrievePaymentIntentFees("pi_fees_123");
    expect(result).toBeNull();
  });
});
