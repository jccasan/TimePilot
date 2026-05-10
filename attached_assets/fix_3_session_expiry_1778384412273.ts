// =============================================================================
// FILE 1: Migration — add expiry support to sms_sessions
// Run this once against your Postgres database.
// =============================================================================
//
// If you haven't created sms_sessions yet, use the full CREATE TABLE below.
// If it already exists, use the ALTER TABLE version.
//
// OPTION A — Table doesn't exist yet (run this):
// -----------------------------------------------------------------------------
// CREATE TABLE sms_sessions (
//   id SERIAL PRIMARY KEY,
//   tenant_id TEXT NOT NULL,
//   from_number TEXT NOT NULL,
//   to_number TEXT NOT NULL,
//   messages JSONB NOT NULL DEFAULT '[]',
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   updated_at TIMESTAMPTZ DEFAULT NOW(),
//   UNIQUE(from_number, to_number)
// );
// CREATE INDEX idx_sms_sessions_updated_at ON sms_sessions (updated_at);
//
// OPTION B — Table already exists (run this):
// -----------------------------------------------------------------------------
// CREATE INDEX IF NOT EXISTS idx_sms_sessions_updated_at ON sms_sessions (updated_at);
//
// The updated_at column already exists from the original schema.
// The index is what makes the expiry cleanup query fast.
// =============================================================================


// =============================================================================
// FILE 2: /lib/sms-session.ts
// Session management with expiry.
// Replaces the inline session logic in your inbound route.
// =============================================================================

import { db } from '@/lib/db';

const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export type Message = { role: string; content: string };

/**
 * Load an existing session if it exists and hasn't expired.
 * If expired, deletes it and returns null (triggers a fresh session).
 * If not found, returns null.
 */
export async function loadSession(
  fromNumber: string,
  toNumber: string
): Promise<Message[] | null> {
  const result = await db.query(
    `SELECT messages, updated_at FROM sms_sessions
     WHERE from_number = $1 AND to_number = $2`,
    [fromNumber, toNumber]
  );

  if (!result.rows.length) return null;

  const { messages, updated_at } = result.rows[0];
  const age = Date.now() - new Date(updated_at).getTime();

  if (age > SESSION_EXPIRY_MS) {
    // Session expired — delete it so a fresh one gets created
    await db.query(
      `DELETE FROM sms_sessions WHERE from_number = $1 AND to_number = $2`,
      [fromNumber, toNumber]
    );
    console.log(`[SMS_SESSION] Expired session deleted for ${fromNumber}`);
    return null;
  }

  return messages as Message[];
}

/**
 * Create a new session.
 */
export async function createSession(
  tenantId: string,
  fromNumber: string,
  toNumber: string,
  messages: Message[]
): Promise<void> {
  await db.query(
    `INSERT INTO sms_sessions (tenant_id, from_number, to_number, messages)
     VALUES ($1, $2, $3, $4)`,
    [tenantId, fromNumber, toNumber, JSON.stringify(messages)]
  );
}

/**
 * Update an existing session with new messages.
 */
export async function updateSession(
  fromNumber: string,
  toNumber: string,
  messages: Message[]
): Promise<void> {
  await db.query(
    `UPDATE sms_sessions
     SET messages = $1, updated_at = NOW()
     WHERE from_number = $2 AND to_number = $3`,
    [JSON.stringify(messages), fromNumber, toNumber]
  );
}


// =============================================================================
// FILE 3: /app/api/sms/cleanup/route.ts
// Deletes sessions older than 24 hours.
// Call this on a cron schedule — daily is fine.
//
// If you use Vercel: add a cron job in vercel.json (see bottom of file).
// If you use another scheduler: hit GET /api/sms/cleanup on your schedule.
// Protect it with a secret so it can't be triggered externally.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  // Simple secret check — add CLEANUP_SECRET to your env
  const secret = req.headers.get('x-cleanup-secret');
  if (secret !== process.env.CLEANUP_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await db.query(
      `DELETE FROM sms_sessions
       WHERE updated_at < NOW() - INTERVAL '24 hours'
       RETURNING id`
    );

    const deleted = result.rows.length;
    console.log(`[SMS_CLEANUP] Deleted ${deleted} expired sessions`);
    return NextResponse.json({ deleted });
  } catch (err) {
    console.error('[SMS_CLEANUP] Failed:', err);
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}


// =============================================================================
// VERCEL CRON CONFIG — add to vercel.json at your project root:
// =============================================================================
// {
//   "crons": [
//     {
//       "path": "/api/sms/cleanup",
//       "schedule": "0 3 * * *"
//     }
//   ]
// }
//
// This runs the cleanup daily at 3am UTC.
// Add the x-cleanup-secret header in your cron config or use Vercel's
// built-in CRON_SECRET environment variable if you switch to that pattern.
// =============================================================================


// =============================================================================
// USAGE: Update /app/api/sms/inbound/route.ts to use the session helpers.
// Replace the session load/create/update blocks with:
//
// import { loadSession, createSession, updateSession } from '@/lib/sms-session';
//
// // Load session (handles expiry automatically)
// let messages = await loadSession(fromNumber, toNumber);
// const isNewSession = messages === null;
// if (isNewSession) {
//   messages = [];
//   await createSession(tenant.id, fromNumber, toNumber, messages);
// }
//
// // ... rest of your handler ...
//
// // Update session at the end
// await updateSession(fromNumber, toNumber, messages);
// =============================================================================
