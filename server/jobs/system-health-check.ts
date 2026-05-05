import { db } from "../db";
import { sql, gte } from "drizzle-orm";
import { systemHealthChecks, stripeEvents, companies } from "@shared/schema";
import { sendEmail } from "../services/email";

type CheckStatus = "pass" | "warn" | "fail";
type CheckSeverity = "critical" | "high" | "medium" | "low";

interface CheckResult {
  checkName: string;
  status: CheckStatus;
  severity: CheckSeverity;
  message: string;
  lastRunAt: Date;
}

const ADMIN_EMAIL = "jeremy@scoopilot.com";

const SEVERITY_ORDER: Record<CheckSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export async function upsertHealthCheckResult(
  checkName: string,
  status: CheckStatus,
  severity: CheckSeverity,
  message: string
): Promise<void> {
  await db
    .insert(systemHealthChecks)
    .values({ checkName, status, severity, message, lastRunAt: new Date() })
    .onConflictDoUpdate({
      target: systemHealthChecks.checkName,
      set: { status, severity, message, lastRunAt: new Date() },
    });
}

async function checkDbConnectivity(): Promise<CheckResult> {
  const lastRunAt = new Date();
  try {
    await db.execute(sql`SELECT 1`);
    return {
      checkName: "db_connectivity",
      status: "pass",
      severity: "critical",
      message: "Database connection is healthy",
      lastRunAt,
    };
  } catch (err) {
    return {
      checkName: "db_connectivity",
      status: "fail",
      severity: "critical",
      message: `Database connection failed: ${err instanceof Error ? err.message : String(err)}`,
      lastRunAt,
    };
  }
}

function checkEnvVar(
  checkName: string,
  envVar: string,
  severity: CheckSeverity,
  label: string
): CheckResult {
  const lastRunAt = new Date();
  if (process.env[envVar]) {
    return { checkName, status: "pass", severity, message: `${label} is configured`, lastRunAt };
  }
  return {
    checkName,
    status: "fail",
    severity,
    message: `${label} (${envVar}) is not set`,
    lastRunAt,
  };
}

async function checkStripeRecentEvents(): Promise<CheckResult> {
  const lastRunAt = new Date();
  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const rows = await db
      .select({ id: stripeEvents.id })
      .from(stripeEvents)
      .where(gte(stripeEvents.processedAt, cutoff))
      .limit(1);
    if (rows.length > 0) {
      return {
        checkName: "stripe_recent_events",
        status: "pass",
        severity: "high",
        message: "Stripe webhook events received in the last 48 hours",
        lastRunAt,
      };
    }
    return {
      checkName: "stripe_recent_events",
      status: "warn",
      severity: "high",
      message: "No Stripe webhook events in the last 48 hours — verify webhook is registered",
      lastRunAt,
    };
  } catch (err) {
    return {
      checkName: "stripe_recent_events",
      status: "fail",
      severity: "high",
      message: `Could not query stripe_events: ${err instanceof Error ? err.message : String(err)}`,
      lastRunAt,
    };
  }
}

function checkStripeConfig(): CheckResult {
  const lastRunAt = new Date();
  const priceVars = [
    "STRIPE_PRICE_TIER_1",
    "STRIPE_PRICE_TIER_1_3",
    "STRIPE_PRICE_TIER_3_5",
    "STRIPE_PRICE_TIER_6_10",
    "STRIPE_PRICE_TIER_10_PLUS",
  ];
  const missing = priceVars.filter((v) => !process.env[v]);
  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      checkName: "stripe_config",
      status: "fail",
      severity: "critical",
      message: "STRIPE_SECRET_KEY is not set",
      lastRunAt,
    };
  }
  if (missing.length === priceVars.length) {
    return {
      checkName: "stripe_config",
      status: "fail",
      severity: "critical",
      message: "No Stripe price env vars are configured (STRIPE_PRICE_TIER_*)",
      lastRunAt,
    };
  }
  if (missing.length > 0) {
    return {
      checkName: "stripe_config",
      status: "warn",
      severity: "critical",
      message: `Some Stripe price vars missing: ${missing.join(", ")}`,
      lastRunAt,
    };
  }
  return {
    checkName: "stripe_config",
    status: "pass",
    severity: "critical",
    message: "Stripe secret key and all price env vars are configured",
    lastRunAt,
  };
}

