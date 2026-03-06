import { pgTable, varchar, timestamp, boolean, text, integer, decimal, jsonb, date, pgEnum, index, unique } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export { sessions, users, passwordResetTokens, emailVerificationTokens } from "./models/auth";
export type { User, UpsertUser } from "./models/auth";
import { users } from "./models/auth";

export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "tech"]);
export const leadStatusEnum = pgEnum("lead_status", ["lead", "estimate", "active", "paused", "cancelled"]);
export const serviceFrequencyEnum = pgEnum("service_frequency", ["weekly", "biweekly", "monthly", "onetime"]);
export const dayOfWeekEnum = pgEnum("day_of_week", ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
export const visitStatusEnum = pgEnum("visit_status", ["scheduled", "in_progress", "completed", "skipped", "cancelled"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "pending", "paid", "failed", "refunded", "voided"]);
export const chargeTimingEnum = pgEnum("charge_timing", ["day_before", "weekly_batch"]);
export const invoiceTimingEnum = pgEnum("invoice_timing", ["before_service", "after_service"]);
export const invoiceFrequencyEnum = pgEnum("invoice_frequency", ["per_service", "per_week", "per_month"]);
export const discountTypeEnum = pgEnum("discount_type", ["percent", "amount"]);
export const subscriptionTierEnum = pgEnum("subscription_tier", ["free_trial", "tier_1", "tier_1_3", "tier_3_5", "tier_6_10", "tier_10_plus"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["active", "past_due", "cancelled", "trialing"]);
export const automationTriggerEnum = pgEnum("automation_trigger", ["lead_created", "service_completed", "payment_failed", "invoice_created"]);

export const yardDifficultyEnum = pgEnum("yard_difficulty", ["flat", "moderate", "difficult"]);
export const priceRecommendationSourceEnum = pgEnum("price_recommendation_source", ["manual", "auto", "ai_optimizer"]);

export interface PricingConfig {
  techHourlyWageCents: number;
  burdenMultiplier: number;
  averageGasPriceCentsPerGallon: number;
  vehicleMPG: number | null;
  vehicleCostPerMileCents: number;
  baseTimePerTenthAcreMinutes: number;
  extraDogMinutesAfterFirst: number;
  driveSpeedAverageMph: number;
  minimumServiceMinutesFloor: number;
  weeklyMultiplier: number;
  biweeklyMultiplier: number;
  monthlyMultiplier: number;
  oneTimeMultiplier: number;
  difficultyFlat: number;
  difficultyModerate: number;
  difficultyDifficult: number;
  advertisingCents: number;
  payrollProviderCents: number;
  benefitsCents: number;
  insuranceCents: number;
  softwareCents: number;
  otherOverheadCents: number;
  disinfectantCents: number;
  deodorizerCents: number;
  bagsCents: number;
  localMarketAverageWeeklyPriceCents: number | null;
  marketAnchorTolerancePct: number;
  targetProfitMarginPct: number;
  premiumMarginPct: number;
  pricingMode: "aggressive" | "standard" | "premium";
  clusterDiscountPct: number;
  clusterDiscountPct2: number;
  estimatedMonthlyStops: number;
}

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  techHourlyWageCents: 1500,
  burdenMultiplier: 1.4,
  averageGasPriceCentsPerGallon: 350,
  vehicleMPG: null,
  vehicleCostPerMileCents: 65,
  baseTimePerTenthAcreMinutes: 10,
  extraDogMinutesAfterFirst: 2,
  driveSpeedAverageMph: 30,
  minimumServiceMinutesFloor: 8,
  weeklyMultiplier: 1.0,
  biweeklyMultiplier: 1.3,
  monthlyMultiplier: 1.8,
  oneTimeMultiplier: 1.0,
  difficultyFlat: 1.0,
  difficultyModerate: 1.2,
  difficultyDifficult: 1.5,
  advertisingCents: 0,
  payrollProviderCents: 0,
  benefitsCents: 0,
  insuranceCents: 0,
  softwareCents: 0,
  otherOverheadCents: 0,
  disinfectantCents: 25,
  deodorizerCents: 15,
  bagsCents: 10,
  localMarketAverageWeeklyPriceCents: null,
  marketAnchorTolerancePct: 35,
  targetProfitMarginPct: 30,
  premiumMarginPct: 40,
  pricingMode: "standard",
  clusterDiscountPct: 10,
  clusterDiscountPct2: 15,
  estimatedMonthlyStops: 100,
};

export const TIER_CONFIG = {
  free_trial: { name: "Free Trial (14 days)", maxUsers: 1, price: 0 },
  tier_1: { name: "Solo", maxUsers: 1, price: 49.99 },
  tier_1_3: { name: "Starter", maxUsers: 3, price: 99.99 },
  tier_3_5: { name: "Growing", maxUsers: 5, price: 199.99 },
  tier_6_10: { name: "Professional", maxUsers: 10, price: 349.99 },
  tier_10_plus: { name: "Enterprise", maxUsers: 999, price: 599.99 },
} as const;

export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  startAddress: text("start_address"),
  startLatitude: decimal("start_latitude", { precision: 10, scale: 7 }),
  startLongitude: decimal("start_longitude", { precision: 10, scale: 7 }),
  logoUrl: text("logo_url"),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  subscriptionTier: subscriptionTierEnum("subscription_tier").notNull().default("tier_1"),
  subscriptionStatus: subscriptionStatusEnum("subscription_status").notNull().default("trialing"),
  chargeTiming: chargeTimingEnum("charge_timing").notNull().default("day_before"),
  invoiceTheme: text("invoice_theme"),
  mrrCents: integer("mrr_cents").notNull().default(0),
  routeCredits: integer("route_credits").notNull().default(10),
  remindersEnabled: boolean("reminders_enabled").notNull().default(false),
  autoVisitsEnabled: boolean("auto_visits_enabled").notNull().default(false),
  dashboardLayout: jsonb("dashboard_layout").$type<string[]>(),
  aiImportMappingEnabled: boolean("ai_import_mapping_enabled").notNull().default(true),
  pricingConfig: jsonb("pricing_config").$type<PricingConfig>(),
  canceledAt: timestamp("canceled_at"),
  churnReason: varchar("churn_reason", { length: 100 }),
  churnNotes: text("churn_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const companyUsers = pgTable("company_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: userRoleEnum("role").notNull().default("tech"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  unique().on(table.companyId, table.userId),
  index("idx_cu_company").on(table.companyId),
  index("idx_cu_user").on(table.userId),
]);

export const contacts = pgTable("contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  firstName: varchar("first_name", { length: 255 }).notNull(),
  lastName: varchar("last_name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  streetAddress: varchar("street_address", { length: 255 }),
  address2: varchar("address_2", { length: 255 }),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 50 }),
  zipCode: varchar("zip_code", { length: 20 }),
  yardSize: varchar("yard_size", { length: 50 }),
  numberOfDogs: integer("number_of_dogs"),
  serviceFrequency: varchar("service_frequency", { length: 50 }),
  leadSource: varchar("lead_source", { length: 50 }),
  serviceDay: dayOfWeekEnum("service_day"),
  status: leadStatusEnum("status").notNull().default("lead"),
  hasPortalAccess: boolean("has_portal_access").notNull().default(false),
  portalUserId: varchar("portal_user_id").references(() => users.id),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  invoiceTiming: invoiceTimingEnum("invoice_timing").default("after_service"),
  invoiceFrequency: invoiceFrequencyEnum("invoice_frequency").default("per_service"),
  referralSource: varchar("referral_source", { length: 255 }),
  portalPasswordHash: varchar("portal_password_hash", { length: 255 }),
  autoPayEnabled: boolean("auto_pay_enabled").notNull().default(false),
  reminderPreferences: jsonb("reminder_preferences").$type<{ email: boolean; sms: boolean }>().default({ email: true, sms: false }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_contacts_company").on(table.companyId),
  index("idx_contacts_status").on(table.status),
]);

