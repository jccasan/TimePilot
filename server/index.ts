import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import session from "express-session";
import connectPg from "connect-pg-simple";

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
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.googleapis.com", "https://*.gstatic.com", "https://*.mapbox.com"],
      connectSrc: ["'self'", "https://api.mapbox.com", "https://*.tiles.mapbox.com", "https://events.mapbox.com", "wss:"],
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
  origin: (origin, callback) => {
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
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});
app.use("/api", apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, please try again later" },
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/portal/auth/login", authLimiter);

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
        logLine += ` :: ${JSON.stringify(capturedJsonResponse).substring(0, 200)}`;
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
      ALTER TABLE routes ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;
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
  } catch (err) {
    console.error("[Migration] Failed to ensure company columns:", err);
  } finally {
    await pool.end();
  }
}

/**
 * Ensures the `connected_accounts` table exists for the Stripe Connect V2 integration.
 * This is an idempotent CREATE TABLE IF NOT EXISTS so it is safe to run on every boot.
 * The table tracks the mapping between companies and their V2 Stripe account IDs plus
 * platform subscription status.
 */
async function ensureConnectedAccountsTable() {
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS connected_accounts (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        stripe_account_id VARCHAR(255) NOT NULL UNIQUE,
        subscription_status VARCHAR(50) NOT NULL DEFAULT 'none',
        stripe_subscription_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_connected_accounts_company ON connected_accounts(company_id);
    `);

    console.log("[Migration] connected_accounts table verified");
    await pool.end();
  } catch (err) {
    console.error("[Migration] Failed to ensure connected_accounts table:", err);
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
        ON CONFLICT (service_plan_id) DO NOTHING
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
        ON CONFLICT (service_plan_id) DO NOTHING
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

  await pool.end();
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
      }
      console.log("[Migration] Demo company already exists");
      await pool.end();
      return;
    }

    const pwHash = 'c432304d6d32bf305f0c66b607e05581:bad70236ce9513ae6733fca4b215d4baabf4609144cb108386d2603ddf1d6307db2ea6b81414d068a0fbe3a0d6e42dfa8bc2dfbaf1842ec15f6c4b15f427b7e8';

    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, must_change_password) VALUES ($1, $2, 'Alex', 'Demo', false) RETURNING id`,
      ['demo@scoopilot.com', pwHash]
    );
    const userId = userRes.rows[0].id;

    const compRes = await pool.query(
      `INSERT INTO companies (name, slug, timezone, subscription_tier, subscription_status, charge_timing, mrr_cents, route_credits, reminders_enabled, auto_visits_enabled, ai_import_mapping_enabled, rover_ai_enabled, sms_provider)
       VALUES ('Clean Paws Fredericksburg', 'clean-paws-fredericksburg', 'America/New_York', 'tier_1', 'active', 'day_before', 0, 10, true, true, true, true, 'telnyx')
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
    for (const [fn, ln, em, ph, st] of contactData) {
      const r = await pool.query(
        `INSERT INTO contacts (company_id, first_name, last_name, email, phone, status, has_portal_access, auto_pay_enabled, auto_invoice_enabled) VALUES ($1,$2,$3,$4,$5,$6,false,false,true) RETURNING id`,
        [companyId, fn, ln, em, ph, st]
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
    const addrs2 = ['1204 Charles St', '810 William St', '305 Hanover St', '2108 Fall Hill Ave', '904 Kenmore Ave', '1700 Plank Rd', '508 Sophia St', '1303 Sunken Rd'];
    let invNum = 1;

    for (let i = 0; i < activeContacts.length; i++) {
      const cid = contactIds[activeContacts[i]];
      const price = prices[i];
      const addr = addrs2[i];

      const paidTotal = (price * 4).toFixed(2);
      const paidInvNum = `INV-${String(invNum++).padStart(5, '0')}`;
      await pool.query(
        `INSERT INTO invoices (company_id, contact_id, invoice_number, due_date, subtotal, tax, total, status, auto_generated, payment_attempts, issued_date) VALUES ($1,$2,$3,'2026-03-15',$4,'0',$4,'paid',true,0,'2026-02-15')`,
        [companyId, cid, paidInvNum, paidTotal]
      );

      const draftTotal = (price * 2).toFixed(2);
      const draftInvNum = `INV-${String(invNum++).padStart(5, '0')}`;
      const draftRes = await pool.query(
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

(async () => {
  await applyAdminCredentialMigration();
  await ensureCompanyColumns();
  await ensureConnectedAccountsTable();
  await ensureMmsSchema();
  await migrateServicePlansToAgreementsAndJobs();
  await repairServicePlanDayOfWeek();
  await syncSubscriptionTiers();
  await seedDemoCompany();
  setupSession(app);
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
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
    },
  );
})();
