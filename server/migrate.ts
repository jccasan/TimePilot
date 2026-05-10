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

    // Voice Agent columns on companies table
    await client.query(`
      ALTER TABLE companies
        ADD COLUMN IF NOT EXISTS voice_area_code_preference VARCHAR(3),
        ADD COLUMN IF NOT EXISTS voice_number_porting_status VARCHAR(20)
    `);
    console.log(
      "[Migration] voice_area_code_preference and voice_number_porting_status columns ensured"
    );

    // ── Import staging tables ────────────────────────────────────────────────
    // These tables are defined in shared/schema.ts but were never pushed to the
    // database, causing every /api/import/* endpoint to 500 with
    // "relation does not exist".  Create them idempotently here so the import
    // wizard works in both dev and production without a manual drizzle-kit push.

    // Enum types must exist before the tables that reference them.
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE import_batch_status AS ENUM (
          'pending','processing','staged','committed','failed'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE import_batch_source AS ENUM (
          'csv_contacts','competitor_contacts'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE import_row_status AS ENUM (
          'needs_review','ready','ignored','imported'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS import_batches (
        id                VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        company_id        VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        source_type       import_batch_source NOT NULL DEFAULT 'csv_contacts',
        file_name         VARCHAR(500),
        status            import_batch_status NOT NULL DEFAULT 'pending',
        total_rows        INTEGER NOT NULL DEFAULT 0,
        staged_rows       INTEGER NOT NULL DEFAULT 0,
        ready_rows        INTEGER NOT NULL DEFAULT 0,
        needs_review_rows INTEGER NOT NULL DEFAULT 0,
        ignored_rows      INTEGER NOT NULL DEFAULT 0,
        imported_rows     INTEGER NOT NULL DEFAULT 0,
        created_by        VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        import_run_id     VARCHAR REFERENCES import_runs(id) ON DELETE SET NULL,
        created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at      TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ib_company ON import_batches (company_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ib_status  ON import_batches (status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ib_created ON import_batches (created_at)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS import_rows (
        id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        batch_id            VARCHAR NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
        company_id          VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        row_index           INTEGER NOT NULL,
        raw_json            JSONB,
        mapped_contact_json JSONB,
        mapped_service_json JSONB,
        confidence_json     JSONB,
        missing_fields      TEXT[],
        validation_errors   JSONB,
        status              import_row_status NOT NULL DEFAULT 'needs_review',
        created_contact_id  VARCHAR REFERENCES contacts(id) ON DELETE SET NULL,
        needs_service_setup BOOLEAN NOT NULL DEFAULT FALSE,
        created_at          TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_irow_batch   ON import_rows (batch_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_irow_company ON import_rows (company_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_irow_status  ON import_rows (status)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS import_mappings (
        id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        batch_id         VARCHAR NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
        source_column    VARCHAR(255) NOT NULL,
        target_field     VARCHAR(100) NOT NULL,
        confidence       INTEGER NOT NULL DEFAULT 0,
        is_user_override BOOLEAN NOT NULL DEFAULT FALSE,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_imap_batch ON import_mappings (batch_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS import_rule_suggestions (
        id                     VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        batch_id               VARCHAR NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
        row_id                 VARCHAR NOT NULL REFERENCES import_rows(id) ON DELETE CASCADE,
        suggested_frequency    VARCHAR(50),
        suggested_service_day  VARCHAR(50),
        suggested_next_date    VARCHAR(20),
        suggested_price_cents  INTEGER,
        suggested_billing_rule VARCHAR(100),
        confidence_score       INTEGER NOT NULL DEFAULT 0,
        reason                 TEXT,
        is_accepted            BOOLEAN NOT NULL DEFAULT FALSE,
        created_at             TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_irs_batch ON import_rule_suggestions (batch_id)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_irs_row   ON import_rule_suggestions (row_id)`
    );

    console.log(
      "[Migration] Import staging tables ensured (import_batches, import_rows, import_mappings, import_rule_suggestions)"
    );

    // ── Routific usage log ───────────────────────────────────────────────────
    // company_id is stored as a UUID string (VARCHAR) even though the Drizzle
    // schema incorrectly declares it integer — use VARCHAR to match actual queries.
    await client.query(`
      CREATE TABLE IF NOT EXISTS routific_usage_log (
        id         VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        company_id VARCHAR,
        stop_count INTEGER NOT NULL,
        success    BOOLEAN NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_routific_usage_log_company    ON routific_usage_log (company_id)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_routific_usage_log_created_at ON routific_usage_log (created_at)`
    );
    console.log("[Migration] routific_usage_log table ensured");

    // Ensure the demo account always has voice_plan_status = 'active' so the
    // Voice Agent step is visible in the business onboarding wizard.
    await client.query(`
      UPDATE companies
        SET voice_plan_status = 'active'
      WHERE voice_plan_status IS DISTINCT FROM 'active'
        AND id IN (
          SELECT cu.company_id
          FROM users u
          JOIN company_users cu ON cu.user_id = u.id
          WHERE u.email = 'demo@scoopilot.com'
          LIMIT 1
        )
    `);
    console.log("[Migration] Demo account voice_plan_status ensured active");

    // Per-column GIN trigram indexes for fast ILIKE searches on individual columns
    // These allow PostgreSQL to use a bitmap OR scan across all four predicates
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    for (const [indexName, colName] of [
      ["idx_contacts_first_name_trgm", "first_name"],
      ["idx_contacts_last_name_trgm", "last_name"],
      ["idx_contacts_email_trgm", "email"],
      ["idx_contacts_phone_trgm", "phone"],
    ] as [string, string][]) {
      await client.query(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName}
           ON contacts USING GIN (${colName} gin_trgm_ops)`
      );
    }
    console.log("[Migration] contacts per-column GIN trigram indexes ensured");

    // Route optimizer time-based mode columns (Task #784)
    await client.query(`
      ALTER TABLE companies
        ADD COLUMN IF NOT EXISTS route_planning_mode VARCHAR(10) NOT NULL DEFAULT 'stops',
        ADD COLUMN IF NOT EXISTS avg_minutes_per_stop INTEGER DEFAULT 12,
        ADD COLUMN IF NOT EXISTS min_route_duration_hours REAL DEFAULT 1
    `);
    console.log(
      "[Migration] route optimizer mode columns (route_planning_mode, avg_minutes_per_stop, min_route_duration_hours) verified"
    );

    console.log("[Migrate] Startup schema migrations applied successfully");
  } catch (err) {
    console.error("[Migrate] Startup migration failed:", err);
    throw err;
  } finally {
    client.release();
  }
}
