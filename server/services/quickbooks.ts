/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "crypto";
import { retrievePaymentIntentFees } from "./stripe";
import { db } from "../db";
import { companies, contacts, invoices, invoiceLineItems, qboSyncLogs } from "@shared/schema";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";

const refreshLocks = new Map<string, Promise<{ access_token: string; refresh_token: string }>>();

const QBO_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QBO_API_BASE = "https://quickbooks.api.intuit.com/v3";
const QBO_SANDBOX_API_BASE = "https://sandbox-quickbooks.api.intuit.com/v3";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer | null {
  const secret = process.env.QBO_TOKEN_SECRET;
  if (!secret) return null;
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("QBO_TOKEN_SECRET is required in production for secure token storage");
    }
    console.warn(
      "[QBO] WARNING: QBO_TOKEN_SECRET not set, storing tokens in plaintext. Set QBO_TOKEN_SECRET for encrypted storage."
    );
    return plaintext;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptToken(ciphertext: string): string {
  if (!ciphertext.startsWith("enc:")) return ciphertext;
  const key = getEncryptionKey();
  if (!key) return ciphertext;
  const parts = ciphertext.split(":");
  if (parts.length !== 4) return ciphertext;
  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const encrypted = Buffer.from(parts[3], "hex");
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

const pendingOAuthStates = new Map<string, { companyId: string; expiresAt: number }>();

function getQboApiBase() {
  return process.env.QBO_USE_SANDBOX === "true" ? QBO_SANDBOX_API_BASE : QBO_API_BASE;
}

export function isQboConfigured(): boolean {
  return !!(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET);
}

export function createOAuthState(companyId: string): string {
  const nonce = crypto.randomBytes(24).toString("hex");
  pendingOAuthStates.set(nonce, { companyId, expiresAt: Date.now() + 10 * 60 * 1000 });
  for (const [key, val] of Array.from(pendingOAuthStates)) {
    if (val.expiresAt < Date.now()) pendingOAuthStates.delete(key);
  }
  return nonce;
}

export function validateOAuthState(state: string): string | null {
  const entry = pendingOAuthStates.get(state);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    pendingOAuthStates.delete(state);
    return null;
  }
  pendingOAuthStates.delete(state);
  return entry.companyId;
}

export function getQboAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID!,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: redirectUri,
    state,
  });
  return `${QBO_AUTH_URL}?${params.toString()}`;
}

export async function exchangeQboCode(
  code: string,
  redirectUri: string
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
}> {
  const auth = Buffer.from(
    `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
  ).toString("base64");
  const res = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`QBO token exchange failed: ${res.status} ${errText}`);
  }
  return res.json();
}

export async function refreshQboTokens(
  companyId: string
): Promise<{ access_token: string; refresh_token: string }> {
  const existing = refreshLocks.get(companyId);
  if (existing) {
    return existing;
  }

  const refreshPromise = doRefreshQboTokens(companyId).finally(() => {
    refreshLocks.delete(companyId);
  });
  refreshLocks.set(companyId, refreshPromise);
  return refreshPromise;
}

async function doRefreshQboTokens(
  companyId: string
): Promise<{ access_token: string; refresh_token: string }> {
  const [company] = await db
    .select({
      id: companies.id,
      qboRefreshToken: companies.qboRefreshToken,
      qboAccessToken: companies.qboAccessToken,
      qboTokenExpiresAt: companies.qboTokenExpiresAt,
      qboRealmId: companies.qboRealmId,
    })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!company?.qboRefreshToken) {
    throw new Error("No QBO refresh token found");
  }

  const decryptedRefreshToken = decryptToken(company.qboRefreshToken);
  const auth = Buffer.from(
    `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
  ).toString("base64");
  const res = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: decryptedRefreshToken,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 401 || res.status === 400) {
      await db
        .update(companies)
        .set({
          qboAccessToken: null,
          qboRefreshToken: null,
          qboTokenExpiresAt: null,
          qboRealmId: null,
          qboConnectedAt: null,
        })
        .where(eq(companies.id, companyId));
      throw new Error("QBO connection expired. Please reconnect your QuickBooks account.");
    }
    throw new Error(`QBO token refresh failed: ${res.status} ${errText}`);
  }
  const data = await res.json();

  await db
    .update(companies)
    .set({
      qboAccessToken: encryptToken(data.access_token),
      qboRefreshToken: encryptToken(data.refresh_token),
      qboTokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
    })
    .where(eq(companies.id, companyId));

  return { access_token: data.access_token, refresh_token: data.refresh_token };
}

