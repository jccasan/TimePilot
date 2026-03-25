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
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS sms_provider VARCHAR(20) NOT NULL DEFAULT 'twilio';
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS telnyx_api_key TEXT;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS telnyx_phone_number VARCHAR(20);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS telnyx_messaging_profile_id VARCHAR(255);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS retell_agent_id VARCHAR(255);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS retell_knowledge_base_id VARCHAR(255);
      ALTER TABLE routes ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;
    `);
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
    console.log("[Migration] Company voice columns verified");
  } catch (err) {
    console.error("[Migration] Failed to ensure company columns:", err);
  } finally {
    await pool.end();
  }
}

(async () => {
  await applyAdminCredentialMigration();
  await ensureCompanyColumns();
  await syncSubscriptionTiers();
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
    },
  );
})();
