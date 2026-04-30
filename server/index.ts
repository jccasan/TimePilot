import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { runStartupMigrations } from "./migrate";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === "production" ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.googleapis.com", "https://*.gstatic.com", "https://*.mapbox.com", "https://*.tile.openstreetmap.org", "https://tile.openstreetmap.org"],
      connectSrc: ["'self'", "https://api.mapbox.com", "https://*.tiles.mapbox.com", "https://events.mapbox.com", "wss:", "https://services.arcgis.com", "https://nominatim.openstreetmap.org"],
      workerSrc: ["'self'", "blob:"],
      childSrc: ["'self'", "blob:"],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  frameguard: process.env.NODE_ENV === "production" ? { action: "sameorigin" } : false,
}));

app.use((req, res, next) => {
  if (req.path.startsWith("/signup/") || req.path.startsWith("/api/public/")) {
    res.removeHeader("X-Frame-Options");
    res.setHeader("Content-Security-Policy", "frame-ancestors *");
  }
  next();
});

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : [];

app.use("/api/public", cors({
  origin: true,
  credentials: false,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));

app.use(cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || allowedOrigins.length === 0) {
      callback(null, true);
      return;
    }
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 500 : 10000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});
app.use("/api", apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 20 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, please try again later" },
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/portal/auth/login", authLimiter);
app.use("/api/portal/login", authLimiter);

const scrapeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many website analysis requests, please try again later" },
});
app.use("/api/onboarding/scrape-website", scrapeLimiter);

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "10mb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

const SENSITIVE_LOG_FIELDS = new Set([
  "token",
  "sessiontoken",
  "accesstoken",
  "refreshtoken",
  "password",
  "secret",
  "apikey",
]);

function redactSensitiveFields(value: any): any {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveFields);
  }
  if (value && typeof value === "object") {
    const redacted: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_LOG_FIELDS.has(k.toLowerCase())) {
        redacted[k] = "[REDACTED]";
      } else {
        redacted[k] = redactSensitiveFields(v);
      }
    }
    return redacted;
  }
  return value;
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const safeResponse = redactSensitiveFields(capturedJsonResponse);
        logLine += ` :: ${JSON.stringify(safeResponse).substring(0, 200)}`;
      }

      log(logLine);
    }
  });

  next();
});

function setupSession(app: express.Express) {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });

  app.set("trust proxy", 1);
  const isProduction = process.env.NODE_ENV === "production";
  app.use(session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
      sameSite: isProduction ? "lax" : "none" as any,
      path: "/",
    },
  }));
}

async function applyAdminCredentialMigration() {
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const targetEmail = "jeremy@doocrewva.com";

    const check = await pool.query("SELECT id, email FROM users WHERE email = 'jeremy@scoopilot.com' OR email = 'jeremy@doocrewva.com'");
    if (check.rows.length > 0) {
      const row = check.rows[0];
      if (row.email === "jeremy@scoopilot.com") {
        await pool.query(
          "UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2",
          [targetEmail, row.id]
        );
        console.log("[Migration] Tenant email migrated to doocrewva.com");
      } else {
        console.log("[Migration] Tenant credentials already up to date");
      }
    }

    const adminTarget = await pool.query("SELECT id FROM admin_users WHERE email = $1", [targetEmail]);
    if (adminTarget.rows.length > 0) {
      await pool.query("DELETE FROM admin_users WHERE email = 'jeremy@scoopilot.com' AND id != $1", [adminTarget.rows[0].id]);
      console.log("[Migration] Platform admin credentials already up to date");
    } else {
      const adminOld = await pool.query("SELECT id FROM admin_users WHERE email = 'jeremy@scoopilot.com'");
      if (adminOld.rows.length > 0) {
        await pool.query(
          "UPDATE admin_users SET email = $1 WHERE id = $2",
          [targetEmail, adminOld.rows[0].id]
        );
        console.log("[Migration] Platform admin email migrated");
      }
    }

    await pool.end();
  } catch (err) {
    console.error("[Migration] Failed to apply admin credential migration:", err);
  }
}

interface SubscriptionTierRow {
  tier_key: string;
  name: string;
  max_users: number;
  price: string;
  is_active: boolean;
}

async function syncSubscriptionTiers() {
  try {
    const { TIER_CONFIG } = await import("@shared/schema");
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const { rows } = await pool.query<SubscriptionTierRow>("SELECT tier_key, name, max_users, price, is_active FROM subscription_tiers");
    if (rows.length > 0) {
      for (const [key, cfg] of Object.entries(TIER_CONFIG)) {
        const existing = rows.find((r) => r.tier_key === key);
        if (existing) {
          const needsUpdate = existing.name !== cfg.name ||
            existing.max_users !== cfg.maxUsers ||
            parseFloat(existing.price) !== cfg.price ||
            existing.is_active !== cfg.visible;
          if (needsUpdate) {
            await pool.query(
              "UPDATE subscription_tiers SET name = $1, max_users = $2, price = $3, is_active = $4, updated_at = NOW() WHERE tier_key = $5",
              [cfg.name, cfg.maxUsers, cfg.price.toFixed(2), cfg.visible, key]
            );
          }
        }
      }
      console.log("[Migration] Subscription tiers synced with TIER_CONFIG");
    } else {
      console.log("[Migration] No subscription_tiers rows to sync (will be seeded on first admin access)");
    }
    await pool.end();
  } catch (err) {
    console.error("[Migration] Failed to sync subscription tiers:", err);
  }
}

async function ensureCompanyColumns() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS dedicated_phone_number VARCHAR(20);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS sms_provider VARCHAR(20) NOT NULL DEFAULT 'telnyx';
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS telnyx_api_key TEXT;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS telnyx_phone_number VARCHAR(20);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS telnyx_messaging_profile_id VARCHAR(255);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS retell_agent_id VARCHAR(255);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS retell_knowledge_base_id VARCHAR(255);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS venmo_handle VARCHAR(100);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_updated_at TIMESTAMP;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS qbo_fee_account_ref VARCHAR(50);
      ALTER TABLE routes ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE routes ADD COLUMN IF NOT EXISTS last_optimized_at TIMESTAMP;
      ALTER TABLE routes ADD COLUMN IF NOT EXISTS optimized_stop_hash VARCHAR(64);
    `);
    console.log("[Migration] routes optimization columns (last_optimized_at, optimized_stop_hash) verified");
    await pool.query(`
      DO $$ BEGIN
        ALTER TYPE automation_trigger ADD VALUE IF NOT EXISTS 'quote_created';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await pool.query(`
      DO $$ BEGIN
        ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'system_warning';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await pool.query(`UPDATE companies SET sms_provider = 'telnyx' WHERE sms_provider = 'twilio'`);
    await pool.query(`ALTER TABLE companies ALTER COLUMN sms_provider SET DEFAULT 'telnyx'`);
    console.log("[Migration] SMS provider migrated to telnyx-only");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS voice_calls (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        retell_call_id VARCHAR(255),
        caller_phone VARCHAR(30),
        agent_phone VARCHAR(30),
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        duration_minutes INTEGER NOT NULL DEFAULT 0,
        outcome VARCHAR(50),
        summary TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_voice_calls_company ON voice_calls(company_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_calls_retell_id ON voice_calls(retell_call_id) WHERE retell_call_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_voice_calls_created ON voice_calls(created_at);
    `);
    await pool.query(`
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS quote_defaults JSONB;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
    `);
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE quote_type AS ENUM ('residential', 'commercial');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
      DO $$ BEGIN
        CREATE TYPE quote_status AS ENUM ('draft', 'sent', 'accepted', 'declined', 'expired');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
      DO $$ BEGIN
        CREATE TYPE quote_tier AS ENUM ('essential', 'premium', 'deluxe');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
      CREATE TABLE IF NOT EXISTS quotes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        contact_id VARCHAR REFERENCES contacts(id) ON DELETE SET NULL,
        property_id VARCHAR REFERENCES properties(id) ON DELETE SET NULL,
        quote_number VARCHAR(50) NOT NULL,
        type quote_type NOT NULL,
        status quote_status NOT NULL DEFAULT 'draft',
        contact_name VARCHAR(255),
        contact_email VARCHAR(255),
        contact_phone VARCHAR(50),
        property_address TEXT,
        dog_count INTEGER,
        yard_size VARCHAR(50),
        station_count INTEGER,
        common_area_minutes INTEGER,
        frequency VARCHAR(50),
        is_first_time BOOLEAN DEFAULT true,
        essential_price DECIMAL(10,2),
        premium_price DECIMAL(10,2),
        deluxe_price DECIMAL(10,2),
        initial_clean_fee DECIMAL(10,2),
        selected_tier quote_tier,
        selected_price DECIMAL(10,2),
        essential_features JSONB,
        premium_features JSONB,
        deluxe_features JSONB,
        pricing_breakdown JSONB,
        notes TEXT,
        internal_notes TEXT,
        expires_at TIMESTAMP,
        sent_at TIMESTAMP,
        accepted_at TIMESTAMP,
        declined_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_quotes_company ON quotes(company_id);
      CREATE INDEX IF NOT EXISTS idx_quotes_contact ON quotes(contact_id);
      CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_company_number ON quotes(company_id, quote_number);
    `);
    await pool.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS images JSONB`);
    await pool.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS time_per_station INTEGER`);
    await pool.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS mileage_distance DECIMAL(10,2)`);
    await pool.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS dump_fee DECIMAL(10,2)`);
    await pool.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS crew_size INTEGER`);
    await pool.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS site_sqft INTEGER`);
    await pool.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quote_token VARCHAR(36) UNIQUE`);
    console.log("[Migration] Quotes table verified");
    console.log("[Migration] Company voice columns verified");
    await pool.query(`
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_onboarding_step INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_onboarding_complete BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS website_url TEXT;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_description TEXT;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS service_area_description TEXT;
    `);
    await pool.query(`
      UPDATE companies SET business_onboarding_complete = true, business_onboarding_step = 5
      WHERE business_onboarding_complete = false
      AND id IN (SELECT DISTINCT company_id FROM contacts)
    `);
    console.log("[Migration] Business onboarding columns verified");
    await pool.query(`
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS onboarding_token VARCHAR(36) UNIQUE;
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS onboarding_token_expires_at TIMESTAMP;
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP;
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS dog_names TEXT;
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS dog_breeds TEXT;
    `);
    console.log("[Migration] Property onboarding columns verified");
  } catch (err) {
    console.error("[Migration] Failed to ensure company columns:", err);
  } finally {
    await pool.end();
  }
}

async function dropConnectedAccountsTable() {
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`DROP TABLE IF EXISTS connected_accounts`);
    console.log("[Migration] connected_accounts table dropped (V2 removed)");
    await pool.end();
  } catch (err) {
    console.error("[Migration] Failed to drop connected_accounts table:", err);
  }
}

async function ensureMmsSchema() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_urls TEXT[] DEFAULT '{}';
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_count INTEGER DEFAULT 0;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS email_thread_id VARCHAR(255);
      CREATE INDEX IF NOT EXISTS idx_messages_email_thread ON messages(email_thread_id);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS message_retention_days INTEGER NOT NULL DEFAULT 30;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS message_attachments (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id VARCHAR NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        mime_type VARCHAR(100) NOT NULL,
        original_filename VARCHAR(500),
        original_size_bytes INTEGER NOT NULL DEFAULT 0,
        compressed_size_bytes INTEGER NOT NULL DEFAULT 0,
        storage_url TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);
      CREATE INDEX IF NOT EXISTS idx_message_attachments_company ON message_attachments(company_id);
    `);
    console.log("[Migration] MMS schema (media_urls, message_attachments) verified");
  } catch (err) {
    console.error("[Migration] Failed to ensure MMS schema:", err);
  } finally {
    await pool.end();
  }
}

async function ensureAttachmentsSchema() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      ALTER TABLE attachments ADD COLUMN IF NOT EXISTS document_category VARCHAR(100);
      ALTER TABLE attachments ADD COLUMN IF NOT EXISTS notes TEXT;
    `);
    console.log("[Migration] attachments document_category + notes columns verified");
  } catch (err) {
    console.error("[Migration] Failed to ensure attachments schema:", err);
  } finally {
    await pool.end();
  }
}

