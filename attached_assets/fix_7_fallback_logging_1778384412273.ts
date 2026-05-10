// =============================================================================
// FILE 1: Migration — create fallback_log table
// Run this once against your Postgres database.
// =============================================================================
//
// CREATE TABLE fallback_log (
//   id SERIAL PRIMARY KEY,
//   tenant_id TEXT NOT NULL,
//   channel TEXT NOT NULL,           -- 'voice' | 'chat' | 'sms'
//   trigger_phrase TEXT NOT NULL,    -- what the customer asked
//   agent_response TEXT NOT NULL,    -- what the agent said
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
//
// CREATE INDEX idx_fallback_log_tenant_id ON fallback_log (tenant_id);
// CREATE INDEX idx_fallback_log_created_at ON fallback_log (created_at);
// =============================================================================


// =============================================================================
// FILE 2: /lib/fallback-log.ts
// Logs whenever the agent hits the never-invent fallback.
// Used in the SMS inbound handler. For voice/chat, use a Retell webhook.
// =============================================================================

import { db } from '@/lib/db';

export async function logFallback(params: {
  tenantId: string;
  channel: 'voice' | 'chat' | 'sms';
  triggerPhrase: string;
  agentResponse: string;
}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO fallback_log (tenant_id, channel, trigger_phrase, agent_response)
       VALUES ($1, $2, $3, $4)`,
      [
        params.tenantId,
        params.channel,
        params.triggerPhrase,
        params.agentResponse,
      ]
    );
  } catch (err) {
    // Never let logging failures affect the main request
    console.error('[FALLBACK_LOG] Failed to log:', err);
  }
}

// Detects whether the agent response contains the never-invent fallback phrase
export function isFallbackResponse(response: string): boolean {
  return response.toLowerCase().includes("i'm not certain about that");
}


// =============================================================================
// FILE 3: /app/api/sms/inbound/route.ts (fallback logging addition)
// Add this after you receive the agent reply (after step 8 in your handler).
//
// import { logFallback, isFallbackResponse } from '@/lib/fallback-log';
//
// if (isFallbackResponse(agentReply)) {
//   await logFallback({
//     tenantId: tenant.id,
//     channel: 'sms',
//     triggerPhrase: incomingText,
//     agentResponse: agentReply,
//   });
// }
// =============================================================================


// =============================================================================
// FILE 4: /app/api/retell/call-webhook/route.ts
// Retell posts call/chat transcripts to a webhook after each conversation.
// Use this to log fallbacks from voice and chat channels.
//
// SETUP:
// In Retell dashboard → Agent Settings → Post Call Webhook:
// Set to: https://app.scooppilot.com/api/retell/call-webhook
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logFallback, isFallbackResponse } from '@/lib/fallback-log';

const FALLBACK_PHRASE = "i'm not certain about that";

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Retell sends transcript as an array of utterances
  const transcript: { role: string; content: string }[] =
    body?.transcript || [];
  const channel: string = body?.channel || 'voice';
  const tenantId: string = body?.custom_analysis_data?.tenantId || '';

  if (!transcript.length || !tenantId) {
    return NextResponse.json({ ok: true });
  }

  // Walk through the transcript looking for fallback responses
  for (let i = 0; i < transcript.length; i++) {
    const utterance = transcript[i];

    if (
      utterance.role === 'agent' &&
      isFallbackResponse(utterance.content)
    ) {
      // The trigger phrase is what the customer said immediately before
      const triggerPhrase =
        i > 0 && transcript[i - 1].role === 'user'
          ? transcript[i - 1].content
          : 'unknown';

      await logFallback({
        tenantId,
        channel: channel as 'voice' | 'chat' | 'sms',
        triggerPhrase,
        agentResponse: utterance.content,
      });
    }
  }

  return NextResponse.json({ ok: true });
}


// =============================================================================
// FILE 5: /app/api/admin/fallback-report/route.ts
// Simple endpoint to pull fallback logs per tenant.
// Use this to review what questions tenants' agents can't answer.
// Protect with your existing admin auth.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get('tenantId');
  const days = parseInt(searchParams.get('days') || '30', 10);

  const query = tenantId
    ? `SELECT tenant_id, channel, trigger_phrase, agent_response, created_at
       FROM fallback_log
       WHERE tenant_id = $1
         AND created_at > NOW() - INTERVAL '${days} days'
       ORDER BY created_at DESC
       LIMIT 100`
    : `SELECT tenant_id, channel, trigger_phrase, agent_response, created_at
       FROM fallback_log
       WHERE created_at > NOW() - INTERVAL '${days} days'
       ORDER BY created_at DESC
       LIMIT 100`;

  const params = tenantId ? [tenantId] : [];

  try {
    const result = await db.query(query, params);
    return NextResponse.json({ logs: result.rows });
  } catch (err) {
    console.error('[FALLBACK_REPORT] Query failed:', err);
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }
}

// =============================================================================
// WHAT THIS GIVES YOU:
// - Every time a customer asks something the agent can't answer, it's logged
// - You can pull reports per tenant to see what's missing from their config
// - Over time this tells you exactly what to add to tenant KBs or config
//   to reduce fallback frequency
// =============================================================================
