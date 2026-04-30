import { db } from "../db";
import { eq, and, gte, isNotNull } from "drizzle-orm";
import { companies, companyUsers, users, notifications } from "@shared/schema";
import { storage } from "../storage";
import { sendEmail } from "../services/email";
import { getRetellAgentWebhookUrl, registerRetellWebhook, getAppBaseUrl } from "../services/retell";

async function recordRepair(
  companyId: string | null,
  agentId: string,
  oldUrl: string | null,
  newUrl: string,
  triggeredBy: "auto" | "manual"
): Promise<void> {
  try {
    await storage.createRetellWebhookRepair({
      companyId: companyId ?? undefined,
      agentId,
      oldUrl: oldUrl ?? undefined,
      newUrl,
      triggeredBy,
    });
  } catch (err) {
    console.error("[retell-webhook-check] Failed to record repair event:", err);
  }
}

const DEDUP_WINDOW_MS = 23 * 60 * 60 * 1000;
const NOTIFICATION_TITLE_BROKEN = "Retell Webhook Not Registered";
const NOTIFICATION_TITLE_FIXED = "Retell Webhook Auto-Repaired";

async function isWebhookRegistered(
  agentId: string,
  expectedUrl: string
): Promise<{ registered: boolean; currentUrl: string | null; error?: string }> {
  try {
    const currentUrl = await getRetellAgentWebhookUrl(agentId);
    return { registered: !!currentUrl && currentUrl === expectedUrl, currentUrl };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { registered: false, currentUrl: null, error };
  }
}

