/**
 * automation-runner: canonical entrypoint for all automation rule execution.
 *
 * All domain events (lead_created, quote_created, service_completed, invoice_created,
 * payment_failed) fire `fireAutomationTrigger` to execute matching automation rules and
 * persist structured event logs with execution duration telemetry.
 *
 * New automation action types should be added to `executeRuleAction` below.
 */
import { db } from "../db";
import { automationEventLogs, automationRules } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { makeSystemContext, type SkillResult } from "./skills/index";

export type AutomationTrigger = "lead_created" | "quote_created" | "service_completed" | "payment_failed" | "invoice_created";

export type TriggerPayload = Record<string, unknown>;

export async function fireAutomationTrigger(
  trigger: AutomationTrigger,
  companyId: string,
  payload: TriggerPayload
): Promise<void> {
  const matchedRules = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.companyId, companyId),
        eq(automationRules.trigger, trigger),
        eq(automationRules.isActive, true)
      )
    );

  for (const rule of matchedRules) {
    let actionResult: SkillResult = { success: true, message: "ok" };
    const startMs = Date.now();
    try {
      actionResult = await executeRuleAction(rule, companyId, payload);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[automation] Error executing rule "${rule.name}" (${rule.id}):`, err);
      actionResult = { success: false, message: msg, error: "EXECUTION_ERROR" };
    }
    const durationMs = Date.now() - startMs;

    await db.insert(automationEventLogs).values({
      companyId,
      ruleId: rule.id,
      trigger,
      payload,
      result: { ...actionResult, durationMs },
    });
  }
}

async function executeRuleAction(
  rule: typeof automationRules.$inferSelect,
  companyId: string,
  payload: TriggerPayload
): Promise<SkillResult> {
  const actionConfig = rule.actionConfig;
  if (!actionConfig) return { success: true, message: "no action config" };

  const actionType: string = actionConfig.type;
  switch (actionType) {
    case "run_skill": {
      const { skillName, ...skillParams } = actionConfig.params ?? {};
      if (!skillName) {
        return { success: false, message: "run_skill action missing skillName in params", error: "MISSING_SKILL_NAME" };
      }
      const normalizedParams = skillParams as Record<string, unknown>;
      if (skillName === "generate_invoice") {
        if (normalizedParams.scopeToContact) {
          delete normalizedParams.scopeToContact;
          const triggeredContactId =
            typeof payload.contactId === "string" ? payload.contactId : undefined;
          if (triggeredContactId) {
            normalizedParams.contactId = triggeredContactId;
          } else {
            normalizedParams.allPending = true;
          }
        } else if (!normalizedParams.contactId && !normalizedParams.allPending) {
          normalizedParams.allPending = true;
        }
      }
      const { runSkill } = await import("./skills/index");
      return runSkill(String(skillName), normalizedParams, makeSystemContext(companyId));
    }
    case "create_task":
    case "send_email":
    case "send_webhook":
      return { success: true, message: `${actionType} not yet implemented` };
    default:
      return { success: true, message: `unknown action type: ${actionType}` };
  }
}
