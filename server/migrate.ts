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

    // quotes.line_items jsonb column (Task #795 — residential line-item picker)
    await client.query(`
      ALTER TABLE quotes
        ADD COLUMN IF NOT EXISTS line_items JSONB
    `);
    console.log("[Migration] quotes line_items column verified");

    // quote_status enum: add 'converted' value (Task #797 — convert quote to service plan)
    await client.query(`
      DO $$ BEGIN
        ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'converted';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    // quotes.converted_service_plan_id FK column (Task #797)
    await client.query(`
      ALTER TABLE quotes
        ADD COLUMN IF NOT EXISTS converted_service_plan_id VARCHAR REFERENCES service_plans(id) ON DELETE SET NULL
    `);
    console.log(
      "[Migration] quotes converted_service_plan_id column and converted status verified"
    );

    // ─── CRM Tables (Task #790) ───────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_contacts (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        company TEXT,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        source TEXT DEFAULT 'manual',
        lead_score INTEGER DEFAULT 0,
        assigned_to TEXT,
        tags TEXT[] DEFAULT '{}',
        custom_fields JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_companies (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        name TEXT NOT NULL,
        domain TEXT,
        industry TEXT,
        size TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        custom_fields JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_deals (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        title TEXT NOT NULL,
        value INTEGER DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        stage TEXT NOT NULL DEFAULT 'lead',
        probability INTEGER DEFAULT 0,
        expected_close_date TIMESTAMP,
        description TEXT,
        contact_id VARCHAR,
        crm_company_id VARCHAR,
        assigned_to TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        custom_fields JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_tasks (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'pending',
        due_date TIMESTAMP,
        contact_id VARCHAR,
        deal_id VARCHAR,
        assigned_to TEXT,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_notes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        body TEXT NOT NULL,
        contact_id VARCHAR,
        deal_id VARCHAR,
        author_id VARCHAR,
        pinned BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_emails (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        subject TEXT,
        body TEXT,
        from_address TEXT NOT NULL,
        to_address TEXT NOT NULL,
        direction TEXT NOT NULL DEFAULT 'outbound',
        status TEXT NOT NULL DEFAULT 'sent',
        contact_id VARCHAR,
        deal_id VARCHAR,
        external_id TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_documents (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'other',
        url TEXT,
        mime_type TEXT,
        size_bytes INTEGER DEFAULT 0,
        contact_id VARCHAR,
        deal_id VARCHAR,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_quotes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        title TEXT NOT NULL,
        line_items JSONB DEFAULT '[]',
        subtotal INTEGER DEFAULT 0,
        tax_rate NUMERIC DEFAULT 0,
        tax_amount INTEGER DEFAULT 0,
        total INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft',
        contact_id VARCHAR,
        deal_id VARCHAR,
        valid_until TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_projects (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        contact_id VARCHAR,
        deal_id VARCHAR,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_project_tasks (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        project_id VARCHAR NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        completed BOOLEAN DEFAULT FALSE,
        step_number INTEGER DEFAULT 1,
        assigned_to TEXT,
        due_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_email_campaigns (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'email',
        subject TEXT,
        body_html TEXT,
        body_text TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        scheduled_at TIMESTAMP,
        sent_at TIMESTAMP,
        sent_count INTEGER DEFAULT 0,
        open_count INTEGER DEFAULT 0,
        click_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_automations (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        trigger_type TEXT NOT NULL,
        trigger_conditions JSONB DEFAULT '{}',
        actions JSONB DEFAULT '[]',
        active BOOLEAN DEFAULT TRUE,
        run_count INTEGER DEFAULT 0,
        last_run_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_sequences (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_sequence_steps (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        sequence_id VARCHAR NOT NULL,
        step_number INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'email',
        subject TEXT,
        body TEXT,
        delay_days INTEGER DEFAULT 1,
        delay_hours INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_web_forms (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        name TEXT NOT NULL,
        fields JSONB DEFAULT '[]',
        submit_action TEXT DEFAULT 'thank_you',
        redirect_url TEXT,
        active BOOLEAN DEFAULT TRUE,
        submission_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_form_submissions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        form_id VARCHAR NOT NULL,
        data JSONB DEFAULT '{}',
        ip_address TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_audit_logs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        entity TEXT NOT NULL,
        entity_id VARCHAR,
        action TEXT NOT NULL,
        changes JSONB,
        user_id VARCHAR,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        color TEXT,
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_tags (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        name TEXT NOT NULL,
        color TEXT,
        entity TEXT NOT NULL DEFAULT 'contact',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // ─── CRM schema alignment: add columns missing from initial CREATE TABLE ──
    // crm_notes: schema uses `content`, initial SQL used `body`
    await client.query(`ALTER TABLE crm_notes ADD COLUMN IF NOT EXISTS content TEXT`);
    await client.query(
      `UPDATE crm_notes SET content = body WHERE content IS NULL AND body IS NOT NULL`
    );

    // crm_emails: schema requires subject/body NOT NULL and has thread_id
    await client.query(`ALTER TABLE crm_emails ADD COLUMN IF NOT EXISTS thread_id VARCHAR`);
    await client.query(`UPDATE crm_emails SET subject = '' WHERE subject IS NULL`);
    await client.query(`UPDATE crm_emails SET body = '' WHERE body IS NULL`);

    // crm_documents: schema uses `size` (not size_bytes) and has crm_company_id
    await client.query(`ALTER TABLE crm_documents ADD COLUMN IF NOT EXISTS size INTEGER DEFAULT 0`);
    await client.query(
      `UPDATE crm_documents SET size = size_bytes WHERE size IS NULL AND size_bytes IS NOT NULL`
    );
    await client.query(`ALTER TABLE crm_documents ADD COLUMN IF NOT EXISTS crm_company_id VARCHAR`);

    // crm_tasks: schema has crm_company_id
    await client.query(`ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS crm_company_id VARCHAR`);

    // crm_quotes: schema uses `items` (not line_items), has currency, crm_company_id, signature columns
    await client.query(`ALTER TABLE crm_quotes ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'`);
    await client.query(
      `UPDATE crm_quotes SET items = line_items WHERE items = '[]'::jsonb AND line_items IS NOT NULL`
    );
    await client.query(
      `ALTER TABLE crm_quotes ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD'`
    );
    await client.query(`ALTER TABLE crm_quotes ADD COLUMN IF NOT EXISTS crm_company_id VARCHAR`);
    await client.query(`ALTER TABLE crm_quotes ADD COLUMN IF NOT EXISTS signature_token VARCHAR`);
    await client.query(`ALTER TABLE crm_quotes ADD COLUMN IF NOT EXISTS signed_at TIMESTAMP`);
    await client.query(`ALTER TABLE crm_quotes ADD COLUMN IF NOT EXISTS signed_by_name TEXT`);
    await client.query(`ALTER TABLE crm_quotes ADD COLUMN IF NOT EXISTS signed_by_email TEXT`);
    await client.query(`ALTER TABLE crm_quotes ADD COLUMN IF NOT EXISTS signature_data TEXT`);
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS crm_quotes_signature_token_key ON crm_quotes (signature_token) WHERE signature_token IS NOT NULL`
    );

    // crm_projects: schema has crm_company_id
    await client.query(`ALTER TABLE crm_projects ADD COLUMN IF NOT EXISTS crm_company_id VARCHAR`);

    // crm_project_tasks: schema uses `status TEXT` (not completed BOOLEAN)
    await client.query(
      `ALTER TABLE crm_project_tasks ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`
    );
    await client.query(
      `UPDATE crm_project_tasks SET status = CASE WHEN completed THEN 'completed' ELSE 'pending' END WHERE status = 'pending' AND completed IS NOT NULL`
    );

    // crm_email_campaigns: schema uses `body` (not body_html/body_text), no type/sent_count
    await client.query(
      `ALTER TABLE crm_email_campaigns ADD COLUMN IF NOT EXISTS body TEXT NOT NULL DEFAULT ''`
    );
    await client.query(
      `UPDATE crm_email_campaigns SET body = COALESCE(body_html, body_text, '') WHERE body = ''`
    );
    await client.query(
      `ALTER TABLE crm_email_campaigns ADD COLUMN IF NOT EXISTS segment_rules JSONB DEFAULT '{}'`
    );

    // crm_automations: schema uses `trigger` (not trigger_type) and `conditions` (not trigger_conditions)
    await client.query(
      `ALTER TABLE crm_automations ADD COLUMN IF NOT EXISTS trigger TEXT NOT NULL DEFAULT ''`
    );
    await client.query(
      `UPDATE crm_automations SET trigger = trigger_type WHERE trigger = '' AND trigger_type IS NOT NULL`
    );
    await client.query(
      `ALTER TABLE crm_automations ADD COLUMN IF NOT EXISTS conditions JSONB DEFAULT '{}'`
    );
    await client.query(
      `UPDATE crm_automations SET conditions = trigger_conditions WHERE conditions = '{}'::jsonb AND trigger_conditions IS NOT NULL`
    );

    // crm_sequences: schema uses `status TEXT` (not active BOOLEAN)
    await client.query(
      `ALTER TABLE crm_sequences ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'`
    );
    await client.query(
      `UPDATE crm_sequences SET status = CASE WHEN active THEN 'active' ELSE 'draft' END WHERE status = 'draft' AND active IS NOT NULL`
    );

    // crm_sequence_steps: schema uses email_subject/email_body (not subject/body), has task_title/task_type; no company_id in schema
    await client.query(
      `ALTER TABLE crm_sequence_steps ADD COLUMN IF NOT EXISTS email_subject TEXT`
    );
    await client.query(
      `UPDATE crm_sequence_steps SET email_subject = subject WHERE email_subject IS NULL AND subject IS NOT NULL`
    );
    await client.query(`ALTER TABLE crm_sequence_steps ADD COLUMN IF NOT EXISTS email_body TEXT`);
    await client.query(
      `UPDATE crm_sequence_steps SET email_body = body WHERE email_body IS NULL AND body IS NOT NULL`
    );
    await client.query(`ALTER TABLE crm_sequence_steps ADD COLUMN IF NOT EXISTS task_title TEXT`);
    await client.query(
      `ALTER TABLE crm_sequence_steps ADD COLUMN IF NOT EXISTS task_type TEXT DEFAULT 'call'`
    );

    // crm_audit_logs: schema uses `details` (not changes)
    await client.query(
      `ALTER TABLE crm_audit_logs ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'`
    );
    await client.query(
      `UPDATE crm_audit_logs SET details = changes WHERE details = '{}'::jsonb AND changes IS NOT NULL`
    );

    // crm_campaign_recipients table (missing from initial migration)
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_campaign_recipients (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        campaign_id VARCHAR NOT NULL,
        contact_id VARCHAR NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        opened_at TIMESTAMP,
        clicked_at TIMESTAMP,
        tracking_token TEXT
      )
    `);

    // crm_sequence_enrollments table (missing from initial migration)
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_sequence_enrollments (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        sequence_id VARCHAR NOT NULL,
        contact_id VARCHAR NOT NULL,
        company_id VARCHAR NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        current_step INTEGER NOT NULL DEFAULT 0,
        next_run_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // crm_lead_scoring_rules table (missing from initial migration)
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_lead_scoring_rules (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        name TEXT NOT NULL,
        field TEXT NOT NULL,
        operator TEXT NOT NULL,
        value TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // crm_notifications table
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_notifications (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        user_id VARCHAR,
        type TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        body TEXT,
        entity_type TEXT,
        entity_id VARCHAR,
        read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // crm_webhooks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_webhooks (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT,
        events TEXT[] NOT NULL DEFAULT '{}',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // crm_webhook_deliveries table
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_webhook_deliveries (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        webhook_id VARCHAR NOT NULL,
        event TEXT NOT NULL,
        payload JSONB DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        response_status INTEGER,
        response_body TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log("[Migration] CRM tables ensured (crm_contacts, crm_deals, crm_tasks, et al.)");

    console.log("[Migrate] Startup schema migrations applied successfully");
  } catch (err) {
    console.error("[Migrate] Startup migration failed:", err);
    throw err;
  } finally {
    client.release();
  }
}