async function getValidAccessToken(companyId: string): Promise<{ token: string; realmId: string }> {
  const [company] = await db
    .select({
      id: companies.id,
      qboRealmId: companies.qboRealmId,
      qboAccessToken: companies.qboAccessToken,
      qboRefreshToken: companies.qboRefreshToken,
      qboTokenExpiresAt: companies.qboTokenExpiresAt,
    })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!company?.qboRealmId || !company?.qboAccessToken) {
    throw new Error("QuickBooks is not connected");
  }

  if (
    company.qboTokenExpiresAt &&
    new Date(company.qboTokenExpiresAt) < new Date(Date.now() + 60000)
  ) {
    const refreshed = await refreshQboTokens(companyId);
    return { token: refreshed.access_token, realmId: company.qboRealmId };
  }

  return { token: decryptToken(company.qboAccessToken), realmId: company.qboRealmId };
}

async function qboRequest(
  companyId: string,
  method: string,
  path: string,
  body?: any
): Promise<any> {
  const { token, realmId } = await getValidAccessToken(companyId);
  const url = `${getQboApiBase()}/company/${realmId}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 401) {
      const refreshed = await refreshQboTokens(companyId);
      const retryRes = await fetch(url.replace(token, refreshed.access_token), {
        method,
        headers: { ...headers, Authorization: `Bearer ${refreshed.access_token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!retryRes.ok) {
        const retryErr = await retryRes.text();
        throw new Error(`QBO API error (retry): ${retryRes.status} ${retryErr}`);
      }
      return retryRes.json();
    }
    throw new Error(`QBO API error: ${res.status} ${errText}`);
  }
  return res.json();
}

async function logSync(
  companyId: string,
  entityType: string,
  entityId: string,
  action: string,
  status: "pending" | "synced" | "error",
  qboEntityId?: string,
  errorMessage?: string
) {
  await db.insert(qboSyncLogs).values({
    companyId,
    entityType,
    entityId,
    action,
    status,
    qboEntityId: qboEntityId || null,
    errorMessage: errorMessage || null,
    syncedAt: status === "synced" ? new Date() : null,
  });
}

export async function syncContactToQbo(
  companyId: string,
  contactId: string
): Promise<{ qboCustomerId: string }> {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.companyId, companyId)));
  if (!contact) throw new Error("Contact not found");

  if (contact.qboCustomerId) {
    const existingRes = await qboRequest(companyId, "GET", `/customer/${contact.qboCustomerId}`);
    const syncToken = existingRes?.Customer?.SyncToken || "0";

    await qboRequest(companyId, "POST", `/customer`, {
      Id: contact.qboCustomerId,
      SyncToken: syncToken,
      sparse: true,
      DisplayName: `${contact.firstName} ${contact.lastName}`.trim(),
      PrimaryEmailAddr: contact.email ? { Address: contact.email } : undefined,
      PrimaryPhone: contact.phone ? { FreeFormNumber: contact.phone } : undefined,
      BillAddr: contact.streetAddress
        ? {
            Line1: contact.streetAddress,
            Line2: contact.address2 || undefined,
            City: contact.city || undefined,
            CountrySubDivisionCode: contact.state || undefined,
            PostalCode: contact.zipCode || undefined,
          }
        : undefined,
    });

    await logSync(companyId, "contact", contactId, "update", "synced", contact.qboCustomerId);
    return { qboCustomerId: contact.qboCustomerId };
  }

  const displayName = `${contact.firstName} ${contact.lastName}`.trim();

  let existingCustomer: any = null;
  try {
    if (contact.email) {
      const searchRes = await qboRequest(
        companyId,
        "GET",
        `/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE PrimaryEmailAddr = '${contact.email.replace(/'/g, "\\'")}'`)}`
      );
      const customers = searchRes?.QueryResponse?.Customer;
      if (customers?.length > 0) {
        existingCustomer = customers[0];
      }
    }

    if (!existingCustomer) {
      const searchRes = await qboRequest(
        companyId,
        "GET",
        `/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${displayName.replace(/'/g, "\\'")}'`)}`
      );
      const customers = searchRes?.QueryResponse?.Customer;
      if (customers?.length > 0) {
        existingCustomer = customers[0];
      }
    }
  } catch (err) {
    console.error("QBO customer search failed, will create new:", err);
  }

  let qboCustomerId: string;

  if (existingCustomer) {
    qboCustomerId = String(existingCustomer.Id);
  } else {
    const createRes = await qboRequest(companyId, "POST", `/customer`, {
      DisplayName: displayName,
      GivenName: contact.firstName,
      FamilyName: contact.lastName || undefined,
      PrimaryEmailAddr: contact.email ? { Address: contact.email } : undefined,
      PrimaryPhone: contact.phone ? { FreeFormNumber: contact.phone } : undefined,
      BillAddr: contact.streetAddress
        ? {
            Line1: contact.streetAddress,
            Line2: contact.address2 || undefined,
            City: contact.city || undefined,
            CountrySubDivisionCode: contact.state || undefined,
            PostalCode: contact.zipCode || undefined,
          }
        : undefined,
    });
    qboCustomerId = String(createRes.Customer.Id);
  }

  await db.update(contacts).set({ qboCustomerId }).where(eq(contacts.id, contactId));
  await logSync(
    companyId,
    "contact",
    contactId,
    existingCustomer ? "match" : "create",
    "synced",
    qboCustomerId
  );
  return { qboCustomerId };
}

