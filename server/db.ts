import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 10,
});

pool.on("error", (err) => {
  console.error("[DB Pool] Idle client error:", err.message);
});

const TRANSIENT_CODES = new Set(["08P01", "08006", "08001", "08004", "57P01"]);

function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code && TRANSIENT_CODES.has(e.code)) return true;
  if (e.message?.includes("Connection terminated unexpectedly")) return true;
  if (e.message?.includes("Authentication timed out")) return true;
  return false;
}

export async function withDbRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 600): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (retries > 0 && isTransientDbError(err)) {
      const code = (err as { code?: string }).code ?? "unknown";
      console.warn(`[DB] Transient error (${code}), retrying in ${delayMs}ms… (${retries} left)`);
      await new Promise((r) => setTimeout(r, delayMs));
      return withDbRetry(fn, retries - 1, delayMs * 2);
    }
    throw err;
  }
}

export const db = drizzle(pool, { schema });
