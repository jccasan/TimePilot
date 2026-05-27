import { pool } from "./db";
import crypto from "crypto";

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

    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS import_mode BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log("[Migration] users import_mode column verified");

    // Drop route credits columns — optimization is now always free
    await client.query(`
      ALTER TABLE companies
        DROP COLUMN IF EXISTS route_credits,
        DROP COLUMN IF EXISTS demo_unlimited_credits
    `);
    console.log("[Migration] Dropped route_credits and demo_unlimited_credits columns");

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

    // crm_activities table (was missing from initial migration)
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_activities (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        contact_id VARCHAR,
        deal_id VARCHAR,
        crm_company_id VARCHAR,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // crm_emails: schema requires subject/body NOT NULL and has thread_id and sent_at
    await client.query(`ALTER TABLE crm_emails ADD COLUMN IF NOT EXISTS thread_id VARCHAR`);
    await client.query(
      `ALTER TABLE crm_emails ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP DEFAULT NOW()`
    );
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

    // invoices.pay_token — dedicated secret for public payment links (Task #842)
    await client.query(`
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pay_token VARCHAR(64)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS invoices_pay_token_unique ON invoices(pay_token) WHERE pay_token IS NOT NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_invoices_pay_token ON invoices(pay_token) WHERE pay_token IS NOT NULL
    `);
    await client.query(`
      UPDATE invoices
      SET pay_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
      WHERE pay_token IS NULL
    `);
    console.log("[Migration] invoices.pay_token column backfilled and indexed");

    // ── Document Signing ─────────────────────────────────────────────────────
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE document_request_status AS ENUM ('pending', 'completed', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);

    await client.query(`
      ALTER TABLE companies
        ADD COLUMN IF NOT EXISTS require_document_signing BOOLEAN NOT NULL DEFAULT FALSE
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS document_templates (
        id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        company_id    VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name          VARCHAR(255) NOT NULL,
        file_path     TEXT NOT NULL,
        file_size     INTEGER,
        mime_type     VARCHAR(100),
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        is_required   BOOLEAN NOT NULL DEFAULT TRUE,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_doc_templates_company ON document_templates (company_id)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_doc_templates_order ON document_templates (company_id, display_order)`
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS document_requests (
        id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        company_id      VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        contact_id      VARCHAR NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        token           VARCHAR(128) NOT NULL UNIQUE,
        status          document_request_status NOT NULL DEFAULT 'pending',
        sent_at         TIMESTAMP,
        completed_at    TIMESTAMP,
        certificate_url TEXT,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(
      `ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS certificate_url TEXT`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_doc_requests_company ON document_requests (company_id)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_doc_requests_contact ON document_requests (contact_id)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_doc_requests_token ON document_requests (token)`
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS document_signatures (
        id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        request_id           VARCHAR NOT NULL REFERENCES document_requests(id) ON DELETE CASCADE,
        template_id          VARCHAR NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
        signer_name          VARCHAR(255) NOT NULL,
        signer_ip            VARCHAR(64),
        signature_image_path TEXT,
        certificate_path     TEXT,
        signed_at            TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_doc_signatures_request ON document_signatures (request_id)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_doc_signatures_template ON document_signatures (template_id)`
    );

    console.log("[Migration] Document signing tables ensured");

    // contact_type enum + columns
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contact_type') THEN
          CREATE TYPE contact_type AS ENUM ('residential', 'commercial');
        END IF;
      END $$
    `);
    await client.query(`
      ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS contact_type contact_type NOT NULL DEFAULT 'residential',
        ADD COLUMN IF NOT EXISTS company_name  VARCHAR(255)
    `);
    console.log("[Migration] contacts contact_type / company_name columns ensured");

    await client.query(
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS yard_size_tier_config JSONB`
    );
    console.log("[Migration] companies yard_size_tier_config column ensured");

    await client.query(`
      ALTER TABLE overhead_costs
        ADD COLUMN IF NOT EXISTS variable_rate_pct  NUMERIC(8,4),
        ADD COLUMN IF NOT EXISTS variable_flat_cents INTEGER
    `);
    console.log("[Migration] overhead_costs variable formula columns ensured");

    // ── Cost driver refactor (Task #905) ─────────────────────────────────────
    // Replace the two-field formula (variable_rate_pct + variable_flat_cents) with
    // a single driver type + rate model. The old columns are kept in place for
    // backward compatibility; data is back-filled into the new columns.
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE cost_driver_type AS ENUM ('pct_revenue', 'per_stop');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);
    await client.query(`
      ALTER TABLE overhead_costs
        ADD COLUMN IF NOT EXISTS cost_driver_type cost_driver_type,
        ADD COLUMN IF NOT EXISTS driver_rate      NUMERIC(10,4)
    `);
    // Back-fill pct_revenue from old variable_rate_pct
    await client.query(`
      UPDATE overhead_costs
        SET cost_driver_type = 'pct_revenue',
            driver_rate      = variable_rate_pct::numeric
        WHERE variable_rate_pct IS NOT NULL
          AND variable_rate_pct::numeric > 0
          AND cost_driver_type IS NULL
    `);
    // Back-fill per_stop from old variable_flat_cents (convert cents → dollars)
    await client.query(`
      UPDATE overhead_costs
        SET cost_driver_type = 'per_stop',
            driver_rate      = variable_flat_cents / 100.0
        WHERE variable_flat_cents IS NOT NULL
          AND variable_flat_cents > 0
          AND cost_driver_type IS NULL
    `);
    console.log(
      "[Migration] overhead_costs cost_driver_type / driver_rate columns ensured and back-filled"
    );

    // ── Cost driver v2 (Task #908): expand enum + add driver_params ──────────
    // ADD VALUE IF NOT EXISTS is idempotent; each must be a separate statement
    await client.query(`ALTER TYPE cost_driver_type ADD VALUE IF NOT EXISTS 'per_mile'`);
    await client.query(`ALTER TYPE cost_driver_type ADD VALUE IF NOT EXISTS 'fuel'`);
    await client.query(`ALTER TYPE cost_driver_type ADD VALUE IF NOT EXISTS 'payment_processing'`);
    await client.query(`ALTER TYPE cost_driver_type ADD VALUE IF NOT EXISTS 'pct_expense'`);
    await client.query(`ALTER TYPE cost_driver_type ADD VALUE IF NOT EXISTS 'per_unit'`);
    await client.query(`ALTER TYPE cost_driver_type ADD VALUE IF NOT EXISTS 'manual'`);
    await client.query(`ALTER TABLE overhead_costs ADD COLUMN IF NOT EXISTS driver_params JSONB`);
    console.log(
      "[Migration] overhead_costs driver_params + expanded cost_driver_type enum ensured"
    );

    // ── Lead Response Foundation (Task #909) ─────────────────────────────────
    // 1. Add lead_response_operator to the user_role enum
    await client.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'lead_response_operator'`);
    console.log("[Migration] lead_response_operator role added to user_role enum");

    // 2. Add Lead Response columns to contacts
    await client.query(`
      ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS lead_response_status VARCHAR(50),
        ADD COLUMN IF NOT EXISTS deposit_amount      NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS deposit_paid_at     TIMESTAMP,
        ADD COLUMN IF NOT EXISTS lead_source         VARCHAR(50)
    `);
    console.log("[Migration] contacts lead_response columns ensured");

    // 3. Create lead_response_config table
    await client.query(`
      CREATE TABLE IF NOT EXISTS lead_response_config (
        id                         VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id                 VARCHAR NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
        lead_response_active       BOOLEAN NOT NULL DEFAULT FALSE,
        lead_response_active_until TIMESTAMP,
        telnyx_number_release_date TIMESTAMP,
        stripe_subscription_id     VARCHAR(255),
        stripe_session_id          VARCHAR(255),
        hcp_api_key                VARCHAR(1024),
        created_at                 TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at                 TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE indexname = 'idx_lead_response_config_company'
        ) THEN
          CREATE INDEX idx_lead_response_config_company ON lead_response_config (company_id);
        END IF;
      END $$
    `);
    console.log("[Migration] lead_response_config table ensured");

    // ── Lead Response Settings fields (Task #911) ─────────────────────────────
    await client.query(`
      ALTER TABLE lead_response_config
        ADD COLUMN IF NOT EXISTS lr_phone_number          VARCHAR(20),
        ADD COLUMN IF NOT EXISTS porting_requested        BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS billing_mode             VARCHAR(20),
        ADD COLUMN IF NOT EXISTS deposit_percent          NUMERIC(5,2),
        ADD COLUMN IF NOT EXISTS scheduling_platform      VARCHAR(50),
        ADD COLUMN IF NOT EXISTS service_zip_codes        TEXT,
        ADD COLUMN IF NOT EXISTS out_of_area_message      TEXT,
        ADD COLUMN IF NOT EXISTS pricing_tiers            JSONB,
        ADD COLUMN IF NOT EXISTS per_dog_adder            NUMERIC(8,2),
        ADD COLUMN IF NOT EXISTS first_time_cleanup_fee   NUMERIC(8,2),
        ADD COLUMN IF NOT EXISTS airtable_operator_id     VARCHAR(255)
    `);
    console.log("[Migration] lead_response_config settings columns ensured");

    // ── Lead Response Setup Complete flag (Task #912) ──────────────────────────
    await client.query(`
      ALTER TABLE lead_response_config
        ADD COLUMN IF NOT EXISTS setup_complete BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log("[Migration] lead_response_config setup_complete column ensured");

    // ── Invite-pending flag on company_users (Task #937) ───────────────────────
    // Separates "pending invite not yet accepted" from "removed/deactivated member"
    // so removed users cannot self-reactivate via the accept-invite endpoint.
    await client.query(`
      ALTER TABLE company_users
        ADD COLUMN IF NOT EXISTS invite_pending BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log("[Migration] company_users invite_pending column ensured");

    // ── UTM campaign tracking columns on contacts (Task #945) ──────────────────
    await client.query(`
      ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS utm_source   VARCHAR(255),
        ADD COLUMN IF NOT EXISTS utm_medium   VARCHAR(255),
        ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(255)
    `);
    console.log("[Migration] contacts UTM tracking columns ensured");

    // Widen quote_form_events.zip_code from varchar(5) to varchar(10) for Canadian postal codes
    await client.query(`
      ALTER TABLE quote_form_events
        ALTER COLUMN zip_code TYPE VARCHAR(10)
    `);
    console.log(
      "[Migration] quote_form_events.zip_code widened to VARCHAR(10) for Canadian postal codes"
    );

    // One-time fix: ScoopIt.Dog (steve@scoopit.dog) was registered with country='us'
    // and currency='usd' despite being a Canadian business. Their Stripe Connect
    // account (US-based) must be cleared so they can re-onboard as a CA business.
    // stripe_customer_id is intentionally left unchanged.
    // This block is idempotent — safe to run on every startup.
    await client.query(`
      UPDATE companies
      SET
        country                   = 'CA',
        currency                  = 'cad',
        stripe_connect_account_id = NULL,
        stripe_connect_onboarded  = FALSE
      WHERE id       = 'b499e085-7396-4ae5-b1da-7b6a0d9e578e'
        AND (
          country                   != 'CA'
          OR currency               != 'cad'
          OR stripe_connect_account_id IS NOT NULL
          OR stripe_connect_onboarded = TRUE
        )
    `);
    const verifyResult = await client.query(
      `SELECT id, name, country, currency, stripe_connect_account_id, stripe_connect_onboarded
       FROM companies
       WHERE id = 'b499e085-7396-4ae5-b1da-7b6a0d9e578e'`
    );
    if (verifyResult.rows.length > 0) {
      const row = verifyResult.rows[0];
      const correct =
        row.country === "CA" &&
        row.currency === "cad" &&
        row.stripe_connect_account_id === null &&
        row.stripe_connect_onboarded === false;
      console.log(
        correct
          ? "[Migration] ScoopIt.Dog country/currency/Stripe Connect fix verified OK"
          : `[Migration] ScoopIt.Dog fix MISMATCH — got: ${JSON.stringify(row)}`
      );
    }

    // ── ScooPilot HQ company + admin regular-user account (Task #1008) ──────────
    // The platform admin uses a separate adminUsers/adminSessions auth system for
    // the /admin/* dashboard.  To use the B2B CRM they also need a regular user
    // account scoped to the "ScooPilot HQ" company (subscription_status=active).
    // This block is idempotent — safe to run on every startup.
    // It syncs the password to ADMIN_INITIAL_PASSWORD on every boot, matching
    // the same behaviour as seedAdminUser() in admin-auth.ts.
    const hqAdminEmail = process.env.ADMIN_EMAIL;
    const hqAdminPassword = process.env.ADMIN_INITIAL_PASSWORD;
    if (hqAdminEmail && hqAdminPassword) {
      // 1. Ensure ScooPilot HQ company exists
      await client.query(
        `
        INSERT INTO companies
          (id, name, email, slug, subscription_status, subscription_tier, created_at, updated_at)
        VALUES
          (gen_random_uuid(), 'ScooPilot HQ', $1, 'scoopilot-hq',
           'active'::subscription_status, 'tier_10_plus'::subscription_tier,
           NOW(), NOW())
        ON CONFLICT (slug) DO UPDATE
          SET subscription_status = 'active'::subscription_status,
              subscription_tier   = 'tier_10_plus'::subscription_tier,
              updated_at          = NOW()
      `,
        [hqAdminEmail.toLowerCase()]
      );

      const hqRow = await client.query(
        `SELECT id FROM companies WHERE slug = 'scoopilot-hq' LIMIT 1`
      );
      const hqCompanyId: string | null = hqRow.rows[0]?.id ?? null;

      if (hqCompanyId) {
        // 2. Hash the admin password (scrypt, same salt:hash format as app-auth.ts)
        const salt = crypto.randomBytes(16).toString("hex");
        const derivedKey = await new Promise<Buffer>((resolve, reject) => {
          crypto.scrypt(hqAdminPassword, salt, 64, (err, key) =>
            err ? reject(err) : resolve(key as Buffer)
          );
        });
        const passwordHash = `${salt}:${derivedKey.toString("hex")}`;

        // 3. Seed the admin's regular user account on first creation only.
        //    last_login_at is set to NOW() so the first login does not trigger
        //    the "import mode" auto-enable that fires for brand-new accounts.
        //    ON CONFLICT intentionally does NOT update password_hash — the admin
        //    may change their password via the UI and that change must persist.
        await client.query(
          `
          INSERT INTO users
            (id, email, password_hash, first_name, last_name,
             must_change_password, import_mode, last_login_at,
             created_at, updated_at)
          VALUES
            (gen_random_uuid(), $1, $2, 'Platform', 'Admin',
             false, false, NOW(),
             NOW(), NOW())
          ON CONFLICT (email) DO UPDATE
            SET must_change_password = false,
                updated_at           = NOW()
        `,
          [hqAdminEmail.toLowerCase(), passwordHash]
        );

        const userRow = await client.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [
          hqAdminEmail.toLowerCase(),
        ]);
        const hqUserId: string | null = userRow.rows[0]?.id ?? null;

        if (hqUserId) {
          // 4. Link user → ScooPilot HQ company as owner
          await client.query(
            `
            INSERT INTO company_users
              (id, company_id, user_id, role, is_active, invite_pending, created_at, updated_at)
            VALUES
              (gen_random_uuid(), $1, $2, 'owner', true, false, NOW(), NOW())
            ON CONFLICT (company_id, user_id) DO UPDATE
              SET role         = 'owner',
                  is_active    = true,
                  updated_at   = NOW()
          `,
            [hqCompanyId, hqUserId]
          );

          console.log(
            `[Migration] ScooPilot HQ CRM account ready — company=${hqCompanyId} user=${hqUserId}`
          );
        }
      }
    } else {
      console.log(
        "[Migration] ADMIN_EMAIL or ADMIN_INITIAL_PASSWORD not set — skipping ScooPilot HQ CRM bootstrap"
      );
    }

    // Backfill pricingRules from LR pricing tiers for companies that have LR
    // tiers configured but no pricingRules in pricing_config. This ensures the
    // signup widget shows live pricing for companies that previously configured
    // pricing only through the Lead Response settings page.
    {
      const lrRows = await client.query<{
        company_id: string;
        pricing_tiers: { label: string; pricePerVisit: number | null }[] | null;
        per_dog_adder: string | number | null;
        pricing_config: {
          pricingRules?: {
            basePrices?: { weekly?: number };
          } | null;
        } | null;
      }>(
        `SELECT lr.company_id,
                lr.pricing_tiers,
                lr.per_dog_adder,
                c.pricing_config
         FROM lead_response_config lr
         JOIN companies c ON c.id = lr.company_id
         WHERE lr.pricing_tiers IS NOT NULL
           AND jsonb_array_length(lr.pricing_tiers) > 0
           AND (
             c.pricing_config IS NULL
             OR c.pricing_config->>'pricingRules' IS NULL
             OR c.pricing_config->'pricingRules' = 'null'
           )`
      );

      let backfilled = 0;
      for (const row of lrRows.rows) {
        const tiers = row.pricing_tiers ?? [];
        const firstPrice =
          typeof tiers[0]?.pricePerVisit === "number" ? tiers[0].pricePerVisit : null;
        if (firstPrice == null || firstPrice <= 0) continue;

        const weekly = Math.round(firstPrice * 100) / 100;
        const biWeekly = Math.round(weekly * 1.35 * 100) / 100;
        const twiceWeekly = Math.round(weekly * 0.9 * 100) / 100;

        // Derive per-dog surcharge: prefer explicit perDogAdder; fall back to
        // the price delta between the first two tiers; default to 0 if neither.
        let surchargeAmount = 0;
        const rawAdder = row.per_dog_adder;
        if (rawAdder != null && rawAdder !== "" && parseFloat(String(rawAdder)) > 0) {
          surchargeAmount = Math.round(parseFloat(String(rawAdder)) * 100) / 100;
        } else if (
          tiers.length >= 2 &&
          typeof tiers[1]?.pricePerVisit === "number" &&
          tiers[1].pricePerVisit > firstPrice
        ) {
          surchargeAmount = Math.round((tiers[1].pricePerVisit - firstPrice) * 100) / 100;
        }

        // maxDogs: use number of configured tiers if > 0, else 4.
        const maxDogs = tiers.length > 0 ? tiers.length : 4;

        const derivedRules = {
          basePrices: { weekly, biWeekly, twiceWeekly },
          perDogRule: { incrementDogs: 1, surchargeAmount, maxDogs },
          yardSizeTiers: [
            { name: "Standard", upToAcres: 0.25, surcharge: 0 },
            { name: "Large", upToAcres: 0.5, surcharge: 10.0 },
            { name: "Very Large", upToAcres: null, surcharge: 20.0 },
          ],
        };

        const existingConfig = row.pricing_config ?? {};
        const updatedConfig = { ...existingConfig, pricingRules: derivedRules };

        await client.query(`UPDATE companies SET pricing_config = $1::jsonb WHERE id = $2`, [
          JSON.stringify(updatedConfig),
          row.company_id,
        ]);
        backfilled++;
      }

      if (backfilled > 0) {
        console.log(
          `[Migration] pricingRules backfilled from LR tiers for ${backfilled} company(s)`
        );
      } else {
        console.log("[Migration] pricingRules backfill — no companies needed updating");
      }
    }

    await client.query(`
      ALTER TABLE crm_contacts
        ADD COLUMN IF NOT EXISTS main_contact_id VARCHAR(255)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_contacts_main_contact_id
        ON crm_contacts (main_contact_id)
        WHERE main_contact_id IS NOT NULL
    `);
    await client.query(`
      ALTER TABLE crm_contacts
        ALTER COLUMN email DROP NOT NULL
    `);
    console.log("[Migration] crm_contacts.main_contact_id column verified and email nullable");

    // ---- Depots (named starting points per company) ----
    await client.query(`
      CREATE TABLE IF NOT EXISTS depots (
        id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id  VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name        VARCHAR(255) NOT NULL,
        address     TEXT NOT NULL,
        latitude    NUMERIC(10,7) NOT NULL,
        longitude   NUMERIC(10,7) NOT NULL,
        is_primary  BOOLEAN NOT NULL DEFAULT false,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_depots_company   ON depots (company_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_depots_primary   ON depots (company_id, is_primary)
    `);
    await client.query(`
      ALTER TABLE routes
        ADD COLUMN IF NOT EXISTS depot_id VARCHAR REFERENCES depots(id) ON DELETE SET NULL
    `);
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS default_depot_id VARCHAR REFERENCES depots(id) ON DELETE SET NULL
    `);

    // Seed primary depot from company start coords (one-time, only if none yet exist)
    await client.query(`
      INSERT INTO depots (company_id, name, address, latitude, longitude, is_primary)
      SELECT
        c.id,
        'Main Depot',
        COALESCE(c.start_address, c.address, ''),
        c.start_latitude::NUMERIC,
        c.start_longitude::NUMERIC,
        true
      FROM companies c
      WHERE c.start_latitude IS NOT NULL
        AND c.start_longitude IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM depots d WHERE d.company_id = c.id)
    `);
    console.log("[Migration] depots table and depot_id/default_depot_id columns verified");

    // ── Stripe fee breakdown columns on invoices (Connect audit) ─────────────
    await client.query(
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_charge_id VARCHAR(255)`
    );
    await client.query(
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_application_fee_cents INTEGER`
    );
    await client.query(
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_processing_fee_cents INTEGER`
    );
    await client.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_net_cents INTEGER`);
    console.log("[Migration] invoices: stripe fee breakdown columns verified");

    // ── Technician home address columns for route optimization ───────────────
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS home_address VARCHAR,
        ADD COLUMN IF NOT EXISTS home_latitude DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS home_longitude DOUBLE PRECISION
    `);
    console.log("[Migration] users home_address/home_latitude/home_longitude columns verified");

    // ── Geocode cache: remove known-bad entries cached with wrong coordinates ──
    // These 6 Northern Virginia addresses were cached on 2026-05-19 with coordinates
    // in OH, WV, and NC due to a Mapbox API mis-match. Deleting them forces a fresh
    // geocode on next import-wizard step 5 load.
    {
      const badKeys = [
        "us:12 w pennsylvania ave, lovettsville, va, 20180",
        "us:24120 chamberlayne ave, aldie, va, 20105",
        "us:450 library st se, purcellville, va, 20132",
        "us:700 technology dr, sterling, va, 20164",
        "us:36326 green ln, purcellville, va, 20132",
        "us:5 high st, lovettsville, va, 20180",
      ];
      const placeholders = badKeys.map((_, i) => `$${i + 1}`).join(", ");
      const result = await client.query(
        `DELETE FROM geocode_cache WHERE address_key IN (${placeholders})`,
        badKeys
      );
      if (result.rowCount && result.rowCount > 0) {
        console.log(
          `[Migration] Removed ${result.rowCount} bad geocode cache entries (stale out-of-state coordinates)`
        );
      }
    }

    // ── Facebook Lead Ad signup source column ────────────────────────────────
    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS signup_source VARCHAR(100)`);
    console.log("[Migration] companies.signup_source column verified");

    // ── Quote selected_frequency column ──────────────────────────────────────
    await client.query(
      `ALTER TABLE quotes ADD COLUMN IF NOT EXISTS selected_frequency VARCHAR(50)`
    );
    console.log("[Migration] quotes.selected_frequency column verified");

    // ── Invoice number customization columns ──────────────────────────────────
    await client.query(`
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS invoice_number_prefix VARCHAR(20) NOT NULL DEFAULT 'INV-';
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS invoice_number_next INTEGER NOT NULL DEFAULT 1;
    `);
    // Seed invoice_number_next for existing companies from their max INV-NNNNN invoice
    await client.query(`
      UPDATE companies c
      SET invoice_number_next = sub.next_num
      FROM (
        SELECT company_id,
               MAX(CASE WHEN invoice_number ~ '^INV-[0-9]+$'
                   THEN CAST(SUBSTRING(invoice_number FROM 5) AS INTEGER) + 1
                   ELSE 1 END) AS next_num
        FROM invoices
        GROUP BY company_id
      ) sub
      WHERE c.id = sub.company_id
        AND c.invoice_number_next = 1
        AND sub.next_num > 1
    `);
    console.log("[Migration] companies.invoice_number_prefix/next columns ensured");

    console.log("[Migrate] Startup schema migrations applied successfully");
  } catch (err) {
    console.error("[Migrate] Startup migration failed:", err);
    throw err;
  } finally {
    client.release();
  }
}