async function ensureMaxStopsSchema() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS max_stops_per_route INTEGER;`);
    console.log("[Migration] max_stops_per_route column verified");
  } catch (err) {
    console.error("[Migration] Failed to ensure max_stops_per_route:", err);
  } finally {
    await pool.end();
  }
}

async function repairDuplicateStopOrders() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query(`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY route_id
            ORDER BY stop_order, created_at
          ) AS new_order
        FROM service_plans
        WHERE route_id IS NOT NULL
          AND is_active = true
          AND stop_order > 0
      ),
      bad_routes AS (
        SELECT DISTINCT sp.route_id
        FROM service_plans sp
        WHERE sp.route_id IS NOT NULL
          AND sp.is_active = true
          AND sp.stop_order > 0
        GROUP BY sp.route_id, sp.stop_order
        HAVING COUNT(*) > 1
        UNION
        SELECT DISTINCT sp.route_id
        FROM service_plans sp
        WHERE sp.route_id IS NOT NULL
          AND sp.is_active = true
          AND sp.stop_order > 0
          AND sp.route_id IN (
            SELECT route_id FROM service_plans
            WHERE route_id IS NOT NULL AND is_active = true AND stop_order > 0
            GROUP BY route_id
            HAVING MAX(stop_order) != COUNT(*)
          )
      )
      UPDATE service_plans
      SET stop_order = ranked.new_order, updated_at = NOW()
      FROM ranked
      WHERE service_plans.id = ranked.id
        AND service_plans.route_id IN (SELECT route_id FROM bad_routes)
      RETURNING service_plans.id
    `);
    const repaired = result.rowCount ?? 0;
    if (repaired > 0) {
      await pool.query(`
        UPDATE jobs
        SET stop_order = sp.stop_order, updated_at = NOW()
        FROM service_plans sp
        WHERE jobs.service_plan_id = sp.id
          AND sp.route_id IS NOT NULL
          AND sp.is_active = true
      `);
      console.log(`[Migration] Repaired stop_order for ${repaired} stops across routes with duplicates/gaps`);
    } else {
      console.log("[Migration] Stop order integrity check passed — no repairs needed");
    }
  } catch (err) {
    console.error("[Migration] Failed to repair duplicate stop orders:", err);
  } finally {
    await pool.end();
  }
}

async function ensureCanadaMarketColumns() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      ALTER TABLE companies
        ADD COLUMN IF NOT EXISTS country VARCHAR(5) NOT NULL DEFAULT 'us',
        ADD COLUMN IF NOT EXISTS currency VARCHAR(5) NOT NULL DEFAULT 'usd',
        ADD COLUMN IF NOT EXISTS tax_rate_percent DECIMAL(5,2),
        ADD COLUMN IF NOT EXISTS custom_max_users INTEGER;
    `);
    console.log("[Migration] Canada market columns (country, currency, tax_rate_percent, custom_max_users) verified");
  } catch (err) {
    console.error("[Migration] Failed to ensure Canada market columns:", err);
  } finally {
    await pool.end();
  }
}

