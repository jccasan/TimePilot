// INFRASTRUCTURE REQUIRED BEFORE THIS FEATURE IS LIVE:
// 1. Add MX records for mail.scoopilot.com pointing to SendGrid inbound
//    parse servers (mx.sendgrid.net, priority 10)
// 2. Configure SendGrid Inbound Parse in the SendGrid dashboard:
//    - Host: mail.scoopilot.com
//    - Destination URL: https://{APP_URL}/api/webhooks/sendgrid/inbound
//    - Check "POST the raw, full MIME message" if needed for header parsing
// These are DNS/dashboard steps — no code can do them.

import { storage } from "../storage";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { contacts, companies } from "@shared/schema";
import type { Company } from "@shared/schema";

const INBOUND_DOMAIN = "mail.scoopilot.com";

export function buildInboundAddress(slug: string): string {
  return `crm.${slug}@${INBOUND_DOMAIN}`;
}

export async function generateInboundSlug(
  name: string,
  phone: string,
  existingCheck: (slug: string) => Promise<boolean>
): Promise<string> {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);

  const phoneDigits = phone.replace(/\D/g, "");
  const phone4 = phoneDigits.slice(-10, -6);
  const phone10 = phoneDigits.slice(-10);

  const candidates = [base, `${base}${phone4}`, `${base}${phone10}`];

  for (const slug of candidates) {
    if (!slug) continue;
    const taken = await existingCheck(slug);
    if (!taken) return slug;
  }

  const fallback = `${base}${Date.now().toString(36)}`;
  return fallback;
}

export async function provisionInboundEmail(
  company: Pick<Company, "id" | "name" | "phone" | "inboundEmail" | "inboundEmailSlug">
): Promise<{ pending: boolean; inboundEmail?: string }> {
  if (company.inboundEmail) {
    return { pending: false, inboundEmail: company.inboundEmail };
  }

  if (!company.phone) {
    return { pending: true };
  }

  const slug = await generateInboundSlug(company.name, company.phone, async (candidate) => {
    const [existing] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.inboundEmailSlug, candidate))
      .limit(1);
    return !!existing;
  });

  const inboundEmail = buildInboundAddress(slug);

  await storage.updateCompany(company.id, {
    inboundEmail,
    inboundEmailSlug: slug,
  });

  console.log(`[InboundEmail] Provisioned ${inboundEmail} for company ${company.id}`);
  return { pending: false, inboundEmail };
}

interface InboundEmailPayload {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  headers?: string;
  envelope?: string;
}

