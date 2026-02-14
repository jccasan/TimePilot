import { eq, and, desc, asc, sql, like, or, gte, lte, inArray, count } from "drizzle-orm";
import { db } from "./db";
import {
  companies, companyUsers, contacts, tags, contactTags,
  properties, routes, servicePlans, vacationHolds,
  visits, invoices, invoiceLineItems, automationRules,
  automationEventLogs, apiKeys, webhooks, attachments,
  servicePricing, servicePackages,
  type Company, type InsertCompany,
  type CompanyUser, type InsertCompanyUser,
  type Contact, type InsertContact,
  type Tag, type InsertTag,
  type Property, type InsertProperty,
  type Route, type InsertRoute,
  type ServicePlan, type InsertServicePlan,
  type VacationHold, type InsertVacationHold,
  type Visit, type InsertVisit,
  type Invoice, type InsertInvoice,
  type InvoiceLineItem, type InsertInvoiceLineItem,
  type AutomationRule, type InsertAutomationRule,
  type ApiKey, type InsertApiKey,
  type Webhook, type InsertWebhook,
  type Attachment, type InsertAttachment,
  type ServicePricingItem, type InsertServicePricing,
  type ServicePackage, type InsertServicePackage,
} from "@shared/schema";

export interface IStorage {
  // Companies
  getCompany(id: string): Promise<Company | undefined>;
  listCompanies(): Promise<Company[]>;
  createCompany(data: InsertCompany): Promise<Company>;
  updateCompany(id: string, data: Partial<InsertCompany>): Promise<Company>;

  // Company Users
  getCompanyUser(companyId: string, userId: string): Promise<CompanyUser | undefined>;
  getCompanyUsers(companyId: string): Promise<CompanyUser[]>;
  getCompaniesForUser(userId: string): Promise<CompanyUser[]>;
  createCompanyUser(data: InsertCompanyUser): Promise<CompanyUser>;
  addUserToCompany(userId: string, companyId: string, role: string): Promise<CompanyUser>;
  updateCompanyUser(id: string, data: Partial<InsertCompanyUser>): Promise<CompanyUser>;
  countActiveCompanyUsers(companyId: string): Promise<number>;

  // Contacts
  getContact(id: string, companyId: string): Promise<Contact | undefined>;
  getContacts(companyId: string, filters?: { status?: string; search?: string }): Promise<Contact[]>;
  createContact(data: InsertContact): Promise<Contact>;
  updateContact(id: string, data: Partial<InsertContact>): Promise<Contact>;
  deleteContact(id: string): Promise<void>;

  // Tags
  getTags(companyId: string): Promise<Tag[]>;
  createTag(data: InsertTag): Promise<Tag>;
  deleteTag(id: string): Promise<void>;
  addTagToContact(contactId: string, tagId: string): Promise<void>;
  removeTagFromContact(contactId: string, tagId: string): Promise<void>;
  getContactTags(contactId: string): Promise<Tag[]>;

  // Properties
  getProperty(id: string, companyId: string): Promise<Property | undefined>;
  getProperties(companyId: string, contactId?: string): Promise<Property[]>;
  createProperty(data: InsertProperty): Promise<Property>;
  updateProperty(id: string, data: Partial<InsertProperty>): Promise<Property>;
  deleteProperty(id: string): Promise<void>;

  // Routes
  getRoute(id: string, companyId: string): Promise<Route | undefined>;
  getRoutes(companyId: string, dayOfWeek?: string): Promise<Route[]>;
  createRoute(data: InsertRoute): Promise<Route>;
  updateRoute(id: string, data: Partial<InsertRoute>): Promise<Route>;
  deleteRoute(id: string): Promise<void>;

  // Service Plans
  getServicePlan(id: string, companyId: string): Promise<ServicePlan | undefined>;
  getServicePlans(companyId: string, filters?: { contactId?: string; propertyId?: string; isActive?: boolean }): Promise<ServicePlan[]>;
  createServicePlan(data: InsertServicePlan): Promise<ServicePlan>;
  updateServicePlan(id: string, data: Partial<InsertServicePlan>): Promise<ServicePlan>;
  deleteServicePlan(id: string): Promise<void>;