export const tags = pgTable("tags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  color: varchar("color", { length: 7 }).default("#3b82f6"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique().on(table.companyId, table.name),
]);

export const contactTags = pgTable("contact_tags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  tagId: varchar("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (table) => [
  unique().on(table.contactId, table.tagId),
]);

export const leadSources = pgTable("lead_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique().on(table.companyId, table.name),
]);

export const properties = pgTable("properties", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  streetAddress: varchar("street_address", { length: 255 }).notNull(),
  city: varchar("city", { length: 100 }).notNull(),
  state: varchar("state", { length: 50 }).notNull(),
  zipCode: varchar("zip_code", { length: 20 }).notNull(),
  numberOfDogs: integer("number_of_dogs").default(1),
  yardSize: varchar("yard_size", { length: 50 }),
  gateCode: varchar("gate_code", { length: 100 }),
  specialInstructions: text("special_instructions"),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  lotSize: varchar("lot_size", { length: 50 }),
  yardPolygon: jsonb("yard_polygon"),
  measuredYardSqft: integer("measured_yard_sqft"),
  yardDifficulty: yardDifficultyEnum("yard_difficulty").default("flat"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_properties_company").on(table.companyId),
  index("idx_properties_contact").on(table.contactId),
]);

export const routes = pgTable("routes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
  technicianId: varchar("technician_id").references(() => users.id),
  color: varchar("color", { length: 7 }).default("#3b82f6"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_routes_company").on(table.companyId),
]);

export const servicePlans = pgTable("service_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  propertyId: varchar("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  frequency: serviceFrequencyEnum("frequency").notNull(),
  dayOfWeek: dayOfWeekEnum("day_of_week"),
  pricePerVisit: decimal("price_per_visit", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  routeId: varchar("route_id").references(() => routes.id, { onDelete: "set null" }),
  stopOrder: integer("stop_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_sp_company").on(table.companyId),
  index("idx_sp_property").on(table.propertyId),
]);