async function checkNoStuckSubscriptions(): Promise<CheckResult> {
  const lastRunAt = new Date();
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(
        sql`${companies.subscriptionStatus} = 'active' AND ${companies.frozenAt} IS NOT NULL AND ${companies.frozenAt} < ${sevenDaysAgo}`
      )
      .limit(5);
    if (rows.length === 0) {
      return {
        checkName: "no_stuck_subscriptions",
        status: "pass",
        severity: "high",
        message: "No active accounts stuck in frozen state",
        lastRunAt,
      };
    }
    const names = rows.map((r) => r.name).join(", ");
    return {
      checkName: "no_stuck_subscriptions",
      status: "fail",
      severity: "high",
      message: `${rows.length} account(s) stuck frozen >7 days: ${names}`,
      lastRunAt,
    };
  } catch (err) {
    return {
      checkName: "no_stuck_subscriptions",
      status: "fail",
      severity: "high",
      message: `Could not query stuck subscriptions: ${err instanceof Error ? err.message : String(err)}`,
      lastRunAt,
    };
  }
}

async function getJobTrackingResult(
  checkName: string,
  severity: CheckSeverity,
  maxAgeMs: number,
  label: string
): Promise<CheckResult> {
  const now = new Date();
  try {
    const rows = await db
      .select()
      .from(systemHealthChecks)
      .where(sql`${systemHealthChecks.checkName} = ${checkName}`)
      .limit(1);
    if (rows.length === 0) {
      return {
        checkName,
        status: "warn",
        severity,
        message: `${label} has not reported yet since last restart`,
        lastRunAt: now,
      };
    }
    const row = rows[0];
    const jobLastRunAt = new Date(row.lastRunAt);
    const age = Date.now() - jobLastRunAt.getTime();
    if (row.status === "fail") {
      return { checkName, status: "fail", severity, message: row.message, lastRunAt: jobLastRunAt };
    }
    if (age > maxAgeMs) {
      const hours = Math.round(age / 3600000);
      return {
        checkName,
        status: "warn",
        severity,
        message: `${label} last ran ${hours}h ago (expected every ${Math.round(maxAgeMs / 3600000)}h)`,
        lastRunAt: jobLastRunAt,
      };
    }
    return { checkName, status: "pass", severity, message: row.message, lastRunAt: jobLastRunAt };
  } catch (err) {
    return {
      checkName,
      status: "warn",
      severity,
      message: `Could not read job status for ${label}: ${err instanceof Error ? err.message : String(err)}`,
      lastRunAt: now,
    };
  }
}

const STATUS_ORDER: Record<CheckStatus, number> = { fail: 0, warn: 1, pass: 2 };

function sortChecks(results: CheckResult[]): CheckResult[] {
  return [...results].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.checkName.localeCompare(b.checkName)
  );
}