  // Vacation Holds
  getVacationHolds(servicePlanId: string): Promise<VacationHold[]>;
  createVacationHold(data: InsertVacationHold): Promise<VacationHold>;
  deleteVacationHold(id: string): Promise<void>;

  // Visits
  getVisit(id: string, companyId: string): Promise<Visit | undefined>;
  getVisits(companyId: string, filters?: { date?: string; routeId?: string; status?: string; technicianId?: string }): Promise<Visit[]>;
  getVisitsForDateRange(companyId: string, startDate: string, endDate: string): Promise<Visit[]>;
  createVisit(data: InsertVisit): Promise<Visit>;
  updateVisit(id: string, data: Partial<InsertVisit>): Promise<Visit>;
  getTodaysVisitsCount(companyId: string): Promise<number>;

  // Invoices
  getInvoice(id: string, companyId: string): Promise<Invoice | undefined>;
  getInvoices(companyId: string, filters?: { contactId?: string; status?: string }): Promise<Invoice[]>;
  createInvoice(data: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: string, data: Partial<InsertInvoice>): Promise<Invoice>;
  getNextInvoiceNumber(companyId: string): Promise<string>;
  getFailedPaymentsCount(companyId: string): Promise<number>;
  getRevenueForPeriod(companyId: string, startDate: string, endDate: string): Promise<number>;

  // Invoice Line Items
  getInvoiceLineItems(invoiceId: string): Promise<InvoiceLineItem[]>;
  createInvoiceLineItem(data: InsertInvoiceLineItem): Promise<InvoiceLineItem>;

  // Automation Rules
  getAutomationRules(companyId: string): Promise<AutomationRule[]>;
  createAutomationRule(data: InsertAutomationRule): Promise<AutomationRule>;
  updateAutomationRule(id: string, data: Partial<InsertAutomationRule>): Promise<AutomationRule>;
  deleteAutomationRule(id: string): Promise<void>;
  getRulesForTrigger(companyId: string, trigger: string): Promise<AutomationRule[]>;
  createAutomationEventLog(data: { companyId: string; ruleId?: string; trigger: string; payload?: any; result?: any }): Promise<void>;

  // API Keys
  getApiKeys(companyId: string): Promise<ApiKey[]>;
  getApiKeyByPrefix(prefix: string): Promise<ApiKey | undefined>;
  createApiKey(data: InsertApiKey): Promise<ApiKey>;
  updateApiKeyLastUsed(id: string): Promise<void>;
  deleteApiKey(id: string): Promise<void>;

  // Webhooks
  getWebhooks(companyId: string): Promise<Webhook[]>;
  createWebhook(data: InsertWebhook): Promise<Webhook>;
  updateWebhook(id: string, data: Partial<InsertWebhook>): Promise<Webhook>;
  deleteWebhook(id: string): Promise<void>;
  getWebhooksForEvent(companyId: string, event: string): Promise<Webhook[]>;

  // Attachments
  createAttachment(data: InsertAttachment): Promise<Attachment>;
  getAttachments(companyId: string, filters?: { contactId?: string; propertyId?: string; visitId?: string }): Promise<Attachment[]>;

  // Service Pricing
  getServicePricing(companyId: string, category?: string): Promise<ServicePricingItem[]>;
  createServicePricingItem(data: InsertServicePricing): Promise<ServicePricingItem>;
  updateServicePricingItem(id: string, companyId: string, data: Partial<InsertServicePricing>): Promise<ServicePricingItem>;
  deleteServicePricingItem(id: string, companyId: string): Promise<void>;

  // Service Packages
  getServicePackages(companyId: string): Promise<ServicePackage[]>;
  createServicePackage(data: InsertServicePackage): Promise<ServicePackage>;
  updateServicePackage(id: string, companyId: string, data: Partial<InsertServicePackage>): Promise<ServicePackage>;
  deleteServicePackage(id: string, companyId: string): Promise<void>;