export const vacationHolds = pgTable("vacation_holds", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  servicePlanId: varchar("service_plan_id").notNull().references(() => servicePlans.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const visits = pgTable("visits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  servicePlanId: varchar("service_plan_id").notNull().references(() => servicePlans.id, { onDelete: "cascade" }),
  propertyId: varchar("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  routeId: varchar("route_id").references(() => routes.id, { onDelete: "set null" }),
  scheduledDate: date("scheduled_date").notNull(),
  status: visitStatusEnum("status").notNull().default("scheduled"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  completedBy: varchar("completed_by").references(() => users.id),
  proofOfServicePhoto: text("proof_of_service_photo"),
  proofOfServicePhotoBefore: text("proof_of_service_photo_before"),
  technicianNotes: text("technician_notes"),
  invoiceId: varchar("invoice_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_visits_company").on(table.companyId),
  index("idx_visits_date").on(table.scheduledDate),
  index("idx_visits_status").on(table.status),
  index("idx_visits_route").on(table.routeId),
]);

export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  invoiceNumber: varchar("invoice_number", { length: 50 }).notNull(),
  dueDate: date("due_date").notNull(),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  taxRate: decimal("tax_rate", { precision: 5, scale: 2 }).default("0"),
  tax: decimal("tax", { precision: 10, scale: 2 }).notNull().default("0"),
  discountType: discountTypeEnum("discount_type"),
  discountValue: decimal("discount_value", { precision: 10, scale: 2 }).default("0"),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  status: invoiceStatusEnum("status").notNull().default("draft"),
  autoGenerated: boolean("auto_generated").default(false),
  paidAt: timestamp("paid_at"),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
  paymentAttempts: integer("payment_attempts").notNull().default(0),
  lastPaymentAttempt: timestamp("last_payment_attempt"),
  source: varchar("source", { length: 50 }).default("manual"),
  externalSource: varchar("external_source", { length: 100 }),
  externalId: varchar("external_id", { length: 255 }),
  importRunId: varchar("import_run_id"),
  issuedDate: date("issued_date"),
  notes: text("notes"),
  excludeFromReminders: boolean("exclude_from_reminders").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_invoices_company").on(table.companyId),
  index("idx_invoices_contact").on(table.contactId),
  index("idx_invoices_status").on(table.status),
  index("idx_invoices_source").on(table.source),
  unique().on(table.companyId, table.invoiceNumber),
]);

export const invoiceLineItems = pgTable("invoice_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  visitId: varchar("visit_id").references(() => visits.id, { onDelete: "set null" }),
  servicePricingId: varchar("service_pricing_id").references(() => servicePricing.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const automationRules = pgTable("automation_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  trigger: automationTriggerEnum("trigger").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  actionConfig: jsonb("action_config").$type<{
    type: "create_task" | "send_email" | "send_webhook";
    params: Record<string, any>;
  }>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_ar_company").on(table.companyId),
]);

export const automationEventLogs = pgTable("automation_event_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  ruleId: varchar("rule_id").references(() => automationRules.id),
  trigger: varchar("trigger", { length: 50 }).notNull(),
  payload: jsonb("payload"),
  result: jsonb("result"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const apiKeys = pgTable("api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  keyHash: varchar("key_hash", { length: 255 }).notNull(),
  keyPrefix: varchar("key_prefix", { length: 10 }).notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_apikeys_company").on(table.companyId),
  index("idx_apikeys_prefix").on(table.keyPrefix),
]);

export const webhooks = pgTable("webhooks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  url: varchar("url", { length: 500 }).notNull(),
  events: jsonb("events").$type<string[]>().notNull(),
  secret: varchar("secret", { length: 255 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const attachments = pgTable("attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  propertyId: varchar("property_id").references(() => properties.id, { onDelete: "cascade" }),
  visitId: varchar("visit_id").references(() => visits.id, { onDelete: "cascade" }),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileUrl: text("file_url").notNull(),
  fileType: varchar("file_type", { length: 50 }),
  fileSize: integer("file_size"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messageChannelEnum = pgEnum("message_channel", ["email", "sms"]);
export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);
export const messageStatusEnum = pgEnum("message_status", ["queued", "sent", "delivered", "failed", "received"]);

export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  channel: messageChannelEnum("channel").notNull(),
  direction: messageDirectionEnum("direction").notNull(),
  status: messageStatusEnum("status").notNull().default("queued"),
  fromAddress: varchar("from_address", { length: 255 }).notNull(),
  toAddress: varchar("to_address", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 500 }),
  body: text("body").notNull(),
  htmlBody: text("html_body"),
  externalId: varchar("external_id", { length: 255 }),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  sentBy: varchar("sent_by").references(() => users.id),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_messages_company").on(table.companyId),
  index("idx_messages_contact").on(table.contactId),
  index("idx_messages_channel").on(table.channel),
]);

export const pricingCategoryEnum = pgEnum("pricing_category", [
  "recurring_service", "one_time_service", "add_on", "package"
]);

export const servicePricing = pgTable("service_pricing", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  category: pricingCategoryEnum("category").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  basePrice: decimal("base_price", { precision: 10, scale: 2 }).notNull(),
  unit: varchar("unit", { length: 50 }).notNull().default("per_visit"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_svcpricing_company").on(table.companyId),
  index("idx_svcpricing_category").on(table.category),
]);

export const servicePackages = pgTable("service_packages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  frequency: varchar("frequency", { length: 50 }).notNull(),
  basePrice: decimal("base_price", { precision: 10, scale: 2 }).notNull(),
  includedItems: jsonb("included_items").$type<string[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_spkg_company").on(table.companyId),
]);

export const portalSessions = pgTable("portal_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 255 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_ps_contact").on(table.contactId),
  index("idx_ps_token").on(table.tokenHash),
]);

export const insertPortalSessionSchema = createInsertSchema(portalSessions).omit({ id: true, createdAt: true });
export type PortalSession = typeof portalSessions.$inferSelect;
export type InsertPortalSession = z.infer<typeof insertPortalSessionSchema>;

export const messageRelations = relations(messages, ({ one }) => ({
  company: one(companies, { fields: [messages.companyId], references: [companies.id] }),
  contact: one(contacts, { fields: [messages.contactId], references: [contacts.id] }),
  sentByUser: one(users, { fields: [messages.sentBy], references: [users.id] }),
}));

export const companyRelations = relations(companies, ({ many }) => ({
  companyUsers: many(companyUsers),
  contacts: many(contacts),
  properties: many(properties),
  routes: many(routes),
  visits: many(visits),
  invoices: many(invoices),
  automationRules: many(automationRules),
  apiKeys: many(apiKeys),
  messages: many(messages),
}));

export const companyUserRelations = relations(companyUsers, ({ one }) => ({
  company: one(companies, { fields: [companyUsers.companyId], references: [companies.id] }),
  user: one(users, { fields: [companyUsers.userId], references: [users.id] }),
}));

export const contactRelations = relations(contacts, ({ one, many }) => ({
  company: one(companies, { fields: [contacts.companyId], references: [companies.id] }),
  properties: many(properties),
  servicePlans: many(servicePlans),
  invoices: many(invoices),
  contactTags: many(contactTags),
}));

export const tagRelations = relations(tags, ({ many }) => ({
  contactTags: many(contactTags),
}));

export const contactTagRelations = relations(contactTags, ({ one }) => ({
  contact: one(contacts, { fields: [contactTags.contactId], references: [contacts.id] }),
  tag: one(tags, { fields: [contactTags.tagId], references: [tags.id] }),
}));

export const propertyRelations = relations(properties, ({ one, many }) => ({
  company: one(companies, { fields: [properties.companyId], references: [companies.id] }),
  contact: one(contacts, { fields: [properties.contactId], references: [contacts.id] }),
  servicePlans: many(servicePlans),
  visits: many(visits),
}));

export const routeRelations = relations(routes, ({ one, many }) => ({
  company: one(companies, { fields: [routes.companyId], references: [companies.id] }),
  technician: one(users, { fields: [routes.technicianId], references: [users.id] }),
  servicePlans: many(servicePlans),
  visits: many(visits),
}));

export const servicePlanRelations = relations(servicePlans, ({ one, many }) => ({
  company: one(companies, { fields: [servicePlans.companyId], references: [companies.id] }),
  contact: one(contacts, { fields: [servicePlans.contactId], references: [contacts.id] }),
  property: one(properties, { fields: [servicePlans.propertyId], references: [properties.id] }),
  route: one(routes, { fields: [servicePlans.routeId], references: [routes.id] }),
  visits: many(visits),
  vacationHolds: many(vacationHolds),
}));

export const vacationHoldRelations = relations(vacationHolds, ({ one }) => ({
  servicePlan: one(servicePlans, { fields: [vacationHolds.servicePlanId], references: [servicePlans.id] }),
}));

export const visitRelations = relations(visits, ({ one }) => ({
  company: one(companies, { fields: [visits.companyId], references: [companies.id] }),
  servicePlan: one(servicePlans, { fields: [visits.servicePlanId], references: [servicePlans.id] }),
  property: one(properties, { fields: [visits.propertyId], references: [properties.id] }),
  route: one(routes, { fields: [visits.routeId], references: [routes.id] }),
  completedByUser: one(users, { fields: [visits.completedBy], references: [users.id] }),
}));

export const invoiceRelations = relations(invoices, ({ one, many }) => ({
  company: one(companies, { fields: [invoices.companyId], references: [companies.id] }),
  contact: one(contacts, { fields: [invoices.contactId], references: [contacts.id] }),
  lineItems: many(invoiceLineItems),
}));

export const invoiceLineItemRelations = relations(invoiceLineItems, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceLineItems.invoiceId], references: [invoices.id] }),
}));