async function migrateServicePlansToAgreementsAndJobs() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agreements (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        contact_id VARCHAR NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        frequency service_frequency NOT NULL,
        price_per_visit DECIMAL(10,2) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        paused_at TIMESTAMP,
        start_date DATE NOT NULL,
        end_date DATE,
        ends_after_count INTEGER,
        ends_after_unit ends_after_unit,
        estimate_id VARCHAR REFERENCES estimates(id) ON DELETE SET NULL,
        service_plan_id VARCHAR,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agreements_company ON agreements(company_id);
      CREATE INDEX IF NOT EXISTS idx_agreements_contact ON agreements(contact_id);
      CREATE INDEX IF NOT EXISTS idx_agreements_active ON agreements(is_active);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        agreement_id VARCHAR NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
        property_id VARCHAR NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        route_id VARCHAR REFERENCES routes(id) ON DELETE SET NULL,
        stop_order INTEGER NOT NULL DEFAULT 0,
        day_of_week day_of_week,
        service_name VARCHAR(255),
        job_type job_type DEFAULT 'recurring',
        job_status job_status DEFAULT 'active',
        start_time VARCHAR(10),
        end_time VARCHAR(10),
        anytime BOOLEAN DEFAULT true,
        visit_instructions TEXT,
        assigned_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        is_stop_only BOOLEAN NOT NULL DEFAULT false,
        service_plan_id VARCHAR,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_agreement ON jobs(agreement_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_property ON jobs(property_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_route ON jobs(route_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(job_status);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS job_add_ons (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id VARCHAR NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        service_pricing_id VARCHAR NOT NULL REFERENCES service_pricing(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jao_job ON job_add_ons(job_id);
    `);

    await pool.query(`ALTER TABLE visits ADD COLUMN IF NOT EXISTS job_id VARCHAR REFERENCES jobs(id) ON DELETE SET NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_visits_job ON visits(job_id)`);

    await pool.query(`ALTER TABLE vacation_holds ADD COLUMN IF NOT EXISTS agreement_id VARCHAR REFERENCES agreements(id) ON DELETE SET NULL`);

    const unmigrated = await pool.query(`
      SELECT sp.id FROM service_plans sp
      LEFT JOIN agreements a ON a.service_plan_id = sp.id
      WHERE a.id IS NULL
    `);

    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agreements_sp_id ON agreements(service_plan_id) WHERE service_plan_id IS NOT NULL`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_sp_id ON jobs(service_plan_id) WHERE service_plan_id IS NOT NULL`);

    if (unmigrated.rows.length > 0) {
      interface SpIdRow { id: string }
      const spIds = (unmigrated.rows as SpIdRow[]).map((r) => r.id);
      console.log(`[Migration] Backfilling ${spIds.length} unmigrated service_plans → agreements + jobs...`);

      await pool.query(`
        INSERT INTO agreements (id, company_id, contact_id, frequency, price_per_visit, is_active, paused_at, start_date, end_date, ends_after_count, ends_after_unit, estimate_id, service_plan_id, created_at, updated_at)
        SELECT gen_random_uuid(), company_id, contact_id, frequency, price_per_visit, is_active, paused_at, start_date, end_date, ends_after_count, ends_after_unit, estimate_id, id, created_at, updated_at
        FROM service_plans
        WHERE id = ANY($1)
        ON CONFLICT DO NOTHING
      `, [spIds]);

      console.log(`[Migration] Backfilled ${spIds.length} agreements`);
    }

    const missingJobs = await pool.query(`
      SELECT sp.id FROM service_plans sp
      JOIN agreements a ON a.service_plan_id = sp.id
      LEFT JOIN jobs j ON j.service_plan_id = sp.id
      WHERE j.id IS NULL
    `);
    if (missingJobs.rows.length > 0) {
      interface SpIdRow { id: string }
      const spIds = (missingJobs.rows as SpIdRow[]).map((r) => r.id);
      console.log(`[Migration] Backfilling ${spIds.length} missing jobs...`);

      await pool.query(`
        INSERT INTO jobs (id, company_id, agreement_id, property_id, route_id, stop_order, day_of_week, service_name, job_type, job_status, start_time, end_time, anytime, visit_instructions, assigned_user_id, is_stop_only, service_plan_id, created_at, updated_at)
        SELECT gen_random_uuid(), sp.company_id, a.id, sp.property_id, sp.route_id, sp.stop_order, sp.day_of_week, sp.service_name, sp.job_type, sp.job_status, sp.start_time, sp.end_time, sp.anytime, sp.visit_instructions, sp.assigned_user_id, sp.is_stop_only, sp.id, sp.created_at, sp.updated_at
        FROM service_plans sp
        JOIN agreements a ON a.service_plan_id = sp.id
        WHERE sp.id = ANY($1)
        ON CONFLICT DO NOTHING
      `, [spIds]);

      console.log(`[Migration] Backfilled ${spIds.length} jobs`);
    }

    const unlinkedVisits = await pool.query(`
      UPDATE visits SET job_id = j.id
      FROM jobs j
      WHERE visits.service_plan_id = j.service_plan_id
        AND visits.job_id IS NULL
      RETURNING visits.id
    `);
    if (unlinkedVisits.rowCount && unlinkedVisits.rowCount > 0) {
      console.log(`[Migration] Linked ${unlinkedVisits.rowCount} visits to jobs`);
    }

    const unlinkedHolds = await pool.query(`
      UPDATE vacation_holds SET agreement_id = a.id
      FROM agreements a
      WHERE vacation_holds.service_plan_id = a.service_plan_id
        AND vacation_holds.agreement_id IS NULL
      RETURNING vacation_holds.id
    `);
    if (unlinkedHolds.rowCount && unlinkedHolds.rowCount > 0) {
      console.log(`[Migration] Linked ${unlinkedHolds.rowCount} vacation holds to agreements`);
    }

    const unlinkedAddOns = await pool.query(`
      INSERT INTO job_add_ons (id, job_id, service_pricing_id, name, price, is_active, created_at)
      SELECT gen_random_uuid(), j.id, spa.service_pricing_id, spa.name, spa.price, spa.is_active, spa.created_at
      FROM service_plan_add_ons spa
      JOIN jobs j ON j.service_plan_id = spa.service_plan_id
      WHERE NOT EXISTS (
        SELECT 1 FROM job_add_ons jao
        WHERE jao.job_id = j.id AND jao.service_pricing_id = spa.service_pricing_id
      )
      RETURNING id
    `);
    if (unlinkedAddOns.rowCount && unlinkedAddOns.rowCount > 0) {
      console.log(`[Migration] Migrated ${unlinkedAddOns.rowCount} add-ons to job_add_ons`);
    }

    console.log("[Migration] agreements/jobs/job_add_ons tables verified");
  } catch (err) {
    console.error("[Migration] Failed to migrate service_plans to agreements/jobs:", err);
  }

  try {
    await pool.query(`ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS discount DECIMAL(5,2)`);
    console.log("[Migration] service_plans discount column verified");
  } catch (err) {
    console.error("[Migration] Failed to add discount column:", err);
  }

  try {
    await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS date DATE`);
    await pool.query(`ALTER TABLE routes ALTER COLUMN day_of_week DROP NOT NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_routes_date ON routes(company_id, date)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_routes_company_date ON routes(company_id, date) WHERE date IS NOT NULL`);
    console.log("[Migration] routes date column and index verified");
  } catch (err) {
    console.error("[Migration] Failed to add date column to routes:", err);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS business_assessments (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        score INTEGER NOT NULL,
        verdict TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ba_company ON business_assessments(company_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ba_created ON business_assessments(company_id, created_at)`);
    console.log("[Migration] business_assessments table verified");
  } catch (err) {
    console.error("[Migration] Failed to create business_assessments table:", err);
  }

  await pool.end();
}

async function seedExtraDemoContacts(pool: any, companyId: string) {
  try {
    const routeRes = await pool.query("SELECT id FROM routes WHERE company_id = $1 ORDER BY name", [companyId]);
    if (routeRes.rows.length === 0) {
      console.log("[Migration] No routes found for demo company, skipping extra contacts");
      return;
    }
    const routeIds = routeRes.rows.map((r: any) => r.id);

    const extraContacts: [string, string, string, string, string][] = [
      ['Anthony', 'Rivera', 'anthony.r@example.com', '(540) 555-2001', 'active'],
      ['Samantha', 'Cole', 'samantha.c@example.com', '(540) 555-2002', 'active'],
      ['Douglas', 'Fleming', 'douglas.f@example.com', '(540) 555-2003', 'active'],
      ['Whitney', 'Pearson', 'whitney.p@example.com', '(540) 555-2004', 'active'],
      ['Victor', 'Garrett', 'victor.g@example.com', '(540) 555-2005', 'active'],
      ['Natalie', 'Burton', 'natalie.b@example.com', '(540) 555-2006', 'active'],
      ['Sean', 'Morales', 'sean.m@example.com', '(540) 555-2007', 'active'],
      ['Erica', 'Hampton', 'erica.h@example.com', '(540) 555-2008', 'active'],
      ['Philip', 'Doyle', 'philip.d@example.com', '(540) 555-2009', 'active'],
      ['Cassandra', 'Weaver', 'cassandra.w@example.com', '(540) 555-2010', 'active'],
      ['Troy', 'McIntyre', 'troy.m@example.com', '(540) 555-2011', 'active'],
      ['Gloria', 'Sutton', 'gloria.s@example.com', '(540) 555-2012', 'active'],
      ['Russell', 'Cobb', 'russell.c@example.com', '(540) 555-2013', 'active'],
      ['Veronica', 'Holt', 'veronica.h@example.com', '(540) 555-2014', 'active'],
      ['Craig', 'Lindsey', 'craig.l@example.com', '(540) 555-2015', 'active'],
      ['Monica', 'Vaughn', 'monica.v@example.com', '(540) 555-2016', 'active'],
      ['Keith', 'Barber', 'keith.b@example.com', '(540) 555-2017', 'active'],
      ['Stephanie', 'Lowe', 'stephanie.l@example.com', '(540) 555-2018', 'active'],
      ['Dennis', 'Walters', 'dennis.w@example.com', '(540) 555-2019', 'active'],
      ['Amber', 'Dalton', 'amber.d@example.com', '(540) 555-2020', 'active'],
      ['Randy', 'Espinoza', 'randy.e@example.com', '(540) 555-2021', 'active'],
      ['Crystal', 'Phelps', 'crystal.p@example.com', '(540) 555-2022', 'active'],
      ['Joel', 'Compton', 'joel.c@example.com', '(540) 555-2023', 'active'],
      ['Leslie', 'Gaines', 'leslie.g@example.com', '(540) 555-2024', 'active'],
      ['Travis', 'Woodard', 'travis.w@example.com', '(540) 555-2025', 'active'],
      ['Courtney', 'Buckley', 'courtney.b@example.com', '(540) 555-2026', 'active'],
      ['Gerald', 'Maxwell', 'gerald.m@example.com', '(540) 555-2027', 'active'],
      ['Vanessa', 'Pratt', 'vanessa.p@example.com', '(540) 555-2028', 'active'],
      ['Darren', 'Cannon', 'darren.c@example.com', '(540) 555-2029', 'active'],
      ['Alicia', 'Rowe', 'alicia.r@example.com', '(540) 555-2030', 'active'],
      ['Curtis', 'Pollard', 'curtis.p@example.com', '(540) 555-2031', 'active'],
      ['Brianna', 'Farrell', 'brianna.f@example.com', '(540) 555-2032', 'active'],
      ['Lance', 'Ingram', 'lance.i@example.com', '(540) 555-2033', 'active'],
      ['Jasmine', 'Huff', 'jasmine.h@example.com', '(540) 555-2034', 'active'],
      ['Wayne', 'Strickland', 'wayne.s@example.com', '(540) 555-2035', 'active'],
      ['Sharon', 'Callahan', 'sharon.c@example.com', '(540) 555-2036', 'active'],
      ['Terrence', 'Knox', 'terrence.k@example.com', '(540) 555-2037', 'active'],
      ['Kathryn', 'Malone', 'kathryn.m@example.com', '(540) 555-2038', 'active'],
      ['Mitchell', 'Brock', 'mitchell.b@example.com', '(540) 555-2039', 'active'],
      ['Carmen', 'Wyatt', 'carmen.w@example.com', '(540) 555-2040', 'active'],
      ['Evan', 'Shaffer', 'evan.s@example.com', '(540) 555-2041', 'active'],
      ['Lorraine', 'Juarez', 'lorraine.j@example.com', '(540) 555-2042', 'active'],
      ['Blake', 'Finley', 'blake.f@example.com', '(540) 555-2043', 'active'],
      ['Pamela', 'Norris', 'pamela.n@example.com', '(540) 555-2044', 'active'],
      ['Albert', 'Rocha', 'albert.r@example.com', '(540) 555-2045', 'active'],
      ['Renee', 'Pace', 'renee.p@example.com', '(540) 555-2046', 'active'],
      ['Martin', 'Hendricks', 'martin.h@example.com', '(540) 555-2047', 'active'],
      ['Allison', 'Spence', 'allison.s@example.com', '(540) 555-2048', 'active'],
      ['Scott', 'Gilmore', 'scott.g@example.com', '(540) 555-2049', 'active'],
      ['Bethany', 'Estes', 'bethany.e@example.com', '(540) 555-2050', 'active'],
      ['Jordan', 'Melton', 'jordan.m@example.com', '(540) 555-2051', 'active'],
      ['Theresa', 'Ochoa', 'theresa.o@example.com', '(540) 555-2052', 'active'],
      ['Marcus', 'Penn', 'marcus.penn@example.com', '(540) 555-2053', 'active'],
      ['Bridget', 'Swanson', 'bridget.s@example.com', '(540) 555-2054', 'active'],
      ['Franklin', 'Mejia', 'franklin.m@example.com', '(540) 555-2055', 'active'],
      ['Rosa', 'Odom', 'rosa.o@example.com', '(540) 555-2056', 'active'],
      ['Neil', 'Greer', 'neil.g@example.com', '(540) 555-2057', 'active'],
      ['Dianne', 'Bates', 'dianne.b@example.com', '(540) 555-2058', 'active'],
      ['Cody', 'Waller', 'cody.w@example.com', '(540) 555-2059', 'active'],
      ['Teresa', 'Duffy', 'teresa.d@example.com', '(540) 555-2060', 'active'],
      ['Allan', 'Richmond', 'allan.r@example.com', '(540) 555-2061', 'active'],
      ['Faith', 'Merritt', 'faith.m@example.com', '(540) 555-2062', 'active'],
      ['Warren', 'Beard', 'warren.b@example.com', '(540) 555-2063', 'active'],
      ['Elaine', 'Levine', 'elaine.l@example.com', '(540) 555-2064', 'active'],
      ['Dominic', 'Olson', 'dominic.o@example.com', '(540) 555-2065', 'lead'],
      ['Kimberly', 'Sampson', 'kimberly.s@example.com', '(540) 555-2066', 'lead'],
      ['Stuart', 'Woodward', 'stuart.w@example.com', '(540) 555-2067', 'lead'],
      ['Gina', 'Hartley', 'gina.h@example.com', '(540) 555-2068', 'lead'],
      ['Leo', 'Blanchard', 'leo.b@example.com', '(540) 555-2069', 'lead'],
      ['Christine', 'Fulton', 'christine.f@example.com', '(540) 555-2070', 'active'],
    ];

    const extraAddresses: [string, number, number, number, string][] = [
      ['101 Hanover St', 38.3041, -77.4578, 2, 'medium'],
      ['215 Amelia St', 38.3025, -77.4592, 1, 'small'],
      ['330 Fauquier St', 38.3058, -77.4601, 3, 'large'],
      ['445 Prince Edward St', 38.3033, -77.4615, 1, 'medium'],
      ['560 Charlotte St', 38.3019, -77.4545, 2, 'large'],
      ['125 Canal St', 38.3008, -77.4562, 1, 'small'],
      ['240 Lewis St', 38.3072, -77.4588, 2, 'medium'],
      ['355 Hawke St', 38.3049, -77.4535, 4, 'large'],
      ['470 Frederick St', 38.3063, -77.4572, 1, 'small'],
      ['585 Barton St', 38.2995, -77.4609, 2, 'medium'],
      ['1412 Dandridge St', 38.2968, -77.4652, 1, 'medium'],
      ['1527 Herndon St', 38.2953, -77.4688, 3, 'large'],
      ['1643 Sylvania Ave', 38.2938, -77.4724, 2, 'small'],
      ['1758 Idlewild Blvd', 38.2922, -77.4760, 1, 'medium'],
      ['1874 Gordon Rd', 38.2907, -77.4796, 2, 'large'],
      ['1015 Executive Ave', 38.2965, -77.4543, 1, 'small'],
      ['1130 Deacon Rd', 38.2950, -77.4511, 2, 'medium'],
      ['1245 Jackson St', 38.2935, -77.4479, 3, 'large'],
      ['1360 Millwood Dr', 38.2920, -77.4447, 1, 'medium'],
      ['1475 Jefferson Davis Hwy', 38.2905, -77.4415, 2, 'small'],
      ['2510 Mine Rd', 38.2845, -77.4925, 1, 'medium'],
      ['2625 Lansdowne Rd', 38.2831, -77.4961, 2, 'large'],
      ['2740 Belman Rd', 38.2816, -77.4997, 1, 'small'],
      ['2855 Hood Dr', 38.2801, -77.5033, 3, 'large'],
      ['2970 Wicklow Dr', 38.2786, -77.5069, 2, 'medium'],
      ['3085 Leavells Rd', 38.2771, -77.5105, 1, 'small'],
      ['3200 Harrison Rd', 38.2756, -77.5141, 2, 'large'],
      ['3315 Lee Hill Dr', 38.2741, -77.5177, 1, 'medium'],
      ['3430 Benchmark Rd', 38.2726, -77.5213, 4, 'large'],
      ['3545 Smith Station Rd', 38.2711, -77.5249, 2, 'medium'],
      ['4001 Cambridge St', 38.2696, -77.4383, 1, 'small'],
      ['4116 River Rd', 38.2681, -77.4351, 2, 'medium'],
      ['4231 Hillcrest Dr', 38.2666, -77.4319, 3, 'large'],
      ['4346 Courthouse Rd', 38.2651, -77.4287, 1, 'medium'],
      ['4461 Garrisonville Rd', 38.2636, -77.4255, 2, 'small'],
      ['4576 Plantation Dr', 38.2735, -77.4623, 1, 'large'],
      ['4691 Warrenton Rd', 38.2750, -77.4659, 2, 'medium'],
      ['4806 Chatham Heights Rd', 38.2765, -77.4695, 1, 'small'],
      ['4921 Butler Rd', 38.2780, -77.4731, 3, 'large'],
      ['5036 Tidewater Trail', 38.2795, -77.4767, 2, 'medium'],
      ['1901 College Ave', 38.2810, -77.4803, 1, 'small'],
      ['2016 Hospital Dr', 38.2825, -77.4839, 2, 'medium'],
      ['2131 William St Extended', 38.2840, -77.4875, 1, 'large'],
      ['2246 Normandy Ave', 38.2855, -77.4911, 4, 'large'],
      ['2361 Sunken Rd Extended', 38.2870, -77.4947, 2, 'medium'],
      ['620 Bunker Hill St', 38.3085, -77.4625, 1, 'small'],
      ['735 Marye St', 38.3098, -77.4659, 2, 'medium'],
      ['850 Kirkland Dr', 38.3112, -77.4693, 3, 'large'],
      ['965 Lee Dr', 38.3126, -77.4727, 1, 'medium'],
      ['1080 Mayfield Dr', 38.3140, -77.4761, 2, 'small'],
      ['1195 Breckenridge Dr', 38.3154, -77.4795, 1, 'medium'],
      ['1310 College Heights', 38.3168, -77.4829, 2, 'large'],
      ['1425 Battlefield Blvd', 38.3182, -77.4863, 1, 'small'],
      ['1540 Telegraph Rd', 38.3196, -77.4897, 3, 'large'],
      ['1655 Altoona Dr', 38.3210, -77.4931, 2, 'medium'],
      ['720 Pitt St', 38.3005, -77.4530, 1, 'medium'],
      ['835 Commerce St', 38.2990, -77.4498, 2, 'large'],
      ['950 Water St', 38.2975, -77.4466, 1, 'small'],
      ['1065 Ford St', 38.2960, -77.4434, 3, 'large'],
      ['1180 Bridgewater St', 38.2945, -77.4402, 2, 'medium'],
      ['1295 Riverside Dr', 38.2930, -77.4370, 1, 'small'],
      ['1410 Ferry Farm Ln', 38.2915, -77.4338, 2, 'large'],
      ['1525 Kings Hwy', 38.2900, -77.4306, 1, 'medium'],
      ['1640 Embrey Mill Rd', 38.2885, -77.4274, 4, 'large'],
      ['1755 Celebrate Virginia Dr', 38.2870, -77.4242, 2, 'medium'],
      ['1870 Central Park Blvd', 38.3015, -77.4680, 1, 'small'],
      ['1985 Greenview Dr', 38.3030, -77.4716, 2, 'medium'],
      ['2100 Oak Hill Ln', 38.3045, -77.4752, 3, 'large'],
      ['2215 Pine Grove Ct', 38.3060, -77.4788, 1, 'small'],
      ['2330 Maple Ridge Rd', 38.3075, -77.4824, 2, 'medium'],
    ];

    const extraPlanConfigs: { idx: number; freq: string; price: string; ri: number }[] = [
      { idx: 0, freq: 'weekly', price: '22.00', ri: 0 },
      { idx: 1, freq: 'weekly', price: '18.00', ri: 1 },
      { idx: 2, freq: 'weekly', price: '35.00', ri: 2 },
      { idx: 3, freq: 'biweekly', price: '28.00', ri: 3 },
      { idx: 4, freq: 'weekly', price: '30.00', ri: 4 },
      { idx: 5, freq: 'weekly', price: '20.00', ri: 0 },
      { idx: 6, freq: 'weekly', price: '26.00', ri: 1 },
      { idx: 7, freq: 'weekly', price: '42.00', ri: 2 },
      { idx: 8, freq: 'biweekly', price: '24.00', ri: 3 },
      { idx: 9, freq: 'weekly', price: '32.00', ri: 4 },
      { idx: 10, freq: 'weekly', price: '19.00', ri: 0 },
      { idx: 11, freq: 'weekly', price: '38.00', ri: 1 },
      { idx: 12, freq: 'monthly', price: '45.00', ri: 2 },
      { idx: 13, freq: 'weekly', price: '23.00', ri: 3 },
      { idx: 14, freq: 'weekly', price: '34.00', ri: 4 },
      { idx: 15, freq: 'biweekly', price: '27.00', ri: 0 },
      { idx: 16, freq: 'weekly', price: '21.00', ri: 1 },
      { idx: 17, freq: 'weekly', price: '36.00', ri: 2 },
      { idx: 18, freq: 'weekly', price: '29.00', ri: 3 },
      { idx: 19, freq: 'weekly', price: '16.00', ri: 4 },
      { idx: 20, freq: 'weekly', price: '25.00', ri: 0 },
      { idx: 21, freq: 'biweekly', price: '33.00', ri: 1 },
      { idx: 22, freq: 'weekly', price: '20.00', ri: 2 },
      { idx: 23, freq: 'weekly', price: '40.00', ri: 3 },
      { idx: 24, freq: 'weekly', price: '28.00', ri: 4 },
      { idx: 25, freq: 'weekly', price: '17.00', ri: 0 },
      { idx: 26, freq: 'weekly', price: '31.00', ri: 1 },
      { idx: 27, freq: 'biweekly', price: '26.00', ri: 2 },
      { idx: 28, freq: 'weekly', price: '44.00', ri: 3 },
      { idx: 29, freq: 'weekly', price: '22.00', ri: 4 },
      { idx: 30, freq: 'weekly', price: '19.00', ri: 0 },
      { idx: 31, freq: 'weekly', price: '24.00', ri: 1 },
      { idx: 32, freq: 'weekly', price: '37.00', ri: 2 },
      { idx: 33, freq: 'biweekly', price: '30.00', ri: 3 },
      { idx: 34, freq: 'weekly', price: '15.00', ri: 4 },
      { idx: 35, freq: 'weekly', price: '29.00', ri: 0 },
      { idx: 36, freq: 'weekly', price: '23.00', ri: 1 },
      { idx: 37, freq: 'monthly', price: '40.00', ri: 2 },
      { idx: 38, freq: 'weekly', price: '35.00', ri: 3 },
      { idx: 39, freq: 'weekly', price: '27.00', ri: 4 },
      { idx: 40, freq: 'biweekly', price: '21.00', ri: 0 },
      { idx: 41, freq: 'weekly', price: '26.00', ri: 1 },
      { idx: 42, freq: 'weekly', price: '18.00', ri: 2 },
      { idx: 43, freq: 'weekly', price: '43.00', ri: 3 },
      { idx: 44, freq: 'weekly', price: '32.00', ri: 4 },
      { idx: 45, freq: 'weekly', price: '20.00', ri: 0 },
      { idx: 46, freq: 'weekly', price: '28.00', ri: 1 },
      { idx: 47, freq: 'biweekly', price: '36.00', ri: 2 },
      { idx: 48, freq: 'weekly', price: '25.00', ri: 3 },
      { idx: 49, freq: 'weekly', price: '16.00', ri: 4 },
      { idx: 50, freq: 'weekly', price: '22.00', ri: 0 },
      { idx: 51, freq: 'weekly', price: '34.00', ri: 1 },
      { idx: 52, freq: 'weekly', price: '19.00', ri: 2 },
      { idx: 53, freq: 'biweekly', price: '38.00', ri: 3 },
      { idx: 54, freq: 'weekly', price: '30.00', ri: 4 },
      { idx: 55, freq: 'weekly', price: '24.00', ri: 0 },
      { idx: 56, freq: 'weekly', price: '31.00', ri: 1 },
      { idx: 57, freq: 'monthly', price: '42.00', ri: 2 },
      { idx: 58, freq: 'weekly', price: '39.00', ri: 3 },
      { idx: 59, freq: 'weekly', price: '17.00', ri: 4 },
      { idx: 60, freq: 'weekly', price: '33.00', ri: 0 },
      { idx: 61, freq: 'biweekly', price: '25.00', ri: 1 },
      { idx: 62, freq: 'weekly', price: '41.00', ri: 2 },
      { idx: 63, freq: 'weekly', price: '23.00', ri: 3 },
      { idx: 64, freq: 'weekly', price: '29.00', ri: 4 },
      { idx: 65, freq: 'biweekly', price: '26.00', ri: 0 },
      { idx: 66, freq: 'weekly', price: '37.00', ri: 1 },
      { idx: 67, freq: 'weekly', price: '21.00', ri: 2 },
      { idx: 68, freq: 'weekly', price: '34.00', ri: 3 },
      { idx: 69, freq: 'weekly', price: '27.00', ri: 4 },
    ];

    const contactIds: string[] = [];
    for (let i = 0; i < extraContacts.length; i++) {
      const [fn, ln, em, ph, st] = extraContacts[i];
      const autoPayEnabled = i % 10 !== 0;
      const stripeCustomerId = autoPayEnabled ? `cus_demo_extra_${i}` : null;
      const r = await pool.query(
        `INSERT INTO contacts (company_id, first_name, last_name, email, phone, status, has_portal_access, auto_pay_enabled, auto_invoice_enabled, stripe_customer_id) VALUES ($1,$2,$3,$4,$5,$6,false,$7,true,$8) RETURNING id`,
        [companyId, fn, ln, em, ph, st, autoPayEnabled, stripeCustomerId]
      );
      contactIds.push(r.rows[0].id);
    }

    const propIds: string[] = [];
    for (let i = 0; i < extraAddresses.length; i++) {
      const [addr, lat, lng, dogs, yard] = extraAddresses[i];
      const r = await pool.query(
        `INSERT INTO properties (company_id, contact_id, street_address, city, state, zip_code, latitude, longitude, number_of_dogs, yard_size) VALUES ($1,$2,$3,'Fredericksburg','VA','22401',$4,$5,$6,$7) RETURNING id`,
        [companyId, contactIds[i], addr, lat, lng, dogs, yard]
      );
      propIds.push(r.rows[0].id);
    }

    const planIds: string[] = [];
    for (const pc of extraPlanConfigs) {
      const ri = pc.ri % routeIds.length;
      const r = await pool.query(
        `INSERT INTO service_plans (company_id, contact_id, property_id, frequency, price_per_visit, is_active, start_date, stop_order, is_stop_only, route_id) VALUES ($1,$2,$3,$4,$5,true,'2026-02-01',0,false,$6) RETURNING id`,
        [companyId, contactIds[pc.idx], propIds[pc.idx], pc.freq, pc.price, routeIds[ri]]
      );
      planIds.push(r.rows[0].id);
    }

    const dayOfWeekMap = [1, 3, 5, 2, 4];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let pIdx = 0; pIdx < extraPlanConfigs.length; pIdx++) {
      const pc = extraPlanConfigs[pIdx];
      const ri = pc.ri % routeIds.length;
      const day = dayOfWeekMap[ri];
      for (let wk = 6; wk >= -1; wk--) {
        if (pc.freq === 'biweekly' && wk % 2 !== 0) continue;
        if (pc.freq === 'monthly' && wk !== 0 && wk !== 4) continue;

        const d = new Date(today);
        d.setDate(d.getDate() - (wk * 7) + (day - d.getDay()));
        const dateStr = d.toISOString().split('T')[0];

        let status: string;
        if (d > today) status = 'scheduled';
        else if (dateStr === today.toISOString().split('T')[0]) status = 'scheduled';
        else status = Math.random() > 0.1 ? 'completed' : 'skipped';

        const completedAt = status === 'completed' ? d.toISOString() : null;
        await pool.query(
          `INSERT INTO visits (company_id, service_plan_id, property_id, scheduled_date, status, completed_at) VALUES ($1,$2,$3,$4,$5,$6)`,
          [companyId, planIds[pIdx], propIds[pc.idx], dateStr, status, completedAt]
        );
      }
    }

    console.log(`[Migration] Seeded 70 extra demo contacts with ${extraPlanConfigs.length} service plans`);
  } catch (err) {
    console.error("[Migration] Failed to seed extra demo contacts:", err);
  }
}

async function seedScatteredDemoContacts(pool: any, companyId: string) {
  try {
    const routeRes = await pool.query("SELECT id FROM routes WHERE company_id = $1 ORDER BY name", [companyId]);
    if (routeRes.rows.length < 3) return;
    const routeIds = routeRes.rows.map((r: any) => r.id);

    const scatteredContacts: [string, string, string, string][] = [
      ['Harold', 'Beaumont', 'harold.beaumont@example.com', '(540) 555-3001'],
      ['Margot', 'Ellsworth', 'margot.ellsworth@example.com', '(540) 555-3002'],
      ['Chester', 'Langford', 'chester.langford@example.com', '(540) 555-3003'],
      ['Donna', 'Ashford', 'donna.ashford@example.com', '(540) 555-3004'],
      ['Stuart', 'Chatham', 'stuart.chatham@example.com', '(540) 555-3005'],
      ['Beverly', 'Wakefield', 'beverly.wakefield@example.com', '(540) 555-3006'],
      ['Clifton', 'Randolph', 'clifton.randolph@example.com', '(540) 555-3007'],
      ['Lorraine', 'Prescott', 'lorraine.prescott@example.com', '(540) 555-3008'],
      ['Irving', 'Thornton', 'irving.thornton@example.com', '(540) 555-3009'],
      ['Dorothy', 'Breckenridge', 'dorothy.breck@example.com', '(540) 555-3010'],

      ['Franklin', 'Whitmore', 'franklin.whitmore@example.com', '(540) 555-3011'],
      ['Geraldine', 'Oakley', 'geraldine.oakley@example.com', '(540) 555-3012'],
      ['Nelson', 'Fairbanks', 'nelson.fairbanks@example.com', '(540) 555-3013'],
      ['Constance', 'Dunbar', 'constance.dunbar@example.com', '(540) 555-3014'],
      ['Milton', 'Hartwell', 'milton.hartwell@example.com', '(540) 555-3015'],
      ['Harriet', 'Ainsworth', 'harriet.ainsworth@example.com', '(540) 555-3016'],
      ['Bernard', 'Kensington', 'bernard.kens@example.com', '(540) 555-3017'],
      ['Mildred', 'Pemberton', 'mildred.pemb@example.com', '(540) 555-3018'],
      ['Vernon', 'Blackwood', 'vernon.blackwood@example.com', '(540) 555-3019'],
      ['Eleanor', 'Stratford', 'eleanor.stratford@example.com', '(540) 555-3020'],

      ['Wallace', 'Pendleton', 'wallace.pendleton@example.com', '(540) 555-3021'],
      ['Beatrice', 'Ashmore', 'beatrice.ashmore@example.com', '(540) 555-3022'],
      ['Reginald', 'Forsythe', 'reginald.forsythe@example.com', '(540) 555-3023'],
      ['Vivian', 'Chesterfield', 'vivian.chester@example.com', '(540) 555-3024'],
      ['Horace', 'Waverly', 'horace.waverly@example.com', '(540) 555-3025'],
      ['Gladys', 'Redmond', 'gladys.redmond@example.com', '(540) 555-3026'],
      ['Norbert', 'Claybourne', 'norbert.clay@example.com', '(540) 555-3027'],
      ['Edith', 'Marlborough', 'edith.marl@example.com', '(540) 555-3028'],
      ['Lester', 'Worthington', 'lester.worth@example.com', '(540) 555-3029'],
      ['Lucille', 'Devereaux', 'lucille.dev@example.com', '(540) 555-3030'],
    ];

    const scatteredAddresses: [string, number, number, number, string][] = [
      ['100 Harvard St, Fredericksburg, VA', 38.2745, -77.4985, 2, 'medium'],
      ['205 Chatham Ct, Fredericksburg, VA', 38.2738, -77.5010, 1, 'small'],
      ['312 Mulligan Ct, Fredericksburg, VA', 38.2755, -77.4920, 3, 'large'],
      ['400 Old Dominion Pkwy, Fredericksburg, VA', 38.2710, -77.4895, 2, 'medium'],
      ['508 Colechester St, Fredericksburg, VA', 38.2698, -77.4945, 1, 'small'],
      ['615 Crossgate Dr, Fredericksburg, VA', 38.2665, -77.4920, 2, 'large'],
      ['720 Corbin Hall Ln, Fredericksburg, VA', 38.2760, -77.4860, 4, 'large'],
      ['825 Blandfield Ln, Fredericksburg, VA', 38.2738, -77.4835, 1, 'small'],
      ['130 Cannonball Ct, Fredericksburg, VA', 38.2685, -77.5055, 2, 'medium'],
      ['235 Battery Hill Ln, Fredericksburg, VA', 38.2678, -77.5035, 3, 'large'],

      ['102 Hickory Hill Dr, Fredericksburg, VA', 38.2345, -77.4680, 2, 'medium'],
      ['207 Andover Ln, Fredericksburg, VA', 38.2378, -77.4645, 1, 'small'],
      ['310 Timberlake Rd, Fredericksburg, VA', 38.2395, -77.4580, 3, 'large'],
      ['415 Layton St, Fredericksburg, VA', 38.2385, -77.4555, 2, 'medium'],
      ['520 Andrews Mill Ln, Fredericksburg, VA', 38.2360, -77.4530, 1, 'small'],
      ['625 Massaponax Church Rd, Fredericksburg, VA', 38.2335, -77.4495, 2, 'large'],
      ['730 Alberta Dr, Fredericksburg, VA', 38.2310, -77.4600, 3, 'medium'],
      ['835 Townsley St, Fredericksburg, VA', 38.2355, -77.4710, 1, 'small'],
      ['140 Swanson Ct, Fredericksburg, VA', 38.2290, -77.4695, 2, 'medium'],
      ['245 Cameo St, Fredericksburg, VA', 38.2405, -77.4660, 2, 'large'],

      ['104 Passapatanzy Rd, King George, VA', 38.3380, -77.4280, 2, 'medium'],
      ['209 Newton Ln, King George, VA', 38.3365, -77.4210, 1, 'small'],
      ['314 Forest Ridge Dr, King George, VA', 38.3340, -77.4175, 3, 'large'],
      ['419 Fletchers Chapel Rd, King George, VA', 38.3355, -77.4130, 2, 'medium'],
      ['524 Oakland Dr, King George, VA', 38.3310, -77.4250, 1, 'small'],
      ['629 Mullen Rd, King George, VA', 38.3335, -77.4195, 2, 'large'],
      ['734 Bush St, King George, VA', 38.3360, -77.4320, 4, 'large'],
      ['839 Covington St, King George, VA', 38.3290, -77.4295, 1, 'small'],
      ['144 Charleston St, King George, VA', 38.3395, -77.4200, 2, 'medium'],
      ['249 Martin Ln, King George, VA', 38.3375, -77.4160, 3, 'large'],
    ];

    const scatteredPlanConfigs: { idx: number; freq: string; price: string; ri: number }[] = [
      { idx: 0, freq: 'weekly', price: '32.00', ri: 0 },
      { idx: 1, freq: 'weekly', price: '25.00', ri: 3 },
      { idx: 2, freq: 'biweekly', price: '38.00', ri: 1 },
      { idx: 3, freq: 'weekly', price: '28.00', ri: 4 },
      { idx: 4, freq: 'weekly', price: '22.00', ri: 2 },
      { idx: 5, freq: 'weekly', price: '35.00', ri: 0 },
      { idx: 6, freq: 'biweekly', price: '42.00', ri: 3 },
      { idx: 7, freq: 'weekly', price: '19.00', ri: 1 },
      { idx: 8, freq: 'weekly', price: '30.00', ri: 4 },
      { idx: 9, freq: 'weekly', price: '27.00', ri: 2 },

      { idx: 10, freq: 'weekly', price: '29.00', ri: 1 },
      { idx: 11, freq: 'weekly', price: '24.00', ri: 4 },
      { idx: 12, freq: 'biweekly', price: '36.00', ri: 0 },
      { idx: 13, freq: 'weekly', price: '31.00', ri: 3 },
      { idx: 14, freq: 'weekly', price: '20.00', ri: 2 },
      { idx: 15, freq: 'weekly', price: '33.00', ri: 1 },
      { idx: 16, freq: 'weekly', price: '40.00', ri: 4 },
      { idx: 17, freq: 'biweekly', price: '18.00', ri: 0 },
      { idx: 18, freq: 'weekly', price: '26.00', ri: 3 },
      { idx: 19, freq: 'weekly', price: '34.00', ri: 2 },

      { idx: 20, freq: 'weekly', price: '28.00', ri: 2 },
      { idx: 21, freq: 'weekly', price: '23.00', ri: 0 },
      { idx: 22, freq: 'biweekly', price: '39.00', ri: 3 },
      { idx: 23, freq: 'weekly', price: '30.00', ri: 1 },
      { idx: 24, freq: 'weekly', price: '21.00', ri: 4 },
      { idx: 25, freq: 'weekly', price: '37.00', ri: 2 },
      { idx: 26, freq: 'weekly', price: '44.00', ri: 0 },
      { idx: 27, freq: 'biweekly', price: '17.00', ri: 3 },
      { idx: 28, freq: 'weekly', price: '29.00', ri: 1 },
      { idx: 29, freq: 'weekly', price: '35.00', ri: 4 },
    ];

    const contactIds: string[] = [];
    for (let i = 0; i < scatteredContacts.length; i++) {
      const [fn, ln, em, ph] = scatteredContacts[i];
      const autoPayEnabled = i % 10 !== 0;
      const stripeCustomerId = autoPayEnabled ? `cus_demo_scattered_${i}` : null;
      const r = await pool.query(
        `INSERT INTO contacts (company_id, first_name, last_name, email, phone, status, has_portal_access, auto_pay_enabled, auto_invoice_enabled, stripe_customer_id) VALUES ($1,$2,$3,$4,$5,'active',false,$6,true,$7) RETURNING id`,
        [companyId, fn, ln, em, ph, autoPayEnabled, stripeCustomerId]
      );
      contactIds.push(r.rows[0].id);
    }

    const propIds: string[] = [];
    for (let i = 0; i < scatteredAddresses.length; i++) {
      const [addr, lat, lng, dogs, yard] = scatteredAddresses[i];
      const parts = addr.split(', ');
      const street = parts[0];
      const city = parts[1] || 'Fredericksburg';
      const state = 'VA';
      const zip = city === 'King George' ? '22485' : '22407';
      const r = await pool.query(
        `INSERT INTO properties (company_id, contact_id, street_address, city, state, zip_code, latitude, longitude, number_of_dogs, yard_size) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [companyId, contactIds[i], street, city, state, zip, lat, lng, dogs, yard]
      );
      propIds.push(r.rows[0].id);
    }

    const planIds: string[] = [];
    for (const pc of scatteredPlanConfigs) {
      const ri = pc.ri % routeIds.length;
      const r = await pool.query(
        `INSERT INTO service_plans (company_id, contact_id, property_id, frequency, price_per_visit, is_active, start_date, stop_order, is_stop_only, route_id) VALUES ($1,$2,$3,$4,$5,true,'2026-02-01',0,false,$6) RETURNING id`,
        [companyId, contactIds[pc.idx], propIds[pc.idx], pc.freq, pc.price, routeIds[ri]]
      );
      planIds.push(r.rows[0].id);
    }

    const dayOfWeekMap = [1, 3, 5, 2, 4];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let pIdx = 0; pIdx < scatteredPlanConfigs.length; pIdx++) {
      const pc = scatteredPlanConfigs[pIdx];
      const ri = pc.ri % routeIds.length;
      const day = dayOfWeekMap[ri];
      for (let wk = 6; wk >= -1; wk--) {
        if (pc.freq === 'biweekly' && wk % 2 !== 0) continue;
        if (pc.freq === 'monthly' && wk !== 0 && wk !== 4) continue;

        const d = new Date(today);
        d.setDate(d.getDate() - (wk * 7) + (day - d.getDay()));
        const dateStr = d.toISOString().split('T')[0];

        let status: string;
        if (d > today) status = 'scheduled';
        else if (dateStr === today.toISOString().split('T')[0]) status = 'scheduled';
        else status = Math.random() > 0.1 ? 'completed' : 'skipped';

        const completedAt = status === 'completed' ? d.toISOString() : null;
        await pool.query(
          `INSERT INTO visits (company_id, service_plan_id, property_id, scheduled_date, status, completed_at) VALUES ($1,$2,$3,$4,$5,$6)`,
          [companyId, planIds[pIdx], propIds[pc.idx], dateStr, status, completedAt]
        );
      }
    }

    console.log(`[Migration] Seeded 30 scattered demo contacts across Lee Hill, Massaponax & Oakland Park`);
  } catch (err) {
    console.error("[Migration] Failed to seed scattered demo contacts:", err);
  }
}

async function seedDemoCompany() {
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const existing = await pool.query("SELECT id FROM users WHERE email = 'demo@scoopilot.com'");
    if (existing.rows.length > 0) {
      const demoCoRes = await pool.query("SELECT c.id FROM users u JOIN company_users cu ON cu.user_id = u.id JOIN companies c ON c.id = cu.company_id WHERE u.email = 'demo@scoopilot.com' LIMIT 1");
      if (demoCoRes.rows.length > 0) {
        const demoCoId = demoCoRes.rows[0].id;
        const pricingCount = await pool.query("SELECT COUNT(*) FROM service_pricing WHERE company_id = $1", [demoCoId]);
        if (parseInt(pricingCount.rows[0].count) === 0) {
          const { storage } = await import("./storage");
          await storage.seedDefaultPricing(demoCoId);
          console.log("[Migration] Demo company service pricing seeded");
        }
        await pool.query("UPDATE companies SET subscription_tier = 'tier_1_3' WHERE id = $1 AND subscription_tier != 'tier_1_3'", [demoCoId]);
        const contactCount = await pool.query("SELECT COUNT(*) FROM contacts WHERE company_id = $1", [demoCoId]);
        const cc = parseInt(contactCount.rows[0].count);
        if (cc < 90) {
          await seedExtraDemoContacts(pool, demoCoId);
        }
        if (cc < 125) {
          await seedScatteredDemoContacts(pool, demoCoId);
        }
      }
      console.log("[Migration] Demo company already exists (subscription_tier ensured tier_1_3)");
      await pool.end();
      return;
    }

    const pwHash = '6415d9a7e2946fb4151eff58f0d70ade:6ac05bd83e9fd5bb4250cfd95beb3c6e8aae77382c0ae6bcc7c49a8e3be66b419697c4450b961eb85a4d1d31ee444dbe3c965c64dc55c3d9aa70d2b0f6bacdd3';

    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, must_change_password) VALUES ($1, $2, 'Alex', 'Demo', false) RETURNING id`,
      ['demo@scoopilot.com', pwHash]
    );
    const userId = userRes.rows[0].id;

    const compRes = await pool.query(
      `INSERT INTO companies (name, slug, timezone, subscription_tier, subscription_status, charge_timing, mrr_cents, route_credits, reminders_enabled, auto_visits_enabled, ai_import_mapping_enabled, rover_ai_enabled, sms_provider)
       VALUES ('Clean Paws Fredericksburg', 'clean-paws-fredericksburg', 'America/New_York', 'tier_1_3', 'active', 'day_before', 0, 10, true, true, true, true, 'telnyx')
       RETURNING id`
    );
    const companyId = compRes.rows[0].id;

    await pool.query(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner')`, [companyId, userId]);

    const contactData = [
      ['Marcus', 'Johnson', 'marcus.j@example.com', '(540) 555-0142', 'active'],
      ['Sarah', 'Mitchell', 'sarah.m@example.com', '(540) 555-0198', 'active'],
      ['David', 'Ramirez', 'david.r@example.com', '(540) 555-0267', 'active'],
      ['Jennifer', "O'Brien", 'jennifer.ob@example.com', '(540) 555-0331', 'active'],
      ['Chris', 'Nguyen', 'chris.n@example.com', '(540) 555-0415', 'active'],
      ['Amanda', 'Foster', 'amanda.f@example.com', '(540) 555-0489', 'active'],
      ['Brian', 'Carlisle', 'brian.c@example.com', '(540) 555-0523', 'active'],
      ['Heather', 'Torres', 'heather.t@example.com', '(540) 555-0607', 'active'],
      ['Kevin', 'Whitfield', 'kevin.w@example.com', '(540) 555-0671', 'active'],
      ['Rachel', 'Simmons', 'rachel.s@example.com', '(540) 555-0745', 'active'],
      ['Tyler', 'Brooks', 'tyler.b@example.com', '(540) 555-0819', 'active'],
      ['Laura', 'Pennington', 'laura.p@example.com', '(540) 555-0883', 'lead'],
      ['Greg', 'Hoffman', 'greg.h@example.com', '(540) 555-0957', 'lead'],
      ['Nicole', 'Crawford', 'nicole.c@example.com', '(540) 555-1021', 'lead'],
      ['Mike', 'Patterson', 'mike.p@example.com', '(540) 555-1095', 'active'],
      ['Danielle', 'Marsh', 'danielle.m@example.com', '(540) 555-1102', 'active'],
      ['Patrick', 'Yates', 'patrick.y@example.com', '(540) 555-1176', 'active'],
      ['Carla', 'Benson', 'carla.b@example.com', '(540) 555-1243', 'active'],
      ['Derek', 'Sullivan', 'derek.s@example.com', '(540) 555-1317', 'active'],
      ['Megan', 'Hargrove', 'megan.h@example.com', '(540) 555-1391', 'active'],
      ['Jason', 'Draper', 'jason.d@example.com', '(540) 555-1465', 'active'],
      ['Tina', 'Blackwell', 'tina.b@example.com', '(540) 555-1539', 'active'],
      ['Ryan', 'Kessler', 'ryan.k@example.com', '(540) 555-1613', 'active'],
      ['Olivia', 'Chambers', 'olivia.c@example.com', '(540) 555-1687', 'active'],
      ['Brandon', 'Faulkner', 'brandon.f@example.com', '(540) 555-1761', 'active'],
    ];

    const contactIds: string[] = [];
    for (let i = 0; i < contactData.length; i++) {
      const [fn, ln, em, ph, st] = contactData[i];
      const autoPayEnabled = i % 10 !== 0;
      const stripeCustomerId = autoPayEnabled ? `cus_demo_base_${i}` : null;
      const r = await pool.query(
        `INSERT INTO contacts (company_id, first_name, last_name, email, phone, status, has_portal_access, auto_pay_enabled, auto_invoice_enabled, stripe_customer_id) VALUES ($1,$2,$3,$4,$5,$6,false,$7,true,$8) RETURNING id`,
        [companyId, fn, ln, em, ph, st, autoPayEnabled, stripeCustomerId]
      );
      contactIds.push(r.rows[0].id);
    }

    const addresses = [
      ['1204 Charles St', 38.3032, -77.4605, 2, 'medium'],
      ['810 William St', 38.3018, -77.4589, 1, 'small'],
      ['305 Hanover St', 38.3045, -77.4573, 3, 'large'],
      ['1501 Princess Anne St', 38.3055, -77.4612, 2, 'medium'],
      ['2108 Fall Hill Ave', 38.3102, -77.4701, 1, 'small'],
      ['904 Kenmore Ave', 38.2985, -77.4632, 2, 'large'],
      ['412 Lafayette Blvd', 38.2967, -77.4598, 1, 'medium'],
      ['1700 Plank Rd', 38.2921, -77.4915, 3, 'large'],
      ['206 Caroline St', 38.3012, -77.4567, 2, 'medium'],
      ['3200 Westwood Dr', 38.2878, -77.4832, 1, 'small'],
      ['508 Sophia St', 38.3001, -77.4555, 2, 'medium'],
      ['1105 Stafford Ave', 38.2945, -77.4678, 1, 'small'],
      ['2401 Cowan Blvd', 38.289, -77.5012, 2, 'large'],
      ['609 George St', 38.3028, -77.4582, 1, 'medium'],
      ['1303 Sunken Rd', 38.2935, -77.4745, 2, 'large'],
      ['700 Littlepage St', 38.2998, -77.4621, 1, 'medium'],
      ['1800 Augustine Ave', 38.2862, -77.4558, 3, 'large'],
      ['405 Dixon St', 38.3065, -77.4641, 2, 'small'],
      ['2205 Bragg Rd', 38.2847, -77.4889, 1, 'medium'],
      ['1010 Willis St', 38.2973, -77.4543, 2, 'large'],
      ['3400 Plank Rd', 38.2789, -77.5068, 1, 'small'],
      ['505 Weedon St', 38.3038, -77.4527, 3, 'large'],
      ['1600 Old Salem Rd', 38.2915, -77.5134, 2, 'medium'],
      ['920 Wolfe St', 38.2957, -77.4612, 1, 'small'],
      ['2600 Salem Church Rd', 38.2821, -77.5201, 2, 'large'],
    ];

    const propIds: string[] = [];
    for (let i = 0; i < addresses.length; i++) {
      const [addr, lat, lng, dogs, yard] = addresses[i];
      const r = await pool.query(
        `INSERT INTO properties (company_id, contact_id, street_address, city, state, zip_code, latitude, longitude, number_of_dogs, yard_size) VALUES ($1,$2,$3,'Fredericksburg','VA','22401',$4,$5,$6,$7) RETURNING id`,
        [companyId, contactIds[i], addr, lat, lng, dogs, yard]
      );
      propIds.push(r.rows[0].id);
    }

    const routeRes = await pool.query(
      `INSERT INTO routes (company_id, name, day_of_week, color) VALUES
        ($1, 'Downtown Mon', 'monday', '#4F46E5'),
        ($1, 'Downtown Wed', 'wednesday', '#059669'),
        ($1, 'Downtown Fri', 'friday', '#DC2626'),
        ($1, 'West Side Tue', 'tuesday', '#D97706'),
        ($1, 'West Side Thu', 'thursday', '#7C3AED')
       RETURNING id`,
      [companyId]
    );
    const routeIds = routeRes.rows.map((r: any) => r.id);

    const planConfigs = [
      { ci: 0, pi: 0, freq: 'weekly', price: '25.00', ri: 0 },
      { ci: 1, pi: 1, freq: 'weekly', price: '20.00', ri: 1 },
      { ci: 2, pi: 2, freq: 'weekly', price: '35.00', ri: 0 },
      { ci: 3, pi: 3, freq: 'biweekly', price: '30.00', ri: 3 },
      { ci: 4, pi: 4, freq: 'weekly', price: '18.00', ri: 2 },
      { ci: 5, pi: 5, freq: 'weekly', price: '28.00', ri: 1 },
      { ci: 6, pi: 6, freq: 'biweekly', price: '22.00', ri: 4 },
      { ci: 7, pi: 7, freq: 'weekly', price: '40.00', ri: 3 },
      { ci: 8, pi: 8, freq: 'weekly', price: '25.00', ri: 0 },
      { ci: 9, pi: 9, freq: 'monthly', price: '45.00', ri: 2 },
      { ci: 10, pi: 10, freq: 'weekly', price: '26.00', ri: 1 },
      { ci: 14, pi: 14, freq: 'weekly', price: '32.00', ri: 4 },
      { ci: 15, pi: 15, freq: 'weekly', price: '24.00', ri: 0 },
      { ci: 16, pi: 16, freq: 'weekly', price: '38.00', ri: 3 },
      { ci: 17, pi: 17, freq: 'weekly', price: '22.00', ri: 1 },
      { ci: 18, pi: 18, freq: 'biweekly', price: '35.00', ri: 2 },
      { ci: 19, pi: 19, freq: 'weekly', price: '27.00', ri: 4 },
      { ci: 20, pi: 20, freq: 'weekly', price: '30.00', ri: 0 },
      { ci: 21, pi: 21, freq: 'weekly', price: '42.00', ri: 3 },
      { ci: 22, pi: 22, freq: 'weekly', price: '23.00', ri: 1 },
      { ci: 23, pi: 23, freq: 'weekly', price: '19.00', ri: 2 },
      { ci: 24, pi: 24, freq: 'biweekly', price: '33.00', ri: 4 },
    ];

    const planIds: string[] = [];
    for (const pc of planConfigs) {
      const r = await pool.query(
        `INSERT INTO service_plans (company_id, contact_id, property_id, frequency, price_per_visit, is_active, start_date, stop_order, is_stop_only, route_id) VALUES ($1,$2,$3,$4,$5,true,'2026-02-01',0,false,$6) RETURNING id`,
        [companyId, contactIds[pc.ci], propIds[pc.pi], pc.freq, pc.price, routeIds[pc.ri]]
      );
      planIds.push(r.rows[0].id);
    }

    const dayMap = [1, 3, 1, 2, 5, 3, 4, 2, 1, 5, 3, 4, 1, 2, 3, 5, 4, 1, 2, 3, 5, 4];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let pIdx = 0; pIdx < planConfigs.length; pIdx++) {
      const pc = planConfigs[pIdx];
      const day = dayMap[pIdx];
      for (let wk = 6; wk >= -1; wk--) {
        if (pc.freq === 'biweekly' && wk % 2 !== 0) continue;
        if (pc.freq === 'monthly' && wk !== 0 && wk !== 4) continue;

        const d = new Date(today);
        d.setDate(d.getDate() - (wk * 7) + (day - d.getDay()));
        const dateStr = d.toISOString().split('T')[0];

        let status: string;
        if (d > today) status = 'scheduled';
        else if (dateStr === today.toISOString().split('T')[0]) status = 'scheduled';
        else status = Math.random() > 0.1 ? 'completed' : 'skipped';

        const completedAt = status === 'completed' ? d.toISOString() : null;
        await pool.query(
          `INSERT INTO visits (company_id, service_plan_id, property_id, scheduled_date, status, completed_at) VALUES ($1,$2,$3,$4,$5,$6)`,
          [companyId, planIds[pIdx], propIds[pc.pi], dateStr, status, completedAt]
        );
      }
    }

    const activeContacts = [0, 1, 2, 4, 5, 7, 10, 14];
    const prices = [25, 20, 35, 18, 28, 40, 26, 32];
    let invNum = 1;

    for (let i = 0; i < activeContacts.length; i++) {
      const cid = contactIds[activeContacts[i]];
      const price = prices[i];

      const paidTotal = (price * 4).toFixed(2);
      const paidInvNum = `INV-${String(invNum++).padStart(5, '0')}`;
      await pool.query(
        `INSERT INTO invoices (company_id, contact_id, invoice_number, due_date, subtotal, tax, total, status, auto_generated, payment_attempts, issued_date) VALUES ($1,$2,$3,'2026-03-15',$4,'0',$4,'paid',true,0,'2026-02-15')`,
        [companyId, cid, paidInvNum, paidTotal]
      );

      const draftTotal = (price * 2).toFixed(2);
      const draftInvNum = `INV-${String(invNum++).padStart(5, '0')}`;
      await pool.query(
        `INSERT INTO invoices (company_id, contact_id, invoice_number, due_date, subtotal, tax, total, status, auto_generated, payment_attempts) VALUES ($1,$2,$3,'2026-04-01',$4,'0',$4,'draft',true,0) RETURNING id`,
        [companyId, cid, draftInvNum, draftTotal]
      );
    }

    const leadSources = ['Referral', 'Nextdoor', 'Facebook', 'Google', 'Yard Sign', 'Website'];
    for (const ls of leadSources) {
      await pool.query(`INSERT INTO lead_sources (company_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [companyId, ls]);
    }

    const pricingCount = await pool.query(`SELECT COUNT(*) FROM service_pricing WHERE company_id = $1`, [companyId]);
    if (parseInt(pricingCount.rows[0].count) === 0) {
      const { storage } = await import("./storage");
      await storage.seedDefaultPricing(companyId);
      console.log("[Migration] Demo company service pricing seeded");
    }

    await seedExtraDemoContacts(pool, companyId);
    await seedScatteredDemoContacts(pool, companyId);

    await pool.end();
    console.log("[Migration] Demo company 'Clean Paws Fredericksburg' seeded successfully");
  } catch (err) {
    console.error("[Migration] Failed to seed demo company:", err);
  }
}

async function repairServicePlanDayOfWeek() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const repairResult = await pool.query(`
      UPDATE service_plans sp
      SET day_of_week = r.day_of_week
      FROM routes r
      WHERE sp.route_id = r.id
        AND (sp.day_of_week IS NULL OR sp.day_of_week != r.day_of_week)
    `);
    if (repairResult.rowCount && repairResult.rowCount > 0) {
      console.log(`[Migration] Repaired day_of_week for ${repairResult.rowCount} service plans`);
    }
    const orderResult = await pool.query(`
      WITH ranked AS (
        SELECT sp.id, ROW_NUMBER() OVER (PARTITION BY sp.route_id ORDER BY sp.created_at) AS rn
        FROM service_plans sp
        WHERE sp.route_id IS NOT NULL AND sp.is_active = true AND sp.stop_order = 0
      )
      UPDATE service_plans SET stop_order = ranked.rn
      FROM ranked WHERE service_plans.id = ranked.id
    `);
    if (orderResult.rowCount && orderResult.rowCount > 0) {
      console.log(`[Migration] Set stop_order for ${orderResult.rowCount} service plans`);
    }
  } catch (err) {
    console.error("[Migration] Service plan repair failed:", err);
  } finally {
    await pool.end();
  }
}

async function seedPoopScoopDemoData() {
  const COMPANY_NAME = "Poop Scoop Pet Waste Solutions LTD";
  const TIMEZONE = "America/Los_Angeles";
  const TOTAL = 250;

  const FIRST_NAMES = ["James","Mary","John","Patricia","Robert","Jennifer","Michael","Linda","William","Barbara","David","Elizabeth","Richard","Susan","Joseph","Jessica","Thomas","Sarah","Charles","Karen","Christopher","Lisa","Daniel","Nancy","Matthew","Betty","Anthony","Margaret","Mark","Sandra","Donald","Ashley","Steven","Dorothy","Paul","Kimberly","Andrew","Emily","Joshua","Donna","Kenneth","Michelle","Kevin","Carol","Brian","Amanda","George","Melissa","Timothy","Deborah","Ronald","Stephanie","Edward","Rebecca","Jason","Sharon","Jeffrey","Laura","Ryan","Cynthia","Jacob","Kathleen","Gary","Amy","Nicholas","Angela","Eric","Shirley","Jonathan","Anna","Stephen","Brenda","Larry","Pamela","Justin","Emma","Scott","Nicole","Brandon","Helen","Benjamin","Samantha","Samuel","Katherine","Raymond","Christine","Gregory","Debra","Frank","Rachel","Alexander","Carolyn","Patrick","Janet","Jack","Catherine","Dennis","Maria","Jerry","Heather","Tyler","Diane","Aaron","Julie"];
  const LAST_NAMES = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson","Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores","Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts","Gomez","Phillips","Evans","Turner","Diaz","Parker","Cruz","Edwards","Collins","Reyes","Stewart","Morris","Morales","Murphy","Cook","Rogers","Gutierrez","Ortiz","Morgan","Cooper","Peterson","Bailey","Reed","Kelly","Howard","Ramos","Kim","Cox","Ward","Richardson","Watson","Brooks","Chavez","Wood","James","Bennett","Gray","Mendoza","Ruiz","Hughes","Price","Alvarez","Castillo","Sanders","Patel","Myers","Long","Ross","Foster","Jimenez","Powell","Jenkins","Perry","Russell"];
  const STREETS = ["Meridian St","Lakeway Dr","Alabama St","King St","Cornwall Ave","Railroad Ave","Ellis St","Holly St","Magnolia Ave","Douglas Ave","Sunset Dr","Lincoln St","Grant St","Monroe St","State St","Bay St","Maple St","Oak St","Cedar St","Pine St","Birch St","Elm St","Walnut Ave","Chestnut Ave","Alder St","Iowa St","Kentucky St","Virginia St","Michigan St","Indiana St","Ohio St","Wisconsin St","Missouri St","Illinois St","Texas St","Cable St","Bill McDonald Pkwy","James St","Champion St","Stuart Rd","Donovan Ave","Connelly Ave","Yew St","Fir St","Spruce St","Garden St","Forest St","Valley Dr","Ridge Dr","Hill Dr","Park Ave","Lake Dr","Shore Dr","Bay Dr","Crest Dr","View Dr","Summit Dr","Meadow Ln","Woodland Dr","Hillcrest Dr"];
  const ZIP_CODES = ["98225","98226","98229"];
  const ZIP_WEIGHTS = [0.4, 0.35, 0.25];
  const YARD_SIZES = ["small","medium","large"];
  const YARD_DIFFICULTIES = ["flat","moderate","difficult"];
  const FREQUENCIES = ["weekly","biweekly","monthly"];
  const FREQ_WEIGHTS = [0.50, 0.35, 0.15];
  const DAYS = ["monday","tuesday","wednesday","thursday","friday","saturday"];
  const DOMAINS = ["gmail.com","yahoo.com","hotmail.com","outlook.com","icloud.com","comcast.net"];

  const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
  const wpick = <T>(items: T[], weights: number[]) => {
    let r = Math.random(), c = 0;
    for (let i = 0; i < items.length; i++) { c += weights[i]; if (r < c) return items[i]; }
    return items[items.length - 1];
  };
  const rInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
  const rPhone = () => `(${rInt(200,999)}) ${rInt(200,999)}-${rInt(1000,9999)}`;
  const rEmail = (f: string, l: string, i: number) => {
    const d = pick(DOMAINS);
    return pick([`${f.toLowerCase()}.${l.toLowerCase()}${i}@${d}`,`${f.toLowerCase()}${l.toLowerCase().charAt(0)}${i}@${d}`,`${f.toLowerCase().charAt(0)}${l.toLowerCase()}${i}@${d}`]);
  };
  const rStatus = () => { const r = Math.random(); return r < 0.80 ? "active" : r < 0.90 ? "paused" : "cancelled"; };
  const rPrice = (freq: string, dogs: number) => {
    const base: Record<string,number> = { weekly: 18, biweekly: 28, monthly: 42 };
    return Math.max(15, Math.min(55, (base[freq] ?? 25) + (dogs - 1) * 5 + rInt(-2, 5)));
  };
  const rStartDate = () => {
    const d = new Date(); d.setMonth(d.getMonth() - rInt(6, 18)); d.setDate(rInt(1, 28));
    return d.toISOString().split("T")[0];
  };

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    let companyRes = await pool.query(`SELECT id FROM companies WHERE name = $1 LIMIT 1`, [COMPANY_NAME]);
    let companyId: string;
    if (companyRes.rows.length === 0) {
      const ins = await pool.query(
        `INSERT INTO companies (name, timezone, subscription_tier, subscription_status) VALUES ($1,$2,$3,$4) RETURNING id`,
        [COMPANY_NAME, TIMEZONE, "tier_6_10", "active"]
      );
      companyId = ins.rows[0].id;
      console.log(`[Migration] Poop Scoop company created: ${companyId}`);
    } else {
      companyId = companyRes.rows[0].id;
    }

    const countRes = await pool.query(`SELECT COUNT(*) AS cnt FROM contacts WHERE company_id = $1`, [companyId]);
    if (parseInt(countRes.rows[0].cnt, 10) > 10) {
      console.log("[Migration] Poop Scoop already seeded — skipping");
      return;
    }

    console.log(`[Migration] Seeding ${TOTAL} Poop Scoop contacts...`);
    for (let i = 0; i < TOTAL; i++) {
      const firstName = pick(FIRST_NAMES), lastName = pick(LAST_NAMES);
      const dogs = rInt(1, 4);
      const freq = wpick(FREQUENCIES, FREQ_WEIGHTS);
      const cRes = await pool.query(
        `INSERT INTO contacts (company_id,first_name,last_name,email,phone,street_address,city,state,zip_code,number_of_dogs,yard_size,service_frequency,service_day,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [companyId, firstName, lastName, rEmail(firstName, lastName, i), rPhone(),
         `${rInt(100,9999)} ${pick(STREETS)}`, "Bellingham", "WA", wpick(ZIP_CODES, ZIP_WEIGHTS),
         dogs, pick(YARD_SIZES), freq, pick(DAYS), rStatus()]
      );
      const contactId = cRes.rows[0].id;
      const pRes = await pool.query(
        `INSERT INTO properties (company_id,contact_id,street_address,city,state,zip_code,number_of_dogs,yard_size,yard_difficulty)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [companyId, contactId, `${rInt(100,9999)} ${pick(STREETS)}`, "Bellingham", "WA",
         wpick(ZIP_CODES, ZIP_WEIGHTS), dogs, pick(YARD_SIZES), pick(YARD_DIFFICULTIES)]
      );
      await pool.query(
        `INSERT INTO service_plans (company_id,contact_id,property_id,frequency,day_of_week,price_per_visit,is_active,job_status,start_date,job_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [companyId, contactId, pRes.rows[0].id, freq, pick(DAYS),
         rPrice(freq, dogs).toFixed(2), true, "active", rStartDate(), "recurring"]
      );
    }
    console.log(`[Migration] Poop Scoop seeded: ${TOTAL} contacts, properties, and service plans`);
  } catch (err) {
    console.error("[Migration] Poop Scoop seed failed:", err);
  } finally {
    await pool.end();
  }
}