export async function syncInvoiceToQbo(
  companyId: string,
  invoiceId: string
): Promise<{ qboInvoiceId: string }> {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
  if (!invoice) throw new Error("Invoice not found");

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, invoice.contactId));
  if (!contact) throw new Error("Contact not found for invoice");

  let qboCustomerId = contact.qboCustomerId;
  if (!qboCustomerId) {
    const syncResult = await syncContactToQbo(companyId, contact.id);
    qboCustomerId = syncResult.qboCustomerId;
  }

  const lineItems = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId));

  let serviceItemRef = { value: "1", name: "Services" };
  try {
    const itemQuery = await qboRequest(
      companyId,
      "GET",
      `/query?query=${encodeURIComponent("SELECT * FROM Item WHERE Type = 'Service' MAXRESULTS 1")}`
    );
    const items = itemQuery?.QueryResponse?.Item;
    if (items?.length > 0) {
      serviceItemRef = { value: String(items[0].Id), name: items[0].Name };
    } else {
      const nonInvQuery = await qboRequest(
        companyId,
        "GET",
        `/query?query=${encodeURIComponent("SELECT * FROM Item WHERE Type = 'NonInventory' MAXRESULTS 1")}`
      );
      const nonInvItems = nonInvQuery?.QueryResponse?.Item;
      if (nonInvItems?.length > 0) {
        serviceItemRef = { value: String(nonInvItems[0].Id), name: nonInvItems[0].Name };
      }
    }
  } catch (err) {
    console.error("Failed to query QBO items, using default:", err);
  }

  interface QboInvoiceLine {
    DetailType: string;
    Amount: number;
    Description: string;
    SalesItemLineDetail: {
      Qty: number;
      UnitPrice: number;
      ItemRef: { value: string; name: string };
    };
    LineNum: number;
  }

  const qboLines: QboInvoiceLine[] = lineItems.map((li, idx) => ({
    DetailType: "SalesItemLineDetail",
    Amount: parseFloat(li.total),
    Description: li.description,
    SalesItemLineDetail: {
      Qty: li.quantity,
      UnitPrice: parseFloat(li.unitPrice),
      ItemRef: serviceItemRef,
    },
    LineNum: idx + 1,
  }));

  if (parseFloat(invoice.tax || "0") > 0) {
    qboLines.push({
      DetailType: "SalesItemLineDetail",
      Amount: parseFloat(invoice.tax),
      Description: "Tax",
      SalesItemLineDetail: {
        Qty: 1,
        UnitPrice: parseFloat(invoice.tax),
        ItemRef: serviceItemRef,
      },
      LineNum: qboLines.length + 1,
    });
  }

  if (invoice.qboInvoiceId) {
    let existingQboInvoice: any;
    try {
      const readRes = await qboRequest(companyId, "GET", `/invoice/${invoice.qboInvoiceId}`);
      existingQboInvoice = readRes?.Invoice;
    } catch {
      existingQboInvoice = null;
    }

    if (existingQboInvoice) {
      await qboRequest(companyId, "POST", `/invoice`, {
        Id: invoice.qboInvoiceId,
        SyncToken: existingQboInvoice.SyncToken,
        sparse: true,
        Line: qboLines,
        CustomerRef: { value: qboCustomerId },
        DueDate: invoice.dueDate,
        DocNumber: invoice.invoiceNumber,
      });

      await logSync(companyId, "invoice", invoiceId, "update", "synced", invoice.qboInvoiceId);
      return { qboInvoiceId: invoice.qboInvoiceId };
    }
  }

  const createRes = await qboRequest(companyId, "POST", `/invoice`, {
    CustomerRef: { value: qboCustomerId },
    Line: qboLines,
    DueDate: invoice.dueDate,
    DocNumber: invoice.invoiceNumber,
    TxnDate: invoice.issuedDate || invoice.createdAt.toISOString().split("T")[0],
  });

  const qboInvoiceId = String(createRes.Invoice.Id);
  await db.update(invoices).set({ qboInvoiceId }).where(eq(invoices.id, invoiceId));
  await logSync(companyId, "invoice", invoiceId, "create", "synced", qboInvoiceId);
  return { qboInvoiceId };
}

async function lookupQboAccount(
  companyId: string,
  accountType: string,
  accountSubType: string
): Promise<string | null> {
  try {
    const query = `SELECT * FROM Account WHERE AccountType = '${accountType}' AND AccountSubType = '${accountSubType}' MAXRESULTS 1`;
    const res = await qboRequest(companyId, "GET", `/query?query=${encodeURIComponent(query)}`);
    const accounts = res?.QueryResponse?.Account;
    if (accounts?.length > 0) return String(accounts[0].Id);
  } catch {}
  return null;
}

