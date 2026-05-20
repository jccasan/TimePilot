import { db } from "../db";
import { eq, and, lt, isNotNull } from "drizzle-orm";
import { leadResponseConfig, companyUsers, users } from "@shared/schema";
import { sendEmail } from "../services/email";

const VALID_LR_STATUS_VALUES = [
  "new",
  "estimate_sent",
  "deposit_pending",
  "deposit_paid",
  "scheduled",
  "dead",
] as const;
export type LeadResponseStatusValue = (typeof VALID_LR_STATUS_VALUES)[number];

export async function runLeadResponseExpirationJob(): Promise<void> {
  const now = new Date();
  console.log(`[LR Expiration] Starting check at ${now.toISOString()}`);

  try {
    // Step 1: deactivate configs where leadResponseActiveUntil has passed
    const expiredActive = await db
      .select()
      .from(leadResponseConfig)
      .where(
        and(
          eq(leadResponseConfig.leadResponseActive, true),
          isNotNull(leadResponseConfig.leadResponseActiveUntil),
          lt(leadResponseConfig.leadResponseActiveUntil, now)
        )
      );

    for (const config of expiredActive) {
      try {
        await db
          .update(leadResponseConfig)
          .set({ leadResponseActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(leadResponseConfig.id, config.id),
              eq(leadResponseConfig.leadResponseActive, true)
            )
          );
        console.log(
          `[LR Expiration] Deactivated Lead Response for company ${config.companyId} (activeUntil: ${config.leadResponseActiveUntil?.toISOString()})`
        );
      } catch (err) {
        console.error(
          `[LR Expiration] Error deactivating config ${config.id}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // Step 2: release Telnyx numbers where telnyxNumberReleaseDate has passed
    const pendingRelease = await db
      .select()
      .from(leadResponseConfig)
      .where(
        and(
          isNotNull(leadResponseConfig.telnyxNumberReleaseDate),
          lt(leadResponseConfig.telnyxNumberReleaseDate, now)
        )
      );

    for (const config of pendingRelease) {
      try {
        // NOTE: Telnyx sandbox/test mode — flag this step for live-mode switch before production release.
        // In test mode we log the release intent but do not make a live API call.
        console.log(
          `[LR Expiration] [SANDBOX] Would release Telnyx number for company ${config.companyId} (releaseDate: ${config.telnyxNumberReleaseDate?.toISOString()})`
        );

        // Clear the release date so we don't keep logging it
        await db
          .update(leadResponseConfig)
          .set({ telnyxNumberReleaseDate: null, updatedAt: new Date() })
          .where(eq(leadResponseConfig.id, config.id));

        // Notify SP admin portal (via console/future notification hook)
        console.log(
          `[LR Expiration] Admin notification: Telnyx number released for company ${config.companyId}`
        );
      } catch (err) {
        console.error(
          `[LR Expiration] Error releasing Telnyx number for config ${config.id}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    if (expiredActive.length === 0 && pendingRelease.length === 0) {
      console.log("[LR Expiration] No expired Lead Response configs found");
    } else {
      console.log(
        `[LR Expiration] Completed: ${expiredActive.length} deactivated, ${pendingRelease.length} Telnyx numbers released`
      );
    }
  } catch (err) {
    console.error("[LR Expiration] Job error:", err instanceof Error ? err.message : String(err));
  }
}

export async function sendLeadResponseCancellationEmail(
  companyId: string,
  accessEndDate: Date
): Promise<void> {
  try {
    const ownerRows = await db
      .select({ email: users.email, firstName: users.firstName })
      .from(companyUsers)
      .innerJoin(users, eq(companyUsers.userId, users.id))
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.isActive, true)))
      .limit(5);

    const baseUrl = process.env.REPLIT_DEPLOYMENT_URL
      ? `https://${process.env.REPLIT_DEPLOYMENT_URL}`
      : process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : "https://app.scoopilot.com";

    const accessEndStr = accessEndDate.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const reactivateUrl = `${baseUrl}/billing`;

    for (const row of ownerRows) {
      if (!row.email) continue;
      await sendEmail({
        companyId,
        to: row.email,
        subject: "Your Lead Response subscription has been cancelled",
        text: `Hi${row.firstName ? ` ${row.firstName}` : ""},\n\nYour Lead Response subscription has been cancelled. You will retain full access until ${accessEndStr}.\n\nTo reactivate your subscription before access ends, visit: ${reactivateUrl}\n\nThank you for using ScooPilot Lead Response.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background-color:#2d8a5e;padding:20px;text-align:center"><h1 style="color:white;margin:0">ScooPilot</h1></div>
          <div style="padding:30px 20px">
            <h2 style="color:#1a5c3a">Lead Response Subscription Cancelled</h2>
            <p>Hi${row.firstName ? ` ${row.firstName}` : ""},</p>
            <p>Your Lead Response subscription has been cancelled. You will retain full access until:</p>
            <p style="font-size:18px;font-weight:bold;color:#2d8a5e">${accessEndStr}</p>
            <p>To reactivate before access ends and keep your dedicated phone number, click below:</p>
            <div style="text-align:center;margin:30px 0">
              <a href="${reactivateUrl}" style="background-color:#2d8a5e;color:white;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:bold">Reactivate Subscription</a>
            </div>
          </div>
          <div style="background-color:#f5f5f5;padding:15px;text-align:center;font-size:12px;color:#666">ScooPilot - Pet Waste Removal Software</div>
        </div>`,
      }).catch((err) => console.error(`[LR Cancellation] Email failed for ${row.email}:`, err));
    }
  } catch (err) {
    console.error(
      "[LR Cancellation] Failed to send cancellation email:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export { VALID_LR_STATUS_VALUES };