export const insertCompanySchema = createInsertSchema(companies).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCompanyUserSchema = createInsertSchema(companyUsers).omit({ id: true, createdAt: true, updatedAt: true });
export const insertContactSchema = createInsertSchema(contacts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTagSchema = createInsertSchema(tags).omit({ id: true, createdAt: true });
export const insertLeadSourceSchema = createInsertSchema(leadSources).omit({ id: true, createdAt: true });
export const insertPropertySchema = createInsertSchema(properties).omit({ id: true, createdAt: true, updatedAt: true });
export const insertRouteSchema = createInsertSchema(routes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertServicePlanSchema = createInsertSchema(servicePlans).omit({ id: true, createdAt: true, updatedAt: true });
export const insertVacationHoldSchema = createInsertSchema(vacationHolds).omit({ id: true, createdAt: true });
export const insertVisitSchema = createInsertSchema(visits).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInvoiceLineItemSchema = createInsertSchema(invoiceLineItems).omit({ id: true, createdAt: true });
export const insertAutomationRuleSchema = createInsertSchema(automationRules).omit({ id: true, createdAt: true, updatedAt: true });
export const insertApiKeySchema = createInsertSchema(apiKeys).omit({ id: true, createdAt: true });
export const insertWebhookSchema = createInsertSchema(webhooks).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAttachmentSchema = createInsertSchema(attachments).omit({ id: true, createdAt: true });

export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type CompanyUser = typeof companyUsers.$inferSelect;
export type InsertCompanyUser = z.infer<typeof insertCompanyUserSchema>;
export type Contact = typeof contacts.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Tag = typeof tags.$inferSelect;
export type InsertTag = z.infer<typeof insertTagSchema>;
export type LeadSource = typeof leadSources.$inferSelect;
export type InsertLeadSource = z.infer<typeof insertLeadSourceSchema>;
export type Property = typeof properties.$inferSelect;
export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type Route = typeof routes.$inferSelect;
export type InsertRoute = z.infer<typeof insertRouteSchema>;
export type ServicePlan = typeof servicePlans.$inferSelect;
export type InsertServicePlan = z.infer<typeof insertServicePlanSchema>;
export type VacationHold = typeof vacationHolds.$inferSelect;
export type InsertVacationHold = z.infer<typeof insertVacationHoldSchema>;
export type Visit = typeof visits.$inferSelect;
export type InsertVisit = z.infer<typeof insertVisitSchema>;
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type InsertInvoiceLineItem = z.infer<typeof insertInvoiceLineItemSchema>;
export type AutomationRule = typeof automationRules.$inferSelect;
export type InsertAutomationRule = z.infer<typeof insertAutomationRuleSchema>;
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type Webhook = typeof webhooks.$inferSelect;
export type InsertWebhook = z.infer<typeof insertWebhookSchema>;

export const churnReasonEnum = pgEnum("churn_reason", [
  "too_expensive", "not_enough_features", "switched_competitor", "business_closed", "seasonal", "poor_support", "other"
]);

export const smsDirectionEnum = pgEnum("sms_direction", ["inbound", "outbound"]);
export const smsStatusEnum = pgEnum("sms_status", ["queued", "sent", "delivered", "failed", "received"]);

export const smsMessages = pgTable("sms_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  direction: smsDirectionEnum("direction").notNull(),
  segments: integer("segments").notNull().default(1),
  toNumber: varchar("to_number", { length: 50 }).notNull(),
  fromNumber: varchar("from_number", { length: 50 }).notNull(),
  toCountry: varchar("to_country", { length: 10 }).default("US"),
  status: smsStatusEnum("status").notNull().default("queued"),
  twilioSid: varchar("twilio_sid", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_sms_company").on(table.companyId),
  index("idx_sms_created").on(table.createdAt),
]);

export const emailStatusEnum = pgEnum("email_status", ["queued", "sent", "delivered", "bounced", "failed"]);

export const emailsSent = pgTable("emails_sent", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  category: varchar("category", { length: 100 }).default("general"),
  status: emailStatusEnum("email_log_status").notNull().default("sent"),
  toAddress: varchar("to_address", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 500 }),
  sendgridMessageId: varchar("sendgrid_message_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_emails_company").on(table.companyId),
  index("idx_emails_created").on(table.createdAt),
]);

