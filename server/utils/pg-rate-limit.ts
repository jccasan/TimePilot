import type { Store, Options, ClientRateLimitInfo } from "express-rate-limit";
import { pool } from "../db";

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS auth_rate_limits (
    key TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    reset_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (key)
  );
  CREATE INDEX IF NOT EXISTS auth_rate_limits_reset_at_idx ON auth_rate_limits (reset_at);
`;

let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await pool.query(CREATE_TABLE_SQL);
  tableEnsured = true;
}

/**
 * PostgreSQL-backed store for express-rate-limit.
 * Safe across multiple autoscaled instances — all counters live in the database.
 */
export class PgRateLimitStore implements Store {
  private windowMs: number = 15 * 60 * 1000;

  init(options: Options): void {
    this.windowMs = options.windowMs;
    ensureTable().catch((err) => console.error("[PgRateLimitStore] Failed to ensure table:", err));
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    await ensureTable();
    const windowMs = this.windowMs;
    const res = await pool.query<{ count: number; reset_at: Date }>(
      `
      INSERT INTO auth_rate_limits (key, count, reset_at)
        VALUES ($1, 1, NOW() + ($2::bigint * INTERVAL '1 millisecond'))
      ON CONFLICT (key) DO UPDATE
        SET count    = CASE
                         WHEN auth_rate_limits.reset_at <= NOW() THEN 1
                         ELSE auth_rate_limits.count + 1
                       END,
            reset_at = CASE
                         WHEN auth_rate_limits.reset_at <= NOW()
                           THEN NOW() + ($2::bigint * INTERVAL '1 millisecond')
                         ELSE auth_rate_limits.reset_at
                       END
      RETURNING count, reset_at
      `,
      [key, windowMs]
    );
    const row = res.rows[0];
    return {
      totalHits: row.count,
      resetTime: row.reset_at,
    };
  }

  async decrement(key: string): Promise<void> {
    await pool.query(
      `UPDATE auth_rate_limits SET count = GREATEST(0, count - 1) WHERE key = $1 AND reset_at > NOW()`,
      [key]
    );
  }

  async resetKey(key: string): Promise<void> {
    await pool.query(`DELETE FROM auth_rate_limits WHERE key = $1`, [key]);
  }

  async resetAll(): Promise<void> {
    await pool.query(`DELETE FROM auth_rate_limits`);
  }
}

/**
 * Lightweight PostgreSQL-backed rate limit check for manual (non-middleware) use cases.
 *
 * Returns true if the request is allowed, false if the limit has been exceeded.
 * windowMs defaults to 15 minutes.
 */
export async function checkPgRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<boolean> {
  await ensureTable();
  const res = await pool.query<{ count: number; reset_at: Date }>(
    `
    INSERT INTO auth_rate_limits (key, count, reset_at)
      VALUES ($1, 1, NOW() + ($2::bigint * INTERVAL '1 millisecond'))
    ON CONFLICT (key) DO UPDATE
      SET count    = CASE
                       WHEN auth_rate_limits.reset_at <= NOW() THEN 1
                       ELSE auth_rate_limits.count + 1
                     END,
          reset_at = CASE
                       WHEN auth_rate_limits.reset_at <= NOW()
                         THEN NOW() + ($2::bigint * INTERVAL '1 millisecond')
                       ELSE auth_rate_limits.reset_at
                     END
    RETURNING count, reset_at
    `,
    [key, windowMs]
  );
  const row = res.rows[0];
  return row.count <= maxAttempts;
}

/**
 * Record a failed attempt without checking the limit (increment only).
 * Used in portal login to record failures after the attempt is already processed.
 */
export async function recordPgFailedAttempt(key: string, windowMs: number): Promise<void> {
  await ensureTable();
  await pool.query(
    `
    INSERT INTO auth_rate_limits (key, count, reset_at)
      VALUES ($1, 1, NOW() + ($2::bigint * INTERVAL '1 millisecond'))
    ON CONFLICT (key) DO UPDATE
      SET count    = CASE
                       WHEN auth_rate_limits.reset_at <= NOW() THEN 1
                       ELSE auth_rate_limits.count + 1
                     END,
          reset_at = CASE
                       WHEN auth_rate_limits.reset_at <= NOW()
                         THEN NOW() + ($2::bigint * INTERVAL '1 millisecond')
                       ELSE auth_rate_limits.reset_at
                     END
    `,
    [key, windowMs]
  );
}

/**
 * Clear the rate limit counter for a key (e.g., on successful login).
 */
export async function clearPgRateLimit(key: string): Promise<void> {
  await pool.query(`DELETE FROM auth_rate_limits WHERE key = $1`, [key]);
}

/**
 * Return the current hit count for a key without incrementing.
 * Returns 0 if no record exists or the window has expired.
 */
export async function getPgRateLimitCount(key: string): Promise<number> {
  await ensureTable();
  const res = await pool.query<{ count: number }>(
    `SELECT count FROM auth_rate_limits WHERE key = $1 AND reset_at > NOW()`,
    [key]
  );
  return res.rows[0]?.count ?? 0;
}