async function backfillPropertyCoordinates() {
  const { Pool } = await import("pg");
  const { geocodeAddress } = await import("./services/geocode");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Use an advisory lock so only one instance runs the backfill at a time.
    // hashtext produces a stable 32-bit int from the string key.
    const lockResult = await pool.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext('property_geocode_backfill')) AS acquired`
    );
    if (!lockResult.rows[0]?.acquired) {
      console.log("[Geocode Backfill] Another instance is running backfill — skipping");
      return;
    }
    try {
      const { rows } = await pool.query<{
        id: string;
        street_address: string;
        city: string | null;
        state: string | null;
        zip_code: string | null;
      }>(
        `SELECT id, street_address, city, state, zip_code FROM properties WHERE street_address IS NOT NULL AND street_address <> '' AND (latitude IS NULL OR longitude IS NULL)`
      );
      if (rows.length === 0) {
        console.log("[Geocode Backfill] No properties missing coordinates");
        return;
      }
      console.log(`[Geocode Backfill] Found ${rows.length} properties missing coordinates, geocoding now...`);
      let geocoded = 0;
      for (const row of rows) {
        try {
          const coords = await geocodeAddress(row.street_address, row.city, row.state, row.zip_code);
          if (coords) {
            await pool.query(
              `UPDATE properties SET latitude = $1, longitude = $2, updated_at = NOW() WHERE id = $3`,
              [coords.latitude, coords.longitude, row.id]
            );
            geocoded++;
          }
        } catch {
          // Skip individual failures silently
        }
      }
      console.log(`[Geocode Backfill] Geocoded ${geocoded} of ${rows.length} properties`);
    } finally {
      await pool.query(`SELECT pg_advisory_unlock(hashtext('property_geocode_backfill'))`);
    }
  } catch (err) {
    console.error("[Geocode Backfill] Failed:", err);
  } finally {
    await pool.end();
  }
}

async function ensureVisitsUniqueConstraint() {
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const constraintCheck = await pool.query(`
        SELECT 1 FROM pg_constraint
        WHERE conname = 'visits_service_plan_id_scheduled_date_unique'
        AND conrelid = 'visits'::regclass
      `);
      if (constraintCheck.rows.length > 0) {
        console.log("[Migration] visits unique constraint already exists, skipping");
        return;
      }

      await pool.query(`
        DELETE FROM visits v
        USING (
          SELECT
            service_plan_id,
            scheduled_date,
            (
              SELECT id FROM visits inner_v
              WHERE inner_v.service_plan_id = grp.service_plan_id
                AND inner_v.scheduled_date = grp.scheduled_date
              ORDER BY
                CASE WHEN inner_v.status = 'cancelled' THEN 1 ELSE 0 END ASC,
                CASE
                  WHEN inner_v.status IN ('completed', 'in_progress') THEN 0
                  ELSE 1
                END ASC,
                inner_v.id ASC
              LIMIT 1
            ) AS keep_id
          FROM (
            SELECT DISTINCT service_plan_id, scheduled_date FROM visits
            GROUP BY service_plan_id, scheduled_date HAVING COUNT(*) > 1
          ) grp
        ) duplicates
        WHERE v.service_plan_id = duplicates.service_plan_id
          AND v.scheduled_date = duplicates.scheduled_date
          AND v.id != duplicates.keep_id
      `);
      console.log("[Migration] Deduplicated visits rows");

      await pool.query(`
        ALTER TABLE visits
        ADD CONSTRAINT visits_service_plan_id_scheduled_date_unique
        UNIQUE (service_plan_id, scheduled_date)
      `);
      console.log("[Migration] Added unique constraint on visits(service_plan_id, scheduled_date)");
    } finally {
      await pool.end();
    }
  } catch (err) {
    console.error("[Migration] ensureVisitsUniqueConstraint failed:", err);
  }
}

async function applyDemoAutopayMigration() {
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const demoCoRes = await pool.query(
      `SELECT c.id FROM users u
       JOIN company_users cu ON cu.user_id = u.id
       JOIN companies c ON c.id = cu.company_id
       WHERE u.email = 'demo@scoopilot.com'
       LIMIT 1`
    );

    if (demoCoRes.rows.length === 0) {
      await pool.end();
      return;
    }

    const demoCoId = demoCoRes.rows[0].id;

    const result = await pool.query(
      `WITH all_contacts AS (
         SELECT id,
                ROW_NUMBER() OVER (ORDER BY id) AS rn,
                COUNT(*) OVER ()                AS total
         FROM contacts
         WHERE company_id = $1
       ),
       target AS (
         SELECT id FROM all_contacts
         WHERE rn <= FLOOR(total * 0.9)
       )
       UPDATE contacts
       SET auto_pay_enabled   = true,
           stripe_customer_id = 'cus_demo_' || LEFT(contacts.id, 8)
       FROM target
       WHERE contacts.id = target.id
         AND contacts.stripe_customer_id IS NULL
       RETURNING contacts.id`,
      [demoCoId]
    );

    if (result.rowCount && result.rowCount > 0) {
      console.log(`[Migration] Set ${result.rowCount} demo contacts to autopay`);
    } else {
      console.log("[Migration] Demo autopay migration: no contacts needed updating");
    }

    await pool.end();
  } catch (err) {
    console.error("[Migration] Failed to apply demo autopay migration:", err);
  }
}

async function ensureErrorReportsTable() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'error_report_status') THEN
          CREATE TYPE error_report_status AS ENUM ('open', 'acknowledged', 'resolved');
        END IF;
      END $$;
    `);
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'error_report_type') THEN
          CREATE TYPE error_report_type AS ENUM ('react', 'js', 'api');
        END IF;
      END $$;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS error_reports (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        message TEXT NOT NULL,
        stack TEXT,
        error_type error_report_type NOT NULL DEFAULT 'js',
        page_url TEXT,
        user_id VARCHAR(255),
        company_id VARCHAR(255),
        user_agent TEXT,
        status error_report_status NOT NULL DEFAULT 'open',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_er_status ON error_reports (status);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_er_created ON error_reports (created_at);`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS error_fix_tasks (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        error_report_id VARCHAR NOT NULL REFERENCES error_reports(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status VARCHAR NOT NULL DEFAULT 'open',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_eft_report ON error_fix_tasks (error_report_id);`);
    console.log("[Migration] error_reports table ensured");
  } catch (err) {
    console.error("[Migration] Failed to ensure error_reports table:", err);
  } finally {
    await pool.end();
  }
}

