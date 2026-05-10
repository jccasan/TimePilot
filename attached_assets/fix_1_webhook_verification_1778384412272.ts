// =============================================================================
// FILE 1: /lib/telnyx-verify.ts
// Verifies Telnyx webhook signatures using their public key.
// Drop this next to your sms.ts utility.
// =============================================================================
//
// SETUP:
// 1. Go to Telnyx Portal → API Keys → find your Public Key (starts with "phk_")
// 2. Add to .env.local:
//    TELNYX_PUBLIC_KEY=phk_your_key_here
// =============================================================================

import { createVerify } from 'crypto';

export function verifyTelnyxSignature(req: {
  headers: { get: (key: string) => string | null };
  rawBody: string;
}): boolean {
  const publicKey = process.env.TELNYX_PUBLIC_KEY;
  if (!publicKey) {
    console.error('[TELNYX_VERIFY] TELNYX_PUBLIC_KEY not set');
    return false;
  }

  const signature = req.headers.get('telnyx-signature-ed25519');
  const timestamp = req.headers.get('telnyx-timestamp');

  if (!signature || !timestamp) {
    console.warn('[TELNYX_VERIFY] Missing signature or timestamp headers');
    return false;
  }

  // Reject webhooks older than 5 minutes — prevents replay attacks
  const webhookAge = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (webhookAge > 300) {
    console.warn(`[TELNYX_VERIFY] Webhook too old: ${webhookAge}s`);
    return false;
  }

  try {
    const signedPayload = `${timestamp}|${req.rawBody}`;
    const verify = createVerify('Ed25519');
    verify.update(signedPayload);
    const isValid = verify.verify(
      `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`,
      Buffer.from(signature, 'base64')
    );
    return isValid;
  } catch (err) {
    console.error('[TELNYX_VERIFY] Verification error:', err);
    return false;
  }
}


// =============================================================================
// FILE 2: /app/api/sms/inbound/route.ts
// Updated to verify Telnyx signature before processing anything.
// Replace your existing inbound route with this.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendSMS, formatE164 } from '@/lib/sms';
import { verifyTelnyxSignature } from '@/lib/telnyx-verify';

const SMS_SYSTEM_PROMPT = `You are a friendly scheduling agent for {businessName}. You are having a text message conversation with a customer.

CRITICAL RULES:
1. NEVER invent any business detail — pricing, service area, policies, availability, hours, or add-ons. If you don't know something from the tenant data provided, say exactly: "I'm not certain about that. Let me follow up with management and we'll get back to you."
2. Keep every message SHORT. This is SMS. No paragraphs. One question per message.
3. Ask one question at a time.
4. Use only the tenant data provided below.

TENANT DATA:
{tenantData}

YOUR GOALS:
- Identify what the customer needs (new service, existing customer support, question).
- For new customers: collect service address/ZIP, number of dogs, yard size, fenced/unfenced, desired frequency, first name, last name, phone, email.
- For existing customers: identify them by last name + address or phone, then help with their issue.
- Once you have first name, last name, phone, email, and address confirmed: respond with EXACTLY this JSON on its own line and nothing else:
  SUBMIT_LEAD:{"firstName":"...","lastName":"...","phone":"...","email":"...","streetAddress":"...","city":"...","state":"...","zipcode":"...","numberOfDogs":"...","yardSize":"...","serviceFrequency":"...","accumulationLevel":"...","accessNotes":"...","preferredDay":"..."}

OPENING (first message only):
"Hi! Thanks for texting {businessName}. How can I help you today?"`;

