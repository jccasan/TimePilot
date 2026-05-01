import { pool } from "./db";

export async function runStartupMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS geocode_cache (
        address_key VARCHAR(512) PRIMARY KEY,
        latitude    VARCHAR(32),
        longitude   VARCHAR(32),
        cached_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_geocode_cache_cached_at
        ON geocode_cache (cached_at)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS autocomplete_cache (
        query_key VARCHAR(512) PRIMARY KEY,
        results   JSONB NOT NULL,
        cached_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_autocomplete_cache_cached_at
        ON autocomplete_cache (cached_at)
    `);

    await client.query(`
      ALTER TABLE companies
        ADD COLUMN IF NOT EXISTS review_router_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS pass_stripe_fees BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS require_card_on_signup BOOLEAN NOT NULL DEFAULT TRUE
    `);

    // Set the DB-level column default to 50 so new companies get 50 without
    // needing an explicit value in the INSERT.
    await client.query(`
      ALTER TABLE companies
        ALTER COLUMN max_stops_per_route SET DEFAULT 50
    `);

    // Raise existing companies that still have the old default of 25 to 50,
    // preserving any intentional custom values set to other numbers.
    await client.query(`
      UPDATE companies
        SET max_stops_per_route = 50
      WHERE max_stops_per_route = 25
         OR max_stops_per_route IS NULL
    `);

    // One-time data fix: add 25 route credits to Lake Erie Scoopers (production only)
    // Confirmed pre-fix value: 5. Target: 30. WHERE guard makes this idempotent.
    // Remove this block after the next production deploy confirms route_credits = 30.
    if (process.env.NODE_ENV === "production") {
      const lakeErieResult = await client.query(`
        UPDATE companies
          SET route_credits = route_credits + 25
        WHERE id = '8089c512-bec6-47e1-9678-ec3e3eda4e95'
          AND route_credits = 5
      `);
      if (lakeErieResult.rowCount && lakeErieResult.rowCount > 0) {
        console.log("[Migrate] Applied +25 route credits to Lake Erie Scoopers (now 30)");
      }
    }

    console.log("[Migrate] Startup schema migrations applied successfully");
  } catch (err) {
    console.error("[Migrate] Startup migration failed:", err);
    throw err;
  } finally {
    client.release();
  }
}
