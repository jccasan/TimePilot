import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query(`ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'email_inbound'`);
    console.log("1. Added email_inbound to activity_action enum");

    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS inbound_email text UNIQUE`);
    await client.query(
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS inbound_email_slug text UNIQUE`
    );
    console.log("2. Added inbound_email / inbound_email_slug to companies");

    const { rows } = await client.query(
      `SELECT 1 FROM pg_type WHERE typname = 'inbound_email_status'`
    );
    if (rows.length === 0) {
      await client.query(
        `CREATE TYPE inbound_email_status AS ENUM ('matched', 'unmatched', 'ignored')`
      );
      console.log("3. Created inbound_email_status enum");
    } else {
      console.log("3. inbound_email_status enum already exists — skipping");
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS inbound_emails (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id varchar NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        from_address text NOT NULL,
        from_name text,
        subject text,
        body_text text,
        body_html text,
        matched_contact_id varchar REFERENCES contacts(id) ON DELETE SET NULL,
        raw_headers jsonb,
        status inbound_email_status NOT NULL DEFAULT 'unmatched',
        created_at timestamp DEFAULT now() NOT NULL
      )
    `);
    console.log("4. Created inbound_emails table");

    await client.query(`CREATE INDEX IF NOT EXISTS idx_ie_tenant ON inbound_emails(tenant_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ie_status ON inbound_emails(status)`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_ie_contact ON inbound_emails(matched_contact_id)`
    );
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ie_created ON inbound_emails(created_at)`);
    console.log("5. Created indexes");

    console.log("\nMigration complete!");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
