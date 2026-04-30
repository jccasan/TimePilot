import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { sendEmail } from "../services/email";

import { isAdmin, handleError, p, escapeHtml } from "./shared";

export async function registerErrorReportingRoutes(app: Express): Promise<void> {
  // ================ Error Reporting ================

  const errorReportRateLimiter = new Map<string, { count: number; resetAt: number }>();
  const ERROR_REPORT_WINDOW_MS = 60_000;
  const ERROR_REPORT_MAX_PER_WINDOW = 20;

  function checkErrorReportRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = errorReportRateLimiter.get(ip);
    if (!entry || now >= entry.resetAt) {
      errorReportRateLimiter.set(ip, { count: 1, resetAt: now + ERROR_REPORT_WINDOW_MS });
      return true;
    }
    if (entry.count >= ERROR_REPORT_MAX_PER_WINDOW) return false;
    entry.count++;
    return true;
  }

  const ERROR_ALERT_EMAIL = process.env.ERROR_ALERT_EMAIL || "jeremy@scoopilot.com";
  const ERROR_EMAIL_DEBOUNCE_MS = 15 * 60 * 1000;
  const recentErrorEmails = new Map<string, number>();

  type ErrorSeverity = "low" | "medium" | "high" | "critical";

  function classifyErrorSeverity(
    message: string,
    errorType: "react" | "js" | "api"
  ): ErrorSeverity {
    const msg = message.toLowerCase();

    // Critical: app-breaking crashes or security/payment related
    if (errorType === "react") return "critical";
    if (msg.includes("chunkloaderror") || msg.includes("loading chunk")) return "critical";
    if (msg.includes("payment") || msg.includes("stripe") || msg.includes("billing"))
      return "critical";
    if (msg.includes("unauthorized") || msg.includes("403") || msg.includes("401")) return "high";

    // High: data loss risk or persistent functional failures
    if (errorType === "api" && (msg.includes("500") || msg.includes("internal server")))
      return "high";
    if (msg.includes("cannot read properties") || msg.includes("is not a function")) return "high";
    if (msg.includes("typeerror") || msg.includes("referenceerror")) return "high";
    if (msg.includes("failed to fetch") || msg.includes("networkerror")) return "high";

    // Low: known environmental / browser capability issues
    if (msg.includes("webgl") || msg.includes("webgl2")) return "low";
    if (msg.includes("resizeobserver") || msg.includes("intersectionobserver")) return "low";
    if (msg.includes("script error") && !msg.includes("stack")) return "low";
    if (msg.includes("non-error promise rejection")) return "low";

    // Default
    return "medium";
  }

  function shouldSendErrorEmail(message: string, severity: ErrorSeverity): boolean {
    if (severity !== "high" && severity !== "critical") return false;
    const key = message.slice(0, 200);
    const now = Date.now();
    const lastSent = recentErrorEmails.get(key);
    if (lastSent && now - lastSent < ERROR_EMAIL_DEBOUNCE_MS) return false;
    recentErrorEmails.set(key, now);
    return true;
  }

  const SEVERITY_COLORS: Record<ErrorSeverity, string> = {
    critical: "#ff4444",
    high: "#ff8c00",
    medium: "#ffd700",
    low: "#858585",
  };

  app.post("/api/errors/report", async (req: Request, res: Response) => {
    try {
      const ip =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.socket.remoteAddress ||
        "unknown";
      if (!checkErrorReportRateLimit(ip)) {
        return res.status(429).json({ error: "Too many error reports" });
      }
      const { message, stack, errorType, pageUrl, userId, companyId, userAgent } = req.body;
      if (!message || typeof message !== "string")
        return res.status(400).json({ error: "message required" });
      const safeType: "react" | "js" | "api" =
        errorType === "react" || errorType === "js" || errorType === "api" ? errorType : "js";
      const severity = classifyErrorSeverity(message, safeType);

      const report = await storage.createErrorReport({
        message: message.slice(0, 4000),
        stack: stack ? String(stack).slice(0, 10000) : null,
        errorType: safeType,
        pageUrl: pageUrl ? String(pageUrl).slice(0, 2000) : null,
        userId: userId ? String(userId).slice(0, 255) : null,
        companyId: companyId ? String(companyId).slice(0, 255) : null,
        userAgent: userAgent ? String(userAgent).slice(0, 500) : null,
        status: "open",
        severity,
      });

      if (shouldSendErrorEmail(message, severity)) {
        sendEmail({
          to: ERROR_ALERT_EMAIL,
          subject: `[ScooPilot ${severity.toUpperCase()}] ${safeType.toUpperCase()}: ${message.slice(0, 80)}`,
          text: `Error Report #${report.id}\n\nSeverity: ${severity.toUpperCase()}\nType: ${safeType}\nPage: ${pageUrl || "unknown"}\nUser: ${userId || "anonymous"}\nCompany: ${companyId || "unknown"}\nTime: ${new Date().toISOString()}\n\nMessage:\n${message}\n\nStack:\n${stack || "(none)"}`,
          html: `<div style="font-family:monospace;max-width:700px;margin:0 auto;">
          <div style="background:#1e1e1e;color:#f8f8f2;padding:16px 20px;border-radius:6px 6px 0 0;border-top:3px solid ${SEVERITY_COLORS[severity]};">
            <h2 style="margin:0;font-size:16px;color:#ff6b6b;">⚠ ScooPilot Error Report</h2>
          </div>
          <div style="background:#252526;color:#d4d4d4;padding:20px;border-radius:0 0 6px 6px;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px;">
              <tr><td style="padding:4px 12px 4px 0;color:#858585;">ID</td><td>${escapeHtml(report.id)}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#858585;">Severity</td><td><span style="background:${SEVERITY_COLORS[severity]}33;color:${SEVERITY_COLORS[severity]};border:1px solid ${SEVERITY_COLORS[severity]}55;padding:2px 8px;border-radius:3px;font-weight:600;">${severity.toUpperCase()}</span></td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#858585;">Type</td><td><span style="background:#264f78;color:#9cdcfe;padding:2px 8px;border-radius:3px;">${escapeHtml(safeType)}</span></td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#858585;">Page</td><td>${escapeHtml(pageUrl || "unknown")}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#858585;">User</td><td>${escapeHtml(userId || "anonymous")}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#858585;">Company</td><td>${escapeHtml(companyId || "unknown")}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#858585;">Time</td><td>${new Date().toISOString()}</td></tr>
            </table>
            <div style="margin-bottom:12px;">
              <div style="color:#858585;font-size:11px;margin-bottom:4px;">MESSAGE</div>
              <div style="background:#1e1e1e;padding:10px;border-radius:4px;color:#f44747;font-size:13px;">${escapeHtml(message)}</div>
            </div>
            ${
              stack
                ? `<div>
              <div style="color:#858585;font-size:11px;margin-bottom:4px;">STACK TRACE</div>
              <pre style="background:#1e1e1e;padding:10px;border-radius:4px;color:#ce9178;font-size:12px;overflow-x:auto;white-space:pre-wrap;">${escapeHtml(stack.slice(0, 3000))}</pre>
            </div>`
                : ""
            }
            <div style="margin-top:16px;">
              <a href="https://app.scoopilot.com/admin/errors" style="background:#0e639c;color:white;padding:8px 16px;border-radius:4px;text-decoration:none;font-size:13px;">View in Admin Terminal →</a>
            </div>
          </div>
        </div>`,
        }).catch(console.error);
      }

      res.json({ ok: true, id: report.id });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/admin/error-reports", isAdmin, async (req: Request, res: Response) => {
    try {
      const { status, limit, offset, fromDate, toDate, message } = req.query;
      const reports = await storage.listErrorReports({
        status: status as string | undefined,
        message: message ? String(message) : undefined,
        fromDate: fromDate ? new Date(String(fromDate)) : undefined,
        toDate: toDate ? new Date(String(toDate)) : undefined,
        limit: limit ? parseInt(String(limit)) : 50,
        offset: offset ? parseInt(String(offset)) : 0,
      });
      const fixTasks = await Promise.all(reports.map((r) => storage.getErrorFixTask(r.id)));
      const result = reports.map((r, i) => ({ ...r, fixTask: fixTasks[i] || null }));
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/admin/error-reports/grouped", isAdmin, async (req: Request, res: Response) => {
    try {
      const { status, severity, limit, offset, fromDate, toDate } = req.query;
      const groups = await storage.listGroupedErrorReports({
        status: status as string | undefined,
        severity: severity as string | undefined,
        fromDate: fromDate ? new Date(String(fromDate)) : undefined,
        toDate: toDate ? new Date(String(toDate)) : undefined,
        limit: limit ? parseInt(String(limit)) : 50,
        offset: offset ? parseInt(String(offset)) : 0,
      });
      res.json(groups);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/admin/error-reports/stats", isAdmin, async (_req: Request, res: Response) => {
    try {
      const [openCount, latestTs] = await Promise.all([
        storage.getOpenErrorCount(),
        storage.getLatestErrorTimestamp(),
      ]);
      res.json({ openCount, latestTimestamp: latestTs });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/admin/error-reports/bulk-status", isAdmin, async (req: Request, res: Response) => {
    try {
      const { message, status } = req.body;
      const validStatuses = ["open", "acknowledged", "resolved"];
      if (!message || typeof message !== "string")
        return res.status(400).json({ error: "message is required" });
      if (!status || !validStatuses.includes(status))
        return res.status(400).json({ error: "Invalid status" });
      const updated = await storage.bulkUpdateErrorReportStatus(
        message,
        status as "open" | "acknowledged" | "resolved"
      );
      res.json({ updated });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/admin/error-reports/:id", isAdmin, async (req: Request, res: Response) => {
    try {
      const report = await storage.getErrorReport(p(req.params.id));
      if (!report) return res.status(404).json({ error: "Not found" });
      const fixTask = await storage.getErrorFixTask(report.id);
      res.json({ ...report, fixTask: fixTask || null });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch("/api/admin/error-reports/:id", isAdmin, async (req: Request, res: Response) => {
    try {
      const { status } = req.body;
      const validStatuses = ["open", "acknowledged", "resolved"];
      if (!status || !validStatuses.includes(status))
        return res.status(400).json({ error: "Invalid status" });
      const report = await storage.updateErrorReport(p(req.params.id), { status });
      if (status === "resolved") {
        const fixTask = await storage.getErrorFixTask(p(req.params.id));
        if (fixTask && fixTask.status === "open") {
          await storage.updateErrorFixTask(fixTask.id, { status: "done" });
        }
      }
      res.json(report);
    } catch (err) {
      handleError(res, err);
    }
  });

  app.patch(
    "/api/admin/error-reports/:id/fix-task",
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        const { status } = req.body;
        const validStatuses = ["open", "done"];
        if (!status || !validStatuses.includes(status))
          return res.status(400).json({ error: "Invalid status" });
        const report = await storage.getErrorReport(p(req.params.id));
        if (!report) return res.status(404).json({ error: "Not found" });
        const fixTask = await storage.getErrorFixTask(report.id);
        if (!fixTask) return res.status(404).json({ error: "Fix task not found" });
        const updated = await storage.updateErrorFixTask(fixTask.id, { status });
        res.json(updated);
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.post(
    "/api/admin/error-reports/:id/fix-task",
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        const report = await storage.getErrorReport(p(req.params.id));
        if (!report) return res.status(404).json({ error: "Not found" });
        const existing = await storage.getErrorFixTask(report.id);
        if (existing)
          return res.status(409).json({ error: "Fix task already exists", fixTask: existing });
        const title = req.body.title || `Fix: ${report.message.slice(0, 80)}`;
        const fixTask = await storage.createErrorFixTask({ errorReportId: report.id, title });
        await storage.updateErrorReport(report.id, { status: "acknowledged" });
        res.json(fixTask);
      } catch (err) {
        handleError(res, err);
      }
    }
  );
}
