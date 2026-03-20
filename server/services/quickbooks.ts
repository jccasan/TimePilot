import crypto from "crypto";
import { db } from "../db";
import { companies, contacts, invoices, invoiceLineItems, qboSyncLogs } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

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
  if (!key) return plaintext;
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
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
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
  for (const [key, val] of pendingOAuthStates) {
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

export async function exchangeQboCode(code: string, redirectUri: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
}> {
  const auth = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
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

export async function refreshQboTokens(companyId: string): Promise<{ access_token: string; refresh_token: string }> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company?.qboRefreshToken) {
    throw new Error("No QBO refresh token found");
  }

  const decryptedRefreshToken = decryptToken(company.qboRefreshToken);
  const auth = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
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
      await db.update(companies).set({
        qboAccessToken: null,
        qboRefreshToken: null,
        qboTokenExpiresAt: null,
        qboRealmId: null,
        qboConnectedAt: null,
      }).where(eq(companies.id, companyId));
      throw new Error("QBO connection expired. Please reconnect your QuickBooks account.");
    }
    throw new Error(`QBO token refresh failed: ${res.status} ${errText}`);
  }
  const data = await res.json();

  await db.update(companies).set({
    qboAccessToken: encryptToken(data.access_token),
    qboRefreshToken: encryptToken(data.refresh_token),
    qboTokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
  }).where(eq(companies.id, companyId));

  return { access_token: data.access_token, refresh_token: data.refresh_token };
}

async function getValidAccessToken(companyId: string): Promise<{ token: string; realmId: string }> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company?.qboRealmId || !company?.qboAccessToken) {
    throw new Error("QuickBooks is not connected");
  }

  if (company.qboTokenExpiresAt && new Date(company.qboTokenExpiresAt) < new Date(Date.now() + 60000)) {
    const refreshed = await refreshQboTokens(companyId);
    return { token: refreshed.access_token, realmId: company.qboRealmId };
  }

  return { token: decryptToken(company.qboAccessToken), realmId: company.qboRealmId };
}

async function qboRequest(companyId: string, method: string, path: string, body?: any): Promise<any> {
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

async function logSync(companyId: string, entityType: string, entityId: string, action: string, status: "pending" | "synced" | "error", qboEntityId?: string, errorMessage?: string) {
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

export async function syncContactToQbo(companyId: string, contactId: string): Promise<{ qboCustomerId: string }> {
  const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.companyId, companyId)));
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
      BillAddr: contact.streetAddress ? {
        Line1: contact.streetAddress,
        Line2: contact.address2 || undefined,
        City: contact.city || undefined,
        CountrySubDivisionCode: contact.state || undefined,
        PostalCode: contact.zipCode || undefined,
      } : undefined,
    });

    await logSync(companyId, "contact", contactId, "update", "synced", contact.qboCustomerId);
    return { qboCustomerId: contact.qboCustomerId };
  }

  const displayName = `${contact.firstName} ${contact.lastName}`.trim();

  let existingCustomer: any = null;
  try {
    if (contact.email) {
      const searchRes = await qboRequest(companyId, "GET",
        `/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE PrimaryEmailAddr = '${contact.email.replace(/'/g, "\\'")}'`)}`);
      const customers = searchRes?.QueryResponse?.Customer;
      if (customers?.length > 0) {
        existingCustomer = customers[0];
      }
    }

    if (!existingCustomer) {
      const searchRes = await qboRequest(companyId, "GET",
        `/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${displayName.replace(/'/g, "\\'")}'`)}`);
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
      BillAddr: contact.streetAddress ? {
        Line1: contact.streetAddress,
        Line2: contact.address2 || undefined,
        City: contact.city || undefined,
        CountrySubDivisionCode: contact.state || undefined,
        PostalCode: contact.zipCode || undefined,
      } : undefined,
    });
    qboCustomerId = String(createRes.Customer.Id);
  }

  await db.update(contacts).set({ qboCustomerId }).where(eq(contacts.id, contactId));
  await logSync(companyId, "contact", contactId, existingCustomer ? "match" : "create", "synced", qboCustomerId);
  return { qboCustomerId };
}

