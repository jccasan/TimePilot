import { db } from "../db";
import { sql } from "drizzle-orm";

export async function getDemoCompanyId(): Promise<string | null> {
  const row = await db.execute(sql`
    SELECT c.id FROM users u
    JOIN company_users cu ON cu.user_id = u.id
    JOIN companies c ON c.id = cu.company_id
    WHERE u.email = 'demo@scoopilot.com' LIMIT 1
  `);
  return (row.rows?.[0]?.id as string) ?? null;
}
