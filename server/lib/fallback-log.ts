import { db } from "../db";
import { fallbackLog } from "@shared/schema";

interface FallbackEntry {
  companyId: string;
  channel: string;
  triggerPhrase?: string;
  agentResponse?: string;
}

export async function logFallback(entry: FallbackEntry): Promise<void> {
  try {
    await db.insert(fallbackLog).values({
      companyId: entry.companyId,
      channel: entry.channel,
      triggerPhrase: entry.triggerPhrase || null,
      agentResponse: entry.agentResponse || null,
    });
  } catch {}
}

export function isFallbackResponse(response: string): boolean {
  try {
    return response.toLowerCase().includes("i'm not certain about that");
  } catch {
    return false;
  }
}
