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
      imgSrc: ["'self'", "data:", "blob:", "https://*.googleapis.com", "https://*.gstatic.com"],
      connectSrc: ["'self'", "https://api.mapbox.com", "https://*.tiles.mapbox.com", "wss:"],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  frameguard: process.env.NODE_ENV === "production" ? { action: "sameorigin" } : false,
}));

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
    
    const targetHash = "50d83da102429ca2f8823c15410c4a25:b19fdd81a626bbc1e207d973ceed5158b8c5df6162af4a07333eb141bf731e9ffbd382d00afa917635eac86a000f45e2e0a4e35102c69bd3cf0a88a2cb1ff88a";
    const targetEmail = "jeremy@doocrewva.com";
    
    const check = await pool.query("SELECT id, password_hash FROM users WHERE email = 'jeremy@scoopilot.com' OR email = 'jeremy@doocrewva.com'");
    if (check.rows.length > 0) {
      const row = check.rows[0];
      if (row.password_hash !== targetHash) {
        await pool.query(
          "UPDATE users SET email = $1, password_hash = $2, updated_at = NOW() WHERE id = $3",
          [targetEmail, targetHash, row.id]
        );
        console.log("[Migration] Tenant credentials updated successfully");
      } else {
        console.log("[Migration] Tenant credentials already up to date");
      }
    }

    const adminCheck = await pool.query("SELECT id, password_hash FROM admin_users WHERE email = 'jeremy@scoopilot.com' OR email = 'jeremy@doocrewva.com'");
    if (adminCheck.rows.length > 0) {
      const adminRow = adminCheck.rows[0];
      if (adminRow.password_hash !== targetHash) {
        await pool.query(
          "UPDATE admin_users SET email = $1, password_hash = $2 WHERE id = $3",
          [targetEmail, targetHash, adminRow.id]
        );
        console.log("[Migration] Platform admin credentials updated successfully");
      } else {
        console.log("[Migration] Platform admin credentials already up to date");
      }
    }

    await pool.end();
  } catch (err) {
    console.error("[Migration] Failed to apply admin credential migration:", err);
  }
}

(async () => {
  await applyAdminCredentialMigration();
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
