import { db } from "../db";
import { eq, and, lt, sql } from "drizzle-orm";
import { companies, companyUsers, users } from "@shared/schema";
import { storage } from "../storage";
import { sendEmail } from "../services/email";

export async function runTrialExpirationCheck(): Promise<void> {
  const now = new Date();
  console.log(`[Trial Expiration] Starting check at ${now.toISOString()}`);

  try {
    const expiredTrials = await db
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.subscriptionStatus, "trialing"),
          lt(companies.trialEndsAt, now)
        )
      );

    if (expiredTrials.length === 0) {
      console.log("[Trial Expiration] No expired trials found");
      return;
    }

    let suspended = 0;

    for (const company of expiredTrials) {
      try {
        await storage.updateCompany(company.id, {
          subscriptionStatus: "suspended",
          frozenAt: new Date(),
        } as Record<string, unknown>);

        storage
          .createNotification({
            companyId: company.id,
            type: "payment_failed" as "payment_failed",
            title: "Trial Expired",
            message:
              "Your 14-day free trial has ended. Please subscribe to continue using ScooPilot.",
            isRead: false,
            linkUrl: "/billing",
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[Trial Expiration] Notification error for ${company.id}:`, msg);
          });

        const ownerRow = await db
          .select({ email: users.email })
          .from(companyUsers)
          .innerJoin(users, eq(companyUsers.userId, users.id))
          .where(
            and(
              eq(companyUsers.companyId, company.id),
              eq(companyUsers.role, "owner")
            )
          )
          .limit(1);

        if (ownerRow.length > 0 && ownerRow[0].email) {
          const baseUrl = process.env.REPLIT_DEPLOYMENT_URL
            ? `https://${process.env.REPLIT_DEPLOYMENT_URL}`
            : process.env.REPLIT_DEV_DOMAIN
              ? `https://${process.env.REPLIT_DEV_DOMAIN}`
              : "https://scoopilot.replit.app";

          sendEmail({
            to: ownerRow[0].email,
            subject: "Your ScooPilot trial has ended",
            text: `Hi,\n\nYour 14-day free trial for "${company.name}" has ended. Subscribe now to restore access to your account.\n\nVisit ${baseUrl}/billing to choose a plan.`,
            html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
              <div style="background-color:#2d8a5e;padding:20px;text-align:center"><h1 style="color:white;margin:0">ScooPilot</h1></div>
              <div style="padding:30px 20px">
                <h2 style="color:#1a5c3a">Your trial has ended</h2>
                <p>Your 14-day free trial for <strong>${company.name}</strong> has ended.</p>
                <p>Subscribe now to restore full access to your CRM, routing, invoicing, and all ScooPilot features.</p>
                <div style="text-align:center;margin:30px 0">
                  <a href="${baseUrl}/billing" style="background-color:#2d8a5e;color:white;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:bold">Choose a Plan</a>
                </div>
              </div>
              <div style="background-color:#f5f5f5;padding:15px;text-align:center;font-size:12px;color:#666">ScooPilot - Pet Waste Removal Software</div>
            </div>`,
          }).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[Trial Expiration] Email error for ${company.id}:`, msg);
          });
        }

        suspended++;
        console.log(
          `[Trial Expiration] Suspended company "${company.name}" (${company.id}) — trial ended ${company.trialEndsAt?.toISOString()}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Trial Expiration] Error suspending company ${company.id}:`, msg);
      }
    }

    console.log(`[Trial Expiration] Completed: ${suspended}/${expiredTrials.length} accounts suspended`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Trial Expiration] Job error:", msg);
  }
}
