import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { visits, users, companyUsers } from "@shared/schema";

export async function runDemoAutoComplete() {
  const tag = "[demo-auto-complete]";
  try {
    const demoRow = await db.execute(sql`
      SELECT c.id AS company_id, c.timezone
      FROM users u
      JOIN company_users cu ON cu.user_id = u.id
      JOIN companies c ON c.id = cu.company_id
      WHERE u.email = 'demo@scoopilot.com'
      LIMIT 1
    `);
    if (!demoRow.rows || demoRow.rows.length === 0) {
      return;
    }

    const companyId = demoRow.rows[0].company_id as string;
    const tz = (demoRow.rows[0].timezone as string) || "America/New_York";

    const now = new Date();
    const companyNow = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    const tomorrow = new Date(companyNow);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    const result = await db.execute(sql`
      UPDATE visits
      SET status = 'completed',
          completed_at = NOW(),
          started_at = COALESCE(started_at, NOW() - INTERVAL '30 minutes')
      WHERE company_id = ${companyId}
        AND scheduled_date = ${tomorrowStr}
        AND status IN ('scheduled', 'in_progress')
    `);

    const count = result.rowCount ?? 0;
    if (count > 0) {
      console.log(`${tag} Auto-completed ${count} visits for demo company (date: ${tomorrowStr})`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${tag} Error:`, message);
  }
}
