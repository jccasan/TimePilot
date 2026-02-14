import { db, pool } from "./db";
import {
  companies, contacts, properties, tags, contactTags,
  routes, servicePlans, visits, invoices, invoiceLineItems,
  automationRules,
} from "@shared/schema";
import { addDays, subDays, nextDay, format, previousDay, isBefore } from "date-fns";
import { count } from "drizzle-orm";

async function seed() {
  console.log("Checking if seed data already exists...");
  const [existing] = await db.select({ count: count() }).from(companies);
  if (existing.count > 0) {
    console.log("Data already exists, skipping seed.");
    await pool.end();
    return;
  }

  console.log("Seeding database...");
  const today = new Date();

  const [company] = await db.insert(companies).values({
    name: "Clean Paws Pet Care",
    email: "demo@cleanpaws.com",
    phone: "(555) 123-4567",
    subscriptionTier: "tier_1_3",
    subscriptionStatus: "active",
    chargeTiming: "day_before",
  }).returning();
  const companyId = company.id;
  console.log("Created company:", companyId);

  const contactsData = [
    { firstName: "Sarah", lastName: "Johnson", status: "active" as const, email: "sarah@email.com", phone: "(555) 111-1111" },
    { firstName: "Mike", lastName: "Williams", status: "active" as const, email: "mike@email.com", phone: "(555) 222-2222" },
    { firstName: "Emily", lastName: "Davis", status: "estimate" as const, email: "emily@email.com", phone: "(555) 333-3333" },
    { firstName: "Robert", lastName: "Brown", status: "lead" as const, email: "robert@email.com", phone: "(555) 444-4444" },
    { firstName: "Lisa", lastName: "Anderson", status: "paused" as const, email: "lisa@email.com", phone: "(555) 555-5555" },
    { firstName: "James", lastName: "Wilson", status: "active" as const, email: "james@email.com", phone: "(555) 666-6666" },
    { firstName: "Karen", lastName: "Thompson", status: "cancelled" as const, email: "karen@email.com", phone: "(555) 777-7777" },
    { firstName: "David", lastName: "Martinez", status: "active" as const, email: "david@email.com", phone: "(555) 888-8888" },
  ];

  const insertedContacts = await db.insert(contacts).values(
    contactsData.map(c => ({ ...c, companyId }))
  ).returning();
  console.log("Created", insertedContacts.length, "contacts");

  const [sarah, mike, emily, , , james, , david] = insertedContacts;

  const propertiesData = [
    { companyId, contactId: sarah.id, streetAddress: "123 Oak Street", city: "Austin", state: "TX", zipCode: "78701", numberOfDogs: 2, yardSize: "medium", gateCode: "1234" },
    { companyId, contactId: mike.id, streetAddress: "456 Elm Avenue", city: "Austin", state: "TX", zipCode: "78702", numberOfDogs: 1, yardSize: "large", specialInstructions: "Dogs are in backyard" },
    { companyId, contactId: emily.id, streetAddress: "789 Pine Road", city: "Austin", state: "TX", zipCode: "78703", numberOfDogs: 3, yardSize: "small" },
    { companyId, contactId: james.id, streetAddress: "321 Cedar Lane", city: "Austin", state: "TX", zipCode: "78704", numberOfDogs: 2, yardSize: "large", gateCode: "5678" },
    { companyId, contactId: david.id, streetAddress: "654 Birch Court", city: "Austin", state: "TX", zipCode: "78705", numberOfDogs: 1, yardSize: "medium" },
  ];

  const insertedProperties = await db.insert(properties).values(propertiesData).returning();
  console.log("Created", insertedProperties.length, "properties");

  const [sarahProp, mikeProp, , jamesProp, davidProp] = insertedProperties;

  const tagsData = [
    { companyId, name: "VIP", color: "#ef4444" },
    { companyId, name: "Weekly", color: "#3b82f6" },
    { companyId, name: "Biweekly", color: "#10b981" },
    { companyId, name: "New Customer", color: "#f59e0b" },
    { companyId, name: "Referral", color: "#8b5cf6" },
  ];

  const insertedTags = await db.insert(tags).values(tagsData).returning();
  console.log("Created", insertedTags.length, "tags");

  await db.insert(contactTags).values([
    { contactId: sarah.id, tagId: insertedTags[0].id },
    { contactId: sarah.id, tagId: insertedTags[1].id },
    { contactId: mike.id, tagId: insertedTags[2].id },
    { contactId: emily.id, tagId: insertedTags[3].id },
    { contactId: david.id, tagId: insertedTags[4].id },
  ]);
  console.log("Assigned tags to contacts");

  const routesData = [
    { companyId, name: "North Austin", dayOfWeek: "monday" as const, color: "#3b82f6" },
    { companyId, name: "South Austin", dayOfWeek: "tuesday" as const, color: "#10b981" },
    { companyId, name: "East Austin", dayOfWeek: "wednesday" as const, color: "#f59e0b" },
    { companyId, name: "West Austin", dayOfWeek: "thursday" as const, color: "#8b5cf6" },
    { companyId, name: "Central Austin", dayOfWeek: "friday" as const, color: "#ef4444" },
  ];

  const insertedRoutes = await db.insert(routes).values(routesData).returning();
  console.log("Created", insertedRoutes.length, "routes");

  const [northRoute, southRoute, eastRoute, westRoute] = insertedRoutes;

  const startDate = format(subDays(today, 30), "yyyy-MM-dd");

  const servicePlansData = [
    { companyId, contactId: sarah.id, propertyId: sarahProp.id, frequency: "weekly" as const, dayOfWeek: "monday" as const, pricePerVisit: "15.00", isActive: true, startDate, routeId: northRoute.id },
    { companyId, contactId: mike.id, propertyId: mikeProp.id, frequency: "biweekly" as const, dayOfWeek: "tuesday" as const, pricePerVisit: "20.00", isActive: true, startDate, routeId: southRoute.id },
    { companyId, contactId: james.id, propertyId: jamesProp.id, frequency: "weekly" as const, dayOfWeek: "wednesday" as const, pricePerVisit: "18.00", isActive: true, startDate, routeId: eastRoute.id },
    { companyId, contactId: david.id, propertyId: davidProp.id, frequency: "monthly" as const, dayOfWeek: "thursday" as const, pricePerVisit: "25.00", isActive: true, startDate, routeId: westRoute.id },
  ];

  const insertedPlans = await db.insert(servicePlans).values(servicePlansData).returning();
  console.log("Created", insertedPlans.length, "service plans");

  const dayMap: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  };

  const allVisits: Array<{
    companyId: string;
    servicePlanId: string;
    propertyId: string;
    routeId: string | null;
    scheduledDate: string;
    status: "scheduled" | "completed";
    completedAt?: Date;
  }> = [];

  for (const plan of insertedPlans) {
    const dow = dayMap[plan.dayOfWeek!];
    const rangeStart = subDays(today, 14);
    const rangeEnd = addDays(today, 14);

    let current = rangeStart;
    while (current.getDay() !== dow) {
      current = addDays(current, 1);
    }

    let completedCount = 0;
    while (isBefore(current, rangeEnd) || format(current, "yyyy-MM-dd") === format(rangeEnd, "yyyy-MM-dd")) {
      const dateStr = format(current, "yyyy-MM-dd");
      const isPast = isBefore(current, today) && format(current, "yyyy-MM-dd") !== format(today, "yyyy-MM-dd");

      if (plan.frequency === "biweekly") {
        const weeksSinceStart = Math.floor((current.getTime() - rangeStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
        if (weeksSinceStart % 2 !== 0) {
          current = addDays(current, 7);
          continue;
        }
      }

      if (plan.frequency === "monthly") {
        if (allVisits.filter(v => v.servicePlanId === plan.id).length >= 1 && !isPast) {
          current = addDays(current, 7);
          continue;
        }
        if (allVisits.filter(v => v.servicePlanId === plan.id).length >= 2) {
          current = addDays(current, 7);
          continue;
        }
      }

      const isCompleted = isPast && completedCount < 3;
      if (isPast && completedCount < 3) completedCount++;

      allVisits.push({
        companyId,
        servicePlanId: plan.id,
        propertyId: plan.propertyId,
        routeId: plan.routeId,
        scheduledDate: dateStr,
        status: isCompleted ? "completed" : "scheduled",
        ...(isCompleted ? { completedAt: new Date(`${dateStr}T14:00:00`) } : {}),
      });

      current = addDays(current, 7);
    }
  }

  if (allVisits.length > 0) {
    await db.insert(visits).values(allVisits).returning();
    console.log("Created", allVisits.length, "visits");
  }

  const todayStr = format(today, "yyyy-MM-dd");

  const [inv1] = await db.insert(invoices).values({
    companyId,
    contactId: sarah.id,
    invoiceNumber: "INV-00001",
    dueDate: todayStr,
    subtotal: "60.00",
    tax: "0",
    total: "60.00",
    status: "paid",
    paidAt: subDays(today, 5),
  }).returning();

  const [inv2] = await db.insert(invoices).values({
    companyId,
    contactId: mike.id,
    invoiceNumber: "INV-00002",
    dueDate: todayStr,
    subtotal: "40.00",
    tax: "0",
    total: "40.00",
    status: "paid",
    paidAt: subDays(today, 3),
  }).returning();

  const [inv3] = await db.insert(invoices).values({
    companyId,
    contactId: james.id,
    invoiceNumber: "INV-00003",
    dueDate: format(addDays(today, 7), "yyyy-MM-dd"),
    subtotal: "36.00",
    tax: "0",
    total: "36.00",
    status: "pending",
  }).returning();

  console.log("Created 3 invoices");

  await db.insert(invoiceLineItems).values([
    { invoiceId: inv1.id, description: "Pet waste removal - 123 Oak Street", quantity: 1, unitPrice: "15.00", total: "15.00" },
    { invoiceId: inv1.id, description: "Pet waste removal - 123 Oak Street", quantity: 1, unitPrice: "15.00", total: "15.00" },
    { invoiceId: inv1.id, description: "Pet waste removal - 123 Oak Street", quantity: 1, unitPrice: "15.00", total: "15.00" },
    { invoiceId: inv1.id, description: "Pet waste removal - 123 Oak Street", quantity: 1, unitPrice: "15.00", total: "15.00" },
    { invoiceId: inv2.id, description: "Pet waste removal - 456 Elm Avenue", quantity: 1, unitPrice: "20.00", total: "20.00" },
    { invoiceId: inv2.id, description: "Pet waste removal - 456 Elm Avenue", quantity: 1, unitPrice: "20.00", total: "20.00" },
    { invoiceId: inv3.id, description: "Pet waste removal - 321 Cedar Lane", quantity: 1, unitPrice: "18.00", total: "18.00" },
    { invoiceId: inv3.id, description: "Pet waste removal - 321 Cedar Lane", quantity: 1, unitPrice: "18.00", total: "18.00" },
  ]);
  console.log("Created invoice line items");

  await db.insert(automationRules).values([
    {
      companyId,
      name: "Welcome New Lead",
      description: "Automatically create a task when a new lead is added",
      trigger: "lead_created",
      isActive: true,
      actionConfig: { type: "create_task", params: { task: "Send estimate to new lead" } },
    },
    {
      companyId,
      name: "Review Request",
      description: "Send a review request email after service is completed",
      trigger: "service_completed",
      isActive: true,
      actionConfig: { type: "send_email", params: { template: "review_request" } },
    },
    {
      companyId,
      name: "Payment Alert",
      description: "Create a follow-up task when a payment fails",
      trigger: "payment_failed",
      isActive: true,
      actionConfig: { type: "create_task", params: { task: "Follow up on failed payment" } },
    },
  ]);
  console.log("Created 3 automation rules");

  console.log("Seed completed successfully!");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  pool.end();
  process.exit(1);
});