async function lookupQboUndepositedFundsId(companyId: string): Promise<string | null> {
  return lookupQboAccount(companyId, "Other Current Asset", "UndepositedFunds");
}

async function lookupQboCheckingAccount(companyId: string): Promise<string | null> {
  try {
    const query = `SELECT * FROM Account WHERE AccountType = 'Bank' AND Active = true MAXRESULTS 5`;
    const res = await qboRequest(companyId, "GET", `/query?query=${encodeURIComponent(query)}`);
    const accounts = res?.QueryResponse?.Account;
    if (accounts?.length > 0) {
      const checking = accounts.find((a: any) => a.AccountSubType === "Checking");
      return String((checking || accounts[0]).Id);
    }
  } catch {}
  return null;
}

async function lookupDefaultFeeAccount(companyId: string): Promise<string | null> {
  const id = await lookupQboAccount(companyId, "Expense", "OtherMiscellaneousServiceCost");
  if (id) return id;
  try {
    const query = `SELECT * FROM Account WHERE AccountType = 'Expense' AND Name IN ('Merchant Service Fees', 'Bank Charges', 'Bank Service Charges') MAXRESULTS 1`;
    const res = await qboRequest(companyId, "GET", `/query?query=${encodeURIComponent(query)}`);
    const accounts = res?.QueryResponse?.Account;
    if (accounts?.length > 0) return String(accounts[0].Id);
  } catch {}
  return null;
}