export async function syncInvoiceToQbo(companyId: string, invoiceId: string): Promise<{ qboInvoiceId: string }> {
  const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
  if (!invoice) throw new Error("Invoice not found");

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, invoice.contactId));
  if (!contact) throw new Error("Contact not found for invoice");

  let qboCustomerId = contact.qboCustomerId;
  if (!qboCustomerId) {
    const syncResult = await syncContactToQbo(companyId, contact.id);
    qboCustomerId = syncResult.qboCustomerId;
  }

  const lineItems = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));

  let serviceItemRef = { value: "1", name: "Services" };
  try {
    const itemQuery = await qboRequest(companyId, "GET",
      `/query?query=${encodeURIComponent("SELECT * FROM Item WHERE Type = 'Service' MAXRESULTS 1")}`);
    const items = itemQuery?.QueryResponse?.Item;
    if (items?.length > 0) {
      serviceItemRef = { value: String(items[0].Id), name: items[0].Name };
    } else {
      const nonInvQuery = await qboRequest(companyId, "GET",
        `/query?query=${encodeURIComponent("SELECT * FROM Item WHERE Type = 'NonInventory' MAXRESULTS 1")}`);
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
      const updateRes = await qboRequest(companyId, "POST", `/invoice`, {
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

export async function syncPaymentToQbo(companyId: string, invoiceId: string): Promise<void> {
  const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
  if (!invoice?.qboInvoiceId) {
    await syncInvoiceToQbo(companyId, invoiceId);
  }

  const freshInvoice = (await db.select().from(invoices).where(eq(invoices.id, invoiceId)))[0];
  if (!freshInvoice?.qboInvoiceId) throw new Error("Could not sync invoice to QBO first");

  const existingPaymentLogs = await db.select().from(qboSyncLogs)
    .where(and(
      eq(qboSyncLogs.companyId, companyId),
      eq(qboSyncLogs.entityType, "payment"),
      eq(qboSyncLogs.entityId, invoiceId),
      eq(qboSyncLogs.status, "synced"),
    ))
    .limit(1);

  if (existingPaymentLogs.length > 0) {
    return;
  }

  try {
    const safeInvoiceNum = (freshInvoice.invoiceNumber || "").replace(/'/g, "\\'");
    const paymentQuery = await qboRequest(companyId, "GET",
      `/query?query=${encodeURIComponent(`SELECT * FROM Payment WHERE PaymentRefNum = '${safeInvoiceNum}'`)}`);
    const existingPayments = paymentQuery?.QueryResponse?.Payment;
    if (existingPayments?.length > 0) {
      const linked = existingPayments.find((p: any) =>
        p.Line?.some((l: any) => l.LinkedTxn?.some((t: any) => t.TxnId === freshInvoice.qboInvoiceId))
      );
      if (linked) {
        await logSync(companyId, "payment", invoiceId, "match", "synced", String(linked.Id));
        return;
      }
    }
  } catch {
  }

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, freshInvoice.contactId));

  const paymentRes = await qboRequest(companyId, "POST", `/payment`, {
    CustomerRef: { value: contact?.qboCustomerId },
    TotalAmt: parseFloat(freshInvoice.total),
    Line: [{
      Amount: parseFloat(freshInvoice.total),
      LinkedTxn: [{
        TxnId: freshInvoice.qboInvoiceId,
        TxnType: "Invoice",
      }],
    }],
  });

  await logSync(companyId, "payment", invoiceId, "create", "synced", String(paymentRes.Payment.Id));
}

export async function getQboSyncStatus(companyId: string): Promise<{
  connected: boolean;
  realmId: string | null;
  connectedAt: string | null;
  lastSync: string | null;
  totalSynced: number;
  totalErrors: number;
  recentLogs: any[];
}> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const connected = !!(company?.qboRealmId && company?.qboAccessToken);

  const logs = await db.select().from(qboSyncLogs)
    .where(eq(qboSyncLogs.companyId, companyId))
    .orderBy(desc(qboSyncLogs.createdAt))
    .limit(50);

  const totalSynced = logs.filter(l => l.status === "synced").length;
  const totalErrors = logs.filter(l => l.status === "error").length;
  const lastSyncedLog = logs.find(l => l.status === "synced");

  return {
    connected,
    realmId: company?.qboRealmId || null,
    connectedAt: company?.qboConnectedAt?.toISOString() || null,
    lastSync: lastSyncedLog?.syncedAt?.toISOString() || null,
    totalSynced,
    totalErrors,
    recentLogs: logs.slice(0, 20).map(l => ({
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

export async function runFullSync(companyId: string): Promise<{ contactsSynced: number; invoicesSynced: number; errors: string[] }> {
  const errors: string[] = [];
  let contactsSynced = 0;
  let invoicesSynced = 0;

  const allContacts = await db.select().from(contacts)
    .where(and(eq(contacts.companyId, companyId), sql`${contacts.status} IN ('active', 'lead', 'estimate', 'paused')`));

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

  const allInvoices = await db.select().from(invoices)
    .where(and(eq(invoices.companyId, companyId), sql`${invoices.status} IN ('sent', 'pending', 'paid')`));

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

export async function disconnectQbo(companyId: string): Promise<void> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (company?.qboAccessToken) {
    try {
      const auth = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
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

  await db.update(companies).set({
    qboAccessToken: null,
    qboRefreshToken: null,
    qboTokenExpiresAt: null,
    qboRealmId: null,
    qboConnectedAt: null,
    qboIncomeAccountRef: null,
  }).where(eq(companies.id, companyId));
}