async function ensureCompanyNotificationColumns() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Check if the column already exists before adding it.
    // The backfill UPDATE must only run ONCE (on first deployment) so that it never
    // overrides a user-controlled Import Mode toggle on subsequent restarts.
    const colCheck = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'companies' AND column_name = 'client_notifications_suppressed'
      LIMIT 1;
    `);
    const isFirstMigration = (colCheck.rowCount ?? 0) === 0;

    await pool.query(`
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS client_notifications_suppressed BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarding_complete_sent_at TIMESTAMP;
    `);

    if (isFirstMigration) {
      // One-time backfill: existing tenants who already have contacts default to NOT suppressed
      // so their existing email flows aren't suddenly broken after this migration.
      await pool.query(`
        UPDATE companies c
        SET client_notifications_suppressed = false
        WHERE EXISTS (
          SELECT 1 FROM contacts ct WHERE ct.company_id = c.id LIMIT 1
        )
        AND client_notifications_suppressed = true
        AND onboarding_complete_sent_at IS NULL;
      `);
      console.log("[Migration] client_notifications_suppressed backfill applied (one-time)");
    }

    // Ops fix: Lake Erie Scoopers is onboarding — keep Import Mode ON until they send the
    // welcome batch (which sets onboarding_complete_sent_at and turns suppression off).
    // Guard: only applies while onboarding_complete_sent_at is still null.
    await pool.query(`
      UPDATE companies
      SET client_notifications_suppressed = true
      WHERE id = '8089c512-bec6-47e1-9678-ec3e3eda4e95'
        AND onboarding_complete_sent_at IS NULL;
    `);

    console.log("[Migration] client_notifications_suppressed + onboarding_complete_sent_at columns verified");
  } catch (err) {
    console.error("[Migration] Failed to ensure company notification columns:", err);
  } finally {
    await pool.end();
  }
}

async function ensureVisitEnRouteAtColumn() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`ALTER TABLE visits ADD COLUMN IF NOT EXISTS en_route_at TIMESTAMP`);
    console.log("[Migration] visits en_route_at column verified");
  } catch (err) {
    console.error("[Migration] Failed to ensure en_route_at column:", err);
  } finally {
    await pool.end();
  }
}

async function ensureRetellWebhookRepairsTable() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS retell_webhook_repairs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR REFERENCES companies(id) ON DELETE CASCADE,
        agent_id VARCHAR(255) NOT NULL,
        old_url TEXT,
        new_url TEXT NOT NULL,
        triggered_by VARCHAR(10) NOT NULL DEFAULT 'auto',
        repaired_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_retell_webhook_repairs_company ON retell_webhook_repairs (company_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_retell_webhook_repairs_repaired_at ON retell_webhook_repairs (repaired_at);`);
    console.log("[Migration] retell_webhook_repairs table ensured");
  } catch (err) {
    console.error("[Migration] Failed to ensure retell_webhook_repairs table:", err);
  } finally {
    await pool.end();
  }
}

