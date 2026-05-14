import type { Express, Request, Response } from "express";
import { maskEmail } from "../utils/pii";
import crypto from "crypto";
import { storage } from "../storage";
import { db } from "../db";
import { sql, eq, and } from "drizzle-orm";
import { companies, contacts, quoteFormEvents, servicePlans } from "@shared/schema";
import { calculatePrice, type PriceCalculatorInputs } from "../services/pricing-calculator";
import { z } from "zod";
import {
  getUserByEmail,
  createUserWithTempPassword,
  claimOnboardingEmailSend,
  resetOnboardingEmailSent,
} from "../services/app-auth";
import { sendEmail, sendAdminSignupNotification, logEmailSent } from "../services/email";
import { sendSmsForCompany, isSmsConfiguredForCompany } from "../services/sms";
import {
  isStripeConfigured,
  createCheckoutSession,
  ensureConnectedCustomer,
  createSetupIntent,
  retrieveSetupIntent,
  getCustomerPaymentMethods,
} from "../services/stripe";
import { checkIpRisk, getClientIp, getCountryCode } from "../services/ip-risk";
import { calculateQuotePricing, type ResidentialQuoteInput } from "../services/quote-pricing";

import {
  isAuthenticated,
  getCompanyContext,
  getBaseUrl,
  handleError,
  p,
  notify,
  createPropertyWithGeocode,
  escapeHtml,
  seedDefaultLeadSources,
} from "./shared";
import { dispatchWebhooksForEvent } from "../services/webhook-dispatcher";

