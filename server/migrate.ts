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

    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS import_mode BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log("[Migration] users import_mode column verified");

    // Ensure the demo account always has unlimited credits enabled.
    // This is idempotent — it only updates when the flag is currently false.
    await client.query(`
      UPDATE companies
        SET demo_unlimited_credits = TRUE
      WHERE demo_unlimited_credits = FALSE
        AND id IN (
          SELECT cu.company_id
          FROM users u
          JOIN company_users cu ON cu.user_id = u.id
          WHERE u.email = 'demo@scoopilot.com'
          LIMIT 1
        )
    `);
    console.log("[Migration] Demo account demo_unlimited_credits flag verified");

    await client.query(`
      CREATE TABLE IF NOT EXISTS system_health_checks (
        check_name  VARCHAR(100) PRIMARY KEY,
        status      VARCHAR(10)  NOT NULL,
        severity    VARCHAR(10)  NOT NULL,
        message     TEXT         NOT NULL,
        last_run_at TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);
    console.log("[Migration] system_health_checks table ensured");

    // Add company_id to api_usage_daily for per-tenant attribution
    await client.query(`
      ALTER TABLE api_usage_daily
        ADD COLUMN IF NOT EXISTS company_id VARCHAR REFERENCES companies(id) ON DELETE SET NULL
    `);
    // Replace the single unique index with two partial unique indexes:
    //   - one for platform-wide rows (company_id IS NULL)
    //   - one for per-tenant rows (company_id IS NOT NULL)
    await client.query(`
      DROP INDEX IF EXISTS idx_api_usage_daily_uniq
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_api_usage_daily_uniq_global
        ON api_usage_daily (date, provider, metric)
        WHERE company_id IS NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_api_usage_daily_uniq_tenant
        ON api_usage_daily (date, provider, metric, company_id)
        WHERE company_id IS NOT NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_api_usage_daily_company
        ON api_usage_daily (company_id)
    `);
    console.log("[Migration] api_usage_daily company_id attribution column and indexes ensured");

    console.log("[Migrate] Startup schema migrations applied successfully");
  } catch (err) {
    console.error("[Migrate] Startup migration failed:", err);
    throw err;
  } finally {
    client.release();
  }
}
