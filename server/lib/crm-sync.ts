import { db } from "../db";
import { crmContacts } from "@shared/crm-schema";
import { and, eq } from "drizzle-orm";

interface MainContact {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
}

export async function syncContactToCrm(contact: MainContact, companyId: string): Promise<void> {
  const firstName = contact.firstName || "";
  const lastName = contact.lastName || "";
  const email = contact.email || null;

  const existing = await db
    .select({ id: crmContacts.id })
    .from(crmContacts)
    .where(and(eq(crmContacts.companyId, companyId), eq(crmContacts.mainContactId, contact.id)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(crmContacts)
      .set({
        firstName,
        lastName,
        email,
        phone: contact.phone || null,
        status: "customer",
        source: "auto-sync",
      })
      .where(and(eq(crmContacts.id, existing[0].id), eq(crmContacts.companyId, companyId)));
  } else {
    await db.insert(crmContacts).values({
      companyId,
      firstName,
      lastName,
      email,
      phone: contact.phone || null,
      status: "customer",
      source: "auto-sync",
      mainContactId: contact.id,
    });
  }
}
