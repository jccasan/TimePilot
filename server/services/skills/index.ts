import { z } from "zod";

export type SkillContext = {
  companyId: string;
  userId: string;
  /** "system" is reserved for platform-initiated invocations (automation, scheduled jobs).
   *  Skills that enforce role-based gating should treat "system" as least-privilege. */
  role: string;
};

/** Use for platform-initiated skill invocations (automation triggers, scheduled jobs).
 *  Produces a SkillContext with a well-known system principal rather than a real user. */
export function makeSystemContext(companyId: string): SkillContext {
  return { companyId, userId: "system", role: "system" };
}

export type SkillResult = {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
  error?: string;
};

export interface Skill {
  name: string;
  description: string;
  parameterSchema: z.ZodTypeAny;
  execute(params: Record<string, unknown>, context: SkillContext): Promise<SkillResult>;
}

const registry = new Map<string, Skill>();

export { registry as skillRegistry };

export function registerSkill(skill: Skill): void {
  registry.set(skill.name, skill);
}

export function getSkill(name: string): Skill | undefined {
  return registry.get(name);
}

export function listSkills(): Skill[] {
  return Array.from(registry.values());
}

let skillsLoadPromise: Promise<void> | null = null;

async function ensureSkillsLoaded(): Promise<void> {
  if (!skillsLoadPromise) {
    skillsLoadPromise = import("./optimize-route").then(() => undefined);
  }
  await skillsLoadPromise;
}

export async function runSkill(
  name: string,
  params: Record<string, unknown>,
  context: SkillContext
): Promise<SkillResult> {
  await ensureSkillsLoaded();
  const skill = registry.get(name);
  if (!skill) {
    return { success: false, message: `Unknown skill: ${name}`, error: "SKILL_NOT_FOUND" };
  }
  try {
    const parsed = skill.parameterSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        message: "Invalid parameters",
        error: parsed.error.issues.map(i => i.message).join("; "),
      };
    }
    return await skill.execute(parsed.data, context);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[skills] Error executing skill "${name}":`, err);
    return { success: false, message: "Skill execution failed", error: msg };
  }
}
