/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Express, Request, Response } from "express";
import { maskEmail } from "../utils/pii";
import { storage } from "../storage";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { users, companies } from "@shared/schema";
import {
  registerUser,
  loginUser,
  getUserById,
  createPasswordResetToken,
  resetPasswordWithToken,
  changePassword,
  claimOnboardingEmailSend,
  resetOnboardingEmailSent,
} from "../services/app-auth";
import {
  sendEmail,
  sendAdminSignupNotification,
  buildWelcomeEmailContent,
} from "../services/email";
import { checkIpRisk, getClientIp, getCountryCode } from "../services/ip-risk";

import { isAuthenticated, handleError, ensureCompanySetup } from "./shared";

export async function registerAuthRoutes(app: Express): Promise<void> {
  // ================ Auth Routes ================

  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, firstName, lastName, companyName } = req.body;

      const clientIp = getClientIp(req as any);
      const cfCountry = (req.headers["cf-ipcountry"] as string | undefined)?.trim().toUpperCase();
      const [ipRisk, countryCode] = await Promise.all([
        checkIpRisk(clientIp),
        getCountryCode(clientIp, cfCountry),
      ]);

      if (ipRisk.isVpn || ipRisk.isProxy) {
        console.warn(
          `[Signup] Blocked VPN/proxy signup from ${clientIp} (type: ${ipRisk.isVpn ? "VPN" : "proxy"}, country: ${countryCode ?? "unknown"}, email: ${email})`
        );
        return res.status(403).json({
          error:
            "Signups from VPN or proxy connections are not allowed. Please disable your VPN and try again.",
        });
      }

      const detectedCountry = countryCode ?? ipRisk.countryCode;
      const blockedCountries = (process.env.BLOCKED_SIGNUP_COUNTRIES || "")
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);
      if (detectedCountry && blockedCountries.includes(detectedCountry)) {
        console.warn(
          `[Signup] Blocked signup from country ${detectedCountry}, IP ${clientIp}, email: ${email}`
        );
        return res.status(403).json({ error: "Signups are not available in your region." });
      }

      const result = await registerUser(email, password, firstName || "", lastName || "");
      if ("error" in result) {
        return res.status(400).json({ error: result.error });
      }
      (req.session as any).userId = result.user.id;
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });
      const { passwordHash: _passwordHash, ...safeUser } = result.user;

      let setupDone = false;
      let companyInfo: { companyId: string; alreadySetup: boolean } | null = null;
      try {
        companyInfo = await ensureCompanySetup(result.user.id, companyName);
        setupDone = true;
      } catch (err) {
        console.error("Setup during register failed:", err);
      }

      const displayName = [firstName, lastName].filter(Boolean).join(" ") || "there";
      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host || "localhost:5000";
      const appUrl = `${protocol}://${host}`;
      const resolvedCompanyName = companyName?.trim() || `${displayName}'s Company`;

      claimOnboardingEmailSend(result.user.id)
        .then(async (claimed) => {
          if (!claimed) {
            console.log(
              `[Register] Onboarding email already sent for ${maskEmail(email)}, skipping.`
            );
            return;
          }
          try {
            const _selfSignupWelcome = buildWelcomeEmailContent({
              firstName: displayName,
              companyName: resolvedCompanyName,
              appUrl,
            });
            await sendEmail({
              to: email,
              subject: _selfSignupWelcome.subject,
              text: _selfSignupWelcome.text,
              html: _selfSignupWelcome.html,
            });
            console.log(`[Register] Welcome email sent to ${maskEmail(email)}`);
          } catch (emailErr) {
            console.error(
              `[Register] Failed to send welcome email to ${maskEmail(email)}, resetting flag:`,
              emailErr
            );
            await resetOnboardingEmailSent(result.user.id).catch(() => {});
          }
        })
        .catch((err) => console.error("Failed to claim/send welcome email:", err));

      if (companyInfo && !companyInfo.alreadySetup) {
        sendAdminSignupNotification({
          companyName: resolvedCompanyName,
          ownerEmail: email,
          ownerName: displayName,
          tier: "free_trial",
          source: "Direct Registration",
        }).catch((err) =>
          console.error("[Signup Notification] Failed during direct registration:", err)
        );
      }

      return res.json({ ...safeUser, setupDone, sessionToken: req.sessionID });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      const result = await loginUser(email, password);
      if ("error" in result) {
        return res.status(401).json({ error: result.error });
      }
      (req.session as any).userId = result.user.id;
      await db
        .update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, result.user.id))
        .execute();
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });
      const { passwordHash: _passwordHash, ...safeUser } = result.user;

      let setupDone = false;
      try {
        await ensureCompanySetup(result.user.id);
        setupDone = true;
      } catch (err) {
        console.error("Setup during login failed:", err);
      }

      console.log(
        `[auth] login success | user=${result.user.id} sid=${req.sessionID.substring(0, 8)}... ua=${(req.headers["user-agent"] || "").substring(0, 80)}`
      );
      return res.json({ ...safeUser, setupDone, sessionToken: req.sessionID });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/auth/user", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any).userId;
      const user = await getUserById(userId);
      if (!user) return res.status(401).json({ message: "User not found" });
      const { passwordHash: _passwordHash, ...safeUser } = user;
      const memberships = await storage.getCompaniesForUser(userId);
      const role = memberships.length > 0 ? memberships[0].role : "tech";
      const companyId = memberships.length > 0 ? memberships[0].companyId : null;
      return res.json({ ...safeUser, role, companyId });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: "Logout failed" });
      res.clearCookie("connect.sid");
      return res.json({ ok: true });
    });
  });

  app.post(
    "/api/auth/submit-verification-url",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = (req.session as any).userId;
        const { url } = req.body;
        if (!url || typeof url !== "string") {
          return res.status(400).json({ error: "URL is required" });
        }
        const trimmed = url.trim();
        try {
          const parsed = new URL(trimmed);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return res.status(400).json({ error: "URL must use http or https" });
          }
        } catch {
          return res.status(400).json({ error: "Invalid URL format" });
        }
        const memberships = await storage.getCompaniesForUser(userId);
        if (!memberships.length) return res.status(404).json({ error: "No company found" });
        const companyId = memberships[0].companyId;
        const company = await storage.getCompany(companyId);
        if (!company || company.subscriptionStatus !== "pending_approval") {
          return res.status(403).json({
            error: "Verification URL can only be submitted while account is pending approval",
          });
        }
        await db
          .update(companies)
          .set({ verificationUrl: trimmed })
          .where(eq(companies.id, companyId));
        res.json({ ok: true });
      } catch (err) {
        handleError(res, err);
      }
    }
  );

  app.get("/api/tours/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any).userId;
      const user = await getUserById(userId);
      if (!user) return res.status(401).json({ error: "Not found" });
      return res.json({ completions: user.tourCompletions || {} });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/tours/complete", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any).userId;
      const { tourId, version } = req.body;
      if (!tourId || typeof tourId !== "string")
        return res.status(400).json({ error: "tourId is required" });
      const user = await getUserById(userId);
      if (!user) return res.status(401).json({ error: "Not found" });
      const completions = (user.tourCompletions as Record<string, string>) || {};
      completions[tourId] = new Date().toISOString();
      if (version && typeof version === "string") {
        completions[`${tourId}_version`] = version;
      }
      await db.update(users).set({ tourCompletions: completions }).where(eq(users.id, userId));
      return res.json({ ok: true, completions });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/tutorials/progress", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any).userId;
      const user = await getUserById(userId);
      if (!user) return res.status(401).json({ error: "Not found" });
      const completions = (user.tourCompletions as Record<string, any>) || {};
      const progress: Record<string, { currentStep: number; completed: boolean; version: string }> =
        {};
      for (const key of Object.keys(completions)) {
        if (key.endsWith("_progress")) {
          const tutorialId = key.replace("_progress", "");
          const stored = completions[key];
          if (stored && typeof stored === "object") {
            progress[tutorialId] = stored;
          }
        }
      }
      return res.json({ progress });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/tutorials/progress", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any).userId;
      const { tutorialId, currentStep, completed, version } = req.body;
      if (!tutorialId || typeof tutorialId !== "string")
        return res.status(400).json({ error: "tutorialId required" });
      if (typeof currentStep !== "number")
        return res.status(400).json({ error: "currentStep required" });
      const user = await getUserById(userId);
      if (!user) return res.status(401).json({ error: "Not found" });
      const completions = (user.tourCompletions as Record<string, any>) || {};
      const progressKey = `${tutorialId}_progress`;
      completions[progressKey] = {
        currentStep,
        completed: !!completed,
        version: version || "1.0",
      };
      if (completed) {
        completions[tutorialId] = new Date().toISOString();
        if (version) completions[`${tutorialId}_version`] = version;
      }
      await db.update(users).set({ tourCompletions: completions }).where(eq(users.id, userId));
      return res.json({ ok: true, progress: completions[progressKey] });
    } catch (err) {
      handleError(res, err);
    }
  });

  const resetRateLimits = new Map<string, { count: number; resetAt: number }>();
  function checkResetRateLimit(key: string, maxAttempts: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = resetRateLimits.get(key);
    if (!entry || now > entry.resetAt) {
      resetRateLimits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= maxAttempts) return false;
    entry.count++;
    return true;
  }

  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "Email is required" });

      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const isProd = process.env.NODE_ENV === "production";
      if (
        !checkResetRateLimit(`forgot:${ip}`, isProd ? 5 : 500, 15 * 60 * 1000) ||
        !checkResetRateLimit(`forgot:${email.toLowerCase()}`, isProd ? 3 : 500, 15 * 60 * 1000)
      ) {
        return res.json({
          message: "If an account exists with that email, a password reset link has been sent.",
        });
      }

      const result = await createPasswordResetToken(email);
      if ("error" in result) {
        return res.status(400).json({ error: result.error });
      }

      if (result.token !== "noop") {
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = req.headers.host || "localhost:5000";
        const resetUrl = `${protocol}://${host}/reset-password?token=${result.token}`;

        const emailResult = await sendEmail({
          to: email,
          subject: "Reset your ScooPilot password",
          text: `You requested a password reset. Click the link below to set a new password:\n\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can safely ignore this email.`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">ScooPilot</h1>
              </div>
              <div style="padding: 20px; border: 1px solid #e5e7eb;">
                <h2 style="margin-top: 0;">Password Reset</h2>
                <p>You requested a password reset. Click the button below to set a new password:</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${resetUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
                </div>
                <p style="color: #6b7280; font-size: 14px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
                <p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">If the button doesn't work, copy and paste this link into your browser:<br/>${resetUrl}</p>
              </div>
            </div>
          `,
        });
        if (!emailResult.success) {
          console.error("[Password Reset] Failed to send email:", emailResult.error);
        } else {
          console.log("[Password Reset] Email sent successfully to:", maskEmail(email));
        }
      }

      return res.json({
        message: "If an account exists with that email, a password reset link has been sent.",
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body;
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (
        !checkResetRateLimit(
          `reset:${ip}`,
          process.env.NODE_ENV === "production" ? 10 : 500,
          15 * 60 * 1000
        )
      ) {
        return res.status(429).json({ error: "Too many attempts. Please try again later." });
      }
      const result = await resetPasswordWithToken(token, password);
      if ("error" in result) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ message: "Password has been reset successfully. You can now sign in." });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/auth/change-password", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { newPassword } = req.body;
      if (!newPassword) return res.status(400).json({ error: "New password is required" });
      const result = await changePassword(userId, newPassword);
      if ("error" in result) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ message: "Password changed successfully" });
    } catch (err) {
      handleError(res, err);
    }
  });
}