export const accountDailyMetrics = pgTable("account_daily_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  logins: integer("logins").notNull().default(0),
  jobsScheduled: integer("jobs_scheduled").notNull().default(0),
  jobsCompleted: integer("jobs_completed").notNull().default(0),
  invoicesSent: integer("invoices_sent").notNull().default(0),
  paymentsCount: integer("payments_count").notNull().default(0),
  paymentsGrossCents: integer("payments_gross_cents").notNull().default(0),
  paymentsNetCents: integer("payments_net_cents").notNull().default(0),
  twilioSmsOutbound: integer("twilio_sms_outbound").notNull().default(0),
  twilioSmsInbound: integer("twilio_sms_inbound").notNull().default(0),
  twilioCostCentsEst: integer("twilio_cost_cents_est").notNull().default(0),
  sendgridEmailsSent: integer("sendgrid_emails_sent").notNull().default(0),
  sendgridCostCentsEst: integer("sendgrid_cost_cents_est").notNull().default(0),
  churnRiskScore: integer("churn_risk_score").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_adm_company").on(table.companyId),
  index("idx_adm_date").on(table.date),
  unique().on(table.companyId, table.date),
]);

export const saasCostsMonthly = pgTable("saas_costs_monthly", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  month: varchar("month", { length: 7 }).notNull(),
  hostingCents: integer("hosting_cents").notNull().default(0),
  dbCents: integer("db_cents").notNull().default(0),
  emailPlatformCents: integer("email_platform_cents").notNull().default(0),
  smsPlatformCents: integer("sms_platform_cents").notNull().default(0),
  monitoringCents: integer("monitoring_cents").notNull().default(0),
  otherCents: integer("other_cents").notNull().default(0),
  supportLaborCents: integer("support_labor_cents").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique().on(table.month),
]);