function extractEmailFromHeader(value: string): { address: string; name: string } | null {
  // "Display Name <user@example.com>" or just "user@example.com"
  const angleMatch = value.match(/^(.+?)\s*<([^>]+@[^>]+)>\s*$/);
  if (angleMatch) {
    return {
      address: angleMatch[2].toLowerCase().trim(),
      name: angleMatch[1].replace(/"/g, "").trim(),
    };
  }
  const bareMatch = value.match(/\S+@\S+/);
  if (bareMatch) {
    return { address: bareMatch[0].toLowerCase().trim(), name: "" };
  }
  return null;
}

function parseForwardedSender(
  headers: Record<string, string>,
  textBody: string,
  envelopeFrom: string
): { address: string; name: string } {
  // 1. Outlook / Exchange raw forwarded headers — highest priority because
  //    the Inbox Rule that forwards the email sets these before modifying From.
  //    X-MS-Exchange-Inbox-Rules-Loop contains the *original sender* email when
  //    a rule fires; X-MS-Forwarded-To-Mailbox and the Reply-To header are also
  //    sometimes present. We check several variants in order of reliability.
  const msOriginalSender =
    headers["X-MS-Exchange-Inbox-Rules-Loop"] ||
    headers["X-MS-Exchange-P2-OrigFrom"] ||
    headers["X-Original-From"] ||
    headers["X-Forwarded-From"];

  if (msOriginalSender) {
    const parsed = extractEmailFromHeader(msOriginalSender);
    if (parsed) return parsed;
    // Sometimes the Inbox-Rules-Loop header is just a bare email with no angle brackets
    const bare = msOriginalSender.match(/\S+@\S+/);
    if (bare) return { address: bare[0].toLowerCase().trim(), name: "" };
  }

  // 2. Gmail "---------- Forwarded message ---------" pattern in body
  const gmailPattern =
    /[-]+\s*Forwarded message\s*[-]+[\s\S]{0,400}?From:\s*(.+?)\s*<([^>]+@[^>]+)>/i;
  const gmailMatch = textBody.match(gmailPattern);
  if (gmailMatch) {
    return { address: gmailMatch[2].toLowerCase().trim(), name: gmailMatch[1].trim() };
  }

  // 3. Outlook forwarded message body pattern: "From: Name <email>\r?\nSent:"
  const outlookPattern = /From:\s*(.+?)\s*<([^>]+@[^>]+)>[\s\S]{0,200}?Sent:/i;
  const outlookMatch = textBody.match(outlookPattern);
  if (outlookMatch) {
    return { address: outlookMatch[2].toLowerCase().trim(), name: outlookMatch[1].trim() };
  }

  // 4. Fall back to the envelope From header (direct sender, not forwarded)
  const fallback = extractEmailFromHeader(envelopeFrom);
  if (fallback) return fallback;
  return { address: envelopeFrom.toLowerCase().trim(), name: "" };
}

export async function handleTenantInboundEmail(payload: InboundEmailPayload): Promise<void> {
  try {
    const toAddress = payload.to.toLowerCase();
    const slugMatch = toAddress.match(/^crm\.([a-z0-9_-]+)@/i);
    if (!slugMatch) {
      console.warn(`[InboundEmail] Could not extract slug from to: ${toAddress}`);
      return;
    }
    const slug = slugMatch[1];

    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.inboundEmailSlug, slug))
      .limit(1);

    if (!company) {
      console.warn(`[InboundEmail] No company found for slug=${slug}`);
      return;
    }

    const rawHeaders: Record<string, string> = {};
    if (payload.headers) {
      for (const line of payload.headers.split("\n")) {
        const idx = line.indexOf(":");
        if (idx > 0) {
          const key = line.slice(0, idx).trim();
          const val = line.slice(idx + 1).trim();
          rawHeaders[key] = val;
        }
      }
    }

    const { address: fromAddress, name: fromName } = parseForwardedSender(
      rawHeaders,
      payload.text || "",
      payload.from
    );

    const { sql: sqlFn } = await import("drizzle-orm");
    const [matchedContact] = await db
      .select()
      .from(contacts)
      .where(
        sqlFn`${contacts.companyId} = ${company.id}
          AND lower(${contacts.email}) = ${fromAddress}`
      )
      .limit(1);

    const preview = (payload.text || "").slice(0, 200);

    const inboundEmail = await storage.createInboundEmail({
      tenantId: company.id,
      fromAddress,
      fromName: fromName || null,
      subject: payload.subject || null,
      bodyText: payload.text || null,
      bodyHtml: payload.html || null,
      matchedContactId: matchedContact?.id || null,
      rawHeaders,
      status: matchedContact ? "matched" : "unmatched",
    });

    if (matchedContact) {
      await storage.createActivityLog({
        companyId: company.id,
        contactId: matchedContact.id,
        action: "email_inbound",
        details: {
          inboundEmailId: inboundEmail.id,
          subject: payload.subject || "",
          fromName: fromName || "",
          fromAddress,
          preview,
        },
      });
      console.log(
        `[InboundEmail] Matched to contact ${matchedContact.id} for company ${company.id}`
      );
    } else {
      console.log(
        `[InboundEmail] No contact match for ${fromAddress}, company ${company.id} — queued for review`
      );
    }
  } catch (err) {
    console.error("[InboundEmail] handleTenantInboundEmail error:", err);
  }
}