async function alertCompany(
  company: { id: string; name: string },
  currentUrl: string | null,
  expectedUrl: string,
  baseUrl: string,
  fixed: boolean
): Promise<void> {
  const notificationTitle = fixed ? NOTIFICATION_TITLE_FIXED : NOTIFICATION_TITLE_BROKEN;
  const dedupCutoff = new Date(Date.now() - DEDUP_WINDOW_MS);

  const recentAlerts = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.companyId, company.id),
        eq(notifications.title, notificationTitle),
        gte(notifications.createdAt, dedupCutoff)
      )
    )
    .limit(1);

  if (recentAlerts.length > 0) {
    console.log(
      `[retell-webhook-check] Alert already sent recently for company "${company.name}" — skipping`
    );
    return;
  }

  const notificationMessage = fixed
    ? `The Retell AI voice webhook was automatically re-registered. No action is needed — calls will be processed normally.`
    : `The Retell AI voice webhook is not correctly registered. Calls may not be processed. Visit Settings > Retell to re-register the webhook.`;

  await storage.createNotification({
    companyId: company.id,
    type: "general",
    title: notificationTitle,
    message: notificationMessage,
    isRead: false,
    linkUrl: "/settings",
  });

  const recipients = await db
    .select({ email: users.email, firstName: users.firstName, role: companyUsers.role })
    .from(companyUsers)
    .innerJoin(users, eq(companyUsers.userId, users.id))
    .where(and(eq(companyUsers.companyId, company.id), eq(companyUsers.isActive, true)));

  const staffToAlert = recipients.filter(
    (r) => r.email && (r.role === "owner" || r.role === "admin")
  );

  for (const recipient of staffToAlert) {
    if (!recipient.email) continue;
    const firstName = recipient.firstName || "there";

    const emailResult = fixed
      ? await sendEmail({
          companyId: company.id,
          to: recipient.email,
          subject: "Retell Voice Webhook Was Automatically Re-Registered",
          text: `Hi ${firstName},\n\nWe detected that the Retell AI voice webhook for your account ("${company.name}") was not correctly registered, but we automatically re-registered it. No action is needed — calls will be processed normally.\n\nWebhook URL: ${expectedUrl}\n\n— ScooPilot`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background-color:#2d8a5e;padding:20px;text-align:center"><h1 style="color:white;margin:0">ScooPilot</h1></div>
        <div style="padding:30px 20px">
          <h2 style="color:#2d8a5e">Retell Voice Webhook Auto-Repaired</h2>
          <p>Hi ${firstName},</p>
          <p>We detected that the Retell AI voice webhook for your account <strong>${company.name}</strong> was not correctly registered. We automatically re-registered it — no action is needed on your part.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
            <tr><td style="padding:8px 12px;background:#f3f4f6;font-weight:600;border:1px solid #e5e7eb">Webhook URL</td><td style="padding:8px 12px;border:1px solid #e5e7eb;word-break:break-all">${expectedUrl}</td></tr>
          </table>
          <p>Calls will be processed normally. You can verify this in your settings at any time.</p>
          <div style="text-align:center;margin:30px 0">
            <a href="${baseUrl}/settings" style="background-color:#2d8a5e;color:white;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:bold">Go to Settings</a>
          </div>
        </div>
        <div style="background-color:#f5f5f5;padding:15px;text-align:center;font-size:12px;color:#666">ScooPilot - Pet Waste Removal Software</div>
      </div>`,
        })
      : await sendEmail({
          companyId: company.id,
          to: recipient.email,
          subject: "Action Required: Retell Voice Webhook is Not Registered",
          text: `Hi ${firstName},\n\nWe detected that the Retell AI voice webhook for your account ("${company.name}") is not correctly registered. This means incoming call data may not be processed.\n\nExpected webhook URL: ${expectedUrl}\nCurrent webhook URL: ${currentUrl ?? "(none)"}\n\nTo fix this, go to Settings > Retell in your dashboard and click "Register Webhook".\n\n— ScooPilot`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background-color:#2d8a5e;padding:20px;text-align:center"><h1 style="color:white;margin:0">ScooPilot</h1></div>
        <div style="padding:30px 20px">
          <h2 style="color:#b91c1c">Retell Voice Webhook Not Registered</h2>
          <p>Hi ${firstName},</p>
          <p>The Retell AI voice webhook for your account <strong>${company.name}</strong> is not correctly registered. Incoming call data may not be processed until this is resolved.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
            <tr><td style="padding:8px 12px;background:#f3f4f6;font-weight:600;border:1px solid #e5e7eb">Expected URL</td><td style="padding:8px 12px;border:1px solid #e5e7eb;word-break:break-all">${expectedUrl}</td></tr>
            <tr><td style="padding:8px 12px;background:#f3f4f6;font-weight:600;border:1px solid #e5e7eb">Current URL</td><td style="padding:8px 12px;border:1px solid #e5e7eb;word-break:break-all">${currentUrl ?? "<em>not set</em>"}</td></tr>
          </table>
          <p>To fix this, visit your settings and re-register the webhook.</p>
          <div style="text-align:center;margin:30px 0">
            <a href="${baseUrl}/settings" style="background-color:#2d8a5e;color:white;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:bold">Go to Settings</a>
          </div>
        </div>
        <div style="background-color:#f5f5f5;padding:15px;text-align:center;font-size:12px;color:#666">ScooPilot - Pet Waste Removal Software</div>
      </div>`,
        });

    if (!emailResult.success) {
      console.error(
        `[retell-webhook-check] Email delivery failed for ${company.id} (${recipient.email}): ${emailResult.error}`
      );
    } else {
      console.log(
        `[retell-webhook-check] Alert email sent to ${recipient.email} for company "${company.name}" (fixed=${fixed})`
      );
    }
  }

  if (staffToAlert.length === 0) {
    console.warn(
      `[retell-webhook-check] No owner/admin email found for company "${company.name}" (${company.id}) — in-app notification created but no email sent`
    );
  }
}