function formatLastRunAt(d: Date): string {
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function buildEmailHtml(results: CheckResult[], issueCount: number): string {
  const sorted = sortChecks(results);

  const statusColor: Record<CheckStatus, string> = {
    pass: "#16a34a",
    warn: "#d97706",
    fail: "#dc2626",
  };
  const severityColor: Record<CheckSeverity, string> = {
    critical: "#dc2626",
    high: "#ea580c",
    medium: "#d97706",
    low: "#6b7280",
  };

  const rows = sorted
    .map(
      (r) => `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px 12px; font-size: 13px; font-family: monospace;">${r.checkName}</td>
      <td style="padding: 8px 12px; text-align: center;">
        <span style="background:${statusColor[r.status]}; color:#fff; padding:2px 8px; border-radius:4px; font-size:12px; font-weight:600;">${r.status.toUpperCase()}</span>
      </td>
      <td style="padding: 8px 12px; text-align: center;">
        <span style="color:${severityColor[r.severity]}; font-size:12px; font-weight:600; text-transform:uppercase;">${r.severity}</span>
      </td>
      <td style="padding: 8px 12px; font-size: 13px; color: #374151;">${r.message}</td>
      <td style="padding: 8px 12px; font-size: 11px; color: #9ca3af; white-space: nowrap;">${formatLastRunAt(r.lastRunAt)}</td>
    </tr>`
    )
    .join("");

  const headerBg = issueCount === 0 ? "#16a34a" : "#dc2626";
  const headline =
    issueCount === 0
      ? "All systems are operating normally."
      : `${issueCount} issue${issueCount !== 1 ? "s" : ""} require attention.`;

  return `
    <div style="font-family: Arial, sans-serif; max-width: 750px; margin: 0 auto; background: #f9fafb;">
      <div style="background:${headerBg}; padding:20px 24px; border-radius:8px 8px 0 0;">
        <h1 style="color:#fff; margin:0; font-size:20px;">ScooPilot System Health</h1>
        <p style="color:#fff; margin:6px 0 0; font-size:14px; opacity:0.9;">${new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" })} ET</p>
      </div>
      <div style="background:#fff; padding:20px 24px; border:1px solid #e5e7eb; border-top:none; border-radius:0 0 8px 8px;">
        <p style="margin:0 0 16px; color:#374151;">${headline}</p>
        <table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb; border-radius:6px; overflow:hidden;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="padding:8px 12px; text-align:left; font-size:12px; color:#6b7280; font-weight:600; text-transform:uppercase;">Check</th>
              <th style="padding:8px 12px; font-size:12px; color:#6b7280; font-weight:600; text-transform:uppercase;">Status</th>
              <th style="padding:8px 12px; font-size:12px; color:#6b7280; font-weight:600; text-transform:uppercase;">Severity</th>
              <th style="padding:8px 12px; text-align:left; font-size:12px; color:#6b7280; font-weight:600; text-transform:uppercase;">Message</th>
              <th style="padding:8px 12px; text-align:left; font-size:12px; color:#6b7280; font-weight:600; text-transform:uppercase;">Last Run</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin:16px 0 0; font-size:12px; color:#9ca3af;">
          View full details in the <a href="https://app.scoopilot.com/admin" style="color:#2d8a5e;">admin dashboard</a>.
        </p>
      </div>
    </div>`;
}

function buildEmailText(results: CheckResult[], issueCount: number): string {
  const sorted = sortChecks(results);
  const lines = sorted.map(
    (r) =>
      `[${r.status.toUpperCase()}] [${r.severity.toUpperCase()}] ${r.checkName}: ${r.message} (last run: ${formatLastRunAt(r.lastRunAt)})`
  );
  const headline =
    issueCount === 0
      ? "All systems are operating normally."
      : `${issueCount} issue(s) require attention.`;
  return `ScooPilot System Health — ${new Date().toISOString()}\n\n${headline}\n\n${lines.join("\n")}\n\nView details: https://app.scoopilot.com/admin`;
}

export async function runSystemHealthCheck(): Promise<void> {
  console.log("[SystemHealth] Starting daily system health check");

  const checks: CheckResult[] = await Promise.all([
    checkDbConnectivity(),
    Promise.resolve(
      checkEnvVar(
        "stripe_webhook_secret",
        "STRIPE_WEBHOOK_SECRET",
        "critical",
        "Stripe webhook secret"
      )
    ),
    Promise.resolve(
      checkEnvVar(
        "stripe_connect_webhook_secret",
        "STRIPE_CONNECT_WEBHOOK_SECRET",
        "high",
        "Stripe Connect webhook secret"
      )
    ),
    checkStripeRecentEvents(),
    Promise.resolve(checkStripeConfig()),
    Promise.resolve(checkEnvVar("telnyx_configured", "TELNYX_API_KEY", "high", "Telnyx API key")),
    Promise.resolve(checkEnvVar("openai_configured", "OPENAI_API_KEY", "medium", "OpenAI API key")),
    checkNoStuckSubscriptions(),
    getJobTrackingResult("job_nightly_rollup", "medium", 26 * 60 * 60 * 1000, "Nightly rollup"),
    getJobTrackingResult("job_auto_invoice", "high", 26 * 60 * 60 * 1000, "Auto invoice"),
    getJobTrackingResult("job_stop_order_repair", "low", 26 * 60 * 60 * 1000, "Stop order repair"),
    getJobTrackingResult("job_reminders", "medium", 15 * 60 * 1000, "Reminders"),
  ]);

  for (const check of checks) {
    if (check.checkName.startsWith("job_")) continue;
    await upsertHealthCheckResult(check.checkName, check.status, check.severity, check.message);
  }

  const issueCount = checks.filter((c) => c.status !== "pass").length;
  const allOk = issueCount === 0;
  const subject = allOk
    ? "✅ ScooPilot System Health: All OK"
    : `⚠️ ScooPilot System Health: ${issueCount} issue${issueCount !== 1 ? "s" : ""} found`;

  await sendEmail({
    to: ADMIN_EMAIL,
    subject,
    text: buildEmailText(checks, issueCount),
    html: buildEmailHtml(checks, issueCount),
    bypassClientSuppression: true,
  }).catch((err) =>
    console.error("[SystemHealth] Failed to send digest email:", err?.message ?? err)
  );

  console.log(
    `[SystemHealth] Completed — ${checks.length} checks, ${issueCount} issues. Digest sent to ${ADMIN_EMAIL}.`
  );
}