export const costConfig = pgTable("cost_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: varchar("key", { length: 100 }).notNull().unique(),
  valueCents: integer("value_cents").notNull().default(0),
  valuePct: decimal("value_pct", { precision: 8, scale: 4 }),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSmsMessageSchema = createInsertSchema(smsMessages).omit({ id: true, createdAt: true });
export const insertEmailSentSchema = createInsertSchema(emailsSent).omit({ id: true, createdAt: true });
export const insertAccountDailyMetricsSchema = createInsertSchema(accountDailyMetrics).omit({ id: true, createdAt: true });
export const insertSaasCostsMonthlySchema = createInsertSchema(saasCostsMonthly).omit({ id: true, createdAt: true });
export const insertCostConfigSchema = createInsertSchema(costConfig).omit({ id: true, updatedAt: true });

export type SmsMessage = typeof smsMessages.$inferSelect;
export type InsertSmsMessage = z.infer<typeof insertSmsMessageSchema>;
export type EmailSent = typeof emailsSent.$inferSelect;
export type InsertEmailSent = z.infer<typeof insertEmailSentSchema>;
export type AccountDailyMetric = typeof accountDailyMetrics.$inferSelect;
export type InsertAccountDailyMetric = z.infer<typeof insertAccountDailyMetricsSchema>;
export type SaasCostMonthly = typeof saasCostsMonthly.$inferSelect;
export type InsertSaasCostMonthly = z.infer<typeof insertSaasCostsMonthlySchema>;
export type CostConfigItem = typeof costConfig.$inferSelect;
export type InsertCostConfig = z.infer<typeof insertCostConfigSchema>;

export const adminNotes = pgTable("admin_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdBy: varchar("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAdminNoteSchema = createInsertSchema(adminNotes).omit({ id: true, createdAt: true });
export type AdminNote = typeof adminNotes.$inferSelect;
export type InsertAdminNote = z.infer<typeof insertAdminNoteSchema>;

export const adminUsers = pgTable("admin_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  previousPasswordHashes: text("previous_password_hashes").array().notNull().default(sql`'{}'::text[]`),
  passwordChangedAt: timestamp("password_changed_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const adminSessions = pgTable("admin_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  adminUserId: varchar("admin_user_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AdminUser = typeof adminUsers.$inferSelect;
export type AdminSession = typeof adminSessions.$inferSelect;

export const notificationTypeEnum = pgEnum("notification_type", [
  "invoice_paid", "invoice_overdue", "visit_completed", "new_lead",
  "payment_failed", "service_paused", "service_resumed", "portal_login",
  "team_joined", "general",
]);

export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull().default("general"),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  linkUrl: varchar("link_url", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_notif_company").on(table.companyId),
  index("idx_notif_read").on(table.companyId, table.isRead),
]);

export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

export const roverTicketTypeEnum = pgEnum("rover_ticket_type", ["bug", "feature_request", "question"]);
export const roverTicketStatusEnum = pgEnum("rover_ticket_status", ["open", "in_progress", "resolved", "closed"]);

export const roverTickets = pgTable("rover_tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  type: roverTicketTypeEnum("type").notNull(),
  status: roverTicketStatusEnum("status").notNull().default("open"),
  subject: varchar("subject", { length: 255 }).notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_rover_company").on(table.companyId),
  index("idx_rover_type").on(table.type),
]);

export const insertRoverTicketSchema = createInsertSchema(roverTickets).omit({ id: true, createdAt: true, updatedAt: true });
export type RoverTicket = typeof roverTickets.$inferSelect;
export type InsertRoverTicket = z.infer<typeof insertRoverTicketSchema>;

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const insertServicePricingSchema = createInsertSchema(servicePricing).omit({ id: true, createdAt: true, updatedAt: true });
export const insertServicePackageSchema = createInsertSchema(servicePackages).omit({ id: true, createdAt: true, updatedAt: true });
export type ServicePricingItem = typeof servicePricing.$inferSelect;
export type InsertServicePricing = z.infer<typeof insertServicePricingSchema>;
export type ServicePackage = typeof servicePackages.$inferSelect;
export type InsertServicePackage = z.infer<typeof insertServicePackageSchema>;
export type Attachment = typeof attachments.$inferSelect;
export type InsertAttachment = z.infer<typeof insertAttachmentSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

export const timeEntries = pgTable("time_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  visitId: varchar("visit_id").references(() => visits.id, { onDelete: "set null" }),
  routeId: varchar("route_id").references(() => routes.id, { onDelete: "set null" }),
  clockIn: timestamp("clock_in").notNull(),
  clockOut: timestamp("clock_out"),
  durationMinutes: integer("duration_minutes"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_te_company").on(table.companyId),
  index("idx_te_user").on(table.userId),
  index("idx_te_clockin").on(table.clockIn),
]);

export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({ id: true, createdAt: true });
export type TimeEntry = typeof timeEntries.$inferSelect;
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;

export const activityActionEnum = pgEnum("activity_action", [
  "created", "updated", "status_changed", "visit_completed", "visit_scheduled",
  "invoice_created", "invoice_paid", "email_sent", "sms_sent", "note_added", "portal_login"
]);

export const activityLog = pgTable("activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  action: activityActionEnum("action").notNull(),
  details: jsonb("details").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_al_company").on(table.companyId),
  index("idx_al_contact").on(table.contactId),
  index("idx_al_created").on(table.createdAt),
]);

export const insertActivityLogSchema = createInsertSchema(activityLog).omit({ id: true, createdAt: true });
export type ActivityLog = typeof activityLog.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", ["pending", "success", "failed"]);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webhookId: varchar("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
  event: varchar("event", { length: 100 }).notNull(),
  payload: jsonb("payload").$type<Record<string, any>>().notNull(),
  status: webhookDeliveryStatusEnum("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastAttempt: timestamp("last_attempt"),
  nextRetry: timestamp("next_retry"),
  responseCode: integer("response_code"),
  responseBody: text("response_body"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_wd_webhook").on(table.webhookId),
  index("idx_wd_status").on(table.status),
  index("idx_wd_next_retry").on(table.nextRetry),
]);

export const insertWebhookDeliverySchema = createInsertSchema(webhookDeliveries).omit({ id: true, createdAt: true });
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type InsertWebhookDelivery = z.infer<typeof insertWebhookDeliverySchema>;

export const auditActionEnum = pgEnum("audit_action", ["create", "update", "delete", "void"]);

export const auditTrail = pgTable("audit_trail", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: varchar("entity_id", { length: 255 }).notNull(),
  action: auditActionEnum("action").notNull(),
  changes: jsonb("changes").$type<{ old?: Record<string, any>; new?: Record<string, any> }>(),
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_audit_company").on(table.companyId),
  index("idx_audit_entity").on(table.entityType, table.entityId),
  index("idx_audit_created").on(table.createdAt),
]);

export const insertAuditTrailSchema = createInsertSchema(auditTrail).omit({ id: true, createdAt: true });
export type AuditTrail = typeof auditTrail.$inferSelect;
export type InsertAuditTrail = z.infer<typeof insertAuditTrailSchema>;

export const importRunStatusEnum = pgEnum("import_run_status", ["pending", "processing", "completed", "failed"]);
export const importRunTypeEnum = pgEnum("import_run_type", [
  "sweepandgo_contacts", "sweepandgo_invoices", "csv_contacts", "csv_routes"
]);

export const importRuns = pgTable("import_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  type: importRunTypeEnum("type").notNull(),
  status: importRunStatusEnum("status").notNull().default("pending"),
  fileName: varchar("file_name", { length: 500 }),
  fileHash: varchar("file_hash", { length: 128 }),
  totalRows: integer("total_rows").notNull().default(0),
  importedRows: integer("imported_rows").notNull().default(0),
  skippedRows: integer("skipped_rows").notNull().default(0),
  errors: jsonb("errors").$type<Array<{ row: number; field?: string; message: string }>>(),
  mappingConfig: jsonb("mapping_config").$type<Record<string, any>>(),
  aiSuggestions: jsonb("ai_suggestions").$type<Record<string, any>>(),
  userOverrides: jsonb("user_overrides").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_ir_company").on(table.companyId),
  index("idx_ir_status").on(table.status),
  index("idx_ir_file_hash").on(table.fileHash),
]);

