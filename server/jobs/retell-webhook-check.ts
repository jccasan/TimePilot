import { db } from "../db";
import { eq, and, gte, isNotNull } from "drizzle-orm";
import { companies, companyUsers, users, notifications } from "@shared/schema";
import { storage } from "../storage";
import { sendEmail } from "../services/email";
import { getRetellAgentWebhookUrl, getAppBaseUrl } from "../services/retell";

const DEDUP_WINDOW_MS = 23 * 60 * 60 * 1000;
const NOTIFICATION_TITLE = "Retell Webhook Not Registered";

async function isWebhookRegistered(agentId: string, expectedUrl: string): Promise<{ registered: boolean; currentUrl: string | null; error?: string }> {
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
): Promise<void> {
  const dedupCutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
  const recentAlerts = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.companyId, company.id),
        eq(notifications.title, NOTIFICATION_TITLE),
        gte(notifications.createdAt, dedupCutoff)
      )
    )
    .limit(1);

  if (recentAlerts.length > 0) {
    console.log(`[retell-webhook-check] Alert already sent recently for company "${company.name}" — skipping`);
    return;
  }

  await storage.createNotification({
    companyId: company.id,
    type: "general",
    title: NOTIFICATION_TITLE,
    message: `The Retell AI voice webhook is not correctly registered. Calls may not be processed. Visit Settings > Retell to re-register the webhook.`,
    isRead: false,
    linkUrl: "/settings",
  });

  const recipients = await db
    .select({ email: users.email, firstName: users.firstName, role: companyUsers.role })
    .from(companyUsers)
    .innerJoin(users, eq(companyUsers.userId, users.id))
    .where(
      and(
        eq(companyUsers.companyId, company.id),
        eq(companyUsers.isActive, true)
      )
    );

  const staffToAlert = recipients.filter(
    r => r.email && (r.role === "owner" || r.role === "admin")
  );

  for (const recipient of staffToAlert) {
    if (!recipient.email) continue;
    const firstName = recipient.firstName || "there";
    const emailResult = await sendEmail({
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
      console.error(`[retell-webhook-check] Email delivery failed for ${company.id} (${recipient.email}): ${emailResult.error}`);
    } else {
      console.log(`[retell-webhook-check] Alert email sent to ${recipient.email} for company "${company.name}"`);
    }
  }

  if (staffToAlert.length === 0) {
    console.warn(`[retell-webhook-check] No owner/admin email found for company "${company.name}" (${company.id}) — in-app notification created but no email sent`);
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
    console.log(`[retell-webhook-check] Checking ${retellCompanies.length} company/companies with per-company Retell agent`);

    for (const company of retellCompanies) {
      const agentId = company.retellAgentId!;
      try {
        const { registered, currentUrl, error } = await isWebhookRegistered(agentId, expectedUrl);
        if (error) {
          console.warn(`[retell-webhook-check] Could not fetch webhook URL for company "${company.name}" (agent ${agentId}): ${error}`);
          continue;
        }
        companyChecked++;
        if (registered) {
          console.log(`[retell-webhook-check] Webhook OK for company "${company.name}" (agent ${agentId})`);
          continue;
        }
        console.warn(`[retell-webhook-check] Webhook missing/mismatched for company "${company.name}" (agent ${agentId}). Current: ${currentUrl ?? "none"}, Expected: ${expectedUrl}`);
        await alertCompany(company, currentUrl, expectedUrl, baseUrl);
        alertSent++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[retell-webhook-check] Error checking company "${company.name}" (${company.id}):`, msg);
      }
    }
  }

  const globalAgentId = process.env.RETELL_AGENT_ID;
  if (globalAgentId) {
    const alreadyCoveredByCompany = retellCompanies.some(c => c.retellAgentId === globalAgentId);
    if (!alreadyCoveredByCompany) {
      const { registered, currentUrl, error } = await isWebhookRegistered(globalAgentId, expectedUrl);
      if (error) {
        console.warn(`[retell-webhook-check] Could not fetch webhook URL for global agent ${globalAgentId}: ${error}`);
      } else if (!registered) {
        console.warn(`[retell-webhook-check] PLATFORM ALERT: Global RETELL_AGENT_ID webhook is missing/mismatched. Current: ${currentUrl ?? "none"}, Expected: ${expectedUrl}. Platform admins should re-register the webhook.`);
      } else {
        console.log(`[retell-webhook-check] Global RETELL_AGENT_ID webhook OK (agent ${globalAgentId})`);
      }
    }
  }

  if (retellCompanies.length === 0 && !globalAgentId) {
    console.log("[retell-webhook-check] No Retell agents configured — skipping");
    return;
  }

  console.log(`[retell-webhook-check] Check complete — ${companyChecked} company/companies checked, ${alertSent} alert(s) sent`);
}
