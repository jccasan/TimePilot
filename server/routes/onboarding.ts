import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getUserByEmail, createUserWithTempPassword } from "../services/app-auth";
import { sendEmail } from "../services/email";
import {
  reportMeteredUsageSet,
} from "../services/stripe";

import { isAuthenticated, getCompanyContext, requireRole, handleError, getDemoCompanyId, ensureCompanySetup } from "./shared";


export async function registerOnboardingRoutes(app: Express): Promise<void> {
  // ================ Setup / Onboarding ================

  app.post("/api/setup", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any).userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const result = await ensureCompanySetup(userId);
      const demoId = await getDemoCompanyId();
      if (demoId && demoId === result.companyId) {
        await db.execute(sql`UPDATE companies SET business_onboarding_step = 0, business_onboarding_complete = false WHERE id = ${result.companyId}`);
      }
      return res.json(result);
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/onboarding/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const contactsList = await storage.getContacts(companyId);
      const routesList = await storage.getRoutes(companyId);
      const plansList = await storage.getServicePlans(companyId);
      const zonesList = await storage.getServiceZones(companyId);

      const hasServiceZones = zonesList.length > 0;
      const hasContacts = contactsList.length > 0;
      const hasRoutes = routesList.length > 0;
      const hasServicePlans = plansList.length > 0;

      let firstContact: any = null;
      let firstProperty: any = null;
      let firstServicePlan: any = null;
      if (hasContacts) {
        firstContact = contactsList[0];
        const props = await storage.getProperties(companyId, firstContact.id);
        if (props.length > 0) firstProperty = props[0];
      }
      if (hasServicePlans) {
        firstServicePlan = plansList[0];
      }

      let hasPriceRecommendation = false;
      if (firstProperty) {
        const recs = await storage.getPriceRecommendations(companyId);
        hasPriceRecommendation = recs.some((r: any) => r.propertyId === firstProperty.id);
      }

      const steps = [
        { key: "service_zones", label: "Set up your service zones", completed: hasServiceZones },
        { key: "add_customer", label: "Add your first customer", completed: hasContacts },
        { key: "price_property", label: "Price your first property", completed: hasPriceRecommendation || hasServicePlans },
        { key: "create_service_plan", label: "Schedule your first service", completed: hasServicePlans },
        { key: "generate_route", label: "Generate your first route", completed: hasRoutes },
      ];

      const isComplete = steps.filter(s => s.key !== "service_zones").every(s => s.completed);
      res.json({
        isComplete,
        steps,
        firstContact: firstContact ? { id: firstContact.id, firstName: firstContact.firstName, lastName: firstContact.lastName } : null,
        firstProperty: firstProperty ? {
          id: firstProperty.id,
          streetAddress: firstProperty.streetAddress,
          city: firstProperty.city,
          state: firstProperty.state,
          yardSize: firstProperty.yardSize,
          numberOfDogs: firstProperty.numberOfDogs,
          measuredYardSqft: firstProperty.measuredYardSqft,
        } : null,
        firstServicePlan: firstServicePlan ? { id: firstServicePlan.id, routeId: firstServicePlan.routeId } : null,
      });
    } catch (err) { handleError(res, err); }
  });

  app.get("/api/onboarding/business-status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = await getCompanyContext(req);
      const demoId = await getDemoCompanyId();
      const isDemo = demoId && demoId === companyId;
      const result = await db.execute(sql`SELECT name, email, phone, address, logo_url, website_url, business_description, service_area_description, pricing_config, stripe_connect_account_id, stripe_connect_onboarded, business_onboarding_step, business_onboarding_complete FROM companies WHERE id = ${companyId}`);
      const rows = result.rows as Record<string, unknown>[];
      if (!rows || rows.length === 0) return res.status(404).json({ error: "Company not found" });
      const row = rows[0];
      const step = (row.business_onboarding_step as number) ?? 0;
      const completedSteps: number[] = Array.from({ length: step }, (_, i) => i);
      res.json({
        currentStep: step,
        isComplete: isDemo ? false : ((row.business_onboarding_complete as boolean) ?? false),
        completedSteps,
        companyData: {
          name: row.name,
          email: row.email,
          phone: row.phone,
          address: row.address,
          logoUrl: row.logo_url,
          websiteUrl: row.website_url,
          businessDescription: row.business_description,
          serviceAreaDescription: row.service_area_description,
          pricingConfig: row.pricing_config,
          stripeConnectAccountId: row.stripe_connect_account_id,
          stripeConnectOnboarded: row.stripe_connect_onboarded,
        },
      });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/onboarding/business-step", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const { step, data, resetWizard } = req.body;

      if (resetWizard) {
        await db.execute(sql`UPDATE companies SET business_onboarding_step = 0, business_onboarding_complete = false WHERE id = ${companyId}`);
        return res.json({ success: true, nextStep: 0 });
      }

      if (typeof step !== "number" || step < 0 || step > 4) {
        return res.status(400).json({ error: "Invalid step number" });
      }

      if (step === 0 && data) {
        await db.execute(sql`UPDATE companies SET
          name = ${data.name || sql`name`},
          email = ${data.email || sql`email`},
          phone = ${data.phone || sql`phone`},
          address = ${data.address || sql`address`},
          website_url = ${data.websiteUrl || null},
          timezone = ${data.timezone || sql`timezone`},
          business_onboarding_step = ${step + 1}
          WHERE id = ${companyId}`);
      } else if (step === 1 && data) {
        await db.execute(sql`UPDATE companies SET business_description = ${data.businessDescription || null}, service_area_description = ${data.serviceAreaDescription || null}, business_onboarding_step = ${step + 1} WHERE id = ${companyId}`);
      } else if (step === 2 && data?.pricingConfig) {
        await db.execute(sql`UPDATE companies SET pricing_config = ${JSON.stringify(data.pricingConfig)}::jsonb, business_onboarding_step = ${step + 1} WHERE id = ${companyId}`);
      } else {
        await db.execute(sql`UPDATE companies SET business_onboarding_step = ${step + 1} WHERE id = ${companyId}`);
      }

      res.json({ success: true, nextStep: step + 1 });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/onboarding/business-complete", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const demoId = await getDemoCompanyId();
      if (!demoId || demoId !== companyId) {
        await db.execute(
          sql`UPDATE companies SET business_onboarding_complete = true, business_onboarding_step = 5 WHERE id = ${companyId}`
        );
      }
      res.json({ success: true });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/onboarding/scrape-website", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      let { websiteUrl } = req.body;
      if (!websiteUrl || typeof websiteUrl !== "string") return res.status(400).json({ error: "Website URL is required" });

      websiteUrl = websiteUrl.trim();
      if (!/^https?:\/\//i.test(websiteUrl)) {
        websiteUrl = `https://${websiteUrl}`;
      }

      let parsed: URL;
      try {
        parsed = new URL(websiteUrl);
      } catch {
        return res.status(400).json({ error: "Invalid URL format" });
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return res.status(400).json({ error: "Only HTTP/HTTPS URLs are allowed" });
      }
      const hostname = parsed.hostname.toLowerCase();
      const hostnameBlockedPatterns = [
        /^localhost$/i,
        /metadata\.google/i,
        /\.internal$/i,
        /\.local$/i,
      ];
      if (hostnameBlockedPatterns.some(p => p.test(hostname))) {
        return res.status(400).json({ error: "URL points to a restricted network address" });
      }

      const isPrivateIP = (ip: string): boolean => {
        const parts = ip.split(".").map(Number);
        if (parts.length === 4) {
          if (parts[0] === 127) return true;
          if (parts[0] === 10) return true;
          if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
          if (parts[0] === 192 && parts[1] === 168) return true;
          if (parts[0] === 169 && parts[1] === 254) return true;
          if (parts[0] === 0) return true;
        }
        if (ip === "::1" || ip === "::" || ip.startsWith("fc00:") || ip.startsWith("fd") || ip.startsWith("fe80:")) return true;
        return false;
      };

      const ipLiteralMatch = hostname.match(/^\[?([0-9a-f.:]+)\]?$/i);
      if (ipLiteralMatch && isPrivateIP(ipLiteralMatch[1])) {
        return res.status(400).json({ error: "URL points to a restricted network address" });
      }
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) && isPrivateIP(hostname)) {
        return res.status(400).json({ error: "URL points to a restricted network address" });
      }

      const dns = await import("dns");
      const { promisify } = await import("util");
      const dnsResolve = promisify(dns.resolve);

      const validateResolvedIPs = async (host: string): Promise<boolean> => {
        let resolvedIPs: string[] = [];
        try { resolvedIPs = resolvedIPs.concat(await dnsResolve(host, "A")); } catch {}
        try { resolvedIPs = resolvedIPs.concat(await dnsResolve(host, "AAAA")); } catch {}
        if (resolvedIPs.length === 0) return true;
        return !resolvedIPs.some(isPrivateIP);
      };

      if (!(await validateResolvedIPs(hostname))) {
        return res.status(400).json({ error: "URL resolves to a private network address" });
      }

      let pageText = "";
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(parsed.toString(), {
          signal: controller.signal,
          headers: { "User-Agent": "ScooPilot-Onboarding/1.0" },
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (location) {
            try {
              const redirectUrl = new URL(location, parsed.toString());
              if (!["http:", "https:"].includes(redirectUrl.protocol)) {
                return res.json({ success: false, error: "Redirect to non-HTTP URL blocked.", insights: null });
              }
              const rHost = redirectUrl.hostname.toLowerCase();
              if (hostnameBlockedPatterns.some(p => p.test(rHost))) {
                return res.json({ success: false, error: "Redirect to restricted address blocked.", insights: null });
              }
              if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(rHost) && isPrivateIP(rHost)) {
                return res.json({ success: false, error: "Redirect to private IP blocked.", insights: null });
              }
              if (!(await validateResolvedIPs(rHost))) {
                return res.json({ success: false, error: "Redirect resolves to private address.", insights: null });
              }
              const controller2 = new AbortController();
              const timeout2 = setTimeout(() => controller2.abort(), 10000);
              const response2 = await fetch(redirectUrl.toString(), {
                signal: controller2.signal,
                headers: { "User-Agent": "ScooPilot-Onboarding/1.0" },
                redirect: "manual",
              });
              clearTimeout(timeout2);
              const ct2 = response2.headers.get("content-type") || "";
              if (!ct2.includes("text/html") && !ct2.includes("text/plain")) {
                return res.json({ success: false, error: "URL did not return an HTML page.", insights: null });
              }
              const html2 = await response2.text();
              pageText = html2.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000);
            } catch {
              return res.json({ success: false, error: "Could not follow redirect.", insights: null });
            }
          } else {
            return res.json({ success: false, error: "Redirect without location header.", insights: null });
          }
        } else {
          clearTimeout(timeout);
          const contentType = response.headers.get("content-type") || "";
          if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
            return res.json({ success: false, error: "URL did not return an HTML page.", insights: null });
          }
          const html = await response.text();
          pageText = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 5000);
        }
      } catch (fetchErr) {
        return res.json({
          success: false,
          error: "Could not fetch website. Please check the URL and try again.",
          insights: null,
        });
      }

      try {
        const OpenAI = (await import("openai")).default;
        const ai = new OpenAI({
          apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
          baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
        });

        const completion = await ai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are a business analyst specializing in pet waste removal companies. Analyze the following website text and extract business intelligence. Return a JSON object with these fields:
- businessDescription: string (1-2 sentence summary of what the business does)
- serviceArea: string (geographic area they serve, if mentioned)
- servicesOffered: string[] (list of services)
- pricingInfo: { weeklyPrice?: number, biweeklyPrice?: number, monthlyPrice?: number, oneTimePrice?: number, perDogExtra?: number } (any pricing found, in dollars)
- competitiveInsights: string (brief competitive positioning notes)
- suggestedPricingMode: "aggressive" | "standard" | "premium" (based on their positioning)
Return ONLY valid JSON, no markdown.`,
            },
            { role: "user", content: pageText },
          ],
          temperature: 0.3,
          max_tokens: 1000,
        });

        const raw = completion.choices[0]?.message?.content || "{}";
        let insights;
        try {
          insights = JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
        } catch {
          insights = { businessDescription: raw, serviceArea: "", servicesOffered: [], pricingInfo: {}, competitiveInsights: "", suggestedPricingMode: "standard" };
        }

        res.json({ success: true, insights, rawTextLength: pageText.length });
      } catch (aiErr) {
        console.error("[Onboarding] AI analysis failed:", aiErr instanceof Error ? aiErr.message : aiErr);
        res.json({
          success: true,
          insights: { businessDescription: "Unable to analyze website content automatically.", serviceArea: "", servicesOffered: [], pricingInfo: {}, competitiveInsights: "", suggestedPricingMode: "standard" },
          rawTextLength: pageText.length,
        });
      }
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/onboarding/import-pricing-csv", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const { csvText } = req.body;
      if (!csvText) return res.status(400).json({ error: "CSV text is required" });

      const { parseCSV } = await import("../services/import-transforms");
      const { headers, rows } = parseCSV(csvText);

      if (rows.length === 0) return res.status(400).json({ error: "CSV has no data rows" });

      const priceHeaders = headers.filter(h => {
        const lower = h.toLowerCase();
        return lower.includes("price") || lower.includes("rate") || lower.includes("cost") || lower.includes("amount") || lower.includes("fee") || lower.includes("charge");
      });
      const freqHeaders = headers.filter(h => {
        const lower = h.toLowerCase();
        return lower.includes("frequency") || lower.includes("schedule") || lower.includes("service");
      });
      const sizeHeaders = headers.filter(h => {
        const lower = h.toLowerCase();
        return lower.includes("yard") || lower.includes("size") || lower.includes("lot") || lower.includes("acre") || lower.includes("sqft");
      });
      const dogHeaders = headers.filter(h => {
        const lower = h.toLowerCase();
        return lower.includes("dog") || lower.includes("pet");
      });

      const pricingData: any[] = [];
      for (const row of rows) {
        const entry: any = {};
        for (let i = 0; i < headers.length; i++) {
          entry[headers[i]] = row[i] || "";
        }
        pricingData.push(entry);
      }

      const summary = {
        totalRows: rows.length,
        headers,
        priceColumns: priceHeaders,
        frequencyColumns: freqHeaders,
        sizeColumns: sizeHeaders,
        dogColumns: dogHeaders,
        sampleRows: pricingData.slice(0, 5),
      };

      res.json({ success: true, summary });
    } catch (err) { handleError(res, err); }
  });

  app.post("/api/company/invite", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId, role } = await getCompanyContext(req);
      requireRole(role, ["owner", "admin"]);
      const { email, firstName, lastName, role: targetRole } = req.body;
      if (!email) return res.status(400).json({ error: "Email is required" });
      if (!firstName) return res.status(400).json({ error: "First name is required" });
      const validRoles = ["admin", "tech"];
      if (!validRoles.includes(targetRole || "tech")) {
        return res.status(400).json({ error: "Invalid role" });
      }

      const company = await storage.getCompany(companyId);
      const companyUsersList = await storage.getCompanyUsers(companyId);
      const activeCount = companyUsersList.filter(cu => cu.isActive).length;
      const tier = company?.subscriptionTier || "tier_1";
      const tierConfig = (await import("@shared/schema")).TIER_CONFIG;
      const tierMaxUsers = tierConfig[tier as keyof typeof tierConfig]?.maxUsers || 1;
      const maxUsers = company?.customMaxUsers ?? tierMaxUsers;
      if (activeCount >= maxUsers) {
        return res.status(402).json({ error: `Seat limit reached (${activeCount}/${maxUsers}).`, seatLimitReached: true, currentCount: activeCount, maxUsers });
      }

      let existingUser = await getUserByEmail(email);
      let tempPassword: string | null = null;

      if (existingUser) {
        const existingMembership = await storage.getCompanyUser(companyId, existingUser.id);
        if (existingMembership && existingMembership.isActive) {
          return res.status(409).json({ error: "This user is already a team member" });
        }
        if (existingMembership && !existingMembership.isActive) {
          await storage.updateCompanyUser(existingMembership.id, { isActive: true, role: targetRole || "tech" });
        } else {
          await storage.addUserToCompany(existingUser.id, companyId, targetRole || "tech");
        }
      } else {
        const crypto = await import("crypto");
        tempPassword = crypto.randomBytes(6).toString("base64url");
        existingUser = await createUserWithTempPassword(email, firstName, lastName || "", tempPassword);
        await storage.addUserToCompany(existingUser.id, companyId, targetRole || "tech");
      }

      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host || "localhost:5000";
      const appUrl = `${protocol}://${host}/auth`;
      const companyName = company?.name || "your company";

      if (tempPassword) {
        await sendEmail({
          companyId: companyId,
          to: email,
          subject: `You've been invited to ${companyName} on ScooPilot`,
          senderName: company?.name || undefined,
          replyTo: company?.email || undefined,
          text: `Hi ${firstName},\n\nYou've been added as a ${targetRole || "tech"} on ${companyName}'s ScooPilot account.\n\nLog in at: ${appUrl}\nEmail: ${email}\nTemporary Password: ${tempPassword}\n\nYou'll be asked to set a new password on your first login.\n\nFor the best experience on your phone, open the link above and install the app when prompted.`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">${companyName}</h1>
              </div>
              <div style="padding: 20px; border: 1px solid #e5e7eb;">
                <h2 style="margin-top: 0;">Welcome to ${companyName}!</h2>
                <p>Hi ${firstName},</p>
                <p>You've been added as a <strong>${targetRole || "technician"}</strong> on ${companyName}'s ScooPilot account.</p>
                <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
                  <p style="margin: 4px 0;"><strong>Email:</strong> ${email}</p>
                  <p style="margin: 4px 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
                </div>
                <div style="text-align: center; margin: 24px 0;">
                  <a href="${appUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log In Now</a>
                </div>
                <p style="color: #6b7280; font-size: 14px;">You'll be asked to set a new password when you first log in.</p>
                <p style="color: #6b7280; font-size: 14px;">For the best experience on your phone, open the app and tap "Install" when prompted.</p>
              </div>
            </div>
          `,
        });
      } else {
        await sendEmail({
          companyId: companyId,
          to: email,
          subject: `You've been added to ${companyName} on ScooPilot`,
          senderName: company?.name || undefined,
          replyTo: company?.email || undefined,
          text: `Hi ${firstName},\n\nYou've been added as a ${targetRole || "tech"} on ${companyName}'s ScooPilot account. Log in with your existing credentials at: ${appUrl}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2d8a5e; padding: 20px; text-align: center;">
                <h1 style="color: white; margin: 0;">${companyName}</h1>
              </div>
              <div style="padding: 20px; border: 1px solid #e5e7eb;">
                <h2 style="margin-top: 0;">You've been added to ${companyName}</h2>
                <p>Hi ${firstName},</p>
                <p>You've been added as a <strong>${targetRole || "technician"}</strong>. Log in with your existing credentials.</p>
                <div style="text-align: center; margin: 24px 0;">
                  <a href="${appUrl}" style="background-color: #2d8a5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Log In Now</a>
                </div>
              </div>
            </div>
          `,
        });
      }

      (async () => {
        try {
          await storage.createUsageEvent({
            companyId,
            eventType: "user_seat",
            quantity: 1,
            metadata: { userId: existingUser.id, email, role: targetRole || "tech" },
          });
          const activeMembers = await storage.getCompanyUsers(companyId);
          const activeCount = activeMembers.filter(m => m.isActive !== false).length;
          const company = await storage.getCompany(companyId);
          if (company?.stripeSubscriptionId) {
            reportMeteredUsageSet(company.stripeSubscriptionId, "user_seat", activeCount).catch(() => {});
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[Usage] Failed to log user seat event:", message);
        }
      })();

      res.json({ success: true, userId: existingUser.id, email, role: targetRole || "tech" });
    } catch (err) { handleError(res, err); }
  });

}