export const insertImportRunSchema = createInsertSchema(importRuns).omit({ id: true, createdAt: true, completedAt: true });
export type ImportRun = typeof importRuns.$inferSelect;
export type InsertImportRun = z.infer<typeof insertImportRunSchema>;

export const paymentMethodEnum = pgEnum("payment_method", ["cash", "check", "card", "ach", "other", "imported"]);
export const paymentSourceEnum = pgEnum("payment_source", ["stripe", "manual", "imported"]);

export const invoicePayments = pgTable("invoice_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  paidAt: timestamp("paid_at").notNull(),
  method: paymentMethodEnum("method").notNull().default("other"),
  reference: text("reference"),
  source: paymentSourceEnum("source").notNull().default("manual"),
  externalId: varchar("external_id", { length: 255 }),
  importRunId: varchar("import_run_id").references(() => importRuns.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_ip_company").on(table.companyId),
  index("idx_ip_invoice").on(table.invoiceId),
  index("idx_ip_source").on(table.source),
]);

export const insertInvoicePaymentSchema = createInsertSchema(invoicePayments).omit({ id: true, createdAt: true });
export type InvoicePayment = typeof invoicePayments.$inferSelect;
export type InsertInvoicePayment = z.infer<typeof insertInvoicePaymentSchema>;

export const invoicePaymentRelations = relations(invoicePayments, ({ one }) => ({
  company: one(companies, { fields: [invoicePayments.companyId], references: [companies.id] }),
  invoice: one(invoices, { fields: [invoicePayments.invoiceId], references: [invoices.id] }),
  importRun: one(importRuns, { fields: [invoicePayments.importRunId], references: [importRuns.id] }),
}));

export const importRunRelations = relations(importRuns, ({ one }) => ({
  company: one(companies, { fields: [importRuns.companyId], references: [companies.id] }),
}));

export const priceRecommendations = pgTable("price_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  propertyId: varchar("property_id").references(() => properties.id, { onDelete: "set null" }),
  serviceFrequency: varchar("service_frequency", { length: 50 }).notNull(),
  yardSizeAcres: decimal("yard_size_acres", { precision: 10, scale: 4 }),
  dogCount: integer("dog_count").notNull().default(1),
  yardDifficulty: yardDifficultyEnum("yard_difficulty_calc").default("flat"),
  routeId: varchar("route_id").references(() => routes.id, { onDelete: "set null" }),
  minimumPriceCents: integer("minimum_price_cents").notNull(),
  recommendedPriceCents: integer("recommended_price_cents").notNull(),
  premiumPriceCents: integer("premium_price_cents").notNull(),
  jobMinutes: decimal("job_minutes", { precision: 10, scale: 2 }),
  serviceMinutes: decimal("service_minutes", { precision: 10, scale: 2 }),
  travelMinutes: decimal("travel_minutes", { precision: 10, scale: 2 }),
  densityMultiplier: decimal("density_multiplier", { precision: 5, scale: 3 }),
  breakdownJson: jsonb("breakdown_json").$type<Record<string, any>>(),
  inputsJson: jsonb("inputs_json").$type<Record<string, any>>(),
  calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
  calculationVersion: varchar("calculation_version", { length: 20 }).notNull().default("1.0"),
  createdByUserId: varchar("created_by_user_id"),
  source: priceRecommendationSourceEnum("source").notNull().default("manual"),
}, (table) => [
  index("idx_pricerec_company_property").on(table.companyId, table.propertyId),
  index("idx_pricerec_company_calcdate").on(table.companyId, table.calculatedAt),
]);