export async function registerPublicRoutes(app: Express): Promise<void> {
  // ================ Public Signup Routes (no auth required) ================
  const signupLimiter = (await import("express-rate-limit")).default({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === "production" ? 5 : 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error:
        "Too many signup attempts, please try again in 15 minutes. If you need immediate help, contact us at support@scoopilot.com.",
    },
  });

  app.post("/api/public/signup", signupLimiter, async (req: Request, res: Response) => {
    try {
      const { email, firstName, lastName, companyName } = req.body;
      if (!email || !firstName || !companyName) {
        return res.status(400).json({ error: "Email, first name, and company name are required" });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Invalid email address" });
      }
      if (typeof companyName !== "string" || companyName.trim().length < 2) {
        return res.status(400).json({ error: "Company name must be at least 2 characters" });
      }

      const clientIp = getClientIp(req);
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
            "Signups from VPN or proxy connections are not allowed. Please disable your VPN and try again. If you believe this is an error, contact us at support@scoopilot.com.",
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
        return res.status(403).json({
          error:
            "Signups are not available in your region. If you believe this is an error, contact us at support@scoopilot.com.",
        });
      }

      const existingUser = await getUserByEmail(email.toLowerCase());
      if (existingUser) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }

      const { emailVerificationTokens } = await import("@shared/models/auth");
      const { eq, and, gt } = await import("drizzle-orm");
      const pending = await db
        .select()
        .from(emailVerificationTokens)
        .where(
          and(
            eq(emailVerificationTokens.email, email.toLowerCase()),
            eq(emailVerificationTokens.used, false),
            gt(emailVerificationTokens.expiresAt, new Date())
          )
        );
      if (pending.length > 0) {
        return res.json({
          success: true,
          message: "A verification email was already sent. Please check your inbox.",
        });
      }

      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await db.insert(emailVerificationTokens).values({
        email: email.toLowerCase(),
        firstName: firstName.trim(),
        lastName: lastName?.trim() || null,
        companyName: companyName.trim(),
        tokenHash,
        expiresAt,
      });

      const host = req.headers.host || "localhost:5000";
      const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");
      const verifyUrl = `${isLocalhost ? "http" : "https"}://${host}/api/public/verify-email?token=${token}`;

      try {
        await sendEmail({
          to: email,
          subject: "Verify your email to start your ScooPilot free trial",
          text: `Hi ${firstName},\n\nThanks for signing up for ScooPilot! Please verify your email to activate your free trial:\n\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't sign up for ScooPilot, you can safely ignore this email.`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">ScooPilot</h1>
              </div>
              <div style="padding: 20px; border: 1px solid #e5e7eb;">
                <h2 style="margin-top: 0;">Verify Your Email</h2>
                <p>Hi ${firstName},</p>
                <p>Thanks for signing up for ScooPilot! Click the button below to verify your email and activate your free trial.</p>
                <div style="text-align: center; margin: 24px 0;">
                  <a href="${verifyUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Verify Email</a>
                </div>
                <p style="color: #6b7280; font-size: 14px;">This link expires in 24 hours. If you didn't sign up for ScooPilot, you can safely ignore this email.</p>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error("[Signup] Failed to send verification email:", emailErr);
        return res
          .status(500)
          .json({ error: "Failed to send verification email. Please try again." });
      }

      res.json({ success: true, message: "Verification email sent. Please check your inbox." });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/public/verify-email", async (req: Request, res: Response) => {
    try {
      const { token } = req.query;
      if (!token || typeof token !== "string") {
        return res.send(verificationResultPage(false, "Missing verification token."));
      }

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const { emailVerificationTokens } = await import("@shared/models/auth");
      const { eq, and, gt } = await import("drizzle-orm");

      const [record] = await db
        .select()
        .from(emailVerificationTokens)
        .where(
          and(
            eq(emailVerificationTokens.tokenHash, tokenHash),
            eq(emailVerificationTokens.used, false),
            gt(emailVerificationTokens.expiresAt, new Date())
          )
        );

      if (!record) {
        return res.send(
          verificationResultPage(
            false,
            "This verification link is invalid or has expired. Please sign up again."
          )
        );
      }

      const existingUser = await getUserByEmail(record.email);
      if (existingUser) {
        await db
          .update(emailVerificationTokens)
          .set({ used: true })
          .where(eq(emailVerificationTokens.id, record.id));
        return res.send(
          verificationResultPage(
            false,
            "An account with this email already exists. Please log in instead."
          )
        );
      }

      const tempPassword = crypto.randomBytes(6).toString("base64url");

      // --- GeoIP + VPN detection ---
      const verifyClientIp = getClientIp(req);
      const verifyCfCountry = (req.headers["cf-ipcountry"] as string | undefined)
        ?.trim()
        .toUpperCase();
      let verifyIpRisk: Awaited<ReturnType<typeof checkIpRisk>> = {
        ip: verifyClientIp,
        isVpn: false,
        isProxy: false,
        skipped: true,
      };
      let verifyCountryCode: string | null = null;
      try {
        [verifyIpRisk, verifyCountryCode] = await Promise.all([
          checkIpRisk(verifyClientIp),
          getCountryCode(verifyClientIp, verifyCfCountry),
        ]);
      } catch {
        /* fail open */
      }

      if (verifyIpRisk.isVpn || verifyIpRisk.isProxy) {
        console.warn(
          `[Signup] Blocked VPN/proxy email verify from ${verifyClientIp} (country: ${verifyCountryCode ?? "unknown"}, email: ${record.email})`
        );
        return res.redirect(`/signup?error=vpn`);
      }

      const blockedCountriesVerify = (process.env.BLOCKED_SIGNUP_COUNTRIES || "")
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);
      const detectedCountryVerify = verifyCountryCode ?? verifyIpRisk.countryCode;
      if (detectedCountryVerify && blockedCountriesVerify.includes(detectedCountryVerify)) {
        console.warn(
          `[Signup] Blocked email verify from country ${detectedCountryVerify}, IP ${verifyClientIp}, email: ${record.email}`
        );
        return res.redirect(`/signup?error=region`);
      }

      const signupCountry = detectedCountryVerify ?? "US";
      const isDomestic = signupCountry === "US" || signupCountry === "CA";
      const newStatus = isDomestic ? "trialing" : "pending_approval";

      const { user: verifiedUser, company } = await db.transaction(async (tx) => {
        const txUser = await createUserWithTempPassword(
          record.email,
          record.firstName,
          record.lastName || "",
          tempPassword
        );

        const baseSlug =
          (record.companyName || "company")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "company";
        let slug = baseSlug;
        let slugSuffix = 1;
        while (true) {
          const existing = await storage.getCompanyBySlug(slug);
          if (!existing) break;
          slug = `${baseSlug}-${slugSuffix++}`;
        }

        const [txCompany] = await tx
          .insert((await import("@shared/schema")).companies)
          .values({
            name: record.companyName,
            email: record.email,
            slug,
            subscriptionTier: "free_trial",
            subscriptionStatus: newStatus,
            trialEndsAt: isDomestic ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) : null,
            signupCountry,
          })
          .returning();

        await tx.insert((await import("@shared/schema")).companyUsers).values({
          userId: txUser.id,
          companyId: txCompany.id,
          role: "owner",
        });

        await tx
          .update(emailVerificationTokens)
          .set({ used: true })
          .where(eq(emailVerificationTokens.id, record.id));

        return { user: txUser, company: txCompany };
      });

      await seedDefaultLeadSources(company.id);
      await storage.seedDefaultPricing(company.id);

      const host = req.headers.host || "localhost:5000";
      const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");
      const appUrl = `${isLocalhost ? "http" : "https"}://${host}`;

      if (isDomestic) {
        const verifyClaimed = await claimOnboardingEmailSend(verifiedUser.id).catch(() => false);
        if (!verifyClaimed) {
          console.log(
            `[Verify Email] Onboarding email already sent for ${maskEmail(record.email)}, skipping.`
          );
        } else {
          try {
            await sendEmail({
              companyId: company.id,
              to: record.email,
              subject: "Welcome to ScooPilot - Your login credentials",
              text: `Hi ${record.firstName},\n\nYour ScooPilot free trial is active!\n\nCompany: ${record.companyName}\nLogin: ${appUrl}\nEmail: ${record.email}\nTemporary Password: ${tempPassword}\n\nYou'll be asked to set a new password on your first login.`,
              html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                  <h1 style="color: white; margin: 0;">ScooPilot</h1>
                </div>
                <div style="padding: 20px; border: 1px solid #e5e7eb;">
                  <h2 style="margin-top: 0;">Your Free Trial is Active!</h2>
                  <p>Hi ${record.firstName},</p>
                  <p>Your ScooPilot account <strong>"${record.companyName}"</strong> is ready to go.</p>
                  <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 4px 0;"><strong>Email:</strong> ${record.email}</p>
                    <p style="margin: 4px 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
                  </div>
                  <div style="text-align: center; margin: 24px 0;">
                    <a href="${appUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log In Now</a>
                  </div>
                  <p style="color: #6b7280; font-size: 14px;">You'll be asked to set a new password when you first log in.</p>
                </div>
              </div>
            `,
            });
            console.log(`[Verify Email] Welcome email sent to ${maskEmail(record.email)}`);
          } catch (emailErr) {
            console.error(
              `[Signup] Failed to send welcome email to ${maskEmail(record.email)}, resetting flag:`,
              emailErr
            );
            await resetOnboardingEmailSent(verifiedUser.id).catch(() => {});
          }
        }

        sendAdminSignupNotification({
          companyName: record.companyName,
          ownerEmail: record.email,
          ownerName: [record.firstName, record.lastName].filter(Boolean).join(" "),
          tier: "free_trial",
          source: "Public Signup",
        }).catch((err) => console.error("[Signup Notification] Failed during public signup:", err));

        res.send(verificationResultPage(true, null, appUrl));
      } else {
        sendAdminSignupNotification({
          companyName: record.companyName,
          ownerEmail: record.email,
          ownerName: [record.firstName, record.lastName].filter(Boolean).join(" "),
          tier: "free_trial",
          source: `Public Signup (${signupCountry} - pending approval)`,
        }).catch((err) => console.error("[Signup Notification] Failed during public signup:", err));

        res.send(verificationPendingPage(record.firstName, appUrl, record.email));
      }
    } catch (err) {
      console.error("[Signup] Verification error:", err);
      res.send(
        verificationResultPage(false, "Something went wrong. Please try again or contact support.")
      );
    }
  });

  function verificationResultPage(
    success: boolean,
    errorMessage?: string | null,
    loginUrl?: string
  ): string {
    const title = success ? "Email Verified!" : "Verification Failed";
    const body = success
      ? `<h2 style="color: #2d8a5e; margin-top: 0;">Your account has been created!</h2>
         <p>Your free trial is now active. We've sent your login credentials to your email.</p>
         <div style="text-align: center; margin: 24px 0;">
           <a href="${loginUrl || "/"}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Go to Login</a>
         </div>
         <p style="color: #6b7280; font-size: 14px;">Check your email for your temporary password. You'll set a new one on first login.</p>`
      : `<h2 style="color: #dc2626; margin-top: 0;">Verification Failed</h2>
         <p>${errorMessage || "This link is invalid or has expired."}</p>
         <p style="color: #6b7280; font-size: 14px; margin-top: 16px;">Please try signing up again or contact support if you need help.</p>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - ScooPilot</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f9fafb; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.07); max-width: 480px; width: 90%; overflow: hidden; }
    .header { background-color: #2d8a5e; padding: 20px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 24px; }
    .content { padding: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header"><h1>ScooPilot</h1></div>
    <div class="content">${body}</div>
  </div>
</body>
</html>`;
  }

  app.post("/api/public/submit-verification-url", async (req: Request, res: Response) => {
    try {
      const { email, url } = req.body;
      if (!email || typeof email !== "string")
        return res.status(400).json({ error: "Email is required" });
      if (!url || typeof url !== "string")
        return res.status(400).json({ error: "URL is required" });
      const trimmedUrl = url.trim();
      try {
        const parsed = new URL(trimmedUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return res.status(400).json({ error: "URL must use http or https" });
        }
      } catch {
        return res.status(400).json({ error: "Invalid URL format" });
      }
      const { eq, and, isNull } = await import("drizzle-orm");
      const [company] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(
          and(
            eq(companies.email, email.trim().toLowerCase()),
            eq(companies.subscriptionStatus, "pending_approval"),
            isNull(companies.verificationUrl)
          )
        );
      if (!company)
        return res.status(404).json({ error: "No pending account found for this email" });
      await db
        .update(companies)
        .set({ verificationUrl: trimmedUrl })
        .where(eq(companies.id, company.id));
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  function verificationPendingPage(firstName: string, _appUrl: string, email: string): string {
    const escapedEmail = email.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account Under Review - ScooPilot</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f9fafb; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.07); max-width: 520px; width: 90%; overflow: hidden; }
    .header { background-color: #2d8a5e; padding: 20px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 24px; }
    .content { padding: 28px; }
    .badge { display: inline-block; background: #fef3c7; color: #92400e; border-radius: 20px; padding: 4px 14px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
    h2 { color: #1f2937; margin-top: 0; }
    p { color: #4b5563; line-height: 1.6; }
    label { display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 4px; margin-top: 14px; }
    input[type=url], input[type=email] { width: 100%; box-sizing: border-box; border: 1px solid #d1d5db; border-radius: 6px; padding: 9px 12px; font-size: 14px; color: #111827; }
    input[readonly] { background: #f3f4f6; color: #6b7280; }
    button { margin-top: 16px; background-color: #2d8a5e; color: white; border: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; font-size: 15px; cursor: pointer; width: 100%; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .success { background: #d1fae5; border: 1px solid #6ee7b7; border-radius: 8px; padding: 14px 16px; margin-top: 16px; color: #065f46; font-size: 14px; }
    .error-msg { color: #dc2626; font-size: 13px; margin-top: 6px; }
    .note { font-size: 13px; color: #9ca3af; margin-top: 20px; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header"><h1>ScooPilot</h1></div>
    <div class="content">
      <span class="badge">⏳ Pending Review</span>
      <h2>Hi ${firstName}, your email is verified!</h2>
      <p>Because your account is registering from outside the United States or Canada, our team does a brief review before activating access.</p>
      <p>You'll receive an email with your login credentials once your account is approved — usually within 1 business day.</p>
      <hr>
      <p style="margin-top:0;"><strong>Speed up your approval</strong> — share your LinkedIn profile or business website so our team can verify you faster:</p>
      <div id="form-area">
        <label for="email-field">Your email</label>
        <input type="email" id="email-field" value="${escapedEmail}" readonly />
        <label for="url-field">LinkedIn or business website URL</label>
        <input type="url" id="url-field" placeholder="https://linkedin.com/in/yourname" />
        <div id="error-msg" class="error-msg" style="display:none;"></div>
        <button id="submit-btn" onclick="submitUrl()">Submit for Faster Review</button>
      </div>
      <div id="success-area" class="success" style="display:none;">
        ✅ <strong>Profile submitted!</strong> Our team will review your information and email you once your account is approved.
      </div>
      <p class="note">Questions? Email us at <a href="mailto:support@scoopilot.com">support@scoopilot.com</a></p>
    </div>
  </div>
  <script>
    async function submitUrl() {
      var email = document.getElementById('email-field').value.trim();
      var url = document.getElementById('url-field').value.trim();
      var btn = document.getElementById('submit-btn');
      var err = document.getElementById('error-msg');
      err.style.display = 'none';
      if (!url) { err.textContent = 'Please enter a URL.'; err.style.display = 'block'; return; }
      btn.disabled = true; btn.textContent = 'Submitting...';
      try {
        var res = await fetch('/api/public/submit-verification-url', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, url: url })
        });
        var data = await res.json();
        if (res.ok && data.ok) {
          document.getElementById('form-area').style.display = 'none';
          document.getElementById('success-area').style.display = 'block';
        } else {
          err.textContent = data.error || 'Submission failed. Please try again.';
          err.style.display = 'block';
          btn.disabled = false; btn.textContent = 'Submit for Faster Review';
        }
      } catch(e) {
        err.textContent = 'Network error. Please try again.';
        err.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Submit for Faster Review';
      }
    }
  </script>
</body>
</html>`;
  }

  app.get("/api/public/company/:slug", async (req: Request, res: Response) => {
    try {
      const { slug: _slug } = req.params;
      const slug = p(_slug);
      const company = await storage.getCompanyBySlug(slug);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const pricingItems = await storage.getServicePricing(company.id);
      const activePricing = pricingItems
        .filter(
          (p) => p.isActive && (p.category === "recurring_service" || p.category === "add_on")
        )
        .map((p) => ({
          id: p.id,
          name: p.name,
          basePrice: p.basePrice,
          category: p.category,
          unit: p.unit,
          metadata: p.metadata,
          sortOrder: p.sortOrder,
        }));

      let primaryColor: string | null = null;
      if (company.invoiceTheme) {
        try {
          const theme = JSON.parse(company.invoiceTheme as string);
          if (theme.primaryColor) primaryColor = theme.primaryColor;
        } catch {}
      }

      res.json({
        name: company.name,
        logoUrl: company.logoUrl,
        pricing: activePricing,
        primaryColor,
        quoteFormLayout: company.quoteFormLayout || "stepper",
        country: company.country || "us",
        requireCardOnSignup: company.requireCardOnSignup ?? true,
        widgetFieldConfig: company.widgetFieldConfig ?? null,
        yardSizeTierConfig: company.yardSizeTierConfig ?? null,
        stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
        stripeConnectOnboarded: company.stripeConnectOnboarded || false,
        stripeConnectAccountId: company.stripeConnectAccountId || null,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.get("/api/public/check-zip/:slug/:zip", async (req: Request, res: Response) => {
    try {
      const { slug: _slug2, zip: _zip } = req.params;
      const slug = p(_slug2);
      const zip = p(_zip);
      const company = await storage.getCompanyBySlug(slug);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const isCanadian = company.country === "ca";
      const rawZip = zip.trim();

      let normalizedZip: string;
      if (isCanadian) {
        const caPostal = rawZip.replace(/\s/g, "").toUpperCase();
        if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(caPostal)) {
          return res.status(400).json({ error: "Invalid postal code format" });
        }
        normalizedZip = caPostal.slice(0, 3) + " " + caPostal.slice(3);
      } else {
        normalizedZip = rawZip.slice(0, 5);
        if (!/^\d{5}$/.test(normalizedZip)) {
          return res.status(400).json({ error: "Invalid ZIP code format" });
        }
      }

      const zones = await storage.getServiceZones(company.id);
      const activeZones = zones.filter((z) => z.isActive);

      if (activeZones.length === 0) {
        return res.json({ inServiceArea: true, hasZones: false });
      }

      let matchingZone: (typeof activeZones)[0] | undefined;
      if (isCanadian) {
        const prefix = normalizedZip.replace(/\s/g, "").slice(0, 3).toUpperCase();
        matchingZone = activeZones.find((z) => {
          const zoneCode = z.zipCode.replace(/\s/g, "").toUpperCase();
          return zoneCode === normalizedZip.replace(/\s/g, "") || zoneCode.startsWith(prefix);
        });
      } else {
        matchingZone = activeZones.find((z) => z.zipCode.trim().slice(0, 5) === normalizedZip);
      }

      res.json({
        inServiceArea: !!matchingZone,
        hasZones: true,
        zoneSurchargePercent: matchingZone?.priceSurchargePercent ?? 0,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ================ Public Invoice Pay (tip-enabled checkout for sent invoices) ================

  app.get("/api/public/invoices/:token", async (req: Request, res: Response) => {
    try {
      const token = p(req.params.token);
      const invoice = await storage.getInvoiceByPayToken(token);
      if (!invoice || invoice.status === "draft")
        return res.status(404).json({ error: "Invoice not found" });
      const company = await storage.getCompany(invoice.companyId);
      const contact = invoice.contactId ? await storage.getContactById(invoice.contactId) : null;
      const stripeEnabled =
        isStripeConfigured() &&
        !!(company?.stripeConnectOnboarded && company.stripeConnectAccountId);
      res.json({
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        status: invoice.status,
        dueDate: invoice.dueDate,
        companyName: company?.name || "",
        logoUrl: company?.logoUrl || "",
        contactName: contact ? `${contact.firstName} ${contact.lastName || ""}`.trim() : "",
        stripeEnabled,
        currency: company?.currency || "usd",
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/public/invoices/:token/pay", async (req: Request, res: Response) => {
    try {
      const token = p(req.params.token);
      const invoice = await storage.getInvoiceByPayToken(token);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.status === "draft")
        return res.status(400).json({ error: "Invoice not yet sent" });
      if (invoice.status === "voided")
        return res.status(400).json({ error: "Invoice has been voided" });
      if (invoice.status === "paid") return res.status(400).json({ error: "Invoice already paid" });

      const tipAmount = Math.round(parseFloat(req.body?.tipAmount || "0") * 100) / 100;
      if (isNaN(tipAmount) || tipAmount < 0)
        return res.status(400).json({ error: "Invalid tip amount" });
      if (tipAmount > 500) return res.status(400).json({ error: "Tip exceeds maximum" });

      const baseAmount = parseFloat(invoice.total);
      const chargeAmount = baseAmount + tipAmount;
      if (chargeAmount < 0.5)
        return res
          .status(400)
          .json({ error: "Minimum payment is $0.50. Please add a tip to continue." });

      const company = await storage.getCompany(invoice.companyId);
      const contact = invoice.contactId ? await storage.getContactById(invoice.contactId) : null;
      const connectAcct = company?.stripeConnectOnboarded ? company.stripeConnectAccountId : null;

      const contactName = contact
        ? `${contact.firstName} ${contact.lastName || ""}`.trim()
        : "Customer";
      const { customerId: stripeCustomerId, wasRecreated } = await ensureConnectedCustomer({
        currentCustomerId: contact?.stripeCustomerId || null,
        stripeAccount: connectAcct,
        email: contact?.email || undefined,
        name: contactName,
        metadata: { companyId: invoice.companyId, ...(contact ? { contactId: contact.id } : {}) },
      });
      if (wasRecreated && contact) {
        await storage.updateContact(contact.id, invoice.companyId, { stripeCustomerId });
      }

      const baseUrl = getBaseUrl(req);
      const result = await createCheckoutSession({
        customerId: stripeCustomerId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        amount: chargeAmount,
        successUrl: `${baseUrl}/invoice/${token}/pay?paid=1`,
        cancelUrl: `${baseUrl}/invoice/${token}/pay`,
        tipAmount: tipAmount.toFixed(2),
        stripeConnectAccountId: connectAcct,
        tenantId: invoice.companyId,
      });
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  const webhookLeadSchema = z.object({
    firstName: z.string().min(1).max(255),
    lastName: z.string().max(255).default(""),
    email: z.string().email().max(255).optional().or(z.literal("")),
    phone: z
      .string()
      .max(50)
      .regex(/^[+]?[\d\s\-().]{7,}$/, "Invalid phone number format")
      .optional()
      .or(z.literal("")),
    streetAddress: z.string().max(255).optional().or(z.literal("")),
    city: z.string().max(100).optional().or(z.literal("")),
    state: z.string().max(50).optional().or(z.literal("")),
    zipCode: z.string().max(20).optional().or(z.literal("")),
    numberOfDogs: z
      .union([z.number().int().min(1).max(20), z.string().regex(/^\d+$/).transform(Number)])
      .default(1),
    yardSize: z.enum(["small", "medium", "large", "extra-large"]).optional(),
    serviceFrequency: z
      .enum(["twice_weekly", "weekly", "biweekly", "monthly", "onetime"])
      .default("weekly"),
    serviceDay: z
      .enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])
      .optional(),
    source: z.string().max(100).optional(),
    notes: z.string().max(2000).optional(),
  });

  const DEFAULT_SMS_QUOTE_TEMPLATE =
    "Hi {firstName}! Thanks for your interest in our pet waste removal service. Based on {dogs} dog(s) with {frequency} service, your estimated price is ${price}/visit. Reply YES to get started!";

  async function lookupRealPrice(
    companyId: string,
    dogs: number,
    frequency: string,
    yardSize?: string
  ): Promise<{ priceCents: number; callForQuote: boolean }> {
    const pricingItems = await storage.getServicePricing(companyId);
    const activeRecurring = pricingItems.filter(
      (p) => p.isActive && p.category === "recurring_service"
    );
    const activeAddOns = pricingItems.filter((p) => p.isActive && p.category === "add_on");

    if (activeRecurring.length === 0) return { priceCents: 0, callForQuote: false };

    const freqMap: Record<string, string[]> = {
      twice_weekly: ["twice weekly", "twice-weekly", "two times", "2x", "twice per week"],
      weekly: ["weekly", "once a week", "once per week"],
      biweekly: ["bi-weekly", "bi weekly", "every other week", "biweekly"],
      monthly: ["monthly"],
      onetime: ["one-time", "one time", "onetime"],
    };
    const twiceWeeklyKeys = freqMap["twice_weekly"];

    const matchFreq = (name: string, freq: string): boolean => {
      const lower = name.toLowerCase();
      if (freq === "weekly") {
        if (twiceWeeklyKeys.some((k) => lower.includes(k))) return false;
        if ((freqMap["biweekly"] || []).some((k) => lower.includes(k))) return false;
      }
      return (freqMap[freq] || [freq]).some((k) => lower.includes(k));
    };

    const freqItems = activeRecurring.filter((p) => matchFreq(p.name, frequency));

    const matchDog = (name: string, d: number): boolean => {
      const lower = name.toLowerCase();
      const rangeMatch = lower.match(/(\d+)\s*[-–]\s*(\d+)\s*dog/);
      if (rangeMatch) return d >= parseInt(rangeMatch[1]) && d <= parseInt(rangeMatch[2]);
      const plusMatch = lower.match(/(\d+)\s*\+\s*dog/);
      if (plusMatch) return d >= parseInt(plusMatch[1]);
      if (lower.includes(`${d}+`) || lower.includes(`${d} +`)) return true;
      if (lower.includes(`${d} dog`)) return true;
      return false;
    };

    let matched = freqItems.find((p) => matchDog(p.name, dogs));
    if (!matched) {
      const plusItems = freqItems.filter((p) => {
        const m = p.name.match(/(\d+)\+/);
        return m && dogs >= parseInt(m[1]);
      });
      if (plusItems.length > 0) matched = plusItems[plusItems.length - 1];
    }

    if (!matched) return { priceCents: 0, callForQuote: false };
    const matchedMeta = matched.metadata as { callForQuote?: boolean } | null;
    if (matchedMeta?.callForQuote) return { priceCents: 0, callForQuote: true };

    let priceCents = Math.round(parseFloat(matched.basePrice) * 100);

    const lotSizeAddOns = activeAddOns.filter(
      (p) => p.name.toLowerCase().includes("lot size") || p.name.toLowerCase().includes("acre")
    );
    const yardAcreMap: Record<string, number> = {
      small: 0.1,
      medium: 0.35,
      large: 0.75,
      "extra-large": 1.0,
    };
    const acreage = yardAcreMap[yardSize || "medium"] || 0.35;
    let bestAddon: (typeof activeAddOns)[0] | null = null;
    for (const addon of lotSizeAddOns.sort((a, b) => a.sortOrder - b.sortOrder)) {
      const acreMatch = addon.name.match(/([\d.]+)\s*acre/i);
      if (acreMatch && acreage <= parseFloat(acreMatch[1])) {
        bestAddon = addon;
        break;
      }
    }
    if (!bestAddon && lotSizeAddOns.length > 0) bestAddon = lotSizeAddOns[lotSizeAddOns.length - 1];
    if (bestAddon && parseFloat(bestAddon.basePrice) > 0)
      priceCents += Math.round(parseFloat(bestAddon.basePrice) * 100);

    return { priceCents, callForQuote: false };
  }

  async function sendAutoQuoteSms(
    company: typeof companies.$inferSelect,
    contact: {
      id: string;
      firstName: string;
      phone: string | null;
      numberOfDogs: number | null;
      serviceFrequency: string | null;
    },
    yardSize?: string
  ): Promise<boolean> {
    if (!contact.phone) return false;
    const smsOk = await isSmsConfiguredForCompany(company.id);
    if (!smsOk) return false;

    const dogs = contact.numberOfDogs ?? 1;
    const frequency = (contact.serviceFrequency || "weekly") as
      | "weekly"
      | "biweekly"
      | "monthly"
      | "onetime";

    const pricingItems = await storage.getServicePricing(company.id);
    const hasActiveRecurring = pricingItems.some(
      (p) => p.isActive && p.category === "recurring_service"
    );

    let priceDollars: string;
    if (hasActiveRecurring) {
      const realPrice = await lookupRealPrice(company.id, dogs, frequency, yardSize);
      if (realPrice.priceCents > 0 && !realPrice.callForQuote) {
        priceDollars = (realPrice.priceCents / 100).toFixed(2);
      } else {
        priceDollars = "Call for Quote";
      }
    } else {
      const yardSizeMap: Record<string, number> = {
        small: 0.05,
        medium: 0.1,
        large: 0.2,
        "extra-large": 0.35,
      };
      const pricingInputs: PriceCalculatorInputs = {
        yardSizeAcres: yardSizeMap[yardSize || "medium"] || 0.1,
        dogCount: dogs,
        serviceFrequency: frequency,
        yardDifficulty: "flat",
        distanceFromNearestStopMiles: 0.5,
      };
      const priceResult = calculatePrice(pricingInputs, company.pricingConfig);
      priceDollars = (priceResult.recommendedPriceCents / 100).toFixed(2);
    }

    const template = company.leadWebhookSmsTemplate || DEFAULT_SMS_QUOTE_TEMPLATE;
    const body = template
      .replace(/\{firstName\}/g, contact.firstName)
      .replace(/\{dogs\}/g, String(dogs))
      .replace(/\{frequency\}/g, frequency)
      .replace(/\{price\}/g, priceDollars);

    const result = await sendSmsForCompany({
      to: contact.phone,
      body,
      companyId: company.id,
      contactId: contact.id,
    });

    if (result.success) {
      return true;
    } else {
      console.error(
        `[webhook-lead-sms] Failed to send auto-quote SMS to ${contact.phone}:`,
        result.error
      );
      return false;
    }
  }

  app.post("/api/webhooks/leads", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const parsed = webhookLeadSchema.safeParse(req.body);
      if (!parsed.success)
        return res
          .status(400)
          .json({ error: "Invalid payload", details: parsed.error.flatten().fieldErrors });
      const {
        firstName,
        lastName,
        email,
        phone,
        streetAddress,
        city,
        state,
        zipCode,
        numberOfDogs,
        yardSize,
        serviceFrequency,
        serviceDay,
        source,
        notes,
      } = parsed.data;

      const leadSource = source || "webhook";

      const existingSources = await storage.getLeadSources(companyId);
      const sourceExists = existingSources.some(
        (s) => s.name.toLowerCase() === leadSource.toLowerCase()
      );
      if (!sourceExists) {
        await storage.createLeadSource({ companyId, name: leadSource });
      }

      const contact = await storage.createContact({
        companyId,
        firstName,
        lastName,
        email: email || null,
        phone: phone || null,
        streetAddress: streetAddress || null,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        numberOfDogs,
        yardSize: yardSize || null,
        serviceFrequency,
        serviceDay: serviceDay || null,
        status: "lead",
        leadSource,
        notes: notes || null,
      });

      const hasFullAddress = !!(streetAddress && city && state && zipCode);
      if (hasFullAddress) {
        await createPropertyWithGeocode({
          companyId,
          contactId: contact.id,
          streetAddress: streetAddress!,
          city: city!,
          state: state!,
          zipCode: zipCode!,
          numberOfDogs,
          yardSize: yardSize || null,
        });
      }

      notify(
        companyId,
        "new_lead",
        "New Lead (Webhook)",
        `${firstName} ${lastName} submitted via ${leadSource}.`.trim(),
        `/contacts/${contact.id}`
      );

      const company = await storage.getCompany(companyId);
      let smsSent = false;
      if (phone && company) {
        try {
          smsSent = await sendAutoQuoteSms(
            company,
            { id: contact.id, firstName, phone, numberOfDogs, serviceFrequency },
            yardSize
          );
        } catch (err) {
          console.error("[webhook-lead] Auto-quote SMS error:", err);
        }
      }

      const yardSizeMap: Record<string, number> = {
        small: 0.05,
        medium: 0.1,
        large: 0.2,
        "extra-large": 0.35,
      };
      const pricingInputs: PriceCalculatorInputs = {
        yardSizeAcres: yardSizeMap[yardSize || "medium"] || 0.1,
        dogCount: numberOfDogs,
        serviceFrequency: serviceFrequency as "weekly" | "biweekly" | "monthly" | "onetime",
        yardDifficulty: "flat",
        distanceFromNearestStopMiles: 0.5,
      };
      const priceResult = calculatePrice(pricingInputs, company?.pricingConfig ?? null);

      res.status(201).json({
        contactId: contact.id,
        leadSource,
        quote: {
          recommendedPriceCents: priceResult.recommendedPriceCents,
          frequency: serviceFrequency,
        },
        smsSent,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  const webhookQuoteSchema = z.object({
    firstName: z.string().min(1).max(255),
    lastName: z.string().max(255).default(""),
    email: z.string().email().max(255).optional().or(z.literal("")),
    phone: z.string().max(50).optional().or(z.literal("")),
    streetAddress: z.string().max(255).optional().or(z.literal("")),
    city: z.string().max(100).optional().or(z.literal("")),
    state: z.string().max(50).optional().or(z.literal("")),
    zipCode: z.string().max(20).optional().or(z.literal("")),
    numberOfDogs: z
      .union([z.number().int().min(1).max(20), z.string().regex(/^\d+$/).transform(Number)])
      .default(1),
    yardSize: z.enum(["small", "medium", "large", "estate"]).default("medium"),
    frequency: z.enum(["weekly", "biweekly", "monthly", "onetime"]).default("weekly"),
    isFirstTime: z.boolean().default(true),
    source: z.string().max(100).optional(),
    notes: z.string().max(5000).optional(),
  });

  app.post("/api/webhooks/quotes", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const parsed = webhookQuoteSchema.safeParse(req.body);
      if (!parsed.success)
        return res
          .status(400)
          .json({ error: "Invalid payload", details: parsed.error.flatten().fieldErrors });

      const {
        firstName,
        lastName,
        email,
        phone,
        streetAddress,
        city,
        state: st,
        zipCode,
        numberOfDogs,
        yardSize,
        frequency,
        isFirstTime,
        source,
        notes,
      } = parsed.data;

      const leadSource = source || "website";

      const existingSources = await storage.getLeadSources(companyId);
      if (!existingSources.some((s) => s.name.toLowerCase() === leadSource.toLowerCase())) {
        await storage.createLeadSource({ companyId, name: leadSource });
      }

      let contactId: string | null = null;
      const normalizedEmail = email ? email.trim().toLowerCase() : null;
      const normalizedPhone = phone ? phone.replace(/[^\d+]/g, "") : null;
      if (normalizedEmail) {
        const [existing] = await db
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.companyId, companyId),
              sql`LOWER(TRIM(${contacts.email})) = ${normalizedEmail}`
            )
          )
          .limit(1);
        if (existing) contactId = existing.id;
      }
      if (!contactId && normalizedPhone) {
        const [existing] = await db
          .select()
          .from(contacts)
          .where(and(eq(contacts.companyId, companyId), eq(contacts.phone, normalizedPhone)))
          .limit(1);
        if (existing) contactId = existing.id;
      }

      if (!contactId) {
        const newContact = await storage.createContact({
          companyId,
          firstName,
          lastName,
          email: normalizedEmail || null,
          phone: normalizedPhone || null,
          streetAddress: streetAddress || null,
          city: city || null,
          state: st || null,
          zipCode: zipCode || null,
          numberOfDogs,
          yardSize: yardSize || null,
          serviceFrequency: frequency,
          status: "lead",
          leadSource,
          notes: notes || null,
        });
        contactId = newContact.id;
      }

      let propertyId: string | null = null;
      const hasFullAddress = !!(streetAddress && city && st && zipCode);
      if (hasFullAddress && contactId) {
        try {
          const prop = await createPropertyWithGeocode({
            companyId,
            contactId,
            streetAddress: streetAddress!,
            city: city!,
            state: st!,
            zipCode: zipCode!,
            numberOfDogs,
            yardSize: yardSize || null,
          });
          propertyId = prop.id;
        } catch {}
      }

      const company = await storage.getCompany(companyId);
      const pricingInput: ResidentialQuoteInput = {
        type: "residential",
        dogCount: numberOfDogs,
        yardSize,
        frequency,
        isFirstTime,
      };
      const tierPricing = calculateQuotePricing(pricingInput, company?.quoteDefaults ?? null);

      const fullAddress = hasFullAddress
        ? `${streetAddress}, ${city}, ${st} ${zipCode}`
        : streetAddress || "";

      const quoteNumber = await storage.getNextQuoteNumber(companyId);
      const quote = await storage.createQuote({
        companyId,
        type: "residential",
        quoteNumber,
        contactId,
        propertyId,
        contactName: `${firstName} ${lastName}`.trim(),
        contactEmail: email || null,
        contactPhone: phone || null,
        propertyAddress: fullAddress || null,
        dogCount: numberOfDogs,
        yardSize,
        frequency,
        isFirstTime,
        essentialPrice: tierPricing.essential.toFixed(2),
        premiumPrice: tierPricing.premium.toFixed(2),
        deluxePrice: tierPricing.deluxe.toFixed(2),
        initialCleanFee: tierPricing.initialCleanFee.toFixed(2),
        essentialFeatures: tierPricing.essentialFeatures,
        premiumFeatures: tierPricing.premiumFeatures,
        deluxeFeatures: tierPricing.deluxeFeatures,
        pricingBreakdown: tierPricing.breakdown,
        notes: notes || null,
        status: "draft",
      });

      notify(
        companyId,
        "new_quote",
        "New Quote (Webhook)",
        `Quote #${quoteNumber} created for ${firstName} ${lastName} via ${leadSource}.`.trim(),
        `/quotes/${quote.id}`
      );

      try {
        const { dispatchWebhooksForEvent } = await import("../services/webhook-dispatcher");
        await dispatchWebhooksForEvent(companyId, "quote.created", {
          quoteId: quote.id,
          quoteNumber,
          contactId,
          contactName: `${firstName} ${lastName}`.trim(),
          essentialPrice: tierPricing.essential,
          premiumPrice: tierPricing.premium,
          deluxePrice: tierPricing.deluxe,
          source: leadSource,
        });

        const { fireAutomationTrigger } = await import("../services/automation-runner");
        await fireAutomationTrigger("quote_created", companyId, {
          quoteId: quote.id,
          contactId,
          source: leadSource,
        });
      } catch (autoErr) {
        console.error("[webhook-quote] Automation trigger error:", autoErr);
      }

      res.status(201).json({
        quoteId: quote.id,
        quoteNumber,
        contactId,
        propertyId,
        pricing: {
          essential: tierPricing.essential,
          premium: tierPricing.premium,
          deluxe: tierPricing.deluxe,
          initialCleanFee: tierPricing.initialCleanFee,
        },
        source: leadSource,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  const quoteTrackSchema = z.object({
    sessionId: z.string().min(8).max(64),
    event: z.enum([
      "form_loaded",
      "zip_entered",
      "zip_passed",
      "zip_failed",
      "step2_completed",
      "step3_started",
      "submitted",
      "quote_shown",
    ]),
    step: z.number().int().min(0).max(4).optional(),
    zipCode: z
      .string()
      .regex(/^\d{5}$/)
      .optional(),
    isEmbed: z.boolean().optional(),
  });

  const quoteTrackRateLimit = new Map<string, { count: number; resetAt: number }>();

  app.post("/api/public/quote-events/:slug", async (req: Request, res: Response) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      const now = Date.now();
      const entry = quoteTrackRateLimit.get(clientIp);
      if (entry && entry.resetAt > now) {
        if (entry.count >= 100) {
          return res.status(429).json({ error: "Too many requests" });
        }
        entry.count++;
      } else {
        quoteTrackRateLimit.set(clientIp, { count: 1, resetAt: now + 60 * 60 * 1000 });
      }

      const { slug: _slug } = req.params;
      const slug = p(_slug);
      const company = await storage.getCompanyBySlug(slug);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const parsed = quoteTrackSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

      const { sessionId, event, step, zipCode, isEmbed } = parsed.data;
      await db.insert(quoteFormEvents).values({
        companyId: company.id,
        sessionId,
        event,
        step: step ?? null,
        zipCode: zipCode ?? null,
        isEmbed: isEmbed ?? false,
      });

      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  const publicLeadSchema = z.object({
    firstName: z.string().min(1).max(255),
    lastName: z.string().max(255).default(""),
    email: z.string().email().max(255).optional().or(z.literal("")),
    phone: z.string().max(50).optional().or(z.literal("")),
    streetAddress: z.string().min(1).max(255),
    city: z.string().min(1).max(100),
    state: z.string().min(1).max(50),
    zipCode: z.string().min(1).max(20),
    numberOfDogs: z
      .union([z.number().int().min(1).max(20), z.string().regex(/^\d+$/).transform(Number)])
      .default(1),
    yardSize: z.enum(["small", "medium", "large", "extra-large"]).default("medium"),
    serviceFrequency: z
      .enum(["twice_weekly", "weekly", "biweekly", "monthly", "onetime"])
      .default("weekly"),
    serviceDay: z
      .enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])
      .optional(),
    pricingItemId: z.string().uuid().optional(),
    lotAddonId: z.string().uuid().optional(),
    lastCleanup: z
      .enum(["1_week", "2_weeks", "3_weeks", "1_month", "2_months", "3_4_months", "never"])
      .optional(),
    notes: z.string().max(2000).optional(),
    smsOptIn: z.boolean().optional().default(false),
  });

  const contactLookupRateLimit = new Map<string, { count: number; resetAt: number }>();

  app.get("/api/public/contact-lookup/:slug", async (req: Request, res: Response) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      const now = Date.now();
      const entry = contactLookupRateLimit.get(clientIp);
      if (entry && entry.resetAt > now) {
        if (entry.count >= 5) {
          return res.status(429).json({ error: "Too many requests. Please try again later." });
        }
        entry.count++;
      } else {
        contactLookupRateLimit.set(clientIp, { count: 1, resetAt: now + 15 * 60 * 1000 });
      }

      const slug = p(req.params.slug);
      const company = await storage.getCompanyBySlug(slug);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const email = req.query.email;
      const zip = req.query.zip;

      if (!email || typeof email !== "string") {
        return res.status(400).json({ error: "Email is required" });
      }
      if (!zip || typeof zip !== "string") {
        return res.status(400).json({ error: "ZIP code is required" });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(normalizedEmail)) {
        return res.status(400).json({ error: "Invalid email" });
      }

      const normalizedZip = zip.trim().slice(0, 5);
      if (!/^\d{5}$/.test(normalizedZip)) {
        return res.status(400).json({ error: "Invalid ZIP code" });
      }

      const [contact] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.companyId, company.id),
            sql`LOWER(TRIM(${contacts.email})) = ${normalizedEmail}`,
            eq(contacts.zipCode, normalizedZip)
          )
        )
        .limit(1);

      return res.json({ found: !!contact });
    } catch (err) {
      handleError(res, err);
    }
  });

  const publicLeadRateLimit = new Map<string, { count: number; resetAt: number }>();

  app.post("/api/public/leads/:slug", async (req: Request, res: Response) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      const now = Date.now();
      const entry = publicLeadRateLimit.get(clientIp);
      if (entry && entry.resetAt > now) {
        if (entry.count >= 10) {
          return res.status(429).json({ error: "Too many requests. Please try again later." });
        }
        entry.count++;
      } else {
        publicLeadRateLimit.set(clientIp, { count: 1, resetAt: now + 60 * 60 * 1000 });
      }

      const { slug: _slug } = req.params;
      const slug = p(_slug);
      const company = await storage.getCompanyBySlug(slug);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const parsed = publicLeadSchema.safeParse(req.body);
      if (!parsed.success)
        return res
          .status(400)
          .json({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
      const {
        firstName,
        lastName,
        email,
        phone,
        streetAddress,
        city,
        state,
        zipCode,
        numberOfDogs,
        yardSize,
        serviceFrequency,
        serviceDay,
        pricingItemId,
        lotAddonId,
        lastCleanup,
        notes,
        smsOptIn,
      } = parsed.data;

      const dedup = req.query.dedup === "true";
      const notesText =
        [lastCleanup ? `Last cleanup: ${lastCleanup}` : null, notes || null]
          .filter(Boolean)
          .join(". ") || null;

      let contact: Awaited<ReturnType<typeof storage.createContact>>;
      let isUpsert = false;

      if (dedup) {
        // Try phone match first, then email
        const allContacts = await storage.getContacts(company.id);
        const normalizedPhone = phone?.trim().toLowerCase();
        const normalizedEmail = email?.trim().toLowerCase();
        let existing = normalizedPhone
          ? (allContacts.find((c) => c.phone && c.phone.trim().toLowerCase() === normalizedPhone) ??
            null)
          : null;
        if (!existing && normalizedEmail) {
          existing =
            allContacts.find((c) => c.email && c.email.trim().toLowerCase() === normalizedEmail) ??
            null;
        }
        if (existing) {
          contact = await storage.updateContact(existing.id, company.id, {
            firstName,
            lastName,
            email: email || existing.email || null,
            phone: phone || existing.phone || null,
            streetAddress: streetAddress || existing.streetAddress || null,
            city: city || existing.city || null,
            state: state || existing.state || null,
            zipCode: zipCode || existing.zipCode || null,
            numberOfDogs: numberOfDogs ?? existing.numberOfDogs ?? null,
            yardSize: yardSize || existing.yardSize || null,
            serviceFrequency: serviceFrequency || existing.serviceFrequency || null,
            serviceDay: serviceDay || existing.serviceDay || null,
            notes: notesText || existing.notes || null,
          });
          isUpsert = true;
        } else {
          contact = await storage.createContact({
            companyId: company.id,
            firstName,
            lastName,
            email: email || null,
            phone: phone || null,
            streetAddress,
            city,
            state,
            zipCode,
            numberOfDogs,
            yardSize,
            serviceFrequency,
            serviceDay: serviceDay || null,
            notes: notesText,
            status: "lead",
            leadSource: "website_widget",
          });
        }
      } else {
        contact = await storage.createContact({
          companyId: company.id,
          firstName,
          lastName,
          email: email || null,
          phone: phone || null,
          streetAddress,
          city,
          state,
          zipCode,
          numberOfDogs,
          yardSize,
          serviceFrequency,
          serviceDay: serviceDay || null,
          notes: notesText,
          status: "lead",
          leadSource: "website_widget",
        });
      }

      const hasFullAddress = !!(streetAddress && city && state && zipCode);
      let propertyId: string | null = null;

      if (isUpsert) {
        const existingProperties = await storage.getProperties(company.id, contact.id);
        if (existingProperties.length > 0) {
          propertyId = existingProperties[0].id;
        } else if (hasFullAddress) {
          const prop = await createPropertyWithGeocode({
            companyId: company.id,
            contactId: contact.id,
            streetAddress: streetAddress!,
            city,
            state,
            zipCode,
            numberOfDogs,
          });
          propertyId = prop.id;
        }
      } else {
        if (hasFullAddress) {
          const prop = await createPropertyWithGeocode({
            companyId: company.id,
            contactId: contact.id,
            streetAddress: streetAddress!,
            city,
            state,
            zipCode,
            numberOfDogs,
          });
          propertyId = prop.id;
        }
      }

      // In-app + email notification (always). Use "general" type so notify does NOT also
      // dispatch a thin contact.created webhook — the enriched dispatchWebhooksForEvent
      // call below is the single authoritative webhook for this event.
      notify(
        company.id,
        "general",
        isUpsert ? "Lead Updated" : "New Lead",
        `${firstName} ${lastName} ${isUpsert ? "updated their info via" : "signed up via"} your website widget.`.trim(),
        `/contacts/${contact.id}`
      );

      // Enriched webhook payload
      const enrichedPayload = {
        contactId: contact.id,
        propertyId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        streetAddress: contact.streetAddress ?? streetAddress ?? null,
        city: contact.city ?? city ?? null,
        state: contact.state ?? state ?? null,
        zipCode: contact.zipCode ?? zipCode ?? null,
        numberOfDogs: contact.numberOfDogs ?? numberOfDogs ?? null,
        yardSize: contact.yardSize ?? yardSize ?? null,
        serviceFrequency: contact.serviceFrequency ?? serviceFrequency ?? null,
        serviceDay: contact.serviceDay ?? serviceDay ?? null,
        lastCleanup: lastCleanup ?? null,
        notes: contact.notes ?? null,
        smsOptIn: smsOptIn ?? false,
      };

      if (isUpsert) {
        dispatchWebhooksForEvent(company.id, "contact.upserted", {
          ...enrichedPayload,
          action: "updated",
        }).catch(console.error);
      } else {
        dispatchWebhooksForEvent(company.id, "contact.created", enrichedPayload).catch(
          console.error
        );
      }

      let quotePriceCents: number | null = null;
      let callForQuote = false;

      const pricingItems = await storage.getServicePricing(company.id);
      const hasActiveRecurring = pricingItems.some(
        (p) => p.isActive && p.category === "recurring_service"
      );

      if (pricingItemId) {
        const selectedItem = pricingItems.find(
          (p) => p.id === pricingItemId && p.isActive && p.category === "recurring_service"
        );
        if (selectedItem) {
          const meta = selectedItem.metadata as { callForQuote?: boolean } | null;
          if (meta?.callForQuote) {
            callForQuote = true;
          } else {
            quotePriceCents = Math.round(parseFloat(selectedItem.basePrice) * 100);
          }
          if (lotAddonId && quotePriceCents !== null) {
            const lotItem = pricingItems.find(
              (p) => p.id === lotAddonId && p.isActive && p.category === "add_on"
            );
            if (lotItem && parseFloat(lotItem.basePrice) > 0) {
              quotePriceCents += Math.round(parseFloat(lotItem.basePrice) * 100);
            }
          }
        }
      }

      if (quotePriceCents === null && !callForQuote && hasActiveRecurring) {
        const realPrice = await lookupRealPrice(
          company.id,
          numberOfDogs,
          serviceFrequency,
          yardSize
        );
        if (realPrice.callForQuote) {
          callForQuote = true;
        } else if (realPrice.priceCents > 0) {
          quotePriceCents = realPrice.priceCents;
        } else {
          callForQuote = true;
        }
      }

      if (quotePriceCents === null && !callForQuote && !hasActiveRecurring) {
        const yardSizeMap: Record<string, number> = {
          small: 0.05,
          medium: 0.1,
          large: 0.2,
          "extra-large": 0.35,
        };
        const pricingInputs: PriceCalculatorInputs = {
          yardSizeAcres: yardSizeMap[yardSize] || 0.1,
          dogCount: numberOfDogs,
          serviceFrequency: serviceFrequency as (typeof servicePlans.$inferSelect)["frequency"],
          yardDifficulty: "flat",
          distanceFromNearestStopMiles: 0.5,
        };
        const priceResult = calculatePrice(pricingInputs, company.pricingConfig);
        quotePriceCents = priceResult.recommendedPriceCents;
      }

      let zoneSurchargePercent = 0;
      if (zipCode && quotePriceCents !== null && !callForQuote) {
        const normalizedZip = zipCode.trim().slice(0, 5);
        const zones = await storage.getServiceZones(company.id);
        const matchingZone = zones.find(
          (z) => z.zipCode.trim().slice(0, 5) === normalizedZip && z.isActive
        );
        if (matchingZone && matchingZone.priceSurchargePercent > 0) {
          zoneSurchargePercent = matchingZone.priceSurchargePercent;
          quotePriceCents = Math.round(quotePriceCents * (1 + zoneSurchargePercent / 100));
        }
      }

      res.status(201).json({
        contactId: contact.id,
        quote: {
          recommendedPriceCents: callForQuote ? 0 : quotePriceCents || 0,
          frequency: serviceFrequency,
          callForQuote,
          zoneSurchargePercent,
        },
      });

      if (company.quoteAutoFollowUpEnabled) {
        const priceDollars = callForQuote
          ? "Call for Quote"
          : ((quotePriceCents || 0) / 100).toFixed(2);
        const companyName = company.name || "Our Company";
        const priceForMerge = callForQuote ? "a custom quote" : `$${priceDollars}/visit`;
        const mergeReplace = (tpl: string) =>
          tpl
            .replace(/\{firstName\}/g, firstName)
            .replace(/\{price\}/g, priceForMerge)
            .replace(/\{frequency\}/g, serviceFrequency)
            .replace(/\{companyName\}/g, companyName)
            .replace(/\{dogs\}/g, String(numberOfDogs));

        if (phone && smsOptIn) {
          (async () => {
            try {
              const smsConfigured = await isSmsConfiguredForCompany(company.id);
              if (!smsConfigured) return;
              const defaultSmsTpl =
                "Thanks {firstName}! Your estimated quote from {companyName} is {price} for {frequency} service. We'll be in touch to confirm your schedule!";
              const smsTpl = company.quoteFollowUpSmsTemplate || defaultSmsTpl;
              const smsBody = mergeReplace(smsTpl);
              const result = await sendSmsForCompany({
                to: phone,
                body: smsBody,
                companyId: company.id,
                contactId: contact.id,
              });
              if (!result.success) console.error(`[quote-followup-sms] Failed:`, result.error);
            } catch (err) {
              console.error("[quote-followup-sms] Error:", err);
            }
          })();
        }

        if (email && company.quoteFollowUpEmailEnabled) {
          (async () => {
            try {
              const safeCompanyName = escapeHtml(companyName);
              const defaultEmailSubject = "Your Quote from {companyName}";
              const subject = mergeReplace(
                company.quoteFollowUpEmailSubject || defaultEmailSubject
              );
              const priceDisplay = callForQuote ? "Custom Quote" : `$${priceDollars}/visit`;
              const cleanupLabel = lastCleanup ? lastCleanup.replace(/_/g, " ") : null;
              const initialCleanupNote = cleanupLabel
                ? `<tr><td style="padding: 6px 0; color: #6b7280;">Initial Cleanup</td><td style="padding: 6px 0; text-align: right; font-weight: 600; color: #1f2937;">${escapeHtml(cleanupLabel)} since last service</td></tr>`
                : "";
              const logoHtml = company.logoUrl
                ? `<img src="${escapeHtml(company.logoUrl)}" alt="${safeCompanyName}" style="max-height: 48px; max-width: 200px; margin-bottom: 8px;" /><br/>`
                : "";
              const defaultEmailBody = `Hi {firstName},\n\nThank you for requesting a quote from {companyName}!\n\nYour estimated price for {frequency} service with {dogs} dog(s) is {price}.${cleanupLabel ? `\nInitial cleanup: ${cleanupLabel} since last service.` : ""}\n\nWe'll follow up shortly to confirm your schedule.\n\nBest regards,\n{companyName}`;
              const customBody = company.quoteFollowUpEmailBody;
              const text = mergeReplace(customBody || defaultEmailBody);
              const bodyHtml = escapeHtml(text).replace(/\n/g, "<br/>");
              const html = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background-color: #2d8a5e; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
                    ${logoHtml}
                    <h1 style="color: white; margin: 0; font-size: 22px;">${safeCompanyName}</h1>
                  </div>
                  <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none;">
                    <div style="margin: 0 0 20px; color: #4b5563; font-size: 14px; line-height: 1.6;">${bodyHtml}</div>
                    <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 0 0 20px;">
                      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <tr>
                          <td style="padding: 6px 0; color: #6b7280;">Service Frequency</td>
                          <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #1f2937;">${escapeHtml(serviceFrequency)}</td>
                        </tr>
                        <tr>
                          <td style="padding: 6px 0; color: #6b7280;">Number of Dogs</td>
                          <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #1f2937;">${numberOfDogs}</td>
                        </tr>
                        ${initialCleanupNote}
                        <tr style="border-top: 1px solid #d1fae5;">
                          <td style="padding: 10px 0 0; color: #6b7280; font-size: 15px;">Estimated Price</td>
                          <td style="padding: 10px 0 0; text-align: right; font-weight: 700; font-size: 20px; color: #16a34a;">${escapeHtml(priceDisplay)}</td>
                        </tr>
                      </table>
                    </div>
                    ${company.phone ? `<p style="margin: 0 0 16px;"><a href="tel:${escapeHtml(company.phone)}" style="display: inline-block; background-color: #16a34a; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600;">Contact Us</a></p>` : ""}
                  </div>
                  <div style="padding: 12px; text-align: center; font-size: 11px; color: #9ca3af;">
                    ${safeCompanyName}
                  </div>
                </div>`;
              const emailResult = await sendEmail({
                to: email,
                subject,
                text,
                html,
                companyId: company.id,
                contactId: contact.id,
                senderName: companyName,
                replyTo: company.email || undefined,
              });
              if (emailResult.success) {
                await logEmailSent(
                  company.id,
                  email,
                  subject,
                  "quote_follow_up",
                  emailResult.messageId,
                  contact.id
                );
              } else {
                console.error("[quote-followup-email] Failed:", emailResult.error);
              }
            } catch (err) {
              console.error("[quote-followup-email] Error:", err);
            }
          })();
        }
      }
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/public/portal/setup-intent", async (req: Request, res: Response) => {
    try {
      const { contactId, slug, forceNew } = req.body;
      if (!contactId || typeof contactId !== "string") {
        return res.status(400).json({ error: "contactId is required" });
      }
      if (!slug || typeof slug !== "string") {
        return res.status(400).json({ error: "slug is required" });
      }

      if (!isStripeConfigured()) {
        return res.status(400).json({ error: "Stripe is not configured for this account" });
      }

      const company = await storage.getCompanyBySlug(p(slug));
      if (!company) return res.status(404).json({ error: "Company not found" });

      const contact = await storage.getContactById(contactId);
      if (!contact || contact.companyId !== company.id) {
        return res.status(404).json({ error: "Contact not found" });
      }

      const connectAcct = company.stripeConnectOnboarded ? company.stripeConnectAccountId : null;
      const contactName = `${contact.firstName} ${contact.lastName}`.trim();
      const { customerId, wasRecreated } = await ensureConnectedCustomer({
        currentCustomerId: contact.stripeCustomerId,
        stripeAccount: connectAcct,
        email: contact.email || undefined,
        name: contactName,
        metadata: { contactId: contact.id, companyId: company.id },
      });

      if (wasRecreated || !contact.stripeCustomerId) {
        await storage.updateContact(contact.id, company.id, { stripeCustomerId: customerId });
      }

      if (!forceNew) {
        const existingMethods = await getCustomerPaymentMethods(customerId, connectAcct);
        if (existingMethods.length > 0) {
          const card = existingMethods[0];
          return res.json({
            cardOnFile: {
              last4: card.last4,
              brand: card.brand,
            },
          });
        }
      }

      const { clientSecret } = await createSetupIntent(customerId, connectAcct);
      res.json({ clientSecret });
    } catch (err) {
      handleError(res, err);
    }
  });

  app.post("/api/public/portal/setup-intent/confirm", async (req: Request, res: Response) => {
    try {
      const { setupIntentId, contactId, slug } = req.body;
      if (!setupIntentId || typeof setupIntentId !== "string") {
        return res.status(400).json({ error: "setupIntentId is required" });
      }
      if (!contactId || typeof contactId !== "string") {
        return res.status(400).json({ error: "contactId is required" });
      }
      if (!slug || typeof slug !== "string") {
        return res.status(400).json({ error: "slug is required" });
      }

      if (!isStripeConfigured()) {
        return res.status(400).json({ error: "Stripe is not configured for this account" });
      }

      const company = await storage.getCompanyBySlug(p(slug));
      if (!company) return res.status(404).json({ error: "Company not found" });

      const contact = await storage.getContactById(contactId);
      if (!contact || contact.companyId !== company.id) {
        return res.status(404).json({ error: "Contact not found" });
      }

      const connectAcct = company.stripeConnectOnboarded ? company.stripeConnectAccountId : null;
      const { status, paymentMethod, customer } = await retrieveSetupIntent(
        setupIntentId,
        connectAcct
      );

      if (status !== "succeeded") {
        return res
          .status(400)
          .json({ error: `SetupIntent status is '${status}', expected 'succeeded'` });
      }

      if (contact.stripeCustomerId && customer !== contact.stripeCustomerId) {
        return res
          .status(403)
          .json({ error: "SetupIntent customer does not match contact record" });
      }

      res.json({ ok: true, paymentMethod });
    } catch (err) {
      handleError(res, err);
    }
  });
}
