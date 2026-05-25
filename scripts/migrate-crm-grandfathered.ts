import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`
    ALTER TABLE companies 
    ADD COLUMN IF NOT EXISTS crm_grandfathered boolean NOT NULL DEFAULT false
  `);
  console.log("Column added (or already existed)");

  const result = await db.execute(sql`
    UPDATE companies c
    SET crm_grandfathered = true
    WHERE c.subscription_tier = 'tier_starter'
    AND EXISTS (
      SELECT 1 FROM crm_contacts cc WHERE cc.company_id = c.id
      UNION ALL
      SELECT 1 FROM crm_deals cd WHERE cd.company_id = c.id
      UNION ALL
      SELECT 1 FROM crm_tasks ct WHERE ct.company_id = c.id
      UNION ALL
      SELECT 1 FROM crm_activities ca WHERE ca.company_id = c.id
    )
    AND crm_grandfathered = false
  `);
  console.log("Migration complete, rows grandfathered:", result.rowCount);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