export const insertPriceRecommendationSchema = createInsertSchema(priceRecommendations).omit({ id: true, calculatedAt: true });
export type PriceRecommendation = typeof priceRecommendations.$inferSelect;
export type InsertPriceRecommendation = z.infer<typeof insertPriceRecommendationSchema>;

export const priceRecommendationRelations = relations(priceRecommendations, ({ one }) => ({
  company: one(companies, { fields: [priceRecommendations.companyId], references: [companies.id] }),
  property: one(properties, { fields: [priceRecommendations.propertyId], references: [properties.id] }),
  route: one(routes, { fields: [priceRecommendations.routeId], references: [routes.id] }),
}));

export const profitabilityStatusEnum = pgEnum("profitability_status", ["profitable", "marginal", "unprofitable"]);

export const profitabilitySnapshots = pgTable("profitability_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  propertyId: varchar("property_id").references(() => properties.id, { onDelete: "set null" }),
  snapshotDate: date("snapshot_date").notNull(),
  revenueCents: integer("revenue_cents").notNull().default(0),
  totalCostCents: integer("total_cost_cents").notNull().default(0),
  profitCents: integer("profit_cents").notNull().default(0),
  profitMarginPct: decimal("profit_margin_pct", { precision: 8, scale: 2 }).notNull().default("0"),
  visitCount: integer("visit_count").notNull().default(0),
  avgRevenuePerVisitCents: integer("avg_revenue_per_visit_cents").notNull().default(0),
  avgCostPerVisitCents: integer("avg_cost_per_visit_cents").notNull().default(0),
  status: profitabilityStatusEnum("status").notNull().default("profitable"),
  breakdownJson: jsonb("breakdown_json").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_profsnap_company_contact").on(table.companyId, table.contactId),
  index("idx_profsnap_company_date").on(table.companyId, table.snapshotDate),
  index("idx_profsnap_company_status").on(table.companyId, table.status),
]);

export const insertProfitabilitySnapshotSchema = createInsertSchema(profitabilitySnapshots).omit({ id: true, createdAt: true });
export type ProfitabilitySnapshot = typeof profitabilitySnapshots.$inferSelect;
export type InsertProfitabilitySnapshot = z.infer<typeof insertProfitabilitySnapshotSchema>;

export const profitabilitySnapshotRelations = relations(profitabilitySnapshots, ({ one }) => ({
  company: one(companies, { fields: [profitabilitySnapshots.companyId], references: [companies.id] }),
  contact: one(contacts, { fields: [profitabilitySnapshots.contactId], references: [contacts.id] }),
  property: one(properties, { fields: [profitabilitySnapshots.propertyId], references: [properties.id] }),
}));

export const overheadCostTypeEnum = pgEnum("overhead_cost_type", ["fixed", "variable"]);

export const overheadCosts = pgTable("overhead_costs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  category: varchar("category", { length: 100 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  monthlyCostCents: integer("monthly_cost_cents").notNull().default(0),
  type: overheadCostTypeEnum("type").notNull().default("fixed"),
  isDefault: boolean("is_default").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertOverheadCostSchema = createInsertSchema(overheadCosts).omit({ id: true });
export type OverheadCost = typeof overheadCosts.$inferSelect;
export type InsertOverheadCost = z.infer<typeof insertOverheadCostSchema>;

export const overheadCostRelations = relations(overheadCosts, ({ one }) => ({
  company: one(companies, { fields: [overheadCosts.companyId], references: [companies.id] }),
}));

export const competitorSourceEnum = pgEnum("competitor_source", ["manual", "research"]);

export const competitorPricing = pgTable("competitor_pricing", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  zipCode: varchar("zip_code", { length: 20 }).notNull(),
  competitorName: varchar("competitor_name", { length: 255 }).notNull(),
  frequency: serviceFrequencyEnum("frequency").notNull().default("weekly"),
  priceCents: integer("price_cents").notNull(),
  dogCountRange: varchar("dog_count_range", { length: 20 }).default("1-2"),
  yardSizeCategory: varchar("yard_size_category", { length: 50 }).default("medium"),
  source: competitorSourceEnum("source").notNull().default("manual"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_comp_pricing_company").on(table.companyId),
  index("idx_comp_pricing_zip").on(table.companyId, table.zipCode),
]);

export const insertCompetitorPricingSchema = createInsertSchema(competitorPricing).omit({ id: true, createdAt: true });
export type CompetitorPricing = typeof competitorPricing.$inferSelect;
export type InsertCompetitorPricing = z.infer<typeof insertCompetitorPricingSchema>;

export const competitorPricingRelations = relations(competitorPricing, ({ one }) => ({
  company: one(companies, { fields: [competitorPricing.companyId], references: [companies.id] }),
}));