async function getStripeFeeForPayment(
  stripePaymentIntentId: string,
  stripeAccount?: string | null
): Promise<{ feeCents: number; netCents: number; grossCents: number } | null> {
  try {
    return await retrievePaymentIntentFees(stripePaymentIntentId, stripeAccount);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[QBO] Failed to retrieve Stripe fee for PI ${stripePaymentIntentId}: ${errMsg}`);
    return null;
  }
}

export async function listQboExpenseAccounts(
  companyId: string
): Promise<{ id: string; name: string; accountSubType: string }[]> {
  const query = `SELECT Id, Name, AccountSubType FROM Account WHERE AccountType = 'Expense' MAXRESULTS 100`;
  const res = await qboRequest(companyId, "GET", `/query?query=${encodeURIComponent(query)}`);
  const accounts = res?.QueryResponse?.Account || [];
  return accounts.map((a: Record<string, unknown>) => ({
    id: String(a.Id),
    name: String(a.Name),
    accountSubType: String(a.AccountSubType || ""),
  }));
}

export async function syncPaymentToQbo(companyId: string, invoiceId: string): Promise<void> {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
  if (!invoice?.qboInvoiceId) {
    await syncInvoiceToQbo(companyId, invoiceId);
  }

  const freshInvoice = (await db.select().from(invoices).where(eq(invoices.id, invoiceId)))[0];
  if (!freshInvoice?.qboInvoiceId) throw new Error("Could not sync invoice to QBO first");

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, freshInvoice.contactId));
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));

  let qboPaymentId: string | null = null;

  const existingPaymentLogs = await db
    .select()
    .from(qboSyncLogs)
    .where(
      and(
        eq(qboSyncLogs.companyId, companyId),
        eq(qboSyncLogs.entityType, "payment"),
        eq(qboSyncLogs.entityId, invoiceId),
        eq(qboSyncLogs.status, "synced")
      )
    )
    .limit(1);

  if (existingPaymentLogs.length > 0) {
    qboPaymentId = existingPaymentLogs[0].qboEntityId || null;
  }

  if (!qboPaymentId) {
    try {
      const safeInvoiceNum = (freshInvoice.invoiceNumber || "").replace(/'/g, "\\'");
      const paymentQuery = await qboRequest(
        companyId,
        "GET",
        `/query?query=${encodeURIComponent(`SELECT * FROM Payment WHERE PaymentRefNum = '${safeInvoiceNum}'`)}`
      );
      const existingPayments = paymentQuery?.QueryResponse?.Payment;
      if (existingPayments?.length > 0) {
        const linked = existingPayments.find((p: Record<string, unknown>) =>
          (p.Line as Array<Record<string, unknown>>)?.some((l) =>
            (l.LinkedTxn as Array<Record<string, unknown>>)?.some(
              (t) => t.TxnId === freshInvoice.qboInvoiceId
            )
          )
        );
        if (linked) {
          qboPaymentId = String(linked.Id);
          await logSync(companyId, "payment", invoiceId, "match", "synced", qboPaymentId);
        }
      }
    } catch {}
  }

  if (!qboPaymentId) {
    const undepositedFundsId = await lookupQboUndepositedFundsId(companyId);

    const paymentBody: Record<string, unknown> = {
      CustomerRef: { value: contact?.qboCustomerId },
      TotalAmt: parseFloat(freshInvoice.total),
      Line: [
        {
          Amount: parseFloat(freshInvoice.total),
          LinkedTxn: [
            {
              TxnId: freshInvoice.qboInvoiceId,
              TxnType: "Invoice",
            },
          ],
        },
      ],
    };

    if (undepositedFundsId) {
      paymentBody.DepositToAccountRef = { value: undepositedFundsId };
    } else {
      console.warn(
        `[QBO] Undeposited Funds account not found for company ${companyId}. Payment will use QBO default deposit account; deposit reconciliation will be skipped.`
      );
    }

    const paymentRes = await qboRequest(companyId, "POST", `/payment`, paymentBody);
    qboPaymentId = String(paymentRes.Payment.Id);

    await logSync(companyId, "payment", invoiceId, "create", "synced", qboPaymentId);
  }

  await reconcileDeposit(companyId, invoiceId, qboPaymentId, freshInvoice, company);
}

async function reconcileDeposit(
  companyId: string,
  invoiceId: string,
  qboPaymentId: string,
  freshInvoice: typeof invoices.$inferSelect,
  company: typeof companies.$inferSelect | undefined
): Promise<void> {
  if (!freshInvoice.stripePaymentIntentId) return;

  const existingDepositLogs = await db
    .select()
    .from(qboSyncLogs)
    .where(
      and(
        eq(qboSyncLogs.companyId, companyId),
        eq(qboSyncLogs.entityType, "deposit"),
        eq(qboSyncLogs.entityId, invoiceId),
        eq(qboSyncLogs.status, "synced")
      )
    )
    .limit(1);

  if (existingDepositLogs.length > 0) return;

  const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;
  const stripeFee = await getStripeFeeForPayment(freshInvoice.stripePaymentIntentId, connectAcct);
  if (!stripeFee || stripeFee.feeCents === 0) return;

  const expectedNet = stripeFee.grossCents - stripeFee.feeCents;
  if (expectedNet !== stripeFee.netCents) {
    console.warn(
      `[QBO] Stripe fee math mismatch for PI ${freshInvoice.stripePaymentIntentId}: gross(${stripeFee.grossCents}) - fee(${stripeFee.feeCents}) != net(${stripeFee.netCents}). Skipping deposit.`
    );
    await logSync(
      companyId,
      "deposit",
      invoiceId,
      "skip",
      "error",
      undefined,
      "Stripe fee math verification failed."
    );
    return;
  }

  let feeAccountId = company?.qboFeeAccountRef || null;
  if (!feeAccountId) {
    feeAccountId = await lookupDefaultFeeAccount(companyId);
    if (feeAccountId) {
      await db
        .update(companies)
        .set({ qboFeeAccountRef: feeAccountId })
        .where(eq(companies.id, companyId));
    }
  }

  if (!feeAccountId) {
    console.warn(
      `[QBO] No fee expense account found for company ${companyId}. Skipping deposit creation.`
    );
    await logSync(
      companyId,
      "deposit",
      invoiceId,
      "skip",
      "error",
      undefined,
      "No fee expense account configured. Set one in Settings > QuickBooks."
    );
    return;
  }

  const bankAccountId = await lookupQboCheckingAccount(companyId);
  if (!bankAccountId) {
    console.warn(
      `[QBO] No bank/checking account found for company ${companyId}. Skipping deposit.`
    );
    await logSync(
      companyId,
      "deposit",
      invoiceId,
      "skip",
      "error",
      undefined,
      "No bank account found in QuickBooks."
    );
    return;
  }

  try {
    const grossAmount = stripeFee.grossCents / 100;
    const feeAmount = stripeFee.feeCents / 100;

    const depositRes = await qboRequest(companyId, "POST", `/deposit`, {
      DepositToAccountRef: { value: bankAccountId },
      TxnDate: new Date().toISOString().split("T")[0],
      Line: [
        {
          Amount: grossAmount,
          LinkedTxn: [
            {
              TxnId: qboPaymentId,
              TxnType: "Payment",
            },
          ],
        },
        {
          Amount: -feeAmount,
          DetailType: "DepositLineDetail",
          DepositLineDetail: {
            AccountRef: { value: feeAccountId },
          },
          Description: "Stripe processing fee",
        },
      ],
      PrivateNote: `Stripe net deposit for invoice ${freshInvoice.invoiceNumber}. Fee: $${feeAmount.toFixed(2)}`,
    });

    await logSync(
      companyId,
      "deposit",
      invoiceId,
      "create",
      "synced",
      String(depositRes.Deposit.Id)
    );
  } catch (depositErr: unknown) {
    const errMsg = depositErr instanceof Error ? depositErr.message : String(depositErr);
    console.error(
      `[QBO] Deposit creation failed for invoice ${invoiceId} (company ${companyId}):`,
      errMsg
    );
    await logSync(companyId, "deposit", invoiceId, "create", "error", undefined, errMsg);
  }
}

export async function getQboSyncStatus(companyId: string): Promise<{
  connected: boolean;
  realmId: string | null;
  connectedAt: string | null;
  lastSync: string | null;
  totalSynced: number;
  totalErrors: number;
  feeAccountRef: string | null;
  recentLogs: any[];
}> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const connected = !!(company?.qboRealmId && company?.qboAccessToken);

  const logs = await db
    .select()
    .from(qboSyncLogs)
    .where(eq(qboSyncLogs.companyId, companyId))
    .orderBy(desc(qboSyncLogs.createdAt))
    .limit(50);

  const totalSynced = logs.filter((l) => l.status === "synced").length;
  const totalErrors = logs.filter((l) => l.status === "error").length;
  const lastSyncedLog = logs.find((l) => l.status === "synced");

  return {
    connected,
    realmId: company?.qboRealmId || null,
    connectedAt: company?.qboConnectedAt?.toISOString() || null,
    lastSync: lastSyncedLog?.syncedAt?.toISOString() || null,
    totalSynced,
    totalErrors,
    feeAccountRef: company?.qboFeeAccountRef || null,
    recentLogs: logs.slice(0, 20).map((l) => ({
      id: l.id,
      entityType: l.entityType,
      entityId: l.entityId,
      action: l.action,
      status: l.status,
      errorMessage: l.errorMessage,
      syncedAt: l.syncedAt?.toISOString() || null,
      createdAt: l.createdAt.toISOString(),
    })),
  };
}

export async function runFullSync(
  companyId: string
): Promise<{ contactsSynced: number; invoicesSynced: number; errors: string[] }> {
  const errors: string[] = [];
  let contactsSynced = 0;
  let invoicesSynced = 0;

  const allContacts = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.companyId, companyId),
        sql`${contacts.status} IN ('active', 'lead', 'estimate', 'paused')`
      )
    );

  for (const contact of allContacts) {
    try {
      await syncContactToQbo(companyId, contact.id);
      contactsSynced++;
    } catch (err: any) {
      const msg = `Contact ${contact.firstName} ${contact.lastName}: ${err.message}`;
      errors.push(msg);
      await logSync(companyId, "contact", contact.id, "sync", "error", undefined, err.message);
    }
  }

  const allInvoices = await db
    .select()
    .from(invoices)
    .where(
      and(eq(invoices.companyId, companyId), sql`${invoices.status} IN ('sent', 'pending', 'paid')`)
    );

  for (const inv of allInvoices) {
    try {
      await syncInvoiceToQbo(companyId, inv.id);
      invoicesSynced++;

      if (inv.status === "paid") {
        try {
          await syncPaymentToQbo(companyId, inv.id);
        } catch (payErr: any) {
          errors.push(`Payment for invoice ${inv.invoiceNumber}: ${payErr.message}`);
          await logSync(companyId, "payment", inv.id, "sync", "error", undefined, payErr.message);
        }
      }
    } catch (err: any) {
      const msg = `Invoice ${inv.invoiceNumber}: ${err.message}`;
      errors.push(msg);
      await logSync(companyId, "invoice", inv.id, "sync", "error", undefined, err.message);
    }
  }

  return { contactsSynced, invoicesSynced, errors };
}

export async function processWebhookEntity(
  companyId: string,
  entityName: string,
  entityId: string,
  operation: string
): Promise<void> {
  const normalizedOp = operation.toLowerCase();
  const normalizedEntity = entityName.toLowerCase();

  try {
    if (normalizedEntity === "customer") {
      if (normalizedOp === "create" || normalizedOp === "update") {
        await updateLocalContactFromQboCustomer(companyId, entityId);
      } else if (normalizedOp === "delete") {
        const matchingContacts = await db
          .select()
          .from(contacts)
          .where(and(eq(contacts.companyId, companyId), eq(contacts.qboCustomerId, entityId)));
        for (const c of matchingContacts) {
          await db.update(contacts).set({ qboCustomerId: null }).where(eq(contacts.id, c.id));
          await logSync(companyId, "contact", c.id, "unlink", "synced", entityId);
        }
      }
    } else if (normalizedEntity === "invoice") {
      if (normalizedOp === "create" || normalizedOp === "update") {
        await updateLocalInvoiceFromQboInvoice(companyId, entityId);
      } else if (normalizedOp === "void") {
        await handleQboInvoiceVoid(companyId, entityId);
      } else if (normalizedOp === "delete") {
        const matchingInvoices = await db
          .select()
          .from(invoices)
          .where(and(eq(invoices.companyId, companyId), eq(invoices.qboInvoiceId, entityId)));
        for (const inv of matchingInvoices) {
          await db.update(invoices).set({ qboInvoiceId: null }).where(eq(invoices.id, inv.id));
          await logSync(companyId, "invoice", inv.id, "unlink", "synced", entityId);
        }
      }
    } else if (normalizedEntity === "item") {
      await logSync(companyId, "item", entityId, normalizedOp, "synced", entityId);
      console.log(
        `[QBO Webhook] Item ${normalizedOp} id=${entityId} for company=${companyId} (logged, no local model)`
      );
    }
  } catch (err: any) {
    console.error(
      `[QBO Webhook] Error processing ${entityName} ${operation} id=${entityId}:`,
      err.message
    );
    await logSync(
      companyId,
      normalizedEntity,
      entityId,
      normalizedOp,
      "error",
      entityId,
      err.message
    );
  }
}

async function updateLocalContactFromQboCustomer(
  companyId: string,
  qboCustomerId: string
): Promise<void> {
  const qboData = await qboRequest(companyId, "GET", `/customer/${qboCustomerId}`);
  const customer = qboData?.Customer;
  if (!customer) return;

  const matchingContacts = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.companyId, companyId), eq(contacts.qboCustomerId, qboCustomerId)));

  if (matchingContacts.length === 0) {
    await logSync(companyId, "contact", qboCustomerId, "inbound-skip", "synced", qboCustomerId);
    return;
  }

  for (const contact of matchingContacts) {
    const updates: Record<string, any> = {};
    if (customer.PrimaryEmailAddr?.Address && customer.PrimaryEmailAddr.Address !== contact.email) {
      updates.email = customer.PrimaryEmailAddr.Address;
    }
    if (
      customer.PrimaryPhone?.FreeFormNumber &&
      customer.PrimaryPhone.FreeFormNumber !== contact.phone
    ) {
      updates.phone = customer.PrimaryPhone.FreeFormNumber;
    }
    if (customer.GivenName && customer.GivenName !== contact.firstName) {
      updates.firstName = customer.GivenName;
    }
    if (customer.FamilyName && customer.FamilyName !== contact.lastName) {
      updates.lastName = customer.FamilyName;
    }

    if (Object.keys(updates).length > 0) {
      await db.update(contacts).set(updates).where(eq(contacts.id, contact.id));
      await logSync(companyId, "contact", contact.id, "inbound-update", "synced", qboCustomerId);
    } else {
      await logSync(companyId, "contact", contact.id, "inbound-noop", "synced", qboCustomerId);
    }
  }
}

async function updateLocalInvoiceFromQboInvoice(
  companyId: string,
  qboInvoiceId: string
): Promise<void> {
  const qboData = await qboRequest(companyId, "GET", `/invoice/${qboInvoiceId}`);
  const qboInvoice = qboData?.Invoice;
  if (!qboInvoice) return;

  const matchingInvoices = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.companyId, companyId), eq(invoices.qboInvoiceId, qboInvoiceId)));

  if (matchingInvoices.length === 0) {
    await logSync(companyId, "invoice", qboInvoiceId, "inbound-skip", "synced", qboInvoiceId);
    return;
  }

  for (const inv of matchingInvoices) {
    const balance = parseFloat(qboInvoice.Balance ?? "0");
    const totalAmt = parseFloat(qboInvoice.TotalAmt ?? "0");

    if (qboInvoice.PrivateNote?.includes("Voided")) {
      if (inv.status !== "voided") {
        await db.update(invoices).set({ status: "voided" }).where(eq(invoices.id, inv.id));
        await logSync(companyId, "invoice", inv.id, "inbound-void", "synced", qboInvoiceId);
      }
    } else if (balance === 0 && totalAmt > 0 && inv.status !== "paid") {
      await db
        .update(invoices)
        .set({ status: "paid", paidAt: new Date() })
        .where(eq(invoices.id, inv.id));
      await logSync(companyId, "invoice", inv.id, "inbound-paid", "synced", qboInvoiceId);
    } else {
      await logSync(companyId, "invoice", inv.id, "inbound-update", "synced", qboInvoiceId);
    }
  }
}

async function handleQboInvoiceVoid(companyId: string, qboInvoiceId: string): Promise<void> {
  const matchingInvoices = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.companyId, companyId), eq(invoices.qboInvoiceId, qboInvoiceId)));

  for (const inv of matchingInvoices) {
    if (inv.status !== "voided") {
      await db.update(invoices).set({ status: "voided" }).where(eq(invoices.id, inv.id));
      await logSync(companyId, "invoice", inv.id, "inbound-void", "synced", qboInvoiceId);
    }
  }
}

export async function lookupCompanyByRealmId(realmId: string): Promise<string | null> {
  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.qboRealmId, realmId))
    .limit(1);
  return company?.id || null;
}

let cdcPollInFlight = false;

export async function runCdcPoll(): Promise<void> {
  if (cdcPollInFlight) {
    console.log("[QBO CDC] Poll already in progress, skipping");
    return;
  }
  cdcPollInFlight = true;

  try {
    console.log("[QBO CDC] Starting CDC poll...");

    const connectedCompanies = await db
      .select({
        id: companies.id,
        qboRealmId: companies.qboRealmId,
      })
      .from(companies)
      .where(and(isNotNull(companies.qboRealmId), isNotNull(companies.qboAccessToken)));

    if (connectedCompanies.length === 0) {
      console.log("[QBO CDC] No connected companies, skipping");
      return;
    }

    const changedSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    for (const company of connectedCompanies) {
      try {
        await refreshQboTokens(company.id);

        const cdcRes = await qboRequest(
          company.id,
          "GET",
          `/cdc?entities=Customer,Invoice,Item&changedSince=${encodeURIComponent(changedSince)}`
        );

        const cdcResponse = cdcRes?.CDCResponse;
        if (!Array.isArray(cdcResponse)) continue;

        for (const entitySet of cdcResponse) {
          const queryResponses = entitySet?.QueryResponse;
          if (!Array.isArray(queryResponses)) continue;

          for (const qr of queryResponses) {
            if (qr.Customer) {
              const customers = Array.isArray(qr.Customer) ? qr.Customer : [qr.Customer];
              for (const customer of customers) {
                try {
                  const qboId = String(customer.Id);
                  if (customer.status === "Deleted") {
                    const matching = await db
                      .select()
                      .from(contacts)
                      .where(
                        and(eq(contacts.companyId, company.id), eq(contacts.qboCustomerId, qboId))
                      );
                    for (const c of matching) {
                      await db
                        .update(contacts)
                        .set({ qboCustomerId: null })
                        .where(eq(contacts.id, c.id));
                      await logSync(company.id, "contact", c.id, "cdc-unlink", "synced", qboId);
                    }
                  } else {
                    await updateLocalContactFromQboCustomer(company.id, qboId);
                  }
                } catch (err: any) {
                  console.error(`[QBO CDC] Customer processing error:`, err.message);
                  await logSync(
                    company.id,
                    "customer",
                    String(customer.Id),
                    "cdc-update",
                    "error",
                    String(customer.Id),
                    err.message
                  ).catch(() => {});
                }
              }
            }

            if (qr.Invoice) {
              const qboInvoices = Array.isArray(qr.Invoice) ? qr.Invoice : [qr.Invoice];
              for (const qboInv of qboInvoices) {
                try {
                  const qboId = String(qboInv.Id);
                  if (qboInv.status === "Deleted") {
                    const matching = await db
                      .select()
                      .from(invoices)
                      .where(
                        and(eq(invoices.companyId, company.id), eq(invoices.qboInvoiceId, qboId))
                      );
                    for (const inv of matching) {
                      await db
                        .update(invoices)
                        .set({ qboInvoiceId: null })
                        .where(eq(invoices.id, inv.id));
                      await logSync(company.id, "invoice", inv.id, "cdc-unlink", "synced", qboId);
                    }
                  } else if (qboInv.PrivateNote?.includes("Voided")) {
                    await handleQboInvoiceVoid(company.id, qboId);
                  } else {
                    await updateLocalInvoiceFromQboInvoice(company.id, qboId);
                  }
                } catch (err: any) {
                  console.error(`[QBO CDC] Invoice processing error:`, err.message);
                  await logSync(
                    company.id,
                    "invoice",
                    String(qboInv.Id),
                    "cdc-update",
                    "error",
                    String(qboInv.Id),
                    err.message
                  ).catch(() => {});
                }
              }
            }

            if (qr.Item) {
              const items = Array.isArray(qr.Item) ? qr.Item : [qr.Item];
              for (const item of items) {
                await logSync(
                  company.id,
                  "item",
                  String(item.Id),
                  "cdc-update",
                  "synced",
                  String(item.Id)
                );
              }
            }
          }
        }

        console.log(
          `[QBO CDC] Completed poll for company ${company.id} (realm=${company.qboRealmId})`
        );
      } catch (err: any) {
        console.error(`[QBO CDC] Failed for company ${company.id}:`, err.message);
      }
    }

    console.log("[QBO CDC] Poll complete");
  } finally {
    cdcPollInFlight = false;
  }
}

export function startCdcPolling(): void {
  const SIX_HOURS = 6 * 60 * 60 * 1000;

  setTimeout(() => {
    runCdcPoll().catch((err) => console.error("[QBO CDC] Initial poll error:", err));

    setInterval(() => {
      runCdcPoll().catch((err) => console.error("[QBO CDC] Scheduled poll error:", err));
    }, SIX_HOURS);
  }, 90_000);

  console.log("[QBO CDC] Polling scheduled (first run in 90s, then every 6 hours)");
}

export async function disconnectQbo(companyId: string): Promise<void> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (company?.qboAccessToken) {
    try {
      const auth = Buffer.from(
        `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
      ).toString("base64");
      await fetch("https://developer.api.intuit.com/v2/oauth2/tokens/revoke", {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token: decryptToken(company.qboAccessToken) }),
      });
    } catch (err) {
      console.error("Failed to revoke QBO token:", err);
    }
  }

  await db
    .update(companies)
    .set({
      qboAccessToken: null,
      qboRefreshToken: null,
      qboTokenExpiresAt: null,
      qboRealmId: null,
      qboConnectedAt: null,
      qboIncomeAccountRef: null,
    })
    .where(eq(companies.id, companyId));
}