async function ensureReviewTokenGoogleUrl() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`ALTER TABLE review_tokens ADD COLUMN IF NOT EXISTS google_review_url TEXT`);
    console.log("[Migration] review_tokens google_review_url column verified");
  } catch (err) {
    console.error("[Migration] Failed to ensure review_tokens google_review_url column:", err);
  } finally {
    await pool.end();
  }
}

async function ensureUserColumns() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_email_sent_at TIMESTAMP`);
    console.log("[Migration] users onboarding_email_sent_at column verified");
  } catch (err) {
    console.error("[Migration] Failed to ensure users onboarding_email_sent_at column:", err);
  } finally {
    await pool.end();
  }
}

async function ensureVoicePortingColumn() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS porting_phone_number VARCHAR(20)`);
    console.log("[Migration] companies porting_phone_number column verified");
  } catch (err) {
    console.error("[Migration] Failed to ensure companies porting_phone_number column:", err);
  } finally {
    await pool.end();
  }
}

async function seedHistoricalDemoData() {
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const compRes = await pool.query(`
      SELECT c.id FROM companies c
      JOIN company_users cu ON cu.company_id = c.id
      JOIN users u ON u.id = cu.user_id
      WHERE u.email = 'demo@scoopilot.com' LIMIT 1
    `);
    if (!compRes.rows.length) { await pool.end(); return; }
    const companyId = compRes.rows[0].id;

    const seededCheck = await pool.query(
      `SELECT COUNT(*) FROM visits WHERE company_id = $1 AND scheduled_date < NOW() - INTERVAL '150 days'`,
      [companyId]
    );
    if (parseInt(seededCheck.rows[0].count) > 0) {
      console.log("[Migration] Historical demo data already seeded — skipping");
      await pool.end();
      return;
    }

    const plansRes = await pool.query(`
      SELECT sp.id, sp.contact_id, sp.property_id, sp.frequency, sp.price_per_visit,
             r.day_of_week
      FROM service_plans sp
      LEFT JOIN routes r ON r.id = sp.route_id
      WHERE sp.company_id = $1 AND sp.is_active = true AND sp.is_stop_only = false
      ORDER BY sp.created_at
    `, [companyId]);

    const plans = plansRes.rows;
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - 49);

    const total = plans.length;
    const boundaries = [
      { months: 12, cumPct: 0.08 },
      { months: 11, cumPct: 0.15 },
      { months: 10, cumPct: 0.24 },
      { months: 9,  cumPct: 0.36 },
      { months: 8,  cumPct: 0.49 },
      { months: 7,  cumPct: 0.66 },
      { months: 6,  cumPct: 0.83 },
    ];

    const joinMonthsAgo: number[] = [];
    for (let i = 0; i < total; i++) {
      const pct = i / total;
      let monthsAgo = 0;
      for (const b of boundaries) {
        if (pct < b.cumPct) { monthsAgo = b.months; break; }
      }
      joinMonthsAgo.push(monthsAgo);
    }

    const dayNums: Record<string, number> = {
      monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6, sunday: 0,
    };
    const monthNames = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December'];

    const invNumRes = await pool.query(
      `SELECT invoice_number FROM invoices WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [companyId]
    );
    let nextInvNum = 300;
    if (invNumRes.rows.length > 0) {
      const m = invNumRes.rows[0].invoice_number.match(/\d+/);
      if (m) nextInvNum = Math.max(nextInvNum, parseInt(m[0]) + 1);
    }

    let visitsCreated = 0;
    let invoicesCreated = 0;

    for (let pIdx = 0; pIdx < plans.length; pIdx++) {
      const plan = plans[pIdx];
      const monthsAgo = joinMonthsAgo[pIdx];
      if (monthsAgo === 0) continue;

      const joinDate = new Date(now);
      joinDate.setMonth(joinDate.getMonth() - monthsAgo);
      joinDate.setDate(1);

      const dayNum = plan.day_of_week ? (dayNums[plan.day_of_week] ?? 1) : 1;
      const price = parseFloat(plan.price_per_visit);

      const d = new Date(joinDate);
      while (d.getDay() !== dayNum) d.setDate(d.getDate() + 1);

      const visitsByMonth: Record<string, { count: number }> = {};
      let weekCount = 0;

      while (d < cutoffDate) {
        const shouldSkipBiweekly = plan.frequency === 'biweekly' && weekCount % 2 !== 0;
        const shouldSkipMonthly = plan.frequency === 'monthly' && weekCount % 4 !== 0;
        if (!shouldSkipBiweekly && !shouldSkipMonthly) {
          const dateStr = d.toISOString().split('T')[0];
          const status = Math.random() < 0.93 ? 'completed' : 'skipped';
          const completedAt = status === 'completed' ? `${dateStr}T10:30:00Z` : null;
          try {
            await pool.query(
              `INSERT INTO visits (company_id, service_plan_id, property_id, scheduled_date, status, completed_at)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT ON CONSTRAINT visits_service_plan_id_scheduled_date_unique DO NOTHING`,
              [companyId, plan.id, plan.property_id, dateStr, status, completedAt]
            );
            visitsCreated++;
          } catch { /* skip */ }

          if (status === 'completed') {
            const mk = dateStr.substring(0, 7);
            if (!visitsByMonth[mk]) visitsByMonth[mk] = { count: 0 };
            visitsByMonth[mk].count++;
          }
        }
        d.setDate(d.getDate() + 7);
        weekCount++;
      }

      for (const [monthKey, data] of Object.entries(visitsByMonth)) {
        if (data.count === 0) continue;
        const [yr, mo] = monthKey.split('-').map(Number);
        const issuedDate = `${yr}-${String(mo).padStart(2,'0')}-01`;
        const dueDate = new Date(yr, mo, 5).toISOString().split('T')[0];
        const paidAt = new Date(yr, mo - 1, 28, 9, 0, 0).toISOString();
        const subtotal = (price * data.count).toFixed(2);
        const invoiceNumber = `INV-${String(nextInvNum).padStart(5,'0')}`;
        nextInvNum++;
        try {
          const invRes = await pool.query(
            `INSERT INTO invoices (company_id, contact_id, invoice_number, due_date, subtotal, tax, total, status, paid_at, auto_generated, source, issued_date)
             VALUES ($1,$2,$3,$4,$5,'0',$5,'paid',$6,true,'auto',$7) RETURNING id`,
            [companyId, plan.contact_id, invoiceNumber, dueDate, subtotal, paidAt, issuedDate]
          );
          await pool.query(
            `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, total)
             VALUES ($1,$2,$3,$4,$5)`,
            [invRes.rows[0].id, `${monthNames[mo-1]} ${yr} service`, data.count, price.toFixed(2), subtotal]
          );
          invoicesCreated++;
        } catch { /* skip */ }
      }
    }

    console.log(`[Migration] Historical demo data seeded: ${visitsCreated} visits, ${invoicesCreated} invoices across 6 months`);
    await pool.end();
  } catch (err) {
    console.error("[Migration] Failed to seed historical demo data:", err);
  }
}

async function auditRetellWebhooks() {
  try {
    const { storage } = await import("./storage");
    const { getAppBaseUrl, getRetellAgentWebhookUrl, registerRetellWebhook } = await import("./services/retell");

    const allCompanies = await storage.getAllCompanies();
    const voiceTenants = allCompanies.filter(
      (c) => c.voicePlanStatus === "active" && c.retellAgentId,
    );

    if (voiceTenants.length === 0) {
      console.log("[RetellAudit] No active voice-plan tenants to check");
      return;
    }

    const expectedBase = getAppBaseUrl();
    const expectedWebhook = expectedBase ? `${expectedBase}/api/webhooks/retell` : null;

    for (const company of voiceTenants) {
      const agentId = company.retellAgentId!;
      try {
        const currentUrl = await getRetellAgentWebhookUrl(agentId);
        const isRegistered = expectedWebhook
          ? currentUrl === expectedWebhook
          : !!currentUrl;

        if (isRegistered) {
          console.log(`[RetellAudit] Webhook OK for company ${company.id} (agent ${agentId}): ${currentUrl}`);
          continue;
        }

        console.warn(`[RetellAudit] Webhook missing/mismatched for company ${company.id} (agent ${agentId}). Current: "${currentUrl}", expected: "${expectedWebhook}". Attempting re-registration…`);

        try {
          if (!expectedWebhook) {
            throw new Error("APP_BASE_URL is not configured — cannot form a valid webhook URL to register");
          }
          await registerRetellWebhook(agentId);
          console.log(`[RetellAudit] Webhook re-registered successfully for company ${company.id}`);
        } catch (reregErr: any) {
          console.error(`[RetellAudit] Webhook re-registration failed for company ${company.id}:`, reregErr);
          await storage.createNotification({
            companyId: company.id,
            type: "system_warning",
            title: "Call Tracking Webhook Not Configured",
            message: `The Retell voice agent webhook is not registered for your account (agent: ${agentId}). Call tracking may not be working. Automatic re-registration failed: ${reregErr.message}. Please contact support or check Settings.`,
            linkUrl: "/settings",
            isRead: false,
          });
        }
      } catch (checkErr: any) {
        console.error(`[RetellAudit] Failed to check webhook for company ${company.id} (agent ${agentId}):`, checkErr);
      }
    }
  } catch (err) {
    console.error("[RetellAudit] Audit failed:", err);
  }
}

async function seedLakeErieScoopersAccount() {
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const crypto = await import("crypto");

    const existing = await pool.query("SELECT id FROM users WHERE email = 'lakeeriescoopers@gmail.com'");
    if (existing.rows.length > 0) {
      console.log("[Migration] Lake Erie Scoopers account already exists");
      await pool.end();
      return;
    }

    // Random scrypt password — account requires password reset on first login
    const tmpRaw = crypto.randomBytes(12).toString("base64url");
    const salt = crypto.randomBytes(16).toString("hex");
    const key = await new Promise<Buffer>((res, rej) =>
      crypto.scrypt(tmpRaw, salt, 64, (err, k) => (err ? rej(err) : res(k as Buffer)))
    );
    const pwHash = `${salt}:${key.toString("hex")}`;

    const compRes = await pool.query(`
      INSERT INTO companies (name, slug, timezone, subscription_tier, subscription_status,
        charge_timing, route_credits, reminders_enabled, auto_visits_enabled,
        ai_import_mapping_enabled, rover_ai_enabled, sms_provider, max_stops_per_route)
      VALUES ('Lake Erie Scoopers', 'lake-erie-scoopers', 'America/New_York', 'tier_1_3',
        'active', 'day_before', 30, true, true, true, true, 'telnyx', 50)
      RETURNING id
    `);
    const companyId = compRes.rows[0].id;

    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, must_change_password)
       VALUES ('lakeeriescoopers@gmail.com', $1, 'Lake Erie', 'Scoopers', true) RETURNING id`,
      [pwHash]
    );
    const userId = userRes.rows[0].id;

    await pool.query(
      `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [companyId, userId]
    );

    // 24-hour password-set token
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt]
    );

    const baseUrl = process.env.APP_BASE_URL || "https://app.scoopilot.com";
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;
    const { sendEmail } = await import("./services/email");
    await sendEmail({
      to: "lakeeriescoopers@gmail.com",
      subject: "Your ScooPilot account is ready",
      text: `Your Lake Erie Scoopers account on ScooPilot is ready.\n\nClick the link below to set your password and log in:\n\n${resetUrl}\n\nThis link expires in 24 hours.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background-color:#2d8a5e;padding:20px;text-align:center;">
            <h1 style="color:white;margin:0;">ScooPilot</h1>
          </div>
          <div style="padding:20px;border:1px solid #e5e7eb;">
            <h2 style="margin-top:0;">Your account is ready</h2>
            <p>Your <strong>Lake Erie Scoopers</strong> account has been created. Click below to set your password:</p>
            <div style="text-align:center;margin:30px 0;">
              <a href="${resetUrl}" style="background-color:#2d8a5e;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">Set My Password</a>
            </div>
            <p style="color:#6b7280;font-size:14px;">This link expires in 24 hours.</p>
            <p style="color:#9ca3af;font-size:12px;margin-top:20px;">If the button doesn't work, copy and paste this link into your browser:<br/>${resetUrl}</p>
          </div>
        </div>
      `,
    });

    console.log(`[Migration] Lake Erie Scoopers created — company: ${companyId}, user: ${userId}. Reset email sent to lakeeriescoopers@gmail.com.`);
    await pool.end();
  } catch (err) {
    console.error("[Migration] Failed to create Lake Erie Scoopers account:", err);
  }
}

(async () => {
  await applyAdminCredentialMigration();
  await ensureCompanyColumns();
  await dropConnectedAccountsTable();
  await ensureMmsSchema();
  await ensureAttachmentsSchema();
  await ensureMaxStopsSchema();
  await ensureCanadaMarketColumns();
  await migrateServicePlansToAgreementsAndJobs();
  await repairServicePlanDayOfWeek();
  await repairDuplicateStopOrders();
  await ensureVisitsUniqueConstraint();
  await syncSubscriptionTiers();
  await seedDemoCompany();
  await seedLakeErieScoopersAccount();
  await applyDemoAutopayMigration();
  await ensureErrorReportsTable();
  await ensureCompanyNotificationColumns();
  await ensureRetellWebhookRepairsTable();
  await ensureReviewTokenGoogleUrl();
  await ensureUserColumns();
  await ensureVisitEnRouteAtColumn();
  await ensureVoicePortingColumn();
  await seedPoopScoopDemoData();
  await seedHistoricalDemoData();
  await runStartupMigrations();
  setupSession(app);
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    if (res.headersSent) {
      return next(err);
    }

    if (status >= 500) {
      console.error("Internal Server Error:", err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);

      import("./services/quickbooks").then(({ isQboConfigured, startCdcPolling }) => {
        if (isQboConfigured()) {
          startCdcPolling();
        } else {
          console.log("[QBO CDC] QBO not configured, skipping CDC polling");
        }
      }).catch(err => console.error("[QBO CDC] Failed to initialize CDC polling:", err));

      backfillPropertyCoordinates().catch(err =>
        console.error("[Geocode Backfill] Unexpected error:", err)
      );

      auditRetellWebhooks().catch(err =>
        console.error("[RetellAudit] Unexpected error:", err)
      );
    },
  );
})();