export async function runRetellWebhookCheck(): Promise<void> {
  const retellApiKey = process.env.RETELL_API_KEY;
  if (!retellApiKey) {
    console.log("[retell-webhook-check] RETELL_API_KEY not set — skipping");
    return;
  }

  const baseUrl = getAppBaseUrl();
  if (!baseUrl) {
    console.log("[retell-webhook-check] APP_BASE_URL not set — skipping");
    return;
  }

  const expectedUrl = `${baseUrl}/api/webhooks/retell`;

  let companyChecked = 0;
  let alertSent = 0;

  const retellCompanies = await db
    .select({ id: companies.id, name: companies.name, retellAgentId: companies.retellAgentId })
    .from(companies)
    .where(isNotNull(companies.retellAgentId));

  if (retellCompanies.length > 0) {
    console.log(
      `[retell-webhook-check] Checking ${retellCompanies.length} company/companies with per-company Retell agent`
    );

    for (const company of retellCompanies) {
      const agentId = company.retellAgentId!;
      try {
        const { registered, currentUrl, error } = await isWebhookRegistered(agentId, expectedUrl);
        if (error) {
          console.warn(
            `[retell-webhook-check] Could not fetch webhook URL for company "${company.name}" (agent ${agentId}): ${error}`
          );
          continue;
        }
        companyChecked++;
        if (registered) {
          console.log(
            `[retell-webhook-check] Webhook OK for company "${company.name}" (agent ${agentId})`
          );
          continue;
        }
        console.warn(
          `[retell-webhook-check] Webhook missing/mismatched for company "${company.name}" (agent ${agentId}). Current: ${currentUrl ?? "none"}, Expected: ${expectedUrl}`
        );

        let autoFixed = false;
        try {
          await registerRetellWebhook(agentId);
          autoFixed = true;
          console.log(
            `[retell-webhook-check] Auto-registered webhook for company "${company.name}" (agent ${agentId})`
          );
          await recordRepair(company.id, agentId, currentUrl, expectedUrl, "auto");
        } catch (fixErr: unknown) {
          const fixMsg = fixErr instanceof Error ? fixErr.message : String(fixErr);
          console.error(
            `[retell-webhook-check] Auto-registration failed for company "${company.name}" (agent ${agentId}): ${fixMsg}`
          );
        }

        await alertCompany(company, currentUrl, expectedUrl, baseUrl, autoFixed);
        alertSent++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[retell-webhook-check] Error checking company "${company.name}" (${company.id}):`,
          msg
        );
      }
    }
  }

  const globalAgentId = process.env.RETELL_AGENT_ID;
  if (globalAgentId) {
    const alreadyCoveredByCompany = retellCompanies.some((c) => c.retellAgentId === globalAgentId);
    if (!alreadyCoveredByCompany) {
      const { registered, currentUrl, error } = await isWebhookRegistered(
        globalAgentId,
        expectedUrl
      );
      if (error) {
        console.warn(
          `[retell-webhook-check] Could not fetch webhook URL for global agent ${globalAgentId}: ${error}`
        );
      } else if (!registered) {
        console.warn(
          `[retell-webhook-check] PLATFORM ALERT: Global RETELL_AGENT_ID webhook is missing/mismatched. Current: ${currentUrl ?? "none"}, Expected: ${expectedUrl}. Attempting auto-repair…`
        );
        try {
          await registerRetellWebhook(globalAgentId);
          console.log(
            `[retell-webhook-check] Auto-repair succeeded for global RETELL_AGENT_ID (agent ${globalAgentId})`
          );
        } catch (fixErr: unknown) {
          const fixMsg = fixErr instanceof Error ? fixErr.message : String(fixErr);
          console.error(
            `[retell-webhook-check] Auto-repair failed for global RETELL_AGENT_ID (agent ${globalAgentId}): ${fixMsg}`
          );
        }
      } else {
        console.log(
          `[retell-webhook-check] Global RETELL_AGENT_ID webhook OK (agent ${globalAgentId})`
        );
      }
    }
  }

  if (retellCompanies.length === 0 && !globalAgentId) {
    console.log("[retell-webhook-check] No Retell agents configured — skipping");
    return;
  }

  console.log(
    `[retell-webhook-check] Check complete — ${companyChecked} company/companies checked, ${alertSent} alert(s) sent`
  );
}