  // Seed default pricing
  seedDefaultPricing(companyId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // ================ Companies ================
  async getCompany(id: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company;
  }

  async listCompanies(): Promise<Company[]> {
    return db.select().from(companies);
  }

  async createCompany(data: InsertCompany): Promise<Company> {
    const [company] = await db.insert(companies).values(data).returning();
    return company;
  }

  async updateCompany(id: string, data: Partial<InsertCompany>): Promise<Company> {
    const [company] = await db.update(companies).set({ ...data, updatedAt: new Date() }).where(eq(companies.id, id)).returning();
    return company;
  }

  // ================ Company Users ================
  async getCompanyUser(companyId: string, userId: string): Promise<CompanyUser | undefined> {
    const [cu] = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId)));
    return cu;
  }

  async getCompanyUsers(companyId: string): Promise<CompanyUser[]> {
    return db.select().from(companyUsers).where(eq(companyUsers.companyId, companyId));
  }

  async getCompaniesForUser(userId: string): Promise<CompanyUser[]> {
    return db.select().from(companyUsers).where(eq(companyUsers.userId, userId));
  }

  async createCompanyUser(data: InsertCompanyUser): Promise<CompanyUser> {
    const [cu] = await db.insert(companyUsers).values(data).returning();
    return cu;
  }

  async addUserToCompany(userId: string, companyId: string, role: string): Promise<CompanyUser> {
    const [cu] = await db.insert(companyUsers).values({ userId, companyId, role }).returning();
    return cu;
  }

  async updateCompanyUser(id: string, data: Partial<InsertCompanyUser>): Promise<CompanyUser> {
    const [cu] = await db.update(companyUsers).set({ ...data, updatedAt: new Date() }).where(eq(companyUsers.id, id)).returning();
    return cu;
  }

  async countActiveCompanyUsers(companyId: string): Promise<number> {
    const [result] = await db.select({ count: count() }).from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.isActive, true)));
    return result?.count ?? 0;
  }

  // ================ Contacts ================
  async getContact(id: string, companyId: string): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, id), eq(contacts.companyId, companyId)));
    return contact;
  }

  async getContacts(companyId: string, filters?: { status?: string; search?: string }): Promise<Contact[]> {
    const conditions = [eq(contacts.companyId, companyId)];
    if (filters?.status) conditions.push(eq(contacts.status, filters.status as any));
    if (filters?.search) {
      conditions.push(or(
        like(contacts.firstName, `%${filters.search}%`),
        like(contacts.lastName, `%${filters.search}%`),
        like(contacts.email, `%${filters.search}%`),
        like(contacts.phone, `%${filters.search}%`),
      )!);
    }
    return db.select().from(contacts).where(and(...conditions)).orderBy(desc(contacts.createdAt));
  }

  async createContact(data: InsertContact): Promise<Contact> {
    const [contact] = await db.insert(contacts).values(data).returning();
    return contact;
  }

  async updateContact(id: string, data: Partial<InsertContact>): Promise<Contact> {
    const [contact] = await db.update(contacts).set({ ...data, updatedAt: new Date() }).where(eq(contacts.id, id)).returning();
    return contact;
  }

  async deleteContact(id: string): Promise<void> {
    await db.delete(contacts).where(eq(contacts.id, id));
  }

  // ================ Tags ================
  async getTags(companyId: string): Promise<Tag[]> {
    return db.select().from(tags).where(eq(tags.companyId, companyId));
  }

  async createTag(data: InsertTag): Promise<Tag> {
    const [tag] = await db.insert(tags).values(data).returning();
    return tag;
  }

  async deleteTag(id: string): Promise<void> {
    await db.delete(tags).where(eq(tags.id, id));
  }

  async addTagToContact(contactId: string, tagId: string): Promise<void> {
    await db.insert(contactTags).values({ contactId, tagId }).onConflictDoNothing();
  }

  async removeTagFromContact(contactId: string, tagId: string): Promise<void> {
    await db.delete(contactTags).where(and(eq(contactTags.contactId, contactId), eq(contactTags.tagId, tagId)));
  }

  async getContactTags(contactId: string): Promise<Tag[]> {
    const result = await db.select({ tag: tags }).from(contactTags).innerJoin(tags, eq(contactTags.tagId, tags.id)).where(eq(contactTags.contactId, contactId));
    return result.map(r => r.tag);
  }

  // ================ Properties ================
  async getProperty(id: string, companyId: string): Promise<Property | undefined> {
    const [property] = await db.select().from(properties).where(and(eq(properties.id, id), eq(properties.companyId, companyId)));
    return property;
  }

  async getProperties(companyId: string, contactId?: string): Promise<Property[]> {
    const conditions = [eq(properties.companyId, companyId)];
    if (contactId) conditions.push(eq(properties.contactId, contactId));
    return db.select().from(properties).where(and(...conditions));
  }

  async createProperty(data: InsertProperty): Promise<Property> {
    const [property] = await db.insert(properties).values(data).returning();
    return property;
  }

  async updateProperty(id: string, data: Partial<InsertProperty>): Promise<Property> {
    const [property] = await db.update(properties).set({ ...data, updatedAt: new Date() }).where(eq(properties.id, id)).returning();
    return property;
  }

  async deleteProperty(id: string): Promise<void> {
    await db.delete(properties).where(eq(properties.id, id));
  }

  // ================ Routes ================
  async getRoute(id: string, companyId: string): Promise<Route | undefined> {
    const [route] = await db.select().from(routes).where(and(eq(routes.id, id), eq(routes.companyId, companyId)));
    return route;
  }

  async getRoutes(companyId: string, dayOfWeek?: string): Promise<Route[]> {
    const conditions = [eq(routes.companyId, companyId)];
    if (dayOfWeek) conditions.push(eq(routes.dayOfWeek, dayOfWeek as any));
    return db.select().from(routes).where(and(...conditions));
  }

  async createRoute(data: InsertRoute): Promise<Route> {
    const [route] = await db.insert(routes).values(data).returning();
    return route;
  }

  async updateRoute(id: string, data: Partial<InsertRoute>): Promise<Route> {
    const [route] = await db.update(routes).set({ ...data, updatedAt: new Date() }).where(eq(routes.id, id)).returning();
    return route;
  }

  async deleteRoute(id: string): Promise<void> {
    await db.delete(routes).where(eq(routes.id, id));
  }

  // ================ Service Plans ================
  async getServicePlan(id: string, companyId: string): Promise<ServicePlan | undefined> {
    const [sp] = await db.select().from(servicePlans).where(and(eq(servicePlans.id, id), eq(servicePlans.companyId, companyId)));
    return sp;
  }

  async getServicePlans(companyId: string, filters?: { contactId?: string; propertyId?: string; isActive?: boolean }): Promise<ServicePlan[]> {
    const conditions = [eq(servicePlans.companyId, companyId)];
    if (filters?.contactId) conditions.push(eq(servicePlans.contactId, filters.contactId));
    if (filters?.propertyId) conditions.push(eq(servicePlans.propertyId, filters.propertyId));
    if (filters?.isActive !== undefined) conditions.push(eq(servicePlans.isActive, filters.isActive));
    return db.select().from(servicePlans).where(and(...conditions));
  }

  async createServicePlan(data: InsertServicePlan): Promise<ServicePlan> {
    const [sp] = await db.insert(servicePlans).values(data).returning();
    return sp;
  }

  async updateServicePlan(id: string, data: Partial<InsertServicePlan>): Promise<ServicePlan> {
    const [sp] = await db.update(servicePlans).set({ ...data, updatedAt: new Date() }).where(eq(servicePlans.id, id)).returning();
    return sp;
  }

  async deleteServicePlan(id: string): Promise<void> {
    await db.delete(servicePlans).where(eq(servicePlans.id, id));
  }

  // ================ Vacation Holds ================
  async getVacationHolds(servicePlanId: string): Promise<VacationHold[]> {
    return db.select().from(vacationHolds).where(eq(vacationHolds.servicePlanId, servicePlanId));
  }

  async createVacationHold(data: InsertVacationHold): Promise<VacationHold> {
    const [vh] = await db.insert(vacationHolds).values(data).returning();
    return vh;
  }

  async deleteVacationHold(id: string): Promise<void> {
    await db.delete(vacationHolds).where(eq(vacationHolds.id, id));
  }

  // ================ Visits ================
  async getVisit(id: string, companyId: string): Promise<Visit | undefined> {
    const [visit] = await db.select().from(visits).where(and(eq(visits.id, id), eq(visits.companyId, companyId)));
    return visit;
  }

  async getVisits(companyId: string, filters?: { date?: string; routeId?: string; status?: string; technicianId?: string }): Promise<Visit[]> {
    const conditions = [eq(visits.companyId, companyId)];
    if (filters?.date) conditions.push(eq(visits.scheduledDate, filters.date));
    if (filters?.routeId) conditions.push(eq(visits.routeId, filters.routeId));
    if (filters?.status) conditions.push(eq(visits.status, filters.status as any));
    return db.select().from(visits).where(and(...conditions)).orderBy(asc(visits.scheduledDate));
  }

  async getVisitsForDateRange(companyId: string, startDate: string, endDate: string): Promise<Visit[]> {
    return db.select().from(visits).where(and(
      eq(visits.companyId, companyId),
      gte(visits.scheduledDate, startDate),
      lte(visits.scheduledDate, endDate),
    )).orderBy(asc(visits.scheduledDate));
  }

  async createVisit(data: InsertVisit): Promise<Visit> {
    const [visit] = await db.insert(visits).values(data).returning();
    return visit;
  }

  async updateVisit(id: string, data: Partial<InsertVisit>): Promise<Visit> {
    const [visit] = await db.update(visits).set({ ...data, updatedAt: new Date() }).where(eq(visits.id, id)).returning();
    return visit;
  }

  async getTodaysVisitsCount(companyId: string): Promise<number> {
    const today = new Date().toISOString().split("T")[0];
    const [result] = await db.select({ count: count() }).from(visits).where(and(eq(visits.companyId, companyId), eq(visits.scheduledDate, today)));
    return result?.count ?? 0;
  }

  // ================ Invoices ================
  async getInvoice(id: string, companyId: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)));
    return invoice;
  }

  async getInvoices(companyId: string, filters?: { contactId?: string; status?: string }): Promise<Invoice[]> {
    const conditions = [eq(invoices.companyId, companyId)];
    if (filters?.contactId) conditions.push(eq(invoices.contactId, filters.contactId));
    if (filters?.status) conditions.push(eq(invoices.status, filters.status as any));
    return db.select().from(invoices).where(and(...conditions)).orderBy(desc(invoices.createdAt));
  }

  async createInvoice(data: InsertInvoice): Promise<Invoice> {
    const [invoice] = await db.insert(invoices).values(data).returning();
    return invoice;
  }

  async updateInvoice(id: string, data: Partial<InsertInvoice>): Promise<Invoice> {
    const [invoice] = await db.update(invoices).set({ ...data, updatedAt: new Date() }).where(eq(invoices.id, id)).returning();
    return invoice;
  }

  async getNextInvoiceNumber(companyId: string): Promise<string> {
    const [result] = await db.select({ count: count() }).from(invoices).where(eq(invoices.companyId, companyId));
    const num = (result?.count ?? 0) + 1;
    return `INV-${String(num).padStart(5, "0")}`;
  }

  async getFailedPaymentsCount(companyId: string): Promise<number> {
    const [result] = await db.select({ count: count() }).from(invoices).where(and(eq(invoices.companyId, companyId), eq(invoices.status, "failed")));
    return result?.count ?? 0;
  }

  async getRevenueForPeriod(companyId: string, startDate: string, endDate: string): Promise<number> {
    const [result] = await db.select({ total: sql<string>`COALESCE(SUM(${invoices.total}::numeric), 0)` }).from(invoices).where(and(
      eq(invoices.companyId, companyId),
      eq(invoices.status, "paid"),
      gte(invoices.createdAt, new Date(startDate)),
      lte(invoices.createdAt, new Date(endDate)),
    ));
    return parseFloat(result?.total ?? "0");
  }

  // ================ Invoice Line Items ================
  async getInvoiceLineItems(invoiceId: string): Promise<InvoiceLineItem[]> {
    return db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
  }

  async createInvoiceLineItem(data: InsertInvoiceLineItem): Promise<InvoiceLineItem> {
    const [item] = await db.insert(invoiceLineItems).values(data).returning();
    return item;
  }

  // ================ Automation Rules ================
  async getAutomationRules(companyId: string): Promise<AutomationRule[]> {
    return db.select().from(automationRules).where(eq(automationRules.companyId, companyId));
  }

  async createAutomationRule(data: InsertAutomationRule): Promise<AutomationRule> {
    const [rule] = await db.insert(automationRules).values(data).returning();
    return rule;
  }

  async updateAutomationRule(id: string, data: Partial<InsertAutomationRule>): Promise<AutomationRule> {
    const [rule] = await db.update(automationRules).set({ ...data, updatedAt: new Date() }).where(eq(automationRules.id, id)).returning();
    return rule;
  }

  async deleteAutomationRule(id: string): Promise<void> {
    await db.delete(automationRules).where(eq(automationRules.id, id));
  }

  async getRulesForTrigger(companyId: string, trigger: string): Promise<AutomationRule[]> {
    return db.select().from(automationRules).where(and(
      eq(automationRules.companyId, companyId),
      eq(automationRules.trigger, trigger as any),
      eq(automationRules.isActive, true),
    ));
  }

  async createAutomationEventLog(data: { companyId: string; ruleId?: string; trigger: string; payload?: any; result?: any }): Promise<void> {
    await db.insert(automationEventLogs).values(data);
  }

  // ================ API Keys ================
  async getApiKeys(companyId: string): Promise<ApiKey[]> {
    return db.select().from(apiKeys).where(eq(apiKeys.companyId, companyId));
  }

  async getApiKeyByPrefix(prefix: string): Promise<ApiKey | undefined> {
    const [key] = await db.select().from(apiKeys).where(and(eq(apiKeys.keyPrefix, prefix), eq(apiKeys.isActive, true)));
    return key;
  }

  async createApiKey(data: InsertApiKey): Promise<ApiKey> {
    const [key] = await db.insert(apiKeys).values(data).returning();
    return key;
  }

  async updateApiKeyLastUsed(id: string): Promise<void> {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
  }

  async deleteApiKey(id: string): Promise<void> {
    await db.delete(apiKeys).where(eq(apiKeys.id, id));
  }

  // ================ Webhooks ================
  async getWebhooks(companyId: string): Promise<Webhook[]> {
    return db.select().from(webhooks).where(eq(webhooks.companyId, companyId));
  }

  async createWebhook(data: InsertWebhook): Promise<Webhook> {
    const [wh] = await db.insert(webhooks).values(data).returning();
    return wh;
  }

  async updateWebhook(id: string, data: Partial<InsertWebhook>): Promise<Webhook> {
    const [wh] = await db.update(webhooks).set({ ...data, updatedAt: new Date() }).where(eq(webhooks.id, id)).returning();
    return wh;
  }

  async deleteWebhook(id: string): Promise<void> {
    await db.delete(webhooks).where(eq(webhooks.id, id));
  }

  async getWebhooksForEvent(companyId: string, event: string): Promise<Webhook[]> {
    const allWebhooks = await db.select().from(webhooks).where(and(eq(webhooks.companyId, companyId), eq(webhooks.isActive, true)));
    return allWebhooks.filter(wh => (wh.events as string[]).includes(event));
  }

  // ================ Attachments ================
  async createAttachment(data: InsertAttachment): Promise<Attachment> {
    const [attachment] = await db.insert(attachments).values(data).returning();
    return attachment;
  }

  async getAttachments(companyId: string, filters?: { contactId?: string; propertyId?: string; visitId?: string }): Promise<Attachment[]> {
    const conditions = [eq(attachments.companyId, companyId)];
    if (filters?.contactId) conditions.push(eq(attachments.contactId, filters.contactId));
    if (filters?.propertyId) conditions.push(eq(attachments.propertyId, filters.propertyId));
    if (filters?.visitId) conditions.push(eq(attachments.visitId, filters.visitId));
    return db.select().from(attachments).where(and(...conditions)).orderBy(desc(attachments.createdAt));
  }
  // ================ Service Pricing ================
  async getServicePricing(companyId: string, category?: string): Promise<ServicePricingItem[]> {
    const conditions = [eq(servicePricing.companyId, companyId)];
    if (category) conditions.push(eq(servicePricing.category, category as any));
    return db.select().from(servicePricing).where(and(...conditions)).orderBy(asc(servicePricing.sortOrder), asc(servicePricing.name));
  }

  async createServicePricingItem(data: InsertServicePricing): Promise<ServicePricingItem> {
    const [item] = await db.insert(servicePricing).values(data).returning();
    return item;
  }

  async updateServicePricingItem(id: string, companyId: string, data: Partial<InsertServicePricing>): Promise<ServicePricingItem> {
    const [item] = await db.update(servicePricing).set({ ...data, updatedAt: new Date() }).where(and(eq(servicePricing.id, id), eq(servicePricing.companyId, companyId))).returning();
    return item;
  }

  async deleteServicePricingItem(id: string, companyId: string): Promise<void> {
    await db.delete(servicePricing).where(and(eq(servicePricing.id, id), eq(servicePricing.companyId, companyId)));
  }

  // ================ Service Packages ================
  async getServicePackages(companyId: string): Promise<ServicePackage[]> {
    return db.select().from(servicePackages).where(eq(servicePackages.companyId, companyId)).orderBy(asc(servicePackages.sortOrder), asc(servicePackages.name));
  }

  async createServicePackage(data: InsertServicePackage): Promise<ServicePackage> {
    const [pkg] = await db.insert(servicePackages).values(data).returning();
    return pkg;
  }

  async updateServicePackage(id: string, companyId: string, data: Partial<InsertServicePackage>): Promise<ServicePackage> {
    const [pkg] = await db.update(servicePackages).set({ ...data, updatedAt: new Date() }).where(and(eq(servicePackages.id, id), eq(servicePackages.companyId, companyId))).returning();
    return pkg;
  }

  async deleteServicePackage(id: string, companyId: string): Promise<void> {
    await db.delete(servicePackages).where(and(eq(servicePackages.id, id), eq(servicePackages.companyId, companyId)));
  }

  // ================ Seed Default Pricing ================
  async seedDefaultPricing(companyId: string): Promise<void> {
    const existingPricing = await this.getServicePricing(companyId);
    const existingPackages = await this.getServicePackages(companyId);

    const defaultPricing: Omit<InsertServicePricing, "companyId">[] = [
      { category: "recurring_service", name: "Weekly Scooping 1 Dog", description: "Once per week yard cleanup for 1 dog", basePrice: "19.99", unit: "per_week", sortOrder: 1 },
      { category: "recurring_service", name: "Weekly Scooping 2 Dog", description: "Once per week yard cleanup for 2 dogs", basePrice: "24.99", unit: "per_week", sortOrder: 2 },
      { category: "recurring_service", name: "Weekly Scooping 3 Dog", description: "Once per week yard cleanup for 3 dogs", basePrice: "29.99", unit: "per_week", sortOrder: 3 },
      { category: "recurring_service", name: "Weekly Scooping 4 Dog", description: "Once per week yard cleanup for 4 dogs", basePrice: "34.99", unit: "per_week", sortOrder: 4 },
      { category: "recurring_service", name: "Weekly Scooping 5+ Dog", description: "Once per week yard cleanup for 5 or more dogs", basePrice: "39.99", unit: "per_week", sortOrder: 5 },
      { category: "recurring_service", name: "Twice Weekly Scooping 1 Dog", description: "Two visits per week for 1 dog", basePrice: "17.99", unit: "per_visit", sortOrder: 6 },
      { category: "recurring_service", name: "Twice Weekly Scooping 2 Dog", description: "Two visits per week for 2 dogs", basePrice: "22.99", unit: "per_visit", sortOrder: 7 },
      { category: "recurring_service", name: "Twice Weekly Scooping 3 Dog", description: "Two visits per week for 3 dogs", basePrice: "27.99", unit: "per_visit", sortOrder: 8 },
      { category: "recurring_service", name: "Twice Weekly Scooping 4 Dog", description: "Two visits per week for 4 dogs", basePrice: "32.99", unit: "per_visit", sortOrder: 9 },
      { category: "recurring_service", name: "Twice Weekly Scooping 5+ Dog", description: "Two visits per week for 5 or more dogs", basePrice: "37.99", unit: "per_visit", sortOrder: 10 },
      { category: "recurring_service", name: "Bi-Weekly Scooping 1 Dog", description: "Every other week yard cleanup for 1 dog", basePrice: "26.99", unit: "per_visit", sortOrder: 11 },
      { category: "recurring_service", name: "Bi-Weekly Scooping 2 Dog", description: "Every other week yard cleanup for 2 dogs", basePrice: "31.99", unit: "per_visit", sortOrder: 12 },
      { category: "recurring_service", name: "Bi-Weekly Scooping 3 Dog", description: "Every other week yard cleanup for 3 dogs", basePrice: "36.99", unit: "per_visit", sortOrder: 13 },
      { category: "recurring_service", name: "Bi-Weekly Scooping 4 Dog", description: "Every other week yard cleanup for 4 dogs", basePrice: "41.99", unit: "per_visit", sortOrder: 14 },
      { category: "recurring_service", name: "Bi-Weekly Scooping 5+ Dog", description: "Every other week yard cleanup for 5 or more dogs", basePrice: "46.99", unit: "per_visit", sortOrder: 15 },
      { category: "one_time_service", name: "One-Time Cleaning (First 5-Gal Bucket)", description: "Initial one-time cleanup, first 5-gallon bucket", basePrice: "49.99", unit: "flat_rate", sortOrder: 1 },
      { category: "one_time_service", name: "One-Time Cleaning (Additional 5-Gal Bucket)", description: "Additional 5-gallon bucket for one-time cleanup", basePrice: "24.99", unit: "flat_rate", sortOrder: 2 },
      { category: "add_on", name: "Front/Side Yard", description: "Additional service for front or side yard areas", basePrice: "7.99", unit: "per_visit", sortOrder: 1 },
      { category: "add_on", name: "Deck", description: "Deck cleaning and waste removal", basePrice: "5.99", unit: "per_visit", sortOrder: 2 },
      { category: "add_on", name: "Deodorizing (with Scoop)", description: "Deodorizing treatment included with scooping service", basePrice: "9.99", unit: "per_visit", sortOrder: 3 },
      { category: "add_on", name: "Waste Take-Away", description: "Removal of collected waste from property", basePrice: "5.99", unit: "per_visit", sortOrder: 4 },
      { category: "add_on", name: "Lot Size up to .25 Acre", description: "No additional charge for lots up to 0.25 acre", basePrice: "0.00", unit: "per_visit", sortOrder: 5 },
      { category: "add_on", name: "Lot Size up to .5 Acre", description: "Additional charge for lots up to 0.5 acre", basePrice: "7.00", unit: "per_visit", sortOrder: 6 },
      { category: "add_on", name: "Lot Size up to .75 Acre", description: "Additional charge for lots up to 0.75 acre", basePrice: "14.00", unit: "per_visit", sortOrder: 7 },
      { category: "add_on", name: "Lot Size up to 1 Acre", description: "Additional charge for lots up to 1 acre", basePrice: "21.00", unit: "per_visit", sortOrder: 8 },
    ];

    if (existingPricing.length === 0) {
      for (const item of defaultPricing) {
        await this.createServicePricingItem({ ...item, companyId });
      }
    }

    const defaultPackages: Omit<InsertServicePackage, "companyId">[] = [
      {
        name: "Basic Weekly",
        description: "Weekly scooping for 1 dog on a standard lot",
        frequency: "weekly",
        basePrice: "19.99",
        includedItems: ["Weekly Scooping 1 Dog", "Lot size up to .25 acre"],
        sortOrder: 1,
      },
      {
        name: "Standard Weekly",
        description: "Weekly scooping for 2 dogs with waste take-away",
        frequency: "weekly",
        basePrice: "30.98",
        includedItems: ["Weekly Scooping 2 Dog", "Waste Take-Away", "Lot size up to .25 acre"],
        sortOrder: 2,
      },
      {
        name: "Premium Weekly",
        description: "Twice weekly scooping for 2 dogs with deodorizing",
        frequency: "weekly",
        basePrice: "55.97",
        includedItems: ["Twice Weekly Scooping 2 Dog", "Deodorizing (with Scoop)", "Waste Take-Away"],
        sortOrder: 3,
      },
      {
        name: "Multi-Dog Household",
        description: "Weekly service for 4+ dogs with full treatment",
        frequency: "weekly",
        basePrice: "50.97",
        includedItems: ["Weekly Scooping 4 Dog", "Deodorizing (with Scoop)", "Waste Take-Away"],
        sortOrder: 4,
      },
    ];

    if (existingPackages.length === 0) {
      for (const pkg of defaultPackages) {
        await this.createServicePackage({ ...pkg, companyId });
      }
    }
  }
}

export const storage = new DatabaseStorage();
