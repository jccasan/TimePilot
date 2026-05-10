// =============================================================================
// FILE 1: /lib/alert.ts
// Lightweight alerting utility.
// Sends a Slack webhook message when something critical fails.
//
// SETUP:
// 1. Create a Slack incoming webhook:
//    Slack → Your workspace → Apps → Incoming Webhooks → Add New Webhook
// 2. Add to .env.local:
//    SLACK_ALERT_WEBHOOK=https://hooks.slack.com/services/xxx/yyy/zzz
//    ALERT_ENV=production   (or staging — alerts only fire in production)
// =============================================================================

export async function sendAlert(message: string, context?: Record<string, unknown>) {
  // Only alert in production — avoid noise in dev/staging
  if (process.env.ALERT_ENV !== 'production') {
    console.warn('[ALERT suppressed in non-production]', message, context);
    return;
  }

  const webhookUrl = process.env.SLACK_ALERT_WEBHOOK;
  if (!webhookUrl) {
    console.error('[ALERT] SLACK_ALERT_WEBHOOK not set — alert not sent:', message);
    return;
  }

  const payload = {
    text: `:rotating_light: *ScooPilot Alert*\n${message}`,
    attachments: context
      ? [
          {
            color: '#ff0000',
            fields: Object.entries(context).map(([key, value]) => ({
              title: key,
              value: String(value),
              short: true,
            })),
          },
        ]
      : undefined,
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Never let alerting failures crash the main request
    console.error('[ALERT] Failed to send Slack alert:', err);
  }
}


// =============================================================================
// FILE 2: /app/api/retell/tenant-profile/route.ts
// Updated with alerting on failure.
// Wrap your existing tenant-profile handler with this pattern.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendAlert } from '@/lib/alert';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const to = searchParams.get('to');

  if (!to) {
    return NextResponse.json({ error: 'Missing to parameter' }, { status: 400 });
  }

  let tenant;
  try {
    const result = await db.query(
      `SELECT * FROM tenants WHERE phone_number = $1 OR telnyx_from_number = $1`,
      [to]
    );

    if (!result.rows.length) {
      // Alert on unknown numbers — could be misconfiguration or a routing error
      await sendAlert(
        `Tenant not found for inbound number: ${to}`,
        { number: to, timestamp: new Date().toISOString() }
      );
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    tenant = result.rows[0];
  } catch (err) {
    // DB failure — this takes down all channels simultaneously
    await sendAlert(
      'CRITICAL: tenant-profile DB query failed — all agent channels are down',
      {
        error: String(err),
        number: to,
        timestamp: new Date().toISOString(),
      }
    );
    console.error('[TENANT_PROFILE] DB error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Map tenant DB fields to tenantConfig shape expected by Retell agents
  const tenantConfig = {
    tenantId: tenant.id,
    businessName: tenant.business_name,
    primaryService: tenant.primary_service,
    serviceArea: tenant.service_area,
    services: tenant.services,
    pricing: tenant.pricing,
    availability: tenant.availability,
    policies: tenant.policies,
    hours: tenant.hours,
    booking_rules: tenant.booking_rules,
    addons: tenant.addons,
    disposal_policy: tenant.disposal_policy,
    guarantees: tenant.guarantees,
    escalationPath: tenant.escalation_path,
    managerPhone: tenant.manager_phone,
    retellApiKey: tenant.retell_api_key,
    telnyxFromNumber: tenant.telnyx_from_number,
    knowledgeBase: tenant.knowledge_base, // injected into agent context
  };

  return NextResponse.json(tenantConfig);
}


// =============================================================================
// FILE 3: /app/api/retell/create-lead/route.ts (alerting addition only)
// Add alerting to your existing create-lead route on DB failure.
// This is the addition — merge with your existing route, don't replace it.
// =============================================================================

// Add this import at the top of your existing create-lead route:
// import { sendAlert } from '@/lib/alert';

// Replace your existing DB insert try/catch with this:
//
// try {
//   await db.query(`INSERT INTO leads (...) VALUES (...)`, [...]);
// } catch (err) {
//   await sendAlert('Lead DB insert failed', {
//     tenantId,
//     firstName,
//     phone,
//     error: String(err),
//     timestamp: new Date().toISOString(),
//   });
//   console.error('[CREATE_LEAD] DB insert failed:', err);
//   return NextResponse.json({ error: 'Failed to save lead' }, { status: 500 });
// }

// =============================================================================
// WHAT GETS ALERTED:
// - Tenant not found for an inbound number (routing misconfiguration)
// - DB failure on tenant-profile (all channels down)
// - DB failure on lead creation (lead lost)
//
// WHAT DOES NOT ALERT (intentional):
// - SMS send failures (lead is saved, SMS is best-effort)
// - Rate limit rejections (logged only)
// - Invalid webhook signatures (logged only)
// These are expected failure modes that don't require immediate action.
// =============================================================================
