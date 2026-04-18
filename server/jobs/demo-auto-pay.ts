import { db } from "../db";
import { sql } from "drizzle-orm";

export async function runDemoAutoPay() {
  const tag = "[demo-auto-pay]";
  try {
    const demoRow = await db.execute(sql`
      SELECT c.id AS company_id, c.demo_auto_pay_invoices
      FROM users u
      JOIN company_users cu ON cu.user_id = u.id
      JOIN companies c ON c.id = cu.company_id
      WHERE u.email = 'demo@scoopilot.com'
      LIMIT 1
    `);
    if (!demoRow.rows || demoRow.rows.length === 0) return;

    const companyId = demoRow.rows[0].company_id as string;
    const autoPayEnabled = !!(demoRow.rows[0].demo_auto_pay_invoices);
    if (!autoPayEnabled) return;

    // Fetch all outstanding invoices (sent or pending, not yet paid)
    const outstanding = await db.execute(sql`
      SELECT id, total
      FROM invoices
      WHERE company_id = ${companyId}
        AND status IN ('sent', 'pending')
    `);

    if (!outstanding.rows || outstanding.rows.length === 0) return;

    let paid = 0;
    let overdue = 0;

    for (const inv of outstanding.rows) {
      const invoiceId = inv.id as string;
      const total = parseFloat(String(inv.total)) || 0;
      const amountCents = Math.round(total * 100);

      // 90% chance paid, 10% chance left as overdue
      if (Math.random() < 0.9) {
        await db.execute(sql`
          INSERT INTO invoice_payments (id, company_id, invoice_id, amount_cents, paid_at, method, source)
          VALUES (gen_random_uuid(), ${companyId}, ${invoiceId}, ${amountCents}, NOW(), 'card', 'manual')
          ON CONFLICT DO NOTHING
        `);
        await db.execute(sql`
          UPDATE invoices
          SET status = 'paid', paid_at = NOW(), updated_at = NOW()
          WHERE id = ${invoiceId} AND company_id = ${companyId}
        `);
        paid++;
      } else {
        // Set due date 7-10 days in the past so it appears overdue
        const daysAgo = 7 + Math.floor(Math.random() * 4);
        await db.execute(sql`
          UPDATE invoices
          SET due_date = CURRENT_DATE - INTERVAL '1 day' * ${daysAgo},
              updated_at = NOW()
          WHERE id = ${invoiceId} AND company_id = ${companyId}
        `);
        overdue++;
      }
    }

    if (paid > 0 || overdue > 0) {
      console.log(`${tag} Marked ${paid} invoices paid, ${overdue} as overdue for demo company`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${tag} Error:`, message);
  }
}