export async function POST(req: NextRequest) {
  // 1. Read raw body first — needed for signature verification
  const rawBody = await req.text();

  // 2. Verify Telnyx signature — reject anything that doesn't pass
  const isValid = verifyTelnyxSignature({
    headers: { get: (key: string) => req.headers.get(key) },
    rawBody,
  });

  if (!isValid) {
    console.warn('[SMS_INBOUND] Rejected — invalid Telnyx signature');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 3. Parse body (we already read it as text above)
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const event = body?.data;
  if (!event || event.event_type !== 'message.received') {
    return NextResponse.json({ ok: true });
  }

  const payload = event.payload;
  const fromNumber: string = payload?.from?.phone_number;
  const toNumber: string = payload?.to?.[0]?.phone_number;
  const incomingText: string = payload?.text?.trim();

  if (!fromNumber || !toNumber || !incomingText) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // 4. Look up tenant by the 'to' number
  const tenantResult = await db.query(
    `SELECT id, business_name, telnyx_from_number,
            service_area, services, pricing, policies,
            hours, booking_rules, addons, guarantees, escalation_path
     FROM tenants WHERE telnyx_from_number = $1`,
    [toNumber]
  );

  if (!tenantResult.rows.length) {
    console.error(`[SMS_INBOUND] No tenant found for number ${toNumber}`);
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const tenant = tenantResult.rows[0];
  const tenantData = JSON.stringify({
    businessName: tenant.business_name,
    serviceArea: tenant.service_area,
    services: tenant.services,
    pricing: tenant.pricing,
    policies: tenant.policies,
    hours: tenant.hours,
    bookingRules: tenant.booking_rules,
    addons: tenant.addons,
    guarantees: tenant.guarantees,
    escalationPath: tenant.escalation_path,
  });

  // 5. Load or create session
  const session = await db.query(
    `SELECT * FROM sms_sessions WHERE from_number = $1 AND to_number = $2`,
    [fromNumber, toNumber]
  );

  let messages: { role: string; content: string }[] = [];

  if (!session.rows.length) {
    messages = [];
    await db.query(
      `INSERT INTO sms_sessions (tenant_id, from_number, to_number, messages)
       VALUES ($1, $2, $3, $4)`,
      [tenant.id, fromNumber, toNumber, JSON.stringify(messages)]
    );
  } else {
    messages = session.rows[0].messages || [];
  }

  // 6. Append incoming message
  messages.push({ role: 'user', content: incomingText });

  // 7. Build system prompt
  const systemPrompt = SMS_SYSTEM_PROMPT
    .replace(/{businessName}/g, tenant.business_name)
    .replace(/{tenantData}/g, tenantData);

  // 8. Call Claude
  let agentReply = '';
  try {
    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: systemPrompt,
        messages,
      }),
    });

    const apiData = await apiResponse.json();
    agentReply = apiData?.content?.[0]?.text?.trim() || '';
  } catch (err) {
    console.error('[SMS_INBOUND] Claude API error:', err);
    agentReply = "I'm having a technical issue. A team member will follow up with you shortly.";
  }

  // 9. Check for lead submission
  const submitMatch = agentReply.match(/SUBMIT_LEAD:(\{.*\})/);
  if (submitMatch) {
    try {
      const leadData = JSON.parse(submitMatch[1]);
      await fetch('https://app.scooppilot.com/api/retell/create-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...leadData,
          tenantId: tenant.id,
          leadSource: 'sms',
        }),
      });
      agentReply = agentReply.replace(/SUBMIT_LEAD:\{.*\}/, '').trim();
      if (!agentReply) {
        agentReply = `Got it! We've got your info and someone from ${tenant.business_name} will be in touch shortly.`;
      }
    } catch (err) {
      console.error('[SMS_INBOUND] Lead submission failed:', err);
      agentReply = "I've noted your details. A team member will follow up with you shortly.";
    }
  }

  // 10. Append agent reply and update session
  messages.push({ role: 'assistant', content: agentReply });
  await db.query(
    `UPDATE sms_sessions
     SET messages = $1, updated_at = NOW()
     WHERE from_number = $2 AND to_number = $3`,
    [JSON.stringify(messages), fromNumber, toNumber]
  );

  // 11. Send SMS reply
  try {
    await sendSMS(fromNumber, toNumber, agentReply);
  } catch (err) {
    console.error('[SMS_INBOUND] Failed to send reply:', err);
  }

  return NextResponse.json({ ok: true });
}
