import { db } from "../db";
import { smsSessions } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

type Message = { role: string; content: string };

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function loadSession(fromNumber: string, toNumber: string) {
  try {
    const [session] = await db
      .select()
      .from(smsSessions)
      .where(and(eq(smsSessions.fromNumber, fromNumber), eq(smsSessions.toNumber, toNumber)))
      .limit(1);

    if (!session) return null;

    const ageMs = Date.now() - new Date(session.updatedAt).getTime();
    if (ageMs > TWENTY_FOUR_HOURS_MS) {
      await db
        .delete(smsSessions)
        .where(and(eq(smsSessions.fromNumber, fromNumber), eq(smsSessions.toNumber, toNumber)));
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

export async function createSession(
  companyId: string,
  fromNumber: string,
  toNumber: string,
  messages: Message[]
) {
  try {
    const [session] = await db
      .insert(smsSessions)
      .values({ companyId, fromNumber, toNumber, messages })
      .returning();
    return session;
  } catch {
    return null;
  }
}

export async function updateSession(fromNumber: string, toNumber: string, messages: Message[]) {
  try {
    const [session] = await db
      .update(smsSessions)
      .set({ messages, updatedAt: sql`NOW()` })
      .where(and(eq(smsSessions.fromNumber, fromNumber), eq(smsSessions.toNumber, toNumber)))
      .returning();
    return session;
  } catch {
    return null;
  }
}